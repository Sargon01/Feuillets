import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewPackage } from "../src/services/native-review-package.js";
import { createReviewSession, loadReviewSession, reviewRoundsRootPath } from "../src/services/native-review-session.js";
import { receiveNativeReviewNextRoundForReviewer, NativeReviewReviewerNextRoundError } from "../src/services/native-review-reviewer-next-round.js";

const people = [{ id: "a", name: "A", role: "author" }, { id: "b", name: "B", role: "reviewer" }];
const workingPath = "_Feuillets/Relectures/r/working/one.md";
async function fixture({ round = 1 } = {}) {
  const working = new TFile(workingPath, "Retour reviewer N."); const { vault } = createFakeVault([working]); const app = { vault }; const at = "2026-08-13T10:00:00.000Z";
  const doc = { documentId: "one", originalPath: "Original.md", title: "Un", baseMarkdown: "Base N.", workingMarkdown: "Retour reviewer N." };
  const reviewerSent = await createNativeReviewPackage({ packageId: `reviewer-${round}`, createdAt: at, createdByVersion: "9B", reviewId: "r", round, senderRole: "reviewer", participants: people }, [doc]);
  const rounds = Array.from({ length: round }, (_, index) => ({ round: index + 1, createdAt: at, received: { packageId: `author-${index + 1}`, at }, sent: { packageId: `reviewer-${index + 1}`, at } }));
  await createReviewSession(app, { version: 1, reviewId: "r", localRole: "reviewer", status: "active", createdAt: at, updatedAt: at, participants: people, documents: [{ documentId: "one", originalPath: "Original.md", title: "Un", localSourcePath: workingPath }], rounds });
  await vault.createBinary(`${reviewRoundsRootPath("r")}/round-${round}-sent.feuillets`, reviewerSent.buffer);
  const incoming = (options = {}) => createNativeReviewPackage({ packageId: `author-${round + 1}`, createdAt: at, createdByVersion: "9B", reviewId: "r", round: round + 1, senderRole: "author", participants: people, ...options }, [{ documentId: "one", originalPath: "Original.md", title: "Un", baseMarkdown: "Nouveau auteur.", workingMarkdown: "Nouveau auteur." }]);
  return { app, vault, working, incoming, round };
}
test("reçoit le tour 2, archive les octets et remplace exactement le working", async () => {
  const f = await fixture(); const data = await f.incoming(); const before = await f.vault.read(f.working);
  const result = await receiveNativeReviewNextRoundForReviewer(f.app, data);
  assert.equal(result.reviewPackage.manifest.round, 2); assert.equal(result.reviewPackage.manifest.reviewId, "r"); assert.deepEqual(result.reviewPackage.manifest.participants, people);
  assert.equal(await f.vault.read(f.working), "Nouveau auteur."); assert.notEqual(await f.vault.read(f.working), before);
  const archive = f.vault.getAbstractFileByPath(result.localPackagePath); assert.deepEqual(new Uint8Array(archive.content), new Uint8Array(data));
  const session = await loadReviewSession(f.app, "r"); assert.equal(session.rounds[1].received.packageId, "author-2"); assert.deepEqual(session.documents.map(({ documentId, originalPath, title }) => ({ documentId, originalPath, title })), [{ documentId: "one", originalPath: "Original.md", title: "Un" }]);
});
test("refuse les paquets entrant invalides avant toute écriture", async () => {
  const cases = [
    async () => { const f = await fixture(); return [f, await f.incoming({ senderRole: "reviewer" })]; },
    async () => { const f = await fixture(); return [f, await f.incoming({ round: 1 })]; },
    async () => { const f = await fixture(); return [f, await f.incoming({ packageId: "reviewer-1" })]; },
    async () => { const f = await fixture(); return [f, await createNativeReviewPackage({ packageId: "author-2", createdAt: "2026-08-13T10:00:00.000Z", createdByVersion: "9B", reviewId: "r", round: 2, senderRole: "author", participants: [...people].reverse() }, [{ documentId: "one", originalPath: "Original.md", title: "Un", baseMarkdown: "Nouveau auteur.", workingMarkdown: "Nouveau auteur." }])]; },
    async () => { const f = await fixture(); return [f, await createNativeReviewPackage({ packageId: "author-2", createdAt: "2026-08-13T10:00:00.000Z", createdByVersion: "9B", reviewId: "r", round: 2, senderRole: "author", participants: people }, [{ documentId: "one", originalPath: "Autre.md", title: "Un", baseMarkdown: "Nouveau auteur.", workingMarkdown: "Nouveau auteur." }])]; },
  ];
  for (const make of cases) { const [f, data] = await make(); const old = await f.vault.read(f.working); await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(f.app, data), NativeReviewReviewerNextRoundError); assert.equal(await f.vault.read(f.working), old); }
  const absent = await fixture(); const absentData = await absent.incoming(); const missingApp = { vault: { ...absent.vault, getAbstractFileByPath: (path) => path.endsWith("session.json") ? null : absent.vault.getAbstractFileByPath(path) } }; await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(missingApp, absentData), NativeReviewReviewerNextRoundError);
});
test("refuse archive reviewer absente, corrompue ou incohérente", async () => {
  const missing = await fixture(); missing.vault.getAbstractFileByPath = ((get) => (path) => path.endsWith("round-1-sent.feuillets") ? null : get(path))(missing.vault.getAbstractFileByPath.bind(missing.vault));
  await assert.rejects(async () => receiveNativeReviewNextRoundForReviewer(missing.app, await missing.incoming()), NativeReviewReviewerNextRoundError);
  const bad = await fixture(); const sent = bad.vault.getAbstractFileByPath(`${reviewRoundsRootPath("r")}/round-1-sent.feuillets`); sent.content = new Uint8Array([1, 2, 3]).buffer;
  await assert.rejects(async () => receiveNativeReviewNextRoundForReviewer(bad.app, await bad.incoming()), NativeReviewReviewerNextRoundError);
  const wrong = await fixture(); const altered = await wrong.incoming({ senderRole: "reviewer", packageId: "wrong" }); const file = wrong.vault.getAbstractFileByPath(`${reviewRoundsRootPath("r")}/round-1-sent.feuillets`); file.content = altered.buffer;
  await assert.rejects(async () => receiveNativeReviewNextRoundForReviewer(wrong.app, await wrong.incoming()), NativeReviewReviewerNextRoundError);
});
test("protège le working local et exige son chemin exact", async () => {
  const edited = await fixture(); await edited.vault.modify(edited.working, "Travail local non archivé"); await assert.rejects(async () => receiveNativeReviewNextRoundForReviewer(edited.app, await edited.incoming()), NativeReviewReviewerNextRoundError); assert.equal(await edited.vault.read(edited.working), "Travail local non archivé");
  const path = await fixture(); path.working.path = "Autre.md"; await assert.rejects(async () => receiveNativeReviewNextRoundForReviewer(path.app, await path.incoming()), NativeReviewReviewerNextRoundError);
  const missing = await fixture(); missing.vault.getAbstractFileByPath = ((get) => (value) => value === workingPath ? null : get(value))(missing.vault.getAbstractFileByPath.bind(missing.vault)); await assert.rejects(async () => receiveNativeReviewNextRoundForReviewer(missing.app, await missing.incoming()), NativeReviewReviewerNextRoundError);
});
test("refuse une archive entrante différente et reprend une archive identique", async () => {
  const different = await fixture(); await different.vault.createBinary(`${reviewRoundsRootPath("r")}/round-2-received.feuillets`, new Uint8Array([3]).buffer); await assert.rejects(async () => receiveNativeReviewNextRoundForReviewer(different.app, await different.incoming()), NativeReviewReviewerNextRoundError);
  const retry = await fixture(); const data = await retry.incoming(); await retry.vault.createBinary(`${reviewRoundsRootPath("r")}/round-2-received.feuillets`, data.buffer); await retry.vault.modify(retry.working, "Nouveau auteur."); const result = await receiveNativeReviewNextRoundForReviewer(retry.app, data); assert.equal(result.session.rounds.at(-1).received.packageId, "author-2");
});
test("la reprise tolère ancien/nouveau, mais jamais un troisième contenu", async () => {
  const mixed = await fixture(); const data = await mixed.incoming(); await mixed.vault.createBinary(`${reviewRoundsRootPath("r")}/round-2-received.feuillets`, data.buffer); const result = await receiveNativeReviewNextRoundForReviewer(mixed.app, data); assert.equal(await mixed.vault.read(mixed.working), "Nouveau auteur."); assert.equal(result.session.rounds.length, 2);
  const third = await fixture(); const other = await third.incoming(); await third.vault.createBinary(`${reviewRoundsRootPath("r")}/round-2-received.feuillets`, other.buffer); await third.vault.modify(third.working, "Troisième contenu"); await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(third.app, other), NativeReviewReviewerNextRoundError);
});
test("les échecs écriture sont rejouables sans faux avancement de session", async () => {
  const archiveFailure = await fixture(); const data = await archiveFailure.incoming(); const create = archiveFailure.vault.createBinary.bind(archiveFailure.vault); archiveFailure.vault.createBinary = async () => { throw new Error("disk"); }; await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(archiveFailure.app, data), NativeReviewReviewerNextRoundError); assert.equal((await loadReviewSession(archiveFailure.app, "r")).rounds.length, 1); assert.equal(await archiveFailure.vault.read(archiveFailure.working), "Retour reviewer N."); archiveFailure.vault.createBinary = create;
  const mid = await fixture(); const midData = await mid.incoming(); const modify = mid.vault.modify.bind(mid.vault); let failed = false; mid.vault.modify = async (file, text) => { if (file.path === workingPath && !failed) { failed = true; throw new Error("working"); } return modify(file, text); }; await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(mid.app, midData), NativeReviewReviewerNextRoundError); assert.equal((await loadReviewSession(mid.app, "r")).rounds.length, 1); mid.vault.modify = modify; await receiveNativeReviewNextRoundForReviewer(mid.app, midData);
  const save = await fixture(); const saveData = await save.incoming(); const saveModify = save.vault.modify.bind(save.vault); save.vault.modify = async (file, text) => { if (file.path.endsWith("session.json")) throw new Error("session"); return saveModify(file, text); }; await assert.rejects(() => receiveNativeReviewNextRoundForReviewer(save.app, saveData), NativeReviewReviewerNextRoundError); save.vault.modify = saveModify; await receiveNativeReviewNextRoundForReviewer(save.app, saveData);
});
test("depuis N supérieur à 2 reçoit correctement N+1", async () => {
  const f = await fixture({ round: 3 }); const result = await receiveNativeReviewNextRoundForReviewer(f.app, await f.incoming()); assert.equal(result.reviewPackage.manifest.round, 4); assert.equal(result.session.rounds.at(-1).round, 4);
});
