# BibTeX citations and Pandoc package

> English · [Français](CITATIONS-BIBTEX-ET-PANDOC.md) · [Index](README.md)

Feuillets keeps academic citations in ordinary Markdown. It helps locate references while writing, but it does not bundle or run Zotero, Better BibTeX, Pandoc or a CSL engine.

## Prepare a workspace

1. Associate a Research folder with the workspace or sheet that needs its own references.
2. Put a Better BibTeX export, such as `references.bib`, in that Research folder.
3. Optionally put one CSL style file there as well.
4. Open the workspace settings for that folder and select its bibliography and CSL resources under **Citations and bibliography**.

The active sheet resolves its direct association first, then the associated folders on its physical ancestor path. Another branch of the Binder is not searched.

## Cite while writing

Type `[@` in a Markdown sheet to open the reference picker. Search by citekey, author, title or year; choose one or more entries and add an optional page locator. Feuillets writes ordinary Pandoc syntax, for example:

```markdown
[@smith2024]
[@smith2024, p. 42]
[@smith2024; @doe2023, pp. 12-14]
```

The citekeys remain in source Markdown. Unknown keys are never silently removed.

## Preview, bibliography and native exports

Preview can display resolved author-date citations while preserving the source. The Research panel lists cited BibTeX entries and reports unknown citekeys. Feuillets can generate a simple Markdown bibliography from the citations in the selected scope.

Native Markdown, DOCX, EPUB, ODT and PDF exports keep raw citekeys. They are useful when no institution-specific citation style is required.

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
