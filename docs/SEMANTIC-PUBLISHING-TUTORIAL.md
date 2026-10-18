# Tutorial — publish several outputs from one source

> [Français](TUTORIEL-PUBLICATION-SEMANTIQUE.md) · **English** · [Documentation index](README.md)

This tutorial explores roles, variants, extractions, collections and Presentation from one Markdown file. Allow about 15 minutes.

## 1. Create the document

Create a sheet and copy:

```markdown
# Water and territory

This paragraph is ordinary text.

> [!introduction]
> This short sequence shows how one Markdown source can supply several publications.

> [!question-directrice]
> How should competing uses of a limited resource be balanced?

## Concepts

> [!definition]
> **Usage conflict**: a situation in which several actors want to use the same resource in incompatible ways.

> [!definition]
> **Arbitration**: a decision between competing interests.

## Activity

Ordinary text introduces the activity.

> [!source]
> In a fictional town, summer water consumption increases while the river flow decreases.

> [!questions]
> 1. What is the main problem?
> 2. Which actors may be involved?

> [!solution]
> Demand increases while the available resource decreases.

> [!preuve]
> Records show peak consumption during weeks with many visitors.

> [!recommandation]
> Define restriction thresholds and priority uses in advance.

---

# Presenting the problem

> [!point-cle]
> One Markdown source can produce a document, several versions and a presentation.

> [!speaker-notes]
> Show the difference between a variant, an extraction and a collection.
```

## 2. Understand what you wrote

The file contains ordinary text, Markdown headings, several semantic roles, `---` separating slides in Presentation, and speaker notes. You do not need all these mechanisms in an ordinary project. Role identifiers stay canonical even when the prose is English.

## 3. Create a “Student” variant

Open **Edition → Composition → Manuscript → Content variants**.

Create:

- **Name**: `Student`
- excluded role: `solution`

Expected result:

- headings remain;
- ordinary text remains;
- questions remain;
- the answer disappears.

You have created another publication without copying the manuscript.

## 4. Create an “Activities” extraction

Open **Edition → Composition → Manuscript → Content extractions**.

Create:

- **Name**: `Activities`
- trigger role: `questions`

Choose `Activities` in the export toolbar’s **Content** menu.

The section containing questions is retained **with its complete context**: ordinary text, source, questions, answer, evidence and recommendation belonging to that section.

## 5. Create a “Glossary” collection

Open **Edition → Composition → Manuscript → Content collections**.

Create:

- **Name**: `Glossary`
- role: `definition`

Choose `Glossary` in **Content**.

Expected result:

- definitions remain;
- necessary headings remain;
- ordinary text outside definitions disappears.

## 6. Create an evidence pack

Create a collection:

- **Name**: `Sources and evidence`
- roles: `preuve`, `source`, `citation`

This becomes especially useful when a project contains many files.

## 7. Combine a collection and a variant

Create a collection containing `definition` and `source`, then use a variant that excludes `source`.

Definitions remain; sources disappear. The collection first selects useful blocks; the variant can then hide selected roles. An extraction and a collection remain alternative content derivations.

## 8. Choose the scope

Open **Scope** in the Edition toolbar. Depending on context, you can export a project, folder, file or available selection.

Scope answers **where?**

## 9. Choose the content

Open **Content** and choose:

- **Full document**;
- an extraction;
- a collection.

Content answers **what?**

## 10. Choose the format

Open **Format** and try PDF on desktop, DOCX, ODT or EPUB. Document formats use the derived manuscript; Markdown export remains a source export.

Use the complete toolbar path **Scope → Content → Format → Export**. Inspect the result rather than expecting every reader to reproduce identical pagination.

## 11. Open Presentation

Switch to Presentation rendering. The file’s `---` separates slides and Feuillets composes the content in 16:9.

The note:

```markdown
> [!speaker-notes]
> Show the difference between a variant, an extraction and a collection.
```

is not projected.

## 12. What you have produced

You used one source to produce:

- the complete document;
- a version without the answer;
- an activity extraction;
- a glossary;
- a source/evidence pack;
- several formats;
- a presentation.

**Write once, publish in several ways.**

For details, see [Semantic roles](SEMANTIC-ROLES.md), [Content variants, extractions and collections](CONTENT-VARIANTS-EXTRACTIONS-COLLECTIONS.md) and [Presentation](PRESENTATION-EN.md).
