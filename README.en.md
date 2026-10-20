English | [中文](README.md)

# dsh-kit

A page-capability kit plugin for DeepSeek Harness (dsh): optional add-ons for the
dsh browser UI, each independent and dependency-free; with none used, dsh stays stock.

## Features

The workbench lives in the **official right sidebar** (the official `sidebar.right` service),
shaped like the official one — **one tab per item**: one diff, one knowledge-base page and
one browser page each take a dock tab of their own (the tab strip is the switcher; Schedule
stays a single tab). Workspace files are
viewed through the **official file preview** (kit adds a "Download" button to its
header); there is no in-plugin editing of workspace files — edit in VS Code or let
the agent do it.
Index views (file tree, vault directory) share a single left-sidebar slot — a three-way
**form switch** at its bottom-left (sessions / file tree / knowledge base · schedule) picks
which one that slot shows; the conversation
column stays put. Every capability is a **component row** you can
switch off independently on the Plugins page — turning a row off removes its endpoints,
agent tools and UI entries together; with all rows off, dsh is stock again. The pack shows
**ten component rows plus a carrier row at the very bottom of the list** — the carrier serves
nothing, it is only the
mount point for this package's browser half (the host attaches a package's client half to
the row whose name equals the package name, so deleting it makes every capability vanish
from the page). It stays in the list: **do not turn it off**.

