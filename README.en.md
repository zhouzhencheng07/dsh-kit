English | [中文](README.md)

# dsh-kit

A page-capability kit plugin for DeepSeek Harness (dsh): optional add-ons for the dsh browser UI, each independent; with none used, dsh stays stock. The workbench lives in the official right sidebar (one dock tab per piece of content).

## Features

- **File tree**: tree in the left rail — create / rename / move / import / recycle-bin delete; clicking a file opens the official preview.
- **Floating chat**: a handle pinned to the screen edge opens a floating conversation with its own session, swappable with the main view; Ctrl+Alt+; toggles it.
- **Knowledge base · Schedule**: markdown vault editing (slash menu, wiki links and backlinks, outline, full-text search, quiz and study review), schedule week grid + to-dos + timer, writable from the panel.
- **Terminal**: multi-tab terminal bound to the session workspace, over the official webTerminals engine.
- **Built-in browser**: the agent drives system Edge via `browser_*` tools; the panel shows the live page and lets you take over; chat links can be routed here.
- **Phone access**: scan a QR code to reach the local dsh from your phone — token-gated gateway, LAN and remote channels.
- **Usage & monitoring**: balance / quota chip, desktop notifications for turn end, compaction completion and agent questions.
- **Web search**: keyless multi-source search replacing the official paid search.

## Usage

- Each component row has its own switch (Plugins page): turning a row off removes that capability entirely (host endpoints 404, UI entry gone).
- Rows that take settings carry their own config page; saving writes to the profile and takes effect immediately.
- Shortcuts for the file tree, knowledge base · schedule, terminal and floating chat are registered on the host's Shortcuts page (Ctrl+/).
- Runtime data lives in `<DSH_HOME>/dsh-kit/` (default vault root, schedule, browser profile, …); the vault root can be changed on its config page.

## Requirements

- dsh ≥ 0.2.0-rc.2 (the desktop app of the same version works)
- Node.js ≥ 22 (required by dsh itself)

## How it works

- One package plus component rows in `cordis.patch.yml` (row names are exports subpaths); the host loads row by row — a disabled row materializes no host endpoints, and its client half does not register.
- The host half is `src/*.ts` (tsc emits `dist/`); the browser half is a hand-written `client/bundle.js` (no build). xterm / TipTap / pdf.js / KaTeX / mermaid / QR code are loaded from `/dsh-kit/vendor/*` on demand.

## License

MIT
