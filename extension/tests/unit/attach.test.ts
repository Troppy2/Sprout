import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeChrome } from "../helpers/fake-chrome";
import { freshChrome } from "../helpers/setup";

let fake: FakeChrome;
let send: typeof import("../../src/cdp/attach").send;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  fake = freshChrome();
  ({ send } = await import("../../src/cdp/attach"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Turns the outcome into a string right away, so a rejection is never unhandled. */
function outcomeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "resolved",
    (error: Error) => `rejected: ${error.message}`,
  );
}

/** An outcome that already settled wins the race; otherwise "still pending". */
function settledOrPending(outcome: Promise<string>): Promise<string> {
  return Promise.race([outcome, Promise.resolve("still pending")]);
}

describe("send", () => {
  it("runs a CDP command on an attached tab", async () => {
    const tabId = await fake.addSproutTab("https://example.com/");

    await expect(send(tabId, "Page.enable")).resolves.toEqual({});
    expect(fake.attached.has(tabId)).toBe(true);
  });

  // BB-031: a command Chrome never answers (screenshot of a hidden tab) left
  // the tool call hanging until the server gave up, and the handler leaked.
  it("BB-031: gives up on a CDP command that never answers", async () => {
    const tabId = await fake.addSproutTab("https://example.com/");
    fake.hang.add("Page.captureScreenshot");

    const pending = outcomeOf(send(tabId, "Page.captureScreenshot"));
    await vi.advanceTimersByTimeAsync(25_000);

    expect(await settledOrPending(pending)).toMatch(/rejected: .*timed out/i);
  });
});
