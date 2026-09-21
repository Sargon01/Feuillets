# Feuillets 3.0.2

> [Français](VERSION-3.0.2.md) · English · [Documentation index](README.md)

Feuillets 3.0.2 expands Research workflows with direct document attachments and file imports, connects quick drafts to full project structure, and completes full bilingual French and English internationalization.

## Research and file interactions

- **Document attachments**: Research now accommodates non-Markdown reference material alongside notes, including PDF files, office documents (DOC, DOCX, ODT, RTF), spreadsheets (XLS, XLSX, ODS, CSV, TSV), presentations (PPT, PPTX, ODP), EPUB books, images, and Excalidraw drawings.
- **Direct preview and opening**: Clicking an attachment opens it directly via Obsidian's viewers.
- **File import and reordering**: External files can be imported directly into Research folders, and items and subfolders can be manually reordered.
- **Streamlined row interactions**: Enhanced row actions and a quick "+" menu make adding notes and documents faster.

## Quick drafts workflow

- **Move drafts to project**: A dedicated action and modal allow moving a quick draft directly into any target folder or chapter of the manuscript, within the current project or into another project in the vault.
- Automatic numeric suffixing prevents overwriting existing files when moving drafts.

## Complete French/English internationalization

- **Bilingual interface**: Feuillets fully supports French and English interfaces, with English serving as the standard technical fallback.
- **Locale-aware project creation**: New projects automatically generate folders and default names according to the active interface language (e.g. `Manuscript`, `Research`, `Characters` in English; `Manuscrit`, `Recherche`, `Personnages` in French).
- **Stable taxonomy**: Built-in statuses, labels, and filters are localized for display while maintaining language-independent internal identities.
- **Recognition of existing projects**: Previously created French and English projects are automatically detected and preserved.
- **Safe language switching**: Switching interface language in Obsidian never renames existing vault folders or alters user content.
