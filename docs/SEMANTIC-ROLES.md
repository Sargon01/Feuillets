# Semantic roles

> [Français](ROLES-SEMANTIQUES.md) · **English** · [Documentation index](README.md)

## Principle

A semantic role describes **what a passage does**, not how it is laid out.

```markdown
> [!definition]
> A usage conflict appears when several actors want to use the same resource in incompatible ways.
```

Here, `definition` simply means: “this passage is a definition.”

Feuillets can then use that information to create content variants, select structural sections, build collections of semantic blocks, enrich Document rendering, or help automatic Presentation layout.

## Roles are optional

Ordinary text remains the normal form of the manuscript.

You do **not** need a role on every paragraph. A novel, essay, article or continuous manuscript can be written, previewed and exported without semantic roles.

A useful question is:

> **Could I want to find, hide or publish this kind of passage separately?**

If not, leave it as ordinary text.

## Syntax

```markdown
> [!role]
> Content
```

Obsidian fold variants are also recognized:

```markdown
> [!questions]+
> Questions.
```

```markdown
> [!solution]-
> Solution.
```

## The 18 canonical roles

| Role | Suggested use |
|---|---|
| `introduction` | Introduce a topic, section or approach |
| `question-directrice` | State the central question |
| `objectifs` | State goals |
| `competences` | Skills used or assessed |
| `instructions` | Instructions or procedure |
| `questions` | Questions for the reader or student |
| `solution` | Answer, correction or resolution |
| `argument` | Claim defended in reasoning |
| `hypothese` | Hypothesis to examine |
| `preuve` | Evidence supporting a claim |
| `source` | Documentary reference or information source |
| `citation` | Highlighted quotation |
| `explication` | Explanatory development |
| `definition` | Definition of a term or concept |
| `methode` | Method, approach or protocol |
| `synthese` | Structured summary |
| `point-cle` | Essential point to remember |
| `recommandation` | Proposed action or recommendation |

The role identifiers remain canonical French identifiers in Markdown, independently of the interface language.

## Ordinary Obsidian callouts

Not every Obsidian callout is a Feuillets semantic role.

```markdown
> [!note]
> An ordinary note.
```

```markdown
> [!example]
> An ordinary example.
```

remain normal Obsidian callouts.

In particular:

- `question` is an ordinary Obsidian callout;
- `questions` is a Feuillets semantic role.

## Role, structure and publishing

Keep three layers separate:

1. **Structure** — folders, files and Markdown headings.
2. **Semantics** — optional roles.
3. **Publishing** — scope, variant, extraction or collection, layout and format.

A role never replaces a Markdown heading and does not turn ordinary writing into a proprietary block model.

## See also

- [Content variants, extractions and collections](CONTENT-VARIANTS-EXTRACTIONS-COLLECTIONS.md)
- [Composition and export](COMPOSITION-AND-EXPORT.md)
- [Presentation](PRESENTATION-EN.md)
- [Tutorial — publish several outputs from one source](SEMANTIC-PUBLISHING-TUTORIAL.md)
