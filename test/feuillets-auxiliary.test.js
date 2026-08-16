import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { feuilletsAuxiliaryPath, getEditionRoot, getOrderedChildren, getResourcesRoot } from "../src/services/folder-structure.js";
import { getResearchRoot } from "../src/services/research.js";
import { getJournalRoot } from "../src/services/journal.js";
import { getBackupsRoot } from "../src/services/project-backup.js";
import { getOutputFolder } from "../src/services/compile-export.js";
import { listSnapshotFiles } from "../src/services/project-files.js";

function fixture(rootPath = "Projet/Manuscrit") {
  const volumePath = rootPath.endsWith("/Manuscrit") ? rootPath.slice(0, -"/Manuscrit".length) : rootPath;
  const volume = rootPath === volumePath ? null : new TFolder(volumePath);
  const root = new TFolder(rootPath);
  const chapter = new TFolder(`${rootPath}/Chapitre`);
  const file = new TFile(`${rootPath}/Chapitre/Scène.md`, "Texte");
  root.children = [chapter]; chapter.parent = root; chapter.children = [file]; file.parent = chapter;
  if (volume) { volume.children = [root]; root.parent = volume; }
  return { volume, root, chapter, file };
}

test("_Feuillets : les résolveurs canoniques couvrent projet structuré et libre", async () => {
  const structured = fixture();
  const free = fixture("ProjetLibre");
  const paths = ["research", "resources", "edition", "journal", "snapshots", "backups", "output"];
  const folders = [structured.volume, structured.root, structured.chapter, structured.file, free.root, free.chapter, free.file].filter(Boolean);
  for (const kind of paths) folders.push(new TFolder(feuilletsAuxiliaryPath(structured.root, kind)));
  for (const kind of paths) folders.push(new TFolder(feuilletsAuxiliaryPath(free.root, kind)));
  const { vault } = createFakeVault(folders);
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: structured.root.path, orders: {}, journalFolder: "Journal", compileFileName: "Manuscrit.md" };

  assert.equal(feuilletsAuxiliaryPath(structured.root, "research"), "Projet/_Feuillets/Recherche");
  assert.equal(feuilletsAuxiliaryPath(free.root, "research"), "ProjetLibre/_Feuillets/Recherche");
  assert.equal(getResearchRoot(app, settings)?.path, "Projet/_Feuillets/Recherche");
  assert.equal(getResourcesRoot(app, structured.root)?.path, "Projet/_Feuillets/Ressources");
  assert.equal(getEditionRoot(app, structured.root)?.path, "Projet/_Feuillets/Edition");
  assert.equal(getJournalRoot(app, settings)?.path, "Projet/_Feuillets/Journal");
  assert.equal(getBackupsRoot(app, structured.root)?.path, "Projet/_Feuillets/Backups");
  assert.equal((await getOutputFolder(app, settings))?.path, "Projet/_Feuillets/Sortie");
  assert.deepEqual(getOrderedChildren(app, settings, structured.root).map((child) => child.path), [structured.chapter.path]);
  assert.deepEqual(listSnapshotFiles(app, structured.file, structured.root), []);
});

test("_Feuillets : un emplacement legacy existant reste prioritaire", () => {
  const { volume, root } = fixture();
  const legacy = new TFolder("Projet/_Recherche");
  const canonical = new TFolder("Projet/_Feuillets/Recherche");
  const { vault } = createFakeVault([volume, root, legacy]);
  const app = { vault };
  const settings = { projectFolder: root.path };
  assert.equal(getResearchRoot(app, settings), legacy);
  assert.equal(vault.getAbstractFileByPath(canonical.path), null);
});

/* §19/§40 du chantier « espace central » : plus que CINQ catégories dans les
 * Paramètres — « Composition & export » a quitté l'interface pour l'espace
 * central Édition. Aucune clé persistée n'est supprimée pour autant (voir le
 * test « aucune clé de réglage n'est retirée » ci-dessous). */
test("réglages V2 : cinq catégories, déplacements et traductions FR/EN", () => {
  const source = readFileSync("src/settings/feuillets-setting-tab.ts", "utf8");
  const fr = readFileSync("src/i18n/fr.ts", "utf8");
  const en = readFileSync("src/i18n/en.ts", "utf8");
  assert.match(source, /const ORDER = \["Projet", "Écriture", "Interface", "Vues", "Sauvegarde & historique"\]/);
  assert.doesNotMatch(source, /"Composition & export"/);
  assert.doesNotMatch(source, /renderExportCategory\(/);
  assert.doesNotMatch(source, /"Correction": \(c\)/);
  assert.match(source, /d\.addOption\("free", t\("settings\.projectType\.free"\)\)/);
  assert.match(source, /private renderBackupCategory/);
  assert.match(source, /private renderPanneauxCategory[\s\S]*settings\.autoAnalyzeInRelecture/);
  assert.doesNotMatch(source.slice(source.indexOf("private renderProjetCategory"), source.indexOf("private renderEcritureCategory")), /settings\.(activeProject|projectPath|chronoFolder|journalFolder|demoProject)/);
  for (const text of [fr, en]) {
    assert.match(text, /settings\.category\.views/);
    assert.match(text, /settings\.category\.backupHistory/);
    assert.match(text, /settings\.projectType\.free/);
  }
});

/* §19 : le chantier déplace l'INTERFACE, jamais le stockage — un data.json
 * legacy doit rester intégralement valide. */
test("réglages : aucune clé de réglage n'est retirée par le déplacement de l'onglet Composition & export", () => {
  const defaults = readFileSync("src/default-settings.ts", "utf8");
  for (const key of [
    "pdfPageSize", "pdfOrientation", "pdfMarginTop", "pdfMarginBottom", "pdfMarginLeft", "pdfMarginRight",
    "pdfMirrorMargins", "pdfDiffHeaders", "pdfEnableHeaders", "pdfEnableFooters",
    "pdfHeaderLeft", "pdfHeaderCenter", "pdfHeaderRight", "pdfFooterLeft", "pdfFooterCenter", "pdfFooterRight",
    "pdfHeaderDistanceCm", "pdfFooterDistanceCm", "pdfHeaderBodyGapPt", "pdfFooterBodyGapPt",
    "pdfPageNumberPosition", "pdfHideFirstPageHeader",
    "level1Role", "chapterNumbering", "sceneNumbering", "autoRename", "renamePrefix",
    "insertFolderTitles", "insertTitles", "insertSceneTitles", "footnoteRenumberOnCompile",
    "manuscriptTitle", "manuscriptAuthor", "separator", "compilePresets", "exportFrenchTypography",
    "epubLanguage", "exportTemplate", "exportFormat",
  ]) {
    assert.ok(new RegExp(`\\b${key}:`).test(defaults), `${key} reste déclarée dans DEFAULT_SETTINGS`);
  }
});
