import { describe, expect, it } from "vitest";
import { BLOCKED_HOST_MESSAGE, BLOCKED_URL_MESSAGE, isAllowedUrl, isHistoryAction, isNavigableTarget, isPrivateHostname } from "../../src/url-policy.js";

// Layer 1: the URL gate that keeps the agent off file:, javascript: and the
// other schemes that turn a navigation into file read or script execution
// (SEC-031).
describe("url policy", () => {
  it("allows absolute http and https URLs on public hosts", () => {
    expect(isAllowedUrl("https://example.com")).toBe(true);
    expect(isAllowedUrl("https://example.com/a?b=c#d")).toBe(true);
    expect(isAllowedUrl("http://1.1.1.1")).toBe(true);
  });

  it("allows loopback and private hosts only with the explicit opt-in (SEC-031)", () => {
    expect(isAllowedUrl("http://127.0.0.1:8787/fixtures/form.html")).toBe(false);
    expect(isAllowedUrl("http://127.0.0.1:8787/fixtures/form.html", { allowPrivateHosts: true })).toBe(true);
    expect(isAllowedUrl("http://example.com", { allowPrivateHosts: true })).toBe(true);
  });

  it("still blocks IPv6 unique-local and link-local literals", () => {
    for (const host of ["[fd00::1]", "[fc00::1]", "[fe80::1]"]) {
      expect(isAllowedUrl(`http://${host}/`)).toBe(false);
    }
  });

  it("BB-028: does not block public hosts that start with fc, fd or fe80", () => {
    for (const host of ["fcc.gov", "fdic.gov", "fd.io", "fcbarcelona.com", "fe80.example.com"]) {
      expect(isPrivateHostname(host)).toBe(false);
    }
  });

  it("SEC-066: blocks names that only resolve on a local network", () => {
    for (const host of [
      "printer.local",
      "x.corp.internal",
      "nas.lan",
      "nas.home.arpa",
      "localhost.localdomain",
      "router",
      "192.0.0.192",
      "198.18.0.1",
      "[::7f00:1]",
    ]) {
      expect(isAllowedUrl(`http://${host}/`)).toBe(false);
    }
  });

  it("allows about:blank for an empty new tab", () => {
    expect(isAllowedUrl("about:blank")).toBe(true);
    expect(isAllowedUrl("about:blank", { allowAboutBlank: false })).toBe(false);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:fetch('https://evil.test')",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/1234",
    "file:///C:/Windows/win.ini",
    "file:///etc/passwd",
    "chrome://settings",
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html",
    "devtools://devtools/bundled/inspector.html",
    "view-source:https://example.com",
    "about:config",
    "ftp://example.com/file",
  ])("blocks %s", (url) => {
    expect(isAllowedUrl(url)).toBe(false);
  });

  it("blocks relative paths and garbage, which cannot be resolved without a base", () => {
    expect(isAllowedUrl("/admin")).toBe(false);
    expect(isAllowedUrl("example.com")).toBe(false);
    expect(isAllowedUrl("")).toBe(false);
  });

  it("recognises the history keywords navigate accepts instead of a URL", () => {
    expect(isHistoryAction("back")).toBe(true);
    expect(isHistoryAction("forward")).toBe(true);
    expect(isHistoryAction("reload")).toBe(false);

    expect(isNavigableTarget("back")).toBe(true);
    expect(isNavigableTarget("https://example.com")).toBe(true);
    expect(isNavigableTarget("file:///C:/")).toBe(false);
  });

  it("ships a message that names every blocked scheme", () => {
    for (const scheme of ["file:", "data:", "blob:", "javascript:", "chrome:", "devtools:", "view-source:"]) {
      expect(BLOCKED_URL_MESSAGE).toContain(scheme);
    }
    expect(BLOCKED_HOST_MESSAGE).toContain("127.0.0.1");
  });
});

// SEC-031, address half: the model must not be talked into the router, a dev
// server, or a cloud metadata endpoint.
describe("private host policy", () => {
  it.each([
    "http://localhost:3000",
    "http://app.localhost",
    "http://127.0.0.1",
    "http://127.1.2.3",
    "http://0.0.0.0",
    "http://10.0.0.5",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://[fe80::1]",
    "http://metadata.google.internal",
  ])("blocks %s", (url) => {
    expect(isPrivateHostname(new URL(url).hostname), url).toBe(true);
    expect(isAllowedUrl(url), url).toBe(false);
  });

  it("does not block public addresses that look similar", () => {
    for (const url of ["http://8.8.8.8", "http://172.32.0.1", "http://192.169.1.1", "https://example.com"]) {
      expect(isPrivateHostname(new URL(url).hostname), url).toBe(false);
      expect(isAllowedUrl(url), url).toBe(true);
    }
  });
});
