English | [中文](README.md)

# dsh-kit

A page-capability kit plugin for DeepSeek Harness (dsh): optional add-ons for the
dsh browser UI, each independent and dependency-free; with none used, dsh stays stock.

## Features

The workbench lives in the **official right sidebar** (host 0.1.5+, `sidebar.right`):
one dock tab each for Diff / Knowledge base / Schedule / Background tasks / Browser,
with document tabs inside the Knowledge base tab (one per page). Workspace files are
viewed through the **official file preview** (kit adds a "Download" button to its
header); there is no in-plugin editing of workspace files — edit in VS Code or let
the agent do it.
Index views (file tree, source control, vault directory) share a single left-sidebar
slot; the conversation column stays put.

- **Terminal** (composer-row toggle / **Ctrl+/**): a tabbed bottom terminal dock
  bound to the session it was opened in (width follows the chat column); hidden
  docks keep running; powered by the **official webTerminals service** (host-owned
  PTY: system-user permissions, survives page refreshes, shell selection) —
  requires DSH 0.1.6+
- **File tree** (composer-row toggle / **Ctrl+,**): browse the session workspace;
  create/rename/delete (to Recycle Bin)/copy path / @-mention to chat; clicking a file
  opens it in the **official right-sidebar preview**, while md pages inside the vault
  go to the read-only knowledge-base reader
- **Source control** (composer-row toggle / **Ctrl+Alt+.**): an in-page git
  workbench — stage/unstage/discard/commit, click a file to see its diff in a
  right-dock diff tab (full-file coloring; pin any commit from the graph to diff
  against it), branch switch/create/delete, ↑↓ sync (pull then push), commit graph;
  one-click repo init for non-git directories
- **Schedule** (entry from the right-dock start page and the task card; no composer
  toggle and no dedicated shortcut): todos on the left, weekly grid + stats on the
  right; the agent gets read-only `schedule_query` and `schedule_create`; data is
  stored in `$DSH_HOME/dsh-kit/schedule.json`
- **Knowledge base** (composer-row toggle / **Ctrl+Alt+K**, off by default): ready out
  of the box (data-directory `dsh-kit\vault`, configurable absolute path) — a **read-only
  reading surface**: pick pages from the left tree, read them as document tabs inside the
  right-dock **Knowledge base** tab (multiple tabs, ✕ per tab); `[[wikilinks]]` with
  back/forward (`[[page#heading]]` lands on the section), a sticky reading bar with
  outline & backlinks menus, and full-text search (filename-weighted); chat integration
  (vault paths in chat open the page, "@" on a tree row cites page/selection); the vault
  is a plain md directory the plugin only reads (it creates no directories and never
  touches git); writing belongs to the agent's file tools or your local editor
- **Background tasks** (entry from the right-dock start page and auto-follow): lists the
  session's running background jobs, with output viewing and job termination
  (official `job_output`/`job_kill` semantics). Output stays visible per job inside a
  retained window (latest 2MB), so a page refresh or a second tab re-reads it instead of
  losing it, and never steals output from the model's `job_output`; closing a settled row
  removes it and releases that window (a reload then shows the row with no content)
- **Built-in browser** (right-dock Browser tab, on by default): the agent drives the
  system Edge via **7** `browser_*` tools (vendored playwright-core, dedicated
  persistent profile) — snapshot → act → assert GUI-testing loops, screenshots
  (attached directly for multimodal models, saved to disk otherwise); the panel shows
  the agent's browser live — your clicks/wheel/keys act on the very page the agent is
  operating (shared control); every agent navigation brings the tab to the front
- **Skill pool** (new Settings page): workspace / user-level / skill-pool groups
  with copy, move, delete, disable/enable; shadowed same-name skills get a dashed badge
- **Phone access** (new Settings page): scan a QR code to reach the local dsh web —
  token-gated gateway (default port 3090, editable), off on every startup by default;
  LAN and remote dual links, full HTTP/WS passthrough
- **Web search** (merged from dsh-free-search): a keyless engine chain replaces the
  paid `deepseek-official` — specialized engines first when the query matches
  (GitHub / arXiv / StackExchange / HN), then the general ones (Tavily keyless → Bing →
  Sogou) with automatic failover; toggle and result count via the settings card
- **Session monitor** (on by default): after a turn ends in a retryable error (429 etc.)
  it waits and sends "continue" automatically (capped consecutive retries) — every
  session is watched, so it keeps going while the page is in the background; only the
  failure that actually ended that turn counts, so a stale 429 left over from a turn
  that finished (or one you stopped by hand) is never continued; when the streamed
  output repeats itself (a loop symptom) it stops the turn and retries (that part only
  applies to the currently open session); a banner above the composer shows the pending
  action and can cancel it
- **Session notifications** (on by default; one switch covers every alert): a desktop notification when a turn finishes,
  context compaction completes, or the agent asks a question / awaits tool approval /
  submits a plan for review (browser Notification API; click it to return to that
  session) — fires while the page sits in a background tab or another window, or when the
  event belongs to a session you are not looking at; silent while you are watching that
  very session. Auto-continue retries never report a bogus "finished" (you are told only
  once it really stops); compaction alerts cover sessions you have opened (the official
  client loads history only for the current session, so a never-opened session's
  compaction is invisible). Permission is requested from the settings card (without it an
  unread count is shown in the tab title instead)
- **Settings card**: dsh-kit config card — per-feature switches, shortcut
  customization (terminal / file tree / source control / knowledge base / both
  sidebars), hide-the-official-Workspace-Files-entry, search result count, vault directory,
  monitor parameters, session notifications and their
  permission, phone access

## Install & update

Install the latest release (recommended):

```bash
dsh plugin --profile web add "github:zhouzhencheng07/dsh-kit#semver:*"
```

Or track the latest commit on main:

```bash
dsh plugin --profile web add "github:zhouzhencheng07/dsh-kit"
```

Update to the latest version:

```bash
dsh plugin --profile web update dsh-kit
```

The package declares `dsh.bundle.patch`, so it is activated as a profile bundle
layer. After installing/updating, restart `dsh web`: four toggles — Files / Source
Control / Knowledge base / Terminal — appear on the composer tool row, the workbench
is carried by the official right sidebar (five dock tabs), and the agent's
`web_search` uses the free multi-source chain.

**Host requirement**: dsh ≥ 0.1.5 (the official right-sidebar service
`sidebar.right`). On older hosts the plugin still loads, but no workbench tabs
appear and the toggles have nothing to open — upgrade dsh first.

## How it works

- `src/*.ts` → `dist/` (committed tsc output): host side — `/tree`, `/read`, `/raw`
  (Range/206), `/fs/op`, `/upload`, `/git/*`, `/browser` (built-in browser WS),
  `/jobs/*`, `/schedule/*`, `/vault/*`, `/skills`, `/phone/*` endpoints
- `client/bundle.js`: browser side (hand-written ModuleLoader bundle, **no build**) —
  four toggles on `conversation.input.left`; five dock tab types registered on
  `sidebarRightTabs` with pane bodies served through `sidebar.right.pane.tab`; the
  terminal dock renders over the official `webTerminals` engine; settings card on
  the plugin manager's `plugins.bundle.config` slot
- `client/vendor/*`: xterm / TipTap rich text / KaTeX / qrcode, all lazily loaded
  and served from `/dsh-kit/vendor/*`
- `src/web-search.ts` + `src/engine-chain.ts` + `src/engines/*`: registers the
  `free-search` provider on the web seam, gated by the settings card's `searchEnabled`
- `cordis.patch.yml`: inserts the dsh-kit row into the bundle layer and rewrites
  the web row's `searchProvider` to `free-search`
- Host-side `node-pty`/`ws`/`@deepseek-ai/*` declare no dependencies: resolved at
  runtime from the profile fallback node_modules (declaring them would install a
  second copy)

## Requirements

- dsh ≥ 0.1.5 (official right sidebar)
- Node.js ≥ 22 (dsh requirement)
- Zero declared dependencies; TypeScript sources + prebuilt `dist` on the host side,
  no build step on the browser side

## License

MIT
