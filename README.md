# Feuillets

**Version française: [README-fr.md](README-fr.md)**

## Write first. Organize when the text needs it.

**Feuillets turns Obsidian into a writing and editorial studio for texts that may remain a single sheet or grow into a book.**

Your texts remain ordinary Markdown files and your folders remain real folders. Feuillets adds a Binder, structural views, Continuous mode, Research, review, composition and export around them — without a proprietary project format.

> **Text before system.**

![Feuillets — writing and Preview](docs/feuillets-ecriture-apercu.png)

## From one sheet to a manuscript

A sheet may remain an article, short story, column or standalone chapter. Several sheets may become a collection. A long project can progressively add:

- a hierarchical **Binder**;
- **Cards**, **Outline**, **Storyline** and **Timeline**;
- a visual **Notebook**;
- project **Research**;
- **working annotations**;
- **Continuous** mode, to write several sheets as one manuscript;
- snapshots, versions, backups and comparisons;
- native **collaborative review**;
- **DOCX Review** for Word feedback;
- a central **Edition** workspace for Composition and Layout;
- Markdown, DOCX, EPUB, ODT and PDF export.

## Start with an existing folder

Any existing vault folder can become a Feuillets project **without moving, renaming or converting personal files**.

Feuillets can also create **Fiction**, **Non-fiction** and **Free** projects. Auxiliary spaces live under `_Feuillets` when needed: Research, Resources, Edition, Journal, Snapshots, Backups and Output. Historical paths remain recognized without destructive migration.

![Start a Feuillets project](docs/creer-premier-projet.gif)

## Write

A sheet remains open in Obsidian's native Markdown editor. Feuillets can add controlled width, typography, paragraph indents, line spacing, typography helpers, manuscript-wide find/replace, footnotes, citations, typewriter scrolling and **Focus Mode**.

![Write with controlled typography and Focus Mode](docs/feuillets-concentration.png)

## Organize with the Binder

The **Binder** is primarily for finding and moving text. It can:

- create, rename and move folders and sheets;
- multi-select;
- search and filter;
- isolate one folder and return to the full project;
- open a file, folder or selection in **Preview**;
- open a folder or scope in **Continuous** mode;
- link an existing Research folder from anywhere in the vault;
- switch between the **single Binder** and **split view**.

In split view, a left pane adds two navigation areas without changing the Binder on the right: **Manuscript** shows folders only for an at-a-glance structural view; **Vault** provides lightweight read-only navigation to open other vault documents. The right pane keeps exactly the same rows, menus, selections and interactions as single view.

![The Binder with manuscript organization](docs/feuillets-classeur.png)

See [Binder and navigation](docs/BINDER-AND-NAVIGATION.md).

## Continuous mode: several files, one editable manuscript

**Continuous** mode assembles a file, folder, selection or project into **one continuous editor**. Sheet boundaries remain visible and protected; edits are redistributed to the corresponding source Markdown file.

No composite manuscript is created on disk and no batch of Obsidian tabs is opened. Continuous and Preview can stay synchronized on the same scope.

See [Continuous mode](docs/CONTINUOUS-MODE.md).

## Several views of the same files

| Need | View |
|---|---|
| Navigate | Binder |
| Reorganize visually | Cards |
| Inspect information | Outline |
| Follow narrative threads | Storyline |
| Check event order | Timeline |
| Write several sheets together | Continuous |
| Read the composed document | Preview |
| Explore freely | Notebook |

These views do not create parallel databases: they show the same files from different angles.

![Multiple views: Storyline, Outline, Timeline and Cards](docs/feuillets-mosaique-narrative.png)

## Right-hand panel

Feuillets now groups five areas in the right panel:

| Tab | Purpose |
|---|---|
| **Sheet** | Synopsis, summary, working notes, properties, annotations, footnotes and Context |
| **Research** | Documentation, characters, places, events, sources, bibliography and linked folders |
| **Journal** | Writing journal and tracking |
| **Project** | Project information, goals, statuses, labels, tags and YAML property mapping |
| **Proofreading** | Text analysis, collaborative review, DOCX Review and snapshot comparison |

**Edition** is no longer an Inspector tab: it is a central workspace dedicated to Composition and Layout.

## Research that adapts to an existing vault

Feuillets recognizes its usual Research roots, but you can also **link any existing vault folder** to a Binder folder or sheet. Linked folders appear in the Research panel without being moved, copied or renamed. Their files can be opened in a new tab or side by side, while rename, move, duplicate and trash actions remain unavailable from this external linked-folder entry point.

See [Research and linked folders](docs/RESEARCH-AND-LINKED-FOLDERS.md).

## Project YAML property mapping

