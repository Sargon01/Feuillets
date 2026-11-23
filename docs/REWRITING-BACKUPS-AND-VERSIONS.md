# Rewriting, backups and versions

> [Français](VERSIONNAGE-ET-SECURITE.md) · **English** · [Documentation index](README.md)

Feuillets keeps several mechanisms separate because they solve different problems.

## Rewrite history and formatting marks

In **Settings → Interface → Appearance**, enable **Automatic history** (off by default), then write normally in Markdown or Continuous mode. Each sheet’s changes are grouped into interventions by a configurable inactivity period (10 minutes by default); before and after states are stored locally. A word-count change does not capture every rewording.

In **Journal**, expand sheet groups in Binder order and page through earlier interventions. In **Sheet**, open the current document’s history directly; in Continuous mode it follows the sheet under the cursor. Select an intervention to compare its before and after states, or **Compare to current** to compare its ending with the current text. Comparisons are read-only and passages can be selected and copied. The unsaved Markdown editor buffer is used when available; Continuous mode compares against the last saved state. Refreshes preserve navigation, focus and scrolling. Turning the option off keeps existing history, which is excluded from `.feuil` exports.

History lets you inspect successive steps; it is neither a guaranteed backup nor automatic restoration. **Manual snapshots** provide reference points and passage restoration; **manuscript versions** explore another editorial direction; **ZIP backups** protect against file loss. See the [history guide](REWRITE-HISTORY.md) for recovery limits.

In **Interface → Appearance**, **Show formatting marks**, or the **Show/hide formatting marks** command, displays spaces, tabs and paragraph-end marks in Markdown and Continuous editors. This optional display changes neither Markdown text nor Preview.

## Backups

ZIP backups protect project files. An as-is folder is backed up within its own scope; a structured project around `Manuscrit` may cover the surrounding project folder. The backup destination is excluded from its own archive.

## Snapshots

A snapshot marks a precise state of one sheet or the project before risky rewriting. It is a comparison/restoration point.

For a major rewrite, the recommended workflow is straightforward: **take a snapshot → rewrite normally → Compare a version → restore only the passages you need**. The snapshot does not block writing or replace the current file; it provides a reference state you can return to locally if the new direction does not work.

## The 2.5 comparison view

The comparison view is now a real two-editor surface.

### Changes mode

It displays additions, deletions, replacements and **moves**, including cut/paste cases that can initially look like a deletion plus insertion.

Additions/deletions with no visible counterpart use a `[…]` marker. Moves receive stable numbering and direction markers.

You can move to previous/next difference, double-click a diff passage to recenter both views, restore a passage from a snapshot, close the action card, and enable/disable **linked scrolling**.

### Versions mode

**Versions** removes diff decorations so both states can be read as ordinary text. Switching mode never changes files.

## Manuscript versions

**Duplicate as new version** copies the manuscript into the versions area and preserves structural order. Research remains shared rather than duplicated.

## Working annotations

Annotations are not versions. They mark passages to revisit and stay outside Markdown.

See [Working annotations](WORKING-ANNOTATIONS.md).

## Collaborative review

Native reviewer returns reuse the comparison grammar but remain attached to a collaborative review session and its note threads.

See [Collaborative review](COLLABORATIVE-REVIEW.md).

## DOCX Review

Word feedback is a separate workflow: Feuillets analyzes tracked changes/comments and maps them back to Markdown when confidence is sufficient.

See [DOCX Review](HOW-TO-DOCX-REVISION.md).

## Which tool?

| Need | Tool |
|---|---|
| Regular safety net | ZIP backup |
| Mark one precise state | Snapshot |
| Understand changes | Comparison |
| Explore an alternative direction | New manuscript version |
| Leave a personal reminder | Working annotation |
| Exchange natively with a Feuillets reviewer | Collaborative review |
| Bring Word feedback back | DOCX Review |
