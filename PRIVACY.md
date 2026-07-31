# Privacy

Feuillets makes no network requests on its own initiative, and collects no
data of any kind. The only network activity that can ever happen is two
explicit, user-triggered actions described below — never automatic, never
in the background, never on load.

## What Feuillets collects

**Nothing.** No analytics, no telemetry, no crash reporting, no usage
statistics, no identifiers.

## Network activity — none

Feuillets makes no network request of its own. It contacts no server, loads
no remote script, font, or image, and sends your text nowhere.

Up to 1.4.4 there were two exceptions: downloading the local grammar engines,
and submitting text to LanguageTool if you selected it. Both are gone in
1.4.5 — grammar checking was removed from Feuillets entirely (see
`README.md`). Nothing replaced them: the plugin now works fully offline
from the moment it is installed.

For spelling and grammar, install a dedicated plugin from Obsidian's
Community Plugins browser. Those plugins have their own privacy policies;
Feuillets neither configures them nor reads their data.

Nothing in Feuillets makes a network call. `WebSocket`, `fetch` and
`requestUrl` appear nowhere in the source.

## Where your data lives

- **Your manuscript** (scenes, folders, frontmatter) stays exactly where you
  put it: as plain Markdown files in your own Obsidian vault, managed only
  through Obsidian's standard vault APIs.
- **Plugin settings** (word-count goals, board layout, typography
  preferences, etc.) are stored locally by Obsidian in this plugin's own
  `data.json`, inside your vault's `.obsidian/plugins/feuillets/` folder —
  never synced or transmitted anywhere by the plugin itself. If you use
  Obsidian Sync, iCloud, or another vault-sync service, that service handles
  the file the same way it handles any other vault file; the plugin has no
  part in that.
- **Grammar-check "learned words" and "ignored issues"** are stored
  separately, in `resources/grammar-user-data.json` inside the plugin
  folder — same locality guarantees as `data.json`, just kept out of it so
  a long list doesn't bloat the settings file.
- **Exported files** (`.docx`/`.epub`/`.pdf`, built natively in pure
  JavaScript by default — see `SECURITY.md`) are written to your vault (or
  its configured output folder) on your own machine. If you opt into the
  Pandoc export engine instead, Pandoc itself runs locally; nothing is
  uploaded either way.

## Third parties

Two, both described above and both opt-in/explicit: GitHub (release-asset
hosting for the local grammar engines) and LanguageTool (only if you select
it as your proofreading engine). Feuillets integrates with no other
third-party service, API, or SDK.

## Changes to this document

If a future version of Feuillets changes its network or data-collection
behavior, this file will be updated first, and the change will be called
out explicitly in the release notes.
