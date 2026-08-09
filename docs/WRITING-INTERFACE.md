# Build a calm writing interface

> [Français](SETUP-INTERFACE.md) · **English** · [Documentation index](README.md)

Feuillets can make Obsidian feel much calmer for long-form writing without imposing a theme or rewriting the rest of the vault.

![Focus Mode](feuillets-concentration.png)

## Three different layers

**Editor:** Obsidian's native Markdown editor with Feuillets manuscript presentation.

**Workspace:** Binder, Inspector and Feuillets commands around the text.

**Focus Mode:** a temporary reduction of the surrounding interface.

Keeping these layers separate makes the workspace easier to tune.

## Interface settings

Open **Settings → Feuillets → Interface** to adjust font, size, line height, text width, accent, panel transparency and visibility of selected Obsidian UI elements.

Suggested values are only a starting point.

## Keep the Binder as quiet as you want

Optional row information includes label stripes, tags, status, progress, word count and a configurable text preview. Leave them hidden if names and hierarchy are enough.

## Modular Inspector

The Inspector has Notes, Research, Journal, Edition, Analysis and Proofreading tabs. Hide tabs you do not use; the Binder remains independent.

## Focus Mode

Focus Mode can hide panels, recenter the writing column, use a dedicated width, keep the active area in a typewriter position, dim surrounding text and display a discreet counter.

It never changes the file contents.

## Write and read side by side

![Writing and Preview](feuillets-concentration-apercu.png)

Preview can remain next to the editor so that the composed text is visible without turning the editor into a page-layout application.

## Themes and CSS snippets

Feuillets does not replace the full Obsidian theme. Use a theme or CSS snippet when you want to change the vault-wide background.

```css
.theme-light {
  --background-primary: #f3eee0;
  --background-primary-alt: #f3eee0;
  --background-secondary: #ece4d0;
}
```

Place snippets in `.obsidian/snippets/` and enable them from Obsidian Appearance settings.

## Optional companions

Advanced Canvas, Feuillets-Grammalecte and Courrier are optional. None is required for the core writing workflow.

## Moving settings between vaults

Use Feuillets settings export/import for plugin settings. CSS snippets remain separate Obsidian files.
