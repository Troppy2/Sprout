# Contributing to Sprout

Thanks for helping. Sprout drives people's real, signed-in browsers, so the bar for safety is higher than for most projects. Please read this whole page before opening a pull request.

## Ways to help

- **Security review.** Find a way around the gate, the grants, the navigation guard, or the pairing. This is the most valuable help.
- **Test pages.** Add fixture pages in `server/fixtures/pages/` for forms, iframes, dialogs, or injection attempts.
- **Client setup guides.** Confirm Sprout works in an MCP client and write down the exact steps.
- **Bugs.** Open an issue with steps to reproduce.

Before starting a new feature, open an issue to discuss it. New features, new tools, and new Chrome permissions are design decisions, and each permission is a trust cost for every user.

## Development setup

**Requirements:** Node 22 or newer, Chrome 120 or newer.

```bash
cd server && npm install && npm run build
cd ../extension && npm install && npm run build
```

Load `extension/dist` as an unpacked extension in `chrome://extensions` (Developer mode on). Rebuild and click reload on the extension after each change.

Local test pages:

```bash
cd server && npm run fixtures     # http://127.0.0.1:8787/
```

See the README for how to let Sprout open local addresses while testing.

## Before you open a pull request

Run all of these. Every one must pass.

```bash
cd server
npm run typecheck
npm run test:unit
npm run test:protocol

cd ../extension
npm run typecheck
npm test
npm run build
```

esbuild does not check types, so a passing build does not mean the code is correct. Always run `typecheck` too.

## Rules

These are checked in review. A pull request that breaks one will not be merged.

**Security**
- The bridge listens on `127.0.0.1` only and always requires the pairing token.
- Every tool call goes through the central gate in `extension/src/policy/gate.ts`. A new tool needs an entry in `TOOL_CLASS`, or the gate refuses it.
- The agent only acts in tabs inside the Sprout tab group.
- Grants change only from extension pages (the approve window and the popup). Nothing reachable from a tool call or a web page may change them.
- Page content, cookies, and screenshots go only to the local MCP client. Never add telemetry or a network call that sends them anywhere else.
- Never trigger `alert`, `confirm`, or `prompt` from the agent. Handle dialogs through CDP.
- Never solve CAPTCHAs, get past bot protection, or tune Sprout to avoid bot detection.
- Never commit secrets, tokens, or API keys.

**Code**
- TypeScript, strict mode.
- One tool = one handler in `extension/src/tools/` + one schema in `server/src/schemas.ts`. Tool names follow Claude in Chrome.
- Never use `console.log` in `server/src/`. Standard output carries the MCP protocol. Use `console.error`.
- Server imports between local files end in `.js` (`"./bridge.js"`), because the server uses Node's ESM rules.
- UI injected into pages lives in a closed shadow root and must not change the page's styles.
- Colors come from `extension/styles/tokens.css`. No hard-coded colors in components.
- No em dashes (U+2014) in any file. Use a comma, colon, period, or plain hyphen.

**Tests**
- Every bug fix comes with a test that fails before the fix.
- Test against the local fixture pages, never against real accounts. Never click delete, buy, send, or pay controls on a real site while testing.

## Pull requests

1. Fork the repo and create a branch from `feature` (not `main`).
2. Keep one change per pull request.
3. Open the pull request into `feature`. Maintainers rebase-merge `feature` into `main`.
4. Describe what changed, why, and how you tested it. Name any invariant the change touches (they are listed in the security section of the README).

## Reporting security issues

Please do not open a public issue for a vulnerability. Use GitHub's **private vulnerability reporting** (the "Report a vulnerability" button on the repository's Security tab). Include steps to reproduce and what an attacker could do. You will get a reply as soon as possible, and credit when it is fixed, if you want it.

## Code of Conduct

Everyone taking part agrees to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
