# BibTeX citations and Pandoc package

> English · [Français](CITATIONS-BIBTEX-ET-PANDOC.md) · [Index](README.md)

Feuillets keeps academic citations in ordinary Markdown. It offers three citation rendering modes, including Native CSL through the optional **Feuillets CSL** companion plugin. Feuillets remains fully usable without that companion and never installs or runs Zotero, Better BibTeX or Pandoc.

## Two citation systems

Feuillets currently offers two distinct citation paths. They do not overlap and do not share a common storage format.

### Source sheets

The historical Source sheet system, available through **Research → References** search and the existing **Insert a citation** command, writes a plain Feuillets citation directly into the text, in the style configured for the project:

- footnote
- parenthetical

This path does not produce a Pandoc citekey and is separate from Native CSL. Source sheets can supply `author`, `title`, `publisher`, `date` and `url`.

For compatibility, Feuillets also reads a few common properties found on Source sheets created with ZotFlow — `creator`, `creators`, `publication`, `year` — without ever modifying the underlying files. This is a compatibility reading, not a full Zotero or ZotFlow integration.

### BibTeX / Pandoc

The second system uses a `.bib` bibliography and semantic Pandoc citekeys. A `.csl` file supplies the citation and bibliography style for Native CSL or an external Pandoc/citeproc workflow. Type `[@` in a sheet to open the citekey picker. This path supports lightweight author-date rendering, Native CSL and the Pandoc package.

## Prepare a workspace

1. Associate a Research folder with the workspace or sheet that needs its own references.
2. Put a Better BibTeX export, such as `references.bib`, in that Research folder.
3. Put a `.csl` style file there if you want Native CSL, or optionally for the Pandoc package.
4. Open **Research → References**, click the settings icon beside the tabs, and select the bibliography and CSL resources in **Bibliography settings**.
5. Choose the citation preview mode:

```text
Raw citekeys
Author-date
Native CSL
```

- **Raw citekeys** leaves Pandoc syntax visible.
- **Author-date** uses Feuillets’ historical lightweight BibTeX renderer. It requires an applicable `.bib` bibliography, does not require Feuillets CSL and does not apply a full CSL style.
- **Native CSL** requires Feuillets CSL installed and enabled, an applicable `.bib` bibliography, a `.csl` style and supported CSL runtime resources. If processing is unavailable or fails, raw citation syntax stays visible; Feuillets never silently substitutes fabricated output.

Selecting resources and selecting the preview mode are separate settings.

These settings follow the active sheet’s context, in both isolated and non-isolated workspaces. The dialog shows the effective values and their inheritance from the project or a parent workspace. Choose **Use settings specific to this workspace** to override rendering, bibliography or CSL style independently. **Return to inherited settings** removes the local overrides. At the project root, the dialog edits project settings directly. The normal References panel keeps only search and cited references visible; resource settings are configured here, rather than in project/folder settings.

The active sheet resolves its direct association first, then the associated folders on its physical ancestor path. Another branch of the Binder is not searched.

Composed documents can use several bibliographies resolved from their citing sheets’ own contexts. Each citing sheet must resolve valid bibliography and style resources, and the document must resolve a single consistent CSL style. Missing resources or conflicting styles prevent Native CSL rendering for that document.

## Native CSL companion

