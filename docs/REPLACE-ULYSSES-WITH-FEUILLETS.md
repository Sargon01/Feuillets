# Replace Ulysses with Feuillets

> [Français](Remplacer-Ulysses-par-Feuillets.md) · **English** · [Documentation index](README.md)

You use Ulysses for its clean writing interface, groups and sheets, goals and polished export. You want to know whether Feuillets can cover that workflow inside Obsidian without turning writing into system administration.

The answer is: **yes, especially for books, collections and documented projects**, but the transition differs from a Scrivener migration.

Ulysses favors a unified library, excellent Apple integration and a highly consistent experience. Feuillets favors accessible Markdown files, an explicit manuscript structure and deeper planning, Research and continuity tools.

![Writing and Preview](feuillets-concentration-apercu.png)

---

## 1. Find the Ulysses library again

Ulysses gathers texts into one central library with projects, groups, filters and sheets.

Feuillets works in an **Obsidian vault** that can contain one or several writing projects.

A project can include:

- manuscript;
- parts;
- chapters;
- sheets;
- Research;
- resources;
- images;
- templates;
- exports;
- backups.

### Main equivalents

| Ulysses | Feuillets |
|---|---|
| Library | Obsidian vault |
| Project | Feuillets project |
| Group | Folder |
| Sheet | Sheet |
| Material sheet | Research note or excluded sheet |
| Filter | Filter, selection or view |
| Trash | Obsidian trash / file deletion |

The essential difference is that Ulysses manages its own library, while Feuillets uses ordinary files and folders visible in Obsidian and the filesystem.

---

## 2. Find Projects again

A Ulysses Project is a self-contained writing space with main content, extras, keywords and export preferences.

A Feuillets project can also group:

- manuscript;
- documentation;
- settings;
- templates;
- goals;
- backups;
- composition settings.

You can:

- create a new project;
- use an existing Markdown folder as-is;
- initialize an existing folder as a structured project;
- manage several projects in one vault;
- import an outline;
- import a Scrivener project;
- use the demo project.

### Difference

A Ulysses Project remains part of the Ulysses library.

A Feuillets project remains ordinary Markdown and folders. Even with Feuillets disabled, the files are still accessible.

---

## 3. Find groups again

Ulysses groups organize sheets and can represent a book, part, chapter, category or archive.

Feuillets uses real **folders**.

For example:

```text
My novel/
├── Part I/
│   ├── Chapter 1/
│   │   ├── Scene 1.md
│   │   └── Scene 2.md
│   └── Chapter 2/
└── Part II/
```

Feuillets can use that hierarchy in:

- Binder;
- Cards;
- Outline;
- reading;
- Timeline;
- Storyline;
- Preview;
- final composition.

### Difference

Ulysses groups are intentionally broad. Feuillets remains flexible but can also understand editorial levels such as part, chapter, scene and sheet.

---

## 4. Find Sheets again

The sheet is Ulysses' basic writing unit.

The equivalent in Feuillets is also the **sheet**.

A sheet can represent:

- a scene;
- an article;
- a short chapter;
- a section;
- a fragment;
- a preface;
- a document intended for composition.

You can create, move, rename, duplicate, split, merge or exclude it from composition.

A displayed title can differ from the filename.

---

## 5. Find clean writing again

Ulysses is known for keeping markup light and separating writing from final formatting.

Feuillets follows the same general principle:

- Markdown source;
- controlled writing width;
- discreet syntax;
- configurable typography;
- manuscript-style paragraphs;
- rendered headings;
- typographic helpers;
- Focus Mode.

In Ulysses, you write in the application's sheet format.

In Feuillets, you write in standard Markdown with Obsidian's native editor.

That text remains usable in Obsidian, another Markdown editor, Git, scripts and future tools.

---

## 6. Find editor-only mode again

Ulysses can switch between three-pane, two-pane and editor-only layouts.

In Feuillets you can:

- hide Obsidian sidebars;
- use Focus Mode;
- reduce interface chrome;
- enable typewriter scrolling;
- dim paragraphs away from the cursor;
- keep a discreet word counter.

![Focus Mode](feuillets-concentration.png)

| Ulysses | Feuillets |
|---|---|
| Editor Only | Focus Mode |
| Sheet List + Editor | Binder + Writing |
| Library + Sheet List + Editor | Full Binder + Writing |
| Full Screen | Obsidian full screen / Focus Mode |

