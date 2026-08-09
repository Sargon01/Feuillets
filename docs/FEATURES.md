# Feuillets — features by use

> [Français](FONCTIONNALITES.md) · **English** · [Documentation index](README.md)

This document is the user-facing functional reference. Internal setting names and implementation details belong in the technical documentation and source code.

![Overview](feuillets-ecriture-apercu.png)

## Projects

- Create **Fiction**, **Non-fiction**, and **Free** projects.
- Open the demo project.
- Register and switch between several projects.
- Use an existing vault folder **as-is**, without moving or renaming its contents.
- Initialize an existing folder as a Feuillets project when you want project conventions and specialized folders.
- Import a structured outline.
- Import a Scrivener project on desktop.
- Keep project metadata and conventions optional for writing.
- Reuse historical French and English folder names without destructive renaming.

## Writing

- Native Obsidian Markdown editor.
- Writing View applied to manuscript files.
- Configurable text width, font, size, line height, and typography.
- Visually discreet Markdown syntax.
- Automatic paragraph indents.
- Normal, compact, or visually continuous paragraph presentation.
- Typographic apostrophes, French quotation marks, non-breaking spaces, and dashes while typing.
- Typographic cleanup command for a selection or the active sheet.
- Focus Mode.
- Typewriter scrolling.
- Dimming by line or paragraph.
- Floating word counter.
- Manuscript-wide find and replace.
- Scene-break insertion.
- Cleanup of blank lines and imported separators.

![Focus Mode](feuillets-concentration.png)

## Notebook and brainstorming

- Visual Notebook based on a standard Obsidian Canvas.
- Automatic creation of the project Notebook on first use.
- Quick idea capture from the command palette without leaving the current sheet.
- Add the current sheet to the Notebook.
- Add several selected sheets in actual Binder order.
- Detect sheets already present to avoid duplicates.
- Turn a text idea into a real Markdown sheet.
- Turn a text idea into a Research note.
- Turn several selected ideas into sheets.
- Create a chapter from a selection of Notebook items.
- Create a chapter from a Canvas group.
- Create a chapter from an Idea Tree branch.
- Split one idea into two cards.
- Merge several text ideas in a chosen order.
- Build Idea Trees with structural branches.
- Add a child or sibling quickly from an Idea Tree.
- Reorganize one Idea Tree without moving unrelated Canvas cards.
- Distinguish free Canvas arrows from structural links created by Feuillets.
- Turn an Idea Tree branch into a Feuillets outline.
- Convert a card with children into a folder and a terminal card into a sheet.
- Re-import a Notebook outline additively and idempotently.
- Reuse existing folders and sheets when their displayed title matches exactly.
- Preserve existing manuscript order when re-importing an outline.
- Detect ambiguity and duplicates before changing files.
- No forced automatic synchronization between Notebook and Binder.
- Advanced Canvas is recommended for direct card menus, multi-selection actions and Idea Trees, but core Notebook actions remain available from the command palette.

See **[The Notebook — from ideas to manuscript](HOW-TO-NOTEBOOK.md)** for the detailed workflow.

## Footnotes and citations

- Insert a footnote.
- Navigate between call and definition.
- Detect orphaned calls or missing definitions.
- Renumber numeric identifiers.
- Preserve named identifiers.
- Resolve identifier collisions when several sheets are composed.
- Insert a citation from a Source note.
- Export notes according to the capabilities of each output format.

## Notes and Context

The **Notes** tab of the unified Inspector keeps working material beside the manuscript without putting it into compiled text.

It can contain:

- synopsis;
- summary;
- working notes;
- sources;
- internal outline of the active sheet;
- notes for its chapter or part;
- properties;
- footnote helpers;
- **Context** for the passage around the cursor.

Context can surface explicit references, linked Research, related documents, pinned references, entity states and chronological alerts. It remains local and deterministic; Feuillets does not use an online AI service for this feature.

See **[Using Feuillets Context](HOW-TO-CONTEXT.md)**.

## Organize the manuscript

- Hierarchical Binder.
- Parts, chapters, scenes, sections and sheets.
- Several Binder presentations.
- Context-aware creation at the appropriate level.
- Drag and drop, including moving folders or files back to manuscript root.
- Rename folders and sheets.
- Undo the last move.
- Renumbering.
- Search by title or content.
- Filters by status, label and progress.
- Optional excerpts, synopsis, summary, notes or keywords in the Binder.
- Multiple projects.
- Persistent custom order.
- Contextual compilation of a file, a folder, or a selection.
- Structured outline import.
- Scrivener import on desktop.

## Cards, Outline, Storyline, Timeline and reading

![Cards, Outline, Storyline and Timeline](feuillets-mosaique-narrative.png)

### Cards

- One card per scene or sheet.
- Configurable card size and column count.
- Optional synopsis, excerpt or project information.
- Labels and progress.
- Visual reordering.
- Work at chapter or full-manuscript scope.

### Outline

- Hierarchical table.
- Configurable columns.
- Adjustable widths.
- Possible information includes synopsis, summary, notes, keywords, label, status, date, composition state, word count, target and progress.

### Storyline

- Native Canvas-based overview.
- Colored cards.
- Group or read by narrative thread.
- Overview suited to a large number of scenes.

