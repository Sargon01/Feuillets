# Third-party notices

Feuillets is distributed under the GPL-3.0. This file lists third-party
components redistributed **inside the plugin release**, and the runtime
dependencies it merely calls.

---

## Bundled in the release

No third-party source code is redistributed inside the plugin beyond the npm
libraries listed below. Feuillets bundles **no dictionary and no
language-specific engine**, and downloads nothing after installation.

Versions up to and including 1.4.4 redistributed parts of
[Grammalecte](https://github.com/algoo/grammalecte) (GPL-3.0) and downloaded
[Harper](https://github.com/Automattic/harper) (Apache-2.0) at runtime. Both
were removed in 1.4.5, along with the grammar-checking features they served.
Feuillets remains GPL-3.0.

## Bundled libraries (npm)

| Component | Licence | Use |
| --- | --- | --- |
| [`docx`](https://github.com/dolanmiu/docx) | MIT | `.docx` export |
| [`jszip`](https://github.com/Stuk/jszip) | MIT / GPL-3.0 | `.epub`, `.odt`, `.docx` and project backups |
| [`diff`](https://github.com/kpdecker/jsdiff) | BSD-3-Clause | snapshot comparison |

---

## Optional external programs

- **Pandoc** — not bundled and not downloaded. If, and only if, the export
  engine is switched to Pandoc, Feuillets runs a Pandoc binary already
  installed on the machine, via `execFile` with an argument array (no shell).

---

## Recommended, not integrated

- **Harper** (<https://community.obsidian.md/plugins/harper>) — an
  independent Obsidian community plugin for English grammar checking.
  Feuillets suggests it in its settings and nothing more: it does not bundle
  it, download it, detect it, configure it, read its data, or call its APIs,
  and behaves identically whether or not it is installed.
