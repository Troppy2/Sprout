# AGENTS.md: Working Instructions for Sprout

Never commit or push anything to GitHub without my explicit approval, and never include `Co-Authored-By:` lines in commit messages.

## What Sprout Is

Sprout is a Codex-in-Chrome style browser agent that **any** MCP-capable model can use (OpenCode, Codex, Cursor, Codex, etc.). The agent drives the user's real, logged-in Chrome: it opens tabs in its own Chrome tab group, reads pages, clicks, types, and takes actions, while a green-hue overlay and a visible agent cursor show the user what it is doing. Visual identity follows Nosey's green palette (see `design/design-tokens.md`).

Not Playwright: Playwright launches and controls a separate automation browser. Sprout is a Chrome extension attached to the user's own browser via `chrome.debugger` (CDP).

## Branching & Deployment Workflow

Default flow is **`feature` -> `main`**, one direction only.

1. Work happens on short-lived feature/fix branches. Open a **PR into `feature`** (never directly into `main`). One feature per PR.
2. The user **manually merges + rebases `feature` into `main`**. Codex does not touch `main` directly.
3. Rebase merges only (`gh pr merge --rebase`), no merge commits.

Rules:
- `feature` must always be at or ahead of `main`. If it falls behind, reset it to `main` (`git branch -f feature origin/main` + force-push, with approval).
- Open PRs with `gh`, base = `feature`. Do not merge them yourself.
- Delete feature/fix branches once contained in `main` (`git cherry origin/main <branch>` all `-`). Keep `main` and `feature`.
- Pushing and opening PRs require the user's approval.

## How to Use the .Codex Folder

Full map, per-folder thinking, and routing table: **`.Codex/README.md`**. Read it when unsure where something lives or goes.

Layout in one glance: `rules/` (always/never) · `design/` (architecture, tools, tokens, invariants, decisions) · `docs/` (`reference/` plumbing, `features/` per feature, `phases/` per finished phase) · `plans/` (todo, `tracks/` per-phase build tracks, `handoffs/`) · `bugs/` (logs, `fixes/`, `failures.md`) · `security/` · `notes/` (changelog) · `agents/` · `hooks/`.

Habits:
- Read the folder's README or index first, then only the files the task needs. Do not read whole folders.
- Precedence if files disagree: `rules/` > `design/` > `plans/` > `docs/` > `notes/`.
- Logs (`notes/`, `bugs/bug-log.md`, `security/review-log.md`, `bugs/failures.md`) are append-only. Decisions are a dated table: add a row, mark old ones superseded.
- Nothing in `.Codex/` is recoverable from git (it is gitignored). Back up before bulk moves, and never delete without agreement.

### Always read (every session)
- `.Codex/notes/INDEX.md`
- `.Codex/rules/rules-gotchas.md`

### What to read for the task
| Task | Read first | Also read if relevant |
|------|-----------|-----------------------|
| User says "start phase N" | `plans/tracks/README.md`, `plans/tracks/phase-N-*/track.md` | `plans/todo.md`, the phase's feature doc |
| User says "phase N done" | `plans/tracks/phase-N-*/handoff.md`, `rules/hand-written-code.md` | `docs/reference/testing.md`, `design/invariants.md` |
| First session, or "why is it built this way" | `notes/origin-conversation.md`, `design/decisions.md` | |
| Touching extension, bridge, or server | `design/architecture.md` | `design/invariants.md` |
| Adding or changing an MCP tool | `design/tools.md` | `docs/features/README.md` |
| Overlay, cursor, popup, or tab-group UI | `design/design-tokens.md` | |
| Touching an existing feature | `docs/features/README.md`, then its `docs/features/<slug>.md` | |
| Fixing a bug | `bugs/bug-log.md`, `bugs/pre-loop-bugs.md` | `bugs/failures.md`, `bugs/README.md` |
| Retrying something that failed before | `bugs/failures.md` | |
| Security work or a release gate review | `security/README.md` | `security/security_issues.md` (search by ID), `security/pre_launch_checklist.md` |
| A page-reading tool, or any download or script path | `security/prompt_injection_defense.md` | `security/safety_bypass_matrix.md` |
| Any destructive operation | `rules/destructive-actions-log.md` | |
| Dependency, config, or manifest change | `docs/reference/README.md` | |
| User mentions a feature term | `notes/keywords.md` | |
| Choosing what to build next | `plans/todo.md` | `plans/future-features.md` |
| Picking up a handoff | `plans/handoffs/` (the named file) | |

