# Research and linked folders

> [Français](RECHERCHE-ET-DOSSIERS-ASSOCIES.md) · **English** · [Documentation index](README.md)

**Research** gathers documentation useful to the manuscript without requiring an encyclopedia-like structure. It can use Feuillets’ usual Research folders, recognized legacy locations, and existing folders elsewhere in the vault.

## Research root

New projects use the canonical `_Feuillets/Recherche` auxiliary space when a Research root needs to be created. Recognized historical forms remain usable when they already exist; Feuillets does not rename them automatically.

## Linking an existing folder

From the Binder, a folder or sheet can be linked to **any existing vault folder**. The linked folder:

- stays in its original location;
- is not copied or renamed;
- may live outside the active project;
- appears in the Research panel under linked folders.

A folder linked to several Binder nodes does not need to be duplicated in the interface.

## External linked folders: reading and navigation

A linked folder outside the project’s managed Research space is treated as an external documentary source. Feuillets can display its tree and files, but does not take over its administration.

For a linked Markdown file, navigation actions include:

- **Open in new tab**;
- **Open side by side**.

Structural write actions remain unavailable from this entry point: Feuillets does not rename, duplicate, trash or drag these external files.

## Internal Research folders

Folders actually managed inside the project’s Research space keep their normal tools for creation, organization, rename, duplicate, trash and move where the operation is allowed.

This distinction prevents a simple link from turning an existing documentary folder into a Feuillets-managed folder.

## Project and Workspace

Without an isolated workspace, Research keeps its **Project** behavior and shows the project’s shared documentation.

When a folder is isolated, the **Workspace** scope can be consulted separately from the Project scope. It uses the active folder’s effective Research:

- a direct folder association;
- otherwise an association inherited from an ancestor;
- if no valid local or inherited Research folder exists, Project Research is the fallback for the Workspace view.

Research from a sibling folder is never supplied to the current workspace. Inheritance follows ancestors and does not cross branches. Project and Workspace remain separate layers: two categories with the same name are not physically merged.

See [One project, multiple workspaces](WORKSPACES.md).

## Workspaces in split view

In Binder split view, **Research** represents the project’s shared layer and **Workspaces** groups Research roots explicitly linked to Binder folders.

**Workspaces** is a virtual navigation group. It does not create a physical folder, move or copy Research folders, or merge their contents with Project Research. A linked folder can therefore remain physically under the Research root while appearing in this group.

## Linked Research and Context

Links also feed **Context** in the Sheet panel. Documentation associated closely with a sheet or chapter can provide explicit references and content matches without forcing the material into `_Feuillets/Recherche`.

See [Context](HOW-TO-CONTEXT.md).

## Research and Vault in Binder split view

Binder split view also provides lightweight **Vault** navigation. The two mechanisms serve different purposes:

- **Linked Research** = documentation explicitly related to the manuscript and usable by contextual tools;
- **Vault** = free navigation for consulting any other vault document.

Browsing Vault never creates a Research link automatically.
