# One project, multiple workspaces

> English · [Français](ESPACES-DE-TRAVAIL.md) · [Index](README.md)

Feuillets lets you work on a manuscript folder as a coherent context without creating a separate project. Real Markdown files and Obsidian folders remain the source of truth.

For example:

```text
Novel project
├── Shared Research
├── Volume I
├── Volume II
└── Volume III
```

You can isolate **Volume II** and work in its context while remaining in the same project. This model is not limited to novels or series:

- a non-fiction book can be organized into parts;
- a yearly course can contain chapters and lessons;
- a collection or document set can group several coherent folders.

## Isolating a folder

**Isolate this folder** temporarily narrows the working scope to one manuscript branch.

It does not move any file, change the project folder or create a second project. The active workspace is a working scope inside the main project. You can return to the parent folder or the full project at any time.

Keep these two ideas separate:

- **project scope** means the whole manuscript;
- **active working scope** means the folder currently isolated.

## One scope shared by the tools

When a folder is isolated, several Feuillets surfaces can follow the same scope:

- Binder;
- Board;
- Board, in its Cards, Outline, Arcs and Timeline modes;
- Research;
- the folder’s Notebook when one exists.

**One structure, several representations.** The same real folder can therefore be browsed in Binder, viewed in Board or consulted in Research without creating copies.

Continuous mode, Preview and export may keep their own explicit scope choice when an operation provides a scope selector. The workspace working scope must therefore be distinguished from the scope selected for a particular operation.

## Local settings and inheritance

For settings that support local overrides, the effective value follows this chain:

```text
exact folder → parent folder → project → global setting
```

A folder stores only the differences it actually needs to override. For example, the project can define a general goal, workflow and usual typography. **Volume II** can override only its goal and workflow. A child chapter then inherits from Volume II until it has its own value.

Not every Feuillets setting is necessarily locally overridable. The interface exposes the supported settings and lets you return to the inherited value without copying the parent’s settings.

## Project Research and Workspace Research

The conceptual model is:

```text
Project = shared documentation
Workspace = documentation relevant to the isolated folder
```

A workspace can use:

- a Research folder linked directly to the folder;
- Research inherited from a parent folder;
- otherwise, Project Research according to the relevant mechanism.

Inheritance flows down from ancestors and never crosses to a sibling folder. Matching category names in Project and Workspace do not mean that physical folders are merged.

```text
Project
├── Shared Research
│   └── Characters
├── Volume I
│   └── Volume I Research
└── Volume II
    └── Volume II Research
```

When Volume I is active, the Research selector lets you consult Project for Shared Research or Workspace for Volume I Research. These two views remain distinct. Volume II Research is not part of the active context.

## Associations on a sheet

A Binder folder can have linked Research that participates in the context of its descendants through inheritance. A sheet can also have a direct documentary association.

A direct association carried by a sheet remains attached to that sheet. It does not automatically become an inherited rule for a whole branch or for sibling sheets.

## Split view and the Workspaces group

In Binder split view, the layers are shown separately:

```text
Research
  Project documentation

Workspaces
  Chapter 1 Research
  Lesson 2 Research

Vault
```

**Research** represents the project documentation layer. **Workspaces** groups Research roots explicitly linked to Binder folders.

**Workspaces** is a virtual navigation representation. It does not create a physical folder, move or copy files, or merge these folders with Project Research.

If a workspace Research folder is physically under the project Research root, it can still be shown in the Workspaces group when the interface recognizes it as a folder’s workspace Research. A documentary association carried only by a sheet does not make that folder a workspace root.

## Timeline

In the full project, the global project Timeline remains available.

In an isolated workspace, the Timeline keeps that global base and can add Timeline information from the workspace’s effective Research when it comes from an exact or inherited folder. Relevant direct documentary associations on sheets in the workspace may also be considered.

Sibling workspaces are not aggregated into the active context.

## Notebook

A folder can have its own Notebook:

- the global Notebook supports reflection at project scale;
- a folder Notebook supports reflection on one part of the project.

This still does not create a second manuscript. When Research is explicitly linked to the folder and Feuillets can determine the relationship unambiguously, the two entry points may share the same logical Notebook.

See [Notebook — from ideas to manuscript](HOW-TO-NOTEBOOK.md).

## Why this model

A large project can remain one project without forcing the writer to keep its full complexity visible at all times.

**The project provides continuity; the workspace provides context.**
