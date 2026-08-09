# Import a Scrivener project

> [Français](IMPORT-SCRIVENER.md) · **English** · [Documentation index](README.md)

Feuillets can convert a Scrivener project into Markdown files and folders inside the Obsidian vault.

![Scrivener import](feuillets-import-scrivener.png)

## Before importing

Work from a copy if you want to preserve an untouched Scrivener original. Feuillets reads the selected project material and creates vault content; it does not modify Scrivener itself.

## Input

The importer understands a `.scriv` project structure and compatible archives containing the `.scrivx` file and project data.

## What it attempts to preserve

When available and compatible:

- Binder/Draft hierarchy;
- titles;
- text;
- order;
- compatible statuses;
- useful synopsis/metadata;
- supported Scrivener comments;
- Research folders;
- images, PDFs and other classified assets;
- other convertible metadata.

RTF manuscript text is converted to Markdown.

## What changes

Scrivener stores a project in its own bundle. Feuillets produces ordinary readable vault files and folders.

The goal is a **working migration**, not a binary clone:

> usable structure + readable text + useful metadata + recoverable assets.

## Workflow

1. Open Scrivener import.
2. Select the project or archive.
3. Review the import preview/summary.
4. Choose the target options.
5. Run the import.
6. Read the final report.

## After importing

Check hierarchy, titles, opening/ending paragraphs, Unicode text, lists/emphasis, important comments, expected images/PDFs, Research categories and the statuses/fields you actually use.

Keep the original Scrivener project until you have worked in Feuillets and exported a control document successfully.

## Limits

Some Scrivener-specific concepts have no meaningful Markdown/Obsidian equivalent. They may be simplified, converted to text or reported rather than imitated artificially.

Continue with [Discover Feuillets](DISCOVER.md), [Author workflow](AUTHOR-WORKFLOW.md) and [Replacing Scrivener with Feuillets](Remplacer-Scrivener-par-Feuillets.md).
