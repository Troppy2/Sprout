/**
 * Loading pages under the guard (cdp/guard.ts). Every agent navigation goes
 * through `loadAfter`, so every request it causes is checked before it is sent.
 */
import { send, waitForEvent } from "../cdp/attach";
import { clearBlock, guardSettled, isVerified, setVerifiedOrigin, takeBlock } from "../cdp/guard";
import { requireSproutTab, type TabInfo } from "./group";
import { restrictedPageReason } from "./page";
import { assertUrlAllowed } from "./settings";

const LOAD_TIMEOUT_MS = 30_000;
const LOAD_EVENTS = ["Page.loadEventFired", "Page.navigatedWithinDocument"];

/** Throws the reason if the guard stopped something in this tab. */
async function assertNotBlocked(tabId: number): Promise<void> {
  await guardSettled(tabId);
  const reason = takeBlock(tabId);
  if (reason) throw new Error(reason);
}

/**
 * Reads the tab back after a load. Re-checks the guard, the group (the user can
 * drag the tab out while it loads, SEC-030) and the URL policy.
 */
export async function settle(tabId: number): Promise<TabInfo> {
  await assertNotBlocked(tabId);

  const tab = await requireSproutTab(tabId);
  if (tab.url) await assertUrlAllowed(tab.url);
  if (tab.url) await setVerifiedOrigin(tabId, tab.url);

  return { tabId, url: tab.url ?? "", title: tab.title ?? "" };
}

/** Runs `trigger` and waits for the page load it causes, then reads the tab back. */
export async function loadAfter(tabId: number, trigger: () => Promise<void>): Promise<TabInfo> {
  // Attaching turns the guard on. Page events only arrive after Page.enable.
  await send(tabId, "Page.enable");
  clearBlock(tabId);
  const waiter = waitForEvent(tabId, LOAD_EVENTS, LOAD_TIMEOUT_MS);

  try {
    await trigger();
    await waiter.promise;
  } catch (error) {
    // A guard refusal explains a failed load better than Chrome's error code.
    await assertNotBlocked(tabId);
    throw error;
  } finally {
    waiter.cancel();
  }

  return settle(tabId);
}

/** Navigates an attached tab to a URL that has already passed the policy. */
export function loadUrl(tabId: number, url: string): Promise<TabInfo> {
  return loadAfter(tabId, async () => {
    const response = await send<{ errorText?: string; isDownload?: boolean }>(tabId, "Page.navigate", { url });

    if (response?.isDownload) {
      // The guard fails download responses it can see; anything that still
      // starts is cancelled by the downloads hold (lib/downloads.ts).
      throw new Error("That URL started a download, not a page. Sprout cancels downloads from its tabs.");
    }
    if (response?.errorText) {
      throw new Error(`Chrome refused the navigation: ${response.errorText}`);
    }
  });
}

/**
 * Moves a tab off a page the debugger cannot attach to (new tab page, error
 * pages, BB-029) by loading about:blank without the debugger. about:blank
 * fetches nothing, so nothing passes unguarded.
 */
function blankWithTabsApi(tabId: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // "complete" only counts after a "loading" for this navigation, so the
    // restricted page that was already loaded cannot resolve it early.
    let sawLoading = false;

    const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
      if (id !== tabId) return;
      if (info.status === "loading") sawLoading = true;
      if (info.status === "complete" && sawLoading) {
        finish();
        resolve();
      }
    };

    const onRemoved = (id: number) => {
      if (id !== tabId) return;
      finish();
      reject(new Error(`Tab ${tabId} was closed while loading.`));
    };

    const timer = setTimeout(() => {
      finish();
      reject(new Error(`Timed out after ${Math.round(LOAD_TIMEOUT_MS / 1000)}s waiting for tab ${tabId} to load.`));
    }, LOAD_TIMEOUT_MS);

    const finish = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.update(tabId, { url: "about:blank" }).catch((error: unknown) => {
      finish();
      reject(error);
    });
  });
}

/** Navigates any Sprout tab, including one on a restricted page, under the guard. */
export async function navigateTab(tab: chrome.tabs.Tab, tabId: number, url: string): Promise<TabInfo> {
  if (restrictedPageReason(tab)) await blankWithTabsApi(tabId);
  return loadUrl(tabId, url);
}

/**
 * Recheck on return (decisions 2026-10-30). The debugger detaches after a minute
 * idle, and a page can move itself meanwhile. If the tab is no longer on an
 * origin the guard watched it load, load it again under the guard (a GET, not
 * a reload, so no form is resubmitted) before a tool acts on it.
 */
export async function ensureVerified(tabId: number, url: string): Promise<void> {
  // Attach first: the guard may already have stopped something since.
  await send(tabId, "Page.enable");
  await assertNotBlocked(tabId);

  if (await isVerified(tabId, url)) return;
  await loadUrl(tabId, url);
}
