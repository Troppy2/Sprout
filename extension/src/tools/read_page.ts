/**
 * read_page {tabId, filter?: "interactive", ref?}
 * Output, one line per node: `ref_12 button "Sign in" [disabled]`, indented by depth,
 * wrapped by security/untrusted.ts.
 *
 * STARTER FILE (phase 2, step 2.7). Not registered in tools/index.ts yet: add it
 * there, in policy/gate.ts TOOL_CLASS (already listed), and in server/src/schemas.ts
 * + index.ts when it works.
 */
export async function readPage(args: unknown): Promise<string> {
  throw new Error("TODO(2.7): read_page");
}
