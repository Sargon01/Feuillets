# Setting up a clean, distraction-free interface

Feuillets stays deliberately agnostic about theme and chrome — it doesn't
bundle a "simple/advanced mode" switch or force any particular look. If you
want a stripped-down, writing-focused interface, that's a combination of
Obsidian's own theme system plus a couple of community plugins, configured
once. This guide walks through the exact combination that works well
alongside Feuillets, as a starting point to adjust to your own taste — not
something Feuillets requires or configures for you.

## 1. Theme: Minimal

Settings → Appearance → Themes → Manage → search "Minimal" → install and
use. ([Repository](https://github.com/kepano/obsidian-minimal))

A few base Appearance settings worth setting alongside it:
- **Hide tab title bar** (`showViewHeader: false`) — one less row of chrome
  when a single pane is open.
- Pick a comfortable **base font size** and **font family** — the reference
  setup here uses `iA Writer Quattro` for text and `iA Writer Mono` for
  monospace, at 19px base.

## 2. Companion plugins

Install these three from Community Plugins (Browse):

- **[Style Settings](https://github.com/mgmeyers/obsidian-style-settings)**
  — the underlying engine Minimal (and Minimal Theme Settings) uses to
  expose its options as a settings UI instead of raw CSS variables.
- **[Minimal Theme Settings](https://github.com/kepano/obsidian-minimal-settings)**
  — the fine-grained controls for the Minimal theme itself (line width,
  colorful headings, status bar, etc.).
- **[Hider](https://github.com/kepano/obsidian-hider)** — hides specific
  interface elements outright (tooltips, the vault name in the sidebar,
  etc.) rather than just restyling them.

## 3. A reference starting configuration

These are the values from a working "épuré" (stripped-down) setup — open
each plugin's own settings tab to adjust them, not meant to be copied as a
file:

**Minimal Theme Settings**
| Setting | Value |
|---|---|
| Line width / wide | 40 / 50 |
| Max width | 90 |
| Normal / small text | 19 / 14 |
| Line height | 2 |
| Colorful headings / frame / active states | off |
| Underline internal links | off |
| Underline external links | on |
| Full-width media | on |
| Readable line length | on |
| Minimal status bar | on |
| Trim file names (sidebar) | on |

**Hider**
| Setting | Value |
|---|---|
| Hide tooltips | on |
| Hide vault name | on |
| Everything else | off (status bar, tabs, scrollbar, sidebar buttons, etc. left visible) |

## 4. Feuillets' own panel visibility

Separately from theme/chrome, Feuillets has its own setting for which ribbon
icons/panels show up at all: Settings → Feuillets → **hidden panels** — hide
the ones you don't use (e.g. Journal or Docx review) without touching any
of the above. This is the one piece of "épure" that actually lives inside
Feuillets itself.

## Carrying this setup to a new vault

Once configured, you can replicate this exact setup in another vault two
ways:
- **Manually**: repeat steps 1–4 above in the new vault.
- **By copying config files**: from the old vault's
  `.obsidian/` folder, copy `appearance.json`, the `themes/Minimal/` folder,
  and the `plugins/obsidian-hider/`, `plugins/obsidian-style-settings/`,
  `plugins/obsidian-minimal-settings/` folders (each includes its own
  `data.json`) into the new vault's `.obsidian/`, then enable those three
  plugins in Settings → Community plugins. For Feuillets' own settings, use
  its built-in **"Export settings"** / **"Import settings"** commands (see
  the main [README](./README.md#getting-started)) rather than copying
  `data.json` by hand.
