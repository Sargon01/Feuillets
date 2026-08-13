import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewAuthor } from "../src/services/native-review-author.js";
import { readNativeReviewPackage } from "../src/services/native-review-package.js";
import { receiveNativeReviewForReviewer } from "../src/services/native-review-reviewer.js";
import { createNativeReviewReviewerReturn } from "../src/services/native-review-reviewer-return.js";
import { receiveNativeReviewReturnForAuthor } from "../src/services/native-review-author-return.js";
import { decideNativeReviewAuthorChange, loadNativeReviewAuthorDecisionState } from "../src/services/native-review-author-decisions.js";
import { createNativeReviewAuthorNextRound } from "../src/services/native-review-author-next-round.js";
import { receiveNativeReviewNextRoundForReviewer, NativeReviewReviewerNextRoundError } from "../src/services/native-review-reviewer-next-round.js";
import { loadReviewSession, reviewRoundsRootPath } from "../src/services/native-review-session.js";

function authorFixture() {
  const project = new TFolder("Roman"); const manuscript = new TFolder("Roman/Manuscrit"); const first = new TFile("Roman/Manuscrit/Un.md", "---\nprivate: un\n---\nBonjour cher monde."); const second = new TFile("Roman/Manuscrit/Deux.md", "---\nprivate: deux\n---\nDeux monde.");
  project.children = [manuscript]; manuscript.parent = project; manuscript.children = [first, second]; first.parent = manuscript; second.parent = manuscript;
  const { vault } = createFakeVault([project, manuscript, first, second]);
  return { vault, first, second, app: { vault, metadataCache: { getFileCache: (file) => ({ frontmatter: { title: file === first ? "Un" : "Deux" } }) } }, settings: { projectFolder: manuscript.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" } };
}
function bytes(value) { return new Uint8Array(value); }
async function assertArchive(vault, path, data) { assert.deepEqual(bytes(await vault.readBinary(vault.getAbstractFileByPath(path))), bytes(data)); }
async function decideEveryChange(app, settings, reviewId, analyses, firstDecision = "rejected") {
  let number = 0;
  for (const document of analyses) for (let index = 0; index < document.changes.length; index += 1) {
    const decision = number === 0 ? firstDecision : "rejected";
    await decideNativeReviewAuthorChange(app, settings, reviewId, document.documentId, index, decision); number += 1;
  }
  assert.ok(number > 0); assert.equal((await loadNativeReviewAuthorDecisionState(app, reviewId)).complete, true);
}

test("boucle native persistante auteur → reviewer → auteur sur trois tours et deux documents", async () => {
  const author = authorFixture(); const rawBefore = [await author.vault.read(author.first), await author.vault.read(author.second)];
  const initial = await createNativeReviewAuthor(author.app, author.settings, { scope: { type: "selection", paths: [author.first.path, author.second.path] }, authorName: "Alice", reviewerName: "Bob", createdByVersion: "9C" });
  const reviewId = initial.session.reviewId; const initialPackage = await readNativeReviewPackage(initial.packageData); const reviewerState = createFakeVault([]); let reviewerApp = { vault: reviewerState.vault };
  assert.equal(initialPackage.documents.length, 2); assert.deepEqual(initialPackage.documents.map((item) => item.documentId), initial.session.documents.map((item) => item.documentId)); assert.ok(initialPackage.documents.every((item) => !item.baseMarkdown.includes("private:")));
  assert.deepEqual([await author.vault.read(author.first), await author.vault.read(author.second)], rawBefore);

  const receivedOne = await receiveNativeReviewForReviewer(reviewerApp, initial.packageData);
  assert.equal(receivedOne.session.reviewId, reviewId); assert.deepEqual(receivedOne.session.participants, initial.session.participants); assert.deepEqual(receivedOne.session.documents.map((item) => item.documentId), initial.session.documents.map((item) => item.documentId));
  assert.ok(receivedOne.workingFiles.every((file) => file.path.startsWith(`_Feuillets/Relectures/${reviewId}/working/`))); assert.equal(reviewerState.vault.getAbstractFileByPath("Roman/Manuscrit"), null);
  await reviewerState.vault.modify(receivedOne.workingFiles[0], "Salut monde."); await reviewerState.vault.modify(receivedOne.workingFiles[1], "Deux revue.");
  const returnOne = await createNativeReviewReviewerReturn(reviewerApp, reviewId, "9C"); const authorReturnOne = await receiveNativeReviewReturnForAuthor(author.app, reviewId, returnOne.packageData);
  assert.equal(authorReturnOne.analyses.length, 2); assert.ok(authorReturnOne.analyses.every((item) => item.changes.length > 0));
  await decideEveryChange(author.app, author.settings, reviewId, authorReturnOne.analyses, "accepted");
  const afterFirstDecisions = [await author.vault.read(author.first), await author.vault.read(author.second)]; assert.equal(afterFirstDecisions.some((value, index) => value !== rawBefore[index]), true); assert.equal(afterFirstDecisions.some((value, index) => value === rawBefore[index]), true); assert.ok(afterFirstDecisions.every((value) => value.startsWith("---\nprivate:")));

  const roundTwo = await createNativeReviewAuthorNextRound(author.app, author.settings, reviewId, "9C");
  assert.equal(roundTwo.reviewPackage.manifest.round, 2); assert.equal(roundTwo.reviewPackage.manifest.reviewId, reviewId); assert.deepEqual(roundTwo.reviewPackage.manifest.participants, initial.session.participants); assert.deepEqual(roundTwo.reviewPackage.documents.map((item) => item.documentId), initial.session.documents.map((item) => item.documentId)); assert.ok(roundTwo.reviewPackage.documents.every((item) => item.baseMarkdown === item.workingMarkdown && !item.baseMarkdown.includes("private:")));
  reviewerApp = { vault: reviewerState.vault }; const receivedTwo = await receiveNativeReviewNextRoundForReviewer(reviewerApp, roundTwo.packageData);
  assert.deepEqual(await Promise.all(receivedTwo.workingFiles.map((file) => reviewerState.vault.read(file))), roundTwo.reviewPackage.documents.map((item) => item.workingMarkdown));

  await reviewerState.vault.modify(receivedTwo.workingFiles[0], "Tour deux: Salut cher monde."); await reviewerState.vault.modify(receivedTwo.workingFiles[1], "Tour deux: Deux monde.");
  const returnTwo = await createNativeReviewReviewerReturn(reviewerApp, reviewId, "9C"); const authorReturnTwo = await receiveNativeReviewReturnForAuthor(author.app, reviewId, returnTwo.packageData);
  await decideEveryChange(author.app, author.settings, reviewId, authorReturnTwo.analyses);
  const roundThree = await createNativeReviewAuthorNextRound(author.app, author.settings, reviewId, "9C"); assert.equal(roundThree.reviewPackage.manifest.round, 3);

  const beforeThree = await Promise.all(receivedTwo.workingFiles.map((file) => reviewerState.vault.read(file))); const modify = reviewerState.vault.modify.bind(reviewerState.vault); let secondFailure = true;
  reviewerState.vault.modify = async (file, text) => { if (file.path === receivedTwo.workingFiles[1].path && secondFailure) { secondFailure = false; throw new Error("second working"); } return modify(file, text); };
  await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(reviewerApp, roundThree.packageData), NativeReviewReviewerNextRoundError);
  assert.equal(await reviewerState.vault.read(receivedTwo.workingFiles[0]), roundThree.reviewPackage.documents[0].workingMarkdown); assert.equal(await reviewerState.vault.read(receivedTwo.workingFiles[1]), beforeThree[1]);
  assert.equal((await loadReviewSession(reviewerApp, reviewId)).rounds.length, 2); const receivedThreePath = `${reviewRoundsRootPath(reviewId)}/round-3-received.feuillets`; await assertArchive(reviewerState.vault, receivedThreePath, roundThree.packageData);
  reviewerState.vault.modify = modify; const receivedThree = await receiveNativeReviewNextRoundForReviewer(reviewerApp, roundThree.packageData);
  assert.deepEqual(await Promise.all(receivedThree.workingFiles.map((file) => reviewerState.vault.read(file))), roundThree.reviewPackage.documents.map((item) => item.workingMarkdown)); assert.equal((await loadReviewSession(reviewerApp, reviewId)).rounds.length, 3);

  const authorSession = await loadReviewSession(author.app, reviewId); const reviewerSession = await loadReviewSession(reviewerApp, reviewId);
  assert.deepEqual(authorSession.rounds.map((round) => [Boolean(round.sent), Boolean(round.received)]), [[true, true], [true, true], [true, false]]);
  assert.deepEqual(reviewerSession.rounds.map((round) => [Boolean(round.received), Boolean(round.sent)]), [[true, true], [true, true], [true, false]]);
  for (let index = 0; index < 3; index += 1) assert.equal(authorSession.rounds[index].sent?.packageId, reviewerSession.rounds[index].received?.packageId);
  for (let index = 0; index < 2; index += 1) assert.equal(reviewerSession.rounds[index].sent?.packageId, authorSession.rounds[index].received?.packageId);
  const packageIds = authorSession.rounds.flatMap((round) => [round.sent?.packageId, round.received?.packageId]).filter(Boolean); assert.equal(new Set(packageIds).size, packageIds.length);
  await assertArchive(author.vault, `${reviewRoundsRootPath(reviewId)}/round-1-sent.feuillets`, initial.packageData); await assertArchive(reviewerState.vault, `${reviewRoundsRootPath(reviewId)}/round-1-received.feuillets`, initial.packageData); await assertArchive(author.vault, `${reviewRoundsRootPath(reviewId)}/round-2-sent.feuillets`, roundTwo.packageData); await assertArchive(reviewerState.vault, `${reviewRoundsRootPath(reviewId)}/round-2-received.feuillets`, roundTwo.packageData);
  assert.deepEqual([await author.vault.read(author.first), await author.vault.read(author.second)].map((raw) => raw.startsWith("---\nprivate:")), [true, true]); assert.equal(reviewerState.vault.getAbstractFileByPath("Roman"), null);
});
