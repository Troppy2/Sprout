/**
 * Submit-class actions always need the user (decision 2026-11-14). An "act"
 * grant lets the agent click and type; it never lets it send, buy, delete,
 * post, or submit a form without a confirm in the approve window.
 *
 * This is a heuristic and will miss some (a div styled as a button with no
 * words). Say so in the feature doc. The halt and Stop are the backstop.
 *
 * STARTER FILE (phase 3, step 3.6).
 */
import type { TargetInfo } from "../cdp/target";

export const SUBMIT_WORDS = [
  "submit", "send", "post", "publish", "buy", "pay", "purchase", "order", "checkout",
  "place order", "delete", "remove", "confirm", "transfer", "sign up", "subscribe", "share",
];

/**
 * TODO(3.6): true when the target is a submit control:
 *   - <button> with no type or type=submit inside a form, or input type=submit
 *   - or its label contains one of SUBMIT_WORDS (whole word, case-insensitive)
 * Pure function: unit test it first with a table of cases.
 */
export function isSubmitLike(target: TargetInfo): boolean {
  throw new Error("TODO(3.6): isSubmitLike");
}

/** TODO(3.6): pressing Enter in a field inside a form also submits. Same confirm. */
export function isSubmitKey(combo: string, target: TargetInfo): boolean {
  throw new Error("TODO(3.6): isSubmitKey");
}
