/**
 * The bridge between the MCP server and the Chrome extension.
 *
 * The server listens on 127.0.0.1 and the extension connects out (MV3 workers
 * cannot listen). One extension socket is active at a time. Every connection
 * must come from the pinned Sprout extension origin and present the pairing
 * token as a WebSocket subprotocol, never in the URL (INV-1). Requests are correlated by id and are tied to the socket that
 * carried them, so a stale socket can never answer another socket's call.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";

const DEFAULT_PORT = 17373;
const HOST = "127.0.0.1";
const TIMEOUT_MS = 45_000;
/** Fits a base64 JPEG screenshot with headroom (BB-016). */
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
/** A runaway client (or a prompt-injected model loop) cannot park unlimited calls. */
const MAX_PENDING_CALLS = 64;
const REPLACED_CLOSE_CODE = 1012;

/**
 * The extension's id, fixed by the `key` in extension/manifest.json so it is the
 * same in every folder and on every machine (SEC-005, SEC-041). Only this origin
 * may connect. Regenerating the key means updating this constant.
 */
export const SPROUT_EXTENSION_ID = "njkdmnnddihonlemhncieneengnaijop";

/** Offered by the extension and echoed back by the server; doubles as the wire version. */
export const PROTOCOL_VERSION = "sprout.v1";
/** The token travels as one more subprotocol entry: `sprout.token.<token>` (SEC-006). */
const TOKEN_PROTOCOL_PREFIX = "sprout.token.";

/** Failed handshakes allowed per window before every attempt gets 429 (SEC-007). */
const DEFAULT_RATE_LIMIT = { max: 20, windowMs: 10_000 };

export type BridgeErrorCode =
  | "extension_not_connected"
  | "extension_timeout"
  | "extension_error"
  | "socket_closed"
  | "invalid_response"
  | "invalid_port"
  | "send_failed"
  | "too_many_requests";

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
  /** The socket the request went out on. Only that socket may answer it. */
  socket: WebSocket;
}

interface ToolRequest {
  tool: string;
  args?: Record<string, unknown>;
}

let activeSocket: WebSocket | null = null;
let nextRequestId = 1;
const pendingCalls = new Map<number, PendingCall>();
const loggedUnknownIds = new Set<number>();

// --- Token -----------------------------------------------------------------

/** `SPROUT_TOKEN_FILE` exists so tests never touch the user's real token. */
export function tokenFilePath(): string {
  const override = process.env.SPROUT_TOKEN_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".sprout", "token");
}

export interface TokenState {
  token: string;
  /** True when this call created the file. */
  created: boolean;
}

function newToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function loadOrCreateToken(): TokenState {
  const file = tokenFilePath();

  try {
    const token = fs.readFileSync(file, { encoding: "utf-8" }).trim();
    if (token.length > 0) {
      // Repair a hand-edited or restored file. POSIX only; ignored on Windows,
      // where the profile ACL is the protection (SEC-004).
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        // Not supported here.
      }
      return { token, created: false };
    }
  } catch {
    // Missing or unreadable: create it below.
  }

  const token = newToken();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  try {
    // "wx" so two servers starting together cannot each announce a different token.
    fs.writeFileSync(file, token, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    return { token, created: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

    const existing = fs.readFileSync(file, { encoding: "utf-8" }).trim();
    if (existing.length > 0) return { token: existing, created: false };

    // The file existed but was empty: fill it in.
    fs.writeFileSync(file, token, { encoding: "utf-8", mode: 0o600 });
    return { token, created: true };
  }
}

/**
 * Replaces the token (`node dist/index.js --rotate-token`). The extension must
 * be given the new value; the old one stops working on the next connect.
 */
export function rotateToken(): string {
  const file = tokenFilePath();
  const token = newToken();

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Not supported here (Windows): the profile ACL is the protection.
  }
  return token;
}

function hashToken(token: string): Buffer {
  return crypto.createHash("sha256").update(token, "utf8").digest();
}

/** Constant-time comparison, including the lengths (hashes are fixed size). */
export function tokensMatch(expected: string, presented: string): boolean {
  return crypto.timingSafeEqual(hashToken(expected), hashToken(presented));
}

/** The token from the `Sec-WebSocket-Protocol` header, or null (SEC-006). */
export function tokenFromProtocols(header: string | string[] | undefined): string | null {
  const entries = (Array.isArray(header) ? header.join(",") : header ?? "")
    .split(",")
    .map((entry) => entry.trim());

  const entry = entries.find((value) => value.startsWith(TOKEN_PROTOCOL_PREFIX));
  const token = entry?.slice(TOKEN_PROTOCOL_PREFIX.length);
  return token ? token : null;
}

