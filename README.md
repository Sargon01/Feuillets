# Feuillets

**Version française: [README-fr.md](README-fr.md)**

## Write first. Organize when the text needs it.

**Feuillets turns Obsidian into a writing and editorial studio for texts that may remain a single sheet or grow into a book.**

Your texts remain ordinary Markdown files and your folders remain real folders. Feuillets adds a Binder, structural views, Continuous mode, Research, review, composition and export around them — without a proprietary project format.

> **Text before system.**

**New to Feuillets?** [Start with what you want to do](docs/DISCOVER.md): write across several sheets, annotate, reorder, review or export without reading the whole documentation first.

![Feuillets — writing and Preview](docs/feuillets-ecriture-apercu.png)

## From one sheet to a manuscript

A sheet may remain an article, short story, column or standalone chapter. Several sheets may become a collection. A long project can progressively add:

- a hierarchical **Binder**;
- **Cards**, **Outline**, **Storyline** and **Timeline**;
- a visual project or folder **Notebook**, with a **Binder Plan** and **mindmaps**;
- project **Research**;
- **working annotations**;
- **Continuous** mode, to write several sheets as one manuscript;
- snapshots, versions, backups and comparisons;
- native **collaborative review**;
- **DOCX Review** for Word feedback;
- a central **Edition** workspace for Composition and Layout;
- optional **semantic roles** for variants, extractions and collections without duplicating the manuscript;
- a 16:9 **Presentation** rendering from the same Markdown;
- Markdown, DOCX, EPUB, ODT and PDF export.

## Start with an existing folder

Any existing vault folder can become a Feuillets project **without moving, renaming or converting personal files**.

Feuillets can also create **Fiction**, **Non-fiction** and **Free** projects. Auxiliary spaces live under `_Feuillets` when needed: Research, Resources, Edition, Journal, Snapshots, Backups and Output. Historical paths remain recognized without destructive migration.

![Start a Feuillets project](docs/creer-premier-projet.gif)

## Write

A sheet remains open in Obsidian's native Markdown editor. Feuillets can add controlled width, typography, paragraph indents, line spacing, typography helpers, manuscript-wide find/replace, footnotes, citations, typewriter scrolling and **Focus Mode**.

Use **Reorder text** to enter a local editor mode: drag a paragraph, or a selection contained within one paragraph, to a visibly marked insertion point. Press **Escape** to leave the mode; each move is one Undo step and preserves the exact Markdown.

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

It also supports **Reorder text** within each sheet: paragraphs or fragments contained in one paragraph can be moved, but never across a sheet boundary.

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
| Explore freely or think around a folder | Notebook |

These views do not create parallel databases: they show the same files from different angles. The **Notebook** remains a free-form Canvas; it can be project-wide or attached to a folder and can host a **Binder Plan** or **mindmaps** without changing Markdown until an explicit Binder action is applied.

See [Notebook — from ideas to manuscript](docs/HOW-TO-NOTEBOOK.md).

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

Before a major rewrite, take a **snapshot** of the sheet or project. Rewrite normally, then use **Compare a version** to confront the current state with that snapshot. The comparison view helps identify additions, deletions, replacements and moves, and can restore a precise passage without rolling back the whole text.

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

Edition groups **Scope**, **Content**, **Format** and **Export**, alongside Preview refresh. The Content menu selects the full document, an extraction or a collection. Output file naming is no longer exposed as a normal control; Feuillets resolves it automatically while preserving legacy values for compatibility.

See [Composition and export](docs/COMPOSITION-AND-EXPORT.md).

## Semantic publishing and Presentation

Feuillets can optionally annotate selected passages with **semantic roles** such as definition, question, solution, evidence, source, summary or recommendation. Roles are never mandatory — a novel, essay or article can ignore them completely.

Those roles can then drive, without duplicating source text:

- a **content variant** that hides selected roles while keeping the document;
- a **content extraction** that keeps whole structural sections located through roles;
- a **content collection** that gathers role blocks themselves with heading context.

The same Markdown can also be rendered as a 16:9 **Presentation**. Slides are separated with `---`, layout remains automatic whenever possible, and `[!speaker-notes]` are not projected.

See [Semantic roles](docs/SEMANTIC-ROLES.md), [Content variants, extractions and collections](docs/CONTENT-VARIANTS-EXTRACTIONS-COLLECTIONS.md), [Presentation](docs/PRESENTATION-EN.md) and the [publishing tutorial](docs/SEMANTIC-PUBLISHING-TUTORIAL.md).

## Preview and export

**Preview** is the real paginated document used to judge composition. It can represent one sheet, one folder, a selection or the whole project.

### Paginated footnotes

In paginated Preview and PDF, a footnote is composed at the bottom of the page containing its first call. Its height is reserved during pagination, so body text is reduced or moved to the next page instead of overlapping the note. Repeated calls do not duplicate the note definition. In multi-column layouts, footnotes remain full-width below the columns.

The source remains ordinary Markdown (`[^1]`); only the displayed marker is smoothed in the composed document. Current limitation: a single footnote taller than the usable height of one page is not yet split across pages.

### Pandoc / Zotero citation preview

A project can smooth Pandoc/Zotero citekeys in Preview without changing the manuscript. In project settings, **Pandoc / Zotero citation preview** lets you choose **Raw citekeys** or **Author-date**, then provide the path to a `.bib` file relative to the vault root.

For example, `[@smith2024]` can appear as `(Smith, 2024)`, `[@smith2024, p. 42]` as `(Smith, 2024, p. 42)`, and `[@smith2024; @doe2023]` as `(Smith, 2024; Doe & Brown, 2023)`. Unknown citekeys, groups that cannot be fully resolved, and syntax outside this preview’s supported subset remain raw.

This feature is **visual and Preview-only**: Markdown files and Feuillets native exports keep the original citekeys. Feuillets does not provide a full CSL engine here; an external Pandoc workflow can still apply its own final bibliography style. The `.bib` file is re-read when its modification time changes.

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