Ulysses remains more immediately uniform here. Feuillets offers more optional control because it lives inside Obsidian.

---

## 7. Find keywords again

Ulysses keywords can classify sheets across groups.

Feuillets can use:

- tags;
- one or several labels;
- statuses;
- narrative threads;
- custom properties.

Example:

```yaml
---
tags:
  - character/Kemal
  - place/Suvasa
status: revision
labels:
  - tension
threads:
  - hikmet-secret
---
```

These values can feed Binder, Cards, Outline, Storyline, Timeline, filters and composition.

### Difference

Ulysses has a particularly simple centralized keyword manager.

Feuillets gains the flexibility of Obsidian tags and properties and can distinguish several meanings: theme, editorial status, narrative thread, character, place or custom category.

---

## 8. Find filters again

Feuillets covers filtering through several mechanisms:

- tag filter;
- status filter;
- label filter;
- progress filter;
- manual selection;
- manuscript search;
- Obsidian search;
- Outline and Storyline views;
- custom Preview or export scope.

It does not reproduce the Ulysses Filter object exactly. It covers the same practical need through views, metadata and Obsidian.

---

## 9. Find Material Sheets again

A Ulysses Material Sheet stays in the project but is excluded from normal export and goals.

In Feuillets you can:

- place documentation in **Research**;
- exclude a sheet from composition;
- use a non-compiled folder;
- choose exactly which files to export;
- store working notes in Notes.

| Ulysses | Feuillets |
|---|---|
| Material Sheet | Research note |
| Material sheet in a group | Excluded sheet |
| Project extra | Research or Resources folder |
| Automatic export exclusion | Composition exclusion |

Feuillets makes a clearer distinction between manuscript text and project documentation.

---

## 10. Find the Dashboard again

The Ulysses Dashboard gathers keywords, goals, statistics and attachments for the active sheet.

Feuillets distributes those functions through the Inspector.

### Notes

- synopsis;
- summary;
- working notes;
- sources;
- Context;
- folder notes;
- document outline;
- properties.

### Statistics and Journal

- word targets;
- progress;
- counts;
- writing calendar;
- daily notes.

### Research

- characters;
- places;
- events;
- concepts;
- sources;
- bibliography;
- glossary.

The information is split by purpose rather than gathered in one single dashboard.

---

## 11. Find notes and attachments again

Ulysses can attach notes, images and files to a sheet.

Feuillets combines:

- working notes;
- Research;
- Markdown links and embeds;
- vault files;
- Images under project Resources;
- Obsidian attachments.

### Difference

Attachments are ordinary vault files rather than objects hidden inside a proprietary library.

---

## 12. Find side-by-side consultation again

Obsidian can split the workspace into several panes.

A writer can keep:

- the manuscript beside Research;
- a sheet beside Preview;
- two scenes side by side;
- a Research note beside the active sheet.

Feuillets benefits from Obsidian's native pane model instead of creating a separate split-view system.

---

## 13. Find documentation linked to the text again

Feuillets' Research and **Notes → Context** go beyond a simple attached note.

A current passage can surface:

- explicit references;
- aliases;
- associated Research;
- documents sharing significant terms;
- pinned references;
- chronological information.

This remains local and deterministic.

---

## 14. Find favorites and important references again

For important material, use combinations of:

- pinned Context references;
- links;
- bookmarks supplied by Obsidian;
- project notes;
- tags.

A pinned Context item remains attached to the current sheet while you move through its paragraphs.

---

## 15. Find writing goals again

Ulysses is strong at writing targets.

Feuillets can provide:

- sheet target;
- project target;
- progress;
- statistics;
- recent activity;
- writing calendar;
- writing journal.

### Difference

Ulysses integrates goals very tightly into its interface. Feuillets distributes them across its writing and project tools.

---

## 16. Find statistics again

Feuillets can track:

- words;
- characters;
- sentences;
- paragraphs;
- estimated reading time;
- progress;
- recent writing activity.

Statistics are intended to support the work, not turn writing into a measurement exercise.

---

## 17. Find outline navigation again

Markdown headings inside a sheet remain usable through Obsidian and Feuillets.

A document such as:

```markdown
# Chapter

## First section

### A memory

## Back to the present
```

