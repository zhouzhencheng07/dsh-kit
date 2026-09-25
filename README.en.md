English | [中文](README.md)

# dsh-kit

A page-capability kit plugin for DeepSeek Harness (dsh): optional add-ons for the
dsh browser UI, each independent and dependency-free; with none used, dsh stays stock.

## Features

The workbench lives in the **official right sidebar** (host 0.1.5+, `sidebar.right`):
one dock tab each for Diff / Knowledge base / Schedule / Browser,
with document tabs inside the Knowledge base tab (one per page). Workspace files are
viewed through the **official file preview** (kit adds a "Download" button to its
header); there is no in-plugin editing of workspace files — edit in VS Code or let
the agent do it.
Index views (file tree, source control, vault directory) share a single left-sidebar
slot; the conversation column stays put. Every capability is a **component row** you can
switch off independently on the Plugins page — turning a row off removes its endpoints,
agent tools and UI entries together; with all rows off, dsh is stock again.

- **Terminal** (composer-row toggle / default **Ctrl+Alt+\`**): a tabbed bottom terminal dock
  bound to the session it was opened in (width follows the chat column); hidden
  docks keep running; powered by the **official webTerminals service** (host-owned
  PTY: system-user permissions, survives page refreshes, shell selection) —
  requires DSH 0.1.6+
- **File tree** (composer-row toggle / default **Ctrl+Alt+,**): browse the session workspace;
  create/rename/delete (to Recycle Bin)/copy path / @-mention to chat; clicking a file
  opens it in the **official right-sidebar preview**, while md pages inside the vault
  go to the read-only knowledge-base reader
- **Source control** (composer-row toggle / default **Ctrl+Alt+.**): an in-page git
  workbench — stage/unstage/discard/commit, click a file to see its diff in a
  right-dock diff tab (full-file coloring; pin any commit from the graph to diff
  against it), branch switch/create/delete, ↑↓ sync (pull then push), commit graph;
  one-click repo init for non-git directories
- **Knowledge base · Schedule** (one component row; the row switch is the master switch —
  turning it off removes the directory index, both dock tabs, the composer toggle and the
  four schedule tools together)
  - **Knowledge base** (composer-row toggle / default **Ctrl+Alt+/**): ready out
  of the box (data-directory `dsh-kit\vault`, configurable absolute path on this row's
  config page) — a one-row search
  plus a tree on the left, pages read as document tabs inside the right-dock **Knowledge
  base** tab (multiple tabs, ✕ per tab); `[[wikilinks]]` jumping to sections
  (`[[page#heading]]`), a sticky reading bar with outline & backlinks menus; one search
  covers both sides (full-text notes + note folders + files/folders under the root
  `library/` matched by name), and library files open in the official right-dock file tab
  (PDFs are not rendered inside the panel); the library row is always visible and never
  re-roots the tree; Ctrl+click on a **note folder** row (or clicking a folder in search
  results) re-roots the tree, with ← at the tree head back to the vault root (display only,
  settings untouched); **the tree is also a file manager**: `＋` on the tree head or a folder
  row creates a page or folder (`\` prefix makes a folder, `/` allows nesting), and a row's
  `⋯` menu offers rename (renaming a page rewrites every wikilink that resolves to it, with
  the page count reported), move-to… (skip / overwrite / auto-number on name clash), import
  (pick files in the browser, or paste an absolute local path — md pages pull their locally
  referenced images into `attachments/` and rewrite the references), copy absolute path and
  delete (Recycle Bin on Windows); the library side uses the same menu but imports arbitrary
  documents and always auto-numbers on clashes; open page tabs follow renames/moves and close
  on delete; chat integration (vault paths in chat open the page, "@" on a tree row cites
  page/selection); page bodies are still not editable inside the plugin (writing belongs to
  the agent's file tools or your local editor) and the plugin creates no skeleton directories
  and never touches git
  - **Schedule** (entry from the right-dock start page; no composer toggle and no dedicated
  shortcut): a task list (3-day / week / all scopes) on the left, weekly grid + stats on the
  right; block colors encode state only (upcoming orange / running green / past blue /
  overdue red); the agent gets `schedule_query`, `schedule_create`, `schedule_update` and
  `schedule_delete`; data is stored one-entry-per-file under
  `$DSH_HOME/dsh-kit/schedule/` (`events/` + `entries/` + `timer.json`, shared with the
  Wangshu desktop app — editing and timers belong there, the plugin is read-only)
- **Built-in browser** (right-dock Browser tab; this component's row switch is the master
  switch — turning it off removes the tools and the panel, leaving only the official
  browser entry): the agent drives the
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
- **Web search** (merged from dsh-free-search; the component row switch is the master
  switch — turn it off and the official search takes over): a keyless engine chain
  replaces the paid `deepseek-official` — specialized engines first when the query
  matches (GitHub / arXiv / StackExchange / HN), then the general ones (Tavily keyless →
  Bing → Sogou) with automatic failover; its config page only holds the result count
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
- **Shortcuts**: four commands (terminal / file tree / source control / knowledge base) are
  registered with the **host's shortcut page** (Ctrl+/) — pressing keys to record, conflict
  marking, per-device defaults and persistence all belong to the host; both sidebars toggle with
  the host's own keys (web: left Ctrl+Alt+B, right Ctrl+Shift+B). Rebind there, not in the plugin
  config page (needs DSH 0.1.7-rc.2+; on older hosts these bindings do not exist). Every hover hint
  inside the plugin is the **official tooltip** (sides follow the host's own convention: panel headers
  and toolbars point down, the bottom dock and the composer row point up, row-end buttons align end;
  commands carry their current keys and follow rebinding) — plain truncation hints keep the native
  `title`
- **Config pages**: component rows that take settings each carry their own config page in the
  Plugins page — the main row covers phone access; the **knowledge base · schedule row**
  covers the vault root directory (row switch = master switch);
  the **web search row** only holds the result count (row switch = master switch, turning it
  off restores the official search); the **built-in browser row** covers "open chat links in
  the built-in browser" and "hide the official Browser entry" (row switch = master switch);
  the **usage & monitoring row** covers the balance chip
  switch, monitor parameters and desktop notifications; the **file tree · source control row**
  covers the file-tree and source-control switches plus hiding the official Workspace Files
  entry. The **terminal** and **skills** rows have no config field (the row switch is the only
  switch — turning it off hides the entry). Saving writes to the profile and takes effect
  immediately (a few startup-time gates need a dsh restart)

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
is carried by the official right sidebar (dock tabs for diffs / vault / schedule /
browser), and the agent's `web_search` uses the free multi-source chain.

**Host requirement**: dsh ≥ 0.1.5 (the official right-sidebar service
`sidebar.right`). On older hosts the plugin still loads, but no workbench tabs
appear and the toggles have nothing to open — upgrade dsh first.

## How it works

- `src/*.ts` → `dist/` (committed tsc output): host side — the main row serves
  `/phone/*` (phone gateway), `/config` (read-only config snapshot) and `/vendor/*`
  (xterm / TipTap / KaTeX / qrcode); file-tree (`/tree`, `/read`, `/raw`, `/fs/op`,
  `/upload`, `/git/*`), skill-pool, vault (`/vault/*`), schedule (`/schedule/*`) and
  browser endpoints belong to their components
- `client/bundle.js`: browser side (hand-written ModuleLoader bundle, **no build**) —
  the root package keeps only the cross-slot base (kitUi open/close state, the config-page
  skeleton, entry seats) plus the phone-access page; the client halves of the file-tree /
  source-control, terminal, skills, usage-monitor, web-search, built-in-browser and
  knowledge-base · schedule components live in this same bundle as isolated component
  modules (right-bar pane bodies are served through `sidebar.right.pane.tab`, config pages
  through `plugins.row.config`; the terminal dock renders over the official
  `webTerminals` engine)
- `src/core`, `src/files`, `src/skills`, `src/terminal`, `src/monitor`, `src/browser`,
  `src/vault`: component boundaries as directories (0.5.3 single-package components — a component is a patch
  row, not a package) — `core` is the host shared library (same-origin check, recycle-bin
  delete, text decoding, session-header injection, dsh-tools loading);
  `files` serves tree/read/raw/fs-op/
  git endpoints + file tree and source control panels; `skills` serves `/dsh-kit/skills` and
  `/dsh-kit/skills/op` plus the `/dsh-kit-skills/config` probe (skill-pool manager page);
  `terminal` serves the `/dsh-kit-terminal/config` probe (terminal toggle and dock);
  `monitor` serves `/dsh-kit/usage` + usage chip / 429 auto-resume / loop breaker / session
  notifications; `browser` serves the 7 `browser_*` tools, the `/dsh-kit/browser` panel
  WebSocket, `/dsh-kit/browser/open` and the `/dsh-kit-browser/config` probe (right-bar
  browser tab, shared control, link redirection); `vault` serves `/dsh-kit/vault/*`
  (index / search / per-page mtime / directory-level file management), `/dsh-kit/schedule/*`
  (read-only data and stats) and the `/dsh-kit-vault/config` probe, and registers the four
  `schedule_*` agent tools (knowledge base · schedule row). Rows are materialized by the root
  `cordis.patch.yml` through package exports subpaths (`dsh-kit/files` etc.)
- `client/vendor/*`: xterm / TipTap rich text / KaTeX / qrcode, all lazily loaded
  and served from `/dsh-kit/vendor/*`
- `src/search/`: the web-search component — `web-search.ts` points the web seam's
  provider at `free-search` and registers the keyless engine chain (`engine-chain.ts` +
  `engines/*`); disabling the component row leaves the seam untouched, so the official
  provider pinned by the base layer keeps serving
- `cordis.patch.yml`: inserts the dsh-kit row and the seven component rows
  (files / skills / terminal / monitor / search / browser / vault) into the bundle layer;
  no official row is patched
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