### Timeline

- Dated scenes and milestones.
- Chronological order versus narrative order.
- Several time scales.
- Filters.
- Parallel events.

### Reading and Preview

- Continuous reading of the manuscript or a selection.
- Preview at scene, chapter, part, folder or manuscript scope.
- Synchronization with the active sheet.
- Navigation trail.
- Zoom.
- Direct access to Export.
- Rendering based on the same composition logic used by exports.

## Research and documentation

- Project bible.
- Characters, places, events, concepts, lore, sources, bibliography and glossary.
- Categories adapted to project type.
- Search and filtering.
- Insert a link or excerpt into the active sheet.
- Automatic context for cited elements.
- Read dated states stored in Research notes.
- Chapter and part notes.
- Internal outline of the active sheet.

Feuillets recognizes current and historical French and English Research folder names, including `_Recherche`, `_Research`, `Recherche` and `Research`. Unprefixed names are recognized only in the expected structured-project context, avoiding destructive renaming.

For chronological events, historical names such as `Événements`, `Events`, `Chronologie`, `Timeline`, `Chronology` and `_Chronologie` can also be reused when present.

## Properties and Inspector

- Edit properties of the active sheet.
- Text, dates, checkboxes and list fields.
- Browse properties used in the project.
- Add an existing property.
- Bulk deletion with confirmation.
- Browse project keywords.
- Optionally hide Obsidian's native Properties presentation in the editor.

Properties remain optional for writing.

The unified **Inspector** contains six tabs:

- **Notes**;
- **Research**;
- **Journal**;
- **Edition**;
- **Analysis**;
- **Proofreading**.

**Context** and sheet properties are available from **Notes**. Inspector tabs can be hidden; Feuillets always keeps at least one visible tab.

## Scenes and sheets

- Create.
- Move.
- Rename.
- Duplicate.
- Split.
- Merge several.
- Multi-select.
- Configurable rules for attached information during split or merge.
- Permanently exclude from composition without removing from the Binder.
- Custom statuses.
- One or several colored labels; when a view needs one color, the first label is the primary one.
- Word-count target.

## Tracking

- Word counts.
- Character, sentence and paragraph counts.
- Reading-time estimate.
- Sheet and project goals.
- Progress indicators.
- Recent activity.
- Writing calendar.
- Daily writing journal.
- Session notes, difficulties, decisions and review notes.

## Analysis, proofreading and editorial revision

- Local prose analysis in the Feuillets core.
- Project-level dashboards and structural indicators.
- Proofreading supplied through the public text-analysis provider API when a companion is installed.
- Feuillets-Grammalecte can provide spelling and grammar feedback without putting a grammar engine inside the core plugin.
- Annotated DOCX revision in **Inspector → Edition → DOCX Revision**.
- Accept, reject, inspect or defer tracked changes.
- Comments and tracked moves.
- Confidence levels for uncertain matches.
- Safe fallback when a Word revision cannot be mapped confidently.
- Generate a revised DOCX while preserving still-pending editorial feedback.

See **[Reviewing a Word manuscript with Feuillets](HOW-TO-DOCX-REVISION.md)**.

## Backups and versions

- Snapshots before risky rewriting.
- Compare versions.
- Duplicate a manuscript or project state for longer narrative branches.
- ZIP backups.
- Restore previous work.

For a project that uses an existing folder as-is, backups stay scoped to that folder. For a structured project whose active manuscript folder is named `Manuscrit`, the backup covers the parent project folder. `_Backups` follows the same scope and is never included in its own archive.

![Version comparison](feuillets-comparaison.png)

## Composition

- Compose the entire project.
- Compose one sheet.
- Compose one folder and all its descendants.
- Compose a manual selection of files and folders.
- Preserve manuscript order.
- Avoid duplicate inclusion when a selected folder already contains another selected item.
- Include or exclude sheets.
- Control titles and separators.
- Front matter.
- Styles and page settings.
- Preview the same composed structure before export.

## Export

The native export engine supports:

- compiled Markdown;
- DOCX;
- EPUB;
- ODT;
- PDF through the system print workflow on desktop.

Principles:

- no mandatory online service;
- composition remains local;
- source Markdown is not modified by export;
- differences between output formats are explicit;
- named Word styles are used in DOCX;
- EPUB remains adaptable to the reader;
- footnote behavior follows format capabilities.

![Paginated Preview](feuillets-apercu.png)

## Interface

- French or English UI.
- Automatic language or forced language.
- Settings for a clean writing interface.
- Hide native title, properties, ribbon, vault switcher and other Obsidian chrome where desired.
- Transparent panels and bars.
- Reduced visual weight for secondary icons.
- Font, size, text width, line height and accent settings.
- Touch or trackpad gestures for side panels.
- Inspector tabs and views can be enabled or hidden.
- Settings export and import.

## Editorial life with Courrier

The companion **Courrier** plugin can extend Feuillets beyond the manuscript:

- address book;
- publishers, agents, journals and competitions;
- letter templates;
- submission history;
- sent versions and attachments;
- replies;
- follow-ups.

Feuillets remains the writing studio; Courrier handles the correspondence workflow.
