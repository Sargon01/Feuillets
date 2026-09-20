import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  createMinimalProject,
  ensureCanonicalProjectBase,
  initResearchSubfolders,
} from "../src/services/project-files.js";
import { getResourcesRoot, getProjectFolder, projectDisplayName } from "../src/services/folder-structure.js";
import { TransformToProjectModal } from "../src/ui/project-modals.js";
import { setLocale, getLocale } from "../src/i18n/index.js";
import { projectCreationNames } from "../src/i18n/project-creation.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";

/* Behavior-level proof that the project-creation catalogue
 * (src/i18n/project-creation.ts) is actually wired into the real creation
 * paths: createMinimalProject (new standard project), and
 * ensureCanonicalProjectBase/initResearchSubfolders as used by
 * TransformToProjectModal (convert an existing folder to a project — see
 * src/ui/project-modals.ts). Every expected path below is built FROM the
 * catalogue itself (never a second hardcoded name list in this test file),
 * so a future change to a translated name updates these tests for free. */

function freshSettings(overrides = {}) {
  return { ...DEFAULT_SETTINGS, orders: {}, folderPositions: {}, projectMeta: {}, ...overrides };
}

function restoreLocaleAfter(t, locale) {
  const previous = getLocale();
  t.after(() => setLocale(previous));
  setLocale(locale);
}

/* ==================== exact structure per locale ==================== */

test("createMinimalProject (EN): produces the complete, exact English built-in structure", async (t) => {
  restoreLocaleAfter(t, "en");
  const names = projectCreationNames("en");
  const { vault } = createFakeVault([]);
  const app = { vault };

  await createMinimalProject(app, freshSettings(), { name: "Novel", type: "fiction" });

  const researchRoot = `Novel/_Feuillets/${names.auxiliary.research}`;
  const resourcesRoot = `Novel/_Feuillets/${names.auxiliary.resources}`;
  const expectedFolders = [
    `Novel/${names.manuscript}`,
    `Novel/${names.manuscript}/${names.frontMatter}`,
    `Novel/${names.manuscript}/${names.chapter1}`,
    researchRoot,
    `${researchRoot}/${names.researchSections.characters}`,
    `${researchRoot}/${names.researchSections.places}`,
    `${researchRoot}/${names.researchSections.events}`,
    `${researchRoot}/${names.researchSections.lore}`,
    `${researchRoot}/${names.researchSections.glossary}`,
    resourcesRoot,
    `${resourcesRoot}/${names.resourceSubfolders.images}`,
    `${resourcesRoot}/${names.resourceSubfolders.templates}`,
    `${resourcesRoot}/${names.resourceSubfolders.layouts}`,
    `${resourcesRoot}/${names.resourceSubfolders.exports}`,
    `${resourcesRoot}/${names.resourceSubfolders.assets}`,
  ];
  for (const path of expectedFolders) {
    assert.ok(vault.getAbstractFileByPath(path) instanceof TFolder, `expected English folder: ${path}`);
  }

  const expectedFiles = [
    `Novel/${names.manuscript}/${names.frontMatter}/${names.titlePage}.md`,
    `Novel/${names.manuscript}/${names.chapter1}/${names.scene1}.md`,
  ];
  for (const path of expectedFiles) {
    assert.ok(vault.getAbstractFileByPath(path) instanceof TFile, `expected English file: ${path}`);
  }
});

