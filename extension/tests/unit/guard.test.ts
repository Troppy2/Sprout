import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeChrome } from "../helpers/fake-chrome";
import { freshChrome } from "../helpers/setup";

// The guard (cdp/guard.ts): what an attached Sprout tab may load. These drive
// real tool calls through the fake Chrome, which pauses each request and
// response the way CDP Fetch does.

let fake: FakeChrome;
let navigate: typeof import("../../src/tools/navigate").navigate;
let tabsCreate: typeof import("../../src/tools/tabs_create").tabsCreate;
let computer: typeof import("../../src/tools/computer").computer;

beforeEach(async () => {
  fake = freshChrome();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  ({ navigate } = await import("../../src/tools/navigate"));
  ({ tabsCreate } = await import("../../src/tools/tabs_create"));
  ({ computer } = await import("../../src/tools/computer"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const failedRequests = (tabId: number) =>
  fake.chrome.debugger.sendCommand.mock.calls.filter(
    ([source, method]) => source.tabId === tabId && method === "Fetch.failRequest",
  );

describe("redirects and iframes (SEC-067)", () => {
  it("never sends a redirect hop to a private address", async () => {
    fake.net.redirects.set("https://evil.example/", "http://169.254.169.254/latest/meta-data/");
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "https://evil.example/" })).rejects.toThrow(
      /Blocked a load of http:\/\/169\.254\.169\.254/,
    );
    expect(fake.net.sent).toEqual(["https://evil.example/"]);
  });

  it("checks every hop of a redirect chain", async () => {
    fake.net.redirects.set("https://a.example/", "https://b.example/");
    fake.net.redirects.set("https://b.example/", "http://router/");
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "https://a.example/" })).rejects.toThrow(/Blocked a load of http:\/\/router/);
    expect(fake.net.sent).toEqual(["https://a.example/", "https://b.example/"]);
  });

  it("follows a redirect between public pages", async () => {
    fake.net.redirects.set("https://old.example/", "https://new.example/");
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "https://old.example/" })).resolves.toMatchObject({
      url: "https://new.example/",
    });
  });

  it("fails an iframe document request to a private address", async () => {
    const tabId = await fake.addSproutTab("about:blank");
    await navigate({ tabId, url: "https://example.com/" });

    // A page's own iframe: the guard sees it as one more paused Document request.
    fake.chrome.debugger.onEvent.emit({ tabId }, "Fetch.requestPaused", {
      requestId: "iframe-1",
      request: { url: "http://192.168.1.1/admin" },
      resourceType: "Document",
      frameId: "child",
    });

    await vi.waitFor(() => expect(failedRequests(tabId)).toHaveLength(1));
  });

  it("tabs_create loads its URL under the guard, not before it", async () => {
    fake.net.redirects.set("https://evil.example/", "http://127.0.0.1:8080/");

    await expect(tabsCreate({ url: "https://evil.example/" })).rejects.toThrow(/Blocked a load of http:\/\/127\.0\.0\.1/);
    expect(fake.net.sent).toEqual(["https://evil.example/"]);
    expect(fake.chrome.tabs.create).toHaveBeenCalledWith({ url: "about:blank", active: true });
  });
});

describe("names that resolve to private addresses (SEC-066)", () => {
  it("bounces a page served from a private IP to about:blank", async () => {
    fake.net.dns.set("localtest.me", "127.0.0.1");
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "http://localtest.me/" })).rejects.toThrow(/private address 127\.0\.0\.1/);
    expect(fake.tabs.get(tabId)?.url).toBe("about:blank");
  });

  it("allows it when the user opted in for local fixtures", async () => {
    await fake.chrome.storage.local.set({ allowPrivateHosts: true });
    fake.net.dns.set("localtest.me", "127.0.0.1");
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "http://localtest.me/" })).resolves.toMatchObject({
      url: "http://localtest.me/",
    });
  });
});

describe("download responses (SEC-068, layer 1)", () => {
  it("fails a page that answers with Content-Disposition: attachment", async () => {
    fake.net.responses.set("https://example.com/report", [
      { name: "Content-Type", value: "text/html" },
      { name: "Content-Disposition", value: 'attachment; filename="report.html"' },
    ]);
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "https://example.com/report" })).rejects.toThrow(/Blocked a download/);
  });

  it("lets renderable documents through", async () => {
    fake.net.responses.set("https://example.com/doc.pdf", [{ name: "Content-Type", value: "application/pdf" }]);
    const tabId = await fake.addSproutTab("about:blank");

    await expect(navigate({ tabId, url: "https://example.com/doc.pdf" })).resolves.toMatchObject({
      url: "https://example.com/doc.pdf",
    });
  });
});

describe("recheck on return", () => {
  /** What happens when the debugger idles out: Chrome ends the session. */
  async function idleDetach(tabId: number): Promise<void> {
    await fake.chrome.debugger.detach({ tabId });
    fake.chrome.debugger.onDetach.emit({ tabId }, "target_closed");
  }

  it("reloads a tab that moved to another origin while unwatched, under the guard", async () => {
    fake.net.dns.set("localtest.me", "127.0.0.1");
    const tabId = await fake.addSproutTab("about:blank");
    await navigate({ tabId, url: "https://example.com/" });

    await idleDetach(tabId);
    fake.moveTabSilently(tabId, "http://localtest.me/");

    await expect(computer({ tabId, action: "screenshot" })).rejects.toThrow(/private address 127\.0\.0\.1/);
    expect(fake.chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId },
      "Page.captureScreenshot",
      expect.anything(),
    );
  });

  it("does not reload a page that only changed path on the same origin", async () => {
    const tabId = await fake.addSproutTab("about:blank");
    await navigate({ tabId, url: "https://example.com/" });

    await idleDetach(tabId);
    fake.moveTabSilently(tabId, "https://example.com/inbox/42");
    fake.chrome.debugger.sendCommand.mockClear();

    await computer({ tabId, action: "screenshot" });
    expect(fake.chrome.debugger.sendCommand).not.toHaveBeenCalledWith({ tabId }, "Page.navigate", expect.anything());
  });
});
