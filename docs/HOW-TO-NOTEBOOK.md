# Notebook — from ideas to manuscript

> [Français](HOW-TO-CARNET.md) · **English** · [Documentation index](README.md)

The **Notebook** is Feuillets’ visual workshop inside Obsidian’s native Canvas: free notes, file cards, relationships, styling, arrangement, mind maps and manuscript planning. Book text stays in Markdown files; ideas that have not been converted stay in the `.canvas` file.

A practical path is **capture ideas → arrange notes → establish relationships → develop an outline → turn ideas into a manuscript**. Use only the stages you need.

## Choose a Notebook

- The Binder’s **Notebook** button opens the project Notebook.
- A folder’s context menu offers **Create Notebook**, then **Open Notebook** for its own visual workspace.
- The **Notebooks** sidebar tab, under **Available Carnets**, lets you find registered Notebooks, open them or create the suggested context’s Notebook. The displayed paths distinguish folders with identical names.

A folder Notebook is titled **Notebook · Folder name**. Its identity is separate from the folder name: a rename or move tracked by Feuillets inside the project preserves the association. Deleting a folder and creating another with the same name is not the same as moving the original.

A Research folder explicitly linked to a Binder folder can share the **same logical Notebook** when ownership is unambiguous. Research documents are not moved. An older separate Notebook may be kept rather than merged automatically.

See [Binder and navigation](BINDER-AND-NAVIGATION.md), [Workspaces](WORKSPACES.md) and [Research and linked folders](RESEARCH-AND-LINKED-FOLDERS.md).

## 1. Capture ideas while writing

**Notebook: capture an idea** opens a quick entry and adds a text note. From the command palette it targets the project Notebook; from **Notebooks → Notebook tools** it uses the chosen Notebook. It does not turn the idea into a manuscript sheet or require you to leave the current text.

To bring existing writing into your visual work:

- use **Notebook: add current sheet** to add a file card;
- drag one or several sheets from the Binder, or documents from Research, onto the Notebook;
- use native Canvas tools to create text cards, groups and file cards.

A file card represents the existing file: adding it does not move or rename the Markdown. Editing that file through its card still changes the real document. A free text note, by contrast, is not yet a manuscript file.

**Example:** capture three possible scenes, add the current chapter’s sheet and a Research document, then move these elements around to compare their relationships before deciding on the book’s order.

## 2. Arrange free notes

Free text notes have a borderless appearance by default. The **Selection Inspector** and floating toolbar adapt their controls to the current card, connection or selection. Structured blocks, such as a mind map or Binder Plan, retain their own rules.

### Appearance and dimensions

For a compatible text note, choose:

| Appearance | Use |
|---|---|
| **Frameless** | Free text on the Notebook surface |
| **Simple outline** | Delimit an idea |
| **Rounded corners** | Distinguish a family of notes |
| **Colored background** | Highlight a note |
| **Classic Canvas card** | Restore the native card presentation |

Card color and text color are separate. Card colors use the Canvas palette and Obsidian theme. File cards and groups keep their native tools; free-note typography is not a style editor for the file represented by a card.

Content and typography adjust compatible note sizes. After a manual width resize, text wraps within the chosen width and height adapts to content. Changing the font size is not the same as scaling the entire Canvas. The classic card retains native presentation behavior.

### Note typography and passage formatting

The inspector offers sizes from **12 to 40 px**, a return to the theme size, left/center/right/justified alignment, and red, orange, green, cyan or purple text, plus the theme text color. These settings affect the note, rather than a single word.

For **Bold**, **Italic**, **Strikethrough** or **Underline (single paragraph)**, enter note editing and select text. The action is unavailable without a text selection and compatible editor. Underline inserts inline HTML `<u>…</u>` and rejects selections containing a line break; the other formats use native Markdown formatting commands.

### Align, distribute and stack

Select several cards to reveal the available **Align**, **Arrange**, **Distribute**, **Justify vertically** and **Stack** actions. Alignment and distribution reuse native Canvas operations; distribution requires at least three items. A selection containing protected structural items can make these tools unavailable.

Two different operations apply to free text notes:

| Action | Immediate result | Persistent relationship |
|---|---|---|
| **Stack notes** | Arranges at least two notes vertically, edge to edge, in spatial order | None: each note remains independent |
| **Stack dynamically** | Creates a vertical stack of eligible independent notes | Yes: membership and order are stored in Canvas |

A dynamic stack retains note widths and reflows when their heights change, including after editing or typography changes. It is not a Canvas group that automatically moves all members as one object. Manually dragging a member can remove it from the stack. **Unstack dynamically**, available when selecting a member, dissolves the affected stack’s relationship without moving its rectangles. Stacks with too few valid members are cleaned up.

These operations apply to compatible free notes; they do not rearrange a Binder Plan or mind map instead. Creating a dynamic stack requires notes that do not already belong to one.

## 3. Connect ideas

Native Canvas handles and connections remain available. Feuillets adds a Scapple-style gesture for **free text notes**:

1. Leave note editing.
2. With the mouse, drag the note body onto another free text note, without modifier keys.
3. Release: the relationship is created and the dragged note returns to its starting position.

