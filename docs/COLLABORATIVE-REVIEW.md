# Collaborative review

> [Français](RELECTURE-COLLABORATIVE.md) · **English** · [Documentation index](README.md)

**Collaborative review** lets you exchange manuscript text with another person without turning the project into DOCX and without sharing the whole Obsidian vault.

Transport uses a `.feuillets` file explicitly created and exchanged by users.

## Author: create the review

In **Proofreading → Collaborative review**:

1. choose **New review**;
2. enter author and reviewer names;
3. choose the scope: **this sheet**, **this folder** or **whole project**;
4. create and download the `.feuillets` package;
5. send that file to the reviewer by any channel you choose.

The local session keeps the state that was sent so a future return can be analyzed safely.

## Reviewer

The reviewer installs Feuillets and imports the package in **Collaborative review**.

Feuillets creates a local working copy for that review. The reviewer can edit the working text, select a passage and add a note, navigate the documents in scope, then return a new `.feuillets` package to the author.

The rest of the author's vault is not included in the package.

## Author: handle the return

The author imports the return. Feuillets performs a three-way comparison between:

1. the text that was sent;
2. the reviewer's modified version;
3. the author's current manuscript.

This prevents a reviewer return from silently overwriting a passage the author changed independently while the review was away.

In the comparison view, the author can apply, ignore or manually handle each proposal and read/resolve review notes.

## Multiple sheets and rounds

A review may contain several sheets; each remains separately reachable and keeps its own pending changes and notes.

The exchange can continue for further rounds. Review note threads remain attached to the session so discussion can continue.

## Finish or archive

Completed reviews can be archived locally. Deleting a finished review does not undo changes that were already applied to the manuscript.

## Collaborative review or DOCX Review?

Use **Collaborative review** when both participants use Feuillets and want a native Markdown/Feuillets exchange.

Use **DOCX Review** when an editor or proofreader works in Word with tracked changes and comments.