can keep its internal structure while the Binder handles the larger book structure.

---

## 18. Find book organization again

For a long manuscript, Feuillets offers several representations.

### Binder

The actual hierarchy of files and folders.

### Cards

Visual scene-level reorganization.

### Outline

Tabular inspection of hierarchy and metadata.

### Storyline

Narrative threads.

### Timeline

Chronological order and events.

### Reading

Continuous movement through manuscript text.

### Preview

The composed result before export.

All of them refer to the same manuscript files.

---

## 19. Find sheet movement again

Sheets can be moved by drag and drop in the Binder.

Feuillets preserves custom order and allows moving items back to manuscript root.

Scene tools can also split, merge and duplicate sheets while preserving configured metadata rules.

---

## 20. Find versions and backups again

Feuillets separates several safety tools:

- snapshots;
- comparisons;
- narrative versions;
- ZIP backups;
- ordinary vault backups or Git.

The manuscript stays made of files rather than being locked into a single application's history.

---

## 21. Find Apple synchronization again

Ulysses has first-class Apple ecosystem synchronization.

Feuillets does not reproduce that service.

Instead, the vault can be synchronized with whatever solution the writer chooses, such as Obsidian Sync or another compatible file-sync method.

### Consequence

Ulysses offers a more integrated Apple experience. Feuillets gives the author control over the files and the sync layer.

---

## 22. Find external folders again

Because Feuillets works inside an Obsidian vault, project folders are normal filesystem folders.

You can use existing Markdown folders as-is rather than importing every text into a proprietary library.

That is particularly useful when a folder begins as ordinary notes and only later becomes a book or collection.

---

## 23. Find quick export again

You can export:

- one sheet;
- one folder;
- a selected set of sheets and folders;
- the complete project.

This makes Feuillets suitable not only for books but also for articles, essays and collections where output scope changes frequently.

---

## 24. Find export formats again

Native formats include:

- compiled Markdown;
- DOCX;
- EPUB;
- ODT;
- PDF through the desktop system print workflow.

### Difference

Ulysses has a mature export ecosystem and its own style system. Feuillets focuses on an integrated manuscript composition chain whose source remains Markdown.

---

## 25. Find export styles again

Feuillets can apply composition rules, titles, separators, fonts, spacing, margins and templates.

DOCX uses named styles where appropriate. EPUB remains adaptable to the reader.

Preview shares composition logic with export, so you can inspect the document before producing the final file.

![Paginated Preview](feuillets-apercu.png)

---

## 26. Find web publishing again

Ulysses can publish directly to several web platforms.

Feuillets does not aim to reproduce a built-in blog publishing service.

### Verdict on this point

If direct publishing to a supported blog platform is central to your workflow, Ulysses remains more convenient. Feuillets can still produce Markdown or other outputs for a separate publishing workflow.

---

## 27. Find grammar and style checking again

Feuillets core includes local prose **Analysis**, but it deliberately does not embed a grammar engine.

A specialized companion such as **Feuillets-Grammalecte** can feed **Proofreading** through the Feuillets analysis-provider API. Other Obsidian tools can also be used according to language and preference.

### Difference

Ulysses can present language tools as part of one application. Feuillets keeps the writing studio separate from the correction engine.

---

## 28. Find comments and annotations again

Depending on the need, use:

- Markdown comments;
- working notes;
- footnotes;
- properties;
- Obsidian-compatible annotation plugins;
- DOCX Revision for feedback received from an editor or proofreader.

The model is more open: annotations can come from several tools that share the same vault.

---

## 29. Find the novel workflow again

### In Ulysses

```text
Create project
→ create groups
→ write one sheet per scene/chapter
→ add keywords
→ attach material
→ track target
→ choose project/sheets
→ choose export style
→ export
```

### In Feuillets

```text
Create or open project
→ build parts and chapters in Binder
→ write one sheet per scene/section
→ add synopsis, tags, status and threads
→ document in Research
→ use Context while writing
→ track goals and Journal
→ reread in Preview
→ select content
→ compose and export
```

---

## 30. Find the article workflow again

### In Ulysses

```text
Create sheet
→ write
→ add keywords
→ set length target
→ correct
→ export or publish
```

### In Feuillets

