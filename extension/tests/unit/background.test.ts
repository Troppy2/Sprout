import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeChrome } from "../helpers/fake-chrome";
import { freshChrome } from "../helpers/setup";

/** Records every socket the worker opens. Nothing connects anywhere. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[] = [],
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(): void {}

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000 });
  }
}

let fake: FakeChrome;

beforeEach(() => {
  fake = freshChrome();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => vi.unstubAllGlobals());

function popupMessage(message: unknown): Promise<unknown> {
  const [listener] = fake.chrome.runtime.onMessage.listeners;
  return new Promise((resolve) => {
    listener(message, { id: fake.chrome.runtime.id }, resolve);
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("worker connection", () => {
  it("connects with the saved token", async () => {
    await fake.chrome.storage.local.set({ token: "abc" });

    await import("../../src/background");
    await tick();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].protocols).toEqual(["sprout.v1", "sprout.token.abc"]);
  });

  it("SEC-006: never puts the token in the URL", async () => {
    await fake.chrome.storage.local.set({ token: "abc" });

    await import("../../src/background");
    await tick();

    expect(FakeWebSocket.instances[0].url).toBe("ws://127.0.0.1:17373/");
  });

  it("refuses a pasted token that could not be a real one, instead of throwing", async () => {
    await fake.chrome.storage.local.set({ token: "not a token, has spaces" });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("../../src/background");
    await tick();

    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  // BB-033: saving a token while the worker's first connect was still in
  // flight returned early, and the in-flight connect used the old token.
  it("BB-033: a reconnect during an in-flight connect uses the new token", async () => {
    // Hold the first connect's storage read open: it already read the old token
    // but has not opened its socket yet.
    let releaseFirstRead: () => void = () => {};
    fake.chrome.storage.local.get.mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirstRead = () => resolve({ token: "old-token" }))),
    );
    await import("../../src/background"); // the top-level connect() is now in flight

    await fake.chrome.storage.local.set({ token: "new-token" });
    const reply = popupMessage({ type: "sprout-reconnect" });
    releaseFirstRead();
    await reply;
    await tick();

    const live = FakeWebSocket.instances.filter((ws) => ws.readyState !== FakeWebSocket.CLOSED);
    expect(live).toHaveLength(1);
    expect(live[0].protocols).toContain("sprout.token.new-token");
  });
});
