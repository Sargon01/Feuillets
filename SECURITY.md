# Security Policy

## Scope and threat model

Feuillets is a local, offline Obsidian plugin. This document summarizes what
it can and cannot do, so both users and reviewers can assess its risk
surface without reading the whole codebase.

### What the plugin never does
- No network requests outside two explicit, user-triggered actions (see
  below) — no telemetry beacon, no remote resource loading (CSS/fonts/images
  are all bundled or theme-provided), nothing fetched on load or in the
  background.
- No telemetry, analytics, crash reporting, or usage tracking.
- No `eval`, `new Function`, `vm`, WebAssembly, or downloaded code. Every
  line Feuillets executes ships in `main.js`, which is deliberately left
  unminified so it can be read.
- No credentials, API keys, or tokens are stored, requested, or transmitted
  (there is nothing to authenticate against).
- No custom auto-update mechanism — updates are handled by Obsidian itself.

### What the plugin does that touches the system, and why
- **Grammar checking and language engines: none.** Feuillets bundles,
  downloads, and runs no proofreading engine and no dictionary, and sends
  text to no remote service. Users are pointed to dedicated community
  plugins; Feuillets does not detect, configure, or call them.
- **Native export (default engine, desktop and mobile, user-triggered).**
  `.docx`/`.epub`/`.pdf` compilation builds files in pure JavaScript —
  `docx` and `jszip` for `.docx`/`.epub` (bundled, no network fetch), and
  Obsidian's own built-in print-to-PDF for `.pdf` (desktop only). No
  external process, no filesystem access outside the vault. This is the
  default and requires no opt-in.
- **Pandoc export (optional alternative engine, desktop only, opt-in,
  user-triggered).** Switching the export engine setting to Pandoc invokes a
  locally installed `pandoc` binary via
  `child_process.execFile(path, args, ...)`. `execFile` is used deliberately
  instead of `exec`/shell string interpolation: arguments are passed as an
  array and never go through a shell, which rules out shell-metacharacter
  injection from any of the arguments (title, author, file paths). The
  binary path itself is a plain-text setting (default `"pandoc"`, resolved
  via the OS `PATH`), configurable by the vault owner only — it is never
  read from a file, a remote source, or vault content.
- **Direct filesystem read/write (desktop only, Pandoc export path only).**
  Needed because Pandoc runs as an external process and reads/writes real
  files on disk; Obsidian's vault adapter alone cannot hand a file to an
  external process. The temporary compiled manuscript is written through
  Obsidian's own `vault.adapter.write`/`remove` (inside the vault, cleaned up
  immediately after conversion). The optional "Pandoc reference document"
  setting is resolved and checked against the vault's base path; any
  resolution that would escape the vault (e.g. `../../..`) is rejected with
  a user-facing notice instead of being followed silently.
- **One undocumented internal API call.** `WorkspaceSplit.setSize()` (used
  to fix sidebar widths) is absent from Obsidian's published type
  definitions — it could change or disappear in a future release without
  notice. Both call sites are guarded by a `typeof` feature-detection check
  and a `try/catch`, so a break degrades to "sidebar width no longer
  auto-adjusts" rather than an exception.
- Everything else in the plugin uses only Obsidian's public APIs
  (`app.vault`, `app.metadataCache`, `app.fileManager`, `app.workspace`) —
  grep-auditable, no other filesystem or process access exists in the
  codebase.

### Mobile
`isDesktopOnly` is `false`: the plugin is fully usable on mobile, including
compilation and native `.docx`/`.epub` export. Only the Pandoc engine and
native `.pdf` export (both desktop-only) detect `Platform.isMobile` and show
an explicit notice instead of failing silently; no Node-only API is touched
on the code path mobile devices take.

### Build integrity and artifact attestations
Release assets (`main.js`, `styles.css`, `manifest.json`) are automatically built and published via GitHub Actions. Each release includes cryptographic [GitHub Artifact Attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) generated during the build step, enabling users and reviewers to independently verify that release binaries were built directly from this source repository.

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
