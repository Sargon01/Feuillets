# Replace Scrivener with Feuillets

> [Français](Remplacer-Scrivener-par-Feuillets.md) · **English** · [Documentation index](README.md)

You use Scrivener for its Binder, index cards, synopsis, metadata, snapshots, Scrivenings mode and Compile system. Feuillets covers most of that workflow inside Obsidian, with one structural difference: **the project remains ordinary folders and Markdown files**.

![Import a Scrivener project](feuillets-import-scrivener.png)

Feuillets is not a pixel-for-pixel Scrivener clone. It recreates the writing actions that matter — structure, move, read, document, rewrite, compare and export — while keeping the vault open and directly usable by Obsidian.

---

## 1. Find the Binder again

The Feuillets equivalent is the **Binder**.

It provides:

- parts, chapters, folders and sheets;
- drag-and-drop reordering;
- rename, duplicate, split and merge;
- move back to manuscript root;
- multi-selection;
- search and filters;
- opening a folder in **Continuous** mode;
- temporary folder isolation without changing the project.

The hierarchy maps to real vault folders and files.

### Split view

The Binder can also use a **split view**:

- on the left, a folder-only manuscript tree for reading the structure at a glance;
- below it, a lightweight read-only **Vault** browser for consulting outside material;
- on the right, the normal Binder, with the same features as in single-pane mode.

The Vault section is only for finding and opening files. An outside document never becomes a manuscript sheet and is never added to compilation or Continuous mode implicitly.

### Main equivalents

| Scrivener | Feuillets |
|---|---|
| Binder | Binder |
| Document | Sheet |
| Folder | Folder |
| Draft / Manuscript | Manuscript scope |
| Research | Research |
| Trash | Obsidian trash |

---

## 2. Find the Corkboard again

![Cards, Outline, Storyline and Timeline](feuillets-mosaique-narrative.png)

Use **Cards** to step away from prose and inspect writing units visually. Cards can show the title, synopsis, status, label and progress, and can be reordered without creating a second manuscript structure.

---

## 3. Find the Outliner again

Use **Outline** to inspect manuscript hierarchy and metadata in columns.

Available columns can include title, synopsis or summary, status, label, tags, word count, target, progress, date and other useful project properties. Long synopsis/summary columns can wrap when you need to read them in full.

> **Outline** is where you see and work with manuscript structure. **Edition → Composition → Structure** configures numbering, titles, separators and compilation rules.

---

## 4. Find synopsis, document notes and properties again

The right panel is organized by purpose.

### Sheet

The **Sheet** tab follows the active text and can contain:

- synopsis;
- summary;
- working notes;
- properties;
- footnotes;
- internal outline;
- passage **Context**.

### Project

The **Project** tab manages project-level information and settings such as statuses, labels, favorite tags, goals and YAML property mapping.

### Property remapping

Feuillets can adapt to properties already present in your vault. For example, an existing `State` property can be designated as the Feuillets status without renaming files or migrating YAML.

Mappings are non-destructive: they tell Feuillets **where to read and write**, rather than forcing the vault into a new schema.

---

## 5. Find labels, statuses and custom metadata again

Feuillets uses human-readable Markdown properties for status, labels, tags, dates, targets, point of view, narrative thread, characters and custom fields.

Those properties can feed Cards, Outline, Storyline, Timeline, filters and Context. YAML remapping lets an established vault keep its existing property names.

---

## 6. Find Collections again

Feuillets does not reproduce Scrivener Collections as a dedicated object. The practical need is covered by:

- filters;
- multi-selection;
- isolated folders;
- Continuous scopes;
- Preview scopes;
- composition/export scopes;
- narrative views.

You can therefore work temporarily on a chapter, a selection of scenes, a collection or another subset without moving the source files.

---

## 7. Find Scrivenings again: Continuous mode

Feuillets 2.5 provides a real **Continuous** editing mode.

Open a folder, chapter, part, selection or manuscript and Feuillets presents the member sheets **inside one continuous editable editor**.

Visually you work in one long document. Technically each sheet remains its own Markdown file. Boundaries are protected and edits are distributed back to the source files automatically.

There is no hidden composite manuscript file and Feuillets does not simulate the experience by opening dozens of tabs.

### Continuous, Preview and Edition

- **Continuous**: write and revise several sheets as one text.
- **Preview**: read the paginated composed result.
- **Edition**: configure composition and final layout.

---

## 8. Find Research again

Feuillets **Research** is separate from the manuscript but still consists of ordinary vault files.

It can contain characters, places, events, concepts, sources, bibliography, glossary and custom folders.

You can also **link an existing folder anywhere in the vault** to a manuscript sheet or folder. Feuillets does not move or rename it. When the linked folder is outside project Research, it appears as a read-only linked folder in the Research panel.

Its files can still be opened in a new tab or side by side without Feuillets administering that external folder.

---

## 9. Find Project and Document Bookmarks again

The equivalent workflow combines:

- Research folders linked to a sheet or chapter;
- Markdown links;
- folder notes;
- pinned references in **Sheet → Context**;
- free Vault navigation in Binder split view.

A pinned reference stays attached to the active sheet while you move between paragraphs.

---

## 10. Find Snapshots and backups again

Feuillets separates several safety layers:

- sheet snapshots;
- manuscript versions;
- comparison;
- project ZIP backups;
- normal vault backup/sync through the tool of your choice.

