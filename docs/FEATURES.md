# Feuillets — features by use

> [Français](FONCTIONNALITES.md) · **English** · [Documentation index](README.md)

## Manuscript and structure

### Projects and existing-vault compatibility

- Fiction, Non-fiction and Free initialization presets; they provide starting values without blocking runtime capabilities;
- use or initialize an existing folder;
- `_Feuillets` auxiliary space with non-destructive legacy compatibility;
- project-scoped goals, statuses, labels and favorite tags;
- YAML mapping for synopsis, summary, status, POV, label, goal, narrative thread, characters and date;
- several projects in one vault;
- export/import of a **portable `.feuil` project**, restoring supported project order and settings without changing the manuscript’s Markdown working format.

See [Portable `.feuil` project](PORTABLE-FEUIL-PROJECT.md).

### Binder

- create/rename/move;
- drag back to root;
- multi-select;
- title/content search;
- status/label/progress filters;
- configurable sheet preview;
- isolate a folder and navigate back upward/project-wide;
- open in Preview or Continuous;
- link an existing Research folder;
- single or **split view**: **Manuscript**, **Research**, **Workspaces** and **Vault** navigation on the left; the right pane remains the working Binder and reflects the active workspace.

### Continuous

- one continuous editor for several sheets;
- source Markdown files remain separate;
- protected boundaries;
- edits redistributed per file;
- file/folder/selection/project scope;
- Preview synchronization;
- no composite file on disk.
- properly rendered H1–H6 Markdown headings;
- context menu: Cut, Copy, Paste, footnotes, **Annotation…**, **Capture an idea** and **Reorder text**;
- reordering paragraphs or fragments contained within one paragraph, without crossing a sheet boundary;
- native Undo/Redo for the Continuous document.

### Reorder text

- available in the native Markdown editor and in Continuous;
- local editor mode: hover a paragraph, then drag and drop it;
- a selection contained within one paragraph can move as a fragment;
- visible insertion point, **Escape** to leave, one operation = one Undo step;
- exact Markdown preserved.

In the native Markdown editor, the context menu can offer **Footnote >**, **Annotation…**, **Capture an idea**, **Reorder text**, followed by **Feuillets: Split**, **Feuillets: Duplicate** and **Feuillets: Move…**, depending on context.

### Notebook

- project Notebook and **Notebooks attached to folders**;
- real Obsidian Canvas, without a proprietary visual format;
- folder Notebook identity preserved across rename/move operations;
- a linked Research folder can share the same logical Notebook as its Binder folder;
- drag and drop from Binder or Research → real file card, without changing source Markdown;
- capture ideas and convert idea → sheet or Research;
- interactive **Binder Plan**: Refresh from Binder, prepare structure, then explicitly Apply to Binder;
- create/reorder sheets and folders from the Plan with validation before writes;
- **mindmaps** with children/siblings, reparenting, collapse, horizontal/vertical orientation and reorganize;
- explicit conversion of an older Idea Tree branch into a mindmap;
- core behavior independent from Advanced Canvas.

See [Notebook — from ideas to manuscript](HOW-TO-NOTEBOOK.md).

### Cards, Outline, Story arcs and Timeline

- simplified Cards/Outline roles;
- hierarchical Outline with configurable columns and optional wrapping for long text;
- natural sorting only as fallback when no explicit order exists;
- Story arcs for narrative threads; the first and last occurrence of one thread can naturally serve as its opening or setup and resolution or payoff, while intermediate occurrences show its development. Feuillets does not automatically assign those roles or require separate narrative objects;
- when a thread appears for the first time, a pending resolution marker may be maintained toward the end of the project, then removed when a new real occurrence of the same thread appears; no named narrative role is assigned automatically;
- narrative/chronological Timeline.

The Binder remains the working structure; the Board offers several readings of the same files. Threads can follow an object, promise, conflict or motif across several sheets without imposing one interpretation of the lanes.

## Workspaces and scopes

- folder isolation as a working scope without moving or copying files;
- sheet, folder, selection or project scope depending on the action;
- supported local settings inherited from the parent, project or global settings;
- Research, Board, goals, workflow and typography can follow the working context;
- Project and Workspace remain distinct layers.

See [One project, multiple workspaces](WORKSPACES.md).

## Research and Context

### Sheet, notes and annotations

- project-type-aware synopsis/summary;
- working notes in Sheet panel;
- properties and footnotes;
- local Context;
- working annotations outside Markdown, highlighted, editable and removable through **Annotation…**.

