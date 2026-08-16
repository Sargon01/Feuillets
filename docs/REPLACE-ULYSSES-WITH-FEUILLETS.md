# Replace Ulysses with Feuillets

> [Français](Remplacer-Ulysses-par-Feuillets.md) · **English** · [Documentation index](README.md)

You use Ulysses for clean writing, groups and sheets, goals and polished export. Feuillets covers a similar workflow inside Obsidian while keeping a different foundation: **your writing remains ordinary Markdown files in your vault**.

![Writing and Preview](feuillets-concentration-apercu.png)

Ulysses offers a unified library and a highly consistent Apple experience. Feuillets favors open files, explicit book structure, project documentation and integration with the rest of Obsidian.

---

## 1. Find the library again

The Obsidian vault is the general library. A Feuillets project can use an existing folder as-is or a structure created by Feuillets.

| Ulysses | Feuillets |
|---|---|
| Library | Obsidian vault |
| Project | Feuillets project |
| Group | Folder |
| Sheet | Sheet |
| Material Sheet | Research note or excluded sheet |
| Filter | Filter, selection or view |
| Trash | Obsidian trash |

A project can start as ordinary Markdown notes and become a Feuillets project later without a proprietary conversion step.

---

## 2. Find Projects again

The **Project** tab holds settings that truly belong to the project: goals, statuses, labels, favorite tags and YAML property mapping.

### YAML remapping

If your vault already uses properties such as `State`, `Summary` or `POV`, map them to the corresponding Feuillets logical fields. Mapping does not rename existing properties or launch a destructive migration.

---

## 3. Find groups again

Groups become real **folders**. The same hierarchy feeds Binder, Cards, Outline, Continuous, Storyline, Timeline, Preview and final composition.

Feuillets preserves explicit manuscript order. Natural sorting is only a fallback when no explicit order exists (`Chapter 2` before `Chapter 10`).

---

## 4. Find Sheets again

The **sheet** is the movable writing unit. It can represent a scene, article, section, fragment, preface or standalone text. You can create, move, rename, duplicate, split, merge or exclude it from composition.

The displayed title can remain different from the filename.

---

## 5. Find clean writing again

Feuillets uses Obsidian's native Markdown editor with manuscript-oriented presentation: controlled width, discreet syntax, typographic paragraphs and writing helpers.

**Focus Mode** can further reduce the environment with a dedicated width, typewriter scrolling, dimming and a discreet counter.

The source remains standard Markdown usable without Feuillets.

---

## 6. Find one-, two- and three-pane work again

Feuillets uses Obsidian's pane system rather than forcing one layout.

Binder can be used in single view or **split view**:

- manuscript folder structure on the left;
- a lightweight read-only Vault browser below it;
- the normal Binder on the right.

You can also hide sidebars or use Focus Mode when only the editor should remain visible.

---

## 7. Find keywords again

Use tags, labels, statuses, narrative threads, characters, dates and custom properties according to purpose. They can feed filters, Cards, Outline, Storyline, Timeline and Context.

---

## 8. Find filters again

Ulysses-style filtering needs are covered through Binder search, status/label/progress filters, tags, multi-selection, Outline, Storyline, Timeline and Obsidian search.

Feuillets does not create a proprietary Filter object; the same files and metadata are projected differently depending on the question.

---

## 9. Find Material Sheets again

Use **Research** or a linked vault folder for material that should not belong to the manuscript.

Any existing vault folder can be linked to a manuscript sheet or folder without being moved. When it is outside project Research, it appears read-only in the Research panel; its files can still be opened in a new tab or side by side.

For manuscript text that should not be exported, use composition exclusion.

---

## 10. Find the Dashboard again

Dashboard-style information is separated by purpose in the right panel.

### Sheet

Synopsis, summary, working notes, properties, footnotes and passage Context.

### Journal

Activity, goals, writing calendar and session notes.

### Research

Characters, places, events, concepts, sources, bibliography, glossary and linked folders.

### Project

Project-specific settings, statuses/labels, goals and YAML mapping.

---

## 11. Find notes and attachments again

Feuillets combines working notes, Research, Markdown links/embeds, vault files, project Resources, Canvas/Notebook and folder notes. Attachments remain identifiable files instead of objects hidden inside a proprietary library.

---

## 12. Find side-by-side consultation again

Research files can open in a new tab or side by side, including files inside linked external Research folders.

