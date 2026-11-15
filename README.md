<div align="center">

# 🌱 Sprout

**Give any AI model your browser, one site and one capability at a time.**

An MCP server and Chrome extension that lets any MCP client (Claude Code, OpenCode, Codex, Cursor, Claude Desktop) see and use your real, logged-in Chrome, with permissions you grant per site.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange.svg)
![Chrome 120+](https://img.shields.io/badge/chrome-120%2B-4285F4.svg)
![Node 22+](https://img.shields.io/badge/node-22%2B-339933.svg)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Why Sprout](#why-sprout) · [How it works](#how-it-works) · [Quick setup](#quick-setup) · [Security](#security-model) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

> [!WARNING]
> Sprout is **pre-alpha**. It drives your real browser, where you are signed in to everything. Do not point it at accounts you care about yet. Use the local test pages in `server/fixtures/`.

## Why Sprout

Several tools already let an AI agent use your real browser. Most of them approve once, at connect time, and then the agent has every site you are signed in to.

Sprout starts from the opposite end:

- **Every site starts with no access.** The first time the agent needs a site, Sprout asks you in its own window.
- **Two levels per site.** *Look* allows screenshots and reading. *Act* also allows clicking and typing.
- **Risky actions always ask.** Send, buy, delete, post, and form submits need a confirm every time, even on a site you allowed to *Act*.
- **Stop always wins.** A Stop button and a shortcut (Alt+Shift+S) pause everything. Password and one-time-code fields pause the agent and hand control back to you.
- **Any model.** Sprout is a plain MCP server. The checks run in the extension, not in the prompt, so they hold even with a small or careless model.

## How it works

```
MCP client (Claude Code, OpenCode, Codex, Cursor...)
   │  MCP over stdio
Sprout server (Node)
   │  WebSocket on 127.0.0.1, pairing token, pinned extension origin
Sprout extension (Chrome MV3)
   │  gate: halted? tab in the Sprout group? site granted at this level?
   │  chrome.debugger (CDP), chrome.tabs, chrome.tabGroups
Your Chrome, inside a green "Sprout" tab group
```

- The agent only touches tabs in its own green **Sprout** tab group.
- It uses the Chrome DevTools Protocol through `chrome.debugger`, so clicks are real browser input, not injected scripts. Chrome shows a "started debugging this browser" banner while Sprout is attached.
- Tool names mirror Claude in Chrome (`tabs_context`, `navigate`, `computer`, `read_page`, `find`), so prompts written for it carry over.

## Features

| Tool | What it does | Status |
|------|--------------|--------|
| `ping` | Checks the extension is connected | ✅ |
| `tabs_context` | Lists the tabs in the Sprout group | ✅ |
| `tabs_create` | Opens a tab in the Sprout group | ✅ |
| `navigate` | Loads a URL, or goes back or forward | ✅ |
| `computer` screenshot | Captures the visible page | ✅ |
| Per-site grants + approve window | Look / Act per site, asked on first use | 🚧 MVP 1 |
| `read_page`, `find`, `get_page_text` | Reads the page as an accessibility tree or text | 🚧 MVP 1 |
| `computer` click / type / scroll / key | Acts on the page | 🚧 MVP 1 |
| Stop, halt, submit confirm | You stay in control | 🚧 MVP 1 |
| Overlay and agent cursor | Watch the agent work | 📋 Planned |

Already in place: a navigation guard that blocks redirects and iframes to local network addresses, blocks downloads from Sprout tabs, and refuses `file:`, `chrome:`, and other non-web schemes.

## Quick setup

Sprout is pre-alpha, so you build it from source. Requirements: Node 22+, Chrome 120+, and an MCP client.

```bash
git clone https://github.com/Troppy2/Sprout.git
cd Sprout
node scripts/setup.mjs
```

The script builds everything, wires Sprout into Codex if you use it, copies the pairing token to your clipboard, and opens Chrome's extensions page. Then:

1. In `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `extension/dist`.
2. Paste the token into the Sprout popup.
3. Restart your MCP client and check that Sprout is connected.

Ask your agent: *"Use Sprout to open example.com and take a screenshot."*

For other MCP clients, flags, troubleshooting, and the manual steps, see **[SETUP.md](SETUP.md)**.

Want your coding agent to handle setup? Copy the **[agent setup prompt](SETUP.md#have-an-agent-set-up-sprout)**, including instructions for OpenCode and a connection check.

### Test pages

```bash
cd server && npm run fixtures     # http://127.0.0.1:8787/
```

Sprout blocks local addresses by default. To use the test pages, set `SPROUT_ALLOW_PRIVATE_HOSTS=1` in your MCP client's `env` for Sprout, and run `chrome.storage.local.set({ allowPrivateHosts: true })` in the extension's service worker console.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `SPROUT_PORT` | `17373` | Bridge port. Set the same value in the extension: `chrome.storage.local.set({ port: N })` |
| `SPROUT_TOKEN_FILE` | `~/.sprout/token` | Where the pairing token lives |
| `SPROUT_ALLOW_PRIVATE_HOSTS` | unset | `1` lets Sprout open localhost and private network addresses |

## Security model

Sprout gives an AI model your signed-in browser, so it is built around what that model is allowed to do, not around trusting it.

**What Sprout enforces in code:**
- The bridge listens on `127.0.0.1` only and accepts only the Sprout extension with the pairing token.
- The agent only touches tabs in the Sprout tab group.
- Only `http:` and `https:` pages. Local network addresses, redirects to them, and downloads are blocked.
- Per-site Look / Act grants, set only by you, in the extension's own window *(MVP 1)*.
- Submit-class actions confirm every time; password fields and Stop pause everything *(MVP 1)*.

**What it does not do:**
- **Page content goes to your model.** Sprout sends screenshots and page text only to your local MCP client, but the client sends them to whatever model it uses. If that is a cloud model, your page content leaves your machine.
- **It does not stop prompt injection.** A page can try to talk the model into things. Sprout marks page text as untrusted and limits what the model *can* do, but on a site you allowed to *Act*, a fooled model can still click and type there.
- **It cannot close your client's other tools.** If your agent also has a shell or web access, a fooled model could use those.
- **It never solves CAPTCHAs** or tries to get past bot detection. It pauses and hands off to you. Respect each site's terms of service.

Found a vulnerability? Please report it privately. See [Reporting security issues](CONTRIBUTING.md#reporting-security-issues).

## Roadmap

- [x] **M1** Bridge, tabs, navigation, screenshots, navigation guard
- [ ] **M2** Per-site grants, central gate, approve window, page reading *(MVP 1)*
- [ ] **M3** Click, type, scroll, keys, Stop, halt, submit confirm *(MVP 1)*
- [ ] **M4** Overlay, agent cursor, CAPTCHA and payment detection
- [ ] **M5** Dialogs, forms, console and network reading, gated uploads
- [ ] **M7** Tested setup guides for each MCP client, several clients at once
- [ ] **M8** Native messaging (no open port)

## Contributing

Contributions are welcome, especially security reviews, test pages, and setup guides for MCP clients. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
