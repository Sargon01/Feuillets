# Contributing to Feuillets

Thanks for taking an interest. Feuillets is a long-form writing workspace
for Obsidian, written in plain JavaScript (ES modules) with structural
type-checking via `allowJs` — there is no TypeScript build step.

## Getting started

```bash
git clone https://github.com/Sargon01/Feuillets.git
cd Feuillets
npm install
npm run dev      # esbuild watch mode
```

For a live vault, symlink the repository into
`<vault>/.obsidian/plugins/feuillets/` and run `npm run build`; the plugin
loads `main.js`, `manifest.json` and `styles.css` from there.

## Before opening a pull request

```bash
npm run build          # type-check + production bundle
npm test               # node:test — unit tests for pure functions
npm run lint           # eslint + tsc, must report 0 errors
npm run lint:obsidian  # Obsidian's own review, must report 0 errors
```

`npm run lint:obsidian` runs the same [`eslint-plugin-obsidianmd`](https://github.com/obsidianmd/eslint-plugin)
that the community dashboard uses when reviewing a release. Running it
locally is much faster than waiting for the dashboard, whose error
messages often cite no file or line. See `obsidian-review.config.mjs` for
which rules count as blocking and why.

## Conventions

A few rules are enforced by the Obsidian review and are easy to trip over:

- **No inline styles.** Never `element.style.foo = "..."`. Put static
  values in `styles.css`; for values computed at runtime use
  `setCssProps({ "--my-var": value })` and consume the variable from the
  stylesheet. Themes must be able to override anything visual.
- **No `innerHTML`.** Build DOM with `createEl` / `createDiv`. If you must
  turn an HTML string into nodes, parse it with `DOMParser` into an inert
  document (see `services/export-pdf.js`).
- **No `<style>` or `<link>` elements.** Styling belongs in `styles.css`.
  A preview that needs arbitrary CSS goes in a sandboxed `<iframe>` (see
  `ui/template-preview.js`).
- **Timers:** prefer `window.setTimeout` / `window.clearTimeout` so the
  code keeps working in pop-out windows.
- **Mobile:** the plugin is not desktop-only. Node built-ins (`fs`,
  `path`, `child_process`) must stay behind a `Platform.isDesktop` guard.

### User-facing text

The interface is bilingual (French/English). Never hard-code displayed
strings: add a key to `src/i18n/fr.js` **and** `src/i18n/en.js`, then use
`t("your.key")`. Internal identifiers — frontmatter keys, stored setting
values, title-page roles — are never translated.

### Backwards compatibility

Existing vaults must keep working. Legacy French frontmatter keys and
folder names are still read indefinitely; new writes use the English ones.
Never rewrite or rename a user's files as a side effect of an upgrade.

## Commits and releases

Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`…).
A release is cut by bumping `manifest.json`, `package.json` and
`versions.json`, adding a `CHANGELOG.md` entry, then pushing a tag matching
the version — GitHub Actions builds it, attaches the three required assets
and publishes the release.

`main.js` at the repository root is a **build artifact** and is gitignored;
never edit or commit it.

## Reporting a bug

Please include your Obsidian version, your operating system, and the steps
to reproduce. If it involves an export, saying which format (`.docx`,
EPUB, ODT, PDF) and attaching the template you used helps a lot.
