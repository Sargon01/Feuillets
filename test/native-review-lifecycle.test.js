import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createReviewSession, loadReviewSession } from "../src/services/native-review-session.js";
import { completeNativeReviewSession } from "../src/services/native-review-exchange.js";
import { loadNativeReviewLocalState, setNativeReviewArchived } from "../src/services/native-review-local-state.js";
import { removeNativeReviewSession, reviewSessionPaths, reviewerReviewStorageLocation } from "../src/services/native-review-storage.js";
import { createNativeReviewPackage } from "../src/services/native-review-package.js";

const at = "2026-08-13T10:00:00.000Z";
const reviewerSession = (id) => ({ version: 1, reviewId: id, localRole: "reviewer", status: "active", createdAt: at, updatedAt: at,
  participants: [{ id: "a", name: "HY", role: "author" }, { id: "b", name: "Pierre", role: "reviewer" }], documents: [{ documentId: "doc", originalPath: "Un.md", title: "Un" }], rounds: [{ round: 1, createdAt: at, received: { packageId: `in-${id}`, at }, sent: { packageId: `out-${id}`, at } }] });

test("lifecycle reviewer : jamais completed, archive locale sans modifier le protocole", async () => {
  const state = createFakeVault(); const app = { vault: state.vault, fileManager: state.fileManager }; const location = reviewerReviewStorageLocation();
  await createReviewSession(app, reviewerSession("review-life"), location);
  await assert.rejects(() => completeNativeReviewSession(app, "review-life", { location }), /Seul l’auteur/);
  await setNativeReviewArchived(app, location, "review-life", true);
  assert.equal((await loadReviewSession(app, location, "review-life")).status, "active"); assert.ok((await loadNativeReviewLocalState(app, location, "review-life")).archivedAt);
  await setNativeReviewArchived(app, location, "review-life", false); assert.equal((await loadNativeReviewLocalState(app, location, "review-life")).archivedAt, undefined);
});

test("suppression : seule la session exacte part à la corbeille", async () => {
  const state = createFakeVault([new TFile("Roman/Manuscrit/Un.md", "Texte"), new TFile("Roman/_Feuillets/Snapshots/s.md", "snapshot")]); const trashed = [];
  const app = { vault: state.vault, fileManager: { trashFile: async (folder) => { trashed.push(folder.path); } } }; const location = reviewerReviewStorageLocation();
  await createReviewSession(app, reviewerSession("review-one"), location); await createReviewSession(app, reviewerSession("review-two"), location);
  await removeNativeReviewSession(app, location, "review-one");
  assert.deepEqual(trashed, [reviewSessionPaths(location, "review-one").root]); assert.ok(state.vault.getAbstractFileByPath(reviewSessionPaths(location, "review-two").sessionFile)); assert.ok(state.vault.getAbstractFileByPath("Roman/Manuscrit/Un.md")); assert.ok(state.vault.getAbstractFileByPath("Roman/_Feuillets/Snapshots/s.md"));
});

test("lifecycle HY : thread ouvert exige la force explicite puis completed", async () => {
  const source = new TFile("Roman/Manuscrit/Un.md", "Texte"); const state = createFakeVault([source]); const app = { vault: state.vault, fileManager: state.fileManager }; const location = reviewerReviewStorageLocation(); const id = "review-author-life";
  const participants = [{ id: "author", name: "HY", role: "author" }, { id: "reviewer", name: "Pierre", role: "reviewer" }]; const docs = [{ documentId: "doc", originalPath: "Un.md", title: "Un", baseMarkdown: "Texte" }];
  const sent = await createNativeReviewPackage({ packageId: "sent-life", createdAt: at, createdByVersion: "test", reviewId: id, round: 1, senderRole: "author", participants }, docs);
  const thread = { threadId: `thread-${"a".repeat(32)}`, documentId: "doc", anchor: { start: 0, end: 5, quote: "Texte", prefix: "", suffix: "" }, createdByParticipantId: "reviewer", createdAt: at, status: "open", messages: [{ messageId: `message-${"b".repeat(32)}`, participantId: "reviewer", text: "À revoir", createdAt: at }] };
  const returned = await createNativeReviewPackage({ packageId: "returned-life", createdAt: at, createdByVersion: "test", reviewId: id, round: 1, senderRole: "reviewer", participants }, docs, [thread]);
  await createReviewSession(app, { version: 1, reviewId: id, localRole: "author", status: "active", createdAt: at, updatedAt: at, participants, documents: [{ documentId: "doc", originalPath: "Un.md", title: "Un", localSourcePath: source.path }], rounds: [{ round: 1, createdAt: at, sent: { packageId: "sent-life", at }, received: { packageId: "returned-life", at } }] }, location);
  const paths = reviewSessionPaths(location, id); await state.vault.createBinary(`${paths.roundsRoot}/round-1-sent.feuillets`, sent.buffer); await state.vault.createBinary(`${paths.roundsRoot}/round-1-received.feuillets`, returned.buffer); await state.vault.create(paths.threadsFile, JSON.stringify({ version: 1, threads: [thread] }));
  await assert.rejects(() => completeNativeReviewSession(app, id, { location }), /note\(s\) non traitée/); await completeNativeReviewSession(app, id, { location, force: true }); assert.equal((await loadReviewSession(app, location, id)).status, "completed");
});
