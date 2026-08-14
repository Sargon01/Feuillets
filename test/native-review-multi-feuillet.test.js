import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { receiveNativeReviewExchange } from "../src/services/native-review-exchange.js";
import { loadReviewSession } from "../src/services/native-review-session.js";
import { createNativeReviewAuthor } from "../src/services/native-review-author.js";
import { createNativeReviewReviewerReturn } from "../src/services/native-review-reviewer-return.js";
import { loadNativeReviewWork } from "../src/services/native-review-work.js";

function authorFixture() {
  const project = new TFolder("Roman"); const manuscript = new TFolder("Roman/Manuscrit");
  const idee1 = new TFile("Roman/Manuscrit/Idée 1.md", "Contenu un.");
  const idee2 = new TFile("Roman/Manuscrit/Idée 2.md", "Contenu deux.");
  project.children = [manuscript]; manuscript.parent = project;
  manuscript.children = [idee1, idee2]; idee1.parent = manuscript; idee2.parent = manuscript;
  const { vault } = createFakeVault([project, manuscript, idee1, idee2]);
  return {
    vault, idee1, idee2,
    app: { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } },
    settings: { projectFolder: "Roman/Manuscrit", orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" },
  };
}

test("relecture à deux feuillets, bout en bout : envoi, import, retour et récupération distincts par document", async () => {
  const author = authorFixture();
  const outgoing = await createNativeReviewAuthor(author.app, author.settings, {
    scope: { type: "folder", path: "Roman/Manuscrit" }, authorName: "HY", reviewerName: "Pierre", createdByVersion: "test",
  });
  assert.equal(outgoing.session.documents.length, 2, "le paquet auteur doit contenir 2 documents");

  const reviewerVault = createFakeVault(); const reviewer = { app: { vault: reviewerVault.vault }, vault: reviewerVault.vault };
  const received = await receiveNativeReviewExchange(reviewer.app, outgoing.packageData);
  assert.equal(received.documents.length, 2, "la session reviewer doit contenir 2 documents");

  const reviewerSession = await loadReviewSession(reviewer.app, outgoing.session.reviewId);
  assert.equal(reviewerSession.documents.length, 2);
  for (const document of reviewerSession.documents) {
    const file = reviewer.vault.getAbstractFileByPath(document.localSourcePath);
    assert.ok(file instanceof TFile, `working absent pour ${document.title} (${document.localSourcePath})`);
  }

  // Le relecteur modifie les deux feuillets différemment.
  const byTitle = (title) => reviewerSession.documents.find((document) => document.title === title);
  await reviewer.vault.modify(reviewer.vault.getAbstractFileByPath(byTitle("Idée 1").localSourcePath), "Contenu un modifié.");
  await reviewer.vault.modify(reviewer.vault.getAbstractFileByPath(byTitle("Idée 2").localSourcePath), "Contenu deux modifié.");

  const returned = await createNativeReviewReviewerReturn(reviewer.app, outgoing.session.reviewId, "test");
  assert.equal(returned.workingFiles.length, 2);

  const receivedReturn = await receiveNativeReviewExchange(author.app, returned.packageData, author.settings);
  assert.equal(receivedReturn.documents.length, 2);

  const work = await loadNativeReviewWork(author.app, outgoing.session.reviewId, undefined);
  assert.equal(work.documents.length, 2, "le travail auteur doit exposer 2 documents");
  const workByTitle = (title) => work.documents.find((document) => document.title === title);
  // Chaque changement doit rester associé à son propre feuillet : pas de
  // permutation ni de perte lors du retour groupé.
  assert.equal(workByTitle("Idée 1").reviewerMarkdown, "Contenu un modifié.");
  assert.equal(workByTitle("Idée 2").reviewerMarkdown, "Contenu deux modifié.");
  assert.ok(workByTitle("Idée 1").changes.length > 0);
  assert.ok(workByTitle("Idée 2").changes.length > 0);
  assert.equal(workByTitle("Idée 1").authorMarkdown, "Contenu un.");
  assert.equal(workByTitle("Idée 2").authorMarkdown, "Contenu deux.");
});

test("mono-feuillet : le circuit à un seul document continue de fonctionner", async () => {
  const author = authorFixture();
  const outgoing = await createNativeReviewAuthor(author.app, author.settings, {
    scope: { type: "file", path: author.idee1.path }, authorName: "HY", reviewerName: "Pierre", createdByVersion: "test",
  });
  assert.equal(outgoing.session.documents.length, 1);

  const reviewerVault = createFakeVault(); const reviewer = { app: { vault: reviewerVault.vault }, vault: reviewerVault.vault };
  await receiveNativeReviewExchange(reviewer.app, outgoing.packageData);
  const reviewerSession = await loadReviewSession(reviewer.app, outgoing.session.reviewId);
  assert.equal(reviewerSession.documents.length, 1);
  await reviewer.vault.modify(reviewer.vault.getAbstractFileByPath(reviewerSession.documents[0].localSourcePath), "Contenu un modifié.");

  const returned = await createNativeReviewReviewerReturn(reviewer.app, outgoing.session.reviewId, "test");
  await receiveNativeReviewExchange(author.app, returned.packageData, author.settings);

  const work = await loadNativeReviewWork(author.app, outgoing.session.reviewId, undefined);
  assert.equal(work.documents.length, 1);
  assert.equal(work.documents[0].reviewerMarkdown, "Contenu un modifié.");
  assert.ok(work.documents[0].changes.length > 0);
});
