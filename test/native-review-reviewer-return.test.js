import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewPackage, readNativeReviewPackage } from "../src/services/native-review-package.js";
import { receiveNativeReviewForReviewer } from "../src/services/native-review-reviewer.js";
import { createNativeReviewReviewerReturn, NativeReviewReviewerReturnError } from "../src/services/native-review-reviewer-return.js";

const createdAt = "2026-08-13T10:00:00.000Z";
const participants = [{ id: "alice", name: "Alice", role: "author" }, { id: "bob", name: "Bob", role: "reviewer" }];
const documents = [
  { documentId: "chapter-1", originalPath: "Roman/Manuscrit/Un.md", title: "Un", baseMarkdown: "Texte de base." },
  { documentId: "chapter-2", originalPath: "Roman/Manuscrit/Deux.md", title: "Deux", baseMarkdown: "Deuxième base." },
];
const input = (overrides = {}) => ({ packageId: "package-author", createdAt, createdByVersion: "2.0.5", reviewId: "review-return", round: 1, senderRole: "author", participants, ...overrides });
const setup = async () => {
  const manuscript = new TFolder("Roman/Manuscrit"); const source = new TFile("Roman/Manuscrit/Un.md", "Auteur intact"); manuscript.children = [source]; source.parent = manuscript;
  const { vault } = createFakeVault([manuscript, source]); const app = { vault };
  const received = await receiveNativeReviewForReviewer(app, await createNativeReviewPackage(input(), documents));
  return { app, vault, source, received };
};
const rejects = (action) => assert.rejects(action, NativeReviewReviewerReturnError);

test("crée le retour reviewer avec base V0, working édité et archive exacte", async () => {
  const { app, vault, source } = await setup();
  const working = vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/working/chapter-1.md"); await vault.modify(working, "---\ntitle: Privé\n---\nTexte relu.");
  const result = await createNativeReviewReviewerReturn(app, "review-return", "2.0.5"); const returned = await readNativeReviewPackage(result.packageData);
  assert.equal(returned.manifest.senderRole, "reviewer"); assert.equal(returned.manifest.reviewId, "review-return"); assert.equal(returned.manifest.round, 1); assert.notEqual(returned.manifest.packageId, "package-author");
  assert.equal(returned.documents[0].baseMarkdown, "Texte de base."); assert.equal(returned.documents[0].workingMarkdown, "Texte relu."); assert.equal(returned.documents[1].workingMarkdown, "Deuxième base.");
  assert.equal(await vault.read(source), "Auteur intact"); assert.equal((await readNativeReviewPackage(await vault.readBinary(vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/rounds/round-1-received.feuillets")))).manifest.packageId, "package-author");
  const archive = vault.getAbstractFileByPath(result.localPackagePath); assert.ok(archive instanceof TFile); assert.deepEqual(new Uint8Array(await vault.readBinary(archive)), result.packageData);
  assert.equal(result.session.rounds[0].sent.packageId, returned.manifest.packageId); assert.equal(result.session.updatedAt, result.session.rounds[0].sent.at);
  assert.deepEqual(result.session.participants, participants); assert.deepEqual(result.session.documents.map(({ documentId, originalPath, title }) => ({ documentId, originalPath, title })), documents.map(({ documentId, originalPath, title }) => ({ documentId, originalPath, title })));
});

test("prend en charge le tour courant N supérieur à 1", async () => {
  const { app, vault } = await setup(); await createNativeReviewReviewerReturn(app, "review-return", "2.0.5");
  const roundTwoAt = "2026-08-14T10:00:00.000Z";
  const roundTwo = await createNativeReviewPackage(input({ packageId: "package-author-2", createdAt: roundTwoAt, round: 2 }), documents);
  await vault.createBinary("_Feuillets/Relectures/review-return/rounds/round-2-received.feuillets", roundTwo.buffer.slice(roundTwo.byteOffset, roundTwo.byteOffset + roundTwo.byteLength));
  const sessionFile = vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/session.json"); const session = JSON.parse(await vault.read(sessionFile));
  session.rounds.push({ round: 2, createdAt: roundTwoAt, received: { packageId: "package-author-2", at: roundTwoAt } }); await vault.modify(sessionFile, JSON.stringify(session));
  const result = await createNativeReviewReviewerReturn(app, "review-return", "2.0.5"); const returned = await readNativeReviewPackage(result.packageData);
  assert.equal(returned.manifest.round, 2); assert.equal(result.session.rounds[1].sent.packageId, returned.manifest.packageId);
});

test("refuse les workings absents ou incohérents avant toute écriture", async () => {
  for (const mutate of [
    async ({ vault }) => { await vault.delete(vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/working/chapter-1.md")); },
    async ({ vault }) => { const file = vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/session.json"); const json = JSON.parse(await vault.read(file)); json.documents[0].localSourcePath = "Roman/Manuscrit/Un.md"; await vault.modify(file, JSON.stringify(json)); },
  ]) {
    const state = await setup(); await mutate(state); await rejects(() => createNativeReviewReviewerReturn(state.app, "review-return", "2.0.5"));
    assert.equal(state.vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/rounds/round-1-sent.feuillets"), null);
  }
});

test("refuse archive reçue invalide, tour déjà envoyé et collision d’archive", async () => {
  const invalid = await setup(); const received = invalid.vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/rounds/round-1-received.feuillets"); await invalid.vault.modify(received, "corrompu"); await rejects(() => createNativeReviewReviewerReturn(invalid.app, "review-return", "2.0.5"));
  const sent = await setup(); await createNativeReviewReviewerReturn(sent.app, "review-return", "2.0.5"); await rejects(() => createNativeReviewReviewerReturn(sent.app, "review-return", "2.0.5"));
  const collision = await setup(); await collision.vault.createBinary("_Feuillets/Relectures/review-return/rounds/round-1-sent.feuillets", "ancien"); await rejects(() => createNativeReviewReviewerReturn(collision.app, "review-return", "2.0.5"));
});

test("un échec createBinary conserve session.json et un échec save ne retourne pas de succès", async () => {
  const binary = await setup(); const sessionFile = binary.vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/session.json"); const before = await binary.vault.read(sessionFile);
  binary.app.vault.createBinary = async () => { throw new Error("disque plein"); }; await rejects(() => createNativeReviewReviewerReturn(binary.app, "review-return", "2.0.5")); assert.equal(await binary.vault.read(sessionFile), before);
  const saving = await setup(); saving.app.vault.modify = async () => { throw new Error("écriture impossible"); }; await rejects(() => createNativeReviewReviewerReturn(saving.app, "review-return", "2.0.5")); assert.ok(saving.vault.getAbstractFileByPath("_Feuillets/Relectures/review-return/rounds/round-1-sent.feuillets") instanceof TFile);
});
