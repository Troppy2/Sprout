import { describe, expect, it } from "vitest";
import { isAllowedUrl, isPrivateHostname } from "../../src/lib/url";

// The extension copy of the URL policy is the real enforcement point (INV-7).
// The server copy has its own tests; these keep the two from drifting.
describe("extension url policy", () => {
  it("blocks loopback, private and IPv6 local addresses", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.1", "192.168.1.1", "[::1]", "[fd00::1]", "[fc00::1]", "[fe80::1]"]) {
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
});
