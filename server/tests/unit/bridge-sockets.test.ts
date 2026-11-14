import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket, type WebSocketServer } from "ws";
import { callExtension, loadOrCreateToken, SPROUT_EXTENSION_ID, startServer } from "../../src/bridge.js";

// Layer 1 with a real socket: the handshake, the heartbeat, and the rule that a
// socket only answers the calls it carried.

const EXT_ORIGIN = `chrome-extension://${SPROUT_EXTENSION_ID}`;

let dir = "";
let wss: WebSocketServer;
let port = 0;
let token = "";
const clients: WebSocket[] = [];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "sprout-sockets-"));
  process.env.SPROUT_TOKEN_FILE = path.join(dir, "token");
  token = loadOrCreateToken().token;

  // The bridge logs every rejection; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  wss = startServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));

  const address = wss.address();
  port = typeof address === "object" && address ? address.port : 0;
});

afterAll(() => {
  for (const client of clients) {
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
  wss?.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SPROUT_TOKEN_FILE;
});

function connect(
  options: { token?: string | null; origin?: string | null; queryToken?: string; targetPort?: number } = {},
): WebSocket {
  const presented = options.token === null ? null : options.token ?? token;
  const origin = options.origin === null ? undefined : options.origin ?? EXT_ORIGIN;

  // The extension sends the token as a subprotocol (SEC-006), the same way a
  // browser WebSocket does: new WebSocket(url, ["sprout.v1", "sprout.token.<token>"]).
  const protocols = presented === null ? ["sprout.v1"] : ["sprout.v1", `sprout.token.${presented}`];
  const query = options.queryToken === undefined ? "" : `?token=${encodeURIComponent(options.queryToken)}`;
  const ws = new WebSocket(`ws://127.0.0.1:${options.targetPort ?? port}/${query}`, protocols, origin ? { origin } : {});
  clients.push(ws);
  return ws;
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_request, response) => {
      reject(new Error(`handshake rejected with ${response.statusCode}`));
    });
  });
}

/** Resolves with the HTTP status of the rejected handshake, or null if it opened. */
function handshakeOutcome(ws: WebSocket): Promise<number | null> {
  return new Promise((resolve) => {
    ws.once("open", () => resolve(null));
    ws.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    ws.once("error", () => resolve(-1));
    ws.once("close", () => resolve(-2));
  });
}

function closed(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve(1006);
      return;
    }
    ws.once("close", (code) => resolve(code));
  });
}

function nextFrame(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString()) as Record<string, unknown>));
  });
}

