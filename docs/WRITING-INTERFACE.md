# Build a calm writing interface

> [Français](SETUP-INTERFACE.md) · **English** · [Documentation index](README.md)

Feuillets can make Obsidian feel calmer for writing without imposing a theme or locking the project inside a proprietary interface.

![Focus Mode](feuillets-concentration.png)

## Three different layers

### Editor

The text remains in Obsidian’s native Markdown editor. Feuillets can apply manuscript presentation such as text width, typography, paragraph indents, line height and typing helpers.

### Workspace

Around the text, Feuillets adds specialized surfaces: **Binder**, **Cards/Outline**, **Continuous**, **Preview**, the right panel and **Edition**.

### Focus Mode

**Focus Mode** temporarily reduces the surrounding interface without changing the file.

## The Binder

The 2.5 Binder can stay very quiet. Single view gives the manuscript navigation the full width. **Split view** only adds a navigator on the left:

- **Manuscript** for reading folder hierarchy at a glance;
- **Vault** for consulting other vault documents without leaving Feuillets.

The right pane remains the same Binder. Vault navigation is deliberately read-only and does not replace Obsidian’s full File Explorer.

See [Binder and navigation](BINDER-AND-NAVIGATION.md).

## The right panel

Feuillets has five public right-panel tabs:

- **Sheet** — synopsis/summary, working notes, properties, annotations, footnotes and Context;
- **Research** — documentation, Sources/Bibliography and linked folders;
- **Journal** — writing journal and tracking;
- **Project** — project-specific information and settings;
- **Proofreading** — text analysis, collaborative review, DOCX Review and comparison.

**Edition** is no longer a sidebar tab. It is a central workspace for **Composition** and **Layout**.

## Write across several sheets

**Continuous** removes the need to open dozens of tabs for a chapter or manuscript. Several sheets appear in one editor while remaining separate Markdown files.

## Write and read side by side

![Writing and Preview](feuillets-concentration-apercu.png)

**Preview** can remain next to the text for paginated reading. A Vault document or an external linked Research note can also open **side by side** without becoming part of the manuscript.

## Interface settings

Feuillets settings can adjust manuscript presentation, text width and selected interface elements. Suggested values remain a starting point, never a lock.

## Focus Mode

Focus Mode can reduce panels, recenter the writing column, use a dedicated width, keep the active area stable and dim surrounding text. None of these effects are written to Markdown.

## Themes and CSS snippets

Feuillets does not replace the full Obsidian theme. Use an Obsidian theme or CSS snippet when you want to change the vault-wide background or other appearance variables.

```css
.theme-light {
  --background-primary: #f3eee0;
  --background-primary-alt: #f3eee0;
  --background-secondary: #ece4d0;
}
```

## Optional companions

No additional plugin is required for the Feuillets core workflow.

- **Advanced Canvas** can enrich Notebook;
- **Feuillets-Grammalecte** can provide French linguistic analysis;
- **Courrier** can complement editorial submission tracking.

## General principle

The best Feuillets interface is not the one that displays every tool at once. Text stays central; specialized surfaces appear when their role becomes useful.
