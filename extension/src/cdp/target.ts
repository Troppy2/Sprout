/**
 * Ref -> the point to click, verified. Never click blindly: if something covers
 * the target (modal, cookie banner, clickjacking overlay), refuse and name it.
 *
 * STARTER FILE (phase 3, step 3.2).
 */
import type { Point } from "./coords";

export interface TargetInfo {
  point: Point;
  backendDOMNodeId: number;
  /** Lowercase tag, input type and autocomplete, for the sensitive-field and submit checks. */
  tag: string;
  inputType?: string;
  autocomplete?: string;
  /** Visible text or value of a button, for the submit classifier. */
  label: string;
}

/**
 * TODO(3.2):
 * 1. resolveRef (cdp/refs.ts) -> backendDOMNodeId.
 * 2. DOM.scrollIntoViewIfNeeded, then DOM.getBoxModel -> center of the content quad.
 * 3. DOM.getNodeForLocation at that point. The hit node must be the target or a
 *    descendant (DOM.describeNode walks up). Otherwise throw "covered by <tag>".
 * 4. Fill tag / inputType / autocomplete / label with DOM.describeNode attributes.
 */
export async function targetForRef(tabId: number, ref: string): Promise<TargetInfo> {
  throw new Error("TODO(3.2): targetForRef");
}

/** TODO(3.2): same checks for a raw coordinate click (DOM.getNodeForLocation first). */
export async function targetForPoint(tabId: number, point: Point): Promise<TargetInfo> {
  throw new Error("TODO(3.2): targetForPoint");
}
