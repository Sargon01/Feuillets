# Replace Scrivener with Feuillets

> [Français](Remplacer-Scrivener-par-Feuillets.md) · **English** · [Documentation index](README.md)

You have used Scrivener for a long time. You know the Binder, Corkboard, synopsis, document notes, metadata, snapshots and Compile. You want to know whether Feuillets can reproduce that working method inside Obsidian without forcing you to relearn everything.

The answer is: **yes for most long-form writing work, with one important difference.**

Scrivener is a self-contained application built around its own project model. Feuillets uses ordinary folders and Markdown files inside Obsidian. You gain openness, direct access to your files and the Obsidian ecosystem. In return, some functions have different names or live in different places.

![Import a Scrivener project](feuillets-import-scrivener.png)

---

## 1. Find the Binder again

In Scrivener, the Binder contains the manuscript hierarchy.

In Feuillets, the equivalent is the **Binder**.

You can work with:

- parts;
- chapters;
- scenes or sheets;
- folders;
- drag and drop;
- rename;
- duplicate;
- move back to manuscript root;
- split and merge scenes.

The important difference is that this hierarchy corresponds to real folders and Markdown files in the vault.

### Main equivalents

| Scrivener | Feuillets |
|---|---|
| Binder | Binder |
| Document | Sheet |
| Folder | Folder |
| Draft / Manuscript | Manuscript scope |
| Research | Research tab and project Research folders |
| Trash | Obsidian trash / file deletion |

A sheet is the movable writing unit. It can represent a scene, article, fragment, section or any other piece you want to write, move, compare or compile independently.

---

## 2. Find the Corkboard again

Scrivener's Corkboard displays documents as index cards.

Feuillets uses the **Cards** view.

A card can show:

- title;
- synopsis;
- status;
- label;
- tags;
- word count;
- progress;
- optional target.

Cards can be filtered and reordered to reshape the manuscript.

![Cards, Outline, Storyline and Timeline](feuillets-mosaique-narrative.png)

### Difference

Feuillets does not try to reproduce the visual metaphor of a cork board exactly. The working purpose is the same: step back from prose, inspect writing units and reorganize them visually.

---

## 3. Find the Outliner again

Scrivener's Outliner presents project documents and metadata in columns.

In Feuillets, use **Outline**.

You can display information such as:

- title;
- synopsis;
- status;
- label;
- tags;
- word count;
- target;
- progress;
- date;
- other project properties.

Outline is useful when you want to inspect the manuscript as an editorial table without opening every scene.

---

## 4. Find synopsis and document notes again

Scrivener's Inspector combines synopsis, notes, metadata, comments and bookmarks.

Feuillets separates these intentions inside its unified **Inspector**.

### Notes tab

The Notes tab can contain:

- synopsis;
- summary;
- working notes;
- sources;
- chapter or part notes;
- internal outline of the active sheet;
- sheet properties;
- automatic Context for the passage around the cursor.

### Properties inside Notes

Properties describe and classify the active sheet:

- status;
- one or several labels;
- dates;
- tags;
- targets;
- custom Markdown/YAML properties.

### Research tab

Research contains the project's reference material:

- characters;
- places;
- events;
- concepts;
- lore;
- glossary;
- bibliography;
- sources.

Feuillets therefore separates the intentions more explicitly:

- **Notes** accompany writing and contain properties and Context;
- **Research** documents the subject or story world;
- **Edition** contains editorial material and DOCX Revision.

---

## 5. Find labels, statuses and custom metadata again

Scrivener supports labels, statuses and custom metadata.

Feuillets uses equivalent ideas stored in readable Markdown properties.

You can use:

- status;
- one or several labels;
- tags;
- date;
- word target;
- progress;
- custom properties.

These values can appear in:

- Binder;
- Cards;
- Outline;
- Storyline;
- Timeline;
- filters;
- Notes.

When only one visual color is possible, the first label acts as the primary one.

The difference is that the data remains visible in the files instead of living only in an application-specific project database.

---

## 6. Find Collections again

Scrivener Collections create temporary groupings without changing the Binder.

Feuillets uses a more distributed approach:

- filters by status;
- filters by label;
- filters by tag;
- progress filters;
- manual multi-selection;
- custom Preview or composition scope;
- folders and collections of texts;
- narrative views.

