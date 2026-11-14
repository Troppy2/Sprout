/**
 * URL policy for anything that can navigate the agent's tab (SEC-031).
 *
 * This is the server-side half. The extension enforces the same rule again in
 * `extension/src/lib/url.ts` because the two packages are bundled separately
 * and a shared package does not exist yet. If you change one, change both.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const PRIVATE_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

/**
 * Suffixes that only resolve on a local network or inside a company (SEC-066).
 * The policy sees names, not the IPs they resolve to, so these are refused by
 * name. Resolved-IP checking is planned for phase 2.
 */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".localdomain"];

export const BLOCKED_URL_MESSAGE =
  'Blocked URL. Sprout only opens http: and https: pages, plus "about:blank" for an empty tab. ' +
  "file:, data:, blob:, javascript:, chrome:, devtools: and view-source: are refused.";

export const BLOCKED_HOST_MESSAGE =
  "Blocked host. Sprout does not open loopback, private, link-local or cloud metadata addresses " +
  "(localhost, 127.0.0.1, 10.x, 172.16-31.x, 192.168.x, 169.254.x, 100.64-127.x, ::1), " +
  "or local-only names (printer.local, x.internal, a bare name like router). " +
  "Ask the user to approve the destination if they really need it.";

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets;
}

/**
 * `new URL("http://[::ffff:127.0.0.1]")` normalizes to `[::ffff:7f00:1]`, so an
 * IPv4-mapped address arrives as two hex groups, not dotted quad.
 */
function ipv4FromMapped(rest: string): string | null {
  if (rest.includes(".")) return rest;

  const groups = rest.split(":");
  if (groups.length !== 2) return null;

  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return null;
  if (high < 0 || high > 0xffff || low < 0 || low > 0xffff) return null;

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/** Loopback, RFC1918, CGNAT, link-local and IPv6 equivalents (SEC-031). */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  if (host === "" ) return false;
  if (PRIVATE_HOSTNAMES.has(host)) return true;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  // IPv6 literals are the only hostnames with a colon. The prefix checks must
  // stay inside this branch, or fcc.gov and fd.io read as private (BB-028).
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    // ::ffff:a.b.c.d (IPv4-mapped) and the deprecated ::a.b.c.d (IPv4-compatible).
    const embedded = host.startsWith("::ffff:") ? host.slice("::ffff:".length) : host.startsWith("::") ? host.slice(2) : null;
    if (embedded !== null) {
      const mapped = ipv4FromMapped(embedded);
      // An unparseable embedded form is not something to guess about: block it.
      return mapped === null ? true : isPrivateHostname(mapped);
    }
    return host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd");
  }

  const octets = parseIpv4(host);
  // A single-label name ("router", "nas") only resolves through local DNS.
  if (!octets) return !host.includes(".");

  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 192 && second === 0 && octets[2] === 0) return true; // IETF, includes 192.0.0.192 (Oracle metadata)
  if (first === 198 && (second === 18 || second === 19)) return true; // benchmarking, often internal

  return false;
}

export type HistoryAction = "back" | "forward";

export interface UrlPolicyOptions {
  allowAboutBlank?: boolean;
  /**
   * Local fixture servers run on 127.0.0.1. Off by default so a page (or a
   * model) cannot walk the agent into the router, a dev server, or a cloud
   * metadata endpoint. Turn it on deliberately for fixtures.
   */
  allowPrivateHosts?: boolean;
}

/** `navigate` accepts the history keywords in place of a URL. */
export function isHistoryAction(value: string): value is HistoryAction {
  return value === "back" || value === "forward";
}

/**
 * True only for absolute http:/https: URLs on public hosts, and about:blank
 * when enabled. Anything that fails `new URL()` (relative paths included) is
 * refused.
 */
export function isAllowedUrl(raw: string, options: UrlPolicyOptions = {}): boolean {
  const allowAboutBlank = options.allowAboutBlank ?? true;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (allowAboutBlank && url.protocol === "about:" && url.href === "about:blank") {
    return true;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;

  return options.allowPrivateHosts === true || !isPrivateHostname(url.hostname);
}

/** URL or history keyword, and only the keywords are exempt from the host rule. */
export function isNavigableTarget(value: string, options: UrlPolicyOptions = {}): boolean {
  return isHistoryAction(value) || isAllowedUrl(value, options);
}
