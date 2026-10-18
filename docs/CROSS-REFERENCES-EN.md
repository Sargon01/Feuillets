# Internal cross-references

> [Français](CROSS-REFERENCES.md) · **English** · [Documentation index](README.md)

A cross-reference connects a passage to a **section, captioned image, table or appendix in the manuscript**. It can display a number, a type and number, or the current title/caption. After reordering, rendering uses the new order of the scope being viewed or composed.

These are **not CSL bibliographic citations**. “See image 2” refers to an internal manuscript element; `[@smith2024, p. 18]` refers to a bibliographic source. They can coexist, including in one footnote, but their identities and settings remain separate. Cross-references do not require the Feuillets CSL companion. See [BibTeX citations and Pandoc](BIBTEX-CITATIONS-AND-PANDOC.md).

## Create your first reference

Suppose one sheet contains:

```markdown
## Field organization

![Map of the sectors](map.png)

| Sector | Area |
| --- | ---: |
| North | 24 |
```

In another sheet in the same context:

1. Write `See ` and leave the cursor after it in the Markdown editor or Continuous.
2. Run **Cross-reference…** from the Feuillets command palette.
3. Search for the target. The list shows its type, number, title/caption and file path to distinguish identical names.
4. Choose **Type and number**, **Number** or **Title or caption**.
5. Confirm: Feuillets inserts human-readable text and saves its relationship to the target.

To **link an existing passage**, select text such as `the map above`, then run the same command. The selected Markdown is not replaced. Live Preview or Continuous may display `image 1` or `Map of the sectors`, according to your choice; placing the cursor inside reveals `the map above` for editing.

Cancelling a picker creates no relationship. If you change the text, selection or document while choosing, run the command again at the new position. References cannot overlap an already recorded relationship.

## Available targets

| Type | Recognized target | If it is missing |
|---|---|---|
| Section | A real Markdown H1–H6 heading, ATX or Setext | A heading-like line inside code or a comment is not a section |
| Image | A captioned Markdown image on its own line: `![Caption](image.png)` | An image without a caption or a simple image wikilink is not automatically a captioned figure |
| Table | A Markdown table with its header row | The target is the table, not one cell or an arbitrary HTML table |
| Appendix | A document recognized as an appendix by composition | Naming a folder “Appendix” does not replace editorial inclusion |

Targets come from the manuscript and appendices recognized in its context, rather than every vault note or Research sheet. Code blocks, YAML and comments do not provide false targets. An occurrence can itself be in body text, a cell or a footnote when its range can be safely attached.

## Why numbers change

Each type has its own counter: sections, images, tables and appendices. Included files follow Binder order; elements inside a file follow source order. A reference number is not a page number and need not match hierarchical heading numbering in an export.

The command respects the applicable project, independent work, declared workspace and isolation boundaries. Shared Research does not merge two workspaces’ identities. Continuous uses its displayed scope; Preview and export use the composition actually retained.

**Example:** a map is image 3 in the complete book but image 1 in a chapter exported alone. If that chapter does not include the target, the passage retains its human-readable text. A variant, extraction or collection that excludes a target must not count it as though it were published.

## Source text and storage

Relationships are stored in `cross-references.json` in the relevant context’s internal resources. Markdown retains human-readable text, without technical IDs or Word reference fields. Persistent identities are separate from displayed numbers.

Keep internal resources with the project when backing it up or transporting it. Copying a sentence alone to another vault does not automatically transport its relationship. The relationships file is not a document to renumber manually.

## Display and scope

In Markdown Live Preview and Continuous, decorations show resolved values. A subtle dotted underline identifies valid references. The tooltip shows the type, contextual number, current title/caption and target filename; it does not navigate. A selection or cursor inside a reference reveals its source text for editing; its attached source range keeps the subtle underline. Unresolved references do not carry this validity mark. Source mode without Live Preview and Reading mode show human-readable text; Reading mode does not offer reference insertion.

Paginated Preview and exports use their composition’s context. A target outside the composed sheet or chapter therefore leaves human-readable text in place even when it resolves in the complete manuscript. Appendix pages participate only when included.

A deleted, ambiguous or out-of-scope target, or an occurrence that cannot be safely reattached, leaves human-readable text in place. Feuillets does not silently choose another destination. File renames and moves preserve identities; heading/caption changes appear when attachment remains certain.

## Editing and saving

Native source-editor buffers and modified Continuous segments can supply current unsaved content. A Reading view does not supply its old editing buffer to resolution.

After an external change to a source that is not dirty in Continuous, stale decorations are removed. The text already assembled there remains until recomposition; reopen the scope to load the new content. This avoids applying a new file’s offsets to an old displayed document.

If saving a relationship fails, inserted human-readable text is kept and a notification reports the failure. An existing selection is not replaced. The relationship is usable only after a successful save; run the command again on the passage. Concurrent insertion overlapping a recorded relationship is rejected with an overlap notification.

## Preview, composition and exports

| Surface | Result |
|---|---|
| Markdown Live Preview | Resolved value with a subtle mark; human-readable source revealed for editing |
| Continuous | Same principle, in the assembled sheets’ context |
| Source and Reading modes | Human-readable text, without dynamic reference substitution |
| Paginated Preview | Resolved composition value; no editing underline or tooltip |
| Compiled Markdown and Pandoc package | Resolved internal references; bibliographic citekeys retained |
| DOCX, ODT, EPUB and PDF | Composed values exported as text, without recalculating reference fields |

Markdown, PDF, DOCX, ODT, EPUB and Pandoc ZIP use composition values at export time. These are exported text, not fields that update in Word or an ebook reader. Compilation changes neither source Markdown nor the relationships JSON.

Markdown and the Pandoc ZIP manuscript preserve citekeys. Native formats use the configured CSL rendering. The ZIP bundles the required bibliographies, styles and resources without running Pandoc. An unresolved CSL citation preserves its existing notation.

DOCX and ODT retain native table structures. ODT embeds resolved local PNG, JPEG, GIF and SVG images, with captions and page-appropriate dimensions. Missing or unsupported images are reported rather than replaced by invented resources. The [editor/export completion report](validation/cross-reference-export-finish.md) records the verification scope and reader-specific limits.

## If a reference stops updating

1. Check that the target still exists and belongs to the displayed/exported scope.
2. Check the type: images need recognized captions and appendices must be included.
3. After an external edit, recompose or reopen Continuous if old segments are still displayed.
4. If competing passages prevent safe attachment, clarify the context and run the command again on the intended passage. Feuillets does not guess a destination.
5. If a save-failure notice appears, retained text is not proof that the relationship was saved. Run the command again and check the result.

References are not clickable navigation links, do not calculate page numbers and do not become updating Word fields. Historical validation reports describe versions tested on their dates; they do not certify every DOCX/ODT reader or Obsidian theme.

See [Writing interface](WRITING-INTERFACE.md), [Continuous](CONTINUOUS-MODE.md), [Composition and export](COMPOSITION-AND-EXPORT.md) and [Content variants, extractions and collections](CONTENT-VARIANTS-EXTRACTIONS-COLLECTIONS.md).
