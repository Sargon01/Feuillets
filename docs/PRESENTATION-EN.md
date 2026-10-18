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

`---` belongs to the presentation Markdown. Fine layout overrides, by contrast, remain outside source Markdown.

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

For example, an Obsidian image can retain its requested width:

```markdown
![[illustration.png|690]]
```

## Two text blocks

When two direct blocks suit a split, Feuillets can choose two columns and measure several proportions before selecting a fit.

## Long quotations

Long quotations can use a more compact profile to limit overflow without changing their content.

## Semantic roles

Semantic roles can help slide composition, but remain optional. Ordinary Markdown can be presented without semantic annotations.

See [Semantic roles](SEMANTIC-ROLES.md).

Groups of callouts can also help composition without requiring coordinates or columns in Markdown. Semantic annotations remain optional: ordinary text is valid slide content.

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

Feuillets considers a compatible video’s real dimensions before finalizing the layout.

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

The manual choices have distinct purposes:

- `flow` forces the main flow;
- `columns` asks for columns when content is compatible;
- `image-left` places eligible visual media on the left;
- `image-right` places it on the right.

## Complete example

```markdown
# Conflicting uses

> [!introduction]
> One resource can meet several competing needs.

---

## Three actors, three priorities

> [!argument]
> Residents want reliable drinking water.

> [!argument]
> Farmers depend on irrigation.

> [!argument]
> Tourism increases summer consumption.

> [!speaker-notes]
> Ask the class for reactions before the next slide.

---

## What should be decided?

> [!question-directrice]
> Which uses should take priority during a shortage?

> [!recommandation]
> Define thresholds and priorities before a crisis.
```

Write the content; use automatic composition first, and inspect slides that are still too dense.

## Remember

Presentation remains a **rendering of Markdown**, not a parallel graphical editor.
