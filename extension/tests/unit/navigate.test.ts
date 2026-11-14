import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeChrome, type FakeChrome } from "../helpers/fake-chrome";

let fake: FakeChrome;
let navigate: (args: unknown) => Promise<{ tabId: number; url: string; title: string }>;

beforeEach(async () => {
  fake = createFakeChrome();
  vi.stubGlobal("chrome", fake.chrome);
  // Modules register chrome listeners at load, so each test gets a fresh copy.
  vi.resetModules();
  ({ navigate } = await import("../../src/tools/navigate"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("navigate", () => {
  it("loads a URL in a Sprout tab through CDP", async () => {
    const tabId = await fake.addSproutTab("about:blank");

    const result = await navigate({ tabId, url: "https://example.com/" });

    expect(result).toMatchObject({ tabId, url: "https://example.com/" });
    expect(fake.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId },
      "Page.navigate",
      { url: "https://example.com/" },
    );
  });

  it("refuses a tab outside the Sprout group", async () => {
    const tab = await fake.chrome.tabs.create({ url: "https://example.com/" });

    await expect(navigate({ tabId: tab.id, url: "https://example.org/" })).rejects.toThrow(/not in the Sprout group/);
  });

  it("refuses a blocked URL before touching the tab", async () => {
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "file:///C:/Users" })).rejects.toThrow();
    expect(fake.chrome.debugger.attach).not.toHaveBeenCalled();
  });

  // BB-029: navigate is the only tool that can move a tab off a page Chrome will
  // not let the debugger attach to, so it must not refuse those tabs.
  it("BB-029: moves a tab off chrome://newtab", async () => {
    const tabId = await fake.addSproutTab("chrome://newtab/");

    const result = await navigate({ tabId, url: "https://example.com/" });

    expect(result).toMatchObject({ tabId, url: "https://example.com/" });
    // Off the restricted page with about:blank (fetches nothing), then the real
    // URL through the debugger, so the guard sees every request (SEC-067).
    expect(fake.chrome.tabs.update).toHaveBeenCalledWith(tabId, { url: "about:blank" });
    expect(fake.chrome.debugger.sendCommand).toHaveBeenCalledWith({ tabId }, "Page.navigate", {
      url: "https://example.com/",
    });
  });

  it("BB-029: still applies the URL policy on a restricted page", async () => {
    const tabId = await fake.addSproutTab("chrome://newtab/");

    await expect(navigate({ tabId, url: "http://127.0.0.1/" })).rejects.toThrow(/Blocked host/);
    expect(fake.chrome.tabs.update).not.toHaveBeenCalled();
  });

  it("BB-029: moves a tab off a chrome-error page", async () => {
    const tabId = await fake.addSproutTab("chrome-error://chromewebdata/");

    const result = await navigate({ tabId, url: "https://example.com/" });

    expect(result).toMatchObject({ tabId, url: "https://example.com/" });
  });

  // SEC-068: a URL that answers with a download is failed before any bytes land.
  it("SEC-068: blocks a download response before it starts", async () => {
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "https://example.com/setup.exe" })).rejects.toThrow(/Blocked a download/);
    expect(fake.chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId },
      "Fetch.failRequest",
      expect.objectContaining({ errorReason: "BlockedByClient" }),
    );
  });

  it("still refuses back/forward on a restricted page, with a plain error", async () => {
    const tabId = await fake.addSproutTab("chrome://newtab/");

    await expect(navigate({ tabId, url: "back" })).rejects.toThrow(/restricted page/);
  });
});
