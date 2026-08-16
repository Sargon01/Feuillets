# Security Policy

## Scope

Feuillets is an Obsidian plugin for writing projects stored in the user's vault. Core responsibilities require legitimate read/write access to project files: creating sheets/folders, updating metadata, importing explicitly selected material, generating exports, snapshots/backups, and reintegrating review returns.

## Trust model

### No telemetry or remote manuscript service

Feuillets requires no account or Feuillets server and does not upload manuscript text to a remote analysis service.

### No downloaded executable code or shell conversion

The plugin does not download executable code at runtime. Native DOCX, EPUB and ODT export is local JavaScript; PDF uses the desktop system print flow. Feuillets does not invoke Pandoc or a shell converter.

### User-selected external imports

Scrivener and reviewed-DOCX imports are explicit user actions. Desktop Scrivener import may access the selected project package/files because that is the material the user requested to import; Feuillets does not scan arbitrary external filesystem locations in the background.

### Collaborative review packages

Collaborative review is transported through `.feuillets` packages explicitly created, sent and imported by users. A package contains the review scope and session material needed for that exchange, not an automatic copy of the user's whole vault.

### Vault writes and read-only navigation

Normal project writes use Obsidian vault/file APIs. Canonical auxiliary content lives under `_Feuillets` when created. Historical locations remain recognized for compatibility.

Binder split view may browse the vault through a lightweight navigation tree. That surface deliberately exposes opening/navigation rather than create/rename/delete/move operations. External Research folders linked from the Binder are likewise shown as navigation-only sources when they live outside the managed Research space.

### YAML mapping

Project YAML property mapping changes how Feuillets reads/writes logical fields but does not automatically migrate or rename all frontmatter when a mapping changes.

## Backups

Backup scope remains constrained: an as-is project stays inside that folder; a structured `Manuscrit` project may use the surrounding project root. The backup destination is excluded from its own ZIP.

## Output replacement

Export output handles existing files through Obsidian APIs and resolves case-only filename collisions (important on case-insensitive filesystems such as common macOS configurations) rather than creating a competing path.

## Companion analyzers

Optional companion plugins can register text-analysis providers. Their own privacy/security behavior must be evaluated separately from Feuillets core.

## Continuous checks

```bash
npm test
npm run build
npm run lint
npm run lint:obsidian
```

## Reporting

Use GitHub's private security-advisory flow when possible and avoid publishing exploit details in a normal public issue.
