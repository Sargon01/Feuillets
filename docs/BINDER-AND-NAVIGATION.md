# Binder and navigation

> [Français](CLASSEUR-ET-NAVIGATION.md) · **English** · [Documentation index](README.md)

The **Binder** is the manuscript’s working structure. It is used to find text, move sheets, open a folder in Continuous mode, or inspect hierarchy without turning the Obsidian vault into a parallel database.

## Single view and split view

Feuillets provides two presentations of the same Binder.

### Single view

Single view displays the Binder across the full width. Its normal interactions remain available: folders, sheets, multi-selection, search, filters, isolation, drag and drop, and Continuous opening.

### Split view

**Split view** adds a navigation pane on the left; the pane on the right remains the working Binder and reflects the active workspace.

The left pane contains the project’s navigation layers:

- **Manuscript** — project folders only, following real Binder order;
- **Research** — the project’s physical shared Research layer;
- **Workspaces** — Research roots linked to Binder folders, grouped virtually;
- **Vault** — lightweight access to other vault folders and files.

**Research** and **Workspaces** do not merge any folders. A Research folder can be physically under Project Research and still be shown under **Workspaces** when it is linked to a Binder folder. The **Workspaces** group does not create a folder in the vault.

The separator is resizable. Returning to single view gives the full width back to the Binder.

## Manuscript: see structure at a glance

The **Manuscript** area shows folders and subfolders without repeating Markdown files. It is meant for quickly reading a structure such as:

```text
Front
Part 1
  Chapter 1
  Chapter 2
Part 2
  Chapter 3
```

Clicking a folder line selects it as the display root and, if it has subfolders, toggles collapse/expand. Folders without subfolders can only be selected. Clicking a folder does not automatically isolate it or open Continuous mode. Working actions remain in the Binder on the right.

## Vault: consult documents without leaving Feuillets

The **Vault** area lets you browse vault documents without switching to Obsidian’s File Explorer.

It is deliberately limited to navigation. Depending on the file, you can:

- open it;
- open it in a new tab;
- open it side by side.

This area is not a second vault administration interface: there is no create, rename, delete, move or drag-and-drop workflow. Opening a document from **Vault** does not add it to the manuscript, compilation, Binder selection or Continuous mode.

## Isolating a folder

**Isolate this folder** temporarily narrows the Binder to one manuscript branch and defines the active workspace. Several Feuillets surfaces can follow this same scope: Binder, Board in its Cards, Outline, Arcs and Timeline modes, Research and the folder’s Notebook when one exists.

Isolation is a scope inside the project: it does not change the project folder, create a sub-project or move any file. You can then return to the parent or full project.

Split view does not change this mechanism: the left pane is for navigation, while isolation remains an explicit Binder action. See [One project, multiple workspaces](WORKSPACES.md).

## Opening in Continuous

A manuscript folder can be opened in **Continuous** to work across several sheets in one editor. The composition still relies on the real Markdown files and their Binder order.

See [Continuous mode](CONTINUOUS-MODE.md).

## Multi-selection

The Binder can select several sheets or folders for operations that accept a multi-item scope. This selection belongs to the Binder on the right; browsing **Manuscript** or **Vault** on the left does not silently replace it.

## Search and filters

Binder search can cover titles and, depending on the setting, sheet contents. Filters can combine status, label and progress.

These tools concern the manuscript. They do not turn the **Vault** area into a global vault search engine.

## Binder, Outline and Continuous

These surfaces solve different needs:

| Need | Tool |
|---|---|
| Navigate, select and move files | Binder |
| Read hierarchy at a glance | Split view → Manuscript |
| Inspect synopsis, statuses and other columns | Outline |
| Write across several sheets as one text | Continuous |

The Binder remains the real structure. Outline and Continuous are other ways of working with the same files.

## Quick drafts

**New quick draft** opens an immediately editable Markdown file under `_Feuillets/Drafts`. The first non-empty body line supplies its automatic filename. Drafts stay outside whole-project compilation until they are dragged or moved into the manuscript, while a draft can still be previewed or exported on its own.

Moving a draft into a Binder folder promotes it to ordinary manuscript content. If its filename already exists at the destination, Feuillets chooses a non-destructive numbered name.

See [From a short text to a series](FROM-SHORT-TEXT-TO-SERIES.md).
