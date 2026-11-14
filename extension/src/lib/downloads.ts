/**
 * The downloads hold, the second layer of SEC-068 (decisions 2026-10-30).
 *
 * The guard (cdp/guard.ts) fails download responses to navigations. A page can
 * still start a download by script (`<a download>`, a blob: URL), which never
 * looks like a navigation. Every download passes through
 * `onDeterminingFilename` before Chrome moves the file into place; Sprout holds
 * it there and cancels it if it came from a Sprout tab. Chrome then deletes the
 * temporary file. Other downloads are released untouched.
 *
 * A download item does not name its tab, so it is tied to one by:
 *   1. `Page.downloadWillBegin` from an attached Sprout tab (any download kind), or
 *   2. its referrer being the page a Sprout tab is on (covers detached tabs).
 * Known gap: a download with neither, from a detached Sprout tab, gets through.
 */
import { tabThatAnnounced } from "../cdp/guard";
import { listSproutTabs } from "./group";

function withoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}

/** The Sprout tab a download came from, or undefined if it is the user's. */
export async function sproutTabForDownload(item: chrome.downloads.DownloadItem): Promise<number | undefined> {
  const announced = tabThatAnnounced(item.url) ?? (item.finalUrl ? tabThatAnnounced(item.finalUrl) : undefined);
  if (announced !== undefined) return announced;

  if (!item.referrer) return undefined;
  const referrer = withoutFragment(item.referrer);
  const tabs = await listSproutTabs();
  return tabs.find((tab) => tab.url !== "" && withoutFragment(tab.url) === referrer)?.tabId;
}

const cancelled = new Set<number>();

async function cancelIfSprout(item: chrome.downloads.DownloadItem): Promise<boolean> {
  if (cancelled.has(item.id)) return true;

  const tabId = await sproutTabForDownload(item);
  if (tabId === undefined) return false;

  cancelled.add(item.id);
  console.warn(`sprout: cancelled a download from Sprout tab ${tabId}: ${item.url}`);
  await chrome.downloads.cancel(item.id).catch(() => {});
  return true;
}

// Top level: a sleeping worker must wake for these.

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // Chrome waits for suggest() before the file is moved into place, so the
  // decision happens while only a temporary file exists.
  void cancelIfSprout(item)
    .catch((error: unknown) => console.error("sprout: download check failed", error))
    .finally(() => suggest());
  return true;
});

// Backup for downloads that skip filename determination. This one races the
// first bytes, which is why it is not the primary layer.
chrome.downloads.onCreated.addListener((item) => {
  void cancelIfSprout(item).catch((error: unknown) => console.error("sprout: download check failed", error));
});
