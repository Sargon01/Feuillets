# Feuillets

Feuillets brings a long-form writer's workflow to Obsidian: your manuscript
as a living structure — from first outline to final export — rather than a
folder of disconnected Markdown files.

> **Note on language**: the plugin's interface is bilingual (French/English).
> It follows Obsidian's own display language by default ("Automatic"), or can
> be forced to French or English in Settings → Feuillets → Langue de
> l'interface, independently of Obsidian's language.

## Features

- **Bilingual interface** (French/English) — follows Obsidian's own display
  language by default, or can be set explicitly in the plugin settings.
- **Board** (Cards / Outline / Corkboard [Canvas] / Timeline / Reading modes)
  for the whole manuscript, filterable by status, label, tag, and progress.
- **Sidebar binder** (Ulysses-style split-pane, files-only, or classic tree),
  drag-and-drop reordering, and one-paste **outline import** (pasted Markdown
  headings/bullets become the Parts/Chapters/Scenes folder structure), plus
  **Scrivener project import** (desktop only).
- **Notes panel**: synopsis/summary/working notes/sources per scene, an
  auto-populated "context" section for every character/place cited in the
  text (including their age and their latest dated state, if their sheet
  contains an in-body chronology), folder notes for Parts/Chapters, and an
  outline of the open scene's own headings.
- **Recherche panel**: a project-scoped story bible (characters, places,
  lore, bibliography, glossary, events), with one-click insertion of a
  selected excerpt — plain, quoted, or quoted-with-source — into the scene
  you're writing.
- **Properties panel**: an editable, project-scoped view of frontmatter
  properties and tags (typed fields: text/list/date/checkbox), complementing
  or replacing Obsidian's native "All Properties" view.
- **Project & Export panel**: switch between multiple manuscripts, manage
  compilation presets, and export.
- **Progression and Journal panels**: word-count goals and detailed text
  stats, plus a monthly writing calendar with one journal entry per day.
- **Grammar checking: use a dedicated plugin.** Feuillets does not bundle,
  download, or run a grammar checker. For spelling and grammar, install a
  dedicated plugin from Obsidian's Community Plugins browser — for example
  [Harper](https://community.obsidian.md/plugins/harper) for English, or a
  LanguageTool plugin. Those plugins are independent: Feuillets does not
  configure them, read their settings, or call their APIs, and works
  normally whether or not they are installed.
- **Docx review panel**: a dedicated panel to work through an editor's or
  proofreader's feedback received as an annotated `.docx` file.
- **Find and replace bar**: a manuscript-wide search/replace tool, separate
  from Obsidian's native search, with in-editor match highlighting.
- **Citations and footnotes**: insert/renumber footnotes, and insert a
  formatted citation sourced from a Recherche sheet.
- **Scene tools**: split, duplicate, move, and merge multiple scenes with
  configurable YAML-merge presets (per-field: keep target / aggregate / keep
  first / ignore).
- **Distraction-free "concentration" mode** with typewriter scrolling and a
  floating word counter.
- **French typing aids**: curly quotes, French guillemets with non-breaking
  spaces, typographic dashes — reimplemented in the spirit of the *French
  Typos* plugin by Thierry Crouzet, not copied from it. Also includes
  standalone cleanup commands (fixing escaped scene breaks, compacting blank
  lines, splitting a chronology document into individual dated sheets).
- **Snapshots**: dated backup copies of the active scene or the entire
  project, with a quick-restore menu.
- **Settings backup/restore**: export the plugin's full settings to a
  timestamped `.json` file, and restore from any previous backup found in
  the vault.
- **Compilation and export — native engine, zero dependency**: `.docx` (real
  OOXML with footnotes and captioned images), `.epub` (valid EPUB3), and
  `.pdf` (desktop, via print), all built in pure JavaScript — no Pandoc
  required, works on mobile. 7 built-in layout templates plus
  frontmatter-based **custom templates**. An optional Pandoc engine remains
  available for desktop users who want it (see **System access** below).

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

When no project is active, the binder shows a welcome screen with three
options: **Create a project** (name, optional author, Fiction or
Non-fiction type — creates `Manuscrit/` with a title page and a first
chapter ready to write, plus `Recherche/` and `Ressources/` as siblings),
**Open an existing folder** (use a folder you already have as a manuscript,
without moving or renaming anything), or **Discover with a demo project**
(a filled-in example with a guided 4-step tour). From there, build the rest
of the structure by hand from the binder, or paste an existing outline via
"Import an outline…" to generate a whole Parts/Chapters/Scenes tree in one
step. Use the ribbon icons or command palette to open the Board, Notes,
Recherche, and Properties panels.

Want a clean, distraction-free look from the start? See
[`SETUP-INTERFACE.md`](./SETUP-INTERFACE.md) for a reference theme +
companion-plugin combination (not required — Feuillets works with any
theme). To carry your settings to a new vault, use the **"Export
settings"**/**"Import settings"** commands from the command palette (they
save/load a `feuillets-reglages-*.json` file in the vault).

