import { send } from "../cdp/attach";
import { requireSproutTab } from "../lib/group";
import { ensureVerified } from "../lib/navigation";
import { assertPageAttachable } from "../lib/page";
import { assertUrlAllowed } from "../lib/settings";
import { requireString, requireTabId } from "./args";

/** Downscaled screenshots keep the payload small; the scale factor maps clicks back. */
const MAX_WIDTH = 1280;
const JPEG_QUALITY = 70;

interface Viewport {
  pageX?: number;
  pageY?: number;
  clientWidth: number;
  clientHeight: number;
}

/** `css*` fields are CSS pixels. The deprecated unprefixed `visualViewport` is device pixels. */
interface LayoutMetrics {
  cssVisualViewport?: Viewport;
  cssLayoutViewport?: Viewport;
  visualViewport?: Viewport;
}

export interface ScreenshotResult {
  image: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  /** Image pixels per CSS pixel, never above 1. CSS x = image x / scale. */
  scale: number;
}

/**
 * Device pixels per CSS pixel, read from the layout metrics rather than from
 * the page (`window.devicePixelRatio` is page-controlled). Falls back to 1.
 */
function devicePixelRatio(css: Viewport, device: Viewport | undefined): number {
  if (!device?.clientWidth) return 1;
  const ratio = device.clientWidth / css.clientWidth;
  return Number.isFinite(ratio) && ratio >= 0.5 && ratio <= 8 ? ratio : 1;
}

/** Phase 1 supports `computer {tabId, action:"screenshot"}` only. */
export async function computer(args: unknown): Promise<ScreenshotResult> {
  const tabId = requireTabId(args);
  const action = requireString(args, "action");

  if (action !== "screenshot") {
    throw new Error(`Unsupported computer action "${action}". Phase 1 supports only "screenshot".`);
  }

  const tab = await requireSproutTab(tabId);
  assertPageAttachable(tab);

  // A page can redirect itself into a blocked destination after the load event.
  if (tab.url) await assertUrlAllowed(tab.url);
  // And it can move while the debugger was detached; load it again under the guard if so.
  if (tab.url) await ensureVerified(tabId, tab.url);

  const metrics = await send<LayoutMetrics>(tabId, "Page.getLayoutMetrics");
  const viewport = metrics.cssVisualViewport ?? metrics.cssLayoutViewport;

  if (!viewport || !viewport.clientWidth || !viewport.clientHeight) {
    throw new Error(`Could not read the viewport size of tab ${tabId}.`);
  }

  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  // Image pixels per CSS pixel: at most 1, and at most 1280 px wide.
  const scale = Math.min(1, MAX_WIDTH / width);
  // Chrome multiplies clip.scale by the device pixel ratio, so divide it back
  // out or a HiDPI display returns twice the pixels (BB-030).
  const clipScale = scale / devicePixelRatio(viewport, metrics.visualViewport);

  const shot = await send<{ data: string }>(tabId, "Page.captureScreenshot", {
    format: "jpeg",
    quality: JPEG_QUALITY,
    captureBeyondViewport: false,
    clip: {
      x: viewport.pageX ?? 0,
      y: viewport.pageY ?? 0,
      width,
      height,
      scale: clipScale,
    },
  });

  if (!shot?.data) {
    throw new Error(`Chrome returned no screenshot data for tab ${tabId}.`);
  }

  return {
    image: shot.data,
    mimeType: "image/jpeg",
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale: Number(scale.toFixed(4)),
  };
}
