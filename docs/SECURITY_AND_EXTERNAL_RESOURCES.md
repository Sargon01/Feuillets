# Security and external resources

Notes for reviewers, on the parts of Feuillets that touch the system, the
network, or dynamic evaluation. Facts and locations, so each point can be
checked against the source.

## Summary

| Capability | Status |
| --- | --- |
| Code downloaded then executed | **None.** Removed in 1.4.5. |
| WebAssembly | **None.** Removed in 1.4.5. |
| Manuscript text sent to a remote service | **None.** Removed in 1.4.5. |
| Network requests made by the plugin | **None.** |
| `eval()` / `new Function()` | **None.** |
| `vm` | **None.** Removed in 1.4.5. |
| Node `fs` | Yes — for explicit, user-triggered imports from outside the vault. |
| `child_process` | Yes — Pandoc export only, opt-in, `execFile` with an argument array. |

## No dynamic code execution

Feuillets uses no `eval`, no `new Function`, no `vm`, and no WebAssembly.
Everything it executes is plain JavaScript compiled into `main.js`, which is
deliberately **not minified** so that it can be read line by line.

It also bundles no dictionary and no language-specific engine: the Analysis
panel's metrics are computed from the text itself and work on any language
in the Latin script.

## Node `fs` — imports from outside the vault

Obsidian's vault API cannot read files outside the vault, and these features
exist precisely to bring outside files in. Every path is chosen by the user
through a file picker or an explicit setting; nothing is scanned in the
background.

- `src/ui/scrivener-import-modal.ts` — reads a `.scriv` bundle to import it.
- `src/views/docx-review-view.ts` — reads an annotated `.docx` a proofreader
  sent back.
- `src/services/compile-export.ts` — writes the file handed to Pandoc.
- `src/services/legacy-grammar-cleanup.ts` — one-off removal of the grammar
  engines that versions ≤ 1.4.4 downloaded (up to 26 MB). Deletes only
  directories Feuillets itself created; never user content.

All are loaded lazily and guarded by `Platform.isDesktop`, so mobile never
touches a Node module.

## `child_process` — Pandoc export

One call site, `src/services/compile-export.ts`. Off by default; only reached
after the export engine setting is switched to Pandoc, and only if Pandoc is
already installed.

It uses `execFile(binary, argsArray, …)` — **not** `exec`, and **no shell**.
Arguments are passed as an array, so no string is interpreted by a shell and
no user-supplied value can inject a command.

## Vault enumeration

`vault.getFiles()` / `getMarkdownFiles()` are used to build the manuscript
tree, resolve chapter and scene order, and compile the manuscript. That is
the plugin's core purpose: a writing studio has to see the manuscript's
files. Nothing is transmitted anywhere.

## `localStorage`

Read once, never written: `src/i18n/index.ts` reads Obsidian's own
`language` key to match the interface language. Plugin settings go through
Obsidian's `loadData()` / `saveData()`. No plugin data is stored in
`localStorage` or `sessionStorage`.

## Clipboard

One call, `src/views/analysis-view.ts`, behind an explicit "copy summary"
button. The clipboard is never read.

## `document.createElement` in export code

`src/services/export-pdf.ts` and `export-render.ts` build a **separate
iframe document** for printing. Obsidian's `createEl()` helpers operate on
the main document and cannot construct nodes in another document, so the
standard DOM API is used there. The linter's `prefer-create-el` warnings on
those two files reflect that, and are expected.

## `display()` and `setDynamicTooltip()`

`minAppVersion` is `1.7.2`. `getSettingDefinitions()` (which replaces
`display()`) and `setDisplayFormat()` (which replaces `setDynamicTooltip()`)
both require Obsidian 1.13.0. Adopting them would break every supported
version below that; removing `setDynamicTooltip()` would also hide slider
values on 1.7.2–1.12.x, where they are not shown automatically. Both are kept
deliberately, with the reasoning recorded at the top of
`src/settings/feuillets-setting-tab.ts`. The deprecation warnings are left
visible rather than suppressed.

Where a modern API *can* be used safely, it is: `src/utils/obsidian-compat.ts`
picks `messageEl` (1.8.7+) and `setDestructive()` (1.13.0+) at runtime when
the host provides them, falling back otherwise.

## Grammar checking

Feuillets does not check grammar. It does not bundle, download, run, detect,
configure, or communicate with any grammar checker. Its settings point users
to dedicated community plugins; that is a text and a link, with no code
behind it.