## System access — what this plugin does and does not do

This section exists so both reviewers and users know exactly what Feuillets
touches outside of normal Obsidian note editing.

- **No network activity by default, and never silently.** Feuillets loads no
  remote scripts, fonts, or images, and contacts no server on its own. The
  plugin makes **no HTTP request at all** on its own: there is nothing to
  download after installation and no remote service to call. Everything
  works fully offline. (See `PRIVACY.md`.)
- **No telemetry, analytics, or usage tracking** of any kind.
- **No auto-update mechanism** of its own — plugin updates are handled
  entirely by Obsidian's Community Plugins system.
- **Native export (default, desktop and mobile):** compiling and exporting
  to `.docx`/`.epub`/`.pdf` uses only Obsidian's own vault APIs and
  in-memory JavaScript (the `docx` and `jszip` libraries, bundled — no
  network fetch). No external process, no filesystem access outside the
  vault, no platform difference beyond `.pdf` requiring desktop (uses
  Obsidian's built-in print-to-PDF; unavailable in mobile WebViews).
- **No dynamic code execution.** Feuillets contains no `eval`, no
  `new Function`, no `vm`, and no WebAssembly. Everything it runs is plain
  JavaScript shipped in `main.js` and reviewable line by line (the bundle is
  deliberately not minified).
- **Language-neutral.** Feuillets bundles no dictionary and no
  language-specific engine. Its analysis tools work on any language written
  in the Latin script.
- **Pandoc export (desktop only, opt-in, off by default):** switching the
  export engine setting to Pandoc shells out to a locally installed
  **Pandoc** binary via Node's `child_process.execFile` (no shell
  interpolation — arguments are passed as an array, not a concatenated
  string). This only runs when you explicitly trigger an export command with
  that engine selected; it never runs on load or in the background, and is
  unavailable on mobile (the plugin detects this and shows a clear notice
  instead of failing silently). The path to the Pandoc binary is a
  plain-text setting (default: `pandoc`, resolved via your system PATH).
- **Local filesystem access (desktop only, Pandoc export path only):** to
  hand a file to Pandoc, the plugin briefly writes a temporary compiled
  manuscript file inside your vault (via Obsidian's own vault adapter,
  removed immediately after conversion) and reads/writes the final
  `.docx`/`.epub` inside your vault or its configured output folder. The
  optional "Pandoc reference document" setting is validated to resolve to a
  path **inside the vault** — paths that would escape the vault (e.g. via
  `../..`) are rejected with a notice rather than silently followed.
- **Everything else stays inside Obsidian's vault APIs** (`app.vault`,
  `app.metadataCache`, `app.fileManager`, `app.workspace`) — no other direct
  filesystem or system access exists anywhere in the codebase. The one
  exception is two documented uses of an undocumented Obsidian internal
  method (`WorkspaceSplit.setSize`, to fix sidebar widths) — both guarded
  with a feature-detection check and a `try/catch`, so a future Obsidian
  release that removes or changes it degrades to a no-op instead of an
  error.

## Data & Privacy

Feuillets stores all of its settings and your manuscript data locally, using
Obsidian's own plugin data storage (`data.json` inside the plugin folder)
and your vault's own files. Nothing is ever transmitted anywhere. See
[`PRIVACY.md`](./PRIVACY.md) for the full statement.

## Development

```bash
npm install
npm run dev     # esbuild watch mode
npm run build   # TypeScript type-check + production bundle
npm test        # node:test — pure-function unit tests (utils/core.ts)
npm run lint    # eslint + type-check
```

Before submitting a release to the Obsidian community catalogue, run the
same automated review their developer dashboard performs — it uses the
public [`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin),
so it can be reproduced locally instead of waiting for the dashboard's
(often file-less) error messages:

```bash
npm run lint:obsidian   # must report 0 errors; warnings are informational
```

See `obsidian-review.config.mjs` for what counts as an error and why.

Source is TypeScript, living in `src/`; `main.js` at the repository root is a
**build artifact** (gitignored) — never edit it directly.

## Security

See [`SECURITY.md`](./SECURITY.md) for the threat model summary and how to
report a vulnerability.

## License

[GPL-3.0](./LICENSE) — Copyright (c) 2026 Halim.

Passé de MIT à GPL-3.0 en son temps pour intégrer du code [Grammalecte](https://github.com/algoo/grammalecte) (GPL-3.0). Depuis la 1.4.5, plus aucun code Grammalecte n'est distribué avec Feuillets. La licence reste GPL-3.0. Voir `THIRD_PARTY_NOTICES.md`.