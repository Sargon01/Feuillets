# Security Policy

## Scope and threat model

Feuillets is a local, offline Obsidian plugin. This document summarizes what
it can and cannot do, so both users and reviewers can assess its risk
surface without reading the whole codebase.

### What the plugin never does
- No network requests of any kind (no `fetch`, `XMLHttpRequest`,
  `requestUrl`, WebSockets, or remote resource loading — CSS/fonts/images are
  all bundled or theme-provided, none fetched at runtime).
- No telemetry, analytics, crash reporting, or usage tracking.
- No `eval`, `new Function`, or dynamic code loading.
- No credentials, API keys, or tokens are stored, requested, or transmitted
  (there is nothing to authenticate against).
- No custom auto-update mechanism — updates are handled by Obsidian itself.

### What the plugin does that touches the system, and why
- **Pandoc export (desktop only, user-triggered).** `.docx`/`.epub` export
  invokes a locally installed `pandoc` binary via
  `child_process.execFile(path, args, ...)`. `execFile` is used deliberately
  instead of `exec`/shell string interpolation: arguments are passed as an
  array and never go through a shell, which rules out shell-metacharacter
  injection from any of the arguments (title, author, file paths). The
  binary path itself is a plain-text setting (default `"pandoc"`, resolved
  via the OS `PATH`), configurable by the vault owner only — it is never
  read from a file, a remote source, or vault content.
- **Direct filesystem read/write (desktop only, export path only).** Needed
  because Pandoc runs as an external process and reads/writes real files on
  disk; Obsidian's vault adapter alone cannot hand a file to an external
  process. The temporary compiled manuscript is written through Obsidian's
  own `vault.adapter.write`/`remove` (inside the vault, cleaned up
  immediately after conversion). The optional "Pandoc reference document"
  setting is resolved and checked against the vault's base path; any
  resolution that would escape the vault (e.g. `../../..`) is rejected with
  a user-facing notice instead of being followed silently.
- Everything else in the plugin uses only Obsidian's public APIs
  (`app.vault`, `app.metadataCache`, `app.fileManager`, `app.workspace`) —
  grep-auditable, no other filesystem or process access exists in the
  codebase.

### Mobile
`isDesktopOnly` is `false`: the plugin is usable on mobile for writing,
organizing, and Markdown compilation. The Pandoc-dependent export commands
detect `Platform.isMobile` and show an explicit notice instead of failing
silently; no Node-only API is touched on the code path mobile devices take.

## Supported versions

Only the latest published release is supported. Please update before
reporting an issue.

## Reporting a vulnerability

If you believe you've found a security issue in Feuillets:

1. **Do not open a public GitHub issue for it.**
2. Report it privately via GitHub's ["Report a vulnerability"](<REPO_URL>/security/advisories/new)
   flow on this repository, or email the maintainer at `<MAINTAINER_EMAIL>`.
3. Please include: affected version, a minimal reproduction, and the
   potential impact as you understand it.

You should get an initial response within 7 days. Once a fix is available,
it will be released and disclosed here with credit to the reporter (unless
you prefer to stay anonymous).