### What to write after the task
- **Every change:** entry in the current week's `notes/session-notes-vN.md` AND a one-line row in `notes/INDEX.md`.
- **Weekly notes:** one file per week (Monday to Sunday), header `# Session Notes vN (YYYY-MM-DD to YYYY-MM-DD)`. On the first change of a new week, create the next `vN`, move the previous file into `notes/archive/`, and point new INDEX rows at the new file. v1 = 2026-10-26 to 2026-11-01.
- **Every feature (new or changed):** write or update `docs/features/<slug>.md` using the template in `docs/features/README.md`, and add it to that index. Mandatory, every time.
- **Rollback or failure:** post-mortem in `bugs/failures.md`.
- **Review finding:** row in `bugs/bug-log.md` (and `security/review-log.md` if security), failing test, fix explanation in `bugs/fixes/<ID>.md`.
- **Phase gate green:** `docs/phases/phase-N.md`, update its index.
- **Dependency or config change:** update `docs/reference/` (high level + under the hood) and name the doc in one line.
- **New permanent rule or trap:** `rules/rules-gotchas.md`.
- **Design decision:** new row in `design/decisions.md`.

## Project Layout (planned)

```
Sprout/
├── extension/                 # Chrome MV3 extension
│   ├── manifest.json
│   ├── src/
│   │   ├── background.ts      # Service worker: bridge client, CDP, tab group
│   │   ├── cdp/               # chrome.debugger wrappers (input, page, a11y, dom)
│   │   ├── tools/             # One handler per MCP tool
│   │   ├── content/           # Overlay + agent cursor (injected), shadow DOM
│   │   └── popup/             # Connect status, stop button
│   └── styles/tokens.css      # Shared color tokens (Nosey greens)
├── server/                    # Node MCP server (stdio) + bridge
│   ├── src/
│   │   ├── index.ts           # MCP stdio entry, tool registry
│   │   ├── bridge.ts          # WebSocket (v1) / native messaging (v2) to extension
│   │   └── schemas.ts         # Tool input schemas (zod)
│   ├── fixtures/              # Local test pages
│   └── package.json
├── native-host/               # Native messaging manifest + Windows registry install script (v2)
└── .Codex/                   # See .Codex/README.md
```

## Conventions

- TypeScript everywhere, strict mode.
- One tool = one handler file in `extension/src/tools/` + one schema in `server/src/schemas.ts`. Tool names and shapes mirror Codex in Chrome (`tabs_context`, `navigate`, `computer`, `read_page`, `find`, `form_input`, `javascript`, `read_console_messages`, `read_network_requests`) so agents prompted for Codex in Chrome transfer over.
- The MCP server is model-agnostic. Never assume a specific client; test with at least OpenCode and one other client.
- The agent only touches tabs inside the Sprout tab group unless the user explicitly hands it a tab.
- All UI injected into pages lives in a closed shadow root, never leaks CSS into the host page, and is `pointer-events: none` except the stop pill.
- Colors come from `styles/tokens.css`. No hardcoded hex in components.

## Forbidden Practices

- Never use em dashes (U+2014) in any file. See `rules/no-emdash.md`.
- Never expose the bridge on anything but `127.0.0.1`. Always require a pairing token.
- Never trigger `alert/confirm/prompt` from the agent; handle dialogs via `Page.handleJavaScriptDialog`.
- Never send page content, cookies, or screenshots anywhere except back to the local MCP client.
- Never delete files without explicit discussion and agreement.
- Never hardcode secrets or tokens.
- Never solve or bypass CAPTCHAs or bot protection, and never tune Sprout to evade bot detection. Pause and hand off to the user.
- Respect site TOS: if a site prohibits automated access, refuse or hand off (e.g. LinkedIn).
- Never `console.log` in `server/src/`: stdout is the MCP channel. Log with `console.error`.

## New Feature Workflow (Grill Me First)

Before implementing any new feature, interview the user one question at a time (use AskUserQuestion), giving a recommended answer for each:
- User-facing goal? Which tool(s) and which layer (extension, bridge, server)?
- Does it need new Chrome permissions? (Each permission is a trust cost.)
- Happy path end to end, error cases, how the overlay reflects it.
- Open questions or blockers.

No code until the tree is resolved and the user says go. Then the user builds the core logic and Codex writes the plumbing. See `rules/hand-written-code.md` and `plans/tracks/README.md`.

## Who Writes What (summary of `rules/hand-written-code.md` v2)
- **User:** builds each phase, including boilerplate, following `plans/tracks/phase-N-*/track.md`. Their job ends at that phase's "Your done line", then they say "phase N done".
- **Codex:** reviews (`/cleaner` + `/security-review`), logs findings (`bugs/bug-log.md`, `security/review-log.md`), writes a failing test per finding, patches, explains each fix in `bugs/fixes/<ID>.md`, writes `docs/phases/phase-N.md` when the gate is green. Also deps, config, manifest, UI CSS, fixtures, docs.
- Load `extension/dist` (not `extension/`) as the unpacked extension.

## Testing Approach

- Manual: load the unpacked extension (`chrome://extensions`, developer mode), run the server, connect from OpenCode, drive a fixture page.
- Keep local fixture pages (`server/fixtures/`) with forms, iframes, dialogs, long lists, for repeatable checks.
- Verify every UI change (overlay, cursor, popup) on light and dark pages and at narrow widths.
- Layers and commands: `docs/reference/testing.md`.

## Communication

Be concise. Finding first, then fix. No preamble, no closers.
