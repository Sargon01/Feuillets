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

function receivedPath(round = 1) { return `${reviewRoundsRootPath("review-return")}/round-${round}-received.feuillets`; }
function sessionPath() { return "_Feuillets/Relectures/review-return/session.json"; }
function assertNoReceived(vault, round = 1) { assert.equal(vault.getAbstractFileByPath(receivedPath(round)), null); }

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

test("un reviewer inchangé produit un document safe sans change", async () => {
  const { app } = await setup("Bonjour auteur monde.");
  const result = await receiveNativeReviewReturnForAuthor(app, "review-return", await reviewerPackage(source.baseMarkdown));
  assert.equal(result.analyses[0].confidence, "safe");
  assert.deepEqual(result.analyses[0].changes, []);
});

test("décale les coordonnées quand l’auteur modifie avant le passage reviewer", async () => {
  const original = "aaaa bbbb cccc";
  const previous = source.baseMarkdown; source.baseMarkdown = original;
  try {
    const { app } = await setup("XXX aaaa bbbb cccc");
    const result = await receiveNativeReviewReturnForAuthor(app, "review-return", await reviewerPackage("aaaa bbbb DDDD"));
    assert.deepEqual(result.analyses[0].changes.map(({ currentStart, currentEnd, confidence }) => ({ currentStart, currentEnd, confidence })), [{ currentStart: 14, currentEnd: 18, confidence: "safe" }]);
  } finally { source.baseMarkdown = previous; }
});

test("classe les mêmes passages divergents et les insertions concurrentes en overlap", async () => {
  const divergent = await setup("Salut monde.");
  const first = await receiveNativeReviewReturnForAuthor(divergent.app, "review-return", await reviewerPackage("Coucou monde."));
  assert.deepEqual(first.analyses[0].changes.map(({ confidence, reason }) => ({ confidence, reason })), [{ confidence: "review", reason: "overlap" }]);

  const inserted = await setup("Bonjour beau monde.");
  const second = await receiveNativeReviewReturnForAuthor(inserted.app, "review-return", await reviewerPackage("Bonjour cher monde."));
  assert.deepEqual(second.analyses[0].changes.map(({ confidence, reason }) => ({ confidence, reason })), [{ confidence: "review", reason: "overlap" }]);
});

test("classe deux modifications disjointes safe et ignore le frontmatter actuel", async () => {
  const raw = "---\ntitle: Local\nprivate: true\n---\nBonjour cher monde.";
  const { app, vault, manuscript } = await setup(raw);
  const result = await receiveNativeReviewReturnForAuthor(app, "review-return", await reviewerPackage("Salut monde."));
  assert.deepEqual(result.analyses[0].changes.map(({ confidence, reason }) => ({ confidence, reason })), [{ confidence: "safe", reason: "non-overlapping" }]);
  assert.equal(result.analyses[0].authorMarkdown, "Bonjour cher monde.");
  assert.equal(await vault.read(manuscript), raw);
});

test("refuse une session dont participants ou documents divergent du V0 avant archivage", async () => {
  const participantsChanged = await setup();
  const participantsSession = participantsChanged.vault.getAbstractFileByPath(sessionPath());
  const participantJson = JSON.parse(await participantsChanged.vault.read(participantsSession));
  participantJson.participants[0].name = "Mallory";
  await participantsChanged.vault.modify(participantsSession, JSON.stringify(participantJson));
  const participantReturn = await reviewerPackage("Salut monde.");
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(participantsChanged.app, "review-return", participantReturn), NativeReviewAuthorReturnError);
  assertNoReceived(participantsChanged.vault);

  const documentsChanged = await setup();
  const documentSession = documentsChanged.vault.getAbstractFileByPath(sessionPath());
  const documentJson = JSON.parse(await documentsChanged.vault.read(documentSession));
  documentJson.documents[0].title = "Titre altéré";
  await documentsChanged.vault.modify(documentSession, JSON.stringify(documentJson));
  const documentReturn = await reviewerPackage("Salut monde.");
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(documentsChanged.app, "review-return", documentReturn), NativeReviewAuthorReturnError);
  assertNoReceived(documentsChanged.vault);
});

