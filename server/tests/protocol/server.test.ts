import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import { SPROUT_EXTENSION_ID } from "../../src/bridge.js";

// Layer 2: launch the built server like a real MCP client would, over stdio.
// Requires `npm run build` first (the test:protocol script does it).
const PORT = String(20000 + Math.floor(Math.random() * 10000));
const EXT_ORIGIN = `chrome-extension://${SPROUT_EXTENSION_ID}`;

let client: Client;
let dir = "";
let tokenFile = "";
let token = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "sprout-protocol-"));
  tokenFile = path.join(dir, "token");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, SPROUT_PORT: PORT, SPROUT_TOKEN_FILE: tokenFile } as Record<string, string>,
    stderr: "ignore",
  });
  client = new Client({ name: "sprout-test", version: "0.0.0" });
  await client.connect(transport);

  token = readFileSync(tokenFile, "utf-8").trim();
});

afterAll(async () => {
  await client?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Opens a bridge socket the way the extension does: token as a subprotocol (SEC-006). */
function wsOutcome(presentedToken: string | undefined, origin?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const protocols = presentedToken === undefined ? ["sprout.v1"] : ["sprout.v1", `sprout.token.${presentedToken}`];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, protocols, origin ? { origin } : {});
    ws.on("open", () => {
      ws.close();
      resolve(true);
    });
    ws.on("error", () => resolve(false));
    ws.on("unexpected-response", () => resolve(false));
  });
}

describe("mcp server", () => {
  it("sends instructions in the handshake", () => {
    expect(client.getInstructions()).toContain("Sprout");
  });

  it("lists the phase 1 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    for (const expected of ["ping", "tabs_context", "tabs_create", "navigate", "computer"]) {
      expect(names).toContain(expected);
    }
  });

  it("ping returns a friendly error when the extension is not connected", async () => {
    const result = await client.callTool({ name: "ping", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("not connected");
  });

  it("tabs_context fails fast instead of hanging when nothing is connected", async () => {
    const result = await client.callTool({ name: "tabs_context", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("not connected");
  });
});

describe("input validation reaches the model as a clear error (SEC-031)", () => {
  it("rejects a file:// navigation", async () => {
    const result = await client.callTool({
      name: "navigate",
      arguments: { tabId: 0, url: "file:///C:/Windows/win.ini" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Blocked URL");
  });

  it("rejects a javascript: tab", async () => {
    const result = await client.callTool({
      name: "tabs_create",
      arguments: { url: "javascript:alert(1)" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Blocked URL");
  });

  it("rejects a computer action that does not exist yet", async () => {
    const result = await client.callTool({
      name: "computer",
      arguments: { tabId: 0, action: "left_click" },
    });

    expect(result.isError).toBe(true);
  });

  it("rejects a private or loopback destination (SEC-031)", async () => {
    for (const url of ["http://127.0.0.1:8787", "http://192.168.1.1", "http://169.254.169.254/latest/meta-data"]) {
      const result = await client.callTool({ name: "navigate", arguments: { tabId: 0, url } });
      expect(result.isError, url).toBe(true);
      expect(JSON.stringify(result.content), url).toContain("Blocked host");
    }
  });
});

// Security regressions. These were `it.fails` while SEC-001 and SEC-002 were
// open; they are permanent tests now that the bridge authenticates connections.
describe("bridge security (INV-1)", () => {
  it("SEC-002: rejects a web page Origin", async () => {
    expect(await wsOutcome(token, "https://evil.test")).toBe(false);
  });

  it("SEC-001: rejects a connection without the pairing token", async () => {
    expect(await wsOutcome(undefined, EXT_ORIGIN)).toBe(false);
  });

  it("SEC-001: rejects a wrong pairing token", async () => {
    expect(await wsOutcome("wrong-token", EXT_ORIGIN)).toBe(false);
  });

  it("accepts the pairing token plus an extension Origin", async () => {
    expect(await wsOutcome(token, EXT_ORIGIN)).toBe(true);
  });
});
