import test from "node:test";
import assert from "node:assert/strict";
import { createNativeReviewPackage, readNativeReviewPackage } from "../src/services/native-review-package.js";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewAuthor } from "../src/services/native-review-author.js";
import { receiveNativeReviewForReviewer } from "../src/services/native-review-reviewer.js";
import { createNativeReviewReviewerReturn } from "../src/services/native-review-reviewer-return.js";
import { receiveNativeReviewReturnForAuthor } from "../src/services/native-review-author-return.js";
import { addNativeReviewThread, loadNativeReviewThreads, nativeReviewThreadsPath, setNativeReviewThreadResolved } from "../src/services/native-review-threads.js";
import { loadReviewSession } from "../src/services/native-review-session.js";
import { reviewerReviewStorageLocation } from "../src/services/native-review-storage.js";

test("transporte exactement les fils et omet threads.json quand ils sont vides", async () => {
  const participants = [{ id: "alice", name: "Alice", role: "author" }, { id: "bob", name: "Bob", role: "reviewer" }];
  const input = { packageId: "package-threads", createdAt: "2026-08-13T10:00:00.000Z", createdByVersion: "2.0.5", reviewId: "review-threads", round: 1, senderRole: "reviewer", participants };
  const docs = [{ documentId: "chapter-1", originalPath: "Roman/Un.md", title: "Un", baseMarkdown: "Texte", workingMarkdown: "Texte" }];
  const thread = { threadId: `thread-${"a".repeat(32)}`, documentId: "chapter-1", anchor: { start: 0, end: 5, quote: "Texte", prefix: "", suffix: "" }, createdByParticipantId: "bob", createdAt: input.createdAt, status: "open", messages: [{ messageId: `message-${"b".repeat(32)}`, participantId: "bob", text: "Vu", createdAt: input.createdAt }] };
  assert.deepEqual((await readNativeReviewPackage(await createNativeReviewPackage(input, docs))).threads, []);
  const parsed = await readNativeReviewPackage(await createNativeReviewPackage(input, docs, [thread]));
  assert.deepEqual(parsed.threads, [thread]);
});

test("transport réel d'un aller-retour : notes intactes, confidentialité et reprise auteur", async () => {
  const manuscript = new TFolder("Roman/Manuscrit"); const one = new TFile("Roman/Manuscrit/Un.md", "Texte un initial."); const two = new TFile("Roman/Manuscrit/Deux.md", "Texte deux initial.");
  manuscript.children = [one, two]; one.parent = manuscript; two.parent = manuscript;
  const authorVault = createFakeVault([new TFolder("Roman"), manuscript, one, two]).vault;
  const author = { vault: authorVault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: manuscript.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit" };
  const initial = await createNativeReviewAuthor(author, settings, { scope: { type: "selection", paths: [one.path, two.path] }, authorName: "Alice", reviewerName: "Bob", createdByVersion: "2.0.5" });
  const reviewerVault = createFakeVault([]).vault; const reviewer = { vault: reviewerVault };
  const received = await receiveNativeReviewForReviewer(reviewer, initial.packageData);
  assert.equal(reviewerVault.getAbstractFileByPath("Roman"), null);
  assert.equal(reviewerVault.getAbstractFileByPath("annotations.json"), null);
  const [reviewOne, reviewTwo] = received.session.documents;
  await addNativeReviewThread(reviewer, initial.session.reviewId, reviewOne.documentId, 0, 8, "Note sur un");
  await addNativeReviewThread(reviewer, initial.session.reviewId, reviewTwo.documentId, 0, 9, "Note sur deux");
  for (const document of received.session.documents) await reviewerVault.modify(reviewerVault.getAbstractFileByPath(document.localSourcePath), `${document.documentId} relu.`);
  const returned = await createNativeReviewReviewerReturn(reviewer, initial.session.reviewId, "2.0.5");
  const reviewerThreads = await loadNativeReviewThreads(reviewer, initial.session.reviewId);
  assert.equal(reviewerThreads.threads.length, 2); assert.ok(reviewerThreads.threads.every((thread) => thread.messages[0].participantId === initial.session.participants.find((p) => p.role === "reviewer").id));
  assert.equal(JSON.stringify(returned.packageData ? await readNativeReviewPackage(returned.packageData) : {}).includes("annotations.json"), false);

  // Reprise auteur : l’archive et les fils sont déjà écrits, seul session.json manquait.
  const originalAuthorModify = authorVault.modify.bind(authorVault); let failAuthorSave = true;
  authorVault.modify = async (file, text) => { if (file.path.endsWith("session.json") && failAuthorSave) { failAuthorSave = false; throw new Error("save author"); } return originalAuthorModify(file, text); };
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(author, initial.session.reviewId, returned.packageData)); authorVault.modify = originalAuthorModify;
  const final = await receiveNativeReviewReturnForAuthor(author, initial.session.reviewId, returned.packageData);
  const ids = final.reviewPackage.threads.map((thread) => thread.threadId);
  assert.deepEqual(final.reviewPackage.threads, reviewerThreads.threads);
  assert.equal((await loadReviewSession(author, initial.session.reviewId)).rounds.length, 1);

  // Côté auteur, une note ne connaît qu'une issue : traitée.
  await setNativeReviewThreadResolved(author, initial.session.reviewId, ids[1], true);
  const authorThreads = await loadNativeReviewThreads(author, initial.session.reviewId);
  assert.equal(authorThreads.threads[1].status, "resolved"); assert.equal(authorThreads.threads[0].status, "open");
  assert.deepEqual(authorThreads.threads[0].messages, reviewerThreads.threads[0].messages);

  assert.equal(authorVault.getAbstractFileByPath("annotations.json"), null); assert.equal(reviewerVault.getAbstractFileByPath("work-notes.json"), null);
  assert.ok(reviewerVault.getAbstractFileByPath(nativeReviewThreadsPath(initial.session.reviewId, reviewerReviewStorageLocation())) instanceof TFile);
});
