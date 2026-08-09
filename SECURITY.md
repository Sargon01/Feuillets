# Security Policy

## Scope

Feuillets is an Obsidian plugin that works with writing projects stored in the user's vault.

Its core responsibilities require legitimate read/write access to project files: creating sheets and folders, updating metadata, importing user-selected material, producing exports, snapshots and backups, and reintegrating reviewed documents.

This document describes the current security model so that users and reviewers can distinguish expected filesystem activity from unexpected behavior.

## Current trust model

### No telemetry or remote manuscript service

Feuillets does not require a Feuillets account or server and does not upload manuscript text to a remote analysis service.

The core plugin contains no bundled grammar engine. Linguistic analysis can be provided by a separately installed companion plugin through the public provider API.

### No downloaded executable code

Feuillets does not download code and execute it at runtime.

The production plugin is built from the TypeScript source in this repository and bundled as an unminified `main.js` so that the generated code remains inspectable.

### No Pandoc or shell execution

The current native export pipeline does not require Pandoc and does not invoke a shell command or external conversion executable.

DOCX, EPUB and ODT generation is performed locally by JavaScript code/libraries. PDF export uses the system print dialog on desktop.

### User-selected imports

Scrivener and reviewed-DOCX imports are explicit user actions.

Feuillets does not scan arbitrary external filesystem locations in the background. Imported material is processed because the user chose the source and initiated the operation.

### Vault writes

Normal writing-project operations use Obsidian's vault/file APIs.

Technical project folders can include `_Recherche`, `_Ressources`, `_Snapshots`, `_Versions`, `_Backups`, `_Edition`, `_Journal` and `_Sortie`.

The backup/output code distinguishes a structured `Manuscrit` project from a folder used as-is so it does not blindly climb to a parent folder.

## Backups

Backup scope is deliberately constrained.

- If the active manuscript folder is actually named `Manuscrit` and has a real project parent, the project parent is the backup source.
- Otherwise the active project folder itself is the backup source.
- The vault root is never selected implicitly by this rule.
- `_Backups` is excluded from its own ZIP archive.

This prevents an as-is project folder from accidentally pulling sibling folders into a backup.

## PDF printing

PDF export is desktop-only.

Feuillets builds an isolated print document and hands it to the browser/system print flow. The plugin does not need a separate PDF conversion service.

HTML fragments generated for the print document are handled in an isolated document/DOM pipeline rather than used as arbitrary live application markup.

## Text-analysis providers

`src/api/text-analysis.ts` defines the provider contract used by optional companion plugins.

Feuillets validates:

- that a provider has the required runtime shape;
- that issue offsets are integers;
- that ranges are ordered and stay inside the supplied text.

A companion plugin is third-party code installed separately. Its own security and privacy behavior must be evaluated separately from Feuillets core.

## Dependencies

Runtime dependencies are intentionally limited. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The project also runs automated dependency/security checks through its normal development and release process.

## Continuous checks

The repository provides:

```bash
npm test
npm run build
npm run lint
npm run lint:obsidian
```

The Obsidian-specific lint uses the review rules intended for community-plugin source checks.

## Supported versions

The plugin manifest currently requires **Obsidian 1.13.0 or newer**.

Only the latest published Feuillets release is supported for security fixes. Please update before reporting a vulnerability against an older build.

## Reporting a vulnerability

Please avoid publishing exploit details in a normal public issue.

Use the repository's **Security → Report a vulnerability** / private security-advisory flow when available.

Include:

- affected Feuillets version;
- affected Obsidian version/platform;
- minimal reproduction;
- files or feature involved;
- expected impact.

If private reporting is not available in your GitHub interface, open a minimal issue asking for a private contact channel **without including sensitive exploit details**.