Binder split view also lets you browse the Vault read-only and open an outside document without leaving the Feuillets workspace. This never turns the outside file into a manuscript sheet.

---

## 13. Find context linked to the text again

**Sheet → Context** can surface information useful to the current passage: cited titles/aliases, linked Research, documents sharing several significant terms, pinned references and chronological continuity information.

Matching is local and deterministic; it does not depend on an online AI service.

---

## 14. Find writing goals again

Feuillets can track sheet target, project target, progress, recent activity, writing calendar and journal. Project goals can now be project-specific.

---

## 15. Find book organization again

Several views project the **same manuscript**:

- **Binder**: hierarchy and navigation;
- **Cards**: visual thinking;
- **Outline**: structure and metadata in columns;
- **Storyline**: narrative threads;
- **Timeline**: temporal order;
- **Continuous**: edit multiple sheets as one text;
- **Preview**: paginated result before export.

None creates a second manuscript copy.

---

## 16. Find continuous writing again

**Continuous** mode presents several sheets inside one editable editor. Work on a chapter, folder, selection or full manuscript as a long document while each edit is saved back to the corresponding source Markdown file. Boundaries between sheets are protected.

This is useful when you want the flow of one long Ulysses sheet while still keeping smaller manuscript units.

---

## 17. Find versions and annotations again

Feuillets separates snapshots, versions, text comparison, working annotations and ZIP backups.

**Working annotations** attach notes to passages without adding markers to Markdown and are not exported.

The comparison view distinguishes additions, deletions, replacements and moved passages, with Changes/Versions modes and optional linked scrolling.

---

## 18. Find feedback from another person again

Two workflows exist depending on the source:

- **Collaborative review**: local `.feuillets` package exchange, comments and comparison against both the sent baseline and current manuscript;
- **DOCX Revision**: compatible Word feedback under Proofreading.

Personal working annotations remain separate from both.

---

## 19. Find export again

The central **Edition** workspace separates:

### Composition

What belongs in the document: manuscript content, first page, front matter, generated elements, bibliography, appendices and structure rules.

### Layout

How the document looks: page, body text, headings, blockquotes/separators, margins, columns, headers and footers.

Edition's top bar always provides scope, format and **Export**. Export is not a third tab.

Native formats include compiled Markdown, DOCX, EPUB, ODT and PDF through the desktop system print flow.

---

## 20. Find Ulysses styles again

Feuillets can import a Ulysses `.ulstyle` or `.ulss` **style** from the layout-template options in Edition.

The import creates a Feuillets layout template from representable Ulysses style properties. It does not convert the manuscript into a Ulysses format or rewrite source Markdown.

The goal is to carry over typographic intent, not reproduce every detail of the Ulysses rendering engine.

---

## 21. Find output formats again

Feuillets can generate compiled Markdown, DOCX, EPUB, ODT and desktop PDF. Preview uses the same composition chain so the result can be checked before export.

---

## 22. What Feuillets does not try to reproduce

Ulysses remains the better fit when your highest priority is a fully uniform Apple application, the exact Ulysses/iCloud workflow, built-in direct publishing to supported web platforms, or a single proprietary library with almost no visible file management.

Feuillets instead prioritizes direct file access and integration with the existing Obsidian vault.

---

# Equivalent daily workflow

## In Ulysses

```text
Choose project/group
→ write in a sheet
→ add keywords and target
→ inspect Dashboard
→ choose sheets
→ choose export style
→ export
```

## In Feuillets

```text
Choose project/folder
→ write in a sheet or Continuous
→ use Sheet and Context
→ link Research when useful
→ track goals and Journal
→ inspect Cards/Outline when useful
→ check Preview
→ compose and export in Edition
```

---

# What you gain

- open Markdown files;
- projects that adapt to existing folders;
- property remapping;
- explicit book structure without a proprietary project format;
- editable Continuous mode;
- Research and Context;
- Notebook/Canvas;
- working annotations and collaborative review;
- version comparison;
- composition and layout tied to Preview.

# Verdict

Ulysses remains a reference for a highly consistent and minimal Apple writing experience. Feuillets chooses a different balance: **the flow of a dedicated writing tool while preserving the freedom of the Obsidian vault**.

If you value sheets, separation between drafting and final formatting, and a quiet editor, but want open files and deeper tools for long books, Feuillets can cover most of that workflow without locking the project into another library.
