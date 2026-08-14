import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewPackage } from "../src/services/native-review-package.js";
import { createReviewSession, reviewRoundsRootPath } from "../src/services/native-review-session.js";
import { receiveNativeReviewReturnForAuthor } from "../src/services/native-review-author-return.js";
import { decideNativeReviewAuthorGroup } from "../src/services/native-review-author-decisions.js";
import { setNativeReviewThreadResolved } from "../src/services/native-review-threads.js";
import { loadNativeReviewWork } from "../src/services/native-review-work.js";
import { reviewSessionPaths, reviewerReviewStorageLocation } from "../src/services/native-review-storage.js";

const at = "2026-08-13T10:00:00.000Z";
const people = [{ id: "a", name: "HY", role: "author" }, { id: "b", name: "Pierre", role: "reviewer" }];
const note = (suffix, quote, start, end, text) => ({
  threadId: `thread-${suffix.repeat(32)}`, documentId: "one", anchor: { start, end, quote, prefix: "", suffix: "" },
  createdByParticipantId: "b", createdAt: at, status: "open",
  messages: [{ messageId: `message-${suffix.repeat(32)}`, participantId: "b", text, createdAt: at }],
});

async function fixture(current, returned, base, threads = []) {
  const root = new TFolder("Roman/Manuscrit"); const file = new TFile("Roman/Manuscrit/Un.md", current); root.children = [file]; file.parent = root;
  const { vault } = createFakeVault([root, file]); const app = { vault, fileManager: { trashFile: async () => {} } };
  const doc = { documentId: "one", originalPath: "Un.md", title: "Un", baseMarkdown: base };
  const make = async (senderRole, packageId, workingMarkdown) => createNativeReviewPackage({ packageId, createdAt: at, createdByVersion: "2", reviewId: "r", round: 1, senderRole, participants: people }, [{ ...doc, workingMarkdown }], senderRole === "reviewer" ? threads : []);
  await createReviewSession(app, { version: 1, reviewId: "r", localRole: "author", status: "active", createdAt: at, updatedAt: at, participants: people, documents: [{ documentId: "one", originalPath: "Un.md", title: "Un", localSourcePath: file.path }], rounds: [{ round: 1, createdAt: at, sent: { packageId: "sent", at } }] });
  await vault.createBinary(`${reviewRoundsRootPath("r")}/round-1-sent.feuillets`, (await make("author", "sent", base)).buffer);
  await receiveNativeReviewReturnForAuthor(app, "r", await make("reviewer", "returned", returned));
  return { app, vault, file, settings: { projectFolder: root.path } };
}

const BASE = "Un deux trois quatre cinq six sept huit neuf dix.";
const RETURNED = "UN deux trois quatre cinq six sept huit neuf DIX.";

test("travail de relecture : des changements et des notes, jamais un tour ni une session", async () => {
  const base = BASE;
  const value = await fixture(base, RETURNED, base, [note("a", "Un", 0, 2, "À revoir"), note("b", "cinq", 21, 25, "Trop long")]);
  const work = await loadNativeReviewWork(value.app, "r");
  assert.deepEqual(Object.keys(work).sort(), ["documents", "pendingChanges", "pendingNotes", "session"]);
  assert.equal(work.pendingChanges, 2); assert.equal(work.pendingNotes, 2);
  const document = work.documents[0];
  assert.equal(document.title, "Un"); assert.equal(document.authorMarkdown, base); assert.equal(document.reviewerMarkdown, RETURNED);
  assert.deepEqual(document.notes.map((item) => [item.author, item.messages[0].text, item.resolved]), [["Pierre", "À revoir", false], ["Pierre", "Trop long", false]]);
});

test("travail de relecture : chaque changement se situe dans les deux textes", async () => {
  const base = BASE; const returned = RETURNED;
  const value = await fixture(base, returned, base);
  const [first, second] = (await loadNativeReviewWork(value.app, "r")).documents[0].changes;
  assert.equal(base.slice(first.leftStart, first.leftEnd), first.oldText);
  assert.equal(returned.slice(first.rightStart, first.rightEnd), first.newText);
  assert.equal(base.slice(second.leftStart, second.leftEnd), second.oldText);
  assert.equal(returned.slice(second.rightStart, second.rightEnd), second.newText);
  assert.ok(first.applicable && second.applicable);
});

test("travail de relecture : appliquer et ignorer retirent le changement de ce qui reste", async () => {
  const base = BASE; const value = await fixture(base, RETURNED, base);
  const initial = await loadNativeReviewWork(value.app, "r");
  await decideNativeReviewAuthorGroup(value.app, value.settings, "r", "one", initial.documents[0].changes[0].changeIndexes, "accepted");
  await decideNativeReviewAuthorGroup(value.app, value.settings, "r", "one", initial.documents[0].changes[1].changeIndexes, "rejected");
  const after = await loadNativeReviewWork(value.app, "r");
  assert.equal(after.pendingChanges, 0);
  assert.deepEqual(after.documents[0].changes.map((change) => change.decision), ["accepted", "rejected"]);
  assert.deepEqual(after.documents[0].changes.map((change) => change.handled), [true, true]);
  assert.equal(await value.vault.read(value.file), "UN deux trois quatre cinq six sept huit neuf dix.");
});

test("travail de relecture : une note traitée ne reste pas à traiter", async () => {
  const base = BASE;
  const value = await fixture(base, base, base, [note("a", "Un", 0, 2, "À revoir")]);
  const work = await loadNativeReviewWork(value.app, "r");
  assert.equal(work.pendingChanges, 0); assert.equal(work.pendingNotes, 1);
  await setNativeReviewThreadResolved(value.app, "r", work.documents[0].notes[0].threadId, true, reviewerReviewStorageLocation());
  const after = await loadNativeReviewWork(value.app, "r");
  assert.equal(after.pendingNotes, 0); assert.equal(after.documents[0].notes[0].resolved, true);
  assert.equal(await value.vault.read(value.file), base, "une note ne touche jamais le manuscrit");
});

test("travail de relecture : un passage déjà retouché par l'auteur n'est jamais appliqué tout seul", async () => {
  const base = BASE;
  const value = await fixture("Un deux trois quatre cinq six sept huit neuf DIX.", RETURNED, base);
  const changes = (await loadNativeReviewWork(value.app, "r")).documents[0].changes;
  const identical = changes.find((change) => change.alreadyApplied);
  assert.ok(identical, "la retouche identique de l'auteur est reconnue");
  assert.ok(value.app.vault.getAbstractFileByPath(reviewSessionPaths(reviewerReviewStorageLocation(), "r").threadsFile));
});
