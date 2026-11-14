/**
 * The central gate (INV-3). Every tool call passes `gate()` before its handler
 * runs. background.ts calls it in `handleMessage`; no tool file is allowed to
 * skip it.
 *
 * Order of checks (cheapest and strongest first):
 *   1. halted?           -> generic "paused" error, nothing else (policy/halt.ts)
 *   2. tool class        -> meta tools pass, unknown tools fail closed
 *   3. tab in group?     -> requireSproutTab (lib/group.ts)
 *   4. origin grant      -> needs look or act on the tab's CURRENT origin
 *   5. navigate target   -> needs at least look on the TARGET origin (egress rule)
 *
 * A missing grant does not hang the call waiting for the user. The gate opens
 * the approve window and throws `needs_grant`; the model retries after the user
 * answers. This keeps calls under the server's 45s timeout.
 *
 * STARTER FILE (phase 2, step 2.2).
 */
import type { Tier } from "./grants";

/** How much power a tool needs. Unknown tools are not in this map and fail closed. */
export type ToolClass = "meta" | "navigate" | "look" | "act";

/** Fill in as tools are added. Each new tool MUST get a row or the gate refuses it. */
export const TOOL_CLASS: Record<string, ToolClass> = {
  ping: "meta",
  tabs_context: "meta",
  tabs_create: "navigate",
  navigate: "navigate",
  read_page: "look",
  get_page_text: "look",
  find: "look",
  // computer is mixed: "screenshot" is look, every other action is act. See classify().
};

/** The tier a class needs on the relevant origin. Meta needs nothing. */
export const REQUIRED_TIER: Record<ToolClass, Tier> = {
  meta: "none",
  navigate: "look",
  look: "look",
  act: "act",
};

/** Thrown when the user has to approve an origin first. The message tells the model to wait and retry. */
export class NeedsGrantError extends Error {
  readonly code = "needs_grant";
  constructor(
    readonly origin: string,
    readonly needed: Tier,
  ) {
    super(
      `Sprout needs the user's permission to ${needed === "act" ? "act on" : "look at"} ${origin}. ` +
        "An approval window is open in Chrome. Tell the user, wait for them to answer, then retry this call once.",
    );
  }
}

/**
 * TODO(2.2): the class for this call. `computer` with action "screenshot" is
 * "look"; any other computer action is "act". Return undefined for unknown tools.
 */
export function classify(tool: string, args: unknown): ToolClass | undefined {
  throw new Error("TODO(2.2): classify");
}

/**
 * TODO(2.2): run the checks in the order listed at the top of this file.
 * Throw on refusal, return normally on allow. Open the approve window with
 * `openApproval(origin, needed)` (TODO 2.3) before throwing NeedsGrantError.
 */
export async function gate(tool: string, args: unknown): Promise<void> {
  throw new Error("TODO(2.2): gate");
}