The goal is the same as in Scrivener: rewrite without being afraid of losing an earlier state.

![Compare versions](feuillets-comparaison.png)

---

## 11. Find version comparison again

The Feuillets comparison view distinguishes:

- additions;
- deletions;
- replacements;
- **moved passages** when text was cut and inserted elsewhere.

**Changes** mode uses a shared visual grammar with movement arrows and `[…]` placeholders where content exists on only one side. You can navigate with Previous/Next, recenter on a difference and restore a passage when the action is available.

**Versions** mode removes diff decorations for calmer side-by-side reading. Linked scrolling is optional.

---

## 12. Find comments and annotations again

Feuillets 2.5 has native **working annotations**.

Select a passage, attach a note, and the passage remains visually marked in the editor. The annotation can be read, edited and removed when resolved.

Working annotations:

- do not pollute the Markdown;
- are not meant for export;
- remain temporary authoring tools.

For feedback from another person, Feuillets also provides **collaborative review**, separate from personal annotations and DOCX Revision.

---

## 13. Find collaborative review again

Feuillets can prepare a `.feuillets` review package.

The workflow remains local:

1. the author prepares a manuscript scope;
2. the package is sent through any channel the author chooses;
3. the reviewer works on a local copy and adds comments;
4. the reviewer returns the package;
5. the author compares the return against both the sent baseline **and** the current manuscript, then applies, ignores or handles changes manually.

This lets the author keep writing while someone reviews the sent version, without a Feuillets server and without automatically overwriting the current manuscript.

---

## 14. Find DOCX Revision again

Word feedback from an editor or proofreader is handled under **Proofreading → DOCX Revision**.

Feuillets imports supported changes/comments and presents them in its review workflow, keeping review decisions separate until they are applied.

Collaborative review and DOCX Revision are distinct workflows and are documented separately.

---

## 15. Find chronology again

**Timeline** compares dated events with manuscript narrative order and can use both dated sheets and Research events.

Sheet **Context** can also surface continuity information from your own project data, such as character age/state, a character not yet born or already dead, nearby historical events, or an anachronistic object/technique.

---

## 16. Find narrative-thread tracking again

**Storyline** projects the same manuscript through narrative threads, labels, point-of-view characters and other useful dimensions. It helps inspect thread distribution without imposing a plotting method.

---

## 17. Find Composition Mode again

Use **Focus Mode** when the goal is to reduce the interface around the prose: controlled width, typewriter scrolling, dimming and a discreet counter.

Do not confuse it with the central **Edition** workspace, which controls the final document.

---

## 18. Find writing targets again

Feuillets can track per-sheet targets, project target, progress, recent activity, writing calendar and journal. Important settings can be project-specific rather than globally shared by every manuscript.

---

## 19. Find Compile again

The central **Edition** workspace has two modes.

### Composition

Control what the document contains:

- manuscript content;
- first page;
- front matter;
- contents/table of contents;
- tables;
- bibliography;
- appendices;
- structure and compilation rules.

### Layout

Control presentation:

- page;
- body text;
- headings;
- blockquote/separator;
- margins, orientation, columns, headers and footers;
- active layout template.

Export is not a third tab. Scope, format and **Export** controls remain in Edition's top bar.

Native output formats include compiled Markdown, DOCX, EPUB, ODT and PDF through the desktop system print flow. Preview and export share the same composition logic.

---

# Migrate a Scrivener project

Desktop Scrivener import recovers supported Binder structure, folders, text documents, titles, compatible metadata and supported resources.

Feuillets **explicitly preserves source Binder order** during import. Natural filename sorting is only a fallback when no explicit order exists.

After import, verify parts/chapters/scenes order, titles, synopsis, notes, metadata, images/resources, non-text documents and compilation exclusions. Keep the original Scrivener project as an archive until several control exports have been validated.

---

# Equivalent daily workflow

## In Scrivener

```text
Open project
→ select a scene in Binder
→ write
→ inspect synopsis and notes
→ open Research
→ create Snapshot
→ Scrivenings / Compile
```

## In Feuillets

```text
Open project
→ select a sheet in Binder
→ write alone or in Continuous
→ use Sheet and Context
→ open or link Research
→ snapshot when useful
→ compare / review
→ check Preview
→ compose and export in Edition
```

---

# What you gain

- ordinary Markdown files;
- a project readable without Feuillets;
- real editable Continuous mode;
- the Obsidian ecosystem;
- linked Research without moving existing folders;
- YAML property remapping;
- working annotations outside Markdown;
- local collaborative review;
- richer version comparison;
- integrated Timeline and Storyline;
- composition/export without a proprietary manuscript database.

# What remains different from Scrivener

Scrivener retains advantages that come from being a fully dedicated application: a completely controlled interface, an exceptionally mature Compile system, specialized proprietary objects/metadata, exact Collections semantics and some advanced automation.

Feuillets chooses another trade-off: **a complete writing workspace that adapts to the writer's existing Obsidian vault, files and tools**.

---

# Verdict

Feuillets does not replace Scrivener by copying its project format. It takes Scrivener's most useful long-form principle — a book made of movable writing units that can be drafted, grouped, reread and compiled — and rebuilds it around Markdown and Obsidian.

For writers whose main need is to write, structure, document, revise and export a manuscript without proprietary project lock-in, Feuillets now covers most of that workflow, including a true editable Continuous mode comparable in purpose to Scrivenings.
