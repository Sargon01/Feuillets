# Replace Aeon Timeline with Feuillets

> [Français](Remplacer-Aeon-Timeline-par-Feuillets.md) · **English** · [Documentation index](README.md)

You use Aeon Timeline to build story chronology, follow characters, compare chronological order with narrative order, verify ages and observe plot lines.

You want to know whether Feuillets can bring that workflow directly into Obsidian without maintaining a separate application and synchronizing two versions of the same project.

The answer is: **yes for a large part of chronology work that is directly tied to a manuscript**, but **Feuillets does not replace the full power of Aeon Timeline as a specialized temporal-modeling application**.

Aeon Timeline is designed first to model events, entities, relationships and complex calendars. Feuillets is designed first to write, structure and revise a book. Its Timeline exists mainly to support narrative continuity.

![Cards, Outline, Storyline and Timeline](feuillets-mosaique-narrative.png)

---

## 1. Find Timeline View again

In Feuillets, use **Timeline**.

It can bring together:

- dated manuscript scenes;
- historical or narrative events;
- milestones;
- start and end dates when available;
- associated characters, places or tags;
- events stored in Research.

### Main equivalents

| Aeon Timeline | Feuillets |
|---|---|
| Timeline View | Timeline |
| Event | Dated scene or Research event |
| Milestone | Milestone |
| Grouping | Grouping/filter |
| Inspector | Properties and Research |
| Timeline file | Feuillets project |
| Calendar marker | Milestone or historical event |

The important difference is that a manuscript scene on the Feuillets Timeline is also a real Markdown sheet in the book.

---

## 2. Find events again

An event can be represented in two ways.

### A manuscript scene

```yaml
---
date: 1826-06-15
date_end: 1826-06-16
place: Suvasa
characters:
  - Kali
  - Deli
threads:
  - tekke-attack
---
```

The file contains the text actually read in the manuscript.

### A Research event

An event can exist in the story world or historical context without being narrated as a scene:

```yaml
---
type: event
date: 1826-06-15
tags:
  - janissaries
  - ottoman-empire
---
```

This distinction separates **what happens** from **what is actually told**.

Feuillets can reuse historical event-folder names such as `Événements`, `Events`, `Chronologie`, `Timeline`, `Chronology` and `_Chronologie`.

---

## 3. Find entities again

Characters, places and other entities live in **Research**.

You can create notes for:

- characters;
- places;
- events;
- organizations;
- objects;
- concepts;
- lore;
- historical sources;
- narrative threads.

| Aeon Timeline | Feuillets |
|---|---|
| Person | Character Research note |
| Location | Place Research note |
| Story Arc | Narrative thread |
| Project | Project or subplot |
| Item Type | Research category/type |
| Entity Properties | Markdown properties |
| Birth/Death | Birth/Death properties |
| Relationship | Property, tag or link |

Feuillets uses ordinary Markdown rather than a dedicated relational database.

---

## 4. Find relationships between events and entities again

Use combinations of:

- Markdown links;
- properties;
- tags;
- associated characters;
- associated places;
- narrative threads;
- Research references.

Example:

```yaml
---
characters:
  - Kali
  - Deli
places:
  - Suvasa
threads:
  - disappearance-of-the-janissaries
---
```

Or in prose:

```markdown
Kali joins [[Deli]] in the streets of [[Suvasa]].
```

These relationships can feed:

- Notes → Context;
- Timeline;
- Storyline;
- Outline;
- Obsidian search;
- backlinks.

### Difference

Aeon has a configurable formal relationship model with roles.

Feuillets uses a simpler, more readable file-based model. It is easier to inspect outside the application but less sophisticated for complex relationship semantics.

---

## 5. Find Narrative View again

Feuillets separates chronological and narrative order naturally.

### Chronological order

Timeline sorts dated scenes by date.

### Narrative order

Binder stores the order in which the reader encounters those same scenes.

This makes it possible to spot:

- flashbacks;
- ellipses;
- anticipations;
- out-of-order scenes;
- periods missing from the narrative.

Example:

```text
Chronological:
1815 — Deli dies
1820 — Kali arrives
1826 — Attack on the tekke

Narrative:
Chapter 1 — Attack on the tekke
Chapter 2 — Memory of Kali's arrival
Chapter 3 — Revelation of Deli's death
```

This is one of the areas where Feuillets most closely overlaps Aeon's manuscript-oriented workflow.

---

## 6. Find story arcs again

