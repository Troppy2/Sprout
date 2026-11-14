/**
 * Per-origin grants: the core of MVP 1 (decision 2026-11-14, INV-9).
 *
 * Every origin starts with no grant. The user, never the model, raises it to
 * "look" (screenshot, read) or "act" (click, type, scroll, key). Grants live in
 * chrome.storage.local so they survive worker restarts and browser restarts.
 *
 * STARTER FILE (phase 2, step 2.1). Signatures and types are fixed so the rest
 * of the code can import them. Replace every `throw new Error("TODO ...")`.
 */

/** "none" is never stored; a missing entry means none. */
export type Tier = "none" | "look" | "act";

/** Stored shape: `chrome.storage.local.grants = { "https://example.com": "look" }`. */
export type GrantMap = Record<string, Exclude<Tier, "none">>;

export const GRANTS_KEY = "grants";

/** Higher number = more power. Use it to compare tiers, never compare strings. */
export const TIER_RANK: Record<Tier, number> = { none: 0, look: 1, act: 2 };

/**
 * The origin a grant is keyed by. `https://mail.google.com/x?y` -> `https://mail.google.com`.
 * about:blank has no origin and never needs a grant: return null for it and for
 * anything that does not parse.
 *
 * TODO(2.1): use `new URL(url).origin`. Only http: and https: produce a key.
 */
export function originKey(url: string): string | null {
  throw new Error("TODO(2.1): originKey");
}

/** TODO(2.1): read the map, ignore malformed values (fail closed: treat as none). */
export async function readGrants(): Promise<GrantMap> {
  throw new Error("TODO(2.1): readGrants");
}

/** TODO(2.1): the tier for one origin, "none" if missing. */
export async function tierFor(origin: string): Promise<Tier> {
  throw new Error("TODO(2.1): tierFor");
}

/**
 * Only extension pages (approve window, popup) may call this. Never reachable
 * from a tool call or a bridge frame: the model cannot grant itself access.
 *
 * TODO(2.1): "none" deletes the entry, anything else sets it.
 */
export async function setTier(origin: string, tier: Tier): Promise<void> {
  throw new Error("TODO(2.1): setTier");
}
