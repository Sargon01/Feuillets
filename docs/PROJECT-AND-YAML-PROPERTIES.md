# Project and YAML properties

> [Français](PROJET-ET-PROPRIETES-YAML.md) · **English** · [Documentation index](README.md)

**Manage projects…** configures the active project and can adapt its logical fields to YAML properties already used in an existing vault.

## Project-scoped settings

**Manage projects…** includes goals, statuses, labels, favorite tags, project information and YAML property mapping.

These settings belong to project management, not to a public **Project** tab in the Feuillets panel. Fiction, Non-fiction and Free are creation presets: they provide initial values but do not block runtime capabilities.

If a project does not define an override, Feuillets falls back to the historical global setting. Simply reading a project does not copy global defaults into project metadata.

## YAML mapping

Mappable logical fields are:

- synopsis;
- long summary;
- status;
- POV;
- label;
- goal;
- narrative thread;
- characters;
- date.

For example, a vault that already uses `State` can map **Status → State**.

## What is not mappable

Mapping only applies to the editorial metadata listed above. Structural/technical fields such as Binder order, compilation inclusion, file type, title, `short_title` and tags keep their own contracts.

This prevents a property mapping from silently changing project structure or repurposing a field with another meaning.

## Read priority

An explicit project mapping wins. Without one, Feuillets still recognizes the canonical property and safe historical aliases. It does not use fuzzy guessing that could silently pick the wrong property. A case variant is only used when it is unique; ambiguous configurations must be resolved explicitly rather than guessed.

## Non-destructive writes

Feuillets writes to the mapped or canonical property through Obsidian's frontmatter APIs. Changing the mapping **does not rename or migrate existing properties automatically**. Removing a mapping simply returns to canonical/historical resolution; it does not trigger a reverse migration.

## Scope

Mappings belong to the active project and are not meant to leak onto unrelated files from another project in the same vault.
