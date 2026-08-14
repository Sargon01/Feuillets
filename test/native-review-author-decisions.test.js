import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createNativeReviewPackage } from "../src/services/native-review-package.js";
import { createReviewSession, reviewRoundsRootPath } from "../src/services/native-review-session.js";
import { receiveNativeReviewReturnForAuthor, loadNativeReviewAuthorAnalysis } from "../src/services/native-review-author-return.js";
import { decideNativeReviewAuthorChange, decideNativeReviewAuthorGroup, loadNativeReviewAuthorDecisionState, NativeReviewAuthorDecisionError } from "../src/services/native-review-author-decisions.js";
import { loadNativeReviewWork } from "../src/services/native-review-work.js";

const people = [{ id: "a", name: "A", role: "author" }, { id: "b", name: "B", role: "reviewer" }];
async function fixture(current = "Bonjour cher monde.", returned = "Salut monde.", base = "Bonjour monde.") {
  const root = new TFolder("Roman/Manuscrit"); const file = new TFile("Roman/Manuscrit/Un.md", current); root.children = [file]; file.parent = root;
  const { vault } = createFakeVault([root, file]); const app = { vault, fileManager: { trashFile: async () => {} } }; const at = "2026-08-13T10:00:00.000Z";
  const doc = { documentId: "one", originalPath: "Un.md", title: "Un", baseMarkdown: base };
  const make = async (senderRole, packageId, workingMarkdown) => createNativeReviewPackage({ packageId, createdAt: at, createdByVersion: "2", reviewId: "r", round: 1, senderRole, participants: people }, [{ ...doc, workingMarkdown }]);
  const sent = await make("author", "sent", doc.baseMarkdown);
  await createReviewSession(app, { version: 1, reviewId: "r", localRole: "author", status: "active", createdAt: at, updatedAt: at, participants: people, documents: [{ documentId: "one", originalPath: "Un.md", title: "Un", localSourcePath: file.path }], rounds: [{ round: 1, createdAt: at, sent: { packageId: "sent", at } }] });
  await vault.createBinary(`${reviewRoundsRootPath("r")}/round-1-sent.feuillets`, sent.buffer);
  await receiveNativeReviewReturnForAuthor(app, "r", await make("reviewer", "returned", returned));
  return { app, vault, file, settings: { projectFolder: root.path } };
}
test("décision groupée atomique : une écriture source, un snapshot et toutes les décisions", async () => {
  const base = "Un deux trois quatre."; const returned = "UN deux TROIS quatre."; const value = await fixture(base, returned, base);
  const analysis = await loadNativeReviewAuthorAnalysis(value.app, "r"); assert.equal(analysis.analyses[0].changes.length, 2);
  let sourceWrites = 0; const modify = value.vault.modify.bind(value.vault); value.vault.modify = async (file, text) => { if (file === value.file) sourceWrites += 1; return modify(file, text); };
  await decideNativeReviewAuthorGroup(value.app, value.settings, "r", "one", [0, 1], "accepted");
  assert.equal(await value.vault.read(value.file), returned); assert.equal(sourceWrites, 1);
  const state = await loadNativeReviewAuthorDecisionState(value.app, "r"); assert.equal(state.store.documents[0].decisions.length, 2); assert.ok(state.store.documents[0].snapshotStamp);
});
test("décision groupée atomique : validation échouée ou ambiguë ne produit aucune écriture partielle", async () => {
  const base = "Un deux trois quatre."; const value = await fixture(base, "UN deux TROIS quatre.", base); const before = await value.vault.read(value.file);
  await assert.rejects(() => decideNativeReviewAuthorGroup(value.app, value.settings, "r", "one", [0, 99], "accepted"), NativeReviewAuthorDecisionError);
  assert.equal(await value.vault.read(value.file), before); assert.equal((await loadNativeReviewAuthorDecisionState(value.app, "r")).store.documents.length, 0);
  const ambiguous = await fixture("Texte divergent", "UN deux TROIS quatre.", base);
  await assert.rejects(() => decideNativeReviewAuthorGroup(ambiguous.app, ambiguous.settings, "r", "one", [0, 1], "accepted"), NativeReviewAuthorDecisionError);
  assert.equal(await ambiguous.vault.read(ambiguous.file), "Texte divergent");
});
test("refus groupé conserve le Markdown et persiste les décisions ensemble", async () => {
  const base = "Un deux trois quatre."; const value = await fixture(base, "UN deux TROIS quatre.", base);
  await decideNativeReviewAuthorGroup(value.app, value.settings, "r", "one", [0, 1], "rejected");
  assert.equal(await value.vault.read(value.file), base); const state = await loadNativeReviewAuthorDecisionState(value.app, "r"); assert.deepEqual(state.store.documents[0].decisions.map((item) => item.decision), ["rejected", "rejected"]);
});
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

