# BibTeX citations and Pandoc package

> English · [Français](CITATIONS-BIBTEX-ET-PANDOC.md) · [Index](README.md)

Feuillets keeps academic citations in ordinary Markdown. It helps locate references while writing, but it does not bundle or run Zotero, Better BibTeX, Pandoc or a CSL engine.

## Two citation systems

Feuillets currently offers two distinct citation paths. They do not overlap and do not share a common storage format.

### Source sheets

The historical Source sheet system, reached from **Research → References → Insert a citation**, writes a plain Feuillets citation directly into the text, in the style configured for the project:

- footnote
- parenthetical

This path does not produce a Pandoc citekey and does not use CSL. Source sheets can supply `author`, `title`, `publisher`, `date` and `url`.

For compatibility, Feuillets also reads a few common properties found on Source sheets created with ZotFlow — `creator`, `creators`, `publication`, `year` — without ever modifying the underlying files. This is a compatibility reading, not a full Zotero or ZotFlow integration.

### BibTeX / Pandoc

The second system relies on a `.bib` file and `[@citekey]` syntax, opened by typing `[@` in a sheet. It keeps a Pandoc-compatible, semantic citation syntax in the Markdown source. This is the path that enables the simplified author-date preview inside Feuillets, the Pandoc package, and external CSL processing.

## Prepare a workspace

1. Associate a Research folder with the workspace or sheet that needs its own references.
2. Put a Better BibTeX export, such as `references.bib`, in that Research folder.
3. Optionally put one CSL style file there as well.
4. Open the workspace settings for that folder and select its bibliography and CSL resources under **Citations and bibliography**.

Selecting a `.bib` file is not enough on its own to display author-date citations. Three settings are distinct: choosing the `.bib` bibliography, optionally choosing a `.csl` style file, and choosing the citation preview mode. That mode can be **off** or **author-date**.

The active sheet resolves its direct association first, then the associated folders on its physical ancestor path. Another branch of the Binder is not searched.

## Cite while writing

Type `[@` in a Markdown sheet to open the reference picker. Search by citekey, author, title or year; choose one or more entries and add an optional page locator. Feuillets writes ordinary Pandoc syntax, for example:

```markdown
[@smith2024]
[@smith2024, p. 42]
[@smith2024; @doe2023, pp. 12-14]
```

The citekeys remain in source Markdown. Unknown keys are never silently removed.

## Interactive surfaces

When the author-date preview mode is enabled and an applicable bibliography is available, Live Preview, Reading Mode and Continu display resolved citations in a readable form while leaving the underlying Markdown untouched. For example:

```
[@smith2024, p. 42]
```

is displayed as:

```
(Smith, 2024, p. 42)
```

These surfaces can also surface the associated bibliographic information where the interface provides for it. This is not a full CSL rendering — it is a simplified author-date display specific to Feuillets. See the limitation below.

## Preview, bibliography and native exports

**Markdown export** always keeps the raw Pandoc syntax, for example `[@smith2024]`.

**Paginated preview, DOCX, EPUB, ODT and PDF**: when the author-date preview mode is enabled and an applicable bibliography is available, `[@smith2024]` can be rendered as `(Smith, 2024)` in these outputs. When the mode is disabled, or when a citation cannot be resolved, the raw syntax remains visible. The configured `.csl` file is not applied here — see [CSL role](#csl-role) below.

The Research panel lists cited BibTeX entries and reports unknown citekeys. Feuillets can generate a simple Markdown bibliography from the citations in the selected scope; this native bibliography is not a full CSL bibliography, and it does not automatically include an entire `.bib` file — only the citations actually found in scope.

### Limitation: simplified author-date rendering only

The native author-date rendering used in Feuillets is not a CSL engine. It does not guarantee full compliance with Chicago, APA, MLA, ISO 690, university style guides, journal styles, or any other CSL style. For a bibliography that must conform to a real CSL style, use the Pandoc package with an external Pandoc/citeproc workflow.

## CSL role

A `.csl` file configured in Feuillets is associated with the relevant project or workspace and is included in the Pandoc package when applicable. It is not interpreted by Feuillets itself and does not transform citations in native exports or previews. Feuillets does not currently include a native CSL engine.

## BibTeX accents

Feuillets decodes common LaTeX sequences used for accented characters in BibTeX metadata. This is not a general TeX interpreter.

## Use a Pandoc package for a final CSL style

Choose **Pandoc package (.zip)** in Edition export when the final deliverable must use a CSL style supplied by a university, publisher or journal.

The archive contains:

- `manuscript.md`, compiled from the selected Feuillets scope;
- `pandoc.yaml`, a portable Pandoc defaults file;
- only the `.bib` files required by citekeys in that scope;
- the applicable CSL file, when configured;
- local images copied under `media/`;
- `citation-report.json` only when Feuillets found unknown citekeys or missing media.

Feuillets never installs, finds or launches Pandoc. Unzip the package and run it through your own Pandoc workflow. If bibliography is enabled in Composition, the manuscript contains the Pandoc `{#refs}` placeholder. If it is disabled, `pandoc.yaml` explicitly suppresses bibliography generation.

Duplicate citekeys defined by more than one included `.bib` file stop package creation. Resolve the collision in the bibliographies before exporting again.
