# Notebook — from ideas to manuscript

> [Français](HOW-TO-CARNET.md) · **English** · [Documentation index](README.md)

The **Notebook** is Feuillets' visual workspace built on Obsidian's native Canvas. It is meant for thinking around the manuscript without turning Canvas into a parallel database: sheets remain ordinary Markdown files and the Notebook remains a real Canvas file.

Feuillets provides a **project Notebook** and **Notebooks attached to folders**. A folder Notebook keeps its identity when the folder is renamed or moved inside the project.

## Open a Notebook

The **Notebook** button in the Binder opens the project Notebook.

To work around a specific manuscript folder, open its context menu:

- **Create Notebook** creates its Notebook when none exists yet;
- **Open Notebook** reopens the Notebook already attached to it.

A folder Notebook is titled **Notebook · Folder name**.

A Research folder explicitly linked to a Binder folder can share the **same logical Notebook** as that Binder folder. This keeps manuscript material and its related Research in one visual context without moving the Research files.

See [Binder and navigation](BINDER-AND-NAVIGATION.md) and [Research and linked folders](RESEARCH-AND-LINKED-FOLDERS.md).

## Use Canvas freely

A Notebook remains an Obsidian Canvas: you can create text cards, file cards, groups and links, then place them freely.

Feuillets adds only the writing-oriented bridges:

- a file dragged from the Binder or Research becomes a **real file card** in the Notebook;
- the source Markdown file is not moved, renamed or modified by that drag and drop;
- a text idea can be captured and later turned into a sheet or a Research document;
- ordinary Canvas cards and links remain independent from structures managed by Feuillets.

The Notebook can therefore serve as a free-form thinking space, a visual worktable, or simply a blank sheet around one folder.

## Binder Plan inside the Notebook

The **Binder Plan** is an interactive card that projects the real Binder structure into the Notebook. It is available in the project Notebook and in manuscript folder Notebooks.

Choose **Create Binder Plan** to add it. A Notebook should contain only one Binder Plan.

The Plan displays the hierarchy of its scope and lets you prepare structural changes without immediately writing them to the vault.

### Edit the Plan

In the Plan you can, among other things:

- edit the displayed title of a sheet;
- rename a folder;
- add a new sheet or folder;
- move and reorder rows;
- indent or outdent a row;
- collapse or expand a branch.

The keyboard works like an outliner:

- **Enter** creates a new sheet;
- **Cmd/Ctrl+Enter** creates a new folder;
- when a folder is active, the new item is created inside it; when a sheet is active, it is created as a sibling;
- **Tab / Shift+Tab** indent or outdent when the structure allows it;
- **Alt+↑ / Alt+↓** move the row;
- **Escape** cancels the current title edit.

For an existing sheet, the Plan changes its **short title** without renaming the Markdown file on disk. For a folder, the title corresponds to the real folder name.

### Refresh, then apply

The Plan deliberately separates thinking from real Binder writes:

1. **Refresh from Binder** reads the real structure again;
2. edit the Plan;
3. **Unapplied changes** indicates that the Plan now differs from the Binder;
4. **Apply to Binder** executes the changes after validation.

Feuillets validates the whole operation set before the first write. If the Binder changed in the meantime, a name collides, or an operation would escape the Plan scope, applying is refused rather than partially changing the project.

The Plan does not silently delete existing Binder items. Draft items created in the Plan can be removed before applying, but an existing item missing from the Plan must be restored before changes can be applied.

## Mindmaps

One Notebook can contain one or several **mindmaps** while the rest of the Canvas remains free-form.

Choose **Create a mindmap**. Feuillets creates a **Central idea** root and a Canvas group containing the structure.

On a mindmap card:

- **Tab** creates a child;
- **Enter** creates a sibling when the card has a parent;
- **Shift+Tab** moves the branch one level up when possible;
- a branch can be dropped onto another card to change its parent;
- **Collapse/expand this branch** hides or restores descendants without deleting data;
- **Mindmap: change orientation** switches between horizontal and vertical layout;
- **Reorganize mindmap** recalculates a clean layout.

Feuillets rejects reparenting that would create a cycle or mix two different mindmaps. Free Canvas cards and links nearby remain untouched.

An older **Idea Tree** branch can be explicitly converted with **Convert to mindmap**. Only the chosen branch is converted; unrelated Canvas content is not rearranged.

## Notebook and manuscript stay separate

The Notebook is for thinking, organizing and visualizing. Markdown remains the source of the text.

This separation keeps the project flexible:

- moving a card does not move a file in the Binder;
- linking two cards does not create a hidden manuscript property;
- the **Binder Plan** changes the Binder only when you explicitly choose **Apply to Binder**;
- mindmaps impose no structure on the rest of the project.

For the Notebook in the wider workflow, see [The author's workflow](AUTHOR-WORKFLOW.md).

## Advanced Canvas

**Advanced Canvas is not required for the Plan or for mindmap keyboard interactions.** The Notebook is built on Obsidian's native Canvas first.

When Advanced Canvas is installed, Feuillets can benefit from its visual and interaction enhancements without making it a mandatory dependency. A Notebook should remain openable and usable as a Canvas without Advanced Canvas.
