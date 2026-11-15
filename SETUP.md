# Setting up Sprout

Sprout is pre-alpha and not on a store yet, so you build it from source. This page covers the full setup. For the short version, see the [README](README.md#quick-setup).

## Requirements

- Node 22 or newer
- Chrome 120 or newer
- An MCP client (Claude Code, OpenCode, Codex, Cursor, Claude Desktop)
- Windows, macOS, or Linux

## Quick setup (any OS)

```bash
git clone https://github.com/Troppy2/Sprout.git
cd Sprout
node scripts/setup.mjs
```

The script:

1. Installs packages and builds the extension and the server.
2. Checks for the pairing token at `~/.sprout/token`.
3. Adds Sprout to the Codex config, if you have one. It backs up the file first to `config.toml.bak-sprout`. Re-running it replaces the Sprout entry and nothing else.
4. Copies the token to your clipboard and opens `chrome://extensions` and the `extension/dist` folder.

Then finish three steps by hand. Chrome does not let scripts load extensions, so these stay manual:

1. In `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `extension/dist`. Do not choose `extension/`.
2. Open the Sprout popup and paste the token from your clipboard.
3. Restart your MCP client and check that Sprout is listed and connected.

If the script says there is no token yet, start the MCP client once (it starts the server and creates the token), then run the script again.

Flags:

| Flag | Effect |
|------|--------|
| `--no-open` | Build and configure only. Do not copy the token or open Chrome and Explorer. |
| `--no-codex` | Skip the Codex config step. |

## Have an agent set up Sprout

Paste this into an agent that can run terminal commands and edit local files, such as OpenCode, Codex, Claude Code, or Cursor. Replace the client name and install folder first.

```text
Set up Sprout for me on this computer.

My MCP client: OpenCode
Install folder: [absolute path where I want Sprout, or my existing clone]
Repository: https://github.com/Troppy2/Sprout.git

1. Check that Node 22+ and Chrome 120+ are installed. If either is
   missing, explain what I need to install before continuing.
2. Use my existing Sprout clone if present; otherwise clone the repository
   into the install folder. Read SETUP.md and scripts/setup.mjs first.
   Preserve existing work and do not commit or push anything.
3. Run node scripts/setup.mjs for Codex. For another client, run
   node scripts/setup.mjs --no-codex so it does not change Codex's config.
4. Configure Sprout as a local stdio MCP server in my chosen client.
   Use command "node" and the absolute path to server/dist/index.js.
   Check the client's current official MCP documentation for its config
   location and schema. Do not assume OpenCode uses mcpServers.
   Back up any existing config before editing, preserve other entries,
   and avoid adding a duplicate Sprout server.
5. Tell me when to restart the client so it starts the server and creates
   ~/.sprout/token. If the token was missing during setup, rerun the script
   after the server starts, using --no-codex for clients other than Codex.
   Keep the pairing token out of chat, logs, and committed files. Let me
   copy it locally or use the setup script's clipboard step.
6. Hand me the manual Chrome steps with the absolute extension/dist path:
   open chrome://extensions, enable Developer mode, choose Load unpacked,
   select extension/dist, then paste the token into the Sprout popup.
   Wait for me to finish these steps and restart the client as needed.
7. When Sprout tools are available, call ping, then tabs_context,
   tabs_create, navigate to https://example.com, and computer with
   action "screenshot". Inspect the screenshot to verify it worked.
   Use Sprout for this check, in its own tab group.
8. Report what succeeded and any remaining blocker. If this session cannot
   see newly added MCP tools until a restart, give me a resume prompt.
   Do not claim the browser connection works until a Sprout call succeeds.
```

The agent handles the build and client configuration. You handle loading the unpacked extension, pasting the token, and restarting the client. Sprout currently supports connection checks, tabs, navigation, and screenshots; clicking and typing are still planned.

After restarting, paste this to finish verification:

```text
Finish verifying my Sprout setup. Use Sprout to ping the extension,
list its tabs, create a tab, navigate to https://example.com, and take
and inspect a screenshot. Report any tool error and the next setup step.
```

## Manual setup

Use this if the script fails or you use a client other than Codex.

### 1. Build

```bash
cd server && npm install && npm run build && cd ..
cd extension && npm install && npm run build && cd ..
```

### 2. Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose `extension/dist`.

### 3. Add the server to your MCP client

Replace the path with the absolute path to your clone.

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.sprout]
command = "node"
args = ['C:\Users\you\Desktop\Sprout\server\dist\index.js']
```

Use single quotes around Windows paths so the backslashes are kept as written.

**Clients that use `mcpServers`** (for example Claude Code and Cursor):

```json
{
  "mcpServers": {
    "sprout": {
      "command": "node",
      "args": ["/absolute/path/to/Sprout/server/dist/index.js"]
    }
  }
}
```

Check your client's docs for the file location and schema. For OpenCode, use its local MCP server configuration rather than pasting this `mcpServers` example; the agent prompt above includes that check.

### 4. Pair the extension

The server creates a pairing token the first time it runs.

1. Find the token file: `~/.sprout/token` (on Windows, `%USERPROFILE%\.sprout\token`).
2. Copy its contents.
3. Open the Sprout popup in Chrome and paste the token.

The server never prints the token to logs. To replace it, run:

```bash
node server/dist/index.js --rotate-token
```

After rotating, paste the new token into the popup. The old one stops working.

### 5. Try it

Ask your agent: *"Use Sprout to open example.com and take a screenshot."*

If Sprout is listed but says it is not connected, the extension is not paired yet. Check step 4.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Client says Sprout is enabled but not authenticated, or tools are missing | The extension is not paired. Paste the token into the popup (step 4). |
| Popup says not connected | Restart the MCP client so the server runs. Check that the port matches (default 17373). |
| `invalid_port` at startup | `SPROUT_PORT` is out of range. Use a number from 1 to 65535. |
| Clicking "Load unpacked" picks the wrong folder | Choose `extension/dist`, not `extension/`. |
| Changes to the code have no effect | Rebuild (`npm run build` in `server/` and `extension/`), then reload the extension in `chrome://extensions`. |
| Setup script can't find Codex | Codex is not installed, or its config is not at `~/.codex/config.toml`. Use the manual steps instead. |

## Test pages

```bash
cd server && npm run fixtures     # http://127.0.0.1:8787/
```

Sprout blocks local and private network addresses by default. To use the test pages:

1. Set `SPROUT_ALLOW_PRIVATE_HOSTS=1` in your MCP client's `env` for Sprout.
2. In the extension's service worker console (`chrome://extensions`, Sprout, *service worker*), run:

   ```js
   chrome.storage.local.set({ allowPrivateHosts: true })
   ```

Turn these off again when you are done.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `SPROUT_PORT` | `17373` | Bridge port. Set the same value in the extension: `chrome.storage.local.set({ port: N })` |
| `SPROUT_TOKEN_FILE` | `~/.sprout/token` | Where the pairing token lives |
| `SPROUT_ALLOW_PRIVATE_HOSTS` | unset | `1` lets Sprout open localhost and private network addresses |

## Security notes for setup

- The bridge listens on `127.0.0.1` only. Do not expose it on other interfaces.
- Keep the token private. Anyone with it can pair an extension with your server.
- Your Codex config may hold other API keys. Do not share or commit it.
