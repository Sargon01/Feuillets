# Setting up a clean, distraction-free interface

Most of what used to require a theme and a couple of community plugins is
now a built-in setting: Settings → Feuillets → **Interface** covers
properties/title/tab-bar visibility, the whole icon ribbon, the vault
switcher, panel and tab-bar transparency, dimming native action icons,
font/size/accent color, line height, and text width — all reading and
writing Obsidian's own native settings where one exists, nothing
duplicated or hidden behind a "mode" switch. The only piece Feuillets
still can't (and shouldn't) do itself is an actual background *color* and
a full theme — that stays external, on purpose (see below).

Note: a few "reveal on hover" variants (tab bar, ribbon, binder) were
tried and dropped — unreliable across window-chrome configurations
(overlap with macOS's own traffic-light buttons) and redundant with
Obsidian's own touch/swipe gestures for the binder. Not present in the
current build.

## 1. Feuillets' own Interface tab (start here)

Settings → Feuillets → **Interface**:

- **Apparence** — interface language, font size, Feuillets' own UI scale,
  line height, text width, base font size, text/monospace font family,
  accent color.
- **Mode concentration** — distraction-free writing mode, typewriter
  scrolling, floating word counter.
- **Interface épurée** — hide properties (YAML) in the editor, hide the
  sheet's inline title, hide the tab title bar, hide the whole ribbon, hide
  the vault switcher, transparent panel and tab-bar backgrounds, dim
  native tab-action icons and inactive side-panel tabs. A **"Valeurs
  suggérées"** button pre-fills all of these with a reasonable starting
  point — still editable afterwards, nothing gets locked or hidden by
  using it.

## 2. Background color: still a CSS snippet, on purpose

A warm/cream (or any custom) background isn't a discrete Obsidian setting
the way font size or accent color are — it comes from the active theme or
a CSS override of `--background-primary`/`--background-secondary`. Feuillets
deliberately doesn't touch this: doing so would mean re-skinning the whole
app, not just its own panels, which is exactly the line we didn't want to
cross (see `SECURITY.md`/`PRIVACY.md` — no theme management, no touching
other plugins' settings).

Drop a snippet like this in `.obsidian/snippets/` and enable it in
Settings → Appearance → CSS snippets — combine with "Interface épurée"'s
transparent-panels/transparent-tab-bar toggles above so Feuillets' own
panels blend into it automatically:

```css
.theme-light {
  --background-primary: #f3eee0;
  --background-primary-alt: #f3eee0;
  --background-secondary: #ece4d0;
  --background-secondary-alt: #ece4d0;
}
```

## 3. Optional extras Feuillets doesn't (and can't) provide

Nothing here is required anymore for a stripped-down look — install only
if you want something specific Feuillets' own Interface tab doesn't cover:

- **[Minimal](https://github.com/kepano/obsidian-minimal)** (theme) — a
  different visual base than Obsidian's default theme. Feuillets can't
  install a theme for you (no plugin API allows it); Settings → Feuillets →
  Interface → "Interface épurée" has a shortcut button that opens
  Obsidian's own Appearance tab to browse it.
- **[Hider](https://github.com/kepano/obsidian-hider)** /
  **[Style Settings](https://github.com/mgmeyers/obsidian-style-settings)** /
  **[Minimal Theme Settings](https://github.com/kepano/obsidian-minimal-settings)**
  — finer per-element hiding and Minimal-theme-specific tuning (colorful
  headings, sidebar trimming, etc.) beyond what Feuillets exposes. Same
  section has a shortcut button per plugin, opening Community Plugins with
  the search pre-filled — still not an automatic install, just a shortcut.

## Carrying this setup to a new vault

- **Feuillets' own settings** (everything in section 1): use its built-in
  **"Export settings"** / **"Import settings"** commands (see the main
  [README](./README.md#getting-started)) — they cover the Interface tab
  along with everything else.
- **The background snippet** (section 2, if used): copy the `.css` file
  from `.obsidian/snippets/` into the new vault and re-enable it in
  Appearance → CSS snippets.
- **Optional extras** (section 3, if installed): repeat the install, or
  copy `appearance.json`, `themes/Minimal/`, and the relevant
  `plugins/obsidian-*/` folders (each with its own `data.json`) from the
  old vault's `.obsidian/` into the new one, then enable them in Settings →
  Community plugins.
