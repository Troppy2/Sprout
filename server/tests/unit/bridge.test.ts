import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  BridgeError,
  callExtension,
  isExtensionOrigin,
  loadOrCreateToken,
  resolvePort,
  rotateToken,
  SPROUT_EXTENSION_ID,
  tokensMatch,
  tokenFromProtocols,
  tokenFilePath,
  handleMessage,
} from "../../src/bridge.js";

// Layer 1: pure bridge logic, no socket server started.

const dirs: string[] = [];

function tempTokenFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sprout-unit-"));
  dirs.push(dir);
  return path.join(dir, "token");
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  delete process.env.SPROUT_TOKEN_FILE;
});

describe("bridge errors", () => {
  it("rejects calls when no extension is connected", async () => {
    await expect(callExtension({ tool: "ping", args: {} })).rejects.toThrow(
      "Sprout extension not connected",
    );
  });

  it("uses a typed code instead of matching on the message text (BB-011)", async () => {
    await expect(callExtension({ tool: "ping" })).rejects.toMatchObject({
      name: "BridgeError",
      code: "extension_not_connected",
    });
  });

  it("ignores malformed and unknown messages without throwing (BB-014)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fakeSocket = {} as never;

    expect(() => handleMessage(fakeSocket, "not json")).not.toThrow();
    expect(() => handleMessage(fakeSocket, "null")).not.toThrow();
    expect(() => handleMessage(fakeSocket, JSON.stringify({ requestId: "999", data: 1 }))).not.toThrow();

    spy.mockRestore();
  });
});

describe("pairing token (SEC-001, SEC-004, BB-015)", () => {
  it("creates a token once and reuses the same value", () => {
    process.env.SPROUT_TOKEN_FILE = tempTokenFile();

    const first = loadOrCreateToken();
    const second = loadOrCreateToken();

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.token).toBe(first.token);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("trims a hand-edited token file so a trailing newline cannot break pairing", () => {
    const file = tempTokenFile();
    writeFileSync(file, "abcdef0123456789\n", "utf-8");
    process.env.SPROUT_TOKEN_FILE = file;

    expect(loadOrCreateToken().token).toBe("abcdef0123456789");
  });

  it("regenerates an empty token file instead of pairing with an empty secret", () => {
    const file = tempTokenFile();
    writeFileSync(file, "   \n", "utf-8");
    process.env.SPROUT_TOKEN_FILE = file;

    const state = loadOrCreateToken();
    expect(state.created).toBe(true);
    expect(state.token.length).toBe(64);
    expect(readFileSync(file, "utf-8")).toBe(state.token);
  });

  it("resolves the token path from SPROUT_TOKEN_FILE", () => {
    const file = tempTokenFile();
    process.env.SPROUT_TOKEN_FILE = file;
    expect(tokenFilePath()).toBe(path.resolve(file));
  });

  it("compares tokens in constant time and rejects empty or wrong values", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "")).toBe(false);
    expect(tokensMatch("", "")).toBe(true);
    expect(tokensMatch("abc", "abc ")).toBe(false);
  });

  it("SEC-006: reads the token from the WebSocket subprotocol header, not the URL", () => {
    expect(tokenFromProtocols("sprout.v1, sprout.token.abc123")).toBe("abc123");
    expect(tokenFromProtocols(["sprout.v1", "sprout.token.abc123"])).toBe("abc123");
    expect(tokenFromProtocols("sprout.v1")).toBeNull();
    expect(tokenFromProtocols("sprout.token.")).toBeNull();
    expect(tokenFromProtocols(undefined)).toBeNull();
  });

  it("SEC-004: rotates the token in place and keeps the file private", () => {
    const file = tempTokenFile();
    process.env.SPROUT_TOKEN_FILE = file;

    const before = loadOrCreateToken().token;
    const after = rotateToken();

    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
    expect(readFileSync(file, "utf-8")).toBe(after);
    expect(loadOrCreateToken()).toEqual({ token: after, created: false });
  });
});

describe("origin check (SEC-002, SEC-005)", () => {
  it("SEC-005: accepts only the pinned Sprout extension id", () => {
    expect(SPROUT_EXTENSION_ID).toMatch(/^[a-p]{32}$/);
    expect(isExtensionOrigin(`chrome-extension://${SPROUT_EXTENSION_ID}`)).toBe(true);
    // A well-formed id that is not Sprout's: another installed extension.
    expect(isExtensionOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop")).toBe(false);
  });

  it("SEC-005: the pinned id is the one Chrome derives from extension/manifest.json's key", () => {
    // Chrome: sha256 of the DER public key, first 32 hex digits, 0-f mapped to a-p.
    const manifest = JSON.parse(readFileSync(path.resolve("../extension/manifest.json"), "utf-8")) as { key: string };
    const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex");
    const derived = [...digest.slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");

    expect(derived).toBe(SPROUT_EXTENSION_ID);
  });

  it("rejects web pages, missing origins, and lookalikes", () => {
    expect(isExtensionOrigin("https://evil.test")).toBe(false);
    expect(isExtensionOrigin("http://127.0.0.1:17373")).toBe(false);
    expect(isExtensionOrigin(undefined)).toBe(false);
    expect(isExtensionOrigin("chrome-extension://short")).toBe(false);
    expect(isExtensionOrigin(`chrome-extension://${SPROUT_EXTENSION_ID}.evil.test`)).toBe(false);
    expect(isExtensionOrigin(`chrome-extension://${SPROUT_EXTENSION_ID}/`)).toBe(false);
  });
});

describe("port parsing (BB-012)", () => {
  it("defaults to 17373", () => {
    expect(resolvePort(undefined)).toBe(17373);
    expect(resolvePort("")).toBe(17373);
    expect(resolvePort("   ")).toBe(17373);
  });

  it("accepts a valid port", () => {
    expect(resolvePort("18000")).toBe(18000);
  });

  it("rejects NaN and out-of-range ports with a typed error", () => {
    expect(() => resolvePort("abc")).toThrow(BridgeError);
    expect(() => resolvePort("0")).toThrow(/between 1 and 65535/);
    expect(() => resolvePort("99999")).toThrow(/between 1 and 65535/);
    expect(() => resolvePort("12.5")).toThrow(/between 1 and 65535/);
  });
});

