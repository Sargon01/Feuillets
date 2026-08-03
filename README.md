# Feuillets

🇫🇷 **French version:** [README.fr](https://github.com/Sargon01/Feuillets/blob/main/README-fr.md)

## Write a book, not a collection of notes

**Feuillets turns Obsidian into a free, local, long-form writing studio.**

Organize your manuscript in the **Binder**, write **sheet by sheet**, switch to **Focus Mode**, review a scene, chapter, part, or the entire manuscript in **Preview**, then compose and export your work.

> **As simple as a page. As powerful as a novel project.**

Feuillets does not impose a single method or a cluttered interface. You can begin with a Binder, one sheet, and Focus Mode. Advanced tools remain available whenever your project needs them.

**Designed by a writer, for the real work of writers.**

![Feuillets — Binder, writing, and paginated preview](docs/feuillets-ecriture-apercu.png)

*Write in the sheet. Read the book.*

## Get started in five minutes

### 1. Create or open a writing project

From the Binder welcome screen, you can:

- create a fiction or non-fiction project;
- resume an existing manuscript;
- discover Feuillets with a demo project.

A new project opens directly with a first sheet ready for writing.

![Create a first project in Feuillets](docs/creer-premier-projet.gif)

*Create a writing project and start writing in seconds.*

### 2. Build the manuscript in the Binder

The Binder presents the book in its natural structure:

- parts;
- chapters;
- scenes;
- sheets.

Drag and drop lets you move and reorder the manuscript. An existing outline can be imported in one step.

### 3. Open a sheet and write

The **sheet** is the basic unit of Feuillets. It can contain a scene, a section, or any fragment you want to write, move, compare, or exclude independently.

Writing View keeps the syntax discreet and gives the manuscript a literary presentation: controlled width, paragraph indents, compact spacing, and customizable typography.

### 4. Activate Focus Mode

Focus Mode reduces the studio to the essentials:

- centered text;
- adjustable width;
- typewriter scrolling;
- dimmed text outside the current focus;
- a discreet word counter.

![Feuillets Focus Mode](docs/feuillets-concentration.png)

*When it is time to write, everything else disappears.*

### 5. Open Preview

Preview can display:

- the active scene;
- a chapter;
- a part;
- the entire manuscript.

It uses the same composition engine as exports. A correction made in the sheet appears in the rendered document, and navigation can follow the corresponding scene.

![Paginated manuscript preview](docs/feuillets-apercu.png)

*Revise the scene. Judge the book.*

## A simple tool that grows with the manuscript

The essential workflow is enough to write a book:

> Binder → sheet → Focus Mode → Preview → export

As the project grows, Feuillets adds:

- Cards to move and balance scenes;
- Outline to inspect manuscript information;
- Storyline to follow narrative threads;
- Timeline to distinguish story order from event order;
- Research to build the project bible;
- Notes to keep synopses, summaries, sources, and context beside the text;
- Journal and Statistics to track the work;
- revision, snapshots, backups, and versions;
- composition, templates, and exports.

The power of the studio never forces you to display everything.

## Why an experienced writer chooses Feuillets

### Text and structure stay connected

A scene is not only text. It has a place, a status, a synopsis, links, dates, narrative threads, and sometimes a goal.

Feuillets lets you move, split, merge, and duplicate scenes without silently losing the information attached to them.

### The book stays visible while you write

The Binder keeps the architecture of the manuscript in view. Preview lets you read the text within the actual flow of the chapter or book.

![Manuscript Binder in Feuillets](docs/feuillets-classeur.png)

*The book stays visible while you write.*

### Rewriting stays reversible

Automatic backups, snapshots, comparison, and duplication into a new version let you explore another direction without sacrificing the previous state.

![Compare two versions of a sheet](docs/feuillets-comparaison.png)

*Rewrite without losing what you had written.*

### Composition is not discovered at the end

The same composition logic powers Preview and exports. Titles, separators, margins, fonts, spacing, and front matter can be checked before the final document is produced.

## Several ways to understand the same manuscript

![Cards, Outline, Storyline, and Timeline](docs/feuillets-mosaique-narrative.png)

*One manuscript, several angles of view.*

| Need | View |
|---|---|
| Navigate between parts, chapters, and scenes | Binder |
| Reorganize the story visually | Cards |
| Check information and progress | Outline |
| Observe narrative threads | Storyline |
| Verify the story timeline | Timeline |
| Read as a continuous book | Preview |
| Explore freely | Canvas |

## Your writing remains yours

Feuillets works locally inside Obsidian and requires no online service for normal use.

- no Feuillets subscription;
- no telemetry;
- no mandatory server;
- text kept in Markdown;
- code released under the GNU GPLv3 license.

A project can be backed up, synchronized, and reopened with other tools. Feuillets does not lock the manuscript inside an opaque database.

## Import an existing project

Feuillets can:

- open an existing Markdown manuscript without moving or renaming it;
- turn a structured outline into parts, chapters, and scenes;
- import a Scrivener project on desktop while preserving its structure, text, and compatible elements.

![Import a Scrivener project into Feuillets](docs/feuillets-import-scrivener.png)

*Change studios, not manuscripts.*

## Compose and export

Feuillets assembles sheets according to Binder order and the selected rules.

Depending on the version and environment, the composition can be produced as:

- DOCX;
- EPUB;
- ODT;
- PDF through the system print dialog;
- compiled Markdown.

The documentation for the installed version remains the exact reference for supported formats and their limitations.

## Ecosystem

Specialized companion plugins can extend the studio:

- **[Feuillets-Grammalecte](https://github.com/Sargon01/Feuillets-Grammalecte)**: language correction kept separate from the core plugin;
- **[Courrier](https://github.com/Sargon01/Courrier)**: contacts, correspondence, submissions, replies, and follow-ups.

![Feuillets, Feuillets-Grammalecte, and Courrier ecosystem](docs/feuillets-ecosysteme.png)

*Write, correct, submit: one studio, specialized modules.*

## Security, privacy and quality assurance

Feuillets works locally within your Obsidian vault. It contains no telemetry, does not rely on a cloud service, and makes no suspicious network requests.

The plugin is covered by automated tests and continuous integration checks. Its source code, production build, dependencies, and release artifacts are verified before publication.

### About the automated review

Feuillets is a comprehensive writing environment that legitimately requires access to several Obsidian and filesystem capabilities, including reading, creating, and modifying files in the vault.

Because of this broad feature set, the automated review may classify some expected behaviors and architectural choices as cautions. These findings do not necessarily indicate security vulnerabilities.

The published release:

- passes the project’s automated test suite;
- has no known vulnerable dependencies;
- shows no suspicious network activity;
- includes verified GitHub artifact attestations;
- can be reproduced byte-for-byte from the source code.

## Installation

### From Obsidian Community Plugins

To install Feuillets from Obsidian Community Plugins:

1. open **Settings → Community plugins**;
2. search for **Feuillets**;
3. install and enable the plugin.

### Manual installation

1. download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Sargon01/Feuillets/releases/latest);
2. place them in `.obsidian/plugins/feuillets/`;
3. reload Obsidian;
4. enable Feuillets.

## Documentation

- [Discover Feuillets](docs/DISCOVER.md)
- [An author's journey](docs/AUTHOR-WORKFLOW.md)
- [Features by use](docs/FEATURES.md)
- [Creating a clean writing interface](docs/WRITING-INTERFACE.md)
- [Compilation and export](docs/COMPOSITION-AND-EXPORT.md)
- [Rewriting, backups and versions](docs/REWRITING-BACKUPS-AND-VERSIONS.md)
- [Import a Scrivener project](docs/IMPORT-SCRIVENER-EN.md)
- [Philosophy](docs/PHILOSOPHY.md)

> **Feuillets — the free manuscript studio.**
