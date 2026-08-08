import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { setLocale, getLocale } from "../src/i18n/index.js";
import {
  isNotebookRubricName,
  findNotebookResearchFolder,
  ensureNotebookResearchFolder,
  isUnderNotebookResearchFolder,
  notebookFolderName,
} from "../src/services/research.js";

/* Section 19 (1-7) : la fiche libre créée depuis le Carnet doit vivre dans
 * sa propre rubrique Recherche/Carnet (ou Research/Notebook), jamais
 * directement à la racine — et jamais en double au fil des changements de
 * langue d'Obsidian. */

function withLocale(locale, fn) {
  const before = getLocale();
  setLocale(locale);
  try {
    return fn();
  } finally {
    setLocale(before);
  }
}

function makeProject(researchFolderName) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder(`Projet/${researchFolderName}`);
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  const { vault } = createFakeVault([volume, manuscript, research]);
  const app = { vault };
  const settings = { projectFolder: manuscript.path };
  return { app, settings, manuscript, research };
}

test("notebookFolderName : suit la locale active (fr → Carnet, en → Notebook)", () => {
  assert.equal(withLocale("fr", () => notebookFolderName()), "Carnet");
  assert.equal(withLocale("en", () => notebookFolderName()), "Notebook");
});

test("isNotebookRubricName : reconnaît Carnet et Notebook, rien d'autre", () => {
  assert.equal(isNotebookRubricName("Carnet"), true);
  assert.equal(isNotebookRubricName("Notebook"), true);
  assert.equal(isNotebookRubricName("Recherche"), false);
  assert.equal(isNotebookRubricName("Personnages"), false);
});

// 1/2. « Transformer en fiche Recherche » → Recherche/Carnet/Ney.md, jamais Recherche/Ney.md à la racine
test("ensureNotebookResearchFolder : crée la rubrique Carnet sous la racine Recherche (locale fr)", async () => {
  const { app, settings, research } = makeProject("Recherche");
  const folder = await withLocale("fr", () => ensureNotebookResearchFolder(app, settings));
  assert.ok(folder instanceof TFolder);
  assert.equal(folder.path, `${research.path}/Carnet`);
});

// 3. variante _Recherche respectée
test("ensureNotebookResearchFolder : respecte la variante _Recherche", async () => {
  const { app, settings, research } = makeProject("_Recherche");
  const folder = await withLocale("fr", () => ensureNotebookResearchFolder(app, settings));
  assert.equal(folder.path, `${research.path}/Carnet`);
});

// 4. variante Research (anglais) respectée
test("ensureNotebookResearchFolder : respecte la variante Research", async () => {
  const { app, settings, research } = makeProject("Research");
  const folder = await withLocale("en", () => ensureNotebookResearchFolder(app, settings));
  assert.equal(folder.path, `${research.path}/Notebook`);
});

// 5. Carnet existant réutilisé
test("ensureNotebookResearchFolder : réutilise un Carnet déjà présent", async () => {
  const { app, settings, research } = makeProject("Recherche");
  const existing = await app.vault.createFolder(`${research.path}/Carnet`);
  const folder = await withLocale("fr", () => ensureNotebookResearchFolder(app, settings));
  assert.equal(folder.path, existing.path);
});

// 6. Notebook existant réutilisé même si la locale active est le français
test("ensureNotebookResearchFolder : réutilise Notebook existant même en locale fr (pas de doublon Carnet)", async () => {
  const { app, settings, research } = makeProject("Recherche");
  await app.vault.createFolder(`${research.path}/Notebook`);
  const folder = await withLocale("fr", () => ensureNotebookResearchFolder(app, settings));
  assert.equal(folder.path, `${research.path}/Notebook`);
  assert.equal(app.vault.getAbstractFileByPath(`${research.path}/Carnet`), null);
});

// 7. changement de locale ne crée pas Carnet + Notebook en doublon
test("ensureNotebookResearchFolder : deux appels sous deux locales différentes ne créent jamais les deux rubriques", async () => {
  const { app, settings, research } = makeProject("Recherche");
  const first = await withLocale("fr", () => ensureNotebookResearchFolder(app, settings));
  const second = await withLocale("en", () => ensureNotebookResearchFolder(app, settings));
  assert.equal(first.path, second.path);
  assert.equal(first.path, `${research.path}/Carnet`);
  const childNames = research.children.filter((c) => c instanceof TFolder).map((c) => c.name);
  assert.deepEqual(childNames, ["Carnet"]);
});

test("findNotebookResearchFolder : null si aucune rubrique Carnet/Notebook n'existe encore", () => {
  const { app, settings } = makeProject("Recherche");
  assert.equal(findNotebookResearchFolder(app, settings), null);
});

test("isUnderNotebookResearchFolder : reconnaît un fichier sous Carnet, rejette le reste de Recherche", async () => {
  const { app, settings, research } = makeProject("Recherche");
  await app.vault.createFolder(`${research.path}/Carnet`);
  const personnages = await app.vault.createFolder(`${research.path}/Personnages`);
  assert.equal(isUnderNotebookResearchFolder(app, settings, `${research.path}/Carnet/Ney.md`), true);
  assert.equal(isUnderNotebookResearchFolder(app, settings, `${personnages.path}/Ali.md`), false);
  assert.equal(isUnderNotebookResearchFolder(app, settings, `${research.path}/Ney.md`), false);
});

// Section 23 : la rubrique Carnet est un simple sous-dossier personnalisé —
// le panneau Recherche (base-feuillets-view.ts, renderResearchBody) liste
// déjà automatiquement tout sous-dossier de la racine Recherche qui n'est
// pas une des rubriques standard (Personnages/Lieux/…) et ne commence pas
// par "_"/"." — recréer ResearchView dans un mock géant serait
// disproportionné pour vérifier un comportement déjà générique et déjà
// testé ailleurs (aucun code UI dédié n'est ajouté pour "Carnet"). On
// vérifie donc seulement, comme le prévoit la section 23, les DEUX
// conditions dont dépend ce rendu générique :
test("section 23 — la rubrique Carnet est reconnaissable comme rubrique personnalisée normale", async () => {
  const { app, settings, research } = makeProject("Recherche");
  const carnet = await withLocale("fr", () => ensureNotebookResearchFolder(app, settings));
  const ney = await app.vault.create(`${carnet.path}/Ney.md`, "# Ney\n");

  // 1. Carnet n'est ni un nom réservé (Personnages/Lieux/…) ni préfixé
  //    "_"/"." → renderResearchBody le classe automatiquement dans
  //    `customFolders` et l'affiche comme rubrique à part entière.
  assert.equal(carnet.name.startsWith("_"), false);
  assert.equal(carnet.name.startsWith("."), false);
  assert.equal(["Personnages", "Lieux", "Codex", "Glossaire", "Sources", "Bibliographie"].includes(carnet.name), false);

  // 2. Ney.md est un fichier Markdown normal à l'intérieur, retrouvé comme
  //    n'importe quel autre fichier de la rubrique.
  assert.ok(ney instanceof TFile);
  assert.equal(ney.parent.path, carnet.path);
  void research;
});