/** Only the pinned Sprout extension may connect (SEC-002, SEC-005). */
export function isExtensionOrigin(origin: string | undefined): boolean {
  return origin === `chrome-extension://${SPROUT_EXTENSION_ID}`;
}

/**
 * Counts failed handshakes per window. Past the budget every attempt is refused
 * with 429 before the token is looked at, and rejections are logged as one line
 * per window instead of one per attempt (SEC-007).
 */
class HandshakeLimiter {
  private windowStart = 0;
  private failures = 0;
  private quietRejections = 0;
  private summaryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly limit: { max: number; windowMs: number }) {}

  private roll(now: number): void {
    if (now - this.windowStart >= this.limit.windowMs) {
      this.windowStart = now;
      this.failures = 0;
    }
  }

  exhausted(now = Date.now()): boolean {
    this.roll(now);
    return this.failures >= this.limit.max;
  }

  reject(reason: string, now = Date.now()): void {
    this.roll(now);
    this.failures += 1;

    if (this.summaryTimer) {
      this.quietRejections += 1;
      return;
    }

    console.error(`Sprout bridge rejected a connection: ${reason}`);
    this.summaryTimer = setTimeout(() => {
      if (this.quietRejections > 0) {
        console.error(
          `Sprout bridge rejected ${this.quietRejections} more connection(s) in the last ${this.limit.windowMs / 1000}s.`,
        );
      }
      this.quietRejections = 0;
      this.summaryTimer = null;
    }, this.limit.windowMs);
    // A pending summary must not keep the process alive after the client leaves.
    this.summaryTimer.unref();
  }
}

// --- Configuration ---------------------------------------------------------

export function resolvePort(raw: string | undefined = process.env.SPROUT_PORT): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new BridgeError(
      "invalid_port",
      `SPROUT_PORT must be an integer between 1 and 65535 (got "${raw}").`,
    );
  }
  return value;
}

// --- Server ----------------------------------------------------------------

export interface StartServerOptions {
  /** Overrides SPROUT_PORT. Tests pass 0 to get a free port. */
  port?: number;
  /** Failed handshakes allowed per window. Tests pass a small budget. */
  rateLimit?: { max: number; windowMs: number };
}

export function startServer(options: StartServerOptions = {}): WebSocketServer {
  const port = options.port ?? resolvePort();
  const { token, created } = loadOrCreateToken();
  const limiter = new HandshakeLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT);

  const wss = new WebSocketServer({
    host: HOST,
    port,
    maxPayload: MAX_PAYLOAD_BYTES,
    // Echo the version, never the token entry. A browser drops the connection
    // if the server picks no protocol it offered.
    handleProtocols: (protocols) => (protocols.has(PROTOCOL_VERSION) ? PROTOCOL_VERSION : false),
    // Reject during the HTTP upgrade, before a WebSocket is ever opened, so a
    // web page cannot even hold a connection open. Origin first because it is
    // the check a browser page fails and it is cheaper than hashing a token.
    verifyClient: (info, done) => {
      if (limiter.exhausted()) {
        limiter.reject("too many failed attempts, try again shortly");
        done(false, 429, "Too Many Requests");
        return;
      }

      if (!isExtensionOrigin(info.origin)) {
        limiter.reject(`origin ${info.origin ?? "(none)"} is not the Sprout extension`);
        done(false, 401, "Unauthorized origin");
        return;
      }

      const presented = tokenFromProtocols(info.req.headers["sec-websocket-protocol"]);
      if (presented === null || !tokensMatch(token, presented)) {
        // Never log the token itself.
        limiter.reject("missing or wrong pairing token");
        done(false, 401, "Unauthorized");
        return;
      }

      done(true);
    },
  });

  wss.on("listening", () => {
    const address = wss.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.error(`Sprout bridge listening on ws://${HOST}:${boundPort}`);

    // The token itself is never printed: MCP clients often keep the server's
    // stderr in their own logs (SEC-004, SEC-050).
    if (created) {
      console.error(`Sprout created a new pairing token in ${tokenFilePath()}.`);
      console.error("Open that file, copy its contents, and paste them into the Sprout extension popup once.");
    } else {
      console.error(`Sprout pairing token: the one saved in ${tokenFilePath()}.`);
    }
  });

  wss.on("error", (error: NodeJS.ErrnoException) => {
    const detail =
      error.code === "EADDRINUSE"
        ? `Port ${port} is already in use. Another Sprout server (or another program) owns it. Stop it or set SPROUT_PORT.`
        : `Sprout bridge failed: ${error.message}`;
    console.error(detail);
    process.exit(1);
  });

  wss.on("connection", (socket) => {
    adoptSocket(socket);
  });

  return wss;
}

