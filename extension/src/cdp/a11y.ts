/**
 * Accessibility tree reader for read_page and find.
 *
 * STARTER FILE (phase 2, step 2.4). Read the CDP docs for the Accessibility
 * domain first: https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
 */

/** The subset of a CDP AXNode that Sprout uses. Check the real shape in the docs. */
export interface AxNode {
  nodeId: string;
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
  childIds?: string[];
  properties?: Array<{ name: string; value: { value?: unknown } }>;
}

/** One line of read_page output before it is rendered. */
export interface PageNode {
  depth: number;
  role: string;
  name: string;
  backendDOMNodeId: number;
  /** checked, disabled, expanded, focused... only the ones that are true. */
  states: string[];
}

export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "tab",
  "switch",
  "slider",
  "spinbutton",
]);

/** Roles kept for structure even though they are not clickable. */
export const LANDMARK_ROLES = new Set(["heading", "alert", "dialog", "main", "navigation", "form", "img"]);

/** Hard cap on nodes visited, so a 50k node page cannot stall the worker. */
export const MAX_NODES = 3000;

/**
 * TODO(2.4):
 * 1. send(tabId, "Accessibility.enable"), then "Accessibility.getFullAXTree".
 * 2. Walk from the root (the node no other node lists as a child) depth first,
 *    tracking depth, stopping at MAX_NODES.
 * 3. Keep a node when it is not ignored, has a backendDOMNodeId, and its role is
 *    interactive, or a landmark with a non-empty name.
 * 4. When `interactiveOnly`, keep only INTERACTIVE_ROLES.
 * Visibility filtering is step 2.5's job; this returns the raw filtered list.
 */
export async function readTree(tabId: number, interactiveOnly: boolean): Promise<PageNode[]> {
  throw new Error("TODO(2.4): readTree");
}