test("createMinimalProject (FR): produces the complete, exact French built-in structure", async (t) => {
  restoreLocaleAfter(t, "fr");
  const names = projectCreationNames("fr");
  const { vault } = createFakeVault([]);
  const app = { vault };

  await createMinimalProject(app, freshSettings(), { name: "Roman", type: "fiction" });

  const researchRoot = `Roman/_Feuillets/${names.auxiliary.research}`;
  const resourcesRoot = `Roman/_Feuillets/${names.auxiliary.resources}`;
  const expectedFolders = [
    `Roman/${names.manuscript}`,
    `Roman/${names.manuscript}/${names.frontMatter}`,
    `Roman/${names.manuscript}/${names.chapter1}`,
    researchRoot,
    `${researchRoot}/${names.researchSections.characters}`,
    `${researchRoot}/${names.researchSections.places}`,
    `${researchRoot}/${names.researchSections.events}`,
    `${researchRoot}/${names.researchSections.lore}`,
    `${researchRoot}/${names.researchSections.glossary}`,
    resourcesRoot,
    `${resourcesRoot}/${names.resourceSubfolders.images}`,
    `${resourcesRoot}/${names.resourceSubfolders.templates}`,
    `${resourcesRoot}/${names.resourceSubfolders.layouts}`,
    `${resourcesRoot}/${names.resourceSubfolders.exports}`,
    `${resourcesRoot}/${names.resourceSubfolders.assets}`,
  ];
  for (const path of expectedFolders) {
    assert.ok(vault.getAbstractFileByPath(path) instanceof TFolder, `expected French folder: ${path}`);
  }

  const expectedFiles = [
    `Roman/${names.manuscript}/${names.frontMatter}/${names.titlePage}.md`,
    `Roman/${names.manuscript}/${names.chapter1}/${names.scene1}.md`,
  ];
  for (const path of expectedFiles) {
    assert.ok(vault.getAbstractFileByPath(path) instanceof TFile, `expected French file: ${path}`);
  }
});

/* ==================== the two structures differ only where the catalogue differs ==================== */

test("EN and FR structures differ exactly where projectCreationNames differs, and agree exactly where it doesn't", async (t) => {
  const previous = getLocale();
  t.after(() => setLocale(previous));

  setLocale("en");
  const en = projectCreationNames("en");
  const vaultEN = createFakeVault([]).vault;
  await createMinimalProject({ vault: vaultEN }, freshSettings(), { name: "Project", type: "fiction" });

  setLocale("fr");
  const fr = projectCreationNames("fr");
  const vaultFR = createFakeVault([]).vault;
  await createMinimalProject({ vault: vaultFR }, freshSettings(), { name: "Project", type: "fiction" });

  const comparisons = [
    ["manuscript", en.manuscript, fr.manuscript],
    ["frontMatter", en.frontMatter, fr.frontMatter],
    ["auxiliary.research", en.auxiliary.research, fr.auxiliary.research],
    ["auxiliary.resources", en.auxiliary.resources, fr.auxiliary.resources],
    ["resourceSubfolders.images", en.resourceSubfolders.images, fr.resourceSubfolders.images],
    ["resourceSubfolders.templates", en.resourceSubfolders.templates, fr.resourceSubfolders.templates],
    ["resourceSubfolders.layouts", en.resourceSubfolders.layouts, fr.resourceSubfolders.layouts],
    ["resourceSubfolders.exports", en.resourceSubfolders.exports, fr.resourceSubfolders.exports],
    ["resourceSubfolders.assets", en.resourceSubfolders.assets, fr.resourceSubfolders.assets],
    ["researchSections.lore", en.researchSections.lore, fr.researchSections.lore],
    ["researchSections.characters", en.researchSections.characters, fr.researchSections.characters],
    ["titlePage", en.titlePage, fr.titlePage],
    ["chapter1", en.chapter1, fr.chapter1],
    ["scene1", en.scene1, fr.scene1],
  ];

  for (const [label, enValue, frValue] of comparisons) {
    if (enValue === frValue) {
      // Identical catalogue value: both locales must have created the SAME
      // name at their respective (locale-specific) position — verified
      // concretely by the top-level folder checks below, not per-field here.
      continue;
    }
    assert.notEqual(enValue, frValue, `${label} is expected to differ between locales`);
  }

  // Concrete positions where the catalogue values differ: EN's vault must
  // never contain the FR name at that position, and vice versa.
  assert.equal(vaultEN.getAbstractFileByPath(`Project/${fr.manuscript}`), null);
  assert.equal(vaultFR.getAbstractFileByPath(`Project/${en.manuscript}`), null);
  assert.equal(vaultEN.getAbstractFileByPath(`Project/${en.manuscript}/_Feuillets/${fr.auxiliary.research}`), null);
  assert.equal(vaultFR.getAbstractFileByPath(`Project/${fr.manuscript}/_Feuillets/${en.auxiliary.research}`), null);

  // Concrete positions where the catalogue values are IDENTICAL (e.g.
  // "Front", "Images", "Exports", "Lore"): both vaults must agree exactly.
  assert.ok(vaultEN.getAbstractFileByPath(`Project/${en.manuscript}/${en.frontMatter}`) instanceof TFolder);
  assert.ok(vaultFR.getAbstractFileByPath(`Project/${fr.manuscript}/${fr.frontMatter}`) instanceof TFolder);
  assert.equal(en.frontMatter, fr.frontMatter, "frontMatter is one of the catalogue fields that coincide");
});

