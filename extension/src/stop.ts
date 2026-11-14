/**
 * Stop: the browser-level kill switch (SEC-035, INV-6). Ships with the first
 * click (MVP 1), not a phase later.
 *
 * Wired to: the popup Stop button, the keyboard shortcut (manifest "commands",
 * Alt+Shift+S), and later the in-page pill (phase 4, convenience only).
 *
 * STARTER FILE (phase 3, step 3.7).
 */

/**
 * TODO(3.7), in this order, and keep going if a step throws:
 * 1. setHalt("Stopped by the user")   <- FIRST, so a crash below still leaves it halted
 * 2. reject every in-flight tool call with HALTED_MESSAGE (background.ts keeps the set)
 * 3. detach the debugger from every attached tab (cdp/attach.ts detach)
 * 4. tell the popup (chrome.runtime.sendMessage, ignore "no receiver")
 */
export async function stopAll(reason: string): Promise<void> {
  throw new Error("TODO(3.7): stopAll");
}

// TODO(3.7): top-level listener:
//   chrome.commands.onCommand.addListener((command) => { if (command === "sprout-stop") void stopAll(...) })
