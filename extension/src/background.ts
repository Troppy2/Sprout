/**
 * MV3 service worker: bridge client and tool dispatcher.
 *
 * It sleeps after about 30s idle and loses every module variable, so the token
 * lives in chrome.storage.local and every listener is registered at the top
 * level, synchronously. The heartbeat plus a chrome.alarms wake-up keep the
 * connection recoverable.
 */
import "./lib/downloads"; // registers the downloads hold (SEC-068)
import { errorMessage } from "./lib/errors";
import { getToolHandler } from "./tools/index";

const DEFAULT_PORT = 17373;
const HEARTBEAT_MS = 20_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const ALARM_NAME = "sprout-reconnect";
/** Must match server/src/bridge.ts. The token rides as a second subprotocol (SEC-006). */
const PROTOCOL_VERSION = "sprout.v1";
const TOKEN_PROTOCOL_PREFIX = "sprout.token.";
/** Subprotocol values may only use these characters; anything else throws in the constructor. */
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;

type ConnectionStatus = "connected" | "connecting" | "disconnected";

let socket: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = BACKOFF_START_MS;
let connecting: Promise<void> | null = null;
let status: ConnectionStatus = "disconnected";

function setStatus(next: ConnectionStatus): void {
  if (status === next) return;
  status = next;

  // The popup may not be open; a missing receiver is not an error.
  void chrome.runtime.sendMessage({ type: "sprout-status", status }).catch(() => {});
}

async function getToken(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get("token");
  const token = stored.token;

  if (typeof token !== "string") return undefined;

  const trimmed = token.trim();
  if (trimmed.length === 0) return undefined;

  if (!TOKEN_PATTERN.test(trimmed)) {
    console.warn("sprout: the saved token has characters a pairing token never contains; paste it again.");
    return undefined;
  }
  return trimmed;
}

/**
 * The server can be moved with SPROUT_PORT. The popup has no port field yet, so
 * a non-default port is set once from the worker console:
 * chrome.storage.local.set({ port: 18000 }).
 */
async function getPort(): Promise<number> {
  const stored = await chrome.storage.local.get("port");
  const port = stored.port;

  if (typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) {
    return port;
  }
  return DEFAULT_PORT;
}

function clearHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function startHeartbeat(ws: WebSocket): void {
  clearHeartbeat();

  const beat = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  };

  // Activity right away keeps the worker alive and proves the link immediately.
  beat();
  heartbeat = setInterval(beat, HEARTBEAT_MS);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  const delay = backoff;
  backoff = Math.min(backoff * 2, BACKOFF_CAP_MS);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

/** Callers share the attempt in flight, so a reconnect can wait for it to finish (BB-033). */
function connect(): Promise<void> {
  connecting ??= openSocket().finally(() => {
    connecting = null;
  });
  return connecting;
}

async function openSocket(): Promise<void> {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    const token = await getToken();

    if (!token) {
      // Nothing to pair with yet: the popup saves the token and reconnects.
      setStatus("disconnected");
      return;
    }

    setStatus("connecting");

    const port = await getPort();
    // The token goes in a header, not the URL, which Chrome and tools log (SEC-006).
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, [PROTOCOL_VERSION, `${TOKEN_PROTOCOL_PREFIX}${token}`]);
    socket = ws;

    ws.onopen = () => {
      backoff = BACKOFF_START_MS;
      clearReconnect();
      setStatus("connected");
      console.log("sprout: connected");
      startHeartbeat(ws);
    };

    ws.onmessage = (event) => {
      void handleMessage(ws, event.data);
    };

    ws.onclose = () => {
      // A replaced socket closes after the new one is live; it must not touch
      // the new connection's heartbeat or status.
      if (socket !== ws) return;

      clearHeartbeat();
      socket = null;
      setStatus("disconnected");
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose always follows; reconnecting is handled there.
      if (ws.readyState !== WebSocket.CLOSED) ws.close();
    };
  } catch (error) {
    console.error("sprout: connect failed", error);
    setStatus("disconnected");
    scheduleReconnect();
  }
}

async function handleMessage(ws: WebSocket, raw: unknown): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(String(raw));
  } catch {
    console.warn("sprout: dropped a frame that was not JSON");
    return;
  }

  if (typeof message !== "object" || message === null) return;

  const frame = message as Record<string, unknown>;

  // Anything but a tool request (including the heartbeat "pong") needs no reply.
  if (frame.type !== "tool") return;

  const requestId = frame.requestId;
  const tool = typeof frame.tool === "string" ? frame.tool : "";

  const reply = (payload: Record<string, unknown>) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ requestId, ...payload }));
  };

  if (!Number.isInteger(requestId)) {
    console.warn("sprout: dropped a tool frame with no usable requestId");
    return;
  }

  const handler = getToolHandler(tool);
  if (!handler) {
    reply({ error: `Unknown tool: ${tool}` });
    return;
  }

  try {
    reply({ data: await handler(frame.args) });
  } catch (error) {
    reply({ error: errorMessage(error) });
  }
}

// --- Listeners (top level, synchronous: a sleeping worker must wake for these) ---

// Content scripts are not trusted contexts: keep the pairing token and the
// Sprout group id out of their reach (SEC-037).
try {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
} catch {
  // Older Chrome builds: the default access level stays.
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  // A backoff retry is already pending: do not stack a second attempt on it.
  if (reconnectTimer) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    void connect();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only our own extension pages (the popup) may drive the worker. A content
  // script, if one ever exists, must not be able to drop the socket.
  if (sender.id !== chrome.runtime.id || sender.tab) return false;

  if (typeof message !== "object" || message === null) return false;

  if (message.type === "sprout-status") {
    sendResponse({ status });
    return false;
  }

  if (message.type === "sprout-reconnect") {
    void (async () => {
      // A connect in flight already read the old token. Let it finish, then
      // replace its socket, so the new token is actually used (BB-033).
      await connecting;

      const old = socket;
      socket = null;
      backoff = BACKOFF_START_MS;
      clearReconnect();
      clearHeartbeat();

      if (old && old.readyState !== WebSocket.CLOSED) old.close();

      await connect();
      sendResponse({ status });
    })();
    return true;
  }

  return false;
});

// Every worker start runs this, which covers install, browser startup and a wake-up.
// Creating an existing alarm restarts its countdown, so only create a missing one.
void chrome.alarms.get(ALARM_NAME).then((existing) => {
  if (!existing) void chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});
void connect();
