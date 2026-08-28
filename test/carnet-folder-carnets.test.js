import test from "node:test";
import assert from "node:assert/strict";
import { TFolder, TFile, Notice } from "obsidian";
import {
  folderCarnetCanvasPath,
  folderPathToRelativeScope,
  relativeScopeToFolderPath,
  resolveCanonicalFolderCarnetOwner,
  resolveFolderCarnetContext,
  resolveExistingFolderCarnetRegistration,
  canonicalizeFolderCarnetRegistration,
  getFolderCarnetDisplayLabel,
  listCanonicalFolderCarnetOwners,
  removeFolderCarnetRegistrationsForDeletedFile,
} from "../src/carnet/core/folder-carnets.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";

test("folder Carnet registry scopes are relative and paths derive only from UUID", () => {
  const project = new TFolder("Projet"); const manuscript = new TFolder("Projet/Manuscrit"); manuscript.parent = project; const id = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(folderPathToRelativeScope("Projet", "Projet/Recherche/Personnages"), "Recherche/Personnages");
  assert.equal(relativeScopeToFolderPath("Projet", "../outside"), null);
  assert.equal(folderCarnetCanvasPath(manuscript, id), "Projet/_Feuillets/Ressources/Ressources internes/Carnets/123e4567-e89b-12d3-a456-426614174000.canvas");
});

/* ============================================================
 * §20 — RÉSOLUTION CANONIQUE (Correctif « Carnet logique unique »)
 * ============================================================ */

function buildProject({ links = {} } = {}) {
  const root = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit"); manuscrit.parent = root;
  const chapitre1 = new TFolder("Projet/Manuscrit/CHAPITRE 1"); chapitre1.parent = manuscrit;
  const chapitre2 = new TFolder("Projet/Manuscrit/CHAPITRE 2"); chapitre2.parent = manuscrit;
  const recherche = new TFolder("Projet/Recherche"); recherche.parent = root;
  const rechercheChapitre1 = new TFolder("Projet/Recherche/CHAPITRE 1"); rechercheChapitre1.parent = recherche;
  const fileNode = new TFile("Projet/Manuscrit/CHAPITRE 1/Scene.md"); fileNode.parent = chapitre1;
  const partieA = new TFolder("Projet/Partie A"); partieA.parent = root;
  const partieAChapitre1 = new TFolder("Projet/Partie A/CHAPITRE 1"); partieAChapitre1.parent = partieA;
  const partieB = new TFolder("Projet/Partie B"); partieB.parent = root;
  const partieBChapitre1 = new TFolder("Projet/Partie B/CHAPITRE 1"); partieBChapitre1.parent = partieB;

  const { vault } = createFakeVault([root, manuscrit, chapitre1, chapitre2, fileNode, recherche, rechercheChapitre1, partieA, partieAChapitre1, partieB, partieBChapitre1]);
  const meta = { researchFolderLinks: links };
  return { vault, meta, root, manuscrit, chapitre1, chapitre2, fileNode, recherche, rechercheChapitre1, partieA, partieAChapitre1, partieB, partieBChapitre1 };
}

test("§20.1 — dossier Binder sans lien Recherche : owner = lui-même", () => {
  const { vault, meta, chapitre1 } = buildProject();
  const { owner, linkedResearchFolder } = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, chapitre1);
  assert.equal(owner.path, chapitre1.path);
  assert.equal(linkedResearchFolder, null);
});

test("§20.2 — dossier Recherche autonome (aucun lien) : owner = lui-même", () => {
  const { vault, meta, rechercheChapitre1 } = buildProject();
  const { owner } = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, rechercheChapitre1);
  assert.equal(owner.path, rechercheChapitre1.path);
});

test("§20.3 — Binder ↔ Research unique : owner = Binder depuis LES DEUX côtés", () => {
  const { vault, meta, chapitre1, rechercheChapitre1 } = buildProject({
    links: { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" },
  });
  const fromBinder = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, chapitre1);
  const fromResearch = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, rechercheChapitre1);
  assert.equal(fromBinder.owner.path, chapitre1.path);
  assert.equal(fromBinder.linkedResearchFolder.path, rechercheChapitre1.path);
  assert.equal(fromResearch.owner.path, chapitre1.path, "la Recherche liée résout le MÊME propriétaire Binder");
  assert.equal(fromResearch.linkedResearchFolder.path, rechercheChapitre1.path);
});

