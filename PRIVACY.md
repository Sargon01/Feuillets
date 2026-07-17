# Privacy

Feuillets does not require a privacy policy under Obsidian's Developer
Policies, because it makes no network requests and collects no data at all.
This document exists anyway, to state that plainly and explicitly.

## What Feuillets collects

**Nothing.** No analytics, no telemetry, no crash reporting, no usage
statistics, no identifiers, no network calls of any kind — verified by
`grep` across the entire source tree for `fetch`, `XMLHttpRequest`,
`requestUrl`, and `WebSocket`: zero matches.

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
- **Exported files** (`.docx`/`.epub` via Pandoc, see `SECURITY.md`) are
  written to your vault (or its configured output folder) on your own
  machine. Pandoc itself runs locally; nothing is uploaded.

## Third parties

None. Feuillets does not integrate with, or send data to, any third-party
service, API, or SDK.

## Changes to this document

If a future version of Feuillets ever adds network or data-collection
behavior, this file will be updated first, and the change will be called
out explicitly in the release notes.
