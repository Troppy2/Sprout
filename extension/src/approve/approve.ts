/**
 * The approve window: an extension page the gate opens with
 * chrome.windows.create({ url: "approve/approve.html?origin=...&need=look|act|submit&detail=...", type: "popup" }).
 *
 * It is the ONLY place a grant is raised or a submit is confirmed. A web page
 * cannot draw it or click it: it is a separate window on a chrome-extension://
 * URL. Read every query value as untrusted text (textContent, never innerHTML),
 * because `detail` can hold a button label from the page.
 *
 * STARTER FILE (phase 2 step 2.3 for grants, phase 3 step 3.6 for submit).
 * HTML and CSS are done (Claude's job). You write the logic.
 */

// TODO(2.3):
// 1. Read origin, need, detail from location.search. If origin is missing, show an error and stop.
// 2. Put them in #origin, #need, #detail with textContent.
// 3. "Allow look" / "Allow act" -> setTier(origin, ...) from policy/grants.ts, then window.close().
//    Show "Allow act" only when need is "act".
// 4. "Deny" -> window.close() and change nothing.
// TODO(3.6): need=submit shows "Allow once" / "Deny" and answers the waiting
//    worker with chrome.runtime.sendMessage({ type: "sprout-submit-answer", id, allow }).
export {};
