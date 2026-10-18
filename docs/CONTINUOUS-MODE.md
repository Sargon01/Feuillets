# Continuous mode

> [Français](MODE-CONTINU.md) · **English** · [Documentation index](README.md)

**Continuous** mode lets you write across several sheets as one manuscript without merging the source files.

## Principle

Open a file, folder, selection or Binder scope. Feuillets builds one continuous document in **a single CodeMirror editor**.

Every sheet remains a separate Markdown file. Boundaries are visible and protected; edits are redistributed to the corresponding source file.

## What Continuous avoids

- no technical composite file in the vault;
- no duplicated manuscript;
- no batch of dozens of Obsidian tabs;
- no proprietary document format.

## Opening Continuous

Use the Binder to open a folder or scope continuously. A selection can form a common scope, and folder isolation can narrow the working context before opening or exporting.

## Editing

The complete continuous document is genuinely editable. Sheet boundaries cannot be deleted or moved as ordinary text. Changes inside a segment are saved back to that segment's source file.

Markdown headings from H1 to H6 render properly in Continuous. Its own context menu offers Cut, Copy, Paste, footnotes, **Annotation…**, **Capture an idea** and **Reorder text**.

### Reorder text

**Reorder text** enters a local editor mode. Hover a paragraph to drag and drop it, or move a selection contained within one paragraph as a fragment. The insertion point is shown visually; press **Escape** to leave the mode, and each move is a single Undo step.

Exact Markdown is preserved. In Continuous, a paragraph or fragment remains in its source sheet: no move crosses a sheet boundary. Undo/Redo remain those of the Continuous document.

## Continuous and Preview

Continuous can work beside **Preview** on the same scope. Updated source bodies are reflected in Preview and scope/navigation synchronization is preserved without creating a new Preview every time.

## Good uses

- reread and correct a whole chapter;
- write across scene boundaries;
- inspect transitions;
- work on a collection or selection;
- keep Binder structure while regaining the feeling of one long document.

## References, citations and correction

**Cross-reference…** works at the cursor or on selected text. Resolved values follow the Continuous scope; placing the cursor inside reveals human-readable source text. Dotted marks and tooltips identify valid references without making them clickable links. After an external change to a source not locally modified, stale marks are removed; recompose the scope to load new content. See [Cross-references](CROSS-REFERENCES-EN.md).

Bibliographic Pandoc citations remain separate: `[@` and **Research → References → Cite** use the current sheet’s context. Insertion follows the selected parenthetical or footnote mode; a citation already inside a note stays there. Frontmatter and sheet boundaries remain protected. See [BibTeX and CSL citations](BIBTEX-CITATIONS-AND-PANDOC.md).

Optional live language checking can follow sheets actually visible. For global search/replace, open a Markdown sheet and close Continuous views containing targets before application or restoration. See [Writing and correction](WRITING-AND-CORRECTION.md).
