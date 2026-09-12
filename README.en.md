English | [中文](README.md)

# dsh-kit

A page-capability kit plugin for DeepSeek Harness (dsh): optional add-ons for the
dsh browser UI, each independent and dependency-free; with none used, dsh stays stock.

## Features

The workbench lives in the **official right sidebar** (host 0.1.5+, `sidebar.right`):
one dock tab each for Files / Knowledge base / Schedule / Background tasks / Browser,
with document tabs inside a tab (one per file, one per knowledge-base page).
Index views (file tree, source control, vault directory) share a single left-sidebar
slot; the conversation column stays put.

- **Terminal** (composer-row toggle / **Ctrl+/**): a tabbed bottom terminal dock
  bound to the session workspace at open time; hidden docks keep running; prefers
  pwsh on Windows
- **File tree** (composer-row toggle / **Ctrl+,**): browse the session workspace;
  create/rename/delete (to Recycle Bin)/copy path; click a file to open a document
  tab in the right-dock **Files** tab (one tab per file, click to switch, ✕ to
  close; beyond the "max file tabs" setting — 3 by default — the least-recently-viewed
  tab closes); WYSIWYG markdown with mtime-CAS autosave, colored diff;
  **relative / site-rooted links inside markdown open the target file in a file tab**
- **Source control** (composer-row toggle / **Ctrl+Alt+.**): an in-page git
  workbench — stage/unstage/discard/commit, diff view, branch switch/create/delete,
  ↑↓ sync (pull then push), commit graph; one-click repo init for non-git directories
- **Schedule** (entry from the right-dock start page and the task card; no composer
  toggle and no dedicated shortcut): todos on the left, weekly grid + stats on the
  right; the agent gets read-only `schedule_query` and `schedule_create`; data is
  stored in `$DSH_HOME/dsh-kit/schedule.json`
- **Knowledge base** (composer-row toggle / **Ctrl+Alt+K**): ready out of the box
  (data-directory `dsh-kit\vault`, configurable absolute path) — pick pages from the
  left tree, edit them as document tabs inside the right-dock **Knowledge base** tab
  (multiple tabs, ✕ per tab); `[[wikilinks]]` with back/forward, backlinks, broken-link
  page creation, full-text search over `wiki/`; TipTap WYSIWYG with 2s autosave +
  mtime CAS; chat integration (vault paths in chat open the page, "cite to chat" inserts
  page/selection); usage rules ship as the `dsh-kit-vault` skill, and the agent runs
  `vault_search` plus direct file edits, committing to git itself; git archive on
  init / human save / delete
- **Background tasks** (entry from the right-dock start page and auto-follow): lists the
  session's running background jobs, with output viewing and job termination
  (official `job_output`/`job_kill` semantics)
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
  it waits and sends "continue" automatically (capped consecutive retries); when the
  streamed output repeats itself (a loop symptom) it stops the turn and retries; a
  banner above the composer shows the pending action and can cancel it; only the
  currently open session is watched
- **Settings card**: dsh-kit config card — per-feature switches, shortcut
  customization (terminal / file tree / source control / knowledge base / both
  sidebars), search result count, max file tabs, vault directory, monitor parameters,
  phone access

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

- `src/*.ts` → `dist/` (committed tsc output): host side — `/dsh-kit/terminal` WS
  (node-pty), `/tree`, `/read`, `/stat`, `/raw` (Range/206), `/write` (cwd subtree +
  mtime CAS), `/fs/op`, `/upload`, `/git/*`, `/browser` (built-in browser WS),
  `/jobs/*`, `/schedule/*`, `/vault/*`, `/skills`, `/phone/*` endpoints
- `client/bundle.js`: browser side (hand-written ModuleLoader bundle, **no build**) —
  four toggles on `conversation.input.left`; five dock tab types registered on
  `sidebarRightTabs` with pane bodies served through `sidebar.right.pane.tab`; the
  terminal dock and timer widgets are drawn by the plugin; settings page + card on the
  settings slots
- `client/vendor/*`: xterm / CodeMirror 6 / TipTap rich text / pdf.js / SheetJS /
  mammoth / KaTeX / DOMPurify, all lazily loaded and served from `/dsh-kit/vendor/*`
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
