/**
 * ref_N <-> backendDOMNodeId, per tab. Refs die on navigation (rules-gotchas).
 *
 * Decision for you to make in step 2.6 and write in the feature doc: keep the
 * map in memory (simple, lost when the worker sleeps, the model just calls
 * read_page again) or in chrome.storage.session (survives sleep, more code).
 * Recommended: memory, with a clear "ref expired, call read_page again" error.
 *
 * STARTER FILE (phase 2, step 2.6).
 */

export class RefNotFoundError extends Error {
  readonly code = "ref_not_found";
  constructor(ref: string) {
    super(`${ref} is not a current ref for this tab (the page may have changed). Call read_page or find again.`);
  }
}

/** TODO(2.6): return the existing ref for this node, or mint ref_<n+1>. */
export function refFor(tabId: number, backendDOMNodeId: number): string {
  throw new Error("TODO(2.6): refFor");
}

/** TODO(2.6): the node id, or throw RefNotFoundError. Never guess a nearby ref. */
export function resolveRef(tabId: number, ref: string): number {
  throw new Error("TODO(2.6): resolveRef");
}

/** TODO(2.6): drop every ref for the tab and reset its counter. */
export function clearRefs(tabId: number): void {
  throw new Error("TODO(2.6): clearRefs");
}

// TODO(2.6): top-level listeners (a sleeping worker must wake for them):
//   chrome.debugger.onEvent: "Page.frameNavigated" with no frame.parentId -> clearRefs(tabId)
//   chrome.tabs.onRemoved -> clearRefs(tabId)