```text
Create sheet
→ write
→ add tags, status and sources when useful
→ set target
→ Preview
→ export the sheet alone
```

Several articles can later be gathered and composed as a collection.

---

## 31. Find the collection workflow again

In Feuillets:

1. each article or short story remains an independent sheet;
2. sheets can live in different folders;
3. choose the texts for the collection;
4. define order;
5. choose titles and separators;
6. Preview;
7. export the collection.

This works for short stories, essays, chronicles or article collections.

---

# What you gain by moving to Feuillets

## Truly open files

Your writing remains ordinary Markdown.

## Richer book structure

Parts, chapters, scenes, synopsis, statuses, threads, Timeline, Cards, Outline, Storyline and Preview can all contribute without changing the source format.

## A real project bible

Characters, places, events, concepts and sources become organized Research rather than merely extra sheets in a group.

## Automatic Context

The current passage can surface useful references and continuity alerts without manual searching.

## The Obsidian ecosystem

You keep links, backlinks, graph, Canvas, plugins, properties, templates and commands.

## No Feuillets subscription

Feuillets is local and GPL-3.0.

---

# What you lose or change

## Apple's seamless integration

Ulysses remains stronger if the Apple ecosystem is the center of the workflow.

## Extreme simplicity

Feuillets can expose more concepts because it handles larger structured manuscripts and lives inside a modular application.

## One centralized Dashboard

Information is distributed across the Inspector according to purpose.

## Direct blog publishing

Feuillets does not try to be a publishing service.

## Integrated grammar engine

Language correction is delegated to a companion or another plugin.

## Existing Ulysses export styles

They are not directly portable as Ulysses style files.

---

# Can Feuillets really replace Ulysses?

## Probably yes if you mainly use Ulysses for:

- distraction-free Markdown writing;
- groups and sheets;
- keywords and goals;
- long-form organization;
- supporting material;
- exporting DOCX, EPUB, ODT, PDF or Markdown.

## Feuillets may be better suited if you need:

- explicit book hierarchy;
- a deep Research bible;
- narrative threads;
- Timeline;
- Context during writing;
- version comparison;
- DOCX editorial revision;
- flexible file/folder/selection compilation;
- direct access to all source files.

## Ulysses will probably remain preferable if your priority is:

- the most seamless Apple-only experience;
- direct publishing to supported web platforms;
- a very uniform closed interface;
- existing Ulysses-specific style workflows you do not want to rebuild.

---

# Recommended transition

## 1. Do not migrate the whole library at once

Choose one active project.

## 2. Export it from Ulysses

Prefer a format that preserves text and structure as cleanly as possible for your project.

## 3. Recreate or reuse the folder structure

Use the existing Markdown folder as-is if it already makes sense, or initialize it as a Feuillets project.

## 4. Convert keywords carefully

Decide which should become tags, labels, statuses or narrative threads.

## 5. Check special elements

Review images, notes, attachments and anything tied to Ulysses-specific markup.

## 6. Recreate goals

Set sheet or project targets where they are still useful.

## 7. Test export

Compose a representative chapter or article and compare the result.

## 8. Work in parallel briefly

Do not delete the Ulysses original until the complete writing and export workflow has been validated.

---

# Quick correspondence table

| Need | Ulysses | Feuillets |
|---|---|---|
| Main text unit | Sheet | Sheet |
| Grouping | Group | Folder |
| Clean editor | Editor / Full Screen | Writing View / Focus Mode |
| Keywords | Keywords | Tags, labels, status, threads |
| Material | Material Sheet | Research / excluded sheet |
| Dashboard | Dashboard | Inspector tabs |
| Goal | Goal | Target / progress / Journal |
| Export | Export | Composition + export |
| Supporting notes | Attachments / notes | Notes + Research |
| Book structure | Groups | Binder + narrative views |
| Version safety | Library/version mechanisms | Snapshots, comparison, backups |
| Web publishing | Integrated services | External workflow |

---

# Verdict

Feuillets does not try to reproduce Ulysses' library or Apple integration.

It preserves the principle that makes Ulysses attractive — **write in a simple text unit and separate writing from final formatting** — while adding a more explicit manuscript structure, Research, narrative views and editorial workflows.

For a writer whose projects have grown beyond isolated sheets into books, collections or heavily documented works, Feuillets can be a natural next step without giving up Markdown.