test("§20.4 — mêmes basenames SANS researchFolderLinks : deux Carnets indépendants", () => {
  const { vault, meta, partieAChapitre1, partieBChapitre1 } = buildProject();
  const a = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, partieAChapitre1);
  const b = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, partieBChapitre1);
  assert.equal(a.owner.path, partieAChapitre1.path);
  assert.equal(b.owner.path, partieBChapitre1.path);
  assert.notEqual(a.owner.path, b.owner.path, "le nom identique seul ne crée jamais un alias (§3)");
});

test("§20.5 — noms différents MAIS researchFolderLinks présent : un seul Carnet", () => {
  const { vault, meta, chapitre1, rechercheChapitre1 } = buildProject({
    links: { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" },
  });
  // Renommer virtuellement la cible pour prouver que seule la présence du
  // lien compte, jamais une coïncidence de nom (§3).
  rechercheChapitre1.name = "Autre nom";
  const { owner } = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, rechercheChapitre1);
  assert.equal(owner.path, chapitre1.path);
});

test("§20.6 — Research lié à un TFile Binder : pas d'alias (le Prompt 1 n'a pas de Carnet de fichier)", () => {
  const { vault, meta, rechercheChapitre1 } = buildProject({
    links: { "Projet/Manuscrit/CHAPITRE 1/Scene.md": "Projet/Recherche/CHAPITRE 1" },
  });
  const { owner, linkedResearchFolder } = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, rechercheChapitre1);
  assert.equal(owner.path, rechercheChapitre1.path);
  assert.equal(linkedResearchFolder, null);
});

test("§20.7 — même Research lié à DEUX nœuds Binder : aucune attribution arbitraire", () => {
  const { vault, meta, rechercheChapitre1, chapitre1 } = buildProject({
    links: {
      "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1",
      "Projet/Manuscrit/CHAPITRE 2": "Projet/Recherche/CHAPITRE 1",
    },
  });
  const { owner, linkedResearchFolder } = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, rechercheChapitre1);
  assert.equal(owner.path, rechercheChapitre1.path, "jamais chapitre1 NI chapitre2 choisi arbitrairement");
  assert.equal(linkedResearchFolder, null);
  // Réciproquement, chapitre1 seul ne doit pas non plus hériter d'un lien
  // ambigu : sa Recherche cible est partagée, donc pas de paire canonique.
  const fromChapitre1 = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, chapitre1);
  assert.equal(fromChapitre1.owner.path, chapitre1.path);
  assert.equal(fromChapitre1.linkedResearchFolder, null);
});

test("§20.8 — lien orphelin (nœud Binder disparu) : pas d'alias", () => {
  const { vault, meta, rechercheChapitre1 } = buildProject({
    links: { "Projet/Manuscrit/Disparu": "Projet/Recherche/CHAPITRE 1" },
  });
  const { owner } = resolveCanonicalFolderCarnetOwner(vault, "Projet", meta, rechercheChapitre1);
  assert.equal(owner.path, rechercheChapitre1.path);
});

test("§20.9 — propriétaire hors projectRoot : rejet défensif (contexte null)", () => {
  const outside = new TFolder("Ailleurs/Dossier");
  const { vault, meta } = buildProject();
  const context = resolveFolderCarnetContext(vault, "Projet", meta, outside);
  assert.equal(context, null);
});

/* ============================================================
 * §21 — UUID / REGISTRE
 * ============================================================ */

function buildPlugin({ links = {}, folderCarnets } = {}) {
  const project = buildProject({ links });
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { vault: project.vault, workspace: { getLeavesOfType: () => [], getLeaf: () => ({ openFile: async () => {} }), revealLeaf: async () => {}, setActiveLeaf: () => {} } };
  const savedSettings = [];
  plugin.settings = {
    projectFolder: project.manuscrit.path,
    projectMeta: { [project.manuscrit.path]: { researchFolderLinks: links, ...(folderCarnets ? { folderCarnets } : {}) } },
  };
  plugin.saveSettings = async () => { savedSettings.push(JSON.parse(JSON.stringify(plugin.settings.projectMeta))); };
  return { plugin, project, savedSettings };
}

