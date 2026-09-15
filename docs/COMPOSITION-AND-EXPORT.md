# Composition and export

> [Français](COMPOSITION-ET-EXPORT.md) · **English** · [Documentation index](README.md)

## Writing is not layout

Feuillets separates the comfortable editor appearance from the composition of the document meant to be read, printed or sent.

## Edition tab

The **Edition** tab contains the document-production surfaces, including **Composition** and **Layout**. It works with the real **Preview** and the export bar.

There are only two modes:

- **Composition**;
- **Layout**.

Export is no longer a third tab. Edition groups **Scope**, **Content**, **Format**, **Export** and **Refresh Preview** in the top bar.

## Composition

The Composition home page summarizes the document:

- **Manuscript content** — choose included sheets;
- **Content variants** — keep the document while hiding selected roles;
- **Content extractions** — keep whole sections containing selected roles;
- **Content collections** — gather selected role blocks with heading context;
- **First page** — content and presentation;
- **Front matter**;
- generated contents/table of contents and tables;
- bibliography and appendices;
- manuscript structure and footnote-related options.

Subpages return to Composition without opening a new Obsidian view.

## Roles, variants, extractions and collections

Optional **semantic roles** describe what a passage does — for example `definition`, `questions`, `solution`, `preuve`, `source`, `synthese` or `recommandation`.

They do not replace Markdown headings or ordinary text. A project can ignore them entirely.

When useful, Composition can define:

- a **variant**: same document, selected roles hidden;
- an **extraction**: whole structural sections containing selected roles;
- a **collection**: selected role blocks with heading context.

A variant can combine with an extraction or collection. Extraction and collection are alternative derivation modes.

See [Semantic roles](SEMANTIC-ROLES.md) and [Content variants, extractions and collections](CONTENT-VARIANTS-EXTRACTIONS-COLLECTIONS.md).

## First page

There is one owner for **First page** in Edition: **Composition → First page**.

It combines content/inclusion with first-page presentation exceptions and uses the same template model and miniature as the rest of the layout pipeline.

## Layout

Categories are:

- **Page** — format, orientation, margins, mirrored margins, columns, gutter, header and footer;
- **Body text** — font, size, line spacing, alignment, indents, spacing, hyphenation, profile and French typography at export;
- **Headings** — heading-level styles, spacing and page breaks;
- **Blockquote** — quotations, indents/margins, color, italic and scene separator.

Controls that do not apply are hidden, such as gutter with one column or header details when the header is disabled.

## V2 templates

Preview and exports share the same template model. You can use built-ins, create/duplicate templates, rename/delete custom templates, import Ulysses styles, or import Word `.docx`/`.dotx` templates for representable properties.

## Scope

Composition can target one sheet, a folder and descendants, a file/folder selection, or the whole project. Descendants are deduplicated when both a parent folder and child are selected.

## Export

The compact toolbar follows **Scope → Content → Format → Export**.

- **Scope** chooses the files involved.
- **Content** chooses the full document, an extraction or a collection.
- **Format** chooses the output format.
- **Export** runs the operation with the current choices.

Scope uses the same `CompileScope` model as the rest of the pipeline: sheet, folder, selection or project.

### Composition inside an independent work

A folder declared as a **work** becomes an editorial root. In its context, project scope means that work rather than the containing series or collection. Preview and export use the same boundary.

The work initially inherits the main project Composition. Customizing it creates a local composition without rewriting the parent: structure roles and numbering, first page, front matter, generated contents, bibliography, appendices and output choices remain attached to the correct work. Resetting the local composition returns to inheritance.

Before export starts, Feuillets saves any pending Continuous edits, then exports from the real source files. If those writes cannot be secured, export does not start. Opening Preview is not required before exporting.

## Output name

The manuscript file name is no longer a normal visible Edition control. Feuillets resolves a name from context/preset while preserving historical `compileFileName` values for compatibility.

Output writing also handles case collisions on macOS, so an existing `Manuscrit.md` can be updated even if an old setting requests `manuscrit.md`.

## Preview and formats

Preview is the visual reference before export and shares composition/template/pagination logic where relevant.

It accepts a sheet, folder, selection or project scope. For a large scope, Feuillets may show an initial portion quickly and then complete the full document; the final rendering replaces the provisional preview. Export always uses the complete requested scope, and Preview is never required for export.

### Paginated footnotes

In paginated Preview and PDF, Feuillets assigns each note definition to the page containing its **first call**. Footnote height is measured and reserved during pagination, reducing the body area available on pages that contain notes.

Repeated calls remain visible in the text without reserving the definition again. In multi-column composition, the body keeps its columns while the footnote area spans the full width below them. Source Markdown and its `[^1]` markers are not rewritten.

A single footnote taller than the usable height of one page is not yet split across pages. This limitation does not affect ordinary or multi-paragraph notes that fit within the available area of a page.

### BibTeX citations and Pandoc package

A workspace can resolve a `.bib` file, and optionally a CSL style, from its associated Research folder. The active sheet uses its own association first, then its physical ancestor folders: sibling workspaces are never included. Type `[@` to search the catalog and insert one or more citekeys with optional locators.

Preview can show author-date citations and the Research panel can list cited BibTeX entries. Unknown citekeys remain visible as raw Markdown. Native exports retain raw citekeys and can include Feuillets’ simple bibliography. They do not implement CSL formatting.

Choose **Pandoc package (.zip)** when the final document must follow a university or journal CSL style. The archive contains the compiled `manuscript.md`, `pandoc.yaml`, only the bibliographies needed by the compiled scope, the applicable CSL and copied local media. Feuillets never runs Pandoc; process the archive with your own Pandoc installation or workflow. See [BibTeX citations and Pandoc package](BIBTEX-CITATIONS-AND-PANDOC.md).

Native output: compiled Markdown, DOCX, EPUB, ODT and desktop PDF through the system print dialog. Source Markdown is never replaced by the export artifact.

When an extraction or collection is selected, Markdown export intentionally remains a source export; content derivations apply to the document-format publishing pipeline.

For a guided example, see [Tutorial — publish several outputs from one source](SEMANTIC-PUBLISHING-TUTORIAL.md).
