# Tutorial — publish several outputs from one source

> [Français](TUTORIEL-PUBLICATION-SEMANTIQUE.md) · **English** · [Documentation index](README.md)

This short tutorial introduces semantic roles, variants, extractions, collections and Presentation using one Markdown source.

## 1. Start with ordinary Markdown

Create a sheet containing headings, ordinary paragraphs and a few semantic callouts such as:

```markdown
> [!definition]
> A definition.

> [!questions]
> A question.

> [!solution]
> An answer.

> [!source]
> A source.
```

Semantic roles are optional; ordinary text remains the default.

## 2. Create a student variant

Open:

**Edition → Composition → Manuscript → Content variants**

Create `Student` and exclude `solution`.

The structure, ordinary text and questions remain; solutions disappear.

## 3. Create an activity extraction

Open **Content extractions** and create one triggered by `questions`.

The whole structural section containing the questions is kept, including ordinary text and other blocks in that section.

## 4. Create a glossary collection

Open **Content collections** and create `Glossary` using `definition`.

Only definition blocks and the heading context required to understand them remain.

## 5. Use the export toolbar

The compact toolbar follows:

**Scope → Content → Format → Export**

- **Scope** answers “where?”
- **Content** chooses full document, extraction or collection.
- **Format** chooses the output format.

## 6. Combine collection and variant

Use a collection containing `definition + source`, then a variant excluding `source`.

Definitions remain and sources disappear.

## 7. Presentation

Use:

```markdown
---
```

to start a new slide.

Use:

```markdown
> [!speaker-notes]
> Private speaking note.
```

for notes that belong to the slide but are not projected.

## 8. Remember

One Markdown source can produce a full document, a reduced variant, structural extractions, semantic collections, several document formats and a 16:9 presentation.

**Write once, publish in several ways.**
