# Composition and export

> [Français](COMPOSITION-ET-EXPORT.md) · **English** · [Documentation index](README.md)

## Writing is not layout

Feuillets separates the comfortable editor appearance from the composition of the document meant to be read, printed or sent.

## Central Edition workspace

In 2.5, **Edition** is no longer a right-panel tab. It is a central surface working beside the real **Preview**.

There are only two modes:

- **Composition**;
- **Layout**.

Export is no longer a third tab. Edition always keeps **scope**, **format**, **Export** and **Refresh Preview** in the top bar.

## Composition

The Composition home page summarizes the document:

- **Manuscript content** — choose included sheets;
- **First page** — content and presentation;
- **Front matter**;
- generated contents/table of contents and tables;
- bibliography and appendices;
- manuscript structure and footnote-related options.

Subpages return to Composition without opening a new Obsidian view.

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

Export is launched from the persistent Edition toolbar or export commands. Scope uses the same `CompileScope` model as the rest of the pipeline: sheet, folder, selection or project.

## Output name

The manuscript file name is no longer a normal visible Edition control. Feuillets resolves a name from context/preset while preserving historical `compileFileName` values for compatibility.

Output writing also handles case collisions on macOS, so an existing `Manuscrit.md` can be updated even if an old setting requests `manuscrit.md`.

## Preview and formats

Preview is the visual reference before export and shares composition/template/pagination logic where relevant.

Native output: compiled Markdown, DOCX, EPUB, ODT and desktop PDF through the system print dialog. Source Markdown is never replaced by the export artifact.