- **Terminal** (composer-row toggle / default **Ctrl+Alt+\`**): a tabbed bottom terminal dock
  bound to the session it was opened in (width follows the chat column); hidden
  docks keep running; powered by the **official webTerminals service** (host-owned
  PTY: system-user permissions, survives page refreshes, shell selection)
- **File tree** (bottom-left form toggle / default **Ctrl+Alt+,**): browse the session workspace;
  create/rename/delete (to Recycle Bin)/copy path / @-mention to chat; clicking a file
  opens it in the **official right-sidebar preview**, while md pages inside the vault
  go to the knowledge-base editor
- **Knowledge base · Schedule** (one component row; the row switch is the master switch —
  turning it off removes the directory index, both dock tabs, the form toggle and the
  shortcut command together)
  - **Knowledge base** (bottom-left form toggle / default **Ctrl+Alt+/**): ready out
  of the box (data-directory `dsh-kit\vault`, configurable absolute path on this row's
  config page) — a one-row search
  plus a tree on the left, each page reads in its own right-dock **Knowledge base** tab
  (title = page name, ✕ per tab); `[[wikilinks]]` jumping to sections
  (`[[page#heading]]`), a sticky reading bar with outline & backlinks menus; one search
  covers both sides (full-text notes + note folders + files under the root `library/`
  matched by name), and library files open in the official right-dock file tab (PDFs are
  not rendered inside the panel); a **knowledge set** mounts library documents onto any note
  folder (row `⋯` → set as knowledge set / add material; the manifest lives in
  `.refs.json` inside the folder), shown as a "Materials (N)" sub-row; the "Materials"
  section up top shares one owner with the tree head's "Add material" — the **current tree
  root** (the root itself if it is a knowledge set, otherwise the nearest ancestor; nothing
  at all at the vault root); Ctrl+click on a **note folder**
  row (or clicking a folder in search results) re-roots the tree, with ← at the tree head
  back to the vault root (display only,
  settings untouched); **the tree is also a file manager**: the tree head has three buttons
  (`＋` new / "Add material" when the root belongs to a knowledge set / `⤓` import), a folder
  row's `＋` creates a page or folder (`\` prefix makes a folder, `/` allows nesting), and a row's
  `⋯` menu offers rename (renaming a page rewrites every wikilink that resolves to it, with
  the page count reported), move-to… (skip / overwrite / auto-number on name clash), import
  (pick files in the browser, or paste an absolute local path — md pages pull their locally
  referenced images into `attachments/` and rewrite the references; references pointing
  outside the source folder are left untouched), copy absolute path and
  delete (Recycle Bin on Windows); library documents are imported through a knowledge set's
  "Add material…" (arbitrary formats stored content-deduplicated under `library/`, always
  auto-numbered on clashes, and each material row's `⋯` can rename / unmount / delete it);
  open page tabs follow renames/moves (the tab is reopened at the new address) and close
  on delete; chat integration (vault paths in chat open the page, "@" on a tree row cites
  page/selection — a long selection is clipped to the first 12 lines / 600 characters and
  marked as truncated, while the chip still points at the whole page); **page bodies are what-you-see-is-what-you-get editors** (TipTap rich
  text, no source/preview duality): `/` opens a two-level command menu (headings & text /
  special blocks / lists / math & code / charts / attachments),
  a selection floats an inline format bar (colour swatches and links included) and, inside a
  table, a second bar with row/column insert & delete, left/center/right alignment, header
  column and delete-table; the menu opens a picker for wiki links that searches pages and all
  vault headings at once (a heading row inserts `[[page#heading]]`; type an alias after `|`),
  a rows/columns dialog for tables (3x3 with header by default) — cells hold inline text
  only, so pasted headings / quotes / lists / nested tables are flattened to text on the spot and
  the first row is always the header row — inserts mermaid blocks
  (bundled renderer, click to edit the source) and opens the system file picker for images —
  pasted screenshots and picked files alike are compressed then stored content-addressed under
  `attachments/` and inserted; `Tab` sinks/lifts list items (jumps cells in tables, inserts two
  spaces in code blocks, and is swallowed elsewhere so focus never leaves the editor),
  `Ctrl+Enter` jumps out of a blockquote; the page bar carries undo/redo, an unsaved dot and
  the sticky reading bar (outline & backlinks);
  saving is a 2s-debounced autosave (`Ctrl+S` saves now, leaving a tab or unmounting flushes)
  over an mtime CAS — if the file changed underneath (agent or external editor), autosave
  pauses and a conflict bar asks you to choose overwrite-disk or load-disk (the plugin never
  overwrites silently and never touches git); external changes while the page is clean are
  still re-read silently; the plugin creates no skeleton directories and never touches git
  - **Home** (the third right-dock tab, opened by `⌂` in the panel toolbar): a knowledge-sets
    section (first 8: book icon + name + "Materials N · Quiz mastered/total" + an inline
    "Quiz" button; more than 8 offers "All knowledge sets ›", an in-tab full view) and a
    recently-updated section (the whole vault by mtime, first 8, folder shown on the right).
    Clicking a set re-roots the left tree to it (with a hint when the vault tree is not the
    active form); clicking a page row opens it
  - **Quiz** (shares one `.quiz` dataset with the desktop end): the page-bar "Quiz" button
    (badge = mastered / answerable) and a tree row's `⋯` → "Quiz" (a page = single page, a
    knowledge-set row = recursive scope, plain folders get no entry); the overlay picks
    pages / mastery state / question types / count,
    then runs question by question with instant marking and a summary; a page entry also has
    "Edit questions" (add/change/delete written back wholesale, optionally keeping mastery).
    Mastery is consecutive correct answers ≥ a threshold stored in `.quiz-state/settings.json`
    at the vault root (editable in the panel)
  - **Schedule** (one shared entry — the bottom-left Knowledge base form toggle and **Ctrl+Alt+/** open the
  left sidebar cell, whose top tab strip switches between the two): the task
   list (3-day / week / all scopes) fills that cell and
  the weekly grid fills the right dock tab; its header stats follow the week you are looking at
  (a failed fetch says so instead of quietly showing stale numbers); the all-day band holds
  date-only tasks, stacked one per row per day, with out-of-week ones on Monday; block colors
  encode state only (upcoming orange / running green / past blue / overdue red);
  **the panel edits**: tick a row done, click its title to edit the item (repeat rule, location and
  notes included), click a grid block to edit it (event blocks edit the item, time-segment blocks
  edit that segment), and "New" at the top of the cell creates a task or an event; **timing is one
  global timer**: "Start timer" in the schedule cell attaches an unfinished task or takes a title for
  a standalone run, the floating ball at the bottom right keeps the seconds and stops it (it stays
  up with every panel closed), and closed segments land on the grid and in the stats; **there are
  no schedule tools on the agent side** — editing goes through a skill-pool skill that reads and
  writes the same files under `$DSH_HOME/dsh-kit/schedule/`
  (`events/` + `entries/` + `timer.json`, one entry per file) exactly like the panel does:
  entries written by other programs show up in the panel, and neither side overwrites
  what the other changed
- **Built-in browser** (right-dock tabs, **one page per tab** — the title is the page title and
  the official tab strip is the switcher; this component's row switch is the master
  switch — turning it off removes the tools and the panel, leaving only the official
  browser entry): the agent drives the
  system Edge via **7** `browser_*` tools (vendored playwright-core, dedicated
  persistent profile) — snapshot → act → assert GUI-testing loops, screenshots
  (attached directly for multimodal models, saved to disk otherwise); the panel shows
  the agent's browser live — your clicks/wheel/keys act on the page behind that very tab
  (shared control); the toolbar's ＋ opens a page as a new tab and closing a tab closes its
  page; every agent navigation brings that page's tab to the front
- **Skill management** (new Settings page): workspace / user-level / skill-pool groups with
  move, delete, disable/enable (move only — no copy, otherwise copies drift (anything under a mount is not movable: a link must be unmounted first, and a pool skill other workspaces mount must have those mounts released first); a flat `.md`
  dropped into the pool is wrapped into a same-named directory, and the row shows how many
  workspaces mount it (one marker tells how many and whether this workspace is one of them); pool skills can be bundled into a **group** (e.g. word/excel/ppt as "Office", stored in the plugin data) and mounted or unmounted as a set — one button flips with the state (fully mounted = "Unmount all", otherwise "Mount all", which only fills the gaps); a skill belongs to one group only, chosen from a dropdown on its pool row ("No group" clears it), and skills already in another group are not offered in the group editor; a group row also shows "Mounted x/y" (unmounting one member individually shows up there); the pool header filters by mounted/not-mounted,
  and a skill mounted in this workspace is badged with its button switched to "Unmount"); a pool skill's own repository and history stay with the skill (the plugin does not
  touch git in the pool), and a control in the pool header hands the pool directory to an installed
  application — history, commits and rollbacks happen there; same-name skills shadowed by
  another root get a dashed badge
- **Phone access** (new Settings page; the component row switch is the master switch —
  turn it off and both the gateway and the page are gone): scan a QR code to reach the
  local dsh web — token-gated gateway (editable port), off on every startup by default;
  LAN and remote dual links, full HTTP/WS passthrough; in remote view, entries that only
  act on the computer (open in app, add workspace, open configuration file) are greyed out
  with a "do this on the computer" hint
- **Web search** (merged from dsh-free-search; the component row switch is the master
  switch — turn it off and the official search takes over): a keyless engine chain
  replaces the paid `deepseek-official` — specialized engines first when the query
  matches (GitHub / arXiv / StackExchange / HN), then the general ones (Tavily keyless →
  Bing → Sogou) with automatic failover; its config page only holds the result count
- **Session notifications** (on by default; one switch covers every alert): a desktop notification when a turn finishes,
  context compaction completes, or the agent asks a question / awaits tool approval /
  submits a plan for review (browser Notification API; click it to return to that
  session) — fires while the page sits in a background tab or another window, or when the
  event belongs to a session you are not looking at; silent while you are watching that
  very session. Turn endings are classified from the official `turn/end` reason into five
  messages — completed / errored / stopped / blocked / output limit reached — instead of
  always reporting "finished"; compaction alerts cover sessions you
  have opened (the official
  client loads history only for the current session, so a never-opened session's
  compaction is invisible). Notifications go through the browser Notification API; without
   permission no notification is shown (allow it in the site settings)
- **Shortcuts**: three commands (terminal / file tree / knowledge base) are
  registered with the **host's shortcut page** (Ctrl+/) — pressing keys to record, conflict
  marking, per-device defaults and persistence all belong to the host; both sidebars toggle with
  the host's own keys (web: left Ctrl+Alt+B, right Ctrl+Shift+B). Rebind there, not in the plugin
  config page. Every hover hint
  inside the plugin is the **official tooltip** (sides follow the host's own convention: panel headers
  and toolbars point down, the bottom dock and the composer row point up, row-end buttons align end;
  commands carry their current keys and follow rebinding) — plain truncation hints keep the native
  `title`
- **Runtime log row** (its row switch decides whether anything is written at all): host-side and browser-side logs land in one file,
  `<DSH_HOME>/dsh-kit/logs/kit.log` (rotating, 2MB × 5), one event per line — time, level,
  component, **the operation in flight**, message and fields. The line carrying an error already
  names the operation it happened in, and the lines before it are what the plugin was doing
  just before. Uncaught exceptions and failed requests on the page side go into the same file,
  so blank panes and dead buttons leave a trace too. Default level `info`; `DSH_KIT_LOG`
  tunes it (`off`/`error`/`warn`/`info`/`debug`). Read it with `pnpm logs` in the repo
  (`--err` shows only failures with the lines leading up to them).
- **Config pages**: component rows that take settings each carry their own config page in the
  Plugins page — the **phone-access row** covers the outward port, remote domain and
  keep-gateway-on (row switch = master switch); the **knowledge base · schedule row**
  covers the vault root directory (row switch = master switch);
  the **web search row** only holds the result count (row switch = master switch, turning it
  off restores the official search); the **built-in browser row** covers "open chat links in
  the built-in browser" and "hide the official Browser entry" (row switch = master switch);
  the **usage & monitoring row** covers the balance chip
  switch, monitor parameters, desktop notifications and OpenCode session-header injection; the **file tree row**
  covers the file-tree switch plus hiding the official Workspace Files
  entry. The **terminal** and **skills** rows have no config field (the row switch is the only
  switch — turning it off hides the entry); the **runtime log row** has no config field either
  (its row switch is whether log files get written; the level still comes from the
  `DSH_KIT_LOG` environment variable). The carrier row has no config field and must stay on
  (turning it off removes everything this plugin shows in the page). Saving writes to the profile and takes effect
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
layer. After installing/updating, restart `dsh web`: the composer tool row keeps a single
Terminal toggle and a three-way form switch (sessions / file tree / knowledge base ·
schedule) appears at the bottom-left of the left sidebar; the workbench
is carried by the official right sidebar (dock tabs for diffs / vault / schedule /
browser), and the agent's `web_search` uses the free multi-source chain.

**Host requirement**: dsh ≥ 0.2.0-rc.2 (component rows and per-row config pages,
the official `shortcuts` service and the official `webTerminals` all landed by
this version; the desktop app of the same version works too — its panel takes
the WebSocket base the host injects).

## How it works

- `src/*.ts` → `dist/` (committed tsc output): host side — file-tree
  (`/tree`, `/read`, `/raw`, `/fs/op`,
  `/upload`), skill-pool, vault (`/vault/*`), schedule (`/schedule/*`) and
  browser endpoints belong to their components; the `/vendor/*` static assets are
  registered by the component that uses them (xterm → terminal, qrcode → phone access,
  TipTap / KaTeX / mermaid / pdf.js → vault)
- `client/bundle.js`: browser side (hand-written ModuleLoader bundle, **no build**) —
  the root package keeps only the cross-slot base (kitUi open/close state, the config-page
  skeleton, entry seats, the preview download button); the client halves of the file-tree /
  terminal, skills, usage-monitor, web-search, built-in-browser,
  knowledge-base · schedule and phone-access components live in this same bundle as isolated component
  modules (right-bar pane bodies are served through `sidebar.right.pane.tab`, config pages
  through `plugins.row.config`; the terminal dock renders over the official
  `webTerminals` engine)
- `src/core`, `src/files`, `src/skills`, `src/terminal`, `src/monitor`, `src/browser`,
  `src/vault`, `src/phone`: component boundaries as directories (0.5.3 single-package components — a component is a patch
  row, not a package) — `core` is the host shared library (same-origin check, recycle-bin
  delete, text decoding, dsh-tools loading, logging);
  `files` serves tree/read/raw/fs-op endpoints + the file tree panel; `skills` serves `/dsh-kit/skills` and
  `/dsh-kit/skills/op` plus the `/dsh-kit-skills/config` probe (skill-pool manager page);
  `terminal` serves the `/dsh-kit-terminal/config` probe (terminal toggle and dock);
  `monitor` serves `/dsh-kit/usage` + usage chip / session notifications and the
  per-session OpenCode session-header injection (switchable on its
  config page); `browser` serves the 7 `browser_*` tools, the `/dsh-kit/browser` panel
  WebSocket, `/dsh-kit/browser/open` and the `/dsh-kit-browser/config` probe (right-bar
  browser tab, shared control, link redirection); `vault` serves `/dsh-kit/vault/*`
  (index / search / per-page mtime / directory-level file management / body write-back with
  mtime CAS / pasted-image upload), `/dsh-kit/schedule/*`
  (data, stats and the panel write path) and the `/dsh-kit-vault/config` probe (knowledge
  base · schedule row; schedule editing goes through the `schedule-editing` skill); `phone` serves
  `/dsh-kit/phone/*` (status / links / rotation / start-stop) plus the
  `/dsh-kit-phone/config` probe and starts the outward gateway (phone-access row).
  Rows are materialized by the root
  `cordis.patch.yml` through package exports subpaths (`dsh-kit/files` etc.)
- `client/vendor/*`: xterm / TipTap rich text / KaTeX / mermaid / qrcode, all lazily loaded
  and served from `/dsh-kit/vendor/*` by the component row that uses them — disabling a row
  takes its static assets with it
- `src/search/`: the web-search component — `web-search.ts` points the web seam's
  provider at `free-search` and registers the keyless engine chain (`engine-chain.ts` +
  `engines/*`); disabling the component row leaves the seam untouched, so the official
  provider pinned by the base layer keeps serving
- `cordis.patch.yml`: inserts the ten dsh-kit component rows (files / chat / vault / terminal /
  browser / skills / phone / monitor / search / logs — row order is the Plugins-page order)
  into the bundle layer, followed by one **carrier row** (`name: dsh-kit` — the mount point for
  the browser half, serves nothing itself, hence last, after the functional rows); every row id
  is explicit and stable (the loader gives anonymous rows a fresh random id on every compose, so any profile
  write would re-mount the row and reload the whole browser half);
  no official row is patched
- Host-side `node-pty`/`ws`/`@deepseek-ai/*` declare no dependencies: resolved at
  runtime from the profile fallback node_modules (declaring them would install a
  second copy)

## Requirements

- dsh ≥ 0.2.0-rc.2
- Node.js ≥ 22 (dsh requirement)
- Zero declared dependencies; TypeScript sources + prebuilt `dist` on the host side,
  no build step on the browser side

## License

MIT
