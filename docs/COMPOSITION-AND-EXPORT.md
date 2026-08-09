# Composition and export

> [Français](COMPOSITION-ET-EXPORT.md) · **English** · [Documentation index](README.md)

## Writing appearance is not final layout

Feuillets separates the comfortable editor from the document meant to be read, printed or submitted.

![Writing and composition](feuillets-concentration-apercu.png)

## Composition scope

A composition can target:

- one file;
- one folder and all Markdown descendants;
- a mixed selection of files and folders;
- the whole project.

If both a folder and one of its descendants are selected, the descendant is included only once. Final order follows Binder order.

## Technical content stays out

Technical folders are excluded from manuscript traversal. Research, Resources, Edition, Backups and other technical spaces do not become manuscript chapters accidentally.

Sheets explicitly excluded from compilation remain out as well.

## Preview

![Paginated Preview](feuillets-apercu.png)

Preview checks titles, separators, Front pages, template, order, scope and pagination before export.

The active sheet can refresh quickly; longer scopes prioritize stable reading rather than recompiling aggressively on every keystroke.

## Front pages

The manuscript `Front` folder contains authored front matter. Title-page roles can represent title, subtitle, author, an additional line or an image.

Preview and export read the same Front files.

## Templates

Built-in and project-specific templates can control font, size, line height, alignment, indent, spacing, headings, scene divider, orientation and other supported layout values.

PDF page geometry remains PDF-specific where it represents actual physical page settings.

## Output folder

Outputs are written to `_Sortie`.

For a structured project, `_Sortie` sits next to `Manuscrit`. For a folder used as-is, `_Sortie` stays inside that folder and Feuillets does not climb to its parent.

## Native formats

### DOCX
Real Word document with named heading styles and editable content.

### EPUB
Reflowable ebook format; physical page options do not apply.

### ODT
OpenDocument output for LibreOffice and compatible applications.

### PDF
Desktop only. Feuillets builds the paginated print document, then opens the system print dialog; choose the system's PDF-save option.

### Compiled Markdown
Open text composition for archiving or another publishing pipeline.

## Footnotes and typography

Footnote IDs are normalized across composed sheets so local identifiers do not collide. Optional French typography transforms can be applied during composition.

## Recommended final check

Inspect title page, chapter starts, scene dividers, images, footnotes, Unicode text, headers/footers and the final file in its target application.

> **Preview should be where you notice layout problems—not the exported file after submission.**