/* --- F. Relecture 3-way : déplacement + ajout indépendant -----------------
 * Même fragment déplacé qu'en comparison-model.test.js/native-review-change-
 * groups.test.js, cette fois bout en bout : un vrai relecteur reçu, une
 * analyse 3-way réelle, un déplacement décidé PUIS un ajout voisin décidé
 * séparément. La normalisation du diff (comparison-model.ts) ne doit jamais
 * fabriquer de faux chevauchement, et chaque décision groupée reste
 * strictement isolée à SES propres indices — jamais un changement voisin. */
const movedPassageF = "Dans le silence du cabinet de réflexion, une bougie vacillait faiblement.";
const anchorPassageF = "En tant qu'enfant exilé loin de sa terre natale, il n'avait jamais imaginé qu'un jour il reviendrait dans cette maison qui avait vu grandir tant de générations avant lui, et pourtant le voilà, debout, immobile, incapable de faire un pas de plus vers la porte qui l'attendait.";
const independentNearF = "Un deux trois c'est un ajout.";
const independentEndF = "Ici il y a un ajout.";
const movedBeforeF = `${movedPassageF}\n\n${anchorPassageF}`;
const movedAfterF = `${anchorPassageF}\n${independentNearF}\n${movedPassageF}\n${independentEndF}`;

test("F. déplacement + ajout indépendant : analyse correcte, aucun faux chevauchement, décisions isolées", async () => {
  const value = await fixture(movedBeforeF, movedAfterF, movedBeforeF);
  const work = await loadNativeReviewWork(value.app, "r");
  const changes = work.documents[0].changes;
  const move = changes.find((change) => change.kind === "move");
  assert.ok(move, `le déplacement est reconnu bout en bout (obtenu : ${changes.map((c) => c.kind).join(", ")})`);
  const additions = changes.filter((change) => change.kind === "addition");
  assert.equal(additions.length, 2, "les deux ajouts indépendants restent séparés du déplacement, jamais absorbés");
  assert.ok(changes.every((change) => change.applicable), "aucun faux chevauchement inventé par la normalisation — tout reste applicable");
  assert.equal(new Set(changes.flatMap((change) => change.changeIndexes)).size, changes.reduce((total, change) => total + change.changeIndexes.length, 0), "aucun indice de changement brut partagé entre deux groupes");

  // Décider le déplacement seul : Apply fonctionne, et les ajouts voisins
  // restent des changements en attente, jamais touchés.
  await decideNativeReviewAuthorGroup(value.app, value.settings, "r", "one", move.changeIndexes, "accepted");
  const afterMove = (await loadNativeReviewWork(value.app, "r")).documents[0].changes;
  assert.equal(afterMove.find((change) => change.kind === "move").decision, "accepted");
  const pendingAdditions = afterMove.filter((change) => change.kind === "addition");
  assert.ok(pendingAdditions.every((change) => change.decision === null), "décider le déplacement ne décide jamais un changement voisin");

  // Ignorer un des deux ajouts : Ignore fonctionne, l'AUTRE ajout et le
  // déplacement déjà décidé restent strictement inchangés.
  await decideNativeReviewAuthorGroup(value.app, value.settings, "r", "one", pendingAdditions[0].changeIndexes, "rejected");
  const finalChanges = (await loadNativeReviewWork(value.app, "r")).documents[0].changes;
  assert.equal(finalChanges.find((change) => change.kind === "move").decision, "accepted", "le déplacement déjà décidé n'a pas bougé");
  assert.equal(finalChanges.find((change) => change.changeIndexes[0] === pendingAdditions[0].changeIndexes[0]).decision, "rejected");
  assert.equal(finalChanges.find((change) => change.changeIndexes[0] === pendingAdditions[1].changeIndexes[0]).decision, null, "ignorer un ajout ne décide jamais son voisin");
});
