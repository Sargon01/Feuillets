# Feuillets

**Version française : [README-fr.md](README-fr.md)**

## Write a book, not a collection of notes

**Feuillets turns Obsidian into a free, local, long-form writing studio.**

The idea is simple: the **Binder** keeps the manuscript visible, each **sheet** remains the place where you write, **Focus Mode** removes distractions, **Preview** lets you read the text as a book, and Feuillets composes and exports the result.

> **As simple as a page. As rich as a book project.**

![Feuillets — Binder, writing and Preview](docs/feuillets-ecriture-apercu.png)

*Write in the sheet. Read the book.*

## What Feuillets adds to Obsidian

Obsidian provides the vault, Markdown files, links and ecosystem. Feuillets provides the writer-specific workspace:

- a hierarchical **Binder** for parts, chapters, scenes, sections and sheets;
- **Cards**, **Outline**, **Storyline** and **Timeline** views of the same manuscript;
- a Canvas-based **Notebook** for free-form idea work before turning ideas into manuscript content;
- a tabbed **Inspector**: Notes, Research, Journal, Edition, Analysis and Proofreading;
- **Focus Mode** and a literary writing presentation;
- paginated **Preview** for a scene, chapter, part or full manuscript;
- scene **split, merge, move, duplicate and multi-selection** tools;
- goals, statistics and a writing journal;
- snapshots, comparisons, versions and ZIP backups;
- compilation of one file, one folder, a selection, or the whole project;
- native **DOCX, EPUB, ODT, PDF and compiled Markdown** export;
- Markdown outline import and **Scrivener** import.

Feuillets does not replace Obsidian's editor: it organizes it around long-form writing.

## Start a project

### Create a project

From the Binder welcome screen choose **Create a project**, then select:

- **Fiction**;
- **Non-fiction**;
- **Free**.

A Feuillets-created project uses a clear structure:

```text
My project/
├── Manuscrit/
├── _Research/ or _Recherche/
├── _Resources/ or _Ressources/
└── Front/ lives inside Manuscrit/
```

Other technical spaces (`_Backups`, `_Snapshots`, `_Journal`, `_Edition`, `_Sortie`, `_Versions`) are created only when needed.

![Create a first project](docs/creer-premier-projet.gif)

### Use an existing folder as-is

Any existing vault folder can become the active manuscript **without moving, renaming or converting its files**.

### Initialize an existing folder as a Feuillets project

From Obsidian's File Explorer, **Initialize as a Feuillets project…** assigns a project type and prepares matching Research categories without restructuring the manuscript.

## Binder

The Binder is the project's backbone. It can:

- navigate the hierarchy;
- create and rename folders and sheets;
- drag items between folders or back to the manuscript root;
- multi-select items;
- search titles or content;
- filter by status, label and progress;
- show excerpts, synopsis, summary, notes, tags, status, progress or word count;
- open a file, folder or selection in Preview;
- compile one file, one folder or a selection.

![Binder](docs/feuillets-classeur.png)

## Writing and Focus Mode

The manuscript remains ordinary Markdown. Feuillets changes presentation and workflow, not ownership of the files:

- controlled text width;
- configurable font and line height;
- prose-oriented indents and paragraph spacing;
- discreet Markdown syntax;
- French typography helpers when desired;
- manuscript-wide search and replace;
- footnotes and citations.

Focus Mode can hide panels, center the writing area, keep the active line in a comfortable zone, dim surrounding text and show a discreet counter.

![Focus Mode](docs/feuillets-concentration.png)

## Inspector

The right-hand Inspector groups the tools that accompany the current writing task.

| Tab | Purpose |
|---|---|
| **Notes** | Synopsis, summary, working notes, properties, footnotes and local context |
| **Research** | Project bible, sources, bibliography, characters, places, events and custom sections |
| **Journal** | Writing journal and progress tracking |
| **Edition** | Editorial documents and reviewed-DOCX reintegration |
| **Analysis** | Prose metrics, repetitions, chapter balance, pace and dashboard |
| **Proofreading** | Issues supplied by a companion text-analysis plugin |

Feuillets itself contains no grammar engine. Its public analysis contract lets a companion such as **Feuillets-Grammalecte** provide issues while Feuillets handles display, navigation and corrections.

## Research and local context

