# An author's workflow, from first word to export

> [Français](PARCOURS-AUTEUR.md) · **English** · [Documentation index](README.md)

This guide follows a project in its natural order. Every step remains optional: Feuillets provides an environment around the same Markdown files, not a required method.

## Think

Before writing, an author can keep ideas at project or folder level with the **Notebook**. The Canvas remains free-form; it can host a **Binder Plan**, files, links or **mindmaps**. An idea can later become a sheet or Research note when useful.

A project Notebook suits the overview; a Notebook attached to a folder focuses on one part of the manuscript. A linked Research folder can share the same logical Notebook. See [Notebook — from ideas to manuscript](HOW-TO-NOTEBOOK.md).

## Organize

The **Binder** gives the manuscript a working structure: create, rename, move, search, filter and select sheets. A folder can be isolated for local work, then the author can return to its parent or the whole project; files are neither moved nor copied.

The **Board** reads the same structure through several modes: **Cards**, **Outline**, **Story arcs** and **Timeline**. Story arcs can follow narrative threads, characters or POV, arcs, statuses and labels according to supported properties. One thread can connect several sheets to follow an object, promise, conflict or motif without creating a separate documentation system. Its first and last occurrence can naturally serve as an opening or setup and its resolution or payoff, while intermediate occurrences show development; Feuillets does not automatically assign those roles.

In **Project**, goals, statuses, labels, favorite tags and YAML property mapping can be adapted to the existing vault. Split view adds navigation on the left without replacing the working Binder.

## Document

**Research** accepts free-form Markdown notes: a character, place, event, object, institution, concept, source or any other useful documentation. Structured properties remain optional. An existing folder can be linked from the Binder without being moved.

**Context** examines the passage around the cursor and brings relevant Research notes closer using local, lexical and deterministic clues: titles, aliases, tags, documentary content and recognized chronological information. It is not limited to characters. A Character note can contain dated events; in a dated passage that mentions the character, its chronology can help check a presence, death or event that has already happened.

Workspaces keep this documentation at the relevant scale of a project part without creating a sub-project. See [One project, multiple workspaces](WORKSPACES.md).

**Citations** connect Research sources to the manuscript. Depending on configuration, Pandoc/Zotero Preview can display citekeys or an author-date form, and the bibliography can include the relevant sources. During compilation, Feuillets can limit the bibliography to sources actually cited within the compiled scope.

## Write

Write in the native Markdown editor: the files remain real Markdown files. Text width, typography, line spacing, indents, Focus Mode, find/replace, footnotes and citations adapt the working surface without taking away the flexibility of the format.

**Reorder text** lets you drag and drop a paragraph, or a selection contained within one paragraph. The insertion point is visible, **Escape** leaves this local mode and each move remains one Undo step that preserves exact Markdown.

When splitting the manuscript into files becomes awkward for writing, open a file, folder or selection in **Continuous**. Sheets remain separate, boundaries are protected and edits are written back to the corresponding files: no permanent composite file is created on disk. See [Continuous mode](CONTINUOUS-MODE.md).

## Reread

**Preview** reads a scope — sheet, folder, selection or project — as a composed, paginated document. It lets you check headings, images, tables, typography, templates and footnotes placed in the composition. The editor is for working on text, Continuous for working across several sheets as one text, and Preview for reading the result; none replaces the source files.

The **Notebook**, **Sheet** panel and **Research** panel remain available around the text when the author needs to return to notes, properties, annotations or sources.

## Revise

Revision can follow several levels:

1. annotate a passage or keep a working note;
2. take a **snapshot** before a major rewrite;
3. use **Compare a version** to distinguish additions, deletions, replacements and moves;
4. receive feedback through **Collaborative Review**;
5. handle a Word document with **DOCX Review**, comments and tracked changes;
6. decide, then restore one passage or apply changes.

Working annotations remain outside Markdown. These tools have distinct formats and purposes, even though they take part in the same revision work. See [Rewriting, backups and versions](REWRITING-BACKUPS-AND-VERSIONS.md).

**Compare a version** has **Changes** and **Versions** modes: additions, deletions, replacements and moves are distinguished, linked scrolling is optional and one passage can be restored without restoring the whole file.

**Proofreading** also includes **Text analysis**. **Collaborative Review** compares the sent text, the reviewer’s return and the current manuscript before a decision; **DOCX Review** handles Word comments and tracked changes while Markdown remains the source.

## Format

In **Edition**, **Composition** chooses content, First page, front matter, generated elements, bibliography, appendices and structure. **Layout** controls Page, Body text, Headings and Blockquote. Optional semantic roles can produce variants, extractions and collections without duplicating the manuscript.

Edition works beside the real Preview and shares its templates with exports. **16:9 Presentation** can also reuse the same Markdown when that format is relevant.

## Publish

Export produces the supported formats — compiled Markdown, DOCX, EPUB, ODT and desktop PDF — from the selected scope. Preview helps check the document but is not required for export.

A project can start from an existing folder, a new Fiction, Non-fiction or Free project, or a Scrivener import. It remains a set of ordinary Markdown files and folders; ZIP backups, snapshots, comparison and versions complement one another without replacing a complete vault backup.

A project can also be exported or imported as a portable `.feuil` archive without converting the manuscript away from Markdown.