You can isolate, for example:

- all scenes to revise;
- all sheets with a given label;
- all scenes in one narrative thread;
- a manual set of texts for a collection;
- a temporary selection for export.

It is not a literal copy of the Collections object, but the transversal grouping need is covered.

---

## 7. Find Scrivenings again

Scrivener's Scrivenings mode lets several documents read as one continuous text.

In Feuillets, use continuous reading and **Preview**.

You can read:

- one sheet;
- one chapter;
- one part;
- one folder;
- a selection;
- the entire manuscript.

Preview uses the same composition logic as export. A correction made in a source sheet is reflected in the composed document.

### Important difference

Continuous reading is for moving through the manuscript. Preview is for judging the composed result and its hierarchy.

---

## 8. Find Research again

Scrivener keeps Research inside the project.

Feuillets has a dedicated **Research** tab and ordinary Markdown folders.

Research can contain characters, places, events, concepts, sources, bibliography, glossary and custom sections.

A Research note can be linked from the manuscript, previewed, quoted into the active sheet or surfaced by Context.

Historical French and English Research folder names are recognized so that existing projects do not need destructive renaming.

---

## 9. Find Project and Document Bookmarks again

Scrivener bookmarks keep important documents close to the active project or document.

In Feuillets, the equivalent workflow combines:

- Research associated with a sheet;
- Research associated with its chapter;
- Markdown links;
- folder notes;
- pinned references in **Notes → Context**.

A pinned reference stays visible for the active sheet even when you move to another paragraph.

---

## 10. Find Snapshots again

Scrivener Snapshots preserve an earlier state of a document before rewriting.

Feuillets also provides snapshots and complementary safety mechanisms:

- snapshot of a sheet;
- dated copies;
- project backup;
- longer-lived versions;
- comparisons.

The goal is the same: rewrite without losing the previous state.

![Compare versions](feuillets-comparaison.png)

The difference is that backups and versions remain accessible as files in the vault.

---

## 11. Find version comparison again

Scrivener can compare the current document against a Snapshot.

Feuillets provides a comparison view that makes changes visible.

You can inspect:

- additions;
- deletions;
- rewritten wording;
- other textual differences.

Comparison complements snapshots and backups rather than replacing them.

---

## 12. Find comments and annotations again

Scrivener offers comments, inline annotations and notes.

In Feuillets, several mechanisms can cover those needs:

- Markdown or HTML comments;
- working notes in Notes;
- footnotes;
- properties;
- highlighting and annotation supplied by Obsidian or other plugins;
- comments and tracked revisions returned in an editor's DOCX.

Feuillets does not reproduce every proprietary Scrivener annotation type. It leans more heavily on Markdown and the Obsidian ecosystem.

---

## 13. Find chronology again

Scrivener mainly exposes dates and metadata. Many writers pair it with Aeon Timeline for deeper chronology work.

Feuillets includes a **Timeline** view directly.

It can show:

- dated scenes;
- historical or narrative events;
- milestones;
- chronological order;
- narrative order;
- flashbacks and gaps;
- filters.

The sheet date can also feed **Notes → Context**, which can surface character state and chronological alerts while writing.

---

## 14. Find narrative-thread tracking again

Scrivener users often represent story arcs through labels, keywords, Collections or metadata.

Feuillets has a dedicated **Storyline** view.

It can help observe:

- narrative threads;
- point-of-view characters;
- statuses;
- labels;
- scenes where a thread appears;
- open or resolved threads;
- gaps in a thread.

This gives a structural reading of the same manuscript files.

---

## 15. Find Composition Mode again

Scrivener Composition Mode hides the application around the text.

Feuillets uses **Focus Mode**.

It can provide:

- controlled text width;
- typewriter scrolling;
- dimming outside the active area;
- discreet word count;
- reduced interface;
- customizable typography.

The goal is the same: remain in the text while the project tools stay available when needed.

---

## 16. Find writing targets again

Scrivener provides project and session targets.

Feuillets can track:

- a word target per sheet;
- progress;
- project statistics;
- words written;
- writing calendar;
- daily journal.

The Journal can record more than numbers:

- session goal;
- difficulty;
- narrative decision;
- review note;
- project state.