test("§21.1-4 — création depuis Binder puis ouverture depuis Research liée résolvent le MÊME fichier, un seul UUID généré", async () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const { plugin, project } = buildPlugin({ links });

  await plugin.openFolderCarnet(project.chapitre1);
  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  const keys = Object.keys(meta.folderCarnets || {});
  assert.deepEqual(keys, ["Manuscrit/CHAPITRE 1"], "la registration est créée sous la clé CANONIQUE Binder");

  assert.equal(plugin.hasFolderCarnet(project.chapitre1), true);
  assert.equal(plugin.hasFolderCarnet(project.rechercheChapitre1), true, "la Recherche liée voit aussi le Carnet");

  const fileFromBinder = project.vault.getAbstractFileByPath(folderCarnetCanvasPath(project.manuscrit, meta.folderCarnets["Manuscrit/CHAPITRE 1"].id));
  await plugin.openFolderCarnet(project.rechercheChapitre1);
  const keysAfter = Object.keys(plugin.settings.projectMeta[project.manuscrit.path].folderCarnets);
  assert.deepEqual(keysAfter, ["Manuscrit/CHAPITRE 1"], "aucun second UUID/clé créé en ouvrant depuis Research");
  assert.ok(fileFromBinder);
});

test("§21.2-3 — création depuis Research liée EN PREMIER : la registration est posée sous la clé canonique Binder", async () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const { plugin, project } = buildPlugin({ links });

  await plugin.openFolderCarnet(project.rechercheChapitre1);
  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  const keys = Object.keys(meta.folderCarnets || {});
  assert.deepEqual(keys, ["Manuscrit/CHAPITRE 1"], "jamais une clé 'Recherche/CHAPITRE 1' créée pour une paire canonique");
  assert.equal(plugin.hasFolderCarnet(project.chapitre1), true);
});

test("§21.5 (CAS A) — ancien registre Research SEUL : rekey vers Binder au premier openFolderCarnet, même UUID, aucun nouveau Canvas", async () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const oldId = "123e4567-e89b-12d3-a456-426614174000";
  const { plugin, project } = buildPlugin({ links, folderCarnets: { "Recherche/CHAPITRE 1": { id: oldId, version: 1 } } });
  // Le fichier Canvas existant AVANT le correctif doit être présent sur le disque.
  const path = folderCarnetCanvasPath(project.manuscrit, oldId);
  await project.vault.create(path, "{\n\t\"nodes\": [],\n\t\"edges\": []\n}");

  await plugin.openFolderCarnet(project.chapitre1);

  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  assert.deepEqual(Object.keys(meta.folderCarnets), ["Manuscrit/CHAPITRE 1"], "la clé Recherche alias a disparu, seule la clé Binder subsiste");
  assert.equal(meta.folderCarnets["Manuscrit/CHAPITRE 1"].id, oldId, "EXACTEMENT le même UUID, aucun nouveau Canvas");
});

test("§21.6 (CAS B) — clés Binder + Research avec le MÊME UUID : canonicalisation sans perte", () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const sameId = "123e4567-e89b-12d3-a456-426614174000";
  const meta = { researchFolderLinks: links, folderCarnets: {
    "Manuscrit/CHAPITRE 1": { id: sameId, version: 1 },
    "Recherche/CHAPITRE 1": { id: sameId, version: 1 },
  } };
  const result = canonicalizeFolderCarnetRegistration(meta, "Manuscrit/CHAPITRE 1", "Recherche/CHAPITRE 1");
  assert.equal(result.changed, true);
  assert.equal(result.conflict, false);
  assert.deepEqual(Object.keys(meta.folderCarnets), ["Manuscrit/CHAPITRE 1"]);
  assert.equal(meta.folderCarnets["Manuscrit/CHAPITRE 1"].id, sameId);
});

