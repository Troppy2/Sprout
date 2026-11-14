import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeError, callExtension, rotateToken, startServer, tokenFilePath } from "./bridge.js";
import {
  computerInput,
  navigateInput,
  pingInput,
  tabsContextInput,
  tabsCreateInput,
} from "./schemas.js";

// Instructions are sent to the client during the MCP handshake. They teach the
// model how to behave, not just which tools exist. Keep this list in step with
// the tools that are actually registered (BB-010).
const INSTRUCTIONS = `You drive the user's real Chrome browser through the Sprout extension. Work like a careful human browsing on the user's behalf.

Before acting:
- Call tabs_context to see what is open in the Sprout group, open a tab with tabs_create, then navigate it.
- Look at the page with computer {action:"screenshot"} before you report what is on it.
- Wait for pages to finish loading before you act.

After acting:
- Verify the result with another screenshot. Do not assume a click or navigation worked.
- If a tool fails, report the error plainly. Do not guess or silently retry.

Safety:
- Ask the user before anything that buys, sends, deletes, publishes, or shares personal information.
- Never type passwords, one-time codes, or payment details. Stop and hand off to the user.
- Never solve CAPTCHAs or bypass bot protection.
- Respect site terms of service. If a site prohibits automated access, stop and hand off.

Stay inside the Sprout tab group unless the user explicitly hands you another tab.`;

const server = new McpServer(
  { name: "sprout", version: "0.1.0" },
  { instructions: INSTRUCTIONS },
);

/** Base64 bytes. 8MB is far above a 1280px JPEG q70 and well under the frame cap. */
const MAX_SCREENSHOT_BASE64 = 8_000_000;

type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

/** Turns bridge failures into something the model can act on (BB-011). */
function toErrorResult(error: unknown) {
  if (error instanceof BridgeError) {
    if (error.code === "extension_not_connected") {
      return errorResult(
        "Sprout extension not connected. Open Chrome with the Sprout extension enabled, then try again.",
      );
    }
    if (error.code === "invalid_port") {
      return errorResult("Sprout could not start: the bridge port is invalid. Check SPROUT_PORT.");
    }
    return errorResult(`Sprout bridge error (${error.code}): ${error.message}`);
  }

  return errorResult(`Sprout error: ${error instanceof Error ? error.message : String(error)}`);
}

function describeUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "ok";
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asTabList(value: unknown) {
  if (!Array.isArray(value)) {
    throw new BridgeError("invalid_response", "The extension did not return a tab list.");
  }
  return value.map((tab) => {
    if (!isRecord(tab)) {
      throw new BridgeError("invalid_response", "The extension returned a malformed tab entry.");
    }
    return {
      tabId: Number(tab.tabId),
      url: typeof tab.url === "string" ? tab.url : "",
      title: typeof tab.title === "string" ? tab.title : "",
    };
  });
}

// A round trip to the extension. Proves the stdio side, the bridge, and the
// service worker are all wired together.
server.registerTool(
  "ping",
  {
    title: "Ping",
    description:
      "Check that the Sprout extension is connected. Returns pong from the browser.",
    inputSchema: pingInput,
  },
  async ({ message }) => {
    try {
      const result = await callExtension({
        tool: "ping",
        args: message === undefined ? {} : { message },
      });
      return textResult(describeUnknown(result));
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "tabs_context",
  {
    title: "Tabs context",
    description:
      "List the tabs the agent may touch. Only tabs in the green Sprout group are returned.",
    inputSchema: tabsContextInput,
  },
  async () => {
    try {
      const tabs = asTabList(await callExtension({ tool: "tabs_context" }));

      if (tabs.length === 0) {
        return textResult("No Sprout tabs are open. Use tabs_create to open one.");
      }

      const lines = tabs.map((tab) => `- tabId ${tab.tabId}: ${tab.title || "(no title)"} - ${tab.url}`);
      return textResult(`Sprout tabs:\n${lines.join("\n")}`);
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "tabs_create",
  {
    title: "Create tab",
    description:
      'Open a new tab inside the green Sprout group. Use it before navigate. Only http: and https: URLs are allowed (default "about:blank").',
    inputSchema: tabsCreateInput,
  },
  async ({ url }) => {
    try {
      const result = await callExtension({
        tool: "tabs_create",
        args: url === undefined ? {} : { url },
      });

      if (!isRecord(result) || typeof result.tabId !== "number") {
        throw new BridgeError("invalid_response", "The extension did not return the new tab id.");
      }

      return textResult(
        `Opened tab ${result.tabId}${typeof result.url === "string" ? ` at ${result.url}` : ""} in the Sprout group.`,
      );
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "navigate",
  {
    title: "Navigate",
    description:
      'Load an http: or https: URL in a Sprout tab, or pass "back" / "forward". Waits for the load event, then returns the final URL and title.',
    inputSchema: navigateInput,
  },
  async ({ tabId, url }) => {
    try {
      const result = await callExtension({ tool: "navigate", args: { tabId, url } });

      if (!isRecord(result)) {
        throw new BridgeError("invalid_response", "The extension did not return the navigation result.");
      }

      const finalUrl = typeof result.url === "string" ? result.url : url;
      const title = typeof result.title === "string" ? result.title : "(no title)";
      return textResult(`Navigated to ${finalUrl}\nTitle: ${title}`);
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

server.registerTool(
  "computer",
  {
    title: "Computer",
    description:
      "Take a screenshot of a Sprout tab. The image is downscaled to at most 1280px wide and returned with its scale factor so coordinates map back.",
    inputSchema: computerInput,
  },
  async ({ tabId }) => {
    try {
      const result = await callExtension({ tool: "computer", args: { tabId, action: "screenshot" } });

      if (!isRecord(result) || typeof result.image !== "string") {
        throw new BridgeError("invalid_response", "The extension did not return screenshot data.");
      }

      if (result.image.length > MAX_SCREENSHOT_BASE64) {
        throw new BridgeError("invalid_response", "The extension returned a screenshot larger than Sprout allows.");
      }

      const width = Number(result.width);
      const height = Number(result.height);
      const scale = Number(result.scale);

      const content: ToolContent[] = [
        // Pinned format: never let the extension choose what the client renders.
        { type: "image", data: result.image, mimeType: "image/jpeg" },
        {
          type: "text",
          text: `Screenshot of tab ${tabId}: ${width}x${height}px, scale ${scale}. Coordinates in the image divide by ${scale} to map back to CSS pixels.`,
        },
      ];

      return { content };
    } catch (error) {
      return toErrorResult(error);
    }
  },
);

async function main(): Promise<void> {
  // `node dist/index.js --rotate-token`: replace the pairing token and exit.
  // The token is not printed (SEC-004); the user copies it from the file.
  if (process.argv.includes("--rotate-token")) {
    rotateToken();
    console.error(`Sprout wrote a new pairing token to ${tokenFilePath()}.`);
    console.error("Paste the file's contents into the Sprout extension popup. The old token no longer works.");
    process.exit(0);
  }

  try {
    startServer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // The MCP client owns our lifetime. The bridge socket keeps the event loop
  // alive, so without this an orphaned server holds the port and the next
  // client fails with "already in use" (BB-027).
  const shutdown = () => process.exit(0);
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);

  const transport = new StdioServerTransport();
  transport.onclose = shutdown;
  await server.connect(transport);
  console.error("Sprout MCP server ready on stdio");
}

main().catch((error) => {
  console.error("Sprout failed to start:", error);
  process.exit(1);
});
