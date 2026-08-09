# Feuillets — The Notebook

> [Français](HOW-TO-CARNET.md) · **English** · [Documentation index](README.md)

The **Notebook** is Feuillets’ visual brainstorming space. It is based on a standard Obsidian Canvas and lets ideas move through three stages of the writing process:

**free idea → visual organization → manuscript or research**

The Notebook is not an automatic copy of the Binder. You decide what enters it and what leaves it, so you can think freely without changing the actual manuscript structure.

For direct card menus and the Idea Tree workflow, **Advanced Canvas is recommended**. Core conversion features remain available from the command palette even without that plugin.

---

## 1. Open the Notebook

From the Obsidian command palette, run:

**Feuillets: Open the Notebook**

Feuillets creates the Notebook if it does not exist yet, then opens the Canvas for the active project.

The file is stored in the project Resources folder as:

`Tableau brainstorming.canvas`

Feuillets does not regenerate this file on every opening and does not replace its contents. The Notebook remains a free working space.

---

## 2. Capture an idea without leaving your writing

Run:

**Notebook: capture an idea**

Type your idea and press `Enter`.

A new free text card is added to the Notebook even when the Notebook is not open. The current sheet, active tab and workspace remain unchanged.

This command is useful for quick thoughts such as:

- a scene to write;
- a question;
- a plot possibility;
- an image;
- a line of dialogue;
- something to check later.

Duplicate ideas are allowed. A free idea is not automatically linked to the current sheet or to a Research note.

---

## 3. Add an existing sheet to the Notebook

From the current sheet, use:

**Notebook: add current sheet**

You can also right-click a sheet in the Binder and choose:

**Add to Notebook**

For several sheets, select them in the Binder and choose:

**Add selection to Notebook**

Sheets are added in their actual manuscript order.

Adding a sheet to the Notebook does not move it in the Binder. The Notebook simply receives a card pointing to the existing Markdown file.

If a sheet is already present in the Notebook, Feuillets does not duplicate it.

---

## 4. Turn an idea into a manuscript sheet

With Advanced Canvas, right-click a text card and choose:

**Turn into sheet**

Feuillets asks where the new sheet should be created in the manuscript. The suggested title comes from the first meaningful line of the idea and can be edited before confirmation.

After conversion:

- a real Markdown file is created;
- the idea text is preserved;
- the text card becomes a file card;
- its position and appearance are preserved as much as possible.

To convert several ideas at once, select them and choose:

**Send ideas to manuscript…**

You can choose which ideas to use, their order and their destination folder.

---

## 5. Turn an idea into a Research note

Right-click an idea and choose:

**Turn into Research note**

The note is created in the Notebook section of the project Research area.

The card becomes a file card. Feuillets gives it a visual distinction unless you had already chosen a custom color.

An arrow between a Research note and a scene remains a visual relationship only. It does not automatically create a business-level link between Research and the manuscript.

---

## 6. Build an Idea Tree

The Idea Tree helps you structure a thought, scene, chapter or part before creating real files.

Right-click a card and choose:

**Develop into tree…**

Enter one idea per line. Each line becomes a child branch.

You can then use:

- **Add a branch** to create one child;
- `Tab` to create a child when exactly one tree card is selected;
- `Enter` to create a sibling when the selected card already has a parent in the tree;
- **Reorganize tree** to lay out that tree cleanly again.

A card created with `Tab` or `Enter` is not automatically put into edit mode. Select or open it to enter its text.

### Important

Feuillets distinguishes free Canvas links from structural Idea Tree links.

An arrow drawn manually in the Canvas remains only an arrow. For Feuillets to recognize a branch as structure, create it with the Idea Tree features.

---

## 7. Turn a branch into a manuscript outline

This is the most flexible Notebook workflow.

Imagine this tree:

```text
Part 1
    Chapter 1
        Kemal arrives in Suvasa
        He enters the café
        The muhtar wants to buy his house
    Chapter 2
        He discovers the house
        He is disappointed
```

Right-click **Part 1**, then choose:

**Turn this branch into an outline…**

Feuillets converts the visual structure into a Markdown outline before changing the manuscript.

The rule is simple:

- a card with children becomes a **folder**;
- a card with no children becomes a **sheet**.

The original branch remains intact in the Notebook.

You can review or edit the proposed outline before creating anything.

---

## 8. Re-import an outline that already exists

The Idea Tree outline workflow is **additive and idempotent**.

That means you can:

1. turn a branch into an outline;
2. keep enriching the branch in the Notebook;
3. run **Turn this branch into an outline…** again.

Feuillets then tries to reuse what already exists.

For an existing folder:

- its current order is preserved;
- existing sheets are preserved;
- new folders and sheets are appended;
- existing items are not moved automatically.

