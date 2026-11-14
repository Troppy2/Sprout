/**
 * Trusted input through CDP. Every function here is called from ONE place:
 * runAction in tools/computer.ts, after the gate, the halt check, the sensitive
 * check and the submit check have passed.
 *
 * STARTER FILE (phase 3, steps 3.3 and 3.4).
 */
import type { Point } from "./coords";

export type MouseButton = "left" | "right";

/** TODO(3.3): Input.dispatchMouseEvent mouseMoved, mousePressed, mouseReleased. */
export async function click(tabId: number, at: Point, button: MouseButton, clickCount: 1 | 2): Promise<void> {
  throw new Error("TODO(3.3): click");
}

/** TODO(3.3): mouseWheel at the point. Positive deltaY scrolls down. */
export async function wheel(tabId: number, at: Point, deltaX: number, deltaY: number): Promise<void> {
  throw new Error("TODO(3.3): wheel");
}

/** TODO(3.4): Input.insertText. The caller has already focused the field. */
export async function insertText(tabId: number, text: string): Promise<void> {
  throw new Error("TODO(3.4): insertText");
}

/**
 * TODO(3.4): parse "Enter", "Tab", "ctrl+a", "shift+Tab" into key + modifiers
 * (Alt=1, Ctrl=2, Meta=4, Shift=8), then keyDown and keyUp. Unknown keys throw.
 */
export async function pressKey(tabId: number, combo: string): Promise<void> {
  throw new Error("TODO(3.4): pressKey");
}
