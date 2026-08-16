# Import a Scrivener project

> [Français](IMPORT-SCRIVENER.md) · **English** · [Documentation index](README.md)

Feuillets can import a Scrivener project and convert it into Markdown files and vault folders.

## What the importer tries to recover

When available and compatible:

- Binder/Draft hierarchy;
- titles and text;
- **exact Binder order**;
- representable synopsis/status metadata;
- supported comments;
- Research;
- supported images, PDFs and resources.

RTF text is converted to Markdown.

## Order

Feuillets 2.5 explicitly persists Scrivener source order in its ordering system. Vault natural/alphanumeric sorting therefore no longer replaces the imported Binder order.

## Target structure

Import aligns with the current canonical Feuillets structure and project resolvers rather than recreating historical paths. Existing legacy locations remain compatible when already present.

## Desktop import

Scrivener import is an explicit user action and requires access to the selected project files. Feuillets does not scan arbitrary external filesystem locations in the background.

## After import

Check several chapters/scenes, order, accented characters, resources, Research and the properties you actually use. Keep the original Scrivener project until the migration has been validated.
