# Feuillets — features by use

> [Français](FONCTIONNALITES.md) · **English** · [Documentation index](README.md)

This is the user-facing functional reference.

![Overview](feuillets-ecriture-apercu.png)

## Projects

- Fiction, Non-fiction and Free project types.
- Demo project.
- Multiple registered projects.
- Use any existing vault folder as-is.
- Initialize an existing folder as a Feuillets project.
- Project display names and metadata.
- Legacy French and English folder names remain recognized.

## Binder

- Hierarchical navigation.
- Two-pane folder/file layout, folder-only and file-only modes.
- Adjustable density.
- Create and rename folders and sheets.
- Drag and drop, including moving items back to manuscript root.
- Multi-selection.
- Persistent custom order.
- Title-only or title-and-content search.
- Status, label and progress filters.
- Optional label stripes, tags, status, progress and word counts.
- Configurable preview text.
- Outline import.
- Contextual compilation of a file, folder or selection.
- Open a scope directly in Preview.

## Writing

- Native Obsidian Markdown editor.
- Literary manuscript presentation.
- Configurable font, size, line height and width.
- Paragraph indents and spacing.
- Discreet Markdown syntax.
- Optional French typography helpers.
- Manuscript search and replace.
- Scene separators.
- Footnotes and citations.
- Next/previous sheet navigation.

## Focus Mode

- Hide surrounding UI.
- Dedicated writing width.
- Typewriter scrolling.
- Line or paragraph dimming.
- Floating word counter.

![Focus Mode](feuillets-concentration.png)

## Notes, properties and local Context

The Notes Inspector tab can contain:

- synopsis;
- summary;
- working notes;
- sources;
- footnotes;
- YAML properties;
- folder notes;
- sheet outline;
- referenced entities;
- local Context.

Context can use the cursor window, pinned files, explicit references, linked Research folders, chapter context, project Research, lexical content matching, dated entity states and chronological alerts. No remote service is involved.

## Research

- Project-type-specific categories.
- Fiction: Characters, Places, Events, Lore, Glossary, Bibliography.
- Non-fiction: Sources, Bibliography, Notes.
- Free: no imposed business categories.
- Custom categories.
- Text search and tag filters.
- Saved Research folders/filters.
- Create, rename, duplicate and trash Research files.
- Open in tab or split.
- Associate Research folders with Binder folders or individual sheets.
- Associations may point elsewhere in the vault.
- Insert links, excerpts and sourced excerpts.
- Insert images and PDF links.
- Find appearances in the manuscript.
- Citation-based bibliography.
- Legacy FR/EN folder variants recognized without forced renaming.

## Footnotes and citations

- Insert and navigate footnotes.
- Check missing, unused, duplicate, empty and malformed notes.
- Renumber numeric IDs.
- Preserve named IDs.
- Avoid cross-sheet collisions during compilation.
- Insert citations from Source files.
- Generate bibliography.

## Cards, Outline, Storyline and Timeline

![Narrative views](feuillets-mosaique-narrative.png)

**Cards** provide visual scene organization and configurable card content.

**Outline** provides hierarchical tabular project information with configurable columns.

**Storyline** follows narrative threads across the manuscript.

**Timeline** supports scene dates, Research events, narrative/chronological order, scales, filters and parallel events.

## Notebook

- Native Canvas project notebook.
- Text and file nodes.
- Idea capture.
- Groups and connections.
- Deliberate conversion of ideas into manuscript sheets or Research files.
- Chapter creation from selected/grouped ideas.
- Outline import from idea-tree structures.
- Optional Advanced Canvas integration.

## Analysis

Built-in and separate from grammar checking:

- word counts and prose metrics;
- dialogue ratio;
- repetitions;
- chapter-length balance;
- outlier detection;
- surface lexical richness;
- writer-supplied pace dimensions;
- project dashboard;
- optional linguistic metrics exposed by a companion provider.

## Proofreading

- Public text-analysis provider API.
- Analyze document or selection.
- Issues with message, category, severity and suggestions.
- Jump to the exact range.
- Correction context menu.
- Optional ignore-occurrence and learn-word operations supplied by the companion.
- No grammar engine bundled by Feuillets.

## Journal and statistics

- Daily writing journal.
- Goals.
- Calendar/activity tracking.
- Compiled journal.
- Word and text statistics.
- Recent history.

## Scene/section operations

- Split.
- Duplicate.
- Move.
- Multi-file merge.
- Ordered merge.
- Merge separators/modes.
- Explicit YAML preservation and aggregation rules.
- Multi-selection.

## Preview

- File, folder, selection and project scopes.
- Chapter/part continuous reading.
- Pagination.
- Fit-width, fit-page and manual zoom.
- Source/Preview scroll synchronization where applicable.
- Open currently visible sheet.
- Breadcrumb navigation.
- Integrated Export panel.
- Front-page editing.
- Shared styling engine with native exports.

![Preview](feuillets-apercu.png)

## Compilation and export

- File scope.
- Folder-plus-descendants scope.
- Mixed selection scope.
- Full project scope.
- Duplicate removal.
- Binder order.
- Technical-folder exclusion.
- Per-sheet compile exclusion.
- Titles and separators.
- Front pages.
- Built-in and custom templates.
- Optional French typography transforms.

Native formats:

- **DOCX**;
- **EPUB**;
- **ODT**;
- **PDF** on desktop through the system print dialog;
- **compiled Markdown**.

Outputs are written under `_Sortie`.

## DOCX review

The Edition tab can import reviewed DOCX content, map supported revisions back to source sheets, classify uncertain changes, require author decisions and protect the Markdown source before applying edits.

## Editorial documents

Optional `_Edition` can be initialized with Synopsis, Intent note, Biography, Cover letter, Submissions and Sent versions. They remain ordinary editable files/folders.

## Backups, snapshots and versions

- Automatic ZIP backups.
- Manual backup.
- Backup rotation.
- Safe backup scope for as-is folder projects.
- Sheet snapshots.
- Snapshot comparison.
- Manuscript copies under `_Versions`.
- Binder order copied with a version.

## Import

- Structured Markdown outline.
- Scrivener project/archive.
- Compatible RTF text conversion.
- Binder structure.
- Compatible status/comments/data.
- Attached images/PDFs when available.
- Import report.

## Interface

- French and English.
- Automatic or explicit locale.
- Tabbed Inspector.
- Hideable Inspector tabs.
- Binder independent from Inspector.
- UI simplification/transparency options.
- Accent color and writing typography.
- Panel gestures.
- Settings export/import.

## Ecosystem

- Feuillets-Grammalecte.
- Courrier.
- Optional Advanced Canvas.

## Data principles

- Markdown source of truth.
- Optional YAML.
- Legacy names recognized.
- No destructive automatic renaming.
- No telemetry.
- No manuscript upload.
