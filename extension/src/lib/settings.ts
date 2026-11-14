/**
 * User settings that are not part of a tool call. The popup does not expose
 * these yet; they are set once from the service worker console, for example:
 *   chrome.storage.local.set({ allowPrivateHosts: true })
 */

import { assertAllowedUrl } from "./url";

/** Fixture servers run on 127.0.0.1. Default off: fail closed (SEC-031). */
export async function readAllowPrivateHosts(): Promise<boolean> {
  const stored = await chrome.storage.local.get("allowPrivateHosts");
  return stored.allowPrivateHosts === true;
}

/** `assertAllowedUrl` with the stored settings applied. Returns the parsed URL. */
export async function assertUrlAllowed(raw: string): Promise<URL> {
  return assertAllowedUrl(raw, { allowPrivateHosts: await readAllowPrivateHosts() });
}