Feuillets uses **narrative threads**.

A sheet can belong to one or several threads:

```yaml
---
threads:
  - hikmet-secret
  - ramazan-disappearance
  - kemal-investigation
---
```

Storyline can then show where a thread appears, disappears, develops, overlaps with others or leaves gaps.

| Aeon Timeline | Feuillets |
|---|---|
| Story Arc | Narrative thread |
| Plotline | Thread / label / tag depending on use |
| Narrative structure | Binder + Storyline |

### Difference

Aeon can model arcs as first-class entities. Feuillets keeps them closer to manuscript organization and readable metadata.

---

## 7. Follow characters through time

Character Research notes can store birth, death and dated states.

Scenes can reference characters through properties, links or tags.

Feuillets can then use dates to support:

- age at a scene date;
- whether a character is alive;
- known state at that point;
- appearances across the Timeline.

### Difference

Aeon performs deeper temporal entity modeling. Feuillets focuses on the continuity questions most directly useful while writing.

---

## 8. Follow places and movements

Scenes can have place properties and Research links.

Timeline, Outline, search and Context can help inspect where a character is at a given moment.

### Honest limit

Feuillets is not a dedicated geographic movement simulator. Complex travel constraints, routes or spatial reasoning remain better handled by specialist tools or project-specific notes.

---

## 9. Find custom calendars again

Aeon Timeline supports sophisticated custom calendars.

Feuillets works best when dates can be represented in project properties and parsed consistently.

### Feuillets works well for:

- standard calendar dates;
- historical chronology;
- relative narrative sequencing;
- dated scene continuity;
- simple project-specific conventions that remain readable.

### Aeon remains stronger for:

- elaborate fictional calendars;
- custom eras with complex month/day systems;
- calendar conversion;
- deeply modeled non-Gregorian systems.

This is a major area where Feuillets should not claim parity.

---

## 10. Find durations again

Sheets and events can have start/end information where the project uses it.

Timeline can represent ranges or ordering according to the data available.

### Difference

Aeon treats duration as a central temporal model. Feuillets treats it as manuscript metadata useful when present.

---

## 11. Find dependencies again

Feuillets can represent dependencies informally through:

- links;
- properties;
- notes;
- threads;
- ordering;
- Context.

### Example

A scene note might record that Event B cannot happen before Event A.

### Honest limit

Feuillets does not provide a full temporal constraint solver. If your project depends on dependency propagation and automatic date recalculation, Aeon remains stronger.

---

## 12. Find Relationship View again

There is no single identical Feuillets view.

Use the right tool for the question.

### To inspect one note's links

Use Obsidian links and backlinks.

### To explore relations visually

Use Canvas or the Notebook.

### To inspect narrative relations

Use Storyline, labels, tags and threads.

### To inspect temporal relations

Use Timeline and Context.

### Difference

Aeon centralizes relationships in a specialized model. Feuillets distributes them across Markdown, Obsidian and manuscript-oriented views.

---

## 13. Find Subway View again

Storyline is the closest manuscript-oriented analogue.

It can make several narrative threads visible across a sequence of scenes.

### Difference

It is not a clone of Aeon's Subway visualization. Its purpose is to help assess the distribution of story threads in the actual manuscript.

---

## 14. Find Spreadsheet View again

Use **Outline**.

Outline can display manuscript hierarchy and selected properties in columns.

This can include:

- dates;
- characters;
- places;
- status;
- labels;
- progress;
- targets;
- other project properties.

---

## 15. Find Outline View again

Use the Binder and Outline together.

Binder provides hierarchy and narrative order.

Outline gives a tabular view of the same files.

---

## 16. Find Mindmap View again

Use Obsidian Canvas and the Feuillets **Notebook**.

The Notebook can:

- capture free ideas;
- group cards;
- build Idea Trees;
- turn branches into manuscript outlines;
- keep visual thinking separate from the real Binder until you choose to materialize it.

### Feuillets advantage

The same Canvas can gradually produce real Markdown structure.

### Aeon advantage

Aeon integrates mind mapping into its dedicated temporal/entity model.

---

## 17. Find split-screen work again

Obsidian panes can keep Timeline, Research, manuscript and Preview visible in combinations that suit the current task.

Feuillets does not require a separate application window to compare chronology with prose.

---

## 18. Find notes, tags and properties again

A scene or Research note can combine prose and properties.

Example:

