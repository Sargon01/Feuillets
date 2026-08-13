import test from "node:test";
import assert from "node:assert/strict";
import { createNativeReviewPackage, readNativeReviewPackage } from "../src/services/native-review-package.js";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewAuthor } from "../src/services/native-review-author.js";
import { receiveNativeReviewForReviewer } from "../src/services/native-review-reviewer.js";
import { createNativeReviewReviewerReturn } from "../src/services/native-review-reviewer-return.js";
import { receiveNativeReviewReturnForAuthor } from "../src/services/native-review-author-return.js";
import { createNativeReviewAuthorNextRound } from "../src/services/native-review-author-next-round.js";
import { receiveNativeReviewNextRoundForReviewer, NativeReviewReviewerNextRoundError } from "../src/services/native-review-reviewer-next-round.js";
import { addNativeReviewThread, loadNativeReviewThreads, nativeReviewThreadsPath, replyNativeReviewThread, setNativeReviewThreadResolved } from "../src/services/native-review-threads.js";
import { decideNativeReviewAuthorChange } from "../src/services/native-review-author-decisions.js";
import { loadReviewSession } from "../src/services/native-review-session.js";

test("transporte exactement les fils et omet threads.json quand ils sont vides", async () => {
  const participants = [{ id: "alice", name: "Alice", role: "author" }, { id: "bob", name: "Bob", role: "reviewer" }];
  const input = { packageId: "package-threads", createdAt: "2026-08-13T10:00:00.000Z", createdByVersion: "2.0.5", reviewId: "review-threads", round: 1, senderRole: "reviewer", participants };
  const docs = [{ documentId: "chapter-1", originalPath: "Roman/Un.md", title: "Un", baseMarkdown: "Texte", workingMarkdown: "Texte" }];
  const thread = { threadId: `thread-${"a".repeat(32)}`, documentId: "chapter-1", anchor: { start: 0, end: 5, quote: "Texte", prefix: "", suffix: "" }, createdByParticipantId: "bob", createdAt: input.createdAt, status: "open", messages: [{ messageId: `message-${"b".repeat(32)}`, participantId: "bob", text: "Vu", createdAt: input.createdAt }] };
  assert.deepEqual((await readNativeReviewPackage(await createNativeReviewPackage(input, docs))).threads, []);
  const parsed = await readNativeReviewPackage(await createNativeReviewPackage(input, docs, [thread]));
  assert.deepEqual(parsed.threads, [thread]);
});

