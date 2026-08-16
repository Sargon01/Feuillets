# Privacy

Feuillets is designed as a local writing plugin for Obsidian.

## What Feuillets collects

**Nothing.** Feuillets contains no analytics, telemetry, advertising identifier, crash-reporting service, account system or usage tracking.

## Manuscript data

Your manuscript remains in your vault as ordinary files and folders. Feuillets may create local auxiliary project material under `_Feuillets` (Research, Resources, Edition, Journal, Snapshots, Backups, Output) and continues to recognize historical locations when they already exist.

Working annotations and collaborative-review session data are local Feuillets working data; working annotations are not written into manuscript Markdown.

## Network behavior

Feuillets does not require a network service to write, analyze structurally, compile or export. It does not upload manuscript text to a Feuillets server.

## Collaborative review

A collaborative review is exchanged through a `.feuillets` package only when a user explicitly creates/sends/imports that file. Feuillets does not transmit it automatically. The package is scoped to the review rather than the whole vault. Any email, cloud drive or messaging service used to transfer that file is separate from Feuillets and follows its own privacy policy.

## Vault and linked-folder navigation

Binder split view can display a lightweight read-only Vault tree, and Research can display explicitly linked vault folders. These navigation features do not upload files, add them to the manuscript, or grant Feuillets ownership of external documentary folders.

## Imports and exports

Scrivener and reviewed-DOCX imports operate on material explicitly selected by the user. Exports are generated locally. PDF uses the local system print flow on desktop.

## YAML mapping

Property mapping is stored in project/plugin settings and is used locally when reading/writing frontmatter. Changing a mapping does not upload or bulk-migrate manuscript data.

## Companion plugins

A separately installed companion plugin may register a text-analysis provider. Its data/network behavior belongs to that plugin, not to Feuillets core.
