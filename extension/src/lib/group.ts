/**
 * The Sprout tab group is the agent's whole world (INV-2, SEC-030).
 *
 * `chrome.tabGroups` has no create method: a group is born when tabs are
 * grouped and dies with its last tab. So the group is discovered lazily, always
 * from a real tab, and the stored id is treated as a hint that may be stale.
 */

const GROUP_TITLE = "Sprout";
const GROUP_COLOR = "green";
const GROUP_STORAGE_KEY = "groupId";

async function storedGroupId(): Promise<number | undefined> {
  const stored = await chrome.storage.session.get(GROUP_STORAGE_KEY);
  const id = stored[GROUP_STORAGE_KEY];
  return typeof id === "number" ? id : undefined;
}

/** The saved group id, but only if that group still exists. */
export async function getSproutGroupId(): Promise<number | undefined> {
  const id = await storedGroupId();

  if (id !== undefined) {
    try {
      await chrome.tabGroups.get(id);
      return id;
    } catch {
      await chrome.storage.session.remove(GROUP_STORAGE_KEY);
    }
  }

  // chrome.storage.session is cleared on extension reload and browser restart,
  // but the group itself survives. Find it again by title before making a new one.
  const found = await findGroupByTitle();
  if (found !== undefined) {
    await chrome.storage.session.set({ [GROUP_STORAGE_KEY]: found });
  }
  return found;
}

async function findGroupByTitle(): Promise<number | undefined> {
  try {
    const groups = await chrome.tabGroups.query({ title: GROUP_TITLE });
    // The green colour is the user's trust signal; a same-named other-coloured
    // group is not ours (SEC-030).
    return groups.find((group) => group.color === GROUP_COLOR)?.id;
  } catch {
    return undefined;
  }
}

/**
 * Group changes run one at a time. MCP clients make parallel calls, and two
 * creates that both saw "no group" each made one (BB-032).
 */
let groupQueue: Promise<unknown> = Promise.resolve();

/**
 * Adds a tab to the saved Sprout group, or creates the group and titles it.
 * Returns the group id. Never creates an empty group, Chrome would reject it.
 */
export function addTabToSproutGroup(tabId: number): Promise<number> {
  const run = groupQueue.then(() => groupTab(tabId));
  // The queue must keep going after a failure; the caller still sees the error.
  groupQueue = run.catch(() => {});
  return run;
}

async function groupTab(tabId: number): Promise<number> {
  const existing = await getSproutGroupId();

  if (existing !== undefined) {
    try {
      return await chrome.tabs.group({ tabIds: [tabId], groupId: existing });
    } catch {
      // The group disappeared between the check and the grouping call.
      await chrome.storage.session.remove(GROUP_STORAGE_KEY);
    }
  }

  const groupId = await chrome.tabs.group({ tabIds: [tabId] });
  await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: GROUP_COLOR });
  await chrome.storage.session.set({ [GROUP_STORAGE_KEY]: groupId });
  return groupId;
}

/**
 * Resolves a model-supplied tab id against the live tab and the stored group.
 * A number from the model is never trusted on its own (SEC-030).
 */
export async function requireSproutTab(tabId: number): Promise<chrome.tabs.Tab> {
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error(`Invalid tabId "${String(tabId)}". Call tabs_context for current tabs.`);
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(`No tab with id ${tabId}. Call tabs_context for current tabs.`);
  }

  const groupId = await getSproutGroupId();
  if (groupId === undefined || tab.groupId !== groupId) {
    throw new Error(
      `Refused: tab ${tabId} is not in the Sprout group. Open a tab with tabs_create, or ask the user to hand that tab over.`,
    );
  }

  return tab;
}

export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
}

/** Tabs the agent may touch, in the saved group only. */
export async function listSproutTabs(): Promise<TabInfo[]> {
  const groupId = await getSproutGroupId();
  if (groupId === undefined) return [];

  const tabs = await chrome.tabs.query({ groupId });
  return tabs
    .filter((tab) => typeof tab.id === "number")
    .map((tab) => ({
      tabId: tab.id as number,
      url: tab.url ?? "",
      title: tab.title ?? "",
    }));
}
