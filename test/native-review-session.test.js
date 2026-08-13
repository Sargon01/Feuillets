import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  InvalidReviewSessionError, appendReviewRound, createReviewSession, currentReviewRound,
  isNativeReviewPath, loadReviewSession, recordReviewRoundPackage, reviewIdFromNativeReviewPath,
  reviewRoundsRootPath, reviewSessionFilePath, reviewSessionRootPath, reviewSessionsRootPath,
  reviewWorkingRootPath, saveReviewSession, validateReviewSession,
} from "../src/services/native-review-session.js";

const at = "2026-08-13T10:00:00.000Z";
const pkg = (id, when = at) => ({ packageId: id, at: when });
function session(reviewId = "review-1", localRole = "author") {
  return {
    version: 1, reviewId, localRole, status: "active", createdAt: at, updatedAt: at,
    participants: [{ id: "alice", name: "Alice", role: "author" }, { id: "bob", name: "Bob", role: "reviewer" }],
    documents: [{ documentId: "chapter-1", originalPath: "Roman/Manuscrit/Chapitre 1.md" }],
    rounds: [{ round: 1, createdAt: at, [localRole === "author" ? "sent" : "received"]: pkg("package-1") }],
  };
}
function appWith(entries = []) { const fixture = createFakeVault(entries); return { app: { vault: fixture.vault }, ...fixture }; }
async function rejectsInvalid(action) { await assert.rejects(action, InvalidReviewSessionError); }

test("crée une session auteur globale avec la structure exacte", async () => {
  const { app, vault } = appWith(); const value = session();
  await createReviewSession(app, value);
  assert.ok(vault.getAbstractFileByPath("_Feuillets") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("_Feuillets/Relectures") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/working") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/rounds") instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/session.json") instanceof TFile);
  assert.equal(reviewSessionsRootPath(), "_Feuillets/Relectures");
  assert.equal(reviewSessionRootPath("review-1"), "_Feuillets/Relectures/review-1");
  assert.equal(reviewSessionFilePath("review-1"), "_Feuillets/Relectures/review-1/session.json");
  assert.equal(reviewWorkingRootPath("review-1"), "_Feuillets/Relectures/review-1/working");
  assert.equal(reviewRoundsRootPath("review-1"), "_Feuillets/Relectures/review-1/rounds");
});

test("crée une session relecteur sans projet actif et préserve un projet actif", async () => {
  const project = new TFolder("Projet"); const manuscript = new TFolder("Projet/Manuscrit");
  project.children = [manuscript]; manuscript.parent = project;
  const { app, vault } = appWith([project, manuscript]);
  await createReviewSession(app, session("reviewer-session", "reviewer"));
  assert.equal((await loadReviewSession(app, "reviewer-session")).localRole, "reviewer");
  assert.equal(vault.getAbstractFileByPath("Projet/_Feuillets"), null);
  assert.equal(vault.getAbstractFileByPath("Projet/Manuscrit/_Feuillets"), null);
  assert.equal(vault.getAbstractFileByPath("Projet/Manuscrit"), manuscript);
});

test("deux sessions sont indépendantes", async () => {
  const { app, vault } = appWith(); await createReviewSession(app, session("one")); await createReviewSession(app, session("two", "reviewer"));
  assert.equal((await loadReviewSession(app, "one")).localRole, "author");
  assert.equal((await loadReviewSession(app, "two")).localRole, "reviewer");
  assert.ok(vault.getAbstractFileByPath("_Feuillets/Relectures/one/session.json"));
  assert.ok(vault.getAbstractFileByPath("_Feuillets/Relectures/two/session.json"));
});

test("validation refuse participants, documents, IDs et chemins dangereux", () => {
  const participants = session(); participants.participants[1].role = "author"; assert.throws(() => validateReviewSession(participants), InvalidReviewSessionError);
  const documents = session(); documents.documents = []; assert.throws(() => validateReviewSession(documents), InvalidReviewSessionError);
  const duplicate = session(); duplicate.documents.push({ documentId: "chapter-1", originalPath: "Autre.md" }); assert.throws(() => validateReviewSession(duplicate), InvalidReviewSessionError);
  const badId = session("../bad"); assert.throws(() => validateReviewSession(badId), InvalidReviewSessionError);
  const badPath = session(); badPath.documents[0].originalPath = "../secret.md"; assert.throws(() => validateReviewSession(badPath), InvalidReviewSessionError);
  const windowsPath = session(); windowsPath.documents[0].originalPath = "C:\\secret.md"; assert.throws(() => validateReviewSession(windowsPath), InvalidReviewSessionError);
});

test("auteur : le second package complète le tour courant avant append", () => {
  const value = session();
  assert.equal(currentReviewRound(value).round, 1);
  assert.throws(() => appendReviewRound(value, pkg("package-2")), InvalidReviewSessionError);
  recordReviewRoundPackage(value, pkg("package-2"));
  assert.equal(value.rounds[0].received.packageId, "package-2");
  assert.equal(recordReviewRoundPackage(value, pkg("package-2")), value.rounds[0]);
  assert.throws(() => recordReviewRoundPackage(value, pkg("replacement")), InvalidReviewSessionError);
  const second = appendReviewRound(value, pkg("package-3", "2026-08-13T11:00:00.000Z"));
  assert.equal(second.round, 2); assert.equal(second.sent.packageId, "package-3");
  assert.equal(currentReviewRound(value), second);
});

