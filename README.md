# Feuillets

Feuillets turns Obsidian into a lightweight novel-writing workshop: parts →
chapters → scenes as folders/files, a Kanban-style board, an outline table, a
timeline, a distraction-free writing mode, and manuscript compilation/export.

> **Note on language**: the plugin's interface is entirely in French. This
> README is in English to follow the Obsidian Community Plugins convention;
> see the in-app settings and commands for the (French-only) UI.

## Features

- **Board** (Cards / Outline / Timeline / Reading modes) for the whole
  manuscript, filterable by status, label, tag, and progress.
- **Sidebar binder** (tree or split-pane) mirroring the Parts → Chapters →
  Scenes folder structure.
- **Notes, Structure and Research side panels**: synopsis/summary/notes per
  scene, live word-count/progress, YAML frontmatter properties editor,
  cross-references to characters/places/events, and now dedicated notes for
  Parts/Chapters themselves.
- **Scene tools**: split, duplicate, move, and merge multiple scenes with
  configurable YAML-merge presets.
- **Distraction-free "concentration" mode** with typewriter scrolling and a
  floating word counter.
- **French typing aids**: curly quotes, French guillemets with non-breaking
  spaces, typographic dashes — reimplemented in the spirit of the *French
  Typos* plugin by Thierry Crouzet, not copied from it.
- **Compilation** to a single Markdown manuscript, with optional export to
  `.docx`/`.epub` via [Pandoc](https://pandoc.org) (see **System access**
  below).

## Installation

### From the Community Plugins list
Once accepted into the directory: Settings → Community plugins → Browse →
search "Feuillets" → Install → Enable.

### Manual install
1. Download `main.js`, `manifest.json`, and `styles.css` from the
   [latest release](<REPO_URL>/releases/latest).
2. Copy them into `<your vault>/.obsidian/plugins/feuillets/`.
3. Reload Obsidian and enable "Feuillets" in Community plugins.

## Getting started

Set a **Project folder** in the plugin settings (a folder that directly
contains your Parts/Chapters — not a parent folder that also holds a
Research or Snapshots folder alongside the manuscript). From there, use the
ribbon icons or command palette to open the Board, Structure panel, and
Notes panel.

## System access — what this plugin does and does not do

This section exists so both reviewers and users know exactly what Feuillets
touches outside of normal Obsidian note editing.

- **No network activity, ever.** Feuillets makes zero HTTP/HTTPS requests,
  loads no remote scripts, fonts, or images, and contacts no server. Every
  feature works fully offline. (See `PRIVACY.md`.)
- **No telemetry, analytics, or usage tracking** of any kind.
- **No auto-update mechanism** of its own — plugin updates are handled
  entirely by Obsidian's Community Plugins system.
- **Local program execution (desktop only, opt-in):** exporting to
  `.docx`/`.epub` shells out to a locally installed **Pandoc** binary via
  Node's `child_process.execFile` (no shell interpolation — arguments are
  passed as an array, not a concatenated string). This only runs when you
  explicitly trigger an export command; it never runs on load or in the
  background. It is unavailable on mobile (the plugin detects this and shows
  a clear notice instead of failing silently). The path to the Pandoc binary
  is a plain-text setting (default: `pandoc`, resolved via your system PATH).
- **Local filesystem access (desktop only, export path only):** to hand a
  file to Pandoc, the plugin briefly writes a temporary compiled manuscript
  file inside your vault (via Obsidian's own vault adapter, removed
  immediately after conversion) and reads/writes the final `.docx`/`.epub`
  inside your vault or its configured output folder. The optional "Pandoc
  reference document" setting is validated to resolve to a path **inside the
  vault** — paths that would escape the vault (e.g. via `../..`) are
  rejected with a notice rather than silently followed.
- **Everything else stays inside Obsidian's vault APIs** (`app.vault`,
  `app.metadataCache`, `app.fileManager`) — no other direct filesystem or
  system access exists anywhere in the codebase.

## Data & Privacy

Feuillets stores all of its settings and your manuscript data locally, using
Obsidian's own plugin data storage (`data.json` inside the plugin folder)
and your vault's own files. Nothing is ever transmitted anywhere. See
[`PRIVACY.md`](./PRIVACY.md) for the full statement.

## Development

```bash
npm install
npm run dev     # esbuild watch mode
npm run build   # type-check (structural, via allowJs) + production bundle
npm test        # node:test — pure-function unit tests (utils/core.js)
```

Source lives in `src/`; `main.js` at the repository root is a **build
artifact** (gitignored) — never edit it directly.

## Security

See [`SECURITY.md`](./SECURITY.md) for the threat model summary and how to
report a vulnerability.

## License

[MIT](./LICENSE) — Copyright (c) 2026 Halim.
