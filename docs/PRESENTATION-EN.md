# Presentation

> [Français](PRESENTATION.md) · **English** · [Documentation index](README.md)

## Same Markdown, another rendering

Presentation is not a second document to maintain.

The same Markdown can be rendered as:

- a continuous **Document**;
- a 16:9 **Presentation**.

You do not need to duplicate a course, report or talk to build slides.

## Create slides

Separate slides with:

```markdown
---
```

Example:

```markdown
# Water under pressure

A necessary resource with uneven availability.

---

## Why do uses conflict?

> [!question-directrice]
> How should domestic needs, farming and tourism be balanced?
```

## Automatic layout

Feuillets analyzes each slide and chooses a suitable layout automatically.

Main layout families are:

- **FLOW** — primary content flow;
- **SPLIT** — two areas when content is suitable;
- **STACK** — stacked composition for suitable cases.

The goal is to let the author write content instead of manually positioning every block.

## Text, headings and media

Initial headings stay above slide content.

When text and media can be paired, Feuillets can distribute space automatically based on media orientation, text volume and available space.

Ordinary Obsidian image syntax and width remain valid.

## Semantic roles

Semantic roles can help slide composition, but remain optional. Ordinary Markdown can be presented without semantic annotations.

See [Semantic roles](SEMANTIC-ROLES.md).

## Speaker notes

Use:

```markdown
> [!speaker-notes]
> Mention the 2022 drought example here.
```

Speaker notes:

- belong to the slide;
- are not projected;
- are not a Feuillets semantic role.

## Video

Presentation supports compatible video media, including MP4.

## Themes

Available themes include:

- `classic`
- `course`
- `ivory`
- `slate`
- `dark`

Themes change appearance, not content.

## Overflow

Feuillets measures rendered slide content and looks for a composition that limits overflow.

Automatic layout remains the default.

## Optional manual slide layout

When automatic layout is not appropriate, the slide layout can be overridden in Feuillets.

Choices:

- **Auto** — no override;
- `flow`;
- `columns`;
- `image-left`;
- `image-right`.

These settings are stored outside source Markdown.

If a forced layout does not apply to the current content, Feuillets falls back to automatic layout.

## Remember

Presentation remains a **rendering of Markdown**, not a parallel graphical editor.
