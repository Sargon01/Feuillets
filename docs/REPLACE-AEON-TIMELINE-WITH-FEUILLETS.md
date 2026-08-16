# Replace Aeon Timeline with Feuillets

> [Français](Remplacer-Aeon-Timeline-par-Feuillets.md) · **English** · [Documentation index](README.md)

You use Aeon Timeline to track events, characters, ages, story threads and the difference between chronological and narrative order. Feuillets covers a large part of that work **when it is directly tied to a manuscript**, but it does not try to replace Aeon's full specialized temporal model.

![Cards, Outline, Storyline and Timeline](feuillets-mosaique-narrative.png)

Aeon starts from chronology and entities. Feuillets starts from the text: Timeline, Storyline, Research and Context are projections of the same Markdown project.

---

## 1. Find Timeline View again

Use **Timeline** to compare dated manuscript scenes, Research events, milestones, available dates, characters/places/tags/threads and chronological versus narrative order.

A scene visible on Timeline remains the same Markdown sheet you edit from Binder or Continuous mode.

---

## 2. Represent an event

An event can be a manuscript scene with date/character/place/thread properties, or a Research event that exists in the story world or historical context without being narrated as a scene.

This separates **what happens** from **what the reader sees in the manuscript**.

---

## 3. Find entities again

Characters, places, events and other documentary material live in **Research** as Markdown files.

You can also link **any existing vault folder** to a manuscript sheet or folder. Feuillets does not move it; when it sits outside project Research, it appears as a read-only linked source in the Research panel.

---

## 4. Find properties and relationships again

Relationships can use YAML properties, Markdown links, tags, characters, places, narrative threads and Research references.

Feuillets 2.5 can **remap** its logical fields to properties already used in the vault, so an established project does not have to adopt Feuillets' default property names.

Aeon remains stronger for formal role-based relationships and complex temporal constraints.

---

## 5. Compare chronological and narrative order

**Timeline** shows chronological order.

**Binder** shows the order in which the reader encounters the sheets.

This makes flashbacks, ellipses, anticipations and out-of-order scenes visible without maintaining a second chronology database. **Outline** adds a tabular view of structure and properties.

---

## 6. Find Story Arcs again

Feuillets uses **narrative threads** projected in **Storyline**. The view helps reveal where a thread appears, disappears, resolves or leaves a gap across manuscript order.

Aeon can model arcs as more general temporal entities; Feuillets deliberately keeps them close to the written book.

---

## 7. Follow characters through time

Character Research notes can store birth, death and dated states. If a sheet has a date and mentions the character, **Sheet → Context** can use that information to surface age/state or flag cases such as not-yet-born or already-dead characters.

The check happens while writing the relevant passage.

---

## 8. Places, objects and anachronisms

Research can hold places, objects, technologies and historical information. Context can surface relevant material and some chronological inconsistencies.

Feuillets is not a geographic simulator: it does not automatically calculate travel distances, travel time or simultaneous-location impossibilities.

---

## 9. Calendars and durations

Feuillets works best with dates that remain readable in project properties.

Aeon is still much better suited to elaborate fictional calendars, calendar conversion, formal temporal constraints, automatically propagated durations/dependencies and highly detailed non-narrative models.

---

## 10. Find Relationship View again

There is no single equivalent. Use Obsidian links/backlinks for documentary relationships, Canvas/Notebook for visual thinking, Storyline for narrative relations, Timeline for temporal relations and Sheet → Context for information useful during writing.

---

## 11. Find Subway View again

**Storyline** is the closest author-oriented analogue: several narrative threads can be inspected across manuscript sequence.

It is not a Subway View clone; its primary axis is the actual book.

---

## 12. Find Spreadsheet and Outline again

Use **Outline** for a tabular view of hierarchy and metadata, and **Binder** for hierarchy and navigation.

Binder split view can keep a folder-only manuscript tree visible on the left while the normal Binder remains on the right, making structure readable at a glance.

---

## 13. Find Mindmap again

The **Notebook** uses Canvas for free ideas, groups and Idea Trees. A branch can be turned into an outline and then materialized as real Markdown folders/sheets.

Notebook helps you think; Binder remains the real manuscript structure.

---

## 14. Work side by side

Obsidian panes can keep manuscript, Timeline, Research, PDF or another document visible together.

Files inside externally linked Research folders can open in a new tab or side by side without being moved into the project. Binder split view also provides a lightweight read-only Vault browser for opening outside material.

---

## 15. Find continuity checks again

**Sheet → Context** can turn chronology into an active writing aid. Depending on project data, it can surface scene date, character age/state, nearby event, relevant Research, an already-dead/not-yet-born character or an anachronistic object/technique.

These are project-derived checks, not automatic truth claims.

---

## 16. Revise without losing chronology

Feuillets 2.5 also strengthens rewriting with snapshots/versions, a comparison view that distinguishes additions/deletions/replacements/moves, working annotations outside Markdown, collaborative review and DOCX Revision.

Timeline keeps pointing to the same source files while the manuscript evolves.

---

## 17. Edit several scenes continuously

**Continuous** mode opens a chapter, folder, selection or manuscript as one editable document while saving each change back to the corresponding source sheet.

This is useful for correcting transitions or temporal flow across several scenes without opening many tabs or merging source files.

---

## 18. Export and share

Feuillets exports the manuscript as compiled Markdown, DOCX, EPUB, ODT and desktop PDF. Chronological information remains in project files/properties.

There is not necessarily an equivalent to a standalone interactive Aeon timeline file; share chronology through the vault, tables, captures or derived documents according to need.

---

# Equivalent daily workflow

## Aeon + writing application

```text
Update timeline
→ check dates, characters and arcs
→ synchronize with writing app
→ write scene
→ synchronize again
```

## Feuillets

```text
Choose or write a sheet
→ add useful date/properties
→ inspect Timeline / Outline / Storyline
→ write alone or in Continuous
→ consult Sheet → Context
→ correct the same Markdown source
```

Chronology is no longer a separate database from the manuscript.

---

# When Feuillets can replace Aeon

Feuillets may be enough when the main need is novel/story chronology, chronological versus narrative order, straightforward character tracking, narrative threads, historical events linked to prose, continuity alerts while writing and keeping everything inside one Obsidian project.

# When to keep Aeon

Aeon remains preferable for very complex fictional calendars, formal temporal dependencies, rich relationship models, propagated duration calculations and projects where the timeline is more important than the manuscript itself.

---

# Verdict

Feuillets does not replace Aeon Timeline as a general temporal-modeling engine. It mainly replaces **the need to maintain a separate chronology database for checking a manuscript**.

If chronology primarily exists to help you write a coherent book, keeping dates, scenes, Research, threads and prose in the same vault can be more fluid than continuously synchronizing two applications.