test("relecteur : le tour commence par received et est complété par sent", () => {
  const value = session("reviewer-round", "reviewer");
  assert.equal(value.rounds[0].received.packageId, "package-1");
  recordReviewRoundPackage(value, pkg("package-2"));
  assert.equal(value.rounds[0].sent.packageId, "package-2");
  const second = appendReviewRound(value, pkg("package-3"));
  assert.equal(second.round, 2); assert.equal(second.received.packageId, "package-3");
});

test("validation impose les transitions des tours et les sessions completed", () => {
  const authorReceived = session(); authorReceived.rounds = [{ round: 1, createdAt: at, received: pkg("package-1") }];
  assert.throws(() => validateReviewSession(authorReceived), InvalidReviewSessionError);
  const reviewerSent = session("reviewer", "reviewer"); reviewerSent.rounds = [{ round: 1, createdAt: at, sent: pkg("package-1") }];
  assert.throws(() => validateReviewSession(reviewerSent), InvalidReviewSessionError);
  const incompletePrior = session(); incompletePrior.rounds.push({ round: 2, createdAt: at, sent: pkg("package-2") });
  assert.throws(() => validateReviewSession(incompletePrior), InvalidReviewSessionError);
  const completed = session(); completed.status = "completed"; assert.throws(() => validateReviewSession(completed), InvalidReviewSessionError);
  const closed = session(); recordReviewRoundPackage(closed, pkg("package-2")); closed.status = "completed"; validateReviewSession(closed);
  assert.throws(() => appendReviewRound(closed, pkg("package-3")), InvalidReviewSessionError);
  assert.throws(() => recordReviewRoundPackage(closed, pkg("package-3")), InvalidReviewSessionError);
});

test("tours continus et packageId ne sont jamais réutilisés", () => {
  const gap = session(); recordReviewRoundPackage(gap, pkg("package-2")); gap.rounds.push({ round: 3, createdAt: at, sent: pkg("package-3") }); assert.throws(() => validateReviewSession(gap), InvalidReviewSessionError);
  const duplicate = session(); recordReviewRoundPackage(duplicate, pkg("package-2")); duplicate.rounds.push({ round: 1, createdAt: at, sent: pkg("package-3") }); assert.throws(() => validateReviewSession(duplicate), InvalidReviewSessionError);
  const reused = session(); recordReviewRoundPackage(reused, pkg("package-2")); appendReviewRound(reused, pkg("package-3")); assert.throws(() => recordReviewRoundPackage(reused, pkg("package-2")), InvalidReviewSessionError);
});

test("sauvegarde et recharge sans toucher aux autres fichiers", async () => {
  const { app, vault } = appWith(); const value = session(); await createReviewSession(app, value);
  recordReviewRoundPackage(value, pkg("package-2")); appendReviewRound(value, pkg("package-3")); value.updatedAt = "2026-08-13T11:00:00.000Z";
  await saveReviewSession(app, value); const loaded = await loadReviewSession(app, "review-1");
  assert.deepEqual(loaded, value); assert.equal(vault.getAbstractFileByPath("_Feuillets/Relectures/review-1/working") instanceof TFolder, true);
});

test("absence, JSON corrompu et reviewId incohérent sont explicitement gérés", async () => {
  const { app, vault } = appWith(); assert.equal(await loadReviewSession(app, "missing"), null);
  await createReviewSession(app, session("corrupt")); const corrupt = vault.getAbstractFileByPath(reviewSessionFilePath("corrupt")); await vault.modify(corrupt, "{broken");
  await rejectsInvalid(() => loadReviewSession(app, "corrupt")); assert.equal(await vault.read(corrupt), "{broken");
  await createReviewSession(app, session("mismatch")); const mismatch = vault.getAbstractFileByPath(reviewSessionFilePath("mismatch")); const altered = session("different"); await vault.modify(mismatch, JSON.stringify(altered));
  await rejectsInvalid(() => loadReviewSession(app, "mismatch"));
});

test("les collisions de fichiers sur chaque dossier sont refusées", async () => {
  for (const path of ["_Feuillets", "_Feuillets/Relectures", "_Feuillets/Relectures/review-1"]) {
    const { app } = appWith([new TFile(path, "collision")]); await rejectsInvalid(() => createReviewSession(app, session()));
  }
});

test("reconnaît uniquement les chemins de Relecture native", () => {
  assert.equal(isNativeReviewPath("_Feuillets/Relectures/review-1/working/copy.md"), true);
  assert.equal(reviewIdFromNativeReviewPath("_Feuillets/Relectures/review-1/rounds/a.json"), "review-1");
  assert.equal(isNativeReviewPath("Roman/Manuscrit/Chapitre.md"), false);
  assert.equal(reviewIdFromNativeReviewPath("_Feuillets/Relectures/../secret"), null);
  for (const path of ["/_Feuillets/Relectures/review-1/working", "_Feuillets//Relectures/review-1/working", "_Feuillets/Relectures/./review-1/working", "_Feuillets/Relectures/review-1/../working", "_Feuillets\\Relectures\\review-1\\working"]) {
    assert.equal(reviewIdFromNativeReviewPath(path), null);
  }
});

test("refuse les IDs de plus de 128 caractères", () => {
  const tooLong = "a".repeat(129);
  for (const change of [
    (value) => { value.reviewId = tooLong; },
    (value) => { value.participants[0].id = tooLong; },
    (value) => { value.documents[0].documentId = tooLong; },
    (value) => { value.rounds[0].sent.packageId = tooLong; },
  ]) {
    const value = session(); change(value); assert.throws(() => validateReviewSession(value), InvalidReviewSessionError);
  }
});
