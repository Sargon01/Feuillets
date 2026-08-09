# Third-party notices

Feuillets is distributed under the GNU GPL-3.0 license.

This file lists the runtime libraries bundled into the Feuillets production build and clarifies what is **not** bundled.

## Runtime libraries

| Component | License | Purpose |
|---|---|---|
| [`docx`](https://github.com/dolanmiu/docx) | MIT | Native DOCX generation |
| [`jszip`](https://github.com/Stuk/jszip) | MIT / GPL-3.0 | ZIP containers used by EPUB/ODT-related workflows, imports and project backups |
| [`diff`](https://github.com/kpdecker/jsdiff) | BSD-3-Clause | Text/version comparison |

Exact installed versions are defined by `package.json` / the lockfile of the release source.

## Host application

Feuillets is an Obsidian plugin and uses Obsidian's plugin API. Obsidian itself is the host application, not code redistributed by this repository as one of the libraries above.

## Not bundled

Feuillets currently bundles **no**:

- grammar dictionary;
- Grammalecte engine;
- Harper engine;
- LanguageTool client/service;
- Pandoc executable;
- remote AI model;
- downloaded executable code.

## Companion plugins

The following may be recommended as separate installations but are not runtime dependencies bundled inside Feuillets:

- **Feuillets-Grammalecte** — linguistic-analysis companion;
- **Courrier** — editorial correspondence/submission companion;
- **Advanced Canvas** — optional Canvas enhancement.

Each companion has its own repository, dependencies, license and security/privacy behavior.

## Historical versions

Older Feuillets releases may have had a different dependency or grammar-checking architecture.

This notice documents the **current source tree**. Historical behavior should be researched from the tag/release that actually contained it rather than inferred from this file.
