import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeChrome } from "../helpers/fake-chrome";
import { freshChrome } from "../helpers/setup";

let fake: FakeChrome;
let computer: typeof import("../../src/tools/computer").computer;

beforeEach(async () => {
  fake = freshChrome();
  ({ computer } = await import("../../src/tools/computer"));
});

afterEach(() => vi.unstubAllGlobals());

function captureClip(): { scale: number; width: number; height: number } {
  const call = fake.chrome.debugger.sendCommand.mock.calls.find(([, method]) => method === "Page.captureScreenshot");
  if (!call) throw new Error("no screenshot was taken");
  return (call[2] as { clip: { scale: number; width: number; height: number } }).clip;
}

describe("computer screenshot", () => {
  it("keeps a small viewport at full size on a normal display", async () => {
    const tabId = await fake.addSproutTab("https://example.com/");

    const shot = await computer({ tabId, action: "screenshot" });

    expect(shot).toMatchObject({ mimeType: "image/jpeg", width: 1000, height: 800, scale: 1 });
    expect(captureClip().scale).toBe(1);
  });

  it("downscales a wide viewport to 1280 on a normal display", async () => {
    Object.assign(fake.layout, { cssWidth: 1600, cssHeight: 900, dpr: 1 });
    const tabId = await fake.addSproutTab("https://example.com/");

    const shot = await computer({ tabId, action: "screenshot" });

    expect(shot).toMatchObject({ width: 1280, height: 720, scale: 0.8 });
  });

  // BB-030: Page.captureScreenshot multiplies clip.scale by the device pixel
  // ratio, so a HiDPI display produced a 2560 px image labelled 1280.
  it("BB-030: stays within 1280 px on a HiDPI display", async () => {
    Object.assign(fake.layout, { cssWidth: 1600, cssHeight: 900, dpr: 2 });
    const tabId = await fake.addSproutTab("https://example.com/");

    const shot = await computer({ tabId, action: "screenshot" });

    // Real pixels = CSS width x clip.scale x DPR.
    expect(1600 * captureClip().scale * 2).toBe(1280);
    expect(shot).toMatchObject({ width: 1280, height: 720, scale: 0.8 });
  });

  it("BB-030: never upscales past CSS size on a HiDPI display", async () => {
    Object.assign(fake.layout, { cssWidth: 800, cssHeight: 600, dpr: 2 });
    const tabId = await fake.addSproutTab("https://example.com/");

    const shot = await computer({ tabId, action: "screenshot" });

    expect(captureClip().scale).toBe(0.5);
    expect(shot).toMatchObject({ width: 800, height: 600, scale: 1 });
  });
});
