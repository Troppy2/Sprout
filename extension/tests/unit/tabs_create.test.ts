import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeChrome } from "../helpers/fake-chrome";
import { freshChrome } from "../helpers/setup";

let fake: FakeChrome;
let tabsCreate: typeof import("../../src/tools/tabs_create").tabsCreate;

beforeEach(async () => {
  fake = freshChrome();
  ({ tabsCreate } = await import("../../src/tools/tabs_create"));
});

afterEach(() => vi.unstubAllGlobals());

const sproutGroups = () => [...fake.groups.values()].filter((g) => g.title === "Sprout" && g.color === "green");

describe("tabs_create", () => {
  it("creates the green Sprout group once and reuses it", async () => {
    const first = await tabsCreate({ url: "https://example.com/" });
    const second = await tabsCreate({});

    expect(second.groupId).toBe(first.groupId);
    expect(sproutGroups()).toHaveLength(1);
  });

  it("refuses a blocked URL without opening a tab", async () => {
    await expect(tabsCreate({ url: "file:///etc/passwd" })).rejects.toThrow(/Blocked URL/);
    expect(fake.tabs.size).toBe(0);
  });

  // BB-032: MCP clients make parallel calls. Two creates racing each saw "no
  // group" and each made one, leaving a tab the agent could never reach.
  it("BB-032: parallel creates share one Sprout group", async () => {
    const [a, b] = await Promise.all([
      tabsCreate({ url: "https://example.com/" }),
      tabsCreate({ url: "https://example.org/" }),
    ]);

    expect(a.groupId).toBe(b.groupId);
    expect(sproutGroups()).toHaveLength(1);
  });
});