describe("handshake (INV-1)", () => {
  it("rejects a connection with no token", async () => {
    expect(await handshakeOutcome(connect({ token: null }))).toBe(401);
  });

  it("rejects a wrong token", async () => {
    expect(await handshakeOutcome(connect({ token: "not-the-token" }))).toBe(401);
  });

  it("rejects a web page origin even with the right token", async () => {
    expect(await handshakeOutcome(connect({ origin: "https://evil.test" }))).toBe(401);
  });

  it("rejects a connection with no Origin header at all", async () => {
    expect(await handshakeOutcome(connect({ origin: null }))).toBe(401);
  });

  it("accepts the token plus the Sprout extension origin", async () => {
    const ws = connect();
    await expect(opened(ws)).resolves.toBeUndefined();
    ws.close();
  });

  it("SEC-006: selects sprout.v1 and never echoes the token protocol", async () => {
    const ws = connect();
    await opened(ws);
    expect(ws.protocol).toBe("sprout.v1");
    ws.close();
  });

  it("SEC-006: rejects a token sent only in the query string", async () => {
    expect(await handshakeOutcome(connect({ token: null, queryToken: token }))).toBe(401);
  });

  it("SEC-005: rejects another extension's origin even with the right token", async () => {
    expect(await handshakeOutcome(connect({ origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" }))).toBe(401);
  });
});

describe("rate limit (SEC-007)", () => {
  it("answers 429 once the handshake budget for the window is spent", async () => {
    const limited = startServer({ port: 0, rateLimit: { max: 3, windowMs: 60_000 } });
    await new Promise<void>((resolve) => limited.once("listening", () => resolve()));
    const address = limited.address();
    const limitedPort = typeof address === "object" && address ? address.port : 0;

    try {
      const outcomes: Array<number | null> = [];
      for (let i = 0; i < 4; i++) {
        outcomes.push(await handshakeOutcome(connect({ token: "wrong", targetPort: limitedPort })));
      }
      expect(outcomes).toEqual([401, 401, 401, 429]);
    } finally {
      limited.close();
    }
  });
});

describe("protocol", () => {
  it("answers the heartbeat with pong (BB-007)", async () => {
    const ws = connect();
    await opened(ws);

    const pong = nextFrame(ws);
    ws.send(JSON.stringify({ type: "ping" }));

    await expect(pong).resolves.toEqual({ type: "pong" });
    ws.close();
  });

  it("round trips a tool call with requestId and data", async () => {
    const ws = connect();
    await opened(ws);

    const pending = callExtension({ tool: "ping", args: { message: "hi" } });
    const frame = await nextFrame(ws);

    expect(frame).toMatchObject({ type: "tool", tool: "ping", args: { message: "hi" } });
    expect(Number.isInteger(frame.requestId)).toBe(true);

    ws.send(JSON.stringify({ requestId: frame.requestId, data: "hi" }));
    await expect(pending).resolves.toBe("hi");
    ws.close();
  });

  it("rejects a resident without a data field instead of resolving undefined (BB-013)", async () => {
    const ws = connect();
    await opened(ws);

    const pending = callExtension({ tool: "ping" });
    const frame = await nextFrame(ws);

    ws.send(JSON.stringify({ requestId: frame.requestId, result: "pong" }));
    await expect(pending).rejects.toMatchObject({ code: "invalid_response" });
    ws.close();
  });

  // BB-036: Number() turned "5", true and "" into ids, so a sloppy or hostile
  // frame could settle a call it did not answer properly.
  it("BB-036: ignores a reply whose requestId is not a number", async () => {
    const ws = connect();
    await opened(ws);

    const pending = callExtension({ tool: "ping" });
    const frame = await nextFrame(ws);

    ws.send(JSON.stringify({ requestId: String(frame.requestId), data: "forged" }));
    ws.send(JSON.stringify({ requestId: frame.requestId, data: "real" }));
    await expect(pending).resolves.toBe("real");
    ws.close();
  });

  it("passes an extension error through as a typed error", async () => {
    const ws = connect();
    await opened(ws);

    const pending = callExtension({ tool: "ping" });
    const frame = await nextFrame(ws);

    ws.send(JSON.stringify({ requestId: frame.requestId, error: "boom" }));
    await expect(pending).rejects.toMatchObject({ code: "extension_error", message: "boom" });
    ws.close();
  });
});

describe("socket ownership (BB-004, BB-005, BB-006)", () => {
  it("replaces the previous socket and rejects its pending call", async () => {
    const first = connect();
    await opened(first);

    const pending = callExtension({ tool: "ping" });
    await nextFrame(first);

    const second = connect();
    await opened(second);

    await expect(pending).rejects.toMatchObject({ code: "socket_closed" });
    await expect(closed(first)).resolves.toBe(1012);

    second.close();
  });

  it("keeps the new socket's call alive after the replaced socket closes", async () => {
    const first = connect();
    await opened(first);

    const second = connect();
    await opened(second);
    await closed(first);

    const pending = callExtension({ tool: "ping" });
    const frame = await nextFrame(second);

    second.send(JSON.stringify({ requestId: frame.requestId, data: "pong" }));

    await expect(pending).resolves.toBe("pong");
    second.close();
  });

  it("rejects a pending call when its own socket closes", async () => {
    const ws = connect();
    await opened(ws);

    const pending = callExtension({ tool: "ping" });
    await nextFrame(ws);

    ws.close();

    await expect(pending).rejects.toMatchObject({ code: "socket_closed" });
  });

  it("caps in-flight calls instead of growing without bound (SEC-007)", async () => {
    const ws = connect();
    await opened(ws);

    const calls: Array<Promise<unknown>> = [];
    for (let index = 0; index < 65; index++) {
      calls.push(callExtension({ tool: "ping", args: { index } }));
    }

    await expect(calls[64]).rejects.toMatchObject({ code: "too_many_requests" });

    ws.close();
    await Promise.allSettled(calls);
  });
});
