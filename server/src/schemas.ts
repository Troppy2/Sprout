/**
 * Zod input schemas for every MCP tool. One schema per tool. Tool names mirror
 * Claude in Chrome, see `design/tools.md`.
 *
 * The extension enforces the same policy again (`extension/src/lib/url.ts`).
 * These schemas are the cheap first rejection so a bad URL never reaches Chrome.
 */
import { z } from "zod";
import {
  BLOCKED_HOST_MESSAGE,
  BLOCKED_URL_MESSAGE,
  isAllowedUrl,
  isNavigableTarget,
} from "./url-policy.js";

/**
 * Local fixture servers live on 127.0.0.1, so the private-host rule has an
 * explicit opt-in. Off by default: the agent should not wander into the router,
 * a dev server, or a cloud metadata endpoint just because a page suggested it.
 */
function urlOk(navigable: boolean) {
  return (value: string): boolean => {
    const options = { allowPrivateHosts: process.env.SPROUT_ALLOW_PRIVATE_HOSTS === "1" };
    return navigable ? isNavigableTarget(value, options) : isAllowedUrl(value, options);
  };
}

const tabId = z
  .number()
  .int()
  .min(0)
  .describe("Tab id from tabs_context. Must be a tab in the Sprout group.");

/** No arguments: lists the tabs the agent is allowed to touch. */
export const tabsContextInput = z.object({});

/** Connection probe. The optional message is echoed back with the pong. */
export const pingInput = z.object({
  message: z.string().optional().describe("Optional text to echo back with the pong."),
});

/** Optional URL. Missing means a blank tab. */
export const tabsCreateInput = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .refine(urlOk(false), {
      message: `${BLOCKED_URL_MESSAGE} ${BLOCKED_HOST_MESSAGE}`,
    })
    .optional()
    .describe('Absolute http: or https: URL on a public host. Defaults to "about:blank".'),
});

/** A URL, or "back" / "forward" to walk the tab's history. */
export const navigateInput = z.object({
  tabId,
  url: z
    .string()
    .trim()
    .min(1)
    .refine(urlOk(true), {
      message: `${BLOCKED_URL_MESSAGE} ${BLOCKED_HOST_MESSAGE} "back" and "forward" are also accepted.`,
    })
    .describe('Absolute http: or https: URL on a public host, or "back" / "forward".'),
});

/** Phase 1 only exposes the screenshot action; phase 3 adds click, type, scroll, key. */
export const computerInput = z.object({
  tabId,
  action: z.literal("screenshot").describe("Phase 1 supports only screenshot."),
});