test("§21.7-8 (CAS C) — deux UUID DIFFÉRENTS : UUID Binder conservé, UUID Research jamais supprimé/fusionné, Notice émise une fois", async () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const idA = "123e4567-e89b-12d3-a456-426614174000";
  const idB = "223e4567-e89b-12d3-a456-426614174001";
  const { plugin, project } = buildPlugin({ links, folderCarnets: {
    "Manuscrit/CHAPITRE 1": { id: idA, version: 1 },
    "Recherche/CHAPITRE 1": { id: idB, version: 1 },
  } });
  const pathA = folderCarnetCanvasPath(project.manuscrit, idA);
  const pathB = folderCarnetCanvasPath(project.manuscrit, idB);
  await project.vault.create(pathA, "{\n\t\"nodes\": [],\n\t\"edges\": []\n}");
  await project.vault.create(pathB, "{\n\t\"nodes\": [],\n\t\"edges\": []\n}");

  const notices = [];
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    await plugin.openFolderCarnet(project.chapitre1);
    await plugin.openFolderCarnet(project.rechercheChapitre1);
  } finally {
    Notice.onCreate = previousOnCreate;
  }

  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  assert.equal(meta.folderCarnets["Manuscrit/CHAPITRE 1"].id, idA, "UUID Binder reste canonique");
  assert.equal(meta.folderCarnets["Recherche/CHAPITRE 1"].id, idB, "UUID Research JAMAIS supprimé");
  assert.ok(project.vault.getAbstractFileByPath(pathB), "le fichier Canvas Research n'est jamais supprimé");
  assert.equal(notices.length, 1, "la Notice de conflit est émise UNE seule fois, pas à chaque ouverture");
  assert.equal(plugin.hasFolderCarnet(project.chapitre1), true);
  assert.equal(plugin.hasFolderCarnet(project.rechercheChapitre1), true);
});

/* ============================================================
 * §24 — LIEN / DÉTACHEMENT
 * ============================================================ */

test("§24 — détacher le lien conserve le Carnet Binder ; Research redevient autonome ; relink retrouve le MÊME Carnet", async () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const { plugin, project } = buildPlugin({ links });
  await plugin.openFolderCarnet(project.chapitre1);
  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  const uuid = meta.folderCarnets["Manuscrit/CHAPITRE 1"].id;

  // Détachement (simulé : retirer l'entrée researchFolderLinks, comme le
  // fait removeLinkedResearchFolder — aucune donnée Carnet supprimée).
  delete meta.researchFolderLinks["Projet/Manuscrit/CHAPITRE 1"];

  assert.equal(plugin.hasFolderCarnet(project.chapitre1), true, "UUID-A toujours accessible depuis Binder");
  const detachedResearchOwner = resolveCanonicalFolderCarnetOwner(project.vault, "Projet", meta, project.rechercheChapitre1);
  assert.equal(detachedResearchOwner.owner.path, project.rechercheChapitre1.path, "Research redevient autonome");

  // Relink : la paire canonique doit retrouver EXACTEMENT le même UUID.
  meta.researchFolderLinks["Projet/Manuscrit/CHAPITRE 1"] = "Projet/Recherche/CHAPITRE 1";
  assert.equal(plugin.hasFolderCarnet(project.rechercheChapitre1), true);
  await plugin.openFolderCarnet(project.rechercheChapitre1);
  assert.equal(meta.folderCarnets["Manuscrit/CHAPITRE 1"].id, uuid, "relink : Research retrouve UUID-A, jamais un nouveau Carnet");
  assert.deepEqual(Object.keys(meta.folderCarnets), ["Manuscrit/CHAPITRE 1"]);
});

/* ============================================================
 * Titres — helpers purs (voir aussi carnet-lifecycle.test.js pour le DOM)
 * ============================================================ */

test("getFolderCarnetDisplayLabel : basename seul si unique, sinon suffixe minimal distinctif", () => {
  const { partieAChapitre1, partieBChapitre1 } = buildProject();
  assert.equal(getFolderCarnetDisplayLabel(partieAChapitre1, [partieAChapitre1]), "CHAPITRE 1");
  const label = getFolderCarnetDisplayLabel(partieAChapitre1, [partieAChapitre1, partieBChapitre1]);
  assert.equal(label, "Partie A/CHAPITRE 1");
  const labelB = getFolderCarnetDisplayLabel(partieBChapitre1, [partieAChapitre1, partieBChapitre1]);
  assert.equal(labelB, "Partie B/CHAPITRE 1");
});

test("listCanonicalFolderCarnetOwners : une paire liée n'apparaît qu'une fois (côté Binder)", () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const { vault, meta, chapitre1 } = buildProject({ links });
  meta.folderCarnets = { "Manuscrit/CHAPITRE 1": { id: "123e4567-e89b-12d3-a456-426614174000", version: 1 } };
  const owners = listCanonicalFolderCarnetOwners(vault, "Projet", meta);
  assert.deepEqual(owners.map((o) => o.path), [chapitre1.path]);
});