---

## 17. Find Compile again

Compile is one of Scrivener's defining features.

Feuillets also has a composition and export engine.

You can choose:

- content scope;
- Binder order;
- title treatment;
- separators;
- front matter;
- styles;
- page layout;
- output format.

The scope can be one file, one folder with descendants, a manual selection, or the entire project. Selecting both a folder and one of its descendants does not duplicate the descendant.

Supported native outputs include:

- compiled Markdown;
- DOCX;
- EPUB;
- ODT;
- PDF through desktop system printing.

Preview and exports share the same composition logic.

### Difference

Scrivener's Compile system is exceptionally mature and configurable. Feuillets aims for a more direct workflow. If your production chain depends on highly specialized Compile presets, validate your exact requirements before migrating permanently.

---

# Migrate a Scrivener project

Feuillets can import a Scrivener project on desktop and recover supported elements such as:

- Binder structure;
- folders;
- text documents;
- manuscript order;
- titles;
- compatible metadata;
- supported images or resources.

After import, check:

- order of parts, chapters and scenes;
- titles;
- synopsis;
- notes;
- images;
- special characters;
- metadata;
- non-text documents;
- elements excluded from compilation.

Keep the original Scrivener project as an archive until you have validated several control exports.

---

# Equivalent daily workflow

## In Scrivener

```text
Open project
→ select a scene in Binder
→ write
→ inspect metadata and notes
→ open Research
→ update synopsis/status
→ create Snapshot
→ Compile
```

## In Feuillets

```text
Open project
→ select a sheet in Binder
→ write
→ use Notes and Context
→ open or pin Research
→ update synopsis/properties
→ create snapshot when useful
→ check Preview
→ compose and export
```

---

# What actually changes

## You gain

- ordinary Markdown files;
- a project readable without Feuillets;
- deep Obsidian integration;
- links and backlinks;
- Canvas;
- contextual Research;
- chronological alerts;
- other Obsidian plugins;
- no proprietary manuscript database;
- local operation without a Feuillets subscription;
- a Notebook for free visual ideation;
- direct Word-return workflow through DOCX Revision.

## You lose or change

- Scrivener's completely controlled and homogeneous interface;
- some very specialized Compile capabilities;
- proprietary Scrivener annotation types;
- Collections in their exact Scrivener form;
- an autonomous application built around one workflow;
- some simplicity that comes from a closed environment.

Obsidian is modular. That creates more freedom, but it also means more optional settings and plugins exist around Feuillets.

---

# Can Feuillets really replace Scrivener?

## Probably yes if you mainly use Scrivener to:

- structure a novel or long work;
- write scene by scene;
- navigate with Binder;
- maintain synopsis and notes;
- track statuses and goals;
- consult Research;
- view scenes as cards or a table;
- keep versions;
- read the manuscript continuously;
- export DOCX, EPUB, ODT or PDF.

## Validate carefully if you depend heavily on:

- extremely customized Compile chains;
- proprietary Scrivener annotations;
- complex existing Scrivener templates;
- specialized screenplay formats;
- a precise Scrivener mobile synchronization workflow;
- very elaborate saved Collections/searches;
- project-specific Scrivener automation.

---

# Recommended transition

Do not migrate your main project in one irreversible step.

1. Import a copy of the Scrivener project.
2. Check the Binder in Feuillets.
3. Open several scenes and verify their text.
4. Check synopsis, notes and metadata.
5. Recreate or verify statuses, labels and tags.
6. Test Cards and Outline.
7. Test Research and Notes → Context.
8. Create a snapshot.
9. Compose a chapter.
10. Export a DOCX and compare it with your Scrivener output.
11. Work in parallel for a few days if the manuscript is critical.
12. Switch permanently only after the complete workflow is satisfactory.

---

# Verdict

Feuillets is not trying to become a pixel-for-pixel copy of Scrivener inside Obsidian.

It takes the major long-form writing principles — Binder, movable writing units, synopsis, metadata, Research, snapshots, continuous reading and composition — and rebuilds them around **ordinary Markdown files and the Obsidian environment**.

For writers whose central need is writing, structuring, revising and exporting a book, that can cover most of the Scrivener workflow while removing project-format lock-in.
