import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewPackage } from "../src/services/native-review-package.js";
import { createReviewSession, loadReviewSession, reviewRoundsRootPath } from "../src/services/native-review-session.js";
import { decideNativeReviewAuthorChange } from "../src/services/native-review-author-decisions.js";
import { createNativeReviewAuthorNextRound, NativeReviewAuthorNextRoundError } from "../src/services/native-review-author-next-round.js";

const people = [{ id: "a", name: "A", role: "author" }, { id: "b", name: "B", role: "reviewer" }];
async function fixture({ current = "Bonjour cher monde.", returned = "Salut monde.", rounds = 1, originalPath = "Un.md" } = {}) {
  const root = new TFolder("Roman/Manuscrit"); const file = new TFile("Roman/Manuscrit/Un.md", current); root.children = [file]; file.parent = root;
  const { vault } = createFakeVault([root, file]); const app = { vault, fileManager: { trashFile: async () => {} } }; const at = "2026-08-13T10:00:00.000Z";
  const make = (senderRole, packageId, round, workingMarkdown) => createNativeReviewPackage({ packageId, createdAt: at, createdByVersion: "2", reviewId: "r", round, senderRole, participants: people }, [{ documentId: "one", originalPath, title: "Un", baseMarkdown: "Bonjour monde.", workingMarkdown }]);
  const sessionRounds = Array.from({ length: rounds }, (_, i) => ({ round: i + 1, createdAt: at, sent: { packageId: `sent-${i + 1}`, at }, received: { packageId: `received-${i + 1}`, at } }));
  await createReviewSession(app, { version: 1, reviewId: "r", localRole: "author", status: "active", createdAt: at, updatedAt: at, participants: people, documents: [{ documentId: "one", originalPath, title: "Un", localSourcePath: file.path }], rounds: sessionRounds });
  const sent = await make("author", `sent-${rounds}`, rounds, "Bonjour monde."); await vault.createBinary(`${reviewRoundsRootPath("r")}/round-${rounds}-sent.feuillets`, sent.buffer);
  const returnedPackage = await make("reviewer", `received-${rounds}`, rounds, returned); await vault.createBinary(`${reviewRoundsRootPath("r")}/round-${rounds}-received.feuillets`, returnedPackage.buffer);
  return { app, vault, root, file, settings: { projectFolder: root.path } };
}
async function decide(f) { await decideNativeReviewAuthorChange(f.app, f.settings, "r", "one", 0, "rejected"); }
test("crée et archive le tour 2 après toutes les décisions", async () => {
  const f = await fixture(); await decide(f); const raw = await f.vault.read(f.file);
  const result = await createNativeReviewAuthorNextRound(f.app, f.settings, "r", "9A");
  assert.match(result.reviewPackage.manifest.packageId, /^package-[0-9a-f]{32}$/); assert.equal(result.reviewPackage.manifest.senderRole, "author"); assert.equal(result.reviewPackage.manifest.round, 2);
  assert.equal(result.reviewPackage.manifest.reviewId, "r"); assert.deepEqual(result.reviewPackage.manifest.participants, people);
  assert.deepEqual(result.reviewPackage.documents.map((d) => d.documentId), ["one"]); assert.equal(result.reviewPackage.documents[0].baseMarkdown, raw); assert.equal(result.reviewPackage.documents[0].workingMarkdown, raw);
  assert.equal(await f.vault.read(f.file), raw); const archive = f.vault.getAbstractFileByPath(result.localPackagePath); assert.deepEqual(new Uint8Array(archive.content), new Uint8Array(result.packageData));
  assert.equal((await loadReviewSession(f.app, "r")).rounds[1].sent.packageId, result.reviewPackage.manifest.packageId);
});
test("refuse une décision manquante et autorise zéro changement", async () => {
  const missing = await fixture(); await assert.rejects(() => createNativeReviewAuthorNextRound(missing.app, missing.settings, "r", "9A"), NativeReviewAuthorNextRoundError);
  const none = await fixture({ current: "Bonjour monde.", returned: "Bonjour monde." }); const result = await createNativeReviewAuthorNextRound(none.app, none.settings, "r", "9A"); assert.equal(result.reviewPackage.manifest.round, 2);
});
test("n'utilise jamais originalPath et refuse source absente ou hors Manuscrit", async () => {
  const decoy = await fixture({ originalPath: "Piège.md" }); await decide(decoy); await decoy.vault.create("Piège.md", "NE PAS LIRE"); const read = decoy.vault.read.bind(decoy.vault);
  decoy.vault.read = async (file) => { if (file.path === "Piège.md") throw new Error("decoy read"); return read(file); };
  const result = await createNativeReviewAuthorNextRound(decoy.app, decoy.settings, "r", "9A"); assert.notEqual(result.reviewPackage.documents[0].baseMarkdown, "NE PAS LIRE");
  const missing = await fixture(); await decide(missing); const get = missing.vault.getAbstractFileByPath.bind(missing.vault); missing.vault.getAbstractFileByPath = (path) => path === missing.file.path ? null : get(path);
  await assert.rejects(() => createNativeReviewAuthorNextRound(missing.app, missing.settings, "r", "9A"), NativeReviewAuthorNextRoundError);
  const outside = await fixture(); await decide(outside); outside.file.path = "Autre/Un.md";
  await assert.rejects(() => createNativeReviewAuthorNextRound(outside.app, outside.settings, "r", "9A"), NativeReviewAuthorNextRoundError);
});
test("supprime le frontmatter privé du paquet sans modifier le Manuscrit", async () => {
  const raw = "---\nprivate: oui\n---\nBonjour cher monde."; const f = await fixture({ current: raw }); await decide(f);
  const result = await createNativeReviewAuthorNextRound(f.app, f.settings, "r", "9A"); assert.equal(result.reviewPackage.documents[0].baseMarkdown, "Bonjour cher monde."); assert.equal(await f.vault.read(f.file), raw);
});
test("refuse une collision d'archive et ne touche pas la session", async () => {
  const f = await fixture(); await decide(f); await f.vault.createBinary(`${reviewRoundsRootPath("r")}/round-2-sent.feuillets`, new ArrayBuffer(0)); const before = JSON.stringify(await loadReviewSession(f.app, "r"));
  await assert.rejects(() => createNativeReviewAuthorNextRound(f.app, f.settings, "r", "9A"), NativeReviewAuthorNextRoundError); assert.equal(JSON.stringify(await loadReviewSession(f.app, "r")), before);
});
test("échec d'archive laisse session inchangée; échec session laisse archive", async () => {
  const first = await fixture(); await decide(first); const before = JSON.stringify(await loadReviewSession(first.app, "r")); const binary = first.vault.createBinary.bind(first.vault); first.vault.createBinary = async () => { throw new Error("disk"); };
  await assert.rejects(() => createNativeReviewAuthorNextRound(first.app, first.settings, "r", "9A"), NativeReviewAuthorNextRoundError); assert.equal(JSON.stringify(await loadReviewSession(first.app, "r")), before); first.vault.createBinary = binary;
  const second = await fixture(); await decide(second); const modify = second.vault.modify.bind(second.vault); second.vault.modify = async (file, text) => { if (file.path.endsWith("session.json")) throw new Error("session"); return modify(file, text); };
  await assert.rejects(() => createNativeReviewAuthorNextRound(second.app, second.settings, "r", "9A"), NativeReviewAuthorNextRoundError); assert.ok(second.vault.getAbstractFileByPath(`${reviewRoundsRootPath("r")}/round-2-sent.feuillets`));
});
test("depuis un tour N supérieur à 1 crée N+1", async () => {
  const f = await fixture({ rounds: 2 }); await decide(f); const result = await createNativeReviewAuthorNextRound(f.app, f.settings, "r", "9A"); assert.equal(result.reviewPackage.manifest.round, 3); assert.equal(result.session.rounds.at(-1).round, 3);
});
