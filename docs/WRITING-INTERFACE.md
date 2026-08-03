# Creating a clean writing interface

> **English** · [Français](SETUP-INTERFACE.md)

Feuillets can give Obsidian the calm look of a dedicated writing application without imposing a theme or locking down the user's choices.

## 1. Start with the suggested values

Open:

> **Settings → Feuillets → Interface**

In the **Clean interface** section, the **Suggested values** button applies a consistent starting point.

These values remain editable. The button does not create a locked mode and does not block any setting.

It can notably act on:

- the display of properties in the editor;
- the built-in draft page title;
- the tab title bar;
- the icon ribbon;
- the vault switcher;
- panel transparency;
- tab bar transparency;
- the discreetness of action icons;
- the look of inactive side tabs.

<!-- CAPTURE settings
Show the Interface tab and the Suggested values button.
Caption: "One click to find a calm workshop again."
-->

## 2. Adjust the writing comfort

The Interface section also lets you choose:

- text size;
- Feuillets interface scale;
- line spacing;
- column width;
- main font;
- monospaced font;
- accent colour.

The literary presentation applies to the manuscript. Outside notes keep a more documentary look.

## 3. Distinguish the Writing view and Focus mode

### Writing view

It shapes the page:

- discreet syntax;
- paragraph indents;
- paragraphs;
- width;
- typography.

### Focus mode

It reduces the environment:

- hidden panels;
- recentred text;
- active line kept in the centre;
- dimmed text outside attention;
- floating word counter.

The two features are complementary.

## 4. Optionally choose a background or a theme

Feuillets does not replace Obsidian's complete theme.

A custom background colour depends on the theme or a CSS snippet. This separation is deliberate: Feuillets adjusts its own workspace but does not change the overall look of other plugins.

Example of a warm background:

```css
.theme-light {
  --background-primary: #f3eee0;
  --background-primary-alt: #f3eee0;
  --background-secondary: #ece4d0;
  --background-secondary-alt: #ece4d0;
}
```

Place this snippet in `.obsidian/snippets/`, then enable it in:

> **Settings → Appearance → CSS snippets**

## 5. Optional plugins and themes

Nothing else is needed to get a clean interface.

Themes or plugins such as Minimal, Style Settings or Hider can be added for deeper customisation, but Feuillets does not require them.

## 6. Carry your workspace to another vault

Feuillets settings can be exported and then re-imported from the command palette.

Any CSS snippet must be copied separately into the new vault.