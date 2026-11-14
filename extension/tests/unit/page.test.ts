import { describe, expect, it } from "vitest";
import { restrictedPageReason } from "../../src/lib/page";

const tab = (url: string) => ({ id: 1, url }) as chrome.tabs.Tab;

describe("restricted pages", () => {
  it("allows about:blank and normal pages", () => {
    expect(restrictedPageReason(tab("about:blank"))).toBeNull();
    expect(restrictedPageReason(tab("https://example.com/"))).toBeNull();
    expect(restrictedPageReason(tab("https://chrome.google.com/"))).toBeNull();
  });

  it("refuses chrome:, chrome-error: and the new Web Store", () => {
    expect(restrictedPageReason(tab("chrome://settings"))).not.toBeNull();
    expect(restrictedPageReason(tab("chrome-error://chromewebdata/"))).not.toBeNull();
    expect(restrictedPageReason(tab("https://chromewebstore.google.com/detail/x"))).not.toBeNull();
  });

  it("BB-035: refuses the old Web Store path on chrome.google.com", () => {
    expect(restrictedPageReason(tab("https://chrome.google.com/webstore/detail/x"))).toMatch(/Web Store/);
  });
});