function adoptSocket(socket: WebSocket): void {
  const previous = activeSocket;

  if (previous && previous !== socket && previous.readyState === WebSocket.OPEN) {
    // Replace policy: a reloaded extension must not leave a zombie socket that
    // keeps receiving tool calls (BB-005). The old socket's pending calls are
    // rejected by its own close handler only.
    console.error("Sprout bridge: replacing the previous extension connection.");
    previous.close(REPLACED_CLOSE_CODE, "replaced by a newer connection");
  }

  activeSocket = socket;

  socket.on("message", (data) => handleMessage(socket, data.toString()));
  socket.on("close", () => handleSocketClose(socket));
  socket.on("error", (error) => {
    console.error(`Sprout bridge socket error: ${error.message}`);
    handleSocketClose(socket);
  });

  console.error("Sprout bridge: extension connected.");
}

// --- Messages --------------------------------------------------------------

function sendFrame(socket: WebSocket, frame: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;

  try {
    socket.send(JSON.stringify(frame));
  } catch (error) {
    console.error(
      `Sprout bridge: could not write to the extension (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

/**
 * Handles one frame from the extension.
 *
 * Heartbeats are separated by `type` so they can never resolve a tool call.
 * Only the active socket is allowed to resolve calls (BB-006).
 */
export function handleMessage(socket: WebSocket, raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("Sprout bridge: dropped a frame that was not JSON.");
    return;
  }

  if (typeof parsed !== "object" || parsed === null) {
    console.error("Sprout bridge: dropped a frame that was not an object.");
    return;
  }

  const frame = parsed as Record<string, unknown>;

  if (frame.type === "ping") {
    sendFrame(socket, { type: "pong" });
    return;
  }
  if (frame.type === "pong") return;

  if (socket !== activeSocket) {
    console.error("Sprout bridge: ignored a frame from a stale connection.");
    return;
  }

  // Ids go out as integers and must come back as integers. Number() would turn
  // "5", true or "" into an id (BB-036).
  const requestId = frame.requestId;
  if (typeof requestId !== "number" || !Number.isInteger(requestId)) {
    console.error("Sprout bridge: dropped a frame with no usable requestId.");
    return;
  }

  const pending = pendingCalls.get(requestId);
  if (!pending) {
    if (loggedUnknownIds.size < 20 && !loggedUnknownIds.has(requestId)) {
      loggedUnknownIds.add(requestId);
      console.error(`Sprout bridge: response for unknown request id ${requestId} (already timed out?).`);
    }
    return;
  }

  // The reply must come from the socket that carried the request (BB-006). A
  // newer connection holding the same token cannot forge an older call's result.
  if (pending.socket !== socket) {
    console.error(`Sprout bridge: ignored a reply to request ${requestId} from a different socket.`);
    return;
  }

  clearTimeout(pending.timeout);
  pendingCalls.delete(requestId);

  if (typeof frame.error === "string" && frame.error.length > 0) {
    pending.reject(new BridgeError("extension_error", frame.error));
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(frame, "data")) {
    pending.reject(
      new BridgeError("invalid_response", `The extension answered request ${requestId} without a data field.`),
    );
    return;
  }

  pending.resolve(frame.data);
}

export function handleSocketClose(socket?: WebSocket): void {
  if (socket) {
    for (const [requestId, pending] of pendingCalls) {
      if (pending.socket !== socket) continue;

      clearTimeout(pending.timeout);
      pendingCalls.delete(requestId);
      pending.reject(new BridgeError("socket_closed", "The extension disconnected before it answered."));
    }
  }

  if (!socket || socket === activeSocket) {
    activeSocket = null;
  }
}

// --- Calls -----------------------------------------------------------------

export function callExtension(request: ToolRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = activeSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(
        new BridgeError(
          "extension_not_connected",
          "Sprout extension not connected. Open Chrome with the Sprout extension enabled, then try again.",
        ),
      );
      return;
    }

    if (pendingCalls.size >= MAX_PENDING_CALLS) {
      reject(
        new BridgeError(
          "too_many_requests",
          `Too many Sprout calls in flight (${MAX_PENDING_CALLS}). Wait for the current ones to finish.`,
        ),
      );
      return;
    }

    const requestId = nextRequestId++;
    const timeout = setTimeout(() => {
      pendingCalls.delete(requestId);
      reject(
        new BridgeError(
          "extension_timeout",
          `The extension did not answer ${request.tool} within ${TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    }, TIMEOUT_MS);

    pendingCalls.set(requestId, { resolve, reject, timeout, socket });

    try {
      socket.send(
        JSON.stringify({
          requestId,
          type: "tool",
          tool: request.tool,
          args: request.args ?? {},
        }),
      );
    } catch (error) {
      clearTimeout(timeout);
      pendingCalls.delete(requestId);
      reject(
        new BridgeError(
          "send_failed",
          `Could not send ${request.tool} to the extension: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  });
}
