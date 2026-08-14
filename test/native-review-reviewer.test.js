import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createFeuilletsPackage, readFeuilletsPackage } from "../src/services/feuillets-package.js";
import { createNativeReviewPackage, readNativeReviewPackage } from "../src/services/native-review-package.js";
import { receiveNativeReviewForReviewer, NativeReviewReviewerError } from "../src/services/native-review-reviewer.js";

const createdAt = "2026-08-13T10:00:00.000Z";
const participants = [
  { id: "alice", name: "Alice", role: "author" },
  { id: "bob", name: "Bob", role: "reviewer" },
];
const documents = [
  { documentId: "chapter-1", originalPath: "Roman/Manuscrit/Un.md", title: "Un", baseMarkdown: "Premier contenu." },
  { documentId: "chapter-2", originalPath: "Recherche/prive.md", title: "Deux", baseMarkdown: "Second contenu." },
];
const packageInput = (overrides = {}) => ({
  packageId: "package-1", createdAt, createdByVersion: "2.0.5", reviewId: "review-1", round: 1, senderRole: "author", participants, ...overrides,
});
const appWith = (entries = []) => {
  const { vault } = createFakeVault(entries);
  return { app: { vault }, vault };
};
const rejects = (action) => assert.rejects(action, NativeReviewReviewerError);

test("reçoit le tour auteur initial, archive ses octets et crée les workings isolés", async () => {
  const manuscript = new TFolder("Roman/Manuscrit"); const source = new TFile("Roman/Manuscrit/Un.md", "Ne pas modifier");
  manuscript.children = [source]; source.parent = manuscript;
  const { app, vault } = appWith([manuscript, source]);
  const data = await createNativeReviewPackage(packageInput(), documents);
  const result = await receiveNativeReviewForReviewer(app, data);

  assert.equal(result.session.localRole, "reviewer"); assert.equal(result.session.createdAt, createdAt);
  assert.equal(result.session.rounds[0].received.packageId, "package-1"); assert.equal("sent" in result.session.rounds[0], false);
  assert.ok(Number.isFinite(Date.parse(result.session.rounds[0].received.at)));
  assert.equal(result.session.documents.length, 2); assert.deepEqual(result.session.documents.map((item) => item.title), ["Un", "Deux"]);
  assert.deepEqual(result.session.documents.map((item) => item.localSourcePath), [
    "_Feuillets/Relectures/review-1/working/chapter-1.md", "_Feuillets/Relectures/review-1/working/chapter-2.md",
  ]);
  assert.equal(await vault.read(source), "Ne pas modifier");
  for (const document of result.reviewPackage.documents) assert.equal(document.baseMarkdown, document.workingMarkdown);
  assert.equal(await vault.read(result.workingFiles[0]), "Premier contenu."); assert.equal(await vault.read(result.workingFiles[1]), "Second contenu.");
  const archive = vault.getAbstractFileByPath(result.localPackagePath); assert.ok(archive instanceof TFile);
  const archived = await vault.readBinary(archive); assert.deepEqual(new Uint8Array(archived), data);
  assert.equal((await readNativeReviewPackage(archived)).manifest.reviewId, "review-1");
  const sessionFile = vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/session.json"); assert.ok(sessionFile instanceof TFile);
  assert.equal((await vault.read(sessionFile)).includes("localSourcePath"), true);
  assert.equal(JSON.stringify(result.reviewPackage.manifest).includes("localSourcePath"), false);
});

test("refuse avant écriture les paquets reviewer, round 2 et corrompus", async () => {
  for (const data of [
    await createNativeReviewPackage(packageInput({ senderRole: "reviewer" }), documents),
    await createNativeReviewPackage(packageInput({ round: 2 }), documents),
    new Uint8Array([0, 1, 2]),
  ]) {
    const { app, vault } = appWith(); await rejects(() => receiveNativeReviewForReviewer(app, data));
    assert.equal(vault.getAbstractFileByPath("_Feuillets/Relectures"), null);
  }
});

test("refuse une session existante ou les collisions de dossiers sans écrasement", async () => {
  const data = await createNativeReviewPackage(packageInput(), documents);
  const { app, vault } = appWith(); await receiveNativeReviewForReviewer(app, data);
  const previous = await vault.read(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/session.json"));
  await rejects(() => receiveNativeReviewForReviewer(app, data));
  assert.equal(await vault.read(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/session.json")), previous);
  const collision = appWith([new TFile("_Feuillets", "bloque")]);
  await rejects(() => receiveNativeReviewForReviewer(collision.app, data));
});

test("ne persiste aucune propriété distante étrangère", async () => {
  const original = await createNativeReviewPackage(packageInput(), documents);
  const parsed = await readFeuilletsPackage(original);
  const manifest = {
    ...parsed.manifest,
    remoteFlag: "à ignorer",
    participants: parsed.manifest.participants.map((participant) => ({ ...participant, email: "secret@example.test" })),
    documents: parsed.manifest.documents.map((document) => ({ ...document, privateNote: "à ignorer" })),
  };
  const entries = Object.fromEntries(parsed.entries.map((entry) => [entry.path, entry.data]));
  const { app, vault } = appWith(); await receiveNativeReviewForReviewer(app, await createFeuilletsPackage(manifest, entries));
  const session = vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/session.json"); assert.ok(session instanceof TFile);
  const serialized = await vault.read(session);
  for (const forbidden of ["remoteFlag", "à ignorer", "email", "secret@example.test", "privateNote"]) assert.equal(serialized.includes(forbidden), false);
});

test("propage l’échec d’archivage sans retourner un succès", async () => {
  const { app, vault } = appWith(); const data = await createNativeReviewPackage(packageInput(), documents);
  app.vault.createBinary = async () => { throw new Error("disque plein"); };
  await rejects(() => receiveNativeReviewForReviewer(app, data));
  assert.ok(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/session.json") instanceof TFile);
  assert.equal(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/rounds/round-1-received.feuillets"), null);
});
