# How-to — Use Feuillets Context

> [Français](How-to-Contexte-Feuillets.md) · **English** · [Documentation index](README.md)

The **Context** section inside the **Notes** tab of the Inspector automatically surfaces information that may be useful while you write a sheet.

It can find:

- characters, places, events or concepts mentioned in the current passage;
- Research notes linked to the sheet or its chapter;
- chronological information matching the sheet date;
- inconsistencies such as a character who is already dead or an anachronistic object;
- documents whose content shares several meaningful terms with the current passage;
- references you decide to keep visible by pinning them.

Everything remains local in the Obsidian vault. This feature does not use an online AI service.

![Writing with the Feuillets workspace](feuillets-ecriture-apercu.png)

---

## 1. Prepare Research notes

Create your reference notes in the **Research** tab.

Depending on the project, they can describe:

- characters;
- places;
- events;
- concepts;
- lore;
- sources;
- bibliography;
- glossary.

A Research note can be found from its title, aliases, tags or content.

### Example

```markdown
---
aliases:
  - caravan trade
tags:
  - hejaz
  - trade
---

# Caravan trade

Caravans carry spices and precious fabrics between cities.
```

---

## 2. Associate Research with the manuscript

Feuillets can use several levels of documentation:

- Research associated directly with the active sheet;
- Research associated with its chapter;
- general project Research.

The closest results are given priority.

Full-content matching is deliberately limited to Research folders associated with the sheet or chapter. It does not continuously scan every general Research note in the project.

This prevents dozens of distant notes from appearing simply because they share common words.

---

## 3. Write normally

No special command is required.

Feuillets examines the passage around the cursor:

- usually the current paragraph;
- with some nearby context when the paragraph is very short.

It does not continuously analyze the entire sheet. Results therefore follow the passage you are actually working on.

### Example

Current manuscript passage:

> The merchants unloaded their fabrics and spices before nightfall.

Associated Research note:

> Caravans carry spices and precious fabrics between cities.

Even if the title **Caravan trade** is not mentioned, the note can appear under **Related documents** because several meaningful terms overlap.

---

# Context sections

## Pinned

This section contains notes you deliberately keep visible for the active sheet.

A pinned note:

- stays visible when you move to another paragraph;
- is attached only to this sheet;
- is not duplicated in the other Context sections;
- can still be opened or previewed normally.

Pinning is useful when one reference must remain under your eyes throughout an entire scene.

### Example

You are writing a scene set in Arabia and want the **Arabia** note to stay visible even when the current paragraph is about another subject.

Use the pin action on that note. Use it again to remove the pin.

---

## Passage references

This section contains elements recognized with high confidence.

A Research note can appear because the passage contains:

- its title;
- an alias;
- its name;
- a relevant tag;
- an explicit reference.

### Example

Research note:

```markdown
---
aliases:
  - Hejaz
---

# Western Arabia
```

Passage:

> The caravan finally reached the Hejaz.

The note can be recognized through the alias **Hejaz**.

References are recalculated when the cursor moves to another passage.

---

## Related documents

This section complements explicit references.

Feuillets searches the content of Research notes that belong to folders associated with the active sheet or its chapter.

A document normally needs:

- at least two meaningful shared terms;
- or a distinctive multi-word expression.

One generic word such as `city`, `road`, `house` or `trade` is not enough.

### Positive example

Passage:

> The merchants unloaded their fabrics and spices.

Research note:

> Caravans transport spices and precious fabrics.

The shared words `fabrics` and `spices` can support the match.

### Example without a result

Passage:

> The merchants brought textiles and spices.

Research note:

> Caravans transport fabrics and spices.

If the only exact significant common term is `spices`, Feuillets does not automatically infer that `textiles` and `fabrics` are synonyms. Matching remains lexical and predictable.

---

# Chronological context

When a sheet has a date, Feuillets can use it to surface relevant historical or narrative information.

The date appears with the Context references.

### Example

```yaml
---
date: 1826-06-15
---
```

A nearby event can then be displayed before ordinary references.

---

## Character age and state

A Character note can contain birth, death or dated state information.

Feuillets can use the sheet date to estimate the character state at that point in the story.

### Example

```yaml
---
birth: 1770
death: 1815
---
```

Sheet:

```yaml
---
date: 1826-06-15
---
```

If the character is mentioned in the passage, Context can indicate that the person has been dead since 1815.

Compatible age or state information remains secondary. A serious inconsistency receives a visible alert.

---

# Chronological alerts

Feuillets can signal cases such as:

- character already dead;
- character not yet born;
- impossible age;
- historical state incompatible with the sheet date;
- object or technique that appears after the date of the scene.

These alerts are not a historical truth engine. They are derived from dates and states available in your own project files. Their usefulness therefore depends on the information you have entered.

---

# Preview and open a Research note

Context entries are meant to stay lightweight.

Depending on the entry and the active interface, you can:

- preview the note;
- open it;
- pin it;
- follow the underlying Markdown link.

The aim is to keep the manuscript in focus while making supporting information reachable.

---

# Show more

Context deliberately limits the amount of information initially displayed.

When more results exist, use the available expansion action rather than forcing the entire project bible into the side panel.

This keeps the writing surface readable.

---

# Why does a note not appear?

## The cursor is in another passage

Context follows the current passage. Move the cursor into the paragraph where the reference matters.

## Only one generic word is shared

Content matching requires stronger evidence than one common word.

## The words are synonyms only

Matching is lexical, not semantic AI search. Use the same important term, an alias, a tag or an explicit link when you need deterministic retrieval.

## The note is outside associated Research

Full-content matching is intentionally scoped. Associate the relevant Research folder with the sheet or chapter if you want its contents considered.

## The date is not recognized

Check the date property and the date information in the related Research note.

## The note is already pinned

A pinned note is not repeated in other Context sections.

---

# Tips for better results

## Use precise titles

Prefer `Caravan routes of the Hejaz` to a generic title such as `Routes`.

## Add useful aliases

Aliases are valuable for alternate spellings, titles, historical names and abbreviations.

## Add a few relevant tags

Tags can help recognition, but a giant keyword list usually makes the project less readable.

## Put important information in the body

Context can use the actual text of associated Research notes. Write useful prose instead of treating notes as empty metadata containers.

## Avoid artificial keyword lists

The aim is not to game the matching system. Keep Research notes useful to a human reader first.

---

# Complete example

## Research note

```markdown
---
aliases:
  - Hejaz trade
tags:
  - caravans
  - spices
---

# Caravan trade

Caravans carry spices, fabrics and precious goods between cities.
```

## Sheet

```markdown
---
date: 1826-06-15
---

The merchants unloaded their fabrics and spices before nightfall.
```

## Possible result

Context may show the Research note because the passage shares several significant terms. If another referenced character has a dated state incompatible with 1826, a chronological alert may appear above it.

---

# What Feuillets actually does

Context is intentionally conservative:

- it reads local Markdown and properties;
- it uses explicit links, aliases, tags, associated Research and lexical overlap;
- it uses dates and states available in project files;
- it prioritizes the passage around the cursor;
- it allows pinning;
- it does not rewrite the manuscript;
- it does not send text to an online service;
- it does not invent semantic relationships that are absent from the project.

The purpose is simple: **bring the right project information close to the sentence being written without turning the Inspector into another database to manage.**