With a single note, repeating the gesture can remove an existing simple relationship: it must be unique, with no label, color, custom styling or arrows. An enriched relationship is preserved; use its Canvas tools to edit or delete it.

To connect several ideas to one destination, select them and drag one selected note onto a note outside the selection. Feuillets adds missing connections and **preserves existing relationships**: a multiple-note gesture does not toggle them off.

This shortcut requires the active editable Notebook and compatible free text notes. It does not apply to file cards, groups, mind-map members, Binder Plans or structural cards. Editing text, mixed selections, panning with Space or a stale context prevent the gesture from being converted. This mechanism does not turn ordinary vault Canvases into Feuillets Notebooks.

A note belonging to a dynamic stack is not eligible for this free-connection gesture while its stack relationship remains. Unstack it first to use it as an independent note.

### Connection appearance

Select a compatible connection in the inspector or open its **Appearance** menu:

- **Geometry**: **Straight**, **Curved** or **Map**;
- **Line style**: **Solid**, **Dashed** or **Dotted**;
- **Thickness**: **Thin**, **Regular** or **Thick**;
- **Arrows**: none, start, end or both;
- the default color or one of the six Canvas colors.

**Map** routing uses orthogonal segments and looks for a path around cards. It does not move cards or guarantee ideal routing in every crowded arrangement. Connections around free notes follow their bounds and content as dimensions change. Native curves retain native geometry; connections managed by structured blocks remain protected.

Ordinary connections between free text notes initially use straight, thin, dashed lines unless explicitly configured. Eligible connections to file cards or groups retain a native curved, solid, regular baseline. The free-note drag gesture creates connections without arrows. **Restore default connection appearance** removes color, arrows and line/width overrides while **preserving explicitly chosen routing**.

## Inspector, floating toolbar and future styles

The **Notebooks** tab brings together **Available Carnets**, **Selection Inspector**, **Carnet Tools**, **Default Styles** and **Display**. The selected Canvas context is retained when you focus its inspector; switching to another document can make it unavailable. Actions recheck which objects are still selected.

Under **Display**, **Show floating toolbar** controls whether tools also follow the Canvas selection. Native menus remain distinct from Feuillets’ added commands.

**Default Styles** configure **new text cards** and **new free connections**: appearance, colors, typography and the offered connection properties. These preferences do not restyle existing elements or transform structural mind-map or Binder Plan items. Classic Canvas card is an existing-card appearance; it is not one of the four appearances offered for future free notes.

Use the inspector to change an existing card; use defaults to prepare future cards. **Restore defaults** resets creation preferences, not the entire Notebook.

## Binder Plan inside the Notebook

The **Binder Plan** is an interactive card that projects the real Binder structure into the Notebook. The current **Create or update the project Binder Plan** entry point always targets the **project Notebook and the complete manuscript**, even if you were working in a folder. The Notebooks panel offers this action only for the project Notebook. The model can still recognize an older folder Plan; that does not change this command’s scope.

Choose **Create or update the project Binder Plan** to create it or refresh it from the Binder. This refresh replaces its working state: apply any changes you want to keep first. A Notebook should contain only one Binder Plan.

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

If a write fails during application, the interface can report an incomplete rollback: check the Binder and notice in that case. Preflight validation does not guarantee that writes cannot fail.

## Mindmaps

One Notebook can contain one or several **mindmaps** while the rest of the Canvas remains free-form.

Choose **Create mind map**. Feuillets creates a **Central idea** root and a Canvas group containing the structure.

On a mindmap card:

- **Tab** creates a child;
- **Enter** creates a sibling when the card has a parent;
- **Shift+Tab** moves the branch one level up when possible;
- a branch can be dropped onto another card to change its parent;
- **Collapse/expand this branch** hides or restores descendants without deleting data;
- **Mindmap: change orientation** switches between horizontal and vertical layout;
- **Reorganize mindmap** recalculates a clean layout.

Feuillets rejects reparenting that would create a cycle or mix two different mindmaps. Free Canvas cards and links nearby remain untouched.

An older **Idea Tree** branch can be explicitly converted with **Convert to mind map**. Only the chosen branch is converted; unrelated Canvas content is not rearranged.

## 4. Turn ideas into writing

Under **Notebook tools → Convert / Send**, use:

- **Notebook: turn ideas into manuscript sheets…** to choose notes and their destination;
- **Notebook: turn ideas into research files…** to keep ideas as documentation;
- **Notebook: create a chapter…** to prepare a folder and eligible sheets from a group or chosen items.

The dialogs let you check titles, selection and order before creation. Conversion creates a real Markdown file and replaces the converted note with a file card, retaining its visual connection to the Notebook work. Existing file cards are not text notes awaiting conversion. Check the offered destinations: a card’s spatial position alone does not determine its future folder.

**Example:** stack five ideas once to read them in a provisional order; connect dependent ideas; build a mind map for one branch; convert the selected ideas to sheets; then open the project Binder Plan to prepare the actual structure. Freely moving the other cards still does not change manuscript order.

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

When installed, Advanced Canvas can add contextual entry points, including card conversion, splitting and merging. The free notes, drag-to-connect gesture, inspector, styles, stacking, Plan and mind maps described here do not require it. A Notebook should remain openable and usable as a Canvas without Advanced Canvas.
