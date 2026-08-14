import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { createNativeReviewAuthor } from "../src/services/native-review-author.js";
import { receiveNativeReviewForReviewer } from "../src/services/native-review-reviewer.js";
import { removeNativeReviewSession, reviewerReviewStorageLocation } from "../src/services/native-review-storage.js";

/**
 * Un working/*.md de relecture doit recevoir la même grammaire d'édition
 * qu'un feuillet normal (isActiveFileInProject pilote applyLiveTypoClasses
 * et applyIndentClass, voir src/main.ts), sans jamais devenir un vrai
 * feuillet du Manuscrit du relecteur ni porter de marqueur écrit dessus.
 */

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

/** Relecteur pur, sans aucun projet Feuillets configuré : la reconnaissance
 * ne doit pas en dépendre. */
function reviewerPlugin(vault, activeFile) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = {
    vault,
    workspace: {
      getActiveFile: () => activeFile,
      getActiveViewOfType: () => null,
    },
  };
  plugin.getProjectFolder = () => null;
  return plugin;
}

test("un working/*.md appartenant à une relecture est reconnu comme feuillet le temps de la session", async () => {
  const author = authorFixture();
  const outgoing = await createNativeReviewAuthor(author.app, author.settings, {
    scope: { type: "folder", path: "Roman/Manuscrit" }, authorName: "HY", reviewerName: "Pierre", createdByVersion: "test",
  });
  const { vault, fileManager } = createFakeVault();
  const received = await receiveNativeReviewForReviewer({ vault }, outgoing.packageData);
  assert.equal(received.session.documents.length, 2);

  const [document1, document2] = received.session.documents;
  const workingFile1 = vault.getAbstractFileByPath(document1.localSourcePath);
  const workingFile2 = vault.getAbstractFileByPath(document2.localSourcePath);
  assert.ok(workingFile1 instanceof TFile); assert.ok(workingFile2 instanceof TFile);
  const before1 = await vault.read(workingFile1); const before2 = await vault.read(workingFile2);

  // 1. Le premier feuillet de la relecture est reconnu.
  assert.equal(reviewerPlugin(vault, workingFile1).isActiveFileInProject(), true);
  // 3. Le second feuillet de la même relecture multi-feuillets l'est aussi.
  assert.equal(reviewerPlugin(vault, workingFile2).isActiveFileInProject(), true);

  // 2. Un Markdown ordinaire voisin, hors relecture, ne l'est pas — et un
  // relecteur pur (sans projet Feuillets) ne le reconnaît jamais non plus.
  const strangerVault = createFakeVault([new TFile("Notes libres.md", "Rien à voir.")]);
  const stranger = strangerVault.vault.getAbstractFileByPath("Notes libres.md");
  assert.equal(reviewerPlugin(strangerVault.vault, stranger).isActiveFileInProject(), false);
  assert.equal(reviewerPlugin(vault, null).isActiveFileInProject(), false);

  // 4. Ni le frontmatter ni le contenu ne sont modifiés par la reconnaissance.
  assert.equal(await vault.read(workingFile1), before1);
  assert.equal(await vault.read(workingFile2), before2);
  assert.equal(before1.startsWith("---"), false);
  assert.equal(before2.startsWith("---"), false);

  // 5. La suppression de la session (fin de relecture, copie locale purgée)
  // ne laisse aucune trace : la reconnaissance redevient négative sans avoir
  // jamais rien écrit sur les fichiers eux-mêmes — elle ne repose que sur
  // l'existence de session.json, jamais sur un marqueur posé sur le fichier.
  const trashed = [];
  await removeNativeReviewSession({ vault, fileManager: { trashFile: async (entry) => { trashed.push(entry.path); await fileManager.trashFile(entry); } } }, reviewerReviewStorageLocation(), received.session.reviewId);
  assert.deepEqual(trashed, [`_Feuillets/Relectures/${received.session.reviewId}`]);
  // La suppression réelle du dossier n'est pas simulée en cascade par le
  // faux coffre de test ; on retire directement session.json pour vérifier
  // que la reconnaissance en dépend bien, et seulement d'elle.
  await vault.delete(vault.getAbstractFileByPath(`_Feuillets/Relectures/${received.session.reviewId}/session.json`));
  assert.equal(reviewerPlugin(vault, workingFile1).isActiveFileInProject(), false);
});

test("un feuillet normal du Manuscrit du relecteur n'est pas affecté par la reconnaissance de relecture", () => {
  const { vault } = createFakeVault([new TFile("Roman/Manuscrit/Chapitre.md", "Texte.")]);
  const file = vault.getAbstractFileByPath("Roman/Manuscrit/Chapitre.md");
  const plugin = reviewerPlugin(vault, file);
  plugin.getProjectFolder = () => new TFolder("Roman/Manuscrit");
  assert.equal(plugin.isActiveReviewWorkingFile(file), false);
});