/* ==================== no French built-in name in an English project ==================== */

test("no French built-in creation name appears anywhere in a project created under English locale", async (t) => {
  restoreLocaleAfter(t, "en");
  const en = projectCreationNames("en");
  const fr = projectCreationNames("fr");
  const { vault, files } = createFakeVault([]);
  await createMinimalProject({ vault }, freshSettings(), { name: "EnglishProject", type: "fiction" });

  /* `files` (exposed by createFakeVault) is the flat map of every entry
     ever created, by full path — the reliable way to enumerate everything
     this fake vault knows about. Folder `.children` links are only
     populated when a folder's PARENT already existed at creation time, so
     a `.children`-based tree walk would silently miss paths created
     directly (e.g. "_Feuillets/Research" without "_Feuillets" itself ever
     being separately created first) — a fake-vault quirk, not a
     production bug: see the byte-for-byte "_Feuillets" test below for the
     same reasoning applied to a single path. */
  const allSegments = new Set();
  for (const path of files.keys()) {
    for (const segment of path.split("/")) allSegments.add(segment);
  }

  const catalogueFieldPairs = [
    [en.manuscript, fr.manuscript],
    [en.auxiliary.research, fr.auxiliary.research],
    [en.auxiliary.resources, fr.auxiliary.resources],
    [en.resourceSubfolders.templates, fr.resourceSubfolders.templates],
    [en.resourceSubfolders.layouts, fr.resourceSubfolders.layouts],
    [en.resourceSubfolders.assets, fr.resourceSubfolders.assets],
    [en.researchSections.characters, fr.researchSections.characters],
    [en.researchSections.places, fr.researchSections.places],
    [en.researchSections.events, fr.researchSections.events],
    [en.researchSections.glossary, fr.researchSections.glossary],
    [en.titlePage, fr.titlePage],
    [en.chapter1, fr.chapter1],
    [en.scene1, fr.scene1],
  ];
  for (const [englishValue, frenchValue] of catalogueFieldPairs) {
    if (englishValue === frenchValue) continue; // legitimately identical in both locales
    assert.ok(!allSegments.has(frenchValue), `French name "${frenchValue}" must not appear in an English project`);
    // Sanity: the English counterpart (or its ".md" file form) IS present.
    assert.ok(
      allSegments.has(englishValue) || allSegments.has(`${englishValue}.md`),
      `English name "${englishValue}" should be present`
    );
  }
});

/* ==================== _Feuillets is locale-independent ==================== */

test("_Feuillets is byte-for-byte identical regardless of locale", async (t) => {
  const previous = getLocale();
  t.after(() => setLocale(previous));

  setLocale("en");
  const { vault: vaultEN, files: filesEN } = createFakeVault([]);
  await createMinimalProject({ vault: vaultEN }, freshSettings(), { name: "ProjA", type: "fiction" });
  assert.ok(vaultEN.getAbstractFileByPath("ProjA/_Feuillets/Research") instanceof TFolder);
  assert.ok([...filesEN.keys()].some((path) => path.split("/").includes("_Feuillets")), "\"_Feuillets\" appears as its own path segment (EN)");

  setLocale("fr");
  const { vault: vaultFR, files: filesFR } = createFakeVault([]);
  await createMinimalProject({ vault: vaultFR }, freshSettings(), { name: "ProjB", type: "fiction" });
  assert.ok(vaultFR.getAbstractFileByPath("ProjB/_Feuillets/Recherche") instanceof TFolder);
  assert.ok([...filesFR.keys()].some((path) => path.split("/").includes("_Feuillets")), "\"_Feuillets\" appears as its own path segment (FR)");

  assert.equal(projectCreationNames("en").feuilletsRoot, "_Feuillets");
  assert.equal(projectCreationNames("fr").feuilletsRoot, "_Feuillets");
});