test("refuse les retours senderRole, reviewId, round ou octets invalides avant écriture", async () => {
  for (const make of [
    () => { const value = input("author", "package-reviewer"); return createNativeReviewPackage(value, value.documents); },
    () => reviewerPackage("Salut monde.", { reviewId: "other-review" }),
    () => reviewerPackage("Salut monde.", { round: 2 }),
    () => Promise.resolve(new Uint8Array([0, 1, 2])),
  ]) {
    const { app, vault } = await setup();
    await assert.rejects(() => make().then((data) => receiveNativeReviewReturnForAuthor(app, "review-return", data)), NativeReviewAuthorReturnError);
    assertNoReceived(vault);
  }
});

test("archive les octets exacts et préserve session.json si createBinary échoue", async () => {
  const exact = await setup(); const data = await reviewerPackage("Salut monde.");
  const completed = await receiveNativeReviewReturnForAuthor(exact.app, "review-return", data);
  const archive = exact.vault.getAbstractFileByPath(completed.localPackagePath);
  assert.deepEqual(new Uint8Array(await exact.vault.readBinary(archive)), data);

  const failed = await setup(); const before = await failed.vault.read(failed.vault.getAbstractFileByPath(sessionPath()));
  failed.app.vault.createBinary = async () => { throw new Error("disque plein"); };
  const failedReturn = await reviewerPackage("Salut monde.");
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(failed.app, "review-return", failedReturn), NativeReviewAuthorReturnError);
  assert.equal(await failed.vault.read(failed.vault.getAbstractFileByPath(sessionPath())), before);
  assertNoReceived(failed.vault);
});

test("laisse l’archive présente et retourne une erreur si saveReviewSession échoue", async () => {
  const { app, vault } = await setup();
  app.vault.modify = async () => { throw new Error("session verrouillée"); };
  const returned = await reviewerPackage("Salut monde.");
  await assert.rejects(() => receiveNativeReviewReturnForAuthor(app, "review-return", returned), NativeReviewAuthorReturnError);
  assert.ok(vault.getAbstractFileByPath(receivedPath()));
});

test("reçoit le tour courant N supérieur à un depuis ses archives round-N", async () => {
  const manuscript = new TFile("Roman/Manuscrit/Un.md", source.baseMarkdown);
  const { vault } = createFakeVault([manuscript]); const app = { vault };
  const author = input("author", "package-author-2", source.baseMarkdown, { round: 2 });
  const sent = await createNativeReviewPackage(author, author.documents);
  const session = {
    version: 1, reviewId: "review-return", localRole: "author", status: "active", createdAt, updatedAt: createdAt, participants,
    documents: [{ documentId: source.documentId, originalPath: source.originalPath, title: source.title, localSourcePath: manuscript.path }],
    rounds: [
      { round: 1, createdAt, sent: { packageId: "package-author-1", at: createdAt }, received: { packageId: "package-reviewer-1", at: createdAt } },
      { round: 2, createdAt, sent: { packageId: "package-author-2", at: createdAt } },
    ],
  };
  await createReviewSession(app, session);
  await vault.createBinary(`${reviewRoundsRootPath(session.reviewId)}/round-2-sent.feuillets`, sent.buffer.slice(sent.byteOffset, sent.byteOffset + sent.byteLength));
  const reviewer = input("reviewer", "package-reviewer-2", "Salut monde.", { round: 2 });
  const result = await receiveNativeReviewReturnForAuthor(app, "review-return", await createNativeReviewPackage(reviewer, reviewer.documents));
  assert.equal(result.session.rounds[1].received.packageId, "package-reviewer-2");
  assert.ok(vault.getAbstractFileByPath(receivedPath(2)));
});
