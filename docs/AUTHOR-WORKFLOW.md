# An author's workflow, from the first word to export

> [Français](PARCOURS-AUTEUR.md) · **English** · [Documentation index](README.md)

This guide follows the work in its natural order. It does not try to explain every setting.

## 1. Let the project begin

From the Binder welcome screen, you can:

- **Create a project**: choose a name and, if useful, an author and project type;
- **Use an existing folder as-is**: keep its current structure and files untouched;
- **Initialize an existing folder as a Feuillets project**: add Feuillets conventions when you actually want them;
- **Open an existing manuscript**;
- **Discover Feuillets with the demo project**.

A fiction project naturally uses part, chapter and scene terminology. A non-fiction project adapts labels and Research categories. A Free project keeps the least prescriptive structure.

Specialized areas such as Journal, snapshots or Edition can appear only when they become useful.

![Create a first project](creer-premier-projet.gif)

## 2. Shape the manuscript in the Binder

The Binder shows the manuscript hierarchy.

A typical fiction project might read:

> Part → Chapter → Scene → Sheet

The author can:

- create items at the right level;
- rename folders and sheets;
- drag and reorder items;
- move an item back to manuscript root;
- undo the last move;
- search;
- filter by status, label or progress;
- import an outline prepared elsewhere.

![Binder](feuillets-classeur.png)

## 3. Let ideas mature in the Notebook

The **Notebook** is Feuillets' visual brainstorming space. It is based on a standard Obsidian Canvas and deliberately remains separate from the Binder: the Notebook helps you think, while the Binder remains the real manuscript structure.

You can:

- capture an idea without leaving the active sheet;
- add an existing sheet or a selection of sheets;
- turn an idea into a real Markdown sheet;
- turn an idea into a Research note;
- build branches and Idea Trees;
- create a chapter from a selection, a Canvas group or a branch;
- turn a branch into a Feuillets outline.

An outline created from an Idea Tree can be imported again as it evolves. Feuillets reuses existing folders and sheets when titles match exactly, preserves existing order, and adds only new elements.

This is not permanent synchronization: moving a Notebook card does not automatically move the corresponding file in the Binder.

Advanced Canvas is recommended for direct card menus and Idea Trees, but essential commands remain available from the command palette.

See **[The Notebook — from ideas to manuscript](HOW-TO-NOTEBOOK.md)**.

## 4. Write

Feuillets enriches the Obsidian editor instead of replacing it.

Writing View can provide:

- typographic quotation marks, apostrophes and dashes;
- automatic paragraph indents;
- compact paragraph presentation;
- controlled text width;
- manuscript-wide find and replace;
- footnotes and citations;
- Focus Mode;
- typewriter scrolling.

The sheet remains the main place where writing happens.

![Writing and Preview](feuillets-concentration-apercu.png)

## 5. Keep useful information beside the text

The **Notes** tab of the Inspector keeps working material separate from final manuscript text.

It can contain:

- synopsis;
- summary;
- working notes;
- sources;
- sheet outline;
- chapter or part notes;
- properties;
- Context for characters, places, events and documents relevant to the current passage.

These elements accompany the scene without being confused with compiled manuscript text.

## 6. Build the project bible

The **Research** tab holds the documentation the book needs:

- characters;
- places;
- events;
- concepts;
- lore;
- sources;
- bibliography;
- glossary.

Excerpts can be inserted into the active sheet as a link, quotation or quotation with source.

## 7. Step back and change viewpoint

### Cards

Move scenes and read their synopsis, excerpt, status or progress at a glance.

### Outline

Inspect hierarchy, status, progress and chosen project information in a table.

### Storyline

Observe narrative threads and the balance of the story.

### Timeline

Distinguish the order in which events happen from the order in which the reader discovers them.

### Preview

Read a scene, chapter, part, folder, selection or full manuscript through the composition engine.

![Several views of the same manuscript](feuillets-mosaique-narrative.png)

## 8. Transform scenes

A scene or sheet can be:

- moved;
- renamed;
- split;
- merged;
- duplicated;
- excluded from composition;
- restored to composition later.

During split or merge, Feuillets can apply project rules to attached properties so that information is not silently lost.

## 9. Track the work

### Statistics

Use them to follow:

- word targets;
- sheet progress;
- project progress;
- characters, sentences and paragraphs;
- estimated reading time;
- recent activity.

### Writing Journal

Keep a daily record of:

- goals;
- difficulties;
- narrative decisions;
- experiments;
- changes of direction;
- session review.

## 10. Reread and revise

Revision can combine:

- direct correction in the sheet;
- continuous reading in Preview;
- find and replace;
- version comparison;
- local prose Analysis;
- Proofreading through a specialized provider such as Feuillets-Grammalecte;
- processing an annotated DOCX in **Inspector → Edition → DOCX Revision**.

The grammar engine does not belong to the Feuillets core.

## 11. Work on several manuscripts

Several projects can be registered in one vault and opened successively.

Switching projects changes the manuscript scope, Binder, Research and related project tools without requiring a separate Obsidian vault for every book.

## 12. Compose the final document

Composition lets you choose the exact scope:

- one sheet;
- one folder;
- a selection of files and folders;
- the whole project.

You can then define inclusion, order, titles, separators, first pages and output styling.

Preview uses the same composition logic, so the final structure can be judged before export.

## 13. Export

Feuillets can produce:

- compiled Markdown;
- DOCX;
- EPUB;
- ODT;
- PDF through desktop system printing.

The Markdown files remain the source. Export creates a publication artifact; it does not convert the project into a proprietary document.

![Paginated Preview](feuillets-apercu.png)

## 14. Bring Word feedback back into the manuscript

When an editor or proofreader returns an annotated DOCX:

1. open **Inspector → Edition → DOCX Revision**;
2. analyze the returned file;
3. review tracked changes and comments;
4. inspect uncertain mappings before applying them;
5. accept, reject or defer each decision;
6. let Feuillets update the corresponding Markdown when safe;
7. generate a revised DOCX for the next editorial exchange.

See **[Reviewing a Word manuscript with Feuillets](HOW-TO-DOCX-REVISION.md)**.

## 15. Protect the work

Different tools serve different purposes:

- snapshots provide a quick point of return;
- comparisons show what changed;
- versions preserve larger narrative branches;
- ZIP backups protect the project as files.

![Compare versions](feuillets-comparaison.png)

## 16. Continue the editorial life

The companion **Courrier** plugin can manage:

- publishers and agents;
- submissions;
- letter templates;
- replies;
- follow-ups;
- the exact version sent.

Feuillets stays focused on the manuscript; Courrier handles correspondence.

## 17. Keep going without lock-in

At every stage, the project remains made of Markdown files and ordinary folders.

You can stop using Feuillets without losing the manuscript format, continue in another Markdown editor, use Obsidian without Feuillets, or keep the project under Git or another backup system.

The aim is not to make the author dependent on the software. It is to make the software useful for as long as the author wants it.
