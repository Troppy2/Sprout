/**
 * Pages Chrome will not let the debugger attach to. Caught here so the model
 * gets a plain error instead of a raw CDP failure (rules-gotchas: restricted pages).
 */

const RESTRICTED_SCHEMES = [
  "chrome:",
  "chrome-error:",
  "chrome-extension:",
  "edge:",
  "devtools:",
  "view-source:",
  "about:",
];

/** Host plus an optional path prefix. Hostnames never contain a path (BB-035). */
const RESTRICTED_SITES: Array<{ host: string; pathPrefix?: string }> = [
  { host: "chromewebstore.google.com" },
  { host: "chrome.google.com", pathPrefix: "/webstore" },
];

function isRestrictedSite(url: URL): boolean {
  return RESTRICTED_SITES.some(
    ({ host, pathPrefix }) =>
      (url.hostname === host || url.hostname === `www.${host}`) &&
      (pathPrefix === undefined || url.pathname.startsWith(pathPrefix)),
  );
}

/** Why the debugger cannot attach to this tab, or null if it can. */
export function restrictedPageReason(tab: chrome.tabs.Tab): string | null {
  const url = tab.url ?? "";

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }

  if (parsed && parsed.protocol === "about:" && parsed.href === "about:blank") return null;

  if (parsed && RESTRICTED_SCHEMES.includes(parsed.protocol)) {
    return `Tab ${tab.id} is a restricted page (${url}). Chrome does not allow the debugger there. Navigate it to an http: or https: page first.`;
  }

  if (parsed && isRestrictedSite(parsed)) {
    return `Tab ${tab.id} is on the Chrome Web Store, which Chrome protects from extensions. Use a normal page instead.`;
  }

  return null;
}

export function assertPageAttachable(tab: chrome.tabs.Tab): void {
  const reason = restrictedPageReason(tab);
  if (reason) throw new Error(reason);
}