Running the exact same import a second time therefore creates nothing new.

---

## 9. How Feuillets recognizes an existing sheet

Feuillets matches an outline item to an existing sheet only when:

- it is in the same folder;
- its displayed title matches exactly;
- letter case matches.

Feuillets does not use fuzzy matching.

For example, if the outline contains:

`Kemal arrives in Suvasa`

and the existing sheet was renamed:

`Kemal's arrival in Suvasa`

Feuillets does not assume that they are the same item.

This strict rule prevents arbitrary merges.

---

## 10. What happens when there is ambiguity?

Feuillets stops instead of guessing.

Import is blocked when:

- the outline contains the same sheet title twice in the same folder;
- several existing sheets in the same folder have exactly the same title.

In that case:

- no part of the outline is created;
- no existing file is changed;
- the dialog stays open;
- you can correct the titles and try again.

---

## 11. A living outline is not automatic synchronization

The Notebook and Binder are connected, but they are not permanent mirrors.

After an outline has been created:

- moving a card in the Notebook does not automatically move the sheet in the Binder;
- reorganizing a tree does not automatically reorder existing chapters;
- deleting a Notebook card does not delete the corresponding Markdown file;
- changing the Binder does not automatically redraw the Idea Tree.

This is intentional:

**the Notebook helps you think; the Binder remains the real structure of the book.**

---

## 12. Create a chapter directly from the Notebook

Another workflow is to materialize several cards immediately into a single chapter.

You can use:

**Create a chapter from the selection…**

or, from an Idea Tree:

**Create a chapter from this branch…**

The dialog lets you:

- choose the chapter name;
- choose its destination;
- select the items to include;
- set their order.

Text ideas become new sheets.

If a manuscript sheet is already present in the selection, it is **moved** into the new chapter; it is not copied.

Research notes, images, links and other non-manuscript items are not included as scenes.

### Difference from “Turn this branch into an outline…”

**Create a chapter from this branch…**

- creates one chapter;
- materializes the branch items immediately;
- may move existing manuscript sheets into that chapter.

**Turn this branch into an outline…**

- can create several folder levels;
- reuses items already present;
- enriches an existing structure without reordering it;
- is better suited to a book outline that evolves over time.

---

## 13. Create a chapter from a Canvas group

You can also use a visual Canvas group.

Place several items inside a group, then choose:

**Create chapter in manuscript…**

Feuillets keeps only items that can belong to the manuscript:

- text ideas;
- Markdown sheets already present in the active manuscript.

Research notes and other resources remain in the Notebook.

---

## 14. Split an idea

On a text card, choose:

**Split…**

Feuillets proposes a split point in the text. You can freely edit both parts before confirming.

After confirmation:

- the first card keeps the first part;
- a new card is created next to it with the second part;
- no extra relationship is created automatically.

---

## 15. Merge several ideas

Select several text ideas and choose:

**Merge…**

You can define:

- the content order;
- the card that should remain as the target.

Feuillets combines the texts into the target, then removes the other selected cards after the operation succeeds.

The merge does not rewrite or summarize the text. Contents are concatenated in the chosen order.

---

## 16. Use the Notebook without Advanced Canvas

Advanced Canvas is recommended for the full experience, but the Notebook does not depend on it to exist.

Without Advanced Canvas, the command palette still lets you:

- open the Notebook;
- capture an idea;
- add the current sheet;
- send ideas to the manuscript;
- turn ideas into Research notes;
- create a chapter from the Notebook.

Advanced Canvas mainly adds direct interaction on the cards:

- contextual menus;
- multi-selection actions;
- Idea Trees;
- `Tab` and `Enter` shortcuts;
- direct branch conversion.

---

## 17. Suggested workflow

A simple workflow is:

1. Capture ideas while writing with **Notebook: capture an idea**.
2. Open the Notebook when you want a wider view.
3. Group related ideas.
4. Develop important ones into Idea Trees.
5. Reorganize freely until the structure becomes clear.
6. Use **Turn this branch into an outline…** to materialize that structure gradually in the Binder.
7. Keep enriching the Notebook.
8. Re-import the branch when new scenes or chapters appear.
9. Turn isolated ideas directly into manuscript sheets or Research notes.
10. Return to the Binder for final writing and manuscript organization.

---

## 18. In short

The Notebook can be used to:

- capture an idea without interrupting writing;
- think visually with cards;
- display existing manuscript sheets;
- turn an idea into a real sheet;
- turn an idea into a Research note;
- build Idea Trees;
- create a chapter from a selection, group or branch;
- turn a branch into a Feuillets outline;
- enrich that outline over time without recreating existing items;
- split or merge ideas.

The Notebook does not impose a method. It acts as a bridge between visual thinking and the real manuscript.

**From idea to manuscript, without leaving your workspace.**
