# Privacy

Feuillets makes no network requests on its own initiative, and collects no
data of any kind. The only network activity that can ever happen is two
explicit, user-triggered actions described below — never automatic, never
in the background, never on load.

## What Feuillets collects

**Nothing.** No analytics, no telemetry, no crash reporting, no usage
statistics, no identifiers.

## Network activity — the only two cases, both opt-in

- **Downloading a local grammar engine's resource files.** Feuillets'
  French (Grammalecte) and English (Harper) proofreading engines run
  entirely on your machine and never transmit your text anywhere — but
  their dictionaries/binaries (~9MB / ~17MB) aren't bundled in the plugin
  itself (Obsidian's installer only ever fetches three files from a
  release, so shipping them here wouldn't reach anyone). A labeled button
  per language in Settings → Feuillets → Panneaux latéraux downloads them,
  once, from [`Sargon01/feuillets-assets`](https://github.com/Sargon01/feuillets-assets)
  — a public repository that hosts only these two archives, no code — via
  Obsidian's own `requestUrl` API, then caches them on disk. Nothing is
  fetched unless you click that button.
- **LanguageTool, if you explicitly select it.** The grammar-check engine
  setting defaults to the local engines above. If you deliberately switch it
  to LanguageTool (or it's used as an automatic fallback on mobile, where
  the local engines can't run), the text of the scene you check is sent to
  whichever LanguageTool endpoint you've configured — the public
  `api.languagetool.org` by default, or a self-hosted server if you set one.
  This only happens when a grammar check runs with that engine active.

Nothing else in Feuillets makes a network call. `WebSocket` appears nowhere
in the source; `fetch`/`requestUrl` appear only in the two code paths above.

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
