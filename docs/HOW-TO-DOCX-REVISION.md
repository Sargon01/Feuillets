# How-to — Review a Word manuscript with Feuillets

> [Français](HOW-TO-REVISION-DOCX.md) · **English** · [Documentation index](README.md)

**DOCX Review** now lives under **Proofreading → DOCX Review**.

Principle: **write in Feuillets → export DOCX → review in Word → handle the return in Proofreading → keep Markdown as source**.

## 1. Export

Export a sheet, folder, selection or project as DOCX from the Edition toolbar or the corresponding export command. Starting from a Feuillets-generated DOCX improves mapping back to source sheets.

## 2. Review in Word

The reviewer can use tracked changes, comments/replies, additions, deletions, replacements, cut/paste and footnote corrections.

## 3. Open DOCX Review

Open **Proofreading**, then **DOCX Review**. The dedicated Obsidian command opens the same place.

## 4. Analyze the return

Choose the returned `.docx` and analyze it. Feuillets groups changes, moves, comments and items that need verification.

## 5. Decide

Safe changes can be accepted or rejected. Comments can be inspected and marked handled. Moves expose origin and destination. Uncertain mappings remain manual rather than being forced.

## 6. Cut/paste and moves

Feuillets can recognize explicit Word moves and some cut/paste operations represented as deletion + insertion, including cross-sheet moves.

## 7. Snapshots

Before the first change to a sheet in a review session, Feuillets attempts to preserve a return point. Cross-sheet moves prepare the necessary protections before writing.

## 8. Footnotes

Tracked changes inside Word footnotes are analyzed and Markdown footnote label collisions are avoided when notes move between sheets.

## DOCX Review or Collaborative review?

- **DOCX Review**: the other person works in Word.
- **Collaborative review**: both participants use Feuillets and exchange `.feuillets` packages.
