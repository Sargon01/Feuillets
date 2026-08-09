# Privacy

Feuillets is designed as a local writing plugin for Obsidian.

## What Feuillets collects

**Nothing.**

Feuillets contains no:

- analytics;
- telemetry;
- advertising identifiers;
- crash-reporting service;
- account system;
- usage tracking.

The core plugin does not require a Feuillets server or a Feuillets account.

## Manuscript data

Your manuscript remains in your Obsidian vault as ordinary files and folders.

Depending on the features you use, Feuillets may create local project material such as:

- `_Recherche` / `_Research`;
- `_Ressources` / `_Resources`;
- `_Snapshots`;
- `_Versions`;
- `_Backups`;
- `_Edition`;
- `_Journal`;
- `_Sortie`.

These are local vault files. They are not uploaded by Feuillets.

A project can also be an existing folder used as-is. Opening such a folder does not move or rename its existing files.

## Plugin settings

Feuillets settings are stored through Obsidian's plugin data mechanism, locally in the vault configuration.

If you use Obsidian Sync, iCloud, Dropbox, Git, a filesystem backup or another synchronization service, that service may copy vault files according to **its** configuration and privacy policy. Feuillets does not control those services.

## Network behavior

Feuillets does not need a network service to read, write, analyze structurally, compile or export the manuscript.

The core plugin does not send manuscript text to a remote proofreading service and does not download a grammar engine.

Ordinary links displayed in documentation or interface text may of course open a website when **you explicitly click them**. That is different from background manuscript transmission.

## Imports and exports

Scrivener import and reviewed-DOCX workflows operate on files selected by the user.

Exports are generated locally. DOCX, EPUB and ODT are built locally from bundled JavaScript libraries; PDF uses the local system print flow on desktop.

Generated output stays in the vault/project output location unless the user later moves, shares or synchronizes it.

## Backups

Project backups are local ZIP files.

For a structured project, the backup may cover the project folder containing `Manuscrit` and its companion folders. For a folder used as-is, backup scope is restricted to that folder and does not implicitly include sibling folders or the whole vault.

## Companion plugins

Feuillets exposes a local API through which another installed Obsidian plugin can register a text-analysis provider.

For example, Feuillets-Grammalecte can provide linguistic analysis while Feuillets displays the results.

A companion plugin is separate software. Its own data and network behavior are governed by that plugin's implementation and privacy documentation. Installing Feuillets alone does not install or activate such a provider.

## Third-party libraries

The libraries bundled in Feuillets are used locally for document generation, ZIP handling and text comparison. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Changes

If Feuillets ever introduces telemetry, a required network service, remote manuscript processing, or another material change to this model, this document and the security documentation must be updated in the same release.
