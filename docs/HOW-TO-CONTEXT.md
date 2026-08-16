# How-to — Use Feuillets Context

> [Français](How-to-Contexte-Feuillets.md) · **English** · [Documentation index](README.md)

The **Context** section in the **Sheet** tab automatically surfaces information that may be useful around the passage you are currently writing.

It can find:

- characters, places, events or concepts mentioned in the passage;
- Research notes linked to the sheet or its folder;
- chronological information matching the sheet date;
- date/state inconsistencies;
- related documents through lexical overlap;
- references pinned for the active sheet.

Everything remains local in the Obsidian vault. Context does not use an online AI service.

## 1. Prepare Research

Create notes in **Research**, or link an existing documentary folder from anywhere in the vault to the manuscript.

A note can be found from its title, aliases, tags or content. A linked folder may remain completely outside the project: Feuillets stores the relationship without moving it.

See [Research and linked folders](RESEARCH-AND-LINKED-FOLDERS.md).

## 2. Associate documentation with the manuscript

Feuillets can use several levels:

- Research linked directly to the sheet;
- Research linked to its folder/chapter;
- general project Research.

Closer results have priority. **Full-content matching** is deliberately scoped to associated Research folders instead of continuously searching the entire documentary project for every paragraph.

## 3. Write normally

No special command is required. Feuillets mainly examines the passage around the cursor and refreshes results as you move through the text.

The goal is not to analyze the entire sheet all the time, but to bring useful information back when it is relevant.

## Context sections

### Pinned

A pinned note stays visible for the active sheet when you move to another paragraph. It is not repeated in other sections.

### Passage references

A note can be recognized from its title, an alias, a tag or an explicit reference present in the text.

### Related documents

Feuillets can match the passage against notes inside associated Research folders. Matching remains lexical and predictable: several meaningful shared terms or a distinctive phrase are normally required; one generic word is not enough.

Feuillets does not automatically assume that different words are synonyms. Use aliases or wording that actually occurs in your notes when deterministic retrieval matters.

## Chronological context

When a sheet has a date, Feuillets can use dated Research information to surface:

- a nearby event;
- a character’s age or state;
- a character already dead or not yet born;
- an anachronistic object or technique;
- another inconsistency derivable from project data.

These alerts never rewrite the manuscript. They depend on information stored in your own project and are prompts to verify, not an automatic historical authority.

## Open a note without losing the manuscript

Context entries can be previewed or opened depending on their type. In Research, a Markdown file from an **external linked folder** can also be opened in a new tab or **side by side**.

The external folder remains outside Feuillets administration: linking it does not automatically enable rename, delete or move actions.

## Why does a note not appear?

Check that:

- the cursor is in the relevant passage;
- the title, an alias, a tag or several meaningful terms match;
- the folder is linked when you expect full-content matching;
- the sheet and Research dates are recognized;
- the note is not already under **Pinned**.

## Tips

- Use precise note titles.
- Add genuinely useful aliases.
- Prefer a few descriptive tags to a giant keyword list.
- Put important information in the note body: related-document matching reads real content.
- Link an existing folder instead of moving all your documentation when your vault already has a useful structure.

## What Feuillets actually does

Context reads local Markdown and project properties. It combines explicit references, aliases, tags, linked folders, lexical overlap, dates and pinning. It does not rewrite the manuscript and does not invent semantic relationships absent from your data.

> **The passage calls its documentation; the writer decides what is actually useful.**