### Research

- project-type categories;
- rationalized Sources/Bibliography;
- historical roots recognized;
- any existing vault folder can be linked to a Binder node;
- external linked folders visible in Research;
- linked files can open in a new tab or side by side;
- no automatic move/copy/rename from the Research entry point;
- free-form Markdown Research notes, with no required Character, Place or Event form;
- optional structured properties when useful.

### Context

- passage around the cursor brought closer to relevant Research;
- local, lexical and deterministic clues: titles, aliases, tags, documentary content and recognized chronological information;
- Character, Place, Object, Institution, Source or any other relevant documentation;
- a note’s chronology can help contextualize its state at a relevant date, without claiming general semantic understanding.

## Writing

- native Markdown editor kept as the working source;
- text width, typography, line spacing, indents, Focus Mode and writing aids;
- Continuous lets the author work across several sheets as one text while keeping the source files separate;
- real Markdown files remain the source despite visual settings.

## Revision and collaboration

### Proofreading

Proofreading groups Text analysis, Collaborative review, DOCX Review and Compare a version.

### Comparison

- additions, deletions, replacements;
- move/cut-paste detection;
- `[…]` placeholders where one side has no visible text;
- passage restore;
- double-click recentering;
- previous/next navigation;
- Changes / Versions modes;
- optional linked scrolling.

### Collaborative review

- sheet/folder/project scope;
- portable `.feuillets` package;
- reviewer local working copy;
- anchored review notes;
- return to author;
- three-way analysis against current manuscript;
- apply/ignore/manual handling;
- note threads and further rounds;
- local archive.

## Edition and publication

### Edition and composition

- tab in the Feuillets panel;
- Composition and Layout modes;
- one First page entry in Composition;
- front matter;
- contents/table of contents/tables;
- bibliography and appendices;
- manuscript structure;
- V2 templates shared with Preview/export;
- create/duplicate/rename custom templates;
- Ulysses and Word template import.

### Semantic roles and derived publishing

- 18 optional canonical roles; ordinary text does not require annotation;
- variants: same document with selected roles excluded;
- extractions: whole structural sections containing trigger roles;
- collections: selected role blocks with heading context;
- variants can combine with an extraction or collection;
- project-scoped configuration under **Composition → Manuscript**;
- no duplication of the source manuscript.

### Presentation

- 16:9 rendering of the same Markdown;
- `---` as slide separator;
- automatic FLOW / SPLIT / STACK composition;
- layout can account for text, images, callout groups and long quotations;
- non-projected `[!speaker-notes]`;
- compatible video including MP4;
- `classic`, `course`, `ivory`, `slate`, `dark` themes;
- optional Auto / flow / columns / image-left / image-right override stored outside Markdown.

### Layout

- Page: format, orientation, margins, mirror, columns, gutter, header/footer;
- Body: font, size, spacing, indent, hyphenation, profile;
- Headings: styles and page breaks;
- Blockquote: margins, color, italic, scene separator.

### Preview

- genuinely paginated document for a sheet, folder, selection or project;
- footnotes placed at the bottom of the page containing their first call, with space reserved during pagination;
- repeated calls without duplicate definitions and full-width footnotes below multi-column composition;
- known limitation: a single footnote taller than one usable page is not yet split;
- optional per-project Pandoc/Zotero preview using a `.bib` file from the vault;
- **Raw citekeys** or **Author-date** display, including locators and simple citation groups;
- source Markdown and native exports unchanged; unresolved citekeys remain raw;
- no full CSL engine: final bibliography styling can remain in an external Pandoc workflow.

Citations connect Research sources to the manuscript. During compilation, Feuillets can limit the bibliography to sources actually cited within the compiled scope.

### Export

- compiled Markdown, DOCX, EPUB, ODT;
- desktop PDF through system printing;
- compact **Scope → Content → Format → Export** Edition toolbar;
- Content menu: full document, extraction or collection;
- automatically resolved output name with legacy compatibility;
- safe replacement across macOS case-only filename differences.

## Import / export

### Scrivener import

- Binder/Draft structure;
- RTF → Markdown text;
- compatible metadata;
- Research/resources;
- **persisted Scrivener Binder order**, independent of vault alphabetical sorting.

## Local, privacy and open formats

### Security and privacy

- no telemetry;
- no required remote service;
- imports are explicit user actions;
- collaborative review is explicit local file exchange;
- Obsidian APIs for vault writes;
- no Pandoc/external conversion executable.
