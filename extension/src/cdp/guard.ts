/**
 * The guard: what every attached Sprout tab is allowed to load (SEC-066,
 * SEC-067, SEC-068). Decided in design/decisions.md on 2026-10-30.
 *
 * - CDP `Fetch` pauses every page and iframe request, and every redirect hop,
 *   before it is sent. The URL policy decides continue or fail.
 * - At the response stage, a document that is really a download is failed
 *   before any bytes land.
 * - CDP `Network` reports the IP each document came from. A private IP (a
 *   public name pointing at the LAN, such as localtest.me) bounces the tab to
 *   about:blank. That request has already gone out; the page never stays.
 * - `Page.downloadWillBegin` records downloads a page starts by script, so the
 *   downloads hold (lib/downloads.ts) can cancel them.
 *
 * The listener is registered at load, so a worker woken by a paused request
 * always answers it. A paused request nobody answers would hang the tab.
 */
import { isAllowedUrl, isPrivateHostname } from "../lib/url";

type Params = Record<string, any>;

/** Sent once per attach. Order matters: Fetch first, so no request slips past. */
export const GUARD_SETUP: Array<[string, Params]> = [
  [
    "Fetch.enable",
    {
      patterns: [
        { urlPattern: "*", resourceType: "Document", requestStage: "Request" },
        { urlPattern: "*", resourceType: "Document", requestStage: "Response" },
      ],
    },
  ],
  ["Network.enable", {}],
  ["Page.enable", {}],
];

/** Content types Chrome renders. Any other document response is a download. */
const RENDERABLE = [/^text\//, /^image\//, /^video\//, /^audio\//, /^application\/(xhtml\+xml|xml|json|pdf)$/];

const SESSION_KEY = "verifiedOrigins";
const DOWNLOAD_MEMORY_MS = 60_000;

/** Why the last load in a tab was stopped, until a tool call reports it. */
const blocks = new Map<number, string>();
/** Guard decisions still running per tab, so a tool call can wait for them. */
const pending = new Map<number, Promise<void>>();
/** Main frame id per tab, to tell a top-level navigation from an iframe one. */
const mainFrames = new Map<number, string>();
/** Downloads attached pages announced, for lib/downloads.ts. */
const announcedDownloads: Array<{ tabId: number; url: string; at: number }> = [];

let allowPrivateHosts: Promise<boolean> | null = null;

function readAllowPrivateHosts(): Promise<boolean> {
  allowPrivateHosts ??= chrome.storage.local
    .get("allowPrivateHosts")
    .then((stored) => stored.allowPrivateHosts === true)
    .catch(() => false);
  return allowPrivateHosts;
}

function cdp(tabId: number, method: string, params: Params = {}): Promise<unknown> {
  // The tab may have closed or detached since the event; nothing to answer then.
  return Promise.resolve(chrome.debugger.sendCommand({ tabId }, method, params)).catch(() => undefined);
}

function block(tabId: number, reason: string): void {
  blocks.set(tabId, reason);
  console.warn(`sprout: tab ${tabId}: ${reason}`);
}

/** The reason the tab's last load was stopped, cleared once read. */
export function takeBlock(tabId: number): string | undefined {
  const reason = blocks.get(tabId);
  blocks.delete(tabId);
  return reason;
}

export function clearBlock(tabId: number): void {
  blocks.delete(tabId);
}

/** Resolves once every guard decision already started for the tab is done. */
export function guardSettled(tabId: number): Promise<void> {
  return pending.get(tabId) ?? Promise.resolve();
}

function track(tabId: number, work: () => Promise<void>): void {
  const next = (pending.get(tabId) ?? Promise.resolve()).then(work, work).catch((error: unknown) => {
    console.error("sprout: guard failed", error);
  });
  pending.set(tabId, next);
}

function headerValue(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find((header) => header.name.toLowerCase() === name)?.value ?? "";
}

export function isDownloadResponse(status: number, headers: Array<{ name: string; value: string }> | undefined): boolean {
  if (status >= 300 && status < 400) return false; // a redirect, checked at its next hop
  if (/^\s*attachment/i.test(headerValue(headers, "content-disposition"))) return true;

  const type = headerValue(headers, "content-type").split(";")[0].trim().toLowerCase();
  // No type: Chrome sniffs it and usually renders. Refusing would break real pages.
  if (type === "") return false;
  return !RENDERABLE.some((pattern) => pattern.test(type));
}

async function onRequestPaused(tabId: number, params: Params): Promise<void> {
  const url: string = params.request?.url ?? "";
  const atResponse = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;

  if (!atResponse) {
    if (!isAllowedUrl(url, { allowPrivateHosts: await readAllowPrivateHosts() })) {
      block(tabId, `Blocked a load of ${url}: Sprout does not open that address (it may have been a redirect or an iframe).`);
      await cdp(tabId, "Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" });
      return;
    }
  } else if (isDownloadResponse(params.responseStatusCode ?? 0, params.responseHeaders)) {
    block(tabId, `Blocked a download from ${url}. Sprout does not let pages save files.`);
    await cdp(tabId, "Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" });
    return;
  }

  await cdp(tabId, "Fetch.continueRequest", { requestId: params.requestId });
}

