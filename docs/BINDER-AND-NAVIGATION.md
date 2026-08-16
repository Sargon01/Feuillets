# Binder and navigation

> [Français](CLASSEUR-ET-NAVIGATION.md) · **English** · [Documentation index](README.md)

The **Binder** is the manuscript’s working structure. It is used to find text, move sheets, open a folder in Continuous mode, or inspect hierarchy without turning the Obsidian vault into a parallel database.

## Single view and split view

Feuillets provides two presentations of the same Binder.

### Single view

Single view is the full-width 2.5 Binder. Its normal interactions remain available: folders, sheets, multi-selection, search, filters, isolation, drag and drop, and Continuous opening.

### Split view

**Split view** adds a navigation pane on the left. The Binder on the right does not change in appearance or behavior.

The left pane contains two areas:

- **Manuscript** — project folders only, following real Binder order;
- **Vault** — lightweight access to other vault folders and files.

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

**Isolate this folder** temporarily narrows the Binder to one manuscript branch. Isolation is session working state: it does not change the project folder or move any file.

You can then return to the parent or full project. Split view does not change this mechanism: the left pane is for navigation, while isolation remains an explicit Binder action.

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
