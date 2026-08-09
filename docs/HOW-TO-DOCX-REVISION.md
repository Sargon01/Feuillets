# How-to — Review a Word manuscript with Feuillets

> [Français](HOW-TO-REVISION-DOCX.md) · **English** · [Documentation index](README.md)

The **DOCX Revision** section inside the **Edition** tab lets you bring corrections and comments made in Microsoft Word back into the Markdown sheets that produced the exported manuscript.

The workflow is:

> **Write in Feuillets → export DOCX → revise in Word → review the returned changes in Feuillets → update Markdown safely → generate a revised DOCX for the editor.**

Markdown remains the manuscript source.

---

## 1. Export the manuscript from Feuillets

Compose the manuscript, folder or selection you want to send to a proofreader or editor.

Export it as **DOCX** from Feuillets.

Starting from the DOCX produced by Feuillets is important because it contains markers that help map returned Word revisions back to their original Markdown sheets.

Send that DOCX to the proofreader or editor.

---

## 2. Make corrections in Word

The reviewer can use normal Word features:

- Track Changes;
- comments;
- comment replies;
- deletions;
- insertions;
- replacements;
- cut and paste;
- edits inside footnotes.

Formatting changes such as strike-through, underline or highlighting can also be present.

Save the revised document as `.docx`.

---

## 3. Open DOCX Revision

In the **Feuillets — Inspector** side panel, open the **Edition** tab.

The **DOCX Revision** section is available there.

You can also use the related Feuillets command from Obsidian's command palette.

---

## 4. Choose the returned DOCX

Feuillets first offers `.docx` files found in the project output folder.

You can also choose a file from another location. On desktop, the interface can accept a dropped file where supported.

Choose the file and run the analysis action.

Feuillets reads tracked changes and comments from the document.

---

## 5. Understand the revision queue

All feedback is gathered into one queue.

You can filter it by categories such as:

- all;
- changes;
- moves;
- comments;
- items that need review.

Previous and next controls let you move through the queue without leaving the Inspector.

---

# Types of feedback

## Insertion

Word proposes adding text.

You can accept or reject the insertion.

## Deletion

Word proposes removing text.

Accepting removes the corresponding Markdown text. Rejecting leaves the Markdown unchanged.

## Replacement

Word replaces one passage with another.

Feuillets treats the deletion and insertion as one proposal when they belong to the same replacement.

## Move

A passage has been cut and placed elsewhere.

Feuillets can recognize:

- a native Word tracked move;
- a cut-and-paste represented as deletion plus insertion;
- a move inside one sheet;
- a move from one sheet to another.

The revision card identifies origin and destination when available.

## Comment

A Word comment does not directly change Markdown.

You can open the corresponding passage, mark the comment as handled, and restore it to the queue when needed.

## Formatting

Feuillets can report changes such as:

- strike-through;
- underline;
- highlight;
- bold;
- italic.

These entries are informative. Feuillets does not automatically interpret a formatting change as a textual decision.

---

# Confidence levels

## Safe

Feuillets found one sufficiently precise target.

The normal actions can be used directly.

## Needs review

The mapping is plausible but should be checked before applying it.

Use the inspect/review action.

## Ambiguous

Feuillets cannot identify one safe target.

It does not force an automatic application. Review the passage and make the change manually when appropriate.

---

# Inspect a move

Move cards can provide tools to:

## View origin

Open the sheet where the passage originally appeared.

## View destination

Open the sheet where Word placed the passage.

## Full passages

Show broader context around origin and destination.

## Result preview

Show the calculated result before any Markdown file is written.

---

# Accept a change

Choose **Accept**.

Feuillets applies the change to the corresponding Markdown file.

For a move between two sheets, the full operation is prepared before any write occurs.

---

# Reject a change

Choose **Reject**.

Markdown remains unchanged.

The decision is stored so Feuillets also knows how that revision should be represented when a revised DOCX is generated.

The decision can later be restored when the interface offers that action.

---

# Be careful with “Mark all resolved”

This action is not merely a visual cleanup.

For still-pending tracked changes, it records them as rejected. For comments, it records them as handled.

