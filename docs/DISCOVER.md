# Discover Feuillets

> [Français](DECOUVRIR.md) · **English** · [Documentation index](README.md)

Feuillets is a writing studio built **inside** Obsidian. Your manuscript remains Markdown; tools appear around it only when they become useful.

You do not need to learn all of Feuillets before you start. Begin with what you want to do.

> **Binder → sheet/Continuous → Preview → Edition → export**

## What do you want to do?

- **I already have a folder of texts.** Use it directly as a Feuillets project: your files do not need to be moved, renamed or converted. See [Binder and navigation](BINDER-AND-NAVIGATION.md).

- **I want to write across several scenes or chapters.** Open a folder or selection in **Continuous**. Feuillets presents them in one genuinely editable document while keeping every sheet in its original Markdown file; this is not just a preview. See [Continuous mode](CONTINUOUS-MODE.md).

- **I want to work on only part of the manuscript.** Feuillets can work at the level of a **sheet**, **folder**, **selection** or the **whole project**. Depending on the action, that scope can be used in Continuous, Preview and export without making a copy of the project.

- **I want several outputs from the same source.** Add only the semantic roles that are useful to you, then create a **variant**, **extraction** or **collection**. Ordinary text remains included by default and the source manuscript is not duplicated. See [Semantic roles](SEMANTIC-ROLES.md) and [Content variants, extractions and collections](CONTENT-VARIANTS-EXTRACTIONS-COLLECTIONS.md).

- **I want to move a paragraph or passage.** In the native Markdown editor or in Continuous, use **right-click → Reorder text**, then drag the paragraph or, when it stays within a single paragraph, the selected fragment to its new position. Press **Escape** to leave the mode.

- **I want to leave myself a note on a sentence.** Select the passage and choose **Annotation…**. The annotation stays attached to the text, also works in Continuous and is never written into the Markdown; use a working note instead when the remark concerns the whole sheet. See [Working annotations](WORKING-ANNOTATIONS.md).

- **My research already lives elsewhere in the vault.** Do not move it: an existing folder can be **linked as Research** while remaining physically where it is. See [Research and linked folders](RESEARCH-AND-LINKED-FOLDERS.md).

- **I want a visual workspace around one folder.** Use **Create Notebook** from the folder menu, then reopen it with **Open Notebook**. This Canvas can remain entirely free-form or host a **Binder Plan** and **mindmaps**. A linked Research folder can share the same logical Notebook. See [Notebook — from ideas to manuscript](HOW-TO-NOTEBOOK.md).

- **I already use my own YAML properties.** In **Project**, Feuillets can map its logical fields to properties that already exist in your vault. You do not need to rename your properties or migrate your files. See [Project and YAML properties](PROJECT-AND-YAML-PROPERTIES.md).

- **I want to attempt a major rewrite without losing my current state.** Take a **snapshot**, rewrite normally, then use **Compare a version**. Feuillets shows additions, deletions, replacements and moves side by side; you can restore one passage from the snapshot without rolling back the whole file. See [Rewriting, backups and versions](REWRITING-BACKUPS-AND-VERSIONS.md).

- **I want to review my text or send it to someone else.** For a personal reminder, use an **Annotation**; for a reviewer using Feuillets, use **Collaborative Review** with a `.feuillets` package; for an editor or proofreader working in Word, use **DOCX Review**. See [Collaborative Review](COLLABORATIVE-REVIEW.md) and [DOCX Review](HOW-TO-DOCX-REVISION.md).

- **I want to export only a few chapters.** Select the sheets or folders you want and use that selection as the scope. There is no need to create a separate project or duplicate the manuscript.

- **I want to export without opening Preview.** You can. Preview is for visually checking the composed document, but it is not required for export; if Continuous still has pending edits, Feuillets saves them to the source files first.

- **I want the same Markdown as a presentation.** Separate slides with `---`. Feuillets composes them in 16:9, can use semantic roles without requiring them, and keeps `[!speaker-notes]` out of projection. See [Presentation](PRESENTATION-EN.md).

## Easy-to-miss features

- An existing Obsidian folder can become a Feuillets project without being restructured.
- The same scope model lets you work with one sheet, a folder, a selection or the whole project.
- **Reorder text** moves paragraphs or fragments without relying on cut and paste.
- **Annotations** also work in Continuous while remaining outside Markdown.
- **Snapshot → rewrite → comparison → passage restore** provides a non-destructive rewriting workflow.
- An existing documentation folder can be **linked as Research** without being moved.
- A manuscript folder can have its **own Canvas Notebook**, with Binder Plan and mindmaps.
- **YAML mapping** lets Feuillets adapt to properties already used in the vault.
- **Preview is optional for export**: it is for checking composition, not for enabling export.
- **Semantic roles are optional**, but can drive variants, extractions and collections from one source.
- The same Markdown can also feed a 16:9 **Presentation**.

## Understand the Feuillets workspace

### Binder

The **Binder** is the working structure of the manuscript. It is used to navigate, search, filter, move, select and isolate part of a project. **Split view** can add the Manuscript folder tree and lightweight Vault navigation on the left while the Binder on the right remains the working surface.

### Continuous

**Continuous** lets you write across several sheets in one editor without merging them. File boundaries remain protected and edits are written back to the corresponding Markdown files.

### Structural views

**Cards**, **Outline**, **Storyline** and **Timeline** show the same files from different angles: visual organization, metadata, narrative threads or event order. **Notebook** is the visual thinking Canvas: it can be project-wide or attached to a folder, remain entirely free-form, or host a **Binder Plan** and **mindmaps**. See [Notebook — from ideas to manuscript](HOW-TO-NOTEBOOK.md).

### Right panel

Five tabs accompany the text without replacing the manuscript:

- **Sheet** — synopsis, summary, notes, properties, annotations, footnotes and Context;
- **Research** — documentation, characters, places, events, sources, bibliography and linked folders;
- **Journal** — writing journal and tracking;
- **Project** — goals, statuses, labels, tags and YAML property mapping;
- **Proofreading** — text analysis, Collaborative Review, DOCX Review and comparison.

### Edition

**Edition** is a central workspace separate from the right panel. **Composition** decides what belongs in the document and can define variants, extractions and collections; **Layout** controls its presentation. The compact toolbar follows **Scope → Content → Format → Export**. **Preview** lets you inspect the result, while export remains available without opening it first.

## Philosophy

Feuillets is meant to adapt to an existing vault rather than force the writer to rebuild their organization for the plugin: ordinary Markdown files, real folders, manuscript order, YAML properties and existing Research remain under the user's control.

For the complete workflow in its natural order, see [The author's workflow](AUTHOR-WORKFLOW.md).
