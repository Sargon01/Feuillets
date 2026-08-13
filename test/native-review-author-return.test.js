import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewPackage, readNativeReviewPackage } from "../src/services/native-review-package.js";
import { createReviewSession, reviewRoundsRootPath } from "../src/services/native-review-session.js";
import {
  NativeReviewAuthorReturnError, nativeReviewEdits, receiveNativeReviewReturnForAuthor,
} from "../src/services/native-review-author-return.js";

const createdAt = "2026-08-13T10:00:00.000Z";
const participants = [{ id: "alice", name: "Alice", role: "author" }, { id: "bob", name: "Bob", role: "reviewer" }];
const source = { documentId: "chapter-1", originalPath: "Chapitre/Un.md", title: "Un", baseMarkdown: "Bonjour monde." };
const input = (senderRole, packageId, workingMarkdown = source.baseMarkdown, overrides = {}) => ({
  packageId, createdAt, createdByVersion: "2.0.5", reviewId: "review-return", round: 1, senderRole, participants, ...overrides,
  documents: [{ ...source, workingMarkdown }],
});

async function setup(authorText = source.baseMarkdown) {
  const manuscript = new TFile("Roman/Manuscrit/Un.md", authorText);
  const { vault } = createFakeVault([manuscript]); const app = { vault };
  const author = input("author", "package-author");
  const authorData = await createNativeReviewPackage(author, author.documents);
  const session = {
    version: 1, reviewId: "review-return", localRole: "author", status: "active", createdAt, updatedAt: createdAt, participants,
    documents: [{ documentId: source.documentId, originalPath: source.originalPath, title: source.title, localSourcePath: manuscript.path }],
    rounds: [{ round: 1, createdAt, sent: { packageId: "package-author", at: createdAt } }],
  };
  await createReviewSession(app, session);
  await vault.createBinary(`${reviewRoundsRootPath(session.reviewId)}/round-1-sent.feuillets`, authorData.buffer.slice(authorData.byteOffset, authorData.byteOffset + authorData.byteLength));
  return { app, vault, manuscript, authorData };
}

function reviewerPackage(workingMarkdown, overrides = {}) {
  const reviewer = input("reviewer", "package-reviewer", workingMarkdown, overrides);
  return createNativeReviewPackage(reviewer, reviewer.documents);
}

test("archive le retour validé, ne modifie pas le manuscrit et fournit les plages sûres", async () => {
  const { app, vault, manuscript } = await setup("Bonjour cher monde.");
  const data = await reviewerPackage("Salut monde.");
  const result = await receiveNativeReviewReturnForAuthor(app, "review-return", data);
  assert.equal(await vault.read(manuscript), "Bonjour cher monde.");
  assert.equal(result.session.rounds[0].received.packageId, "package-reviewer");
  assert.equal(result.analyses[0].confidence, "safe");
  assert.deepEqual(result.analyses[0].changes, [{
    baseStart: 0, baseEnd: 7, oldText: "Bonjour", newText: "Salut", confidence: "safe", reason: "non-overlapping", currentStart: 0, currentEnd: 7,
  }]);
  const archive = vault.getAbstractFileByPath(result.localPackagePath); assert.ok(archive instanceof TFile);
  assert.equal((await readNativeReviewPackage(await vault.readBinary(archive))).manifest.packageId, "package-reviewer");
});

test("classe les éditions identiques comme déjà appliquées et les insertions de borne comme review", async () => {
  const already = await setup("Salut monde.");
  const applied = await receiveNativeReviewReturnForAuthor(already.app, "review-return", await reviewerPackage("Salut monde."));
  assert.deepEqual(applied.analyses[0].changes.map((change) => [change.confidence, change.reason]), [["safe", "already-applied"]]);

  const boundary = await setup("Bonjour, monde.");
  const result = await receiveNativeReviewReturnForAuthor(boundary.app, "review-return", await reviewerPackage("Bonjourbelle monde."));
  assert.deepEqual(result.analyses[0].changes.map((change) => [change.confidence, change.reason]), [["review", "overlap"]]);
});

test("conserve le retour quand la source locale manque, sans relocaliser via originalPath", async () => {
  const { app, vault } = await setup();
  await vault.delete(vault.getAbstractFileByPath("Roman/Manuscrit/Un.md"));
  await vault.create("Chapitre/Un.md", "Ne pas utiliser cette copie");
  const result = await receiveNativeReviewReturnForAuthor(app, "review-return", await reviewerPackage("Salut monde."));
  assert.equal(result.analyses[0].confidence, "ambiguous");
  assert.equal(result.analyses[0].authorMarkdown, undefined);
  assert.equal(result.analyses[0].changes[0].reason, "source-missing");
  assert.ok(vault.getAbstractFileByPath(result.localPackagePath));
});

test("refuse une base, des métadonnées ou une collision incohérentes avant écriture", async () => {
  const { app, vault } = await setup();
  const changedInput = { ...input("reviewer", "package-reviewer", "Salut tout le monde."), documents: [{ ...source, baseMarkdown: "Base remplacée", workingMarkdown: "Salut tout le monde." }] };
  const changedBase = await createNativeReviewPackage(changedInput, changedInput.documents);
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(app, "review-return", changedBase), NativeReviewAuthorReturnError);
  assert.equal(vault.getAbstractFileByPath(`${reviewRoundsRootPath("review-return")}/round-1-received.feuillets`), null);
  const badParticipants = await reviewerPackage("Salut monde.", { participants: [...participants].reverse() });
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(app, "review-return", badParticipants), NativeReviewAuthorReturnError);
  await vault.createBinary(`${reviewRoundsRootPath("review-return")}/round-1-received.feuillets`, "ancien");
  const colliding = await reviewerPackage("Salut monde.");
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(app, "review-return", colliding), NativeReviewAuthorReturnError);
});

test("la conversion de diff reste en coordonnées V0 et groupe seulement les fragments adjacents", () => {
  assert.deepEqual(nativeReviewEdits("ab cd ef", "ab XY cd Z"), [
    { baseStart: 3, baseEnd: 3, oldText: "", newText: "XY " },
    { baseStart: 6, baseEnd: 8, oldText: "ef", newText: "Z" },
  ]);
});
