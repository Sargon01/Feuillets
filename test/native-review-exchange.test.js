import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { completeNativeReviewSession, listNativeReviewSessions, receiveNativeReviewExchange, NativeReviewExchangeError } from "../src/services/native-review-exchange.js";
import { createReviewSession, loadReviewSession } from "../src/services/native-review-session.js";
import { createNativeReviewAuthor } from "../src/services/native-review-author.js";
import { createNativeReviewAuthorNextRound } from "../src/services/native-review-author-next-round.js";
import { createNativeReviewReviewerReturn } from "../src/services/native-review-reviewer-return.js";
import { createNativeReviewPackage } from "../src/services/native-review-package.js";
import { loadNativeReviewAuthorAnalysis } from "../src/services/native-review-author-return.js";
import { decideNativeReviewAuthorChange } from "../src/services/native-review-author-decisions.js";

const session = (reviewId, updatedAt, role = "reviewer") => ({
  version: 1, reviewId, localRole: role, status: "active", createdAt: "2026-08-13T10:00:00.000Z", updatedAt,
  participants: [{ id: "author", name: "Auteur", role: "author" }, { id: "reviewer", name: "Relecteur", role: "reviewer" }],
  documents: [{ documentId: "doc", originalPath: "Un.md", title: "Un", localSourcePath: "_Feuillets/Relectures/" + reviewId + "/working/doc.md" }],
  rounds: [{ round: 1, createdAt: "2026-08-13T10:00:00.000Z", received: { packageId: "received-" + reviewId, at: "2026-08-13T10:00:00.000Z" }, sent: { packageId: "sent-" + reviewId, at: "2026-08-13T10:01:00.000Z" } }],
});
const appWith = () => { const { vault } = createFakeVault(); return { app: { vault }, vault }; };
const people = [{ id: "author", name: "Auteur", role: "author" }, { id: "reviewer", name: "Relecteur", role: "reviewer" }];
const packageFor = (senderRole, round = 1, reviewId = "incoming") => createNativeReviewPackage({ packageId: `${senderRole}-${round}-${reviewId}`, createdAt: "2026-08-13T10:00:00.000Z", createdByVersion: "test", reviewId, round, senderRole, participants: people }, [{ documentId: "doc", originalPath: "Un.md", title: "Un", baseMarkdown: "Bonjour monde." }]);
function authorFixture() {
  const project = new TFolder("Roman"); const manuscript = new TFolder("Roman/Manuscrit"); const file = new TFile("Roman/Manuscrit/Un.md", "Bonjour monde.");
  project.children = [manuscript]; manuscript.parent = project; manuscript.children = [file]; file.parent = manuscript;
  const { vault } = createFakeVault([project, manuscript, file]);
  return { vault, file, app: { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } }, settings: { projectFolder: "Roman/Manuscrit", orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" } };
}
async function authorRoundOne(author) { return createNativeReviewAuthor(author.app, author.settings, { scope: { type: "file", path: author.file.path }, authorName: "Auteur", reviewerName: "Relecteur", createdByVersion: "test" }); }
async function returnToAuthor(author, reviewer, reviewId) {
  const working = reviewer.vault.getAbstractFileByPath(`_Feuillets/Relectures/${reviewId}/working/${(await loadReviewSession(reviewer.app, reviewId)).documents[0].documentId}.md`);
  await reviewer.vault.modify(working, "Salut monde.");
  const returned = await createNativeReviewReviewerReturn(reviewer.app, reviewId, "test");
  return receiveNativeReviewExchange(author.app, returned.packageData);
}
async function rejectAll(author, reviewId) {
  const analysis = await loadNativeReviewAuthorAnalysis(author.app, reviewId);
  for (const document of analysis.analyses) for (let index = 0; index < document.changes.length; index += 1) await decideNativeReviewAuthorChange(author.app, author.settings, reviewId, document.documentId, index, "rejected");
}

test("exchange: liste vide, triée, et session corrompue signalée", async () => {
  const { app, vault } = appWith();
  assert.deepEqual(await listNativeReviewSessions(app), []);
  await createReviewSession(app, session("older", "2026-08-13T11:00:00.000Z"));
  await createReviewSession(app, session("newer", "2026-08-13T12:00:00.000Z"));
  await vault.createFolder("_Feuillets/Relectures/broken");
  await vault.create("_Feuillets/Relectures/broken/session.json", "{");
  const listed = await listNativeReviewSessions(app);
  assert.deepEqual(listed.map((entry) => entry.reviewId), ["newer", "older", "broken"]);
  assert.match(listed[2].error, /corrompu/i);
});

test("exchange: clôture un tour reviewer complet sans supprimer les archives, workings ou fils", async () => {
  const { app, vault } = appWith(); const value = session("finished", "2026-08-13T11:00:00.000Z");
  await createReviewSession(app, value);
  await vault.createBinary("_Feuillets/Relectures/finished/rounds/round-1-sent.feuillets", new ArrayBuffer(1));
  await vault.create("_Feuillets/Relectures/finished/working/doc.md", "travail");
  await vault.create("_Feuillets/Relectures/finished/threads.json", '{"version":1,"threads":[]}');
  await completeNativeReviewSession(app, "finished");
  assert.equal((await loadReviewSession(app, "finished")).status, "completed");
  for (const path of ["_Feuillets/Relectures/finished/rounds/round-1-sent.feuillets", "_Feuillets/Relectures/finished/working/doc.md", "_Feuillets/Relectures/finished/threads.json"]) assert.ok(vault.getAbstractFileByPath(path) instanceof TFile);
});

test("exchange: route auteur round 1 vers un reviewer isolé, sans projet ni settings", async () => {
  const author = authorFixture(); const outgoing = await authorRoundOne(author); const reviewerVault = createFakeVault(); const reviewer = { app: { vault: reviewerVault.vault }, vault: reviewerVault.vault };
  const received = await receiveNativeReviewExchange(reviewer.app, outgoing.packageData);
  assert.equal(received.localRole, "reviewer"); assert.ok(received.rounds[0].received);
  assert.equal(reviewer.vault.getAbstractFileByPath("Roman"), null); assert.equal(reviewer.vault.getAbstractFileByPath("Manuscrit"), null);
});

test("exchange: route auteur round 2 vers la session reviewer existante", async () => {
  const author = authorFixture(); const first = await authorRoundOne(author); const reviewerState = createFakeVault(); const reviewer = { app: { vault: reviewerState.vault }, vault: reviewerState.vault };
  await receiveNativeReviewExchange(reviewer.app, first.packageData); await returnToAuthor(author, reviewer, first.session.reviewId); await rejectAll(author, first.session.reviewId);
  const second = await createNativeReviewAuthorNextRound(author.app, author.settings, first.session.reviewId, "test"); const received = await receiveNativeReviewExchange(reviewer.app, second.packageData);
  assert.equal(received.reviewId, first.session.reviewId); assert.equal(received.rounds.length, 2); assert.ok(received.rounds[1].received);
});

test("exchange: route un retour reviewer vers l'auteur et conserve son analyse", async () => {
  const author = authorFixture(); const first = await authorRoundOne(author); const reviewerState = createFakeVault(); const reviewer = { app: { vault: reviewerState.vault }, vault: reviewerState.vault };
  await receiveNativeReviewExchange(reviewer.app, first.packageData); const received = await returnToAuthor(author, reviewer, first.session.reviewId);
  assert.equal(received.localRole, "author"); assert.ok(received.rounds[0].received); assert.ok((await loadNativeReviewAuthorAnalysis(author.app, first.session.reviewId)).analyses[0].changes.length > 0);
});

test("exchange: refuse les combinaisons de rôle, tour, session et état invalides", async () => {
  const empty = appWith();
  await assert.rejects(() => receiveNativeReviewExchange(empty.app, packageFor("reviewer")), NativeReviewExchangeError);
  await assert.rejects(() => receiveNativeReviewExchange(empty.app, packageFor("author", 2)), NativeReviewExchangeError);
  const first = await packageFor("author"); await receiveNativeReviewExchange(empty.app, first);
  await assert.rejects(() => receiveNativeReviewExchange(empty.app, first), NativeReviewExchangeError);
  const wrong = appWith(); await createReviewSession(wrong.app, session("incoming", "2026-08-13T11:00:00.000Z", "author")); const authorRoundTwo = await packageFor("author", 2);
  await assert.rejects(() => receiveNativeReviewExchange(wrong.app, authorRoundTwo), NativeReviewExchangeError);
  const done = appWith(); const completed = session("incoming", "2026-08-13T12:00:00.000Z"); completed.status = "completed"; await createReviewSession(done.app, completed);
  await assert.rejects(() => receiveNativeReviewExchange(done.app, authorRoundTwo), NativeReviewExchangeError);
});

test("exchange: clôture auteur seulement après toutes les décisions, puis reste readonly", async () => {
  const author = authorFixture(); const first = await authorRoundOne(author); const reviewerState = createFakeVault(); const reviewer = { app: { vault: reviewerState.vault }, vault: reviewerState.vault };
  await receiveNativeReviewExchange(reviewer.app, first.packageData); await returnToAuthor(author, reviewer, first.session.reviewId);
  await assert.rejects(() => completeNativeReviewSession(author.app, first.session.reviewId), NativeReviewExchangeError);
  assert.equal((await loadReviewSession(author.app, first.session.reviewId)).status, "active");
  await rejectAll(author, first.session.reviewId); await completeNativeReviewSession(author.app, first.session.reviewId);
  assert.equal((await loadReviewSession(author.app, first.session.reviewId)).status, "completed");
  await assert.rejects(() => completeNativeReviewSession(author.app, first.session.reviewId), NativeReviewExchangeError);
  for (const path of [`_Feuillets/Relectures/${first.session.reviewId}/session.json`, `_Feuillets/Relectures/${first.session.reviewId}/rounds/round-1-sent.feuillets`, `_Feuillets/Relectures/${first.session.reviewId}/rounds/round-1-received.feuillets`, `_Feuillets/Relectures/${first.session.reviewId}/threads.json`]) assert.ok(author.vault.getAbstractFileByPath(path));
});
