import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewPackage } from "../src/services/native-review-package.js";
import { createReviewSession, reviewRoundsRootPath } from "../src/services/native-review-session.js";
import { receiveNativeReviewReturnForAuthor, loadNativeReviewAuthorAnalysis } from "../src/services/native-review-author-return.js";
import { decideNativeReviewAuthorChange, loadNativeReviewAuthorDecisionState, NativeReviewAuthorDecisionError } from "../src/services/native-review-author-decisions.js";

const people = [{ id: "a", name: "A", role: "author" }, { id: "b", name: "B", role: "reviewer" }];
async function fixture(current = "Bonjour cher monde.", returned = "Salut monde.") {
  const root = new TFolder("Roman/Manuscrit"); const file = new TFile("Roman/Manuscrit/Un.md", current); root.children = [file]; file.parent = root;
  const { vault } = createFakeVault([root, file]); const app = { vault, fileManager: { trashFile: async () => {} } }; const at = "2026-08-13T10:00:00.000Z";
  const doc = { documentId: "one", originalPath: "Un.md", title: "Un", baseMarkdown: "Bonjour monde." };
  const make = async (senderRole, packageId, workingMarkdown) => createNativeReviewPackage({ packageId, createdAt: at, createdByVersion: "2", reviewId: "r", round: 1, senderRole, participants: people }, [{ ...doc, workingMarkdown }]);
  const sent = await make("author", "sent", doc.baseMarkdown);
  await createReviewSession(app, { version: 1, reviewId: "r", localRole: "author", status: "active", createdAt: at, updatedAt: at, participants: people, documents: [{ documentId: "one", originalPath: "Un.md", title: "Un", localSourcePath: file.path }], rounds: [{ round: 1, createdAt: at, sent: { packageId: "sent", at } }] });
  await vault.createBinary(`${reviewRoundsRootPath("r")}/round-1-sent.feuillets`, sent.buffer);
  await receiveNativeReviewReturnForAuthor(app, "r", await make("reviewer", "returned", returned));
  return { app, vault, file, settings: { projectFolder: root.path } };
}
test("recharge l’analyse et applique une modification sûre avec snapshot", async () => {
  const { app, vault, file, settings } = await fixture(); const analysis = await loadNativeReviewAuthorAnalysis(app, "r");
  assert.equal(analysis.analyses[0].changes[0].reason, "non-overlapping");
  await decideNativeReviewAuthorChange(app, settings, "r", "one", 0, "accepted");
  assert.equal(await vault.read(file), "Salut cher monde.");
  assert.ok(vault.getAbstractFileByPath(`${reviewRoundsRootPath("r")}/round-1-decisions.json`));
});
test("refuse une application ambiguous sans modifier la source", async () => {
  const { app, file, settings } = await fixture(); file.path = "Autre/Un.md";
  await assert.rejects(() => decideNativeReviewAuthorChange(app, settings, "r", "one", 0, "accepted"), NativeReviewAuthorDecisionError);
});
test("refuse une archive retour remplacée avec un autre packageId", async () => {
  const { app, vault } = await fixture(); const at = "2026-08-13T10:00:00.000Z";
  const other = await createNativeReviewPackage({ packageId: "other", createdAt: at, createdByVersion: "2", reviewId: "r", round: 1, senderRole: "reviewer", participants: people }, [{ documentId: "one", originalPath: "Un.md", title: "Un", baseMarkdown: "Bonjour monde.", workingMarkdown: "Salut monde." }]);
  const received = vault.getAbstractFileByPath(`${reviewRoundsRootPath("r")}/round-1-received.feuillets`);
  received.content = other.buffer;
  await assert.rejects(() => loadNativeReviewAuthorAnalysis(app, "r"));
});
test("accepted appliqué est idempotent et ne peut plus être rejeté", async () => {
  const { app, file, settings } = await fixture();
  await decideNativeReviewAuthorChange(app, settings, "r", "one", 0, "accepted"); const written = await app.vault.read(file);
  await decideNativeReviewAuthorChange(app, settings, "r", "one", 0, "accepted");
  assert.equal(await app.vault.read(file), written);
  await assert.rejects(() => decideNativeReviewAuthorChange(app, settings, "r", "one", 0, "rejected"), NativeReviewAuthorDecisionError);
});
test("already-applied refuse toujours rejected, même après un refus ancien", async () => {
  const first = await fixture("Salut monde.");
  await assert.rejects(() => decideNativeReviewAuthorChange(first.app, first.settings, "r", "one", 0, "rejected"), NativeReviewAuthorDecisionError);

  const second = await fixture();
  await decideNativeReviewAuthorChange(second.app, second.settings, "r", "one", 0, "rejected");
  await second.vault.modify(second.file, "Salut monde.");
  await assert.rejects(() => decideNativeReviewAuthorChange(second.app, second.settings, "r", "one", 0, "rejected"), NativeReviewAuthorDecisionError);
  await decideNativeReviewAuthorChange(second.app, second.settings, "r", "one", 0, "accepted");
  const store = JSON.parse(await second.vault.read(second.vault.getAbstractFileByPath(`${reviewRoundsRootPath("r")}/round-1-decisions.json`)));
  assert.equal(store.documents[0].decisions[0].applied, true);
});
test("reject normal ne crée ni snapshot ni modification", async () => {
  const { app, vault, file, settings } = await fixture(); const raw = await vault.read(file);
  await decideNativeReviewAuthorChange(app, settings, "r", "one", 0, "rejected");
  assert.equal(await vault.read(file), raw);
  assert.equal(vault.getAbstractFileByPath("Roman/_Feuillets/Snapshots"), null);
});
async function writeDecisionStore(vault, value) {
  await vault.create(`${reviewRoundsRootPath("r")}/round-1-decisions.json`, JSON.stringify(value));
}
function decision(overrides = {}) {
  return { changeIndex: 0, baseStart: 0, baseEnd: 7, oldText: "Bonjour", newText: "Salut", decision: "rejected", applied: false, decidedAt: "2026-08-13T10:10:00.000Z", ...overrides };
}
test("état de décision complet lorsque tous les changements sont décidés", async () => {
  const { app, vault } = await fixture();
  await writeDecisionStore(vault, { version: 1, documents: [{ documentId: "one", decisions: [decision()] }] });
  const state = await loadNativeReviewAuthorDecisionState(app, "r");
  assert.equal(state.complete, true); assert.deepEqual(state.unresolved, []);
});
test("état incomplet lorsqu'une décision est absente", async () => {
  const { app } = await fixture();
  const state = await loadNativeReviewAuthorDecisionState(app, "r");
  assert.equal(state.complete, false); assert.deepEqual(state.unresolved, [{ documentId: "one", changeIndex: 0 }]);
});
test("zéro changement est un état complet", async () => {
  const { app } = await fixture("Bonjour monde.", "Bonjour monde.");
  const state = await loadNativeReviewAuthorDecisionState(app, "r");
  assert.equal(state.complete, true, JSON.stringify(state));
});
test("état refuse signature divergente et index de changement inexistant", async () => {
  const first = await fixture();
  await writeDecisionStore(first.vault, { version: 1, documents: [{ documentId: "one", decisions: [decision({ newText: "Altéré" })] }] });
  await assert.rejects(() => loadNativeReviewAuthorDecisionState(first.app, "r"), NativeReviewAuthorDecisionError);
  const second = await fixture();
  await writeDecisionStore(second.vault, { version: 1, documents: [{ documentId: "one", decisions: [decision({ changeIndex: 9 })] }] });
  await assert.rejects(() => loadNativeReviewAuthorDecisionState(second.app, "r"), NativeReviewAuthorDecisionError);
});
test("chargement de l'état n'écrit jamais dans le Vault", async () => {
  const { app, vault } = await fixture(); let writes = 0;
  for (const method of ["create", "modify", "createBinary"]) { const original = vault[method].bind(vault); vault[method] = async (...args) => { writes += 1; return original(...args); }; }
  await loadNativeReviewAuthorDecisionState(app, "r");
  assert.equal(writes, 0);
});