```yaml
---
date: 1826-06-15
characters:
  - Kali
place: Suvasa
threads:
  - tekke-attack
status: revision
---
```

The data remains human-readable in the Markdown file.

---

## 19. Find attachments again

Images and other resources can remain ordinary vault files under project Resources or another folder.

Research notes can link or embed them through normal Obsidian mechanisms.

---

## 20. Find search and filters again

Use:

- Binder search;
- title/content search;
- status filters;
- label filters;
- progress filters;
- tags;
- Obsidian search;
- filtered Timeline/Storyline/Outline views.

### Difference

Aeon can query a more formal entity model. Feuillets searches readable project files and their metadata.

---

## 21. Find synchronization with Scrivener or Ulysses again

### With Aeon Timeline

The chronology may live in Aeon and require synchronization with the writing application.

### With Feuillets

The chronology and manuscript are already in the same Obsidian project.

A scene date belongs to the same Markdown file whose prose you are writing.

There is no separate chronology database to keep synchronized.

---

## 22. Find direct manuscript integration again

In Feuillets, chronology and text live in the same environment.

You can:

- open a scene from Timeline;
- edit its text;
- change its date;
- update characters;
- inspect synopsis;
- see narrative order;
- reread its chapter;
- export the manuscript.

This is Feuillets' main advantage for writers who do not want to maintain several applications.

---

## 23. Find continuity checks again

**Notes → Context** can turn chronology into an active writing aid.

While you write, it can surface:

- scene date;
- character age;
- latest known state;
- nearby historical event;
- Research related to the passage;
- character already dead;
- character not yet born;
- anachronistic object;
- technique unavailable at that date.

Example:

```text
15 June 1826

⚠ Deli
Dead since 1815

Abolition of the Janissary corps
Historical event close to this date…
```

The exact alerts depend on the information stored in your own project.

---

## 24. Find character calendars again

A character's appearances can be followed through:

- backlinks;
- manuscript links;
- character properties;
- tags;
- project search;
- Outline;
- filtered Timeline;
- Storyline.

Filtering Timeline on one character can help follow first appearance, movements, major events and chronological inconsistencies.

---

## 25. Compare several chronologies again

Feuillets can approximate this through:

- character filters;
- thread filters;
- tags;
- Storyline;
- project views;
- several Feuillets projects;
- different Timeline scopes;
- Outline.

### Limit

It is less suited to comparing many fully independent timelines or highly complex non-narrative temporal datasets.

Aeon remains more general and specialized here.

---

## 26. Find templates again

Feuillets can use:

- project modes;
- Research note templates;
- Markdown properties;
- Template folders;
- view configuration;
- export templates.

Example Character note:

```markdown
---
type: character
birth:
death:
places:
tags:
---

# Name

## Description

## Timeline

## Relationships

## Notes
```

### Difference

Aeon can configure a much more formal data model.

Feuillets templates are more open and portable, but less strict.

---

## 27. Find backups again

Feuillets provides:

- sheet snapshots;
- project snapshots where applicable;
- ZIP backups;
- version comparison;
- restoration workflows;
- ordinary vault backup;
- Git or other external systems.

For an as-is project, backup scope remains the active project folder. For a structured project whose active manuscript folder is `Manuscrit`, the backup covers the parent project.

---

## 28. Use the project on several devices

Feuillets works inside Obsidian. Availability and comfort depend on the feature and device.

### Aeon advantage

- dedicated standalone application;
- specialized mobile experience;
- purpose-built timeline interaction.

### Feuillets advantage

- same Markdown files;
- compatibility with the user's chosen Obsidian/file synchronization;
- no separate chronology file detached from the manuscript.

Complex Feuillets views may still be more comfortable on desktop.

---

## 29. Export and share

Feuillets can export the manuscript and compiled documents.

Chronological information remains accessible in Markdown and project views.

### Limit

Feuillets does not necessarily offer a direct equivalent of an interactive read-only Aeon timeline file.

For sharing chronology, practical options may include Markdown, PDF, screenshots, tables or a shared Obsidian vault, depending on the intended audience.

---

# Equivalent daily workflow

## Aeon Timeline with Scrivener

```text
Open timeline
→ add or move event
→ associate characters, places and arcs
→ check dates and ages
→ reorder Narrative View
→ synchronize with Scrivener
→ open Scrivener
→ write scene
→ synchronize again
```

## Feuillets

