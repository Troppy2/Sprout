/**
 * The halt flag (INV-6). When set, every tool call fails with the same generic
 * message and leaks nothing about the page. Lives in chrome.storage.session so
 * it survives a worker restart, and only extension pages can clear it.
 *
 * Set by: Stop (stop.ts), the sensitive-field check in phase 3, the user.
 * Cleared by: the Resume button in the popup. Never by a tool or a bridge frame.
 *
 * STARTER FILE (phase 3, step 3.5).
 */

export const HALT_KEY = "halted";

/** Exact text every tool returns while halted. Do not add the reason: it can leak page info. */
export const HALTED_MESSAGE = "Sprout is paused, waiting for the user. Do not retry until the user says to continue.";

export interface HaltState {
  halted: boolean;
  /** Shown to the USER in the popup only, never returned to the model. */
  reason?: string;
  since?: number;
}

/**
 * TODO(3.5): read the flag. If storage throws, return halted: true.
 * Fail closed: a broken read must never mean "go ahead".
 */
export async function readHalt(): Promise<HaltState> {
  throw new Error("TODO(3.5): readHalt");
}

/** TODO(3.5): write { halted: true, reason, since: Date.now() }. */
export async function setHalt(reason: string): Promise<void> {
  throw new Error("TODO(3.5): setHalt");
}

/** TODO(3.5): popup Resume only. Remove the key. */
export async function clearHalt(): Promise<void> {
  throw new Error("TODO(3.5): clearHalt");
}

/** TODO(3.5): throw `new Error(HALTED_MESSAGE)` when halted. The gate calls this first. */
export async function assertNotHalted(): Promise<void> {
  throw new Error("TODO(3.5): assertNotHalted");
}
