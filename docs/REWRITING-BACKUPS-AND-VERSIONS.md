# Rewriting, backups and versions

> [Français](VERSIONNAGE-ET-SECURITE.md) · **English** · [Documentation index](README.md)

A manuscript does not evolve in a straight line. Feuillets separates several safety mechanisms because they solve different problems.

![Compare two states](feuillets-comparaison.png)

## ZIP backups

Automatic or manual backups are local ZIP archives under `_Backups`.

For a structured project whose active manuscript folder is actually named `Manuscrit`, the backup covers the surrounding project folder while excluding `_Backups` itself.

For a folder used as-is, Feuillets backs up **strictly that folder**. It does not include siblings or climb to the vault root.

Backup retention rotates older ZIP files according to the configured keep count.

## Sheet snapshots

A snapshot preserves the current content of one sheet under `_Snapshots`. Use it before a risky rewrite, cut, merge or experiment.

## Comparison

Comparison is for understanding additions, removals and replacements between states.

## Manuscript versions

**Duplicate as a new version** copies the manuscript under `_Versions`. Research remains shared; the purpose is to branch manuscript work, not clone the entire project bible.

Custom Binder order is copied with the version.

## Reviewed DOCX

Reviewed-DOCX reintegration is a separate workflow. It maps external review changes back to Markdown source and leaves ambiguous cases for explicit author decisions.

See [DOCX review validation](DOCX-REVIEW-VALIDATION.md).

## Which tool?

| Need | Tool |
|---|---|
| Regular local protection | ZIP backup |
| Preserve one sheet before editing | Snapshot |
| Understand changes | Comparison |
| Explore an alternate manuscript | New version |
| Reinstate Word review | DOCX review |

Feuillets backups are a local safety net, not a replacement for a full-vault backup strategy.
