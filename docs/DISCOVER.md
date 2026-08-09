# Discover Feuillets

> [Français](DECOUVRIR.md) · **English** · [Documentation index](README.md)

## A writing studio built inside Obsidian

Feuillets is designed so that a writer can stay in Obsidian without feeling that a book is merely a collection of unrelated notes.

The manuscript remains Markdown, while Feuillets adds structure, writing views, research, rewriting tools and a composition pipeline.

![Feuillets overview](feuillets-ecriture-apercu.png)

The minimal workflow is deliberately short:

> **Binder → sheet → Focus Mode → Preview → export**

Everything else can remain closed until the project needs it.

## Sheets and project types

A **sheet** is an independent unit of work: a scene, section, fragment, front page or any text that should be movable, comparable or excludable on its own.

Feuillets provides three project types:

- **Fiction** — scene-oriented vocabulary and fiction research categories;
- **Non-fiction** — section-oriented vocabulary with Sources, Bibliography and Notes as a starting point;
- **Free** — no imposed business categories.

Project type chooses vocabulary and initial defaults; it does not lock the folder hierarchy.

## Three ways to start

### Create a Feuillets project

Feuillets prepares `Manuscrit`, a title page, a first writing unit, and sibling Research/Resources spaces.

![Create a project](creer-premier-projet.gif)

### Use an existing folder as-is

Choose any existing vault folder. Feuillets uses it as the manuscript **without moving, renaming or creating files during opening**.

### Initialize an existing folder

**Initialize as a Feuillets project…** associates a project type and prepares appropriate Research categories while leaving the manuscript structure in place.

## Binder

![Binder](feuillets-classeur.png)

The Binder can navigate, create, rename, move and multi-select content; search titles or full text; filter by status, label and progress; show useful metadata; open scopes in Preview; and compile a file, folder or selection.

The same structural order is reused by Preview and export.

## Writing and Focus Mode

Feuillets enriches Obsidian's Markdown editor rather than replacing it. Typography, width, line height, paragraph treatment and optional French typography helpers can be adjusted.

![Focus Mode](feuillets-concentration.png)

Focus Mode reduces the surrounding interface, keeps the writing area comfortable and can dim text outside the current focus.

## Inspector

The right-hand Inspector contains six tabs:

- **Notes**;
- **Research**;
- **Journal**;
- **Edition**;
- **Analysis**;
- **Proofreading**.

Tabs can be hidden. Notes also contains the local Context section. Proofreading receives issues from a companion provider; Feuillets ships no grammar engine itself.

## Notebook

Notebook uses native Canvas for free-form exploration. Ideas can be arranged and connected, then deliberately converted into manuscript sheets or Research documents.

Advanced Canvas is optional.

## Multiple views of one manuscript

![Narrative views](feuillets-mosaique-narrative.png)

- **Cards** — visual rearrangement.
- **Outline** — structured manuscript data.
- **Storyline** — narrative threads.
- **Timeline** — event order versus narrative order.
- **Preview** — composed reading.

These are views of the same files, not parallel databases.

## Research and local context

Research files remain Markdown. Standard and custom sections can coexist, folders can be associated with Binder items, and files can be searched, linked or quoted into the manuscript.

The Context section in Notes uses the passage around the cursor, explicit links, associated documents and dates. Matching remains local and deterministic.

## Analysis and Proofreading

**Analysis** is built into Feuillets and provides prose metrics, repetition detection, chapter balance and writer-entered pace data.

**Proofreading** is a host surface for companion analyzers. Without a provider it simply reports that no analyzer is installed.

## Preview and export

![Preview](feuillets-apercu.png)

Preview can represent one sheet, one folder, a selection or the full project. It shares composition rules with export.

Supported native formats:

- DOCX;
- EPUB;
- ODT;
- PDF on desktop through the system print dialog;
- compiled Markdown.

## Rewriting and safety

![Comparison](feuillets-comparaison.png)

Snapshots, comparisons, manuscript versions and ZIP backups serve different purposes. An as-is folder is backed up strictly within its own scope; a structured `Manuscrit` project can back up the complete surrounding project volume.

## Continue

- [Author workflow](AUTHOR-WORKFLOW.md)
- [Feature reference](FEATURES.md)
- [Composition and export](COMPOSITION-AND-EXPORT.md)
- [Rewriting, backups and versions](REWRITING-BACKUPS-AND-VERSIONS.md)
