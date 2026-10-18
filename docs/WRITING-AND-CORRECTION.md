# Writing, formatting and correction

> [Français](ECRIRE-ET-CORRIGER.md) · **English** · [Documentation index](README.md)

Start with a Markdown sheet in the Binder. To work across several sheets as one text, use [Continuous](CONTINUOUS-MODE.md). Writing appearance, local layout exceptions and changes to the text are three different things.

## Make writing comfortable

In Feuillets settings, adjust the writing font, width, line height and paragraph indents. [Workspaces](WORKSPACES.md) offer supported local overrides. Custom writing colors can use separate background/text pairs for light and dark themes; they do not recolor all of Obsidian. **Focus Mode** temporarily reduces the interface around your text.

These preferences do not replace the publishing template. See [Writing interface](WRITING-INTERFACE.md).

## French typography and paragraphs

Editor helpers for French typography and the French typography export option serve different purposes: check both settings according to whether you want typing changes or changes in the produced document. Markdown remains the source; composition transformations are not a general rewrite of your files.

For a local publication exception, use **Layout** on an ordinary paragraph: alignment, first-line indent and spacing before/after. Each property can return to the template value without removing other exceptions. Settings are stored outside source Markdown, anchored to the passage. They do not apply arbitrarily to every block: code, tables and other structures retain their own rules.

Check the result in Preview and the destination format. Reflowable EPUB and paginated PDF do not have identical capabilities. See [Composition and export](COMPOSITION-AND-EXPORT.md).

## Find a name across several sheets

Binder search finds files. The editor’s **Search** bar navigates textual occurrences and replaces them.

1. Open a sheet in the Markdown editor in edit mode, then open Feuillets search.
2. Enter text and choose **Scope**: **Active document**, **Active folder**, **Binder selection**, **Active manuscript / work** or **Whole project**, according to context.
3. Choose case/accent options and **Contains**, **Starts with** or **Whole word**. Offered special characters include tab, paragraph and line break.
4. Navigate with **Enter** and **Shift+Enter**, or the next/previous occurrence buttons. **Escape** closes the bar.

Including YAML is explicit. **Protect Markdown syntax** preserves syntax contexts recognized by the engine; it is not a universal semantic guarantee for every Markdown extension. Check its state before replacing: search can find occurrences that replacement protections then exclude.

## Replace with control

**Example:** rename “Valmont” to “Valbrume” in three chapters without changing an identically named Research sheet.

1. Select the chapters in the Binder and choose **Binder selection**.
2. Enable **Replace**, enter the new name and check case and **Whole word** as needed.
3. Replace one occurrence to inspect an initial result, or choose **Replace all…**.
4. For multiple files, review **Before / After**, occurrence counts, skipped items and sheet counts.
5. Confirm replacement in the stated number of sheets. Cancelling the preview writes nothing.

Global scope remains editorial: technical folders, outputs and external documents do not become targets just because they share the vault. Content and scope are checked again before application. If a sheet has changed since preview, recalculate rather than forcing the old plan.

Close any Continuous view containing a target sheet before global replacement or restoration. Wait for loading/recomposition to finish. If a file is open in several native editing views, keep only one for the operation. These refusals protect against competing buffers; the replacement bar does not replace across sheets directly inside Continuous.

### Two kinds of undo

- **Active document**: replacement uses an editor transaction; undo remains the editor’s own action.
- **Global replacement**: use **Undo last global replacement**, or **Undo** in the operation summary. A durable record of originals is kept under `SearchReplace` in the project’s backup area.

Global undo checks that files still match the expected result. It can refuse if you have since edited them; it does not overwrite those changes. An error may require checking the paths and originals location reported in the notice. This mechanism does not replace a [vault backup or snapshot](REWRITING-BACKUPS-AND-VERSIONS.md).

## Correct language inside the text

The optional [Feuillets-Grammalecte](https://github.com/Sargon01/Feuillets-Grammalecte) companion can provide French diagnostics directly in the editor and Continuous. Spelling and grammar have distinct marks; left-click a diagnostic to open available corrections. Spelling suggestions can be loaded on demand. Ignoring an occurrence and adding a word to a dictionary depend on provider capabilities.

In Continuous, live checking focuses on sheets actually visible, with debouncing and workload limits. It is not an instant exhaustive analysis of the whole manuscript. **Proofreading → Text analysis** remains the entry point for broader analysis. No language provider is required for writing or export; integrations and external resources retain their own operating conditions.

## References, citations and images

- For “see image 2” or a section title, use [Cross-reference…](CROSS-REFERENCES-EN.md).
- For a bibliographic source, use `[@` or **Research → References → Cite**: see [BibTeX and CSL citations](BIBTEX-CITATIONS-AND-PANDOC.md).
- For a captioned image, use the editor’s image actions. The portable form is `![Caption](path/image.png)`, with angle brackets around paths containing spaces. Pasted images can be stored in project resources; check paths after transporting a project.
- Footnotes remain Markdown footnotes. Their inspection, insertion and numbering are separate from internal reference numbering.

For external feedback, continue with [DOCX Review](HOW-TO-DOCX-REVISION.md) or [Collaborative Review](COLLABORATIVE-REVIEW.md).

## Journal and writing progress

The **Journal** tab gives access to writing days and project-related tracking. Daily statistics are separated by project: changing manuscript should not attribute the same production to both. In settings, **Journal file suffix** can produce names such as `2026-09-15-log.md`; existing entries are not renamed. The compiled writing journal follows the language when created without requiring historical files to be renamed.
