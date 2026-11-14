import { listSproutTabs, type TabInfo } from "../lib/group";

/** Lists only tabs inside the Sprout group (INV-2). */
export async function tabsContext(): Promise<TabInfo[]> {
  return listSproutTabs();
}