Feuillets does not bundle citeproc itself. Native CSL mode uses the optional [Feuillets CSL companion plugin](https://github.com/Sargon01/Feuillets-CSL) through Feuillets’ public citation provider API v2. It runs locally inside Obsidian. This separation keeps the main Feuillets plugin independent from the citation engine.

Feuillets owns Markdown/Pandoc parsing, contextual workspace/project resource resolution, `.bib` and `.csl` selection, document/session construction, rendering into Obsidian and export surfaces, fail-closed behavior and Pandoc package generation. Feuillets CSL adapts BibTeX/BibLaTeX to CSL data, evaluates CSL through citeproc, processes citations with document state, and supplies safe semantic citation and bibliography output.

## Cite while writing

Open **Research → References** and use **Search references…** to find available Source sheets and entries in the bibliography applicable to the current document. Results show their Source or BibTeX origin and offer a **Cite** button. Source citation keeps the project’s footnote/parenthetical style and page prompt, and works without BibTeX or Feuillets CSL. A direct BibTeX citation inserts `[@citekey]` at the current cursor in the Markdown editor.

With an empty search, **Cited references** lists only references used in the displayed project/workspace scope, with counts and unknown citekey warnings; each known reference offers **Cite** to reuse it directly, and its bibliography generation action keeps that scope. Unknown citekeys remain warnings without a citation action. Entering a query temporarily replaces this list with at most 30 results from the available Sources and applicable BibTeX catalogue. Clearing the query restores the cited list. The complete `.bib` catalogue is searched on demand rather than permanently rendered in the sidebar. **New source sheet** remains available even without reference resources; footnote inspection remains in the sheet Inspector.

The fast editor shortcut **`[@`** still opens the citekey picker in a Markdown sheet. Search by citekey, author, title or year; choose one or more entries and add an optional page locator. Feuillets writes ordinary Pandoc syntax, for example:

```markdown
[@smith2024]
[@smith2024, p. 42]
[@smith2024; @doe2023, pp. 12-14]
@smith2024
```

These examples show a single citation, a page locator, a grouped citation with locators, and a narrative citation. The source Markdown always remains semantic Pandoc syntax: rendering never rewrites citation markup in the manuscript. Unknown keys are never silently removed.

## Interactive surfaces

### Author-date mode

With an applicable bibliography, **Author-date** displays readable citations in Live Preview, Reading Mode and Continuous mode (Continu), as well as paginated Preview, PDF, DOCX, EPUB and ODT. For example, `[@smith2024, p. 42]` can appear as `(Smith, 2024, p. 42)`.

The interactive author-date views offer associated bibliographic details through citation tooltips where available. This lightweight renderer does not guarantee compliance with a CSL style.

### Native CSL mode

**Native CSL** uses the provider to render citations according to the selected CSL style in:

- Live Preview while editing;
- Reading Mode;
- Continuous mode (Continu);
- paginated Preview;
- native PDF, DOCX, EPUB and ODT exports.

Both modes leave manuscript Markdown unchanged. Static exports contain the rendered presentation; they do not provide the editor’s citation tooltips.

## Note-based CSL styles

Native CSL supports note-based styles such as Chicago Notes & Bibliography. Citations inside Markdown footnotes participate in document citation order. Feuillets passes note position and context to the engine, allowing stateful styles to distinguish first and subsequent citations according to citeproc/CSL semantics.

Rendered citations, including rich formatting, remain associated with their original footnote. This note-aware behavior is supported in Reading Mode, Continu, paginated Preview, PDF, DOCX, EPUB and ODT. Live Preview provides Native CSL citation rendering while editing. Feuillets continues to own Preview/PDF footnote pagination.

## Bibliography behavior

### Simple Feuillets bibliography

The Research panel lists cited BibTeX entries and reports unknown citekeys. Feuillets can still generate its simple Markdown bibliography from citations in the selected scope where applicable. This legacy path does not apply a full CSL style and includes cited entries rather than automatically adding an entire `.bib` file.

### Native CSL bibliography

When **Native CSL** is active and bibliography inclusion is enabled in Composition, the provider can generate a style-compliant bibliography in paginated Preview, PDF, DOCX, EPUB and ODT. These outputs preserve the provider’s structured CSL layout, including hanging indents and second-field alignment where supported. Bibliography generation follows the selected style’s semantics.

This presentation bibliography does not turn compiled Markdown into CSL-formatted text.

## Markdown export

**Compiled Markdown keeps the Pandoc citation syntax**, such as `[@smith2024]`, in every rendering mode. Native CSL is presentation/export rendering, not destructive replacement of manuscript Markdown. Other native outputs can contain rendered CSL citations and bibliographies.

## CSL locales and limitations

Feuillets CSL currently bundles the CSL runtime locale resources **`en-US`** and **`fr-FR`**. An unsupported runtime locale fails closed; there is no automatic locale substitution. This concerns the locale resources needed during CSL evaluation, not a restriction to English or French CSL styles.

## Troubleshooting

**When Native CSL cannot produce a safe result, Feuillets keeps the raw citation syntax visible.** Check:

- Feuillets CSL is installed and enabled;
- the applicable `.bib` bibliography exists and is valid;
- the `.csl` style exists and is selected;
- each citekey is present in the resolved bibliography;
- the style’s required runtime locale is supported.

A missing or disabled companion, missing bibliography or style, unknown citekey, invalid bibliography, unsupported locale or provider processing failure causes this fail-closed behavior. Correct the resource or provider problem to restore rendering.

## BibTeX accents

Feuillets decodes common LaTeX sequences used for accented characters in BibTeX metadata. This is not a general TeX interpreter.

## Use a Pandoc package

You can use Native CSL through Feuillets CSL directly inside Feuillets and its native outputs, or choose **Pandoc package (.zip)** in Edition export for an independent external Pandoc/citeproc workflow. The package remains available with Native CSL and can carry a university, publisher or journal style.

The archive contains:

- `manuscript.md`, compiled from the selected Feuillets scope;
- `pandoc.yaml`, a portable Pandoc defaults file;
- only the `.bib` files required by citekeys in that scope;
- the applicable CSL file, when configured;
- local images copied under `media/`;
- `citation-report.json` only when Feuillets found unknown citekeys or missing media.

Feuillets never installs, finds or launches Pandoc. Unzip the package and run it through your own Pandoc workflow. If bibliography is enabled in Composition, the manuscript contains the Pandoc `{#refs}` placeholder. If it is disabled, `pandoc.yaml` explicitly suppresses bibliography generation.

Duplicate citekeys defined by more than one included `.bib` file stop package creation. Resolve the collision in the bibliographies before exporting again.