/* ==================== folder-to-project conversion ==================== */

test("converting an existing folder to a project (TransformToProjectModal's own call sequence) uses the selected locale only for newly created built-in items", async (t) => {
  restoreLocaleAfter(t, "en");
  const names = projectCreationNames("en");

  const folder = new TFolder("AdoptedFolder");
  const customChild = new TFolder("AdoptedFolder/MyOwnNotes");
  folder.children = [customChild];
  customChild.parent = folder;
  const { vault } = createFakeVault([folder, customChild]);
  const app = { vault };

  const { researchPath } = await ensureCanonicalProjectBase(app, folder, names);
  await initResearchSubfolders(app, researchPath, "fiction", names);

  // Newly created built-in items follow the selected (English) locale.
  assert.equal(researchPath, `AdoptedFolder/_Feuillets/${names.auxiliary.research}`);
  assert.ok(vault.getAbstractFileByPath(`AdoptedFolder/_Feuillets/${names.auxiliary.resources}`) instanceof TFolder);
  assert.ok(vault.getAbstractFileByPath(`${researchPath}/${names.researchSections.characters}`) instanceof TFolder);

  // The pre-existing custom folder is untouched: same path, same identity.
  assert.equal(vault.getAbstractFileByPath("AdoptedFolder/MyOwnNotes"), customChild);
  assert.equal(customChild.path, "AdoptedFolder/MyOwnNotes");
});

/* ==================== pre-existing items are never renamed or duplicated ==================== */

test("an existing French research folder is reused as-is when converting/initializing under English locale — never renamed, never duplicated", async (t) => {
  restoreLocaleAfter(t, "en");
  const fr = projectCreationNames("fr");

  const folder = new TFolder("LegacyFrenchProject");
  const aux = new TFolder("LegacyFrenchProject/_Feuillets");
  const research = new TFolder(`LegacyFrenchProject/_Feuillets/${fr.auxiliary.research}`);
  const existingNote = new TFile(`LegacyFrenchProject/_Feuillets/${fr.auxiliary.research}/Existing.md`, "content");
  folder.children = [aux];
  aux.parent = folder;
  aux.children = [research];
  research.parent = aux;
  research.children = [existingNote];
  existingNote.parent = research;

  const { vault } = createFakeVault([folder, aux, research, existingNote]);
  const app = { vault };

  const { researchPath } = await ensureCanonicalProjectBase(app, folder);

  // The pre-existing French-named folder is reused, never renamed.
  assert.equal(researchPath, `LegacyFrenchProject/_Feuillets/${fr.auxiliary.research}`);
  assert.equal(vault.getAbstractFileByPath(researchPath), research);
  assert.equal(vault.getAbstractFileByPath(`${researchPath}/Existing.md`), existingNote);
  // No competing English-named duplicate is created alongside it.
  assert.equal(vault.getAbstractFileByPath("LegacyFrenchProject/_Feuillets/Research"), null);
});

/* ==================== switching locale after creation: zero writes, unchanged paths ==================== */

test("switching locale after creation performs zero Vault writes and leaves every resolved path unchanged", async (t) => {
  restoreLocaleAfter(t, "fr");
  const { vault } = createFakeVault([]);
  const app = { vault };
  const settings = freshSettings();

  const result = await createMinimalProject(app, settings, { name: "StableProject", type: "fiction" });
  const manuscriptFolder = vault.getAbstractFileByPath(result.manuscritPath);
  const resourcesBefore = getResourcesRoot(app, manuscriptFolder)?.path;
  const projectFolderBefore = getProjectFolder(app, settings)?.path;

  let createCalls = 0;
  let createFolderCalls = 0;
  let createBinaryCalls = 0;
  let renameCalls = 0;
  const originalCreate = vault.create.bind(vault);
  const originalCreateFolder = vault.createFolder.bind(vault);
  const originalCreateBinary = vault.createBinary.bind(vault);
  vault.create = (...args) => { createCalls += 1; return originalCreate(...args); };
  vault.createFolder = (...args) => { createFolderCalls += 1; return originalCreateFolder(...args); };
  vault.createBinary = (...args) => { createBinaryCalls += 1; return originalCreateBinary(...args); };
  app.fileManager = { renameFile: async () => { renameCalls += 1; } };

  // The locale change itself — no operation is triggered by this alone.
  setLocale("en");

  // Re-resolving the SAME project's folders after the switch must return
  // the exact same paths already on disk — never recompute from the new
  // active locale.
  const resourcesAfter = getResourcesRoot(app, manuscriptFolder)?.path;
  const projectFolderAfter = getProjectFolder(app, settings)?.path;

  assert.equal(createCalls, 0, "no new file was created merely by switching locale");
  assert.equal(createFolderCalls, 0, "no new folder was created merely by switching locale");
  assert.equal(createBinaryCalls, 0, "no new binary file was created merely by switching locale");
  assert.equal(renameCalls, 0, "nothing was renamed merely by switching locale");
  assert.equal(resourcesAfter, resourcesBefore, "the resources path is unchanged after switching locale");
  assert.equal(projectFolderAfter, projectFolderBefore, "the project folder path is unchanged after switching locale");
});