test("transport réel multi-tours de deux fils, confidentialité et reprises", async () => {
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
  await addNativeReviewThread(reviewer, initial.session.reviewId, reviewOne.documentId, 0, 8, "Thread sur un");
  await addNativeReviewThread(reviewer, initial.session.reviewId, reviewTwo.documentId, 0, 9, "Thread sur deux");
  for (const document of received.session.documents) await reviewerVault.modify(reviewerVault.getAbstractFileByPath(document.localSourcePath), `${document.documentId} relu.`);
  const returnedOne = await createNativeReviewReviewerReturn(reviewer, initial.session.reviewId, "2.0.5");
  const reviewerThreads = await loadNativeReviewThreads(reviewer, initial.session.reviewId); const initialThreads = JSON.parse(JSON.stringify(reviewerThreads.threads));
  assert.equal(reviewerThreads.threads.length, 2); assert.ok(reviewerThreads.threads.every((thread) => thread.messages[0].participantId === initial.session.participants.find((p) => p.role === "reviewer").id));
  const authorReturned = await receiveNativeReviewReturnForAuthor(author, initial.session.reviewId, returnedOne.packageData);
  const ids = authorReturned.reviewPackage.threads.map((thread) => thread.threadId);
  await replyNativeReviewThread(author, initial.session.reviewId, ids[0], "Réponse auteur"); await setNativeReviewThreadResolved(author, initial.session.reviewId, ids[1], true);
  for (const analysis of authorReturned.analyses) for (let index = 0; index < analysis.changes.length; index += 1) await decideNativeReviewAuthorChange(author, settings, initial.session.reviewId, analysis.documentId, index, "rejected");
  const roundTwo = await createNativeReviewAuthorNextRound(author, settings, initial.session.reviewId, "2.0.5"); const authorThreads = roundTwo.reviewPackage.threads;
  assert.deepEqual(authorThreads.map((thread) => thread.threadId), ids); assert.deepEqual(authorThreads[0].messages[0], initialThreads[0].messages[0]); assert.equal(authorThreads[0].messages.at(-1).text, "Réponse auteur"); assert.equal(authorThreads[1].status, "resolved");
  assert.equal(JSON.stringify(roundTwo.reviewPackage).includes("annotations.json"), false); assert.equal(JSON.stringify(roundTwo.reviewPackage).includes("work-notes"), false);

  // Échec de session : l’archive et les fils entrants existent déjà, puis le paquet est rejoué.
  const reviewerAppRecreated = { vault: reviewerVault }; const originalReviewerModify = reviewerVault.modify.bind(reviewerVault); let failReviewerSave = true;
  reviewerVault.modify = async (file, text) => { if (file.path.endsWith("session.json") && failReviewerSave) { failReviewerSave = false; throw new Error("save reviewer"); } return originalReviewerModify(file, text); };
  await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(reviewerAppRecreated, roundTwo.packageData), NativeReviewReviewerNextRoundError);
  reviewerVault.modify = originalReviewerModify;
  const incomingThreads = JSON.parse(JSON.stringify(roundTwo.reviewPackage.threads)); const threadsFile = reviewerVault.getAbstractFileByPath(nativeReviewThreadsPath(initial.session.reviewId));
  // L’état ancien est accepté pendant une reprise ; l’échec forcé prouve que la garde l’a laissé passer.
  await reviewerVault.modify(threadsFile, JSON.stringify({ version: 1, threads: initialThreads })); let failOldStateSave = true;
  reviewerVault.modify = async (file, text) => { if (file.path.endsWith("session.json") && failOldStateSave) { failOldStateSave = false; throw new Error("save reviewer old"); } return originalReviewerModify(file, text); };
  await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(reviewerAppRecreated, roundTwo.packageData), NativeReviewReviewerNextRoundError); reviewerVault.modify = originalReviewerModify;
  await reviewerVault.modify(threadsFile, JSON.stringify({ version: 1, threads: [{ ...incomingThreads[0], anchor: { ...incomingThreads[0].anchor, quote: "divergent" } }] }));
  await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(reviewerAppRecreated, roundTwo.packageData), NativeReviewReviewerNextRoundError);
  await reviewerVault.modify(threadsFile, JSON.stringify({ version: 1, threads: incomingThreads }));
  const reviewerRoundTwo = await receiveNativeReviewNextRoundForReviewer(reviewerAppRecreated, roundTwo.packageData);
  assert.deepEqual(reviewerRoundTwo.reviewPackage.threads, incomingThreads);
  await replyNativeReviewThread(reviewerAppRecreated, initial.session.reviewId, ids[0], "Réponse reviewer tour deux");
  await addNativeReviewThread(reviewerAppRecreated, initial.session.reviewId, reviewOne.documentId, 0, 8, "Nouveau fil reviewer");
  for (const document of reviewerRoundTwo.session.documents) await reviewerVault.modify(reviewerVault.getAbstractFileByPath(document.localSourcePath), `${document.documentId} final.`);
  const returnedTwo = await createNativeReviewReviewerReturn(reviewerAppRecreated, initial.session.reviewId, "2.0.5");

  // La reprise auteur survient après archive + synchronisation threads et ne double rien.
  const originalAuthorModify = authorVault.modify.bind(authorVault); let failAuthorSave = true;
  authorVault.modify = async (file, text) => { if (file.path.endsWith("session.json") && failAuthorSave) { failAuthorSave = false; throw new Error("save author"); } return originalAuthorModify(file, text); };
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(author, initial.session.reviewId, returnedTwo.packageData)); authorVault.modify = originalAuthorModify;
  const final = await receiveNativeReviewReturnForAuthor(author, initial.session.reviewId, returnedTwo.packageData);
  const finalThreads = final.reviewPackage.threads;
  assert.deepEqual(finalThreads.slice(0, 2).map((thread) => thread.threadId), ids); assert.deepEqual(finalThreads[0].messages.slice(0, 2), authorThreads[0].messages);
  assert.equal(finalThreads[0].messages.at(-1).text, "Réponse reviewer tour deux"); assert.equal(finalThreads[1].status, "resolved"); assert.equal(finalThreads.length, 3);
  assert.equal((await loadReviewSession(author, initial.session.reviewId)).rounds.length, 2);
  assert.equal(authorVault.getAbstractFileByPath("annotations.json"), null); assert.equal(reviewerVault.getAbstractFileByPath("work-notes.json"), null);
  assert.ok(reviewerVault.getAbstractFileByPath(nativeReviewThreadsPath(initial.session.reviewId)) instanceof TFile);
});
