# Portable `.feuil` project — export and re-import a Feuillets project

> [Français](PROJET-PORTABLE-FEUIL.md) · **English** · [Documentation index](README.md)

A **`.feuil`** file is a portable Feuillets project archive. It is meant for moving, sharing or keeping a transportable state of a project without turning the manuscript into a proprietary working format.

After import, the project becomes an ordinary Obsidian folder again: text remains Markdown, folders remain real vault folders, and Feuillets restores the supported project settings.

## When to use a `.feuil`

Use a `.feuil` when you want to:

- transfer a project to another Obsidian vault or computer;
- keep a transportable copy of the project at a given point in time;
- send a complete Feuillets project to another Feuillets installation;
- move a project without losing supported manuscript order, folder settings or Research links.

A `.feuil` is not a day-to-day writing format, a synchronization service, or a replacement for regular backups.

## Export a project

1. Open **Manage projects**.
2. Find the project you want to export.
3. Use the project action **Export as `.feuil`**.
4. Feuillets builds the archive and starts a download using a filename derived from the project name.

Before building the archive, Feuillets tries to save any pending **Continuous** edits. If those writes cannot be secured, export stops instead of producing a potentially inconsistent archive.

## What the archive contains

The `.feuil` contains the tree located under the project's real root, except for Feuillets **Backups**. It therefore includes the project files and can also include auxiliary Feuillets data stored inside that root.

The archive manifest also keeps the information needed to rebuild the supported project state, including:

- project name and root kind;
- manuscript path inside the project;
- first-level structural role;
- supported project-scoped metadata;
- recorded folder and sheet order;
- recorded folder positions and goals;
- narrative-thread state used by the project;
- links between Binder nodes and Research folders.

### Linked Research outside the project

If a Binder node is explicitly linked to a Research folder located **outside the project root**, Feuillets also copies that Research folder into the archive.

This keeps the `.feuil` portable: it does not depend on the absolute path used by that Research folder in the source vault.

## What is not included

A `.feuil` is not intended to capture the entire Obsidian vault.

In particular, it does not include:

- Feuillets **Backups** for the project;
- vault files outside the project, except explicitly linked external Research folders;
- global Feuillets settings that are not project-scoped data for the exported project;
- Obsidian settings, themes or third-party plugins installed on the machine;
- files belonging to other projects in the same vault.

For recovery and local history, see [Rewriting, backups and versions](REWRITING-BACKUPS-AND-VERSIONS.md).

## Import a `.feuil`

1. Open **Manage projects**.
2. Choose **Import a `.feuil`**.
3. Select the `.feuil` archive.
4. Feuillets displays the detected project name.
5. Choose the **parent folder** where the project should be created.
6. Choose the **new folder name**.
7. Start the import.

Import always creates a **new project folder**. The destination path must not already exist: Feuillets does not merge a `.feuil` into an existing project and does not silently overwrite an existing vault folder.

When import completes, Feuillets restores the supported project settings, adds the project to the project list and opens it as the active project.

## What happens to external Research folders?

Research folders that were linked from outside the original project are recreated **inside the imported project**, under an area such as:

`_Feuillets/Recherche liée importée…`

Feuillets then remaps Binder links to those new copies.

Import therefore does not try to recreate the old absolute path from the source vault and does not modify a same-named folder elsewhere in the destination vault.

## Conflicts and interrupted imports

The workflow is intentionally conservative:

- no merge into an existing destination folder;
- no silent replacement of an existing destination file or folder;
- archive validation before project materialization;
- if an error occurs after the destination folder has been created, Feuillets attempts to remove the partially imported project so that an incomplete import is not left behind.

If automatic cleanup itself fails, Feuillets explicitly reports that the imported folder must be checked.

## `.feuil`, `.feuillets`, Backup or export?

| Tool | Main purpose | Full project? | Changes the manuscript working format? |
| --- | --- | ---: | ---: |
| **`.feuil`** | transport/re-import a Feuillets project | Yes, within the scope described above | No |
| **`.feuillets`** | Collaborative Review exchange | No | No |
| **Feuillets Backup** | local recovery after an incident | local safety copy | No |
| **Snapshot** | comparison point before rewriting | text/version state | No |
| **DOCX / PDF / EPUB / ODT / compiled Markdown** | publish, share or print a document | No | creates a separate output |

The important distinction is:

- **`.feuil` transports a project**;
- **`.feuillets` transports a review round**;
- **Backups and snapshots protect the work**;
- **exports produce a final or intermediate document**.

See also [Collaborative Review](COLLABORATIVE-REVIEW.md) and [Composition and export](COMPOSITION-AND-EXPORT.md).

## Portability and safety

The current `.feuil` format uses a versioned manifest and relative paths. Feuillets rejects absolute paths, directory traversal and several forms of non-portable names so that an archive cannot write outside its destination.

Current technical limits are:

- at most **20,000 entries**;
- at most **1 GiB** of decompressed data;
- a manifest of at most **1 MiB**.

An archive using an unsupported format or version is rejected rather than partially imported.

## Does `.feuil` lock the project into Feuillets?

Not for the project text.

A `.feuil` is a **transport container**. Once imported, the project again consists of ordinary files and folders in the Obsidian vault. Text remains readable and editable Markdown without `.feuil`.

Some Feuillets-specific information — recorded order, folder goals, Research links and other project metadata — does require Feuillets to be interpreted and restored.

## Good practices

- Use `.feuil` to transport a project, not as your only backup strategy.
- Keep Backups and snapshots according to your recovery and rewriting needs.
- After moving to another machine, check any Obsidian plugins or themes your vault depends on: they are not part of the `.feuil` archive.
- To share only a text for reading or editing, use **Composition** exports instead.
- For a Feuillets author/reviewer exchange, use **Collaborative Review `.feuillets`**.

For project-scoped settings, see [Project and YAML properties](PROJECT-AND-YAML-PROPERTIES.md).
