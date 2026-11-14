/**
 * The tool registry. One tool, one file. Adding a tool means adding one import
 * and one map entry here, plus a schema in `server/src/schemas.ts`.
 */
import { computer } from "./computer";
import { navigate } from "./navigate";
import { ping } from "./ping";
import { tabsContext } from "./tabs_context";
import { tabsCreate } from "./tabs_create";

export type ToolHandler = (args: unknown) => Promise<unknown> | unknown;

const tools = new Map<string, ToolHandler>([
  ["ping", ping],
  ["tabs_context", tabsContext],
  ["tabs_create", tabsCreate],
  ["navigate", navigate],
  ["computer", computer],
]);

export function getToolHandler(name: string): ToolHandler | undefined {
  return tools.get(name);
}