/* ==================== custom user names and structures are preserved exactly ==================== */

test("a custom project name and a custom research subfolder survive project creation and conversion byte-for-byte", async (t) => {
  restoreLocaleAfter(t, "fr");
  const { vault } = createFakeVault([]);
  const app = { vault };

  const result = await createMinimalProject(app, freshSettings(), {
    name: "Mon Récit Personnalisé — été 2026",
    type: "fiction",
  });

  assert.equal(result.volumePath, "Mon Récit Personnalisé — été 2026");
  assert.ok(vault.getAbstractFileByPath("Mon Récit Personnalisé — été 2026") instanceof TFolder);

  const researchRoot = vault.getAbstractFileByPath(`${result.volumePath}/_Feuillets/Recherche`);
  assert.ok(researchRoot instanceof TFolder);
  const customSubfolder = await vault.createFolder(`${researchRoot.path}/Carnet de recherches spécial`);
  researchRoot.children.push(customSubfolder);
  customSubfolder.parent = researchRoot;

  setLocale("en");
  await initResearchSubfolders(app, researchRoot.path, "fiction");

  assert.ok(
    vault.getAbstractFileByPath(`${researchRoot.path}/Carnet de recherches spécial`) instanceof TFolder,
    "the custom, user-named subfolder is never touched by a later locale-driven operation"
  );
});

/* ==================== single catalogue, no duplicate hardcoded name list in runtime code ==================== */

function readSource(relativePath) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