async function onResponseReceived(tabId: number, params: Params): Promise<void> {
  if (params.type !== "Document") return;

  const ip: string = params.response?.remoteIPAddress ?? "";
  // No IP (cache, service worker): nothing to check.
  if (ip === "" || !isPrivateHostname(ip)) return;
  if (await readAllowPrivateHosts()) return;

  block(
    tabId,
    `Blocked ${params.response?.url ?? "a page"}: it resolved to the private address ${ip}. Sprout does not open loopback or local network addresses.`,
  );
  await cdp(tabId, "Page.stopLoading");
  await cdp(tabId, "Page.navigate", { url: "about:blank" });
}

async function onFrameNavigated(tabId: number, params: Params): Promise<void> {
  const frame = params.frame;
  if (!frame || frame.parentId) return;

  mainFrames.set(tabId, frame.id);
  // Every request for this document already passed the guard, so its origin is
  // verified. A blocked load is reported instead.
  if (!blocks.has(tabId)) await setVerifiedOrigin(tabId, frame.url);
}

function onDownloadWillBegin(tabId: number, params: Params): void {
  const now = Date.now();
  announcedDownloads.push({ tabId, url: params.url ?? "", at: now });
  while (announcedDownloads.length > 0 && now - announcedDownloads[0].at > DOWNLOAD_MEMORY_MS) {
    announcedDownloads.shift();
  }
}

/** The Sprout tab that announced a download of this URL in the last minute, if any. */
export function tabThatAnnounced(url: string): number | undefined {
  const now = Date.now();
  return announcedDownloads.find((entry) => entry.url === url && now - entry.at <= DOWNLOAD_MEMORY_MS)?.tabId;
}

// --- Verified origins (recheck on return) -----------------------------------

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "about:" ? "about:blank" : parsed.origin;
  } catch {
    return undefined;
  }
}

async function readVerified(): Promise<Record<string, string>> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const value = stored[SESSION_KEY];
  return typeof value === "object" && value !== null ? (value as Record<string, string>) : {};
}

/**
 * Records that the guard watched this tab load `url`. Kept in session storage
 * because the worker usually sleeps between tool calls.
 */
export async function setVerifiedOrigin(tabId: number, url: string): Promise<void> {
  const origin = originOf(url);
  if (!origin) return;
  const verified = await readVerified();
  verified[String(tabId)] = origin;
  await chrome.storage.session.set({ [SESSION_KEY]: verified });
}

/**
 * True if the tab is still on an origin the guard watched it load. Same origin
 * means same host, so a page that only changed path (an SPA) is not reloaded.
 */
export async function isVerified(tabId: number, url: string): Promise<boolean> {
  const origin = originOf(url);
  if (origin === "about:blank") return true; // loads nothing from the network
  return origin !== undefined && (await readVerified())[String(tabId)] === origin;
}

// --- Router (top level: a sleeping worker must wake for these) ---------------

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (typeof tabId !== "number") return;
  const p = (params ?? {}) as Params;

  switch (method) {
    case "Fetch.requestPaused":
      track(tabId, () => onRequestPaused(tabId, p));
      break;
    case "Network.responseReceived":
      track(tabId, () => onResponseReceived(tabId, p));
      break;
    case "Page.frameNavigated":
      track(tabId, () => onFrameNavigated(tabId, p));
      break;
    case "Page.navigatedWithinDocument":
      // Same document, no new request: the origin cannot change.
      if (p.frameId === mainFrames.get(tabId)) track(tabId, () => setVerifiedOrigin(tabId, p.url));
      break;
    case "Page.downloadWillBegin":
      onDownloadWillBegin(tabId, p);
      break;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "allowPrivateHosts" in changes) allowPrivateHosts = null;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  blocks.delete(tabId);
  pending.delete(tabId);
  mainFrames.delete(tabId);
});