test("resolveExistingFolderCarnetRegistration : repli sur la clé alias tant qu'elle n'a pas été rapatriée", () => {
  const meta = { folderCarnets: { "Recherche/CHAPITRE 1": { id: "123e4567-e89b-12d3-a456-426614174000", version: 1 } } };
  const reg = resolveExistingFolderCarnetRegistration(meta, "Manuscrit/CHAPITRE 1", "Recherche/CHAPITRE 1");
  assert.equal(reg.id, "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(resolveExistingFolderCarnetRegistration(meta, "Manuscrit/CHAPITRE 1", null), null);
});

/* ================================================================
 * Correctif « suppression/recréation d'un Carnet de dossier »
 * ================================================================ */

test("suppression du fichier Canvas → la registration correspondante est retirée", () => {
  const { meta, manuscrit } = buildProject();
  const id = "123e4567-e89b-12d3-a456-426614174000";
  meta.folderCarnets = { "Manuscrit/CHAPITRE 1": { id, version: 1 } };
  const path = folderCarnetCanvasPath(manuscrit, id);

  const removed = removeFolderCarnetRegistrationsForDeletedFile(meta, manuscrit, path);

  assert.deepEqual(removed, ["Manuscrit/CHAPITRE 1"]);
  assert.deepEqual(meta.folderCarnets, {});
});

test("suppression du fichier Canvas → hasFolderCarnet() redevient false", async () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const { plugin, project } = buildPlugin({ links });
  await plugin.openFolderCarnet(project.chapitre1);
  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  const uuid = meta.folderCarnets["Manuscrit/CHAPITRE 1"].id;
  const path = folderCarnetCanvasPath(project.manuscrit, uuid);

  assert.equal(plugin.hasFolderCarnet(project.chapitre1), true);

  // Suppression du fichier .canvas (jamais du dossier) : le vault ne le
  // connaît plus, mais la registration existe TOUJOURS tant que rien ne l'a
  // nettoyée — hasFolderCarnet() doit s'en apercevoir tout seul (§2).
  await project.vault.delete(project.vault.getAbstractFileByPath(path));

  assert.equal(plugin.hasFolderCarnet(project.chapitre1), false, "un Canvas absent ne doit plus bloquer « Créer le Carnet »");
  assert.equal(plugin.hasFolderCarnet(project.rechercheChapitre1), false, "la Recherche liée doit aussi voir l'absence");
});

test("recréation après suppression → nouvel UUID différent, nouveau Canvas vide, ancien jamais réutilisé", async () => {
  const { plugin, project } = buildPlugin({});
  await plugin.openFolderCarnet(project.chapitre1);
  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  const oldId = meta.folderCarnets["Manuscrit/CHAPITRE 1"].id;
  const oldPath = folderCarnetCanvasPath(project.manuscrit, oldId);
  await project.vault.delete(project.vault.getAbstractFileByPath(oldPath));

  await plugin.openFolderCarnet(project.chapitre1);

  const newId = meta.folderCarnets["Manuscrit/CHAPITRE 1"].id;
  assert.notEqual(newId, oldId, "un NOUVEL UUID est généré, jamais l'ancien absent réutilisé");
  const newPath = folderCarnetCanvasPath(project.manuscrit, newId);
  const newFile = project.vault.getAbstractFileByPath(newPath);
  assert.ok(newFile, "un nouveau fichier Canvas a bien été créé");
  assert.equal(newFile.content, "{\n\t\"nodes\": [],\n\t\"edges\": []\n}", "le nouveau Canvas est vide");
  assert.equal(plugin.hasFolderCarnet(project.chapitre1), true);
});

test("suppression du DOSSIER propriétaire → Canvas et registration conservés (contrat orphelin intact)", async () => {
  const { plugin, project } = buildPlugin({});
  await plugin.openFolderCarnet(project.chapitre1);
  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  const id = meta.folderCarnets["Manuscrit/CHAPITRE 1"].id;
  const canvasPath = folderCarnetCanvasPath(project.manuscrit, id);

  // Suppression du DOSSIER (pas du fichier .canvas) : removeFolderCarnet-
  // RegistrationsForDeletedFile ne doit jamais matcher un chemin de dossier
  // — seul un chemin de fichier .canvas calculé depuis un UUID peut
  // correspondre à une registration.
  const removed = removeFolderCarnetRegistrationsForDeletedFile(meta, project.manuscrit, project.chapitre1.path);

  assert.deepEqual(removed, [], "la suppression d'un dossier ne retire jamais une registration");
  assert.ok(meta.folderCarnets["Manuscrit/CHAPITRE 1"], "la registration reste en place");
  assert.ok(project.vault.getAbstractFileByPath(canvasPath), "le Canvas reste en place");
});