It acts on the whole revision queue, not only the currently visible filter.

For normal editorial work, it is safer to decide item by item.

---

# Snapshots and rollback

Feuillets attempts to create a snapshot of a sheet before the first Markdown modification of a revision session.

That snapshot represents the state **before the revision session**, not a separate snapshot before every individual correction.

For some operations you can then:

- inspect the result;
- compare before and after;
- compare the origin and destination of a move.

A move between two sheets requires the relevant safety snapshots to succeed before Feuillets writes either file.

---

# Footnotes

Feuillets can analyze changes made directly inside Word footnotes.

It can also transfer a footnote when a passage is moved to another Markdown sheet.

If the destination already contains the same Markdown footnote identifier, Feuillets can rename the incoming identifier to avoid a collision.

---

# A change already present in the manuscript

Sometimes the Word change has already been applied manually in Markdown.

Feuillets can detect that the expected result is already present and indicate that state instead of creating a false user decision.

---

# Generate the revised DOCX

After making your decisions, choose **Generate revised DOCX**.

Feuillets starts from the **original returned DOCX**. It does not reconstruct the Word document from Markdown.

Only explicit decisions are applied to that copy.

## Accepted change

The revision is accepted in the output DOCX and no longer appears as a pending tracked change.

## Rejected change

The revision is rejected in the Word document.

## Change without a decision

It remains in the DOCX as a pending tracked change.

## Unhandled comment

It remains present.

## Handled comment

It is marked resolved when the DOCX contains enough information to do that safely.

Feuillets does not delete comments merely because they were handled.

## Handled formatting card

It does not trigger an automatic formatting rewrite. The original Word formatting change remains intact.

---

# Where is the revised DOCX saved?

The output name follows the pattern:

```text
<original-name>-revised.docx
```

The file is normally written to the project output folder. If no output folder is available, Feuillets uses the project folder.

The original DOCX is not overwritten.

### Existing revised files

If a file with exactly the same revised name already exists in the destination, it can be replaced.

If you need to keep several rounds of editorial exchange, rename or archive the previous revised file first.

---

# Special case: move containing a footnote

Feuillets can apply a move containing a footnote in **Markdown**.

When reflecting that decision back into the revised DOCX would be unsafe, Feuillets refuses to generate an uncertain Word result rather than silently corrupt the document.

The already revised Markdown is not lost.

---

# Why is feedback “unmapped”?

Feuillets normally uses markers embedded in its exported DOCX to find the source sheets.

Feedback can become unmapped when:

- a sheet was heavily renamed or moved;
- Word markers were removed;
- a passage was completely rewritten outside the boundaries of the original sheet;
- the document did not originate from a Feuillets DOCX export.

When uncertain, Feuillets asks for review instead of modifying the wrong Markdown file.

---

# What if Feuillets refuses to apply a change?

## “This passage appears several times”

The text exists in more than one possible location. Feuillets refuses to choose one arbitrarily.

## “Passage not found”

The DOCX and Markdown have diverged too far. Check the passage manually.

## “Unable to create a rollback point”

For operations touching several sheets, the required safety snapshot could not be created. Check the snapshots location and try again.

## “Unable to generate this DOCX safely”

Feuillets encountered a Word structure it does not want to modify automatically.

The original DOCX remains intact.

---

# Recommended workflow

1. Write and revise the manuscript in Feuillets.
2. Export the relevant scope as DOCX.
3. Send that DOCX to the proofreader or editor.
4. Receive the DOCX with tracked changes and comments.
5. Open **Edition → DOCX Revision**.
6. Analyze the returned file.
7. Process feedback item by item.
8. Inspect anything marked as uncertain.
9. Check moves before accepting them.
10. Leave genuinely unresolved points pending.
11. Generate the **revised DOCX**.
12. Open that file in Word if you want to inspect the final editorial state before sending it back.

---

# Safety principle

Feuillets follows a simple rule:

> **When in doubt, do not modify the manuscript automatically.**

The DOCX is an editorial exchange format.

Markdown remains the source manuscript.
