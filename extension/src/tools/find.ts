/**
 * find {tabId, query}: top 5 refs whose role + name best match the query.
 *
 * Plain scoring, no model (blind-spots BS-C3): lowercase, split on non-letters,
 * score = shared words + a bonus when the query names the role ("button",
 * "link", "box"). Ties keep page order. Zero matches returns an empty list with
 * a hint to call read_page. Never invent a ref.
 *
 * STARTER FILE (phase 2, step 2.9).
 */

/** TODO(2.9): pure function, unit test it first. */
export function score(query: string, role: string, name: string): number {
  throw new Error("TODO(2.9): score");
}

export async function find(args: unknown): Promise<string> {
  throw new Error("TODO(2.9): find");
}