In **Project → YAML properties**, Feuillets can map its logical fields to properties already used in your vault: synopsis, summary, status, POV, label, goal, narrative thread, characters and date.

Mapping performs no destructive migration. Feuillets adapts to existing properties instead of requiring them to be renamed.

See [Project and YAML properties](docs/PROJECT-AND-YAML-PROPERTIES.md).

## Working annotations

A manuscript selection can receive a free-form annotation. The passage is highlighted in the editor, the annotation can be read, edited or deleted, and a central list lets you find annotations again.

Annotations remain **outside Markdown** and are never exported.

See [Working annotations](docs/WORKING-ANNOTATIONS.md).

## Proofreading and comparison

Proofreading separates several needs:

- built-in **Text analysis** and optional linguistic providers;
- native **Collaborative review** through `.feuillets` packages;
- **DOCX Review** for tracked changes and comments from Word;
- **Comparison** with a snapshot or another state.

The comparison view distinguishes additions, deletions, replacements and moves. Cut/paste operations can be recognized as moves. **Changes** mode is for handling differences; **Versions** mode removes diff decorations for side-by-side reading. Linked scrolling is optional.

![Comparison view with changes detection](docs/feuillets-comparaison.png)

See [Rewriting, backups and versions](docs/REWRITING-BACKUPS-AND-VERSIONS.md).

## Collaborative review

Feuillets can create a `.feuillets` package for one sheet, one folder or the whole project. The reviewer imports it into Feuillets, works on a local copy, adds notes and returns a package. The author imports that return, compares it with both the sent text **and** the current manuscript, then applies, ignores or handles each proposal manually.

The exchange can continue for several rounds without exposing the rest of the vault.

See [Collaborative review](docs/COLLABORATIVE-REVIEW.md).

## Edition: Composition and Layout

The central **Edition** workspace contains two modes:

- **Composition**: manuscript content, First page, front matter, contents/table of contents, tables, bibliography, appendices and structure;
- **Layout**: Page, Body text, Headings and Blockquote.

The **First page** has one owner only: Composition. Its presentation uses the same template model as Preview and export.

Edition keeps scope, format, **Export** and Preview refresh controls in its top bar. Output file naming is no longer exposed as a normal control; Feuillets resolves it automatically while preserving legacy values for compatibility.

See [Composition and export](docs/COMPOSITION-AND-EXPORT.md).

## Preview and export

**Preview** is the real paginated document used to judge composition. It can represent one sheet, one folder, a selection or the whole project.

Native formats:

- **compiled Markdown**;
- **DOCX**;
- **EPUB**;
- **ODT**;
- **PDF** through the desktop system print dialog.

V2 templates are shared by Preview and exports. Templates can be created, duplicated, renamed, or imported from Ulysses styles and Word templates when properties can be represented.

![Preview with pagination and formatting](docs/feuillets-apercu.png)

## Import from Scrivener

On desktop, Feuillets can import a Scrivener project and recover compatible Binder structure, text, useful metadata, Research and resources. **Scrivener Binder order is now persisted explicitly**, independent of vault alphabetical sorting.

![Import Scrivener with full structure preservation](docs/feuillets-import-scrivener.png)

See [Import a Scrivener project](docs/IMPORT-SCRIVENER-EN.md).

## Freedom, privacy and security

- ordinary Markdown and folders;
- local operation;
- no telemetry;
- no manuscript upload to a Feuillets service;
- no Pandoc or external conversion executable for export;
- collaborative review transported through `.feuillets` files explicitly exchanged by users;
- desktop Scrivener import is an explicit user action;
- GPL-3.0 source.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Installation

### Community Plugins

1. Open **Settings → Community plugins**.
2. Search for **Feuillets**.
3. Select **Install**, then **Enable**.

Feuillets requires Obsidian 1.13.0 or newer.

### Manual installation

Download `main.js`, `manifest.json` and `styles.css` from the [latest GitHub release](https://github.com/Sargon01/Feuillets/releases/latest) and place them in:

```
<your vault>/.obsidian/plugins/feuillets/
```

Then enable it in **Settings → Community plugins → Installed plugins**.

## Ecosystem

Feuillets is designed to work independently, and also pairs well with:

- **[Feuillets-Grammalecte](https://github.com/Sargon01/Feuillets-Grammalecte)** — French and English grammar checking integrated with the Proofreading panel.
- **[Courrier](https://github.com/Sargon01/Courrier)** — Word import/export and DOCX Review support.
- **[Advanced Canvas](https://github.com/Sargon01/Advanced-Canvas)** — Enhanced Canvas features for Notebook and research visualization.

![Feuillets ecosystem](docs/feuillets-ecosysteme.png)

## Documentation

The complete documentation is indexed in [docs/README.md](docs/README.md).

> **Feuillets — write first, build later.**
