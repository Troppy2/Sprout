/**
 * Screenshot pixels -> CSS viewport pixels. Phase 1 screenshots return `scale`
 * (image px per CSS px, at most 1). CSS x = image x / scale.
 *
 * STARTER FILE (phase 3, step 3.1). Pure functions: write the unit test first.
 */

export interface Point {
  x: number;
  y: number;
}

/** TODO(3.1): divide by scale. Throw if scale is not finite or <= 0. */
export function toViewport(image: Point, scale: number): Point {
  throw new Error("TODO(3.1): toViewport");
}

/** TODO(3.1): throw a clear error when the point is outside 0..width / 0..height. */
export function assertInViewport(point: Point, width: number, height: number): void {
  throw new Error("TODO(3.1): assertInViewport");
}
