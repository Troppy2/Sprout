import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeChrome } from "../helpers/fake-chrome";
import { freshChrome } from "../helpers/setup";

// The downloads hold (lib/downloads.ts): the layer that catches downloads a
// page starts by script, which never look like a navigation (SEC-068).

let fake: FakeChrome;

beforeEach(async () => {
  fake = freshChrome();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await import("../../src/lib/downloads");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function item(overrides: Partial<chrome.downloads.DownloadItem>): chrome.downloads.DownloadItem {
  return {
    id: 1,
    url: "https://example.com/file.zip",
    finalUrl: "",
    referrer: "",
    ...overrides,
  } as chrome.downloads.DownloadItem;
}

/** Fires onDeterminingFilename like Chrome and resolves once the listener calls suggest(). */
function determine(download: chrome.downloads.DownloadItem): Promise<void> {
  const [listener] = fake.chrome.downloads.onDeterminingFilename.listeners;
  return new Promise((resolve) => {
    listener(download, () => resolve());
  });
}

describe("downloads hold", () => {
  it("cancels a script download an attached Sprout tab announced (blob URL, no referrer)", async () => {
    const tabId = await fake.addSproutTab("https://evil.example/page");
    fake.chrome.debugger.onEvent.emit({ tabId }, "Page.downloadWillBegin", {
      url: "blob:https://evil.example/5f2c",
      guid: "g1",
      frameId: "main",
    });

    await determine(item({ id: 7, url: "blob:https://evil.example/5f2c" }));

    expect(fake.chrome.downloads.cancel).toHaveBeenCalledWith(7);
  });

  it("cancels a download whose referrer is a Sprout tab's page, even while detached", async () => {
    await fake.addSproutTab("https://evil.example/page");

    await determine(item({ id: 8, url: "https://cdn.example/setup.exe", referrer: "https://evil.example/page#top" }));

    expect(fake.chrome.downloads.cancel).toHaveBeenCalledWith(8);
  });

  it("leaves the user's own downloads alone", async () => {
    await fake.addSproutTab("https://evil.example/page");

    await determine(item({ id: 9, url: "https://example.com/taxes.pdf", referrer: "https://bank.example/statements" }));

    expect(fake.chrome.downloads.cancel).not.toHaveBeenCalled();
  });

  it("always releases Chrome's hold, even when the check fails", async () => {
    fake.chrome.tabs.query.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(determine(item({ id: 10, referrer: "https://anything.example/" }))).resolves.toBeUndefined();
  });

  it("cancels from onCreated too, for downloads that skip filename selection", async () => {
    await fake.addSproutTab("https://evil.example/page");
    const [listener] = fake.chrome.downloads.onCreated.listeners;

    listener(item({ id: 11, referrer: "https://evil.example/page" }));

    await vi.waitFor(() => expect(fake.chrome.downloads.cancel).toHaveBeenCalledWith(11));
  });
});
