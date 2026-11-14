/**
 * get_page_text {tabId}: the page's visible text, capped and wrapped.
 * Use Runtime.evaluate with `document.body.innerText` and returnByValue: true.
 * innerText (not textContent) skips display:none text, which removes the
 * cheapest hidden-injection trick.
 *
 * STARTER FILE (phase 2, step 2.7).
 */
export async function getPageText(args: unknown): Promise<string> {
  throw new Error("TODO(2.7): get_page_text");
}