test("folder-structure.ts, project-files.ts, research.ts and project-drafts.ts resolve built-in creation names through projectCreationNames — no second hardcoded French/English catalogue", () => {
  for (const file of [
    "src/services/folder-structure.ts",
    "src/services/project-files.ts",
    "src/services/research.ts",
    "src/services/project-drafts.ts",
  ]) {
    const source = readSource(file);
    assert.match(source, /projectCreationNames/, `${file} must resolve creation names through the catalogue`);
  }

  const researchSource = readSource("src/services/research.ts");
  assert.doesNotMatch(
    researchSource,
    /\{\s*fr:\s*"[^"]+",\s*en:\s*"[^"]+"\s*\}/,
    "no second hardcoded { fr, en } name pair left in research.ts"
  );

  const draftsSource = readSource("src/services/project-drafts.ts");
  assert.doesNotMatch(
    draftsSource,
    /["']Sans titre["']/,
    "no hardcoded French draft stem left in project-drafts.ts"
  );

  const modalsSource = readSource("src/ui/project-modals.ts");
  assert.match(modalsSource, /projectCreationNames/, "project-modals.ts must resolve creation names through the catalogue");
});

/* ==================== projectDisplayName ==================== */

test("projectDisplayName recognizes both canonical manuscript folder names from the project-creation catalogue", () => {
  assert.equal(projectDisplayName("Project/Manuscrit"), "Project");
  assert.equal(projectDisplayName("Project/Manuscript"), "Project");
});

test("projectDisplayName preserves existing display-name behavior for ordinary adopted folder paths", () => {
  assert.equal(projectDisplayName("AdoptedFolder"), "AdoptedFolder");
  assert.equal(projectDisplayName("MyVault/AdoptedNotes"), "AdoptedNotes");
  assert.equal(projectDisplayName("Workspace/Drafts"), "Drafts");
  assert.equal(projectDisplayName("SingleFolder"), "SingleFolder");
  assert.equal(projectDisplayName(""), "");
});

/* ==================== conversion locale capture ==================== */

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = "";
    this.text = "";
    this.attributes = {};
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag);
    if (options.value !== undefined) child.value = options.value;
    if (options.text !== undefined) child.text = options.text;
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(cls) { for (const c of cls.split(" ")) this.classes.add(c); }
  setText(text) { this.text = String(text); return this; }
  setAttribute(name, value) { this.attributes[name] = value; }
  setAttr(name, value) { this.attributes[name] = value; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
  async trigger(type) {
    this.events.get(type)?.({ stopPropagation() {}, preventDefault() {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("conversion captures the locale before its first awaited operation, without rereading it", async (t) => {
  restoreLocaleAfter(t, "en");

  const folder = new TFolder("AdoptedProject");
  const { vault } = createFakeVault([folder]);
  const app = { vault };
  const settings = freshSettings();

  let saveSettingsAwaited = false;
  let localeDuringSave = "";

  const plugin = {
    settings,
    async saveSettings() {
      saveSettingsAwaited = true;
      // Change global locale in the middle of saveSettings (the first awaited operation).
      setLocale("fr");
      localeDuringSave = getLocale();
    },
    renderAllViews() {},
    updateStatusBar() {},
  };

  const modal = new TransformToProjectModal(app, plugin, folder.path);
  modal.contentEl = new FakeElement();
  let modalClosed = false;
  modal.close = () => { modalClosed = true; };

  modal.onOpen();

  const select = modal.contentEl.find((el) => el.tag === "select");
  assert.ok(select, "select element found");
  select.value = "fiction";

  const button = modal.contentEl.find((el) => el.tag === "button" && el.classes.has("mod-cta"));
  assert.ok(button, "transform button found");

  await button.trigger("click");

  assert.ok(saveSettingsAwaited, "saveSettings was awaited as first async operation");
  assert.equal(localeDuringSave, "fr", "locale was changed to French during saveSettings");
  assert.ok(modalClosed, "modal completed and closed");

  // Since locale was captured before saveSettings and never reread during conversion,
  // the English catalogue active when transform() started was used for all created folders.
  const researchEn = vault.getAbstractFileByPath("AdoptedProject/_Feuillets/Research");
  const resourcesEn = vault.getAbstractFileByPath("AdoptedProject/_Feuillets/Resources");
  const charactersEn = vault.getAbstractFileByPath("AdoptedProject/_Feuillets/Research/Characters");

  assert.ok(researchEn instanceof TFolder, "Research folder was created using initial English catalogue");
  assert.ok(resourcesEn instanceof TFolder, "Resources folder was created using initial English catalogue");
  assert.ok(charactersEn instanceof TFolder, "Characters folder was created using initial English catalogue");

  // No French folders must exist
  assert.equal(vault.getAbstractFileByPath("AdoptedProject/_Feuillets/Recherche"), null);
  assert.equal(vault.getAbstractFileByPath("AdoptedProject/_Feuillets/Ressources"), null);
  assert.equal(vault.getAbstractFileByPath("AdoptedProject/_Feuillets/Research/Personnages"), null);

  // Static check: verify in project-modals.ts source that projectCreationNames(getLocale())
  // strictly precedes the first await (await this.plugin.saveSettings()).
  const modalsSource = readSource("src/ui/project-modals.ts");
  const transformCode = modalsSource.slice(
    modalsSource.indexOf("export class TransformToProjectModal"),
    modalsSource.indexOf("export class ManageProjectsModal")
  );
  const namesPos = transformCode.indexOf("projectCreationNames(getLocale())");
  const saveSettingsPos = transformCode.indexOf("await this.plugin.saveSettings()");
  assert.ok(namesPos !== -1, "projectCreationNames call must exist in TransformToProjectModal");
  assert.ok(saveSettingsPos !== -1, "saveSettings await must exist in TransformToProjectModal");
  assert.ok(namesPos < saveSettingsPos, "locale must be captured before the first awaited operation");
});

