# Feuillets 3.0.0

> [Français](VERSION-3.0.0.md) · English · [Documentation index](README.md)

Feuillets 3.0 extends the same local Markdown model in two directions: a project can now scale from a quick draft to several independent works, and documentary writing can use contextual BibTeX resources without making Zotero or Pandoc runtime dependencies.

## Draft, article, book or series

- **New quick draft** creates an immediately editable Markdown sheet outside whole-project compilation until it is promoted into the Binder.
- A simple document template supports standalone texts and lightweight exports.
- Any Binder folder can remain an ordinary workspace or be defined as an independent **work**.
- A work has its own editorial boundary and can inherit or customize Composition.
- Several works inside one project can represent a trilogy, collection, course modules or independent articles while sharing project-level material.

## Reliable scopes and composition

- Folder, sheet, selection, work and full-project scopes now follow the same compilation model.
- Preview and export agree on nested chapter traversal and scene separators.
- Drafts are excluded from full-project compilation until promoted, while direct draft export remains available.
- Portable `.feuil` projects preserve nested works and their supported local composition settings.

## Contextual Research

- Research follows the active sheet’s physical ancestor branch within the current workspace boundary.
- Direct sheet associations and intermediate folder associations remain accessible.
- Sibling and outside branches do not leak into the active context.
- Research labels follow the active interface language.

## BibTeX workflow

- A workspace can select a `.bib` file and optional CSL style from its associated Research folder.
- Typing `[@` opens a searchable picker for citekey, author, title and year.
- The picker supports multiple references and page locators.
- Preview resolves citations without requiring Binder isolation.
- The Research panel lists cited BibTeX entries and occurrence counts, including unknown keys.
- Feuillets can generate a simple Markdown bibliography from cited BibTeX entries and existing Source cards.
- Native exports preserve Pandoc citekeys in the manuscript.

## Portable Pandoc package

The new **Pandoc package (.zip)** export includes compiled `manuscript.md`, portable `pandoc.yaml`, required bibliographies, the applicable CSL, local media and an issue report when needed. It checks duplicate citekeys across included bibliographies and does not write a partial package on conflict.

Feuillets does not install, locate or execute Pandoc, Zotero or Better BibTeX. The package is an optional bridge for a user-managed academic publishing workflow.

## Compatibility

Existing Markdown projects, ordinary project-as-manuscript use, native export formats and historical Research paths remain supported. No external executable or account is required for Feuillets’ native workflow.
