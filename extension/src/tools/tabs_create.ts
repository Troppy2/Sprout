import { setVerifiedOrigin } from "../cdp/guard";
import { addTabToSproutGroup } from "../lib/group";
import { loadUrl } from "../lib/navigation";
import { assertUrlAllowed } from "../lib/settings";
import { optionalString } from "./args";

/**
 * Opens a tab in the green Sprout group. The tab always starts on about:blank
 * and the URL is loaded afterwards under the guard, so a redirect or a private
 * address is caught before the request goes out (SEC-067), not after.
 */
export async function tabsCreate(args: unknown): Promise<{ tabId: number; url: string; groupId: number }> {
  const requested = optionalString(args, "url") ?? "about:blank";
  const url = (await assertUrlAllowed(requested)).href;

  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  if (typeof tab.id !== "number") {
    throw new Error("Chrome did not return an id for the new tab.");
  }
  const tabId = tab.id;

  let groupId: number;
  try {
    groupId = await addTabToSproutGroup(tabId);
  } catch (error) {
    // Do not leave an ungrouped tab behind: the agent can never touch it again.
    await chrome.tabs.remove(tabId).catch(() => {});
    throw error;
  }

  if (url === "about:blank") {
    await setVerifiedOrigin(tabId, url);
    return { tabId, url, groupId };
  }

  try {
    const loaded = await loadUrl(tabId, url);
    return { tabId, url: loaded.url, groupId };
  } catch (error) {
    // The tab stays (it is in the group and harmless); say which one it is.
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Opened tab ${tabId} in the Sprout group, but loading ${url} failed: ${reason}`);
  }
}
