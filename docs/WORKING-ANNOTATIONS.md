# Working annotations

> [Français](ANNOTATIONS-DE-TRAVAIL.md) · **English** · [Documentation index](README.md)

**Working annotations** let you attach a note to a manuscript passage **without writing that note into the Markdown**.

They are intended for temporary author questions: revise this passage, verify a detail, strengthen an intention, fix a transition, or revisit an unresolved choice.

## Add an annotation

1. select a passage in a sheet;
2. run **Add annotation**;
3. enter your note.

The passage receives a visual marker in the editor. Clicking the annotated passage lets you reopen and edit the note.

## Markdown stays clean

An annotation:

- adds no inline HTML;
- adds no Markdown marker;
- does not modify the selected prose to store an identifier;
- is not exported with the manuscript;
- can be deleted once resolved.

Annotation data and anchoring are stored separately from the source file.

## Survive small rewrites

Anchoring does not rely only on one frozen numeric offset. Feuillets keeps enough surrounding context to try to find the passage again after small nearby edits.

If the text has changed too much for a safe match, the annotation should not be silently moved to an unrelated passage.

## Find annotations again

In **Sheet**, the **Notes and annotations** page provides access to working remarks and annotations.

The annotation list can be viewed at three scopes:

- **Sheet**: annotations for the active text;
- **Folder**: annotations across sheets in the folder;
- **Project**: annotations across the active manuscript.

Where possible, items follow Binder order so the list remains consistent with manuscript progression.

## Edit or delete

An annotation can be opened from its passage or from the list, edited, and deleted when no longer useful.

Deleting an annotation never deletes the passage it was attached to.

## Annotation or working note?

A **working note** generally belongs to the sheet as a whole.

An **annotation** belongs to a specific passage.

Use an annotation when the remark only makes sense beside a particular sentence or paragraph.

## Annotation or review comment?

A working annotation is personal and local to your project.

A **collaborative review** note belongs to a reviewer session and travels inside that session's `.feuillets` package.

A **DOCX Revision** comment comes from an imported Word document.

Keeping these mechanisms separate prevents a private author note from being confused with outside feedback.

## In short

> **Select → annotate → find → resolve → delete, without polluting Markdown.**
