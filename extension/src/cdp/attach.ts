/**
 * chrome.debugger helpers (CDP 1.3).
 *
 * The service worker can be killed at any time and lose every module variable,
 * so "am I attached" is always re-proved against Chrome instead of trusted from
 * memory. Idle tabs are detached after about a minute so the "started debugging
 * this browser" banner does not stay up while the agent is idle.
 */

import { errorMessage } from "../lib/errors";
import { GUARD_SETUP } from "./guard";

const CDP_VERSION = "1.3";
const IDLE_DETACH_MS = 60_000;
const IDLE_CHECK_MS = 15_000;
/** Under the server's call timeout, so the model gets this error, not a generic one. */
const COMMAND_TIMEOUT_MS = 20_000;

/** Attached tabs and when each was last used. Membership means "attached". */
const lastUsed = new Map<number, number>();

let idleTimer: ReturnType<typeof setInterval> | null = null;

function touch(tabId: number): void {
  lastUsed.set(tabId, Date.now());

  if (idleTimer) return;

  idleTimer = setInterval(() => {
    const now = Date.now();

    for (const [id, usedAt] of lastUsed) {
      if (now - usedAt > IDLE_DETACH_MS) {
        void detach(id);
      }
    }

    if (lastUsed.size === 0 && idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
  }, IDLE_CHECK_MS);
}

/**
 * Attaches if needed. A worker restart leaves Chrome still attached to us while
 * our Set is empty, and Chrome reports that exactly like DevTools holding the
 * tab, so the two cases are told apart with a cheap CDP probe.
 */
export async function ensureAttached(tabId: number): Promise<void> {
  if (!lastUsed.has(tabId)) {
    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION);
    } catch (error) {
      const message = errorMessage(error);

      if (!/already attached/i.test(message)) {
        throw new Error(`Could not attach the debugger to tab ${tabId}: ${message}`);
      }

      try {
        await chrome.debugger.sendCommand({ tabId }, "Page.getNavigationHistory");
      } catch {
        throw new Error(
          `Tab ${tabId} is attached to another debugger, usually DevTools. Close DevTools on that tab and try again.`,
        );
      }
    }

    // Every attach turns the guard on before any tool command runs (cdp/guard.ts).
    // Repeating it after a worker restart is harmless.
    for (const [method, params] of GUARD_SETUP) {
      await command(tabId, method, params);
    }
  }

  touch(tabId);
}

/**
 * One CDP command with a deadline. Chrome can leave a command unanswered (a
 * screenshot of a hidden tab), which would hang the tool call (BB-031).
 */
function command<T>(tabId: number, method: string, params: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${COMMAND_TIMEOUT_MS / 1000}s waiting for Chrome to answer.`)),
      COMMAND_TIMEOUT_MS,
    );
  });

  return Promise.race([chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>, deadline]).finally(() =>
    clearTimeout(timer),
  );
}

/** Attach on demand, then run one CDP command. Re-attaches once if Chrome dropped us. */
export async function send<T = unknown>(
  tabId: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  await ensureAttached(tabId);

  try {
    return await command<T>(tabId, method, params);
  } catch (error) {
    const message = errorMessage(error);

    if (!/not attached/i.test(message)) {
      throw new Error(`${method} failed on tab ${tabId}: ${message}`);
    }

    // The tab was detached behind our back (DevTools opened, tab closed, ...).
    lastUsed.delete(tabId);
    await ensureAttached(tabId);
    return command<T>(tabId, method, params);
  }
}

export async function detach(tabId: number): Promise<void> {
  lastUsed.delete(tabId);

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Already detached, or the tab is gone. Nothing to do.
  }
}

/**
 * A dead worker leaves its debugger sessions attached, which keeps the
 * "started debugging this browser" banner up. Run once per worker start: detach
 * everything we can. `detach` throws for a tab held by DevTools, so those are
 * left alone.
 */
async function cleanupStaleAttachments(): Promise<void> {
  try {
    const targets = await chrome.debugger.getTargets();

    await Promise.all(
      targets
        .filter((target) => target.attached && typeof target.tabId === "number" && target.tabId >= 0)
        // `detach` fails quietly for a tab held by DevTools: not ours to detach.
        .map((target) => detach(target.tabId as number)),
    );
  } catch {
    // Chrome was not ready; the next tool call attaches on demand anyway.
  }
}

export interface EventWaiter {
  promise: Promise<void>;
  cancel: () => void;
}

/**
 * Resolves on the next matching CDP event for one tab. Call it before the
 * command that triggers the event, or the event can fire before you listen.
 *
 * A JavaScript dialog rejects instead of waiting out the timeout: dialogs block
 * CDP input and Sprout does not touch them until phase 5. A detach (DevTools
 * opened, tab closed) also rejects, so a call fails fast instead of hanging.
 */
export function waitForEvent(tabId: number, methods: string | string[], timeoutMs = 30_000): EventWaiter {
  const wanted = new Set(Array.isArray(methods) ? methods : [methods]);

  let finish = () => {};

  // A promise ignores later settles, and `finish` is idempotent, so no flag is needed.
  const promise = new Promise<void>((resolve, reject) => {
    const onEvent = (source: chrome.debugger.Debuggee, eventMethod: string) => {
      if (source.tabId !== tabId) return;

      if (wanted.has(eventMethod)) {
        finish();
        resolve();
      } else if (eventMethod === "Page.javascriptDialogOpening") {
        finish();
        reject(
          new Error(
            "The page opened a JavaScript dialog. Sprout does not touch dialogs yet; ask the user to dismiss it.",
          ),
        );
      }
    };

    const onDetach = (source: chrome.debugger.Debuggee, reason: string) => {
      if (source.tabId !== tabId) return;

      finish();
      reject(
        new Error(
          `The debugger detached from tab ${tabId} while waiting (${reason}). If DevTools was opened on that tab, close it and try again.`,
        ),
      );
    };

    const timer = setTimeout(() => {
      finish();
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${[...wanted].join(" or ")}.`));
    }, timeoutMs);

    finish = () => {
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      clearTimeout(timer);
    };

    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(onDetach);
  });

  return { promise, cancel: () => finish() };
}

// Chrome reports every detach here, including the user opening DevTools.
chrome.debugger.onDetach.addListener((source, reason) => {
  if (typeof source.tabId !== "number") return;

  lastUsed.delete(source.tabId);

  if (reason !== "target_closed") {
    console.warn(`sprout: debugger detached from tab ${source.tabId} (${reason}), will reattach on the next call`);
  }
});

// Taking a tab back out of the Sprout group revokes access immediately (SEC-030),
// even if a tool call is in flight. The next call re-checks the live group.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (lastUsed.has(tabId) && changeInfo.groupId !== undefined) void detach(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastUsed.delete(tabId);
});

// A previous worker instance may have died while attached; clear that state.
void cleanupStaleAttachments();