```text
Open project
→ create or select sheet
→ add date/properties when useful
→ observe it in Timeline
→ check narrative order in Binder
→ associate characters, places and threads
→ write the scene
→ consult Notes → Context alerts
```

Chronology is no longer a separate stage from writing.

---

# Novel-preparation workflow

## With Aeon Timeline

```text
Create events
→ create characters and places
→ link events to entities
→ define arcs
→ organize Narrative View
→ synchronize with writing application
```

## With Feuillets

```text
Create Research notes
→ build events or scenes
→ assign dates, characters, places and threads
→ compare Timeline and Binder
→ organize manuscript
→ write directly in sheets
```

---

# What you gain by moving to Feuillets

## One project

Manuscript, chronology, characters and documentation live in the same vault.

## No intermediate synchronization

The dated scene and the written scene are the same file.

## A Timeline linked to actual prose

Chronological data is not detached from the manuscript unit it describes.

## Continuity checks while writing

Context can surface age, state and anachronism warnings directly beside the current passage.

## Open files

The underlying information remains Markdown and ordinary folders.

## Obsidian ecosystem

Links, backlinks, Canvas, plugins and search remain available.

## The complete book cycle

The same project continues through writing, revision, composition, export and editorial DOCX return.

---

# What you lose or change

## A specialized temporal engine

Aeon remains stronger at deep temporal modeling.

## A formal relationship model

Feuillets relationships are more open and less strict.

## Specialized visualizations

Feuillets does not clone every Aeon view.

## Advanced multi-timeline comparison

Aeon remains better for complex independent timelines.

## A dedicated standalone/mobile timeline application

Feuillets inherits Obsidian's environment rather than shipping a separate chronology app.

---

# Can Feuillets really replace Aeon Timeline?

## Probably yes when you mainly use Aeon to:

- date scenes;
- compare chronological and narrative order;
- follow character ages;
- associate characters and places;
- track narrative threads;
- check continuity;
- keep historical events beside a manuscript.

## Feuillets may be better suited when you want:

- chronology and prose in one project;
- no synchronization between timeline and manuscript;
- Context alerts while writing;
- open Markdown files;
- one workflow through export and editorial revision.

## Aeon Timeline will probably remain preferable when you need:

- complex custom calendars;
- advanced temporal constraints;
- formal relationship modeling;
- specialized timeline visualizations;
- sophisticated comparison of several independent chronologies.

---

# Recommended transition

## 1. Do not delete the Aeon timeline

Keep it as reference during migration.

## 2. Export the useful data

Identify dates, events, characters, places and relationships that truly matter to the manuscript.

## 3. Separate scenes from events

Decide which items are manuscript sheets and which should remain Research events.

## 4. Recreate characters and places

Use Research notes with readable properties.

## 5. Recreate essential relationships

Prefer links, properties, tags and threads that are useful during writing.

## 6. Check Timeline

Verify dates and event order.

## 7. Check Binder

Verify narrative order.

## 8. Test one character

Confirm appearances, dates and Context behavior.

## 9. Test one narrative thread

Confirm it remains understandable across Storyline and manuscript order.

## 10. Work in parallel

Keep Aeon available until you are confident that the Feuillets project contains all chronology information you actually use.

---

# Quick correspondence table

| Need | Aeon Timeline | Feuillets |
|---|---|---|
| Event chronology | Timeline View | Timeline |
| Narrative order | Narrative View | Binder |
| Story arcs | Story Arcs | Narrative threads / Storyline |
| Character age/state | Entity timeline | Research + Context |
| Entity data | Entity model | Markdown Research notes |
| Relationships | Relationship model | Links/properties/tags |
| Spreadsheet | Spreadsheet View | Outline |
| Mind map | Mindmap | Notebook / Canvas |
| Manuscript link | Synchronization | Same Markdown sheet |
| Complex calendar | Strong | Limited |
| Temporal constraints | Strong | Limited |
| Open source files | Export/sync needed | Native Markdown |

---

# Verdict

Feuillets does **not** aim to become Aeon Timeline inside Obsidian.

For a novelist who mainly uses Aeon to keep a manuscript chronologically coherent, Feuillets can absorb a large part of the workflow because the Timeline, Research, Binder and prose all refer to the same files.

For projects whose primary problem is temporal modeling itself — complex calendars, constraint propagation, formal entity relations or multiple independent chronologies — Aeon Timeline remains the more specialized tool.

The key distinction is simple:

> **Aeon models time first. Feuillets writes the book first and uses time to keep the book coherent.**
