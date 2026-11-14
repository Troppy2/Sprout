import { describe, expect, it } from "vitest";
import { computerInput, navigateInput, tabsCreateInput } from "../../src/schemas.js";

// Layer 1: the server-side half of the URL gate. A bad URL must be rejected
// before a request ever reaches Chrome (SEC-031).
describe("tool input schemas", () => {
  it("accepts a normal tabs_create request", () => {
    expect(tabsCreateInput.safeParse({}).success).toBe(true);
    expect(tabsCreateInput.safeParse({ url: "https://example.com" }).success).toBe(true);
    expect(tabsCreateInput.safeParse({ url: "about:blank" }).success).toBe(true);
  });

  it("rejects dangerous tabs_create URLs", () => {
    for (const url of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "chrome://settings", "data:text/html,x"]) {
      const result = tabsCreateInput.safeParse({ url });
      expect(result.success, url).toBe(false);
    }
  });

  it("accepts a URL or a history keyword for navigate", () => {
    for (const url of ["https://example.com", "http://1.1.1.1/x", "back", "forward"]) {
      expect(navigateInput.safeParse({ tabId: 3, url }).success, url).toBe(true);
    }
  });

  it("rejects loopback and private destinations before they reach Chrome (SEC-031)", () => {
    for (const url of ["http://127.0.0.1:8787", "http://localhost", "http://192.168.1.1", "http://169.254.169.254"]) {
      expect(tabsCreateInput.safeParse({ url }).success, url).toBe(false);
      expect(navigateInput.safeParse({ tabId: 3, url }).success, url).toBe(false);
    }
  });

  it("rejects blocked schemes and non-integer tab ids for navigate", () => {
    expect(navigateInput.safeParse({ tabId: 3, url: "file:///etc/passwd" }).success).toBe(false);
    expect(navigateInput.safeParse({ tabId: 3, url: "javascript:alert(1)" }).success).toBe(false);
    expect(navigateInput.safeParse({ tabId: -1, url: "https://example.com" }).success).toBe(false);
    expect(navigateInput.safeParse({ tabId: 1.5, url: "https://example.com" }).success).toBe(false);
  });

  it("only accepts the screenshot action in phase 1", () => {
    expect(computerInput.safeParse({ tabId: 1, action: "screenshot" }).success).toBe(true);
    expect(computerInput.safeParse({ tabId: 1, action: "javascript" }).success).toBe(false);
  });
});
