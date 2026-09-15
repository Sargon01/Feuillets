# From a short text to a series

> English · [Français](DU-TEXTE-COURT-A-LA-SERIE.md) · [Index](README.md)

Feuillets does not require a manuscript to start as a book. A single Markdown file can remain an article, a course handout, a short story or a note. Structure is added only when it becomes useful.

## Start without structure

Use the Binder and the native Markdown editor for a standalone text. A file, a folder, a selection or the full project can be opened in Continuous, Preview or export without first creating chapters or parts.

The **New quick draft** command creates an empty Markdown sheet under `_Feuillets/Drafts` with its initial draft status. Its first non-empty line becomes its filename automatically. Rename it manually at any time to keep the name you choose. Quick drafts do not enter a whole-project compilation until they are moved into the manuscript structure; a quick draft can still be exported on its own.

## Use workspaces when one project needs local context

Isolate a Binder folder to make it the active workspace. This does not create a second project or duplicate any file. It simply lets the active folder use its own context where needed: Research, Notebook, Board, goals, workflow and writing typography. Settings can inherit from the parent folder and project.

This is useful for a course with one folder per lesson, a collection of independent essays, or a book divided into parts. Returning to the project restores the whole shared structure. See [One project, multiple workspaces](WORKSPACES.md).

## Turn a folder into an independent work

When a folder inside a project becomes a book, volume or other independent editorial unit, open its workspace settings and choose **Define this folder as a work**. The folder remains physically where it is; no manuscript is copied and no new project is created.

That work receives its own editorial boundary:

- its Preview and project-scope export stay within that work;
- its Composition can inherit the project composition or be customized locally;
- its front matter, contents, bibliography and appendices remain specific to that work;
- nested works are allowed, and the deepest declared work supplies the active editorial boundary.

## Example: a trilogy

```text
Saga
├── Volume I      ← defined as a work
├── Volume II     ← defined as a work
└── Volume III    ← defined as a work
```

Keep shared material at the project level: a global Research folder, common references, a Notebook or series notes. Give each volume a workspace Research folder when it needs local documentation. Open or export **Volume II** and Feuillets composes only that volume; open the main project when you need the whole series structure.

The same arrangement also works for a collected edition, a course with independent modules, or several articles managed in one vault folder.