Research categories depend on the project type:

- **Fiction**: characters, places, events, lore, glossary, bibliography;
- **Non-fiction**: sources, bibliography, notes;
- **Free**: no imposed business categories.

You can create your own sections. Legacy French and English folder names remain recognized to avoid duplicate folders in existing projects.

The **Context** section inside Notes can match the current passage with Research files, explicitly linked research folders and chronological information. Matching is local and deterministic; no remote AI reads the manuscript.

## Cards, Outline, Storyline and Timeline

![Cards, Outline, Storyline and Timeline](docs/feuillets-mosaique-narrative.png)

| Question | View |
|---|---|
| Where is this text in the book? | Binder |
| How can scenes be rearranged visually? | Cards |
| Which information or progress values need attention? | Outline |
| Where do narrative threads run? | Storyline |
| In what order do events actually happen? | Timeline |
| How does the composed text read? | Preview |
| Where can ideas be explored freely? | Notebook |

The Notebook is based on native Obsidian Canvas. **Advanced Canvas** is optional; when installed, Feuillets can benefit from its richer Canvas interactions without making it a dependency.

## Preview, compilation and export

Preview works with:

- one sheet;
- one folder;
- a selection;
- the complete project.

Preview and export share the same essential composition rules for titles, separators, front matter and templates.

![Paginated Preview](docs/feuillets-apercu.png)

The native export engine currently supports:

- **DOCX**;
- **EPUB**;
- **ODT**;
- **PDF** — through the system print dialog on desktop;
- **compiled Markdown**.

Outputs are written to `_Sortie`. For a structured `Manuscrit` project it sits next to `Manuscrit`; for an as-is folder project it stays inside that folder.

## Rewrite without losing work

Feuillets separates several safety mechanisms:

- sheet snapshots;
- side-by-side comparison;
- manuscript versions;
- automatic or manual ZIP project backups.

![Compare two states](docs/feuillets-comparaison.png)

For a structured project, a backup covers the project folder that contains `Manuscrit` and its companion folders. For a folder used as-is, backup scope is **strictly that folder**; sibling folders and the vault root are never pulled in implicitly.

## Scrivener import

Scrivener import converts compatible Binder structure, text and project material into vault files and folders.

![Scrivener import](docs/feuillets-import-scrivener.png)

See [Import a Scrivener project](docs/IMPORT-SCRIVENER-EN.md).

## Ecosystem

- **[Feuillets-Grammalecte](https://github.com/Sargon01/Feuillets-Grammalecte)** — French linguistic analysis companion;
- **[Courrier](https://github.com/Sargon01/Courrier)** — contacts, submissions, replies and editorial follow-up.

![Feuillets ecosystem](docs/feuillets-ecosysteme.png)

## Freedom, privacy and security

- Markdown source files;
- local operation;
- no telemetry;
- no manuscript upload to a remote service;
- no grammar engine downloaded or executed by Feuillets;
- no Pandoc dependency;
- GNU GPL-3.0 source;
- unminified, auditable production bundle;
- TypeScript, automated tests, ESLint and Obsidian review lint in CI.

Feuillets requires **Obsidian 1.13.0 or newer**. It is not declared desktop-only; PDF export is desktop-only because it uses the system print dialog.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Installation

### Obsidian Community Plugins

1. Open **Settings → Community plugins**.
2. Search for **Feuillets**.
3. Install and enable it.

### Manual installation

Download `main.js`, `manifest.json` and `styles.css` from the latest release and place them in:

```text
<your vault>/.obsidian/plugins/feuillets/
```

Reload Obsidian and enable Feuillets.

## Documentation

The complete documentation is indexed in **[docs/README.md](docs/README.md)**.

Start with:

- [Discover Feuillets](docs/DISCOVER.md)
- [An author's workflow](docs/AUTHOR-WORKFLOW.md)
- [Features](docs/FEATURES.md)
- [Writing interface](docs/WRITING-INTERFACE.md)
- [Composition and export](docs/COMPOSITION-AND-EXPORT.md)
- [Rewriting, backups and versions](docs/REWRITING-BACKUPS-AND-VERSIONS.md)
- [Scrivener import](docs/IMPORT-SCRIVENER-EN.md)

> **Feuillets — the free manuscript studio.**