test("Binder ↔ Recherche liée : suppression du Canvas commun puis UNE SEULE recréation, ouverte des deux côtés", async () => {
  const links = { "Projet/Manuscrit/CHAPITRE 1": "Projet/Recherche/CHAPITRE 1" };
  const { plugin, project } = buildPlugin({ links });
  await plugin.openFolderCarnet(project.chapitre1);
  const meta = plugin.settings.projectMeta[project.manuscrit.path];
  const oldId = meta.folderCarnets["Manuscrit/CHAPITRE 1"].id;
  await project.vault.delete(project.vault.getAbstractFileByPath(folderCarnetCanvasPath(project.manuscrit, oldId)));

  assert.equal(plugin.hasFolderCarnet(project.chapitre1), false);
  assert.equal(plugin.hasFolderCarnet(project.rechercheChapitre1), false);

  await plugin.openFolderCarnet(project.rechercheChapitre1);
  const newId = meta.folderCarnets["Manuscrit/CHAPITRE 1"].id;
  assert.notEqual(newId, oldId);
  assert.deepEqual(Object.keys(meta.folderCarnets), ["Manuscrit/CHAPITRE 1"], "toujours une seule clé, jamais une clé Recherche séparée");

  await plugin.openFolderCarnet(project.chapitre1);
  assert.equal(meta.folderCarnets["Manuscrit/CHAPITRE 1"].id, newId, "le Binder ouvre le MÊME nouveau Carnet, aucun troisième UUID");
});

test("suppression d'un Canvas non-Feuillets → aucune modification du registre", () => {
  const { meta, manuscrit } = buildProject();
  const id = "123e4567-e89b-12d3-a456-426614174000";
  meta.folderCarnets = { "Manuscrit/CHAPITRE 1": { id, version: 1 } };
  const before = JSON.parse(JSON.stringify(meta.folderCarnets));

  const removed = removeFolderCarnetRegistrationsForDeletedFile(meta, manuscrit, "Projet/Autre/Fichier.canvas");

  assert.deepEqual(removed, []);
  assert.deepEqual(meta.folderCarnets, before);
});

test("legacy — deux clés partageant le MÊME UUID supprimé : les deux registrations correspondantes sont nettoyées", () => {
  const { meta, manuscrit } = buildProject();
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const otherId = "223e4567-e89b-12d3-a456-426614174001";
  meta.folderCarnets = {
    "Manuscrit/CHAPITRE 1": { id, version: 1 },
    "Recherche/CHAPITRE 1": { id, version: 1 },
    "Manuscrit/CHAPITRE 2": { id: otherId, version: 1 },
  };
  const path = folderCarnetCanvasPath(manuscrit, id);

  const removed = removeFolderCarnetRegistrationsForDeletedFile(meta, manuscrit, path);

  assert.deepEqual(removed.sort(), ["Manuscrit/CHAPITRE 1", "Recherche/CHAPITRE 1"].sort());
  assert.deepEqual(Object.keys(meta.folderCarnets), ["Manuscrit/CHAPITRE 2"], "seule la registration d'UUID différent (Canvas non supprimé) reste");
});

test("deux registrations avec des UUID DIFFÉRENTS : seule celle dont le Canvas a réellement été supprimé est retirée", () => {
  const { meta, manuscrit } = buildProject();
  const idA = "123e4567-e89b-12d3-a456-426614174000";
  const idB = "223e4567-e89b-12d3-a456-426614174001";
  meta.folderCarnets = {
    "Manuscrit/CHAPITRE 1": { id: idA, version: 1 },
    "Manuscrit/CHAPITRE 2": { id: idB, version: 1 },
  };
  const pathA = folderCarnetCanvasPath(manuscrit, idA);

  const removed = removeFolderCarnetRegistrationsForDeletedFile(meta, manuscrit, pathA);

  assert.deepEqual(removed, ["Manuscrit/CHAPITRE 1"]);
  assert.ok(meta.folderCarnets["Manuscrit/CHAPITRE 2"], "l'autre UUID, non supprimé, reste intact");
});
