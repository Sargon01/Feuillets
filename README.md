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
- **Grammar checking (French via Grammalecte, English via
  [Harper](https://writewithharper.com))**: on-demand grammar and spelling
  check of the active scene, in-editor underlining, and next/previous-issue
  navigation commands. Both engines run fully locally with no network
  call; their resource files (~9MB / ~17MB) are downloaded once on request
  from Feuillets' own release assets rather than bundled, and cached on
  disk afterwards. A cloud **LanguageTool** engine is available as an
  explicit alternative, and as an automatic fallback on mobile, where the
  local engines can't run (desktop only — they rely on Node's `fs`/`vm`).
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

Set a **Project folder** in the plugin settings (a folder that directly
contains your Parts/Chapters — not a parent folder that also holds a
Research or Snapshots folder alongside the manuscript), and pick a **Fiction**
or **Non-fiction** project mode. From there, either build the structure by
hand from the binder, or paste an existing outline via "Import an outline…"
to generate the whole Parts/Chapters/Scenes tree in one step. Use the ribbon
icons or command palette to open the Board, Notes, Recherche, and Properties
panels.

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
  only two things that ever make an HTTP request are both explicit,
  visible, user-triggered actions — never on load, never in the background:
  downloading a local grammar engine's resource files (see below), or
  submitting text to LanguageTool if you deliberately pick it as your
  proofreading engine. Everything else works fully offline. (See
  `PRIVACY.md`.)
- **No telemetry, analytics, or usage tracking** of any kind.
- **No auto-update mechanism** of its own — plugin updates are handled
  entirely by Obsidian's Community Plugins system.
- **Native export (default, desktop and mobile):** compiling and exporting
  to `.docx`/`.epub`/`.pdf` uses only Obsidian's own vault APIs and
  in-memory JavaScript (the `docx` and `jszip` libraries, bundled — no
  network fetch). No external process, no filesystem access outside the
  vault, no platform difference beyond `.pdf` requiring desktop (uses
  Obsidian's built-in print-to-PDF; unavailable in mobile WebViews).
- **Grammar checking (desktop only for the local engines):** French
  (Grammalecte) and English ([Harper](https://writewithharper.com)) both run
  entirely locally — text never leaves the machine either way. Their
  resource files aren't bundled in the plugin (Obsidian's installer only
  ever fetches `main.js`/`manifest.json`/`styles.css` from a release, so
  shipping ~26MB of dictionaries here wouldn't actually reach anyone); a
  labeled button per language in Settings → Feuillets → Panneaux latéraux
  downloads them once, on request, from
  [`Sargon01/feuillets-assets`](https://github.com/Sargon01/feuillets-assets)
  (a public repo hosting only these two archives, no code) via Obsidian's
  own `requestUrl`, and caches them on disk under the plugin's `resources/`
  folder. Nothing is downloaded automatically. An optional cloud
  **LanguageTool** engine can be selected instead (or as an automatic
  fallback on mobile, where the local engines can't run — they rely on
  Node's `fs`/`vm`) — picking it means the text you check is sent to
  whatever LanguageTool endpoint you configure (defaults to the public
  `api.languagetool.org`, or a self-hosted server).
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
npm run build   # type-check (structural, via allowJs) + production bundle
npm test        # node:test — pure-function unit tests (utils/core.js)
```

Source lives in `src/`; `main.js` at the repository root is a **build
artifact** (gitignored) — never edit it directly.

## Security

See [`SECURITY.md`](./SECURITY.md) for the threat model summary and how to
report a vulnerability.

## License

[GPL-3.0](./LICENSE) — Copyright (c) 2026 Halim.

Passé de MIT à GPL-3.0 pour intégrer le moteur [Grammalecte](https://github.com/algoo/grammalecte) (correcteur grammatical français, GPL-3.0). Le moteur anglais [Harper](https://github.com/Automattic/harper) (`harper.js`) est sous licence Apache-2.0, compatible avec la distribution en GPL-3.0.