import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createMinimalProject } from "../src/services/project-files.js";
import {
  detectProjectStructureLocale,
  resourcesFolderPath,
  internalResourcesFolderPath,
  getResourcesRoot,
} from "../src/services/folder-structure.js";
import {
  researchFolderPath,
  chronologyFolderPath,
  ensureNotebookResearchFolder,
  getResearchRootForProject,
} from "../src/services/research.js";
import { getOutputFolder } from "../src/services/compile-export.js";
import { createQuickDraftFile } from "../src/services/project-drafts.js";
import { customTemplatesFolderPath } from "../src/services/export-templates-custom.js";
import {
  folderCarnetCanvasPath,
  findExistingFolderCarnetCanvas,
} from "../src/carnet/core/folder-carnets.js";
import { setLocale, getLocale } from "../src/i18n/index.js";
import { projectCreationNames } from "../src/i18n/project-creation.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

const TEST_CARNET_UUID = "a0000000-0000-4000-8000-000000000001";

function freshSettings(overrides = {}) {
  return { ...DEFAULT_SETTINGS, orders: {}, folderPositions: {}, projectMeta: {}, ...overrides };
}

function restoreLocaleAfter(t, locale) {
  const previous = getLocale();
  t.after(() => setLocale(previous));
  setLocale(locale);
}

/* ==================== English Project Created Under English Locale ==================== */

test("English project: paths created after setup retain English structure even if interface switches to French", async (t) => {
  restoreLocaleAfter(t, "en");
  const namesEn = projectCreationNames("en");
  const namesFr = projectCreationNames("fr");
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  const { manuscritPath } = await createMinimalProject(app, settings, { name: "Novel", type: "fiction" });
  settings.projectFolder = manuscritPath;
  const manuscript = vault.getAbstractFileByPath(manuscritPath);
  assert.ok(manuscript instanceof TFolder);

  // Switch interface language to French
  setLocale("fr");
  assert.equal(getLocale(), "fr");

  // Structural language detection must still return "en"
  const detected = detectProjectStructureLocale(app, manuscript, "fr");
  assert.equal(detected, "en");

  // Resources folder resolution must yield English catalogue name
  const resPath = resourcesFolderPath(app, manuscript, "fr");
  assert.equal(resPath, `Novel/_Feuillets/${namesEn.auxiliary.resources}`);

  // Internal resources subfolder must yield English catalogue name
  const internalResPath = internalResourcesFolderPath(app, manuscript, "fr");
  assert.equal(internalResPath, `Novel/_Feuillets/${namesEn.auxiliary.resources}/${namesEn.resourceSubfolders.assets}`);

  // Custom layouts folder must yield English layouts subfolder
  const layoutsPath = customTemplatesFolderPath(app, settings, "fr");
  assert.equal(layoutsPath, `Novel/_Feuillets/${namesEn.auxiliary.resources}/${namesEn.resourceSubfolders.layouts}`);

  // Output folder must be created in English
  const outputFolder = await getOutputFolder(app, settings, "fr");
  assert.ok(outputFolder instanceof TFolder);
  assert.equal(outputFolder.path, `Novel/_Feuillets/${namesEn.auxiliary.output}`);
  // French "Sortie" must NOT have been created
  assert.equal(vault.getAbstractFileByPath(`Novel/_Feuillets/${namesFr.auxiliary.output}`), null);

  // Quick draft file must use English default name ("Untitled") under _Feuillets/Drafts without manual pre-creation
  const draftFile = await createQuickDraftFile(app, manuscript, undefined, "fr");
  assert.ok(draftFile instanceof TFile);
  assert.equal(draftFile.path, `Novel/_Feuillets/Drafts/${namesEn.draftStem}.md`);

  // Notebook research folder must be created under Research/Notebook
  const notebookFolder = await ensureNotebookResearchFolder(app, settings, "fr");
  assert.ok(notebookFolder instanceof TFolder);
  assert.equal(notebookFolder.path, `Novel/_Feuillets/${namesEn.auxiliary.research}/${namesEn.notebook}`);
  // French "Carnet" must NOT have been created
  assert.equal(vault.getAbstractFileByPath(`Novel/_Feuillets/${namesEn.auxiliary.research}/${namesFr.notebook}`), null);

  // Folder carnet canvas path must target English internal resources
  const canvasPath = folderCarnetCanvasPath(manuscript, TEST_CARNET_UUID);
  assert.equal(
    canvasPath,
    `Novel/_Feuillets/${namesEn.auxiliary.resources}/${namesEn.resourceSubfolders.assets}/Carnets/${TEST_CARNET_UUID}.canvas`
  );
});

/* ==================== French Project Created Under French Locale ==================== */

test("French project: paths created after setup retain French structure even if interface switches to English", async (t) => {
  restoreLocaleAfter(t, "fr");
  const namesEn = projectCreationNames("en");
  const namesFr = projectCreationNames("fr");
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  const { manuscritPath } = await createMinimalProject(app, settings, { name: "Roman", type: "fiction" });
  settings.projectFolder = manuscritPath;
  const manuscript = vault.getAbstractFileByPath(manuscritPath);
  assert.ok(manuscript instanceof TFolder);

  // Switch interface language to English
  setLocale("en");
  assert.equal(getLocale(), "en");

  // Structural language detection must still return "fr"
  const detected = detectProjectStructureLocale(app, manuscript, "en");
  assert.equal(detected, "fr");

  // Resources folder resolution must yield French catalogue name
  const resPath = resourcesFolderPath(app, manuscript, "en");
  assert.equal(resPath, `Roman/_Feuillets/${namesFr.auxiliary.resources}`);

  // Internal resources subfolder must yield French catalogue name
  const internalResPath = internalResourcesFolderPath(app, manuscript, "en");
  assert.equal(internalResPath, `Roman/_Feuillets/${namesFr.auxiliary.resources}/${namesFr.resourceSubfolders.assets}`);

  // Custom layouts folder must yield French layouts subfolder
  const layoutsPath = customTemplatesFolderPath(app, settings, "en");
  assert.equal(layoutsPath, `Roman/_Feuillets/${namesFr.auxiliary.resources}/${namesFr.resourceSubfolders.layouts}`);

  // Output folder must be created in French
  const outputFolder = await getOutputFolder(app, settings, "en");
  assert.ok(outputFolder instanceof TFolder);
  assert.equal(outputFolder.path, `Roman/_Feuillets/${namesFr.auxiliary.output}`);
  // English "Output" must NOT have been created
  assert.equal(vault.getAbstractFileByPath(`Roman/_Feuillets/${namesEn.auxiliary.output}`), null);

  // Quick draft file must use French default name ("Sans titre") under _Feuillets/Drafts without manual pre-creation
  const draftFile = await createQuickDraftFile(app, manuscript, undefined, "en");
  assert.ok(draftFile instanceof TFile);
  assert.equal(draftFile.path, `Roman/_Feuillets/Drafts/${namesFr.draftStem}.md`);

  // Notebook research folder must be created under Recherche/Carnet
  const notebookFolder = await ensureNotebookResearchFolder(app, settings, "en");
  assert.ok(notebookFolder instanceof TFolder);
  assert.equal(notebookFolder.path, `Roman/_Feuillets/${namesFr.auxiliary.research}/${namesFr.notebook}`);
  // English "Notebook" must NOT have been created
  assert.equal(vault.getAbstractFileByPath(`Roman/_Feuillets/${namesFr.auxiliary.research}/${namesEn.notebook}`), null);

  // Folder carnet canvas path must target French internal resources
  const canvasPath = folderCarnetCanvasPath(manuscript, TEST_CARNET_UUID);
  assert.equal(
    canvasPath,
    `Roman/_Feuillets/${namesFr.auxiliary.resources}/${namesFr.resourceSubfolders.assets}/Carnets/${TEST_CARNET_UUID}.canvas`
  );
});

/* ==================== Preservation of Existing and Configured Paths ==================== */

test("Existing target folders always win: no duplicate folder created even if language differs", async () => {
  const namesEn = projectCreationNames("en");
  const namesFr = projectCreationNames("fr");
  const project = new TFolder("Novel");
  const manuscript = new TFolder(`Novel/${namesEn.manuscript}`);
  const aux = new TFolder("Novel/_Feuillets");
  // Existing output folder in French under an English project
  const existingOutput = new TFolder(`Novel/_Feuillets/${namesFr.auxiliary.output}`);
  // Existing research folder in French under an English project
  const existingResearch = new TFolder(`Novel/_Feuillets/${namesFr.auxiliary.research}`);
  project.children = [manuscript, aux];
  aux.children = [existingOutput, existingResearch];
  manuscript.parent = project;
  aux.parent = project;
  existingOutput.parent = aux;
  existingResearch.parent = aux;

  const { vault } = createFakeVault([project, manuscript, aux, existingOutput, existingResearch]);
  const app = { vault };
  const settings = freshSettings({ projectFolder: manuscript.path });

  // Output folder should reuse existing Sortie folder without creating Output
  const out = await getOutputFolder(app, settings, "en");
  assert.equal(out.path, existingOutput.path);
  assert.equal(vault.getAbstractFileByPath(`Novel/_Feuillets/${namesEn.auxiliary.output}`), null);

  // Research folder should reuse existing Recherche folder
  const researchPath = researchFolderPath(app, settings, manuscript, "en");
  assert.equal(researchPath, existingResearch.path);
});

test("Custom settings.chronoFolder is strictly preserved without being overwritten by catalogue", () => {
  const project = new TFolder("Novel");
  const manuscript = new TFolder("Novel/Manuscript");
  project.children = [manuscript];
  manuscript.parent = project;

  const { vault } = createFakeVault([project, manuscript]);
  const app = { vault };
  const settings = freshSettings({
    projectFolder: manuscript.path,
    chronoFolder: "Custom/Nested/Milestones",
  });

  const resolved = chronologyFolderPath(app, settings, manuscript, "en");
  assert.equal(resolved, "Custom/Nested/Milestones");
});

/* ==================== Mixed Project Precedence ==================== */

test("Mixed project precedence: manuscript-root language takes precedence for new structural folders", () => {
  const namesEn = projectCreationNames("en");
  const namesFr = projectCreationNames("fr");

  // Project with English manuscript root but a sibling French folder
  const project = new TFolder("Mixed");
  const manuscript = new TFolder(`Mixed/${namesEn.manuscript}`);
  const siblingRecherche = new TFolder(`Mixed/${namesFr.research}`);
  project.children = [manuscript, siblingRecherche];
  manuscript.parent = project;
  siblingRecherche.parent = project;

  const { vault } = createFakeVault([project, manuscript, siblingRecherche]);
  const app = { vault };

  // Manuscript root name "Manuscript" must determine structural locale as "en"
  const locale = detectProjectStructureLocale(app, manuscript, "fr");
  assert.equal(locale, "en");
});

test("Dual-target folder existence: deterministic selection when both French and English folders exist", () => {
  // 1. English project with both folders present
  const projectEn = new TFolder("Novel");
  const manuscriptEn = new TFolder("Novel/Manuscript");
  const auxEn = new TFolder("Novel/_Feuillets");
  const resEn = new TFolder("Novel/_Feuillets/Resources");
  const resFr = new TFolder("Novel/_Feuillets/Ressources");
  projectEn.children = [manuscriptEn, auxEn];
  auxEn.children = [resEn, resFr];
  manuscriptEn.parent = projectEn;
  auxEn.parent = projectEn;
  resEn.parent = auxEn;
  resFr.parent = auxEn;

  const { vault: vaultEn } = createFakeVault([projectEn, manuscriptEn, auxEn, resEn, resFr]);
  const appEn = { vault: vaultEn };
  assert.equal(getResourcesRoot(appEn, manuscriptEn, "fr")?.path, "Novel/_Feuillets/Resources");

  // 2. French project with both folders present
  const projectFr = new TFolder("Roman");
  const manuscriptFr = new TFolder("Roman/Manuscrit");
  const auxFr = new TFolder("Roman/_Feuillets");
  const resFr2 = new TFolder("Roman/_Feuillets/Ressources");
  const resEn2 = new TFolder("Roman/_Feuillets/Resources");
  projectFr.children = [manuscriptFr, auxFr];
  auxFr.children = [resFr2, resEn2];
  manuscriptFr.parent = projectFr;
  auxFr.parent = projectFr;
  resFr2.parent = auxFr;
  resEn2.parent = auxFr;

  const { vault: vaultFr } = createFakeVault([projectFr, manuscriptFr, auxFr, resFr2, resEn2]);
  const appFr = { vault: vaultFr };
  assert.equal(getResourcesRoot(appFr, manuscriptFr, "en")?.path, "Roman/_Feuillets/Ressources");

  // 3. Adopted project with both folders present resolves according to fallback
  const adopted = new TFolder("Adopted");
  const auxAd = new TFolder("Adopted/_Feuillets");
  const resAdEn = new TFolder("Adopted/_Feuillets/Resources");
  const resAdFr = new TFolder("Adopted/_Feuillets/Ressources");
  adopted.children = [auxAd];
  auxAd.children = [resAdEn, resAdFr];
  auxAd.parent = adopted;
  resAdEn.parent = auxAd;
  resAdFr.parent = auxAd;

  const { vault: vaultAd } = createFakeVault([adopted, auxAd, resAdEn, resAdFr]);
  const appAd = { vault: vaultAd };
  assert.equal(getResourcesRoot(appAd, adopted, "en")?.path, "Adopted/_Feuillets/Resources");
  assert.equal(getResourcesRoot(appAd, adopted, "fr")?.path, "Adopted/_Feuillets/Ressources");
});

test("Neighboring projects isolation: a neighboring sibling folder does not dictate another project's locale", () => {
  const rootDir = new TFolder("Projects");
  const projectA = new TFolder("Projects/ProjectA");
  const projectBManuscript = new TFolder("Projects/Manuscrit");
  rootDir.children = [projectA, projectBManuscript];
  projectA.parent = rootDir;
  projectBManuscript.parent = rootDir;

  const { vault } = createFakeVault([rootDir, projectA, projectBManuscript]);
  const app = { vault };

  // Detecting locale of ProjectA (adopted root) must respect its explicit fallback, unaffected by sibling "Manuscrit"
  assert.equal(detectProjectStructureLocale(app, projectA, "en"), "en");
});

test("Adopted folder with no auxiliary paths falls back to operation locale", () => {
  const adopted = new TFolder("MyNotes");
  const { vault } = createFakeVault([adopted]);
  const app = { vault };

  assert.equal(detectProjectStructureLocale(app, adopted, "en"), "en");
  assert.equal(detectProjectStructureLocale(app, adopted, "fr"), "fr");
});

test("Adopted folder with unambiguous structural evidence adopts that language", () => {
  const adopted = new TFolder("MyNotes");
  const aux = new TFolder("MyNotes/_Feuillets");
  const res = new TFolder("MyNotes/_Feuillets/Resources");
  adopted.children = [aux];
  aux.children = [res];
  aux.parent = adopted;
  res.parent = aux;

  const { vault } = createFakeVault([adopted, aux, res]);
  const app = { vault };

  assert.equal(detectProjectStructureLocale(app, adopted, "fr"), "en");
});

/* ==================== Folder Carnet API Contract ==================== */

test("folderCarnetCanvasPath: returns string path without requiring app argument", () => {
  const namesEn = projectCreationNames("en");
  const namesFr = projectCreationNames("fr");

  const manuscriptEn = new TFolder(`Novel/${namesEn.manuscript}`);
  const parentEn = new TFolder("Novel");
  manuscriptEn.parent = parentEn;

  const pathEn = folderCarnetCanvasPath(manuscriptEn, TEST_CARNET_UUID);
  assert.equal(
    pathEn,
    `Novel/_Feuillets/${namesEn.auxiliary.resources}/${namesEn.resourceSubfolders.assets}/Carnets/${TEST_CARNET_UUID}.canvas`
  );

  const manuscriptFr = new TFolder(`Roman/${namesFr.manuscript}`);
  const parentFr = new TFolder("Roman");
  manuscriptFr.parent = parentFr;

  const pathFr = folderCarnetCanvasPath(manuscriptFr, TEST_CARNET_UUID);
  assert.equal(
    pathFr,
    `Roman/_Feuillets/${namesFr.auxiliary.resources}/${namesFr.resourceSubfolders.assets}/Carnets/${TEST_CARNET_UUID}.canvas`
  );
});

test("findExistingFolderCarnetCanvas: discovers existing canvas across candidate subfolders", () => {
  const project = new TFolder("Book");
  const manuscript = new TFolder("Book/Manuscript");
  const aux = new TFolder("Book/_Feuillets");
  const res = new TFolder("Book/_Feuillets/Resources");
  // Legacy folder name "Assets" with Carnets subfolder
  const legacyAssets = new TFolder("Book/_Feuillets/Resources/Assets");
  const carnets = new TFolder("Book/_Feuillets/Resources/Assets/Carnets");
  const canvasFile = new TFile(`Book/_Feuillets/Resources/Assets/Carnets/${TEST_CARNET_UUID}.canvas`);

  project.children = [manuscript, aux];
  aux.children = [res];
  res.children = [legacyAssets];
  legacyAssets.children = [carnets];
  carnets.children = [canvasFile];

  manuscript.parent = project;
  aux.parent = project;
  res.parent = aux;
  legacyAssets.parent = res;
  carnets.parent = legacyAssets;
  canvasFile.parent = carnets;

  const { vault } = createFakeVault([project, manuscript, aux, res, legacyAssets, carnets, canvasFile]);

  const found = findExistingFolderCarnetCanvas(vault, manuscript, TEST_CARNET_UUID);
  assert.ok(found instanceof TFile);
  assert.equal(found.path, canvasFile.path);
});

/* ==================== Zero Vault Writes on Locale Switch Alone ==================== */

test("Zero Vault writes occur on locale switch alone", () => {
  const { vault } = createFakeVault([]);
  const initialFileCount = vault.getFiles().length;

  setLocale("en");
  assert.equal(vault.getFiles().length, initialFileCount);

  setLocale("fr");
  assert.equal(vault.getFiles().length, initialFileCount);
});

/* ==================== Adopted Project User Operations ==================== */

test("Adopted project: French user operation creates French runtime folders and files", async (t) => {
  restoreLocaleAfter(t, "fr");
  const namesFr = projectCreationNames("fr");
  const namesEn = projectCreationNames("en");

  const adopted = new TFolder("MonProjetLibre");
  const note1 = new TFile("MonProjetLibre/Texte.md");
  adopted.children = [note1];
  note1.parent = adopted;

  const { vault } = createFakeVault([adopted, note1]);
  const app = { vault };
  const settings = freshSettings({ projectFolder: adopted.path });

  // 1. createQuickDraftFile with explicit French operation locale
  const draftFile = await createQuickDraftFile(app, adopted, undefined, "fr");
  assert.ok(draftFile instanceof TFile);
  assert.equal(draftFile.path, `MonProjetLibre/_Feuillets/${namesFr.auxiliary.drafts}/${namesFr.draftStem}.md`);
  assert.equal(vault.getAbstractFileByPath(`MonProjetLibre/_Feuillets/${namesFr.auxiliary.drafts}/${namesEn.draftStem}.md`), null);

  // 2. getOutputFolder with explicit French operation locale
  const outputFolder = await getOutputFolder(app, settings, "fr");
  assert.ok(outputFolder instanceof TFolder);
  assert.equal(outputFolder.path, `MonProjetLibre/_Feuillets/${namesFr.auxiliary.output}`);
  assert.equal(vault.getAbstractFileByPath(`MonProjetLibre/_Feuillets/${namesEn.auxiliary.output}`), null);

  // 3. ensureNotebookResearchFolder with explicit French operation locale
  const notebookFolder = await ensureNotebookResearchFolder(app, settings, "fr");
  assert.ok(notebookFolder instanceof TFolder);
  assert.equal(notebookFolder.path, `MonProjetLibre/_Feuillets/${namesFr.auxiliary.research}/${namesFr.notebook}`);
  assert.equal(vault.getAbstractFileByPath(`MonProjetLibre/_Feuillets/${namesEn.auxiliary.research}`), null);
});

test("Adopted project: English user operation creates English runtime folders and files", async (t) => {
  restoreLocaleAfter(t, "en");
  const namesFr = projectCreationNames("fr");
  const namesEn = projectCreationNames("en");

  const adopted = new TFolder("FreeProject");
  const note1 = new TFile("FreeProject/Story.md");
  adopted.children = [note1];
  note1.parent = adopted;

  const { vault } = createFakeVault([adopted, note1]);
  const app = { vault };
  const settings = freshSettings({ projectFolder: adopted.path });

  // 1. createQuickDraftFile with explicit English operation locale
  const draftFile = await createQuickDraftFile(app, adopted, undefined, "en");
  assert.ok(draftFile instanceof TFile);
  assert.equal(draftFile.path, `FreeProject/_Feuillets/${namesEn.auxiliary.drafts}/${namesEn.draftStem}.md`);
  assert.equal(vault.getAbstractFileByPath(`FreeProject/_Feuillets/${namesEn.auxiliary.drafts}/${namesFr.draftStem}.md`), null);

  // 2. getOutputFolder with explicit English operation locale
  const outputFolder = await getOutputFolder(app, settings, "en");
  assert.ok(outputFolder instanceof TFolder);
  assert.equal(outputFolder.path, `FreeProject/_Feuillets/${namesEn.auxiliary.output}`);
  assert.equal(vault.getAbstractFileByPath(`FreeProject/_Feuillets/${namesFr.auxiliary.output}`), null);

  // 3. ensureNotebookResearchFolder with explicit English operation locale
  const notebookFolder = await ensureNotebookResearchFolder(app, settings, "en");
  assert.ok(notebookFolder instanceof TFolder);
  assert.equal(notebookFolder.path, `FreeProject/_Feuillets/${namesEn.auxiliary.research}/${namesEn.notebook}`);
  assert.equal(vault.getAbstractFileByPath(`FreeProject/_Feuillets/${namesFr.auxiliary.research}`), null);
});

/* ==================== Neighboring Project Research Isolation ==================== */

test("Neighboring projects isolation: getResearchRootForProject on an adopted project does not resolve a neighboring project's research root", () => {
  // Vault has:
  // ProjectA/Recherche
  // AdoptedProjectB (sibling folder of ProjectA, with no Research/Recherche folder)
  const projectA = new TFolder("ProjectA");
  const researchA = new TFolder("ProjectA/Recherche");
  projectA.children = [researchA];
  researchA.parent = projectA;

  const adoptedB = new TFolder("AdoptedProjectB");
  const docB = new TFile("AdoptedProjectB/Doc.md");
  adoptedB.children = [docB];
  docB.parent = adoptedB;

  const { vault } = createFakeVault([projectA, researchA, adoptedB, docB]);
  const app = { vault };
  const settings = freshSettings();

  const foundForB = getResearchRootForProject(app, settings, adoptedB, "fr");
  assert.equal(foundForB, null, "AdoptedProjectB must not resolve ProjectA/Recherche");
});

/* ==================== Chapter Heuristic Removal ==================== */

test("detectProjectStructureLocale: adopted project with Chapter or Chapitre folder respects explicit fallback locale", () => {
  const projectWithChapitre = new TFolder("ProjetAvecChapitre");
  const chapFolder = new TFolder("ProjetAvecChapitre/Chapitre 1");
  projectWithChapitre.children = [chapFolder];
  chapFolder.parent = projectWithChapitre;

  const { vault: vault1 } = createFakeVault([projectWithChapitre, chapFolder]);
  const app1 = { vault: vault1 };

  // When fallback locale is "en", must return "en" even though folder is named "Chapitre 1"
  const localeEn = detectProjectStructureLocale(app1, projectWithChapitre, "en");
  assert.equal(localeEn, "en");

  const projectWithChapter = new TFolder("ProjetAvecChapter");
  const chapterFolder = new TFolder("ProjetAvecChapter/Chapter 1");
  projectWithChapter.children = [chapterFolder];
  chapterFolder.parent = projectWithChapter;

  const { vault: vault2 } = createFakeVault([projectWithChapter, chapterFolder]);
  const app2 = { vault: vault2 };

  // When fallback locale is "fr", must return "fr" even though folder is named "Chapter 1"
  const localeFr = detectProjectStructureLocale(app2, projectWithChapter, "fr");
  assert.equal(localeFr, "fr");
});

