import { send } from "../cdp/attach";
import { requireSproutTab, type TabInfo } from "../lib/group";
import { loadAfter, navigateTab } from "../lib/navigation";
import { assertPageAttachable } from "../lib/page";
import { assertUrlAllowed } from "../lib/settings";
import { isHistoryAction } from "../lib/url";
import { requireString, requireTabId } from "./args";

interface NavigationHistory {
  currentIndex: number;
  entries: Array<{ id: number; url: string; title?: string }>;
}

async function goHistory(tabId: number, direction: "back" | "forward"): Promise<TabInfo> {
  const history = await send<NavigationHistory>(tabId, "Page.getNavigationHistory");
  const index = direction === "back" ? history.currentIndex - 1 : history.currentIndex + 1;

  if (index < 0 || index >= history.entries.length) {
    throw new Error(`There is nothing to go ${direction} in tab ${tabId}.`);
  }

  const entry = history.entries[index];

  // A history entry can predate the policy (the user opened a file:// page in
  // this tab before handing it over), so check the destination, not just the name.
  await assertUrlAllowed(entry.url);

  return loadAfter(tabId, async () => {
    await send(tabId, "Page.navigateToHistoryEntry", { entryId: entry.id });
  });
}

/** `navigate {tabId, url}` where url is a URL or "back" / "forward". */
export async function navigate(args: unknown): Promise<TabInfo> {
  const tabId = requireTabId(args);
  const target = requireString(args, "url");

  const tab = await requireSproutTab(tabId);

  if (isHistoryAction(target)) {
    // History needs the debugger, so a restricted page cannot go back or forward.
    assertPageAttachable(tab);
    return goHistory(tabId, target);
  }

  const url = (await assertUrlAllowed(target)).href;

  // navigate is the only way off a restricted page, so it must not refuse one (BB-029).
  return navigateTab(tab, tabId, url);
}
