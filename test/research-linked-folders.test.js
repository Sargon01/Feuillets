import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";
import { ResearchView } from "../src/views/research-view.js";
import { setLocale, getLocale, t } from "../src/i18n/index.js";
import { PROJECT_MODES } from "../src/utils/project-modes.js";

/* Micro-correctif "Dossiers associés" : le mécanisme Binder → dossier
   Recherche externe (researchFolderLinks / getLinkedResearchFolder,
   main.ts) existait déjà mais n'était jamais projeté dans le panneau
   Recherche (renderResearchBody ne rend que la racine _Recherche du
   projet). Deux couches testées ici :
   - la collecte pure (plugin.getLinkedResearchFolders(), sur une VRAIE
     instance de FeuilletsPlugin — voir test/annotation-editing.test.js
     pour ce même patron Object.create(FeuilletsPlugin.prototype)) ;
   - le rendu (BaseFeuilletsView.renderAssociatedResearchFolders / le
     paramètre `external` de renderSection), avec le même harnais DOM que
     test/research-view.test.js. */

const ROOT = "Projet";
const CHAPITRE_A = "Projet/Manuscrit/ChapitreA";
const CHAPITRE_B = "Projet/Manuscrit/ChapitreB";
const SCENE = "Projet/Manuscrit/ChapitreA/Scène.md";
const DOCS = "Vault/Docs";
const ARCHIVES = "Vault/Archives";

function fixturePlugin({ links = {} } = {}) {
  const root = new TFolder(ROOT);
  const manuscrit = new TFolder("Projet/Manuscrit");
  const chapitreA = new TFolder(CHAPITRE_A);
  const chapitreB = new TFolder(CHAPITRE_B);
  const sceneFile = new TFile(SCENE, "");
  root.children = [manuscrit];
  manuscrit.parent = root;
  manuscrit.children = [chapitreA, chapitreB];
  chapitreA.parent = manuscrit;
  chapitreB.parent = manuscrit;
  sceneFile.parent = chapitreA;

  const docs = new TFolder(DOCS);
  const archives = new TFolder(ARCHIVES);
  const { vault } = createFakeVault([root, manuscrit, chapitreA, chapitreB, sceneFile, docs, archives]);

  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { vault };
  plugin.settings = {
    projectFolder: root.path,
    projectMeta: { [root.path]: { researchFolderLinks: links } },
  };

  return { plugin, vault, root, manuscrit, chapitreA, chapitreB, sceneFile, docs, archives };
}

/* --- A. Association externe visible --- */

test("getLinkedResearchFolders collecte un dossier associé hors projet (dossier Binder)", () => {
  const { plugin } = fixturePlugin({ links: { [CHAPITRE_A]: DOCS } });

  const result = plugin.getLinkedResearchFolders();

  assert.equal(result.length, 1);
  assert.equal(result[0].folder.path, DOCS);
  assert.deepEqual(result[0].binderNodes.map((n) => n.path), [CHAPITRE_A]);
});

/* --- B. Fichier Binder associé --- */

test("getLinkedResearchFolders collecte un dossier associé depuis un FICHIER du Binder", () => {
  const { plugin } = fixturePlugin({ links: { [SCENE]: DOCS } });

  const result = plugin.getLinkedResearchFolders();

  assert.equal(result.length, 1);
  assert.equal(result[0].folder.path, DOCS);
  assert.deepEqual(result[0].binderNodes.map((n) => n.path), [SCENE]);
});

/* --- D. Plusieurs associations vers le même dossier --- */

test("getLinkedResearchFolders regroupe deux nœuds Binder associés au même dossier externe", () => {
  const { plugin } = fixturePlugin({ links: { [CHAPITRE_A]: DOCS, [CHAPITRE_B]: DOCS } });

  const result = plugin.getLinkedResearchFolders();

  assert.equal(result.length, 1, "une seule entrée dossier");
  assert.equal(result[0].folder.path, DOCS);
  assert.deepEqual(
    result[0].binderNodes.map((n) => n.path).sort(),
    [CHAPITRE_A, CHAPITRE_B].sort(),
    "les deux associations sont conservées"
  );
});

/* --- E. Association orpheline --- */

test("getLinkedResearchFolders ignore un dossier associé qui n'existe plus", () => {
  const { plugin } = fixturePlugin({ links: { [CHAPITRE_A]: "Vault/Disparu" } });

  const result = plugin.getLinkedResearchFolders();

  assert.deepEqual(result, [], "aucune entrée fantôme, aucune erreur");
});

test("getLinkedResearchFolders ignore une entrée dont le nœud Binder n'existe plus", () => {
  const { plugin } = fixturePlugin({ links: { "Projet/Manuscrit/Disparu": DOCS } });

  const result = plugin.getLinkedResearchFolders();

  assert.deepEqual(result, []);
});

test("getLinkedResearchFolders sans projet actif ne plante pas", () => {
  const { vault } = createFakeVault([]);
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { vault };
  plugin.settings = { projectFolder: "", projectMeta: {} };

  assert.deepEqual(plugin.getLinkedResearchFolders(), []);
});

/* --- F. Changement/suppression d'association --- */

test("getLinkedResearchFolders reflète l'état courant des settings après changement", () => {
  const { plugin } = fixturePlugin({ links: { [CHAPITRE_A]: DOCS } });

  assert.equal(plugin.getLinkedResearchFolders().length, 1);
  assert.equal(plugin.getLinkedResearchFolders()[0].folder.path, DOCS);

  // Changement d'association (comme setLinkedResearchFolder le ferait).
  const root = plugin.getProjectFolder();
  plugin.settings.projectMeta[root.path].researchFolderLinks[CHAPITRE_B] = ARCHIVES;
  let result = plugin.getLinkedResearchFolders();
  assert.equal(result.length, 2);

  // Suppression (comme removeLinkedResearchFolder le ferait).
  delete plugin.settings.projectMeta[root.path].researchFolderLinks[CHAPITRE_A];
  result = plugin.getLinkedResearchFolders();
  assert.equal(result.length, 1);
  assert.equal(result[0].folder.path, ARCHIVES);
});

/* --- §18 : set/removeLinkedResearchFolder restent la source de vérité pour
   la projection Recherche — aucun second stockage, aucun déplacement de
   dossier physique, aucun YAML modifié (les MÊMES méthodes que la double vue
   interroge via getLinkedResearchFolders). --- */

test("setLinkedResearchFolder rend le dossier disponible pour la projection Recherche (stockage unique)", async () => {
  const { plugin, chapitreA, docs, sceneFile } = fixturePlugin();
  plugin.saveData = async () => {};
  sceneFile.content = "titre : test\n---\ncorps";

  await plugin.setLinkedResearchFolder(chapitreA, docs);

  const result = plugin.getLinkedResearchFolders();
  assert.equal(result.length, 1, "l'association est disponible pour la projection");
  assert.equal(result[0].folder.path, DOCS);
  assert.deepEqual(result[0].binderNodes.map((n) => n.path), [CHAPITRE_A]);

  // Aucun second stockage : l'association vit uniquement dans
  // projectMeta[root].researchFolderLinks.
  const meta = plugin.settings.projectMeta[plugin.getProjectFolder().path];
  assert.deepEqual(Object.keys(meta), ["researchFolderLinks"]);
  assert.equal(meta.researchFolderLinks[CHAPITRE_A], DOCS);

  // Aucune modification du chemin physique du dossier.
  assert.equal(docs.path, DOCS);
  assert.equal(plugin.app.vault.getAbstractFileByPath(DOCS), docs);

  // Aucun YAML modifié : le fichier garde son contenu intact.
  assert.equal(sceneFile.content, "titre : test\n---\ncorps");
});

test("removeLinkedResearchFolder retire le dossier de la liste source de la projection", async () => {
  const { plugin, chapitreA, docs } = fixturePlugin({ links: { [CHAPITRE_A]: DOCS } });
  plugin.saveData = async () => {};
  assert.equal(plugin.getLinkedResearchFolders().length, 1);

  await plugin.removeLinkedResearchFolder(chapitreA);

  assert.deepEqual(plugin.getLinkedResearchFolders(), [], "plus rien à projeter sous Recherche");
  const meta = plugin.settings.projectMeta[plugin.getProjectFolder().path];
  assert.deepEqual(meta.researchFolderLinks, {});
  assert.equal(docs.path, DOCS, "le dossier physique n'est ni déplacé ni supprimé");
});

/* ================================================================== */
/* Rendu dans le panneau Recherche (renderAssociatedResearchFolders)  */
/* ================================================================== */

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.value = "";
    this.attrs = new Map();
  }

  addClass(className) {
    for (const part of String(className).split(/\s+/)) if (part) this.classes.add(part);
  }
  removeClass(className) {
    for (const part of String(className).split(/\s+/)) this.classes.delete(part);
  }
  createDiv(options = {}) {
    const child = new FakeElement(options);
    child.parent = this;
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.parent = this;
    child.tag = tag;
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  addEventListener(type, callback) {
    this.events ||= new Map();
    this.events.set(type, callback);
  }
  setText(text) {
    this.text = String(text);
  }
  setAttr(name, value) {
    this.attrs.set(name, value);
  }
  getAttr(name) {
    return this.attrs.get(name);
  }
  empty() {
    this.children = [];
  }
  contains() {
    return false;
  }
  setCssStyles() {}
}

function findAll(root, predicate, out = []) {
  for (const c of root.children) {
    if (predicate(c)) out.push(c);
    findAll(c, predicate, out);
  }
  return out;
}

function createResearchViewHarness({ linkedFolders = [] } = {}) {
  const settings = {
    researchSearch: "",
    researchTagFilter: "",
    collapsed: {},
    projectMeta: {},
    labels: [],
  };
  const plugin = {
    settings,
    getProjectFolder: () => null,
    getResearchRoot: () => null,
    getChronoFolder: () => null,
    async ensureFolder() {},
    projectMode: () => PROJECT_MODES.fiction,
    async migrateBibliographieIntoSources() {},
    async saveSettings() {},
    tagsOf: () => [],
    titleFor: (f) => f.basename.replace(/\.md$/, ""),
    fmOf: () => ({}),
    labelOf: () => "",
    labelColor: () => null,
    newFolder() {},
    getLinkedResearchFolders: () => linkedFolders,
  };
  const contentEl = new FakeElement();
  const leaf = { app: { vault: { getAbstractFileByPath: () => null } }, contentEl };
  const view = new ResearchView(leaf, plugin);

  view.iconBtn = (parent, _icon, tooltip, onClick) => {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    btn.tooltip = tooltip;
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  };
  view.attachResearchDropTarget = () => {};
  view.attachResearchDragSource = () => {};
  view.addPreviewBtn = () => new FakeElement();
  view.showResearchFolderContextMenu = () => {};
  view.showResearchFileContextMenu = () => {};

  return { view, contentEl, plugin };
}

/* --- A/G (rendu) : le dossier associé apparaît et son contenu est
   consultable via le mécanisme de rendu Recherche existant. --- */

test("renderAssociatedResearchFolders affiche un dossier associé externe avec son contenu", () => {
  const docs = new TFolder("Vault/Docs");
  const note = new TFile("Vault/Docs/Notice.md");
  docs.children = [note];
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [chapitreA] }],
  });

  view.renderAssociatedResearchFolders(contentEl, null);

  const groupTitle = findAll(contentEl, (c) =>
    c.classes.has("feuillets-notes-section-title")
  )[0];
  assert.ok(groupTitle, "l'en-tête « Espaces » doit être rendu");
  assert.equal(groupTitle.text, t("shared.research.workspaces"));

  const names = findAll(contentEl, (c) => c.classes.has("feuillets-research-item-name"));
  assert.ok(
    names.some((n) => n.text === "Notice"),
    "le contenu du dossier associé (son fichier) est bien rendu, comme n'importe quelle rubrique Recherche"
  );
});

test("linked Research folders list office, OpenDocument, and EPUB attachments", () => {
  const docs = new TFolder("Vault/Docs");
  const files = [
    new TFile("Vault/Docs/Guide.docx"),
    new TFile("Vault/Docs/Notes.odt"),
    new TFile("Vault/Docs/Data.xlsx"),
    new TFile("Vault/Docs/Data.ods"),
    new TFile("Vault/Docs/Slides.pptx"),
    new TFile("Vault/Docs/Slides.odp"),
    new TFile("Vault/Docs/Book.epub"),
  ];
  docs.children = files;
  for (const file of files) file.parent = docs;
  const binderFolder = new TFolder(CHAPITRE_A);
  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [binderFolder] }],
  });

  view.renderAssociatedResearchFolders(contentEl, null);

  const names = findAll(contentEl, (element) =>
    element.classes.has("feuillets-research-item-name")
  ).map((element) => element.text);
  assert.deepEqual(names, [
    "Book.epub",
    "Data.ods",
    "Data.xlsx",
    "Guide.docx",
    "Notes.odt",
    "Slides.odp",
    "Slides.pptx",
  ]);

  const guideName = findAll(contentEl, (element) =>
    element.classes.has("feuillets-research-item-name") && element.text === "Guide.docx"
  )[0];
  assert.equal(
    guideName.getAttr("title"),
    "Guide.docx",
    "the complete name remains available as a tooltip"
  );
});

test("renderAssociatedResearchFolders place un dossier associé sous Espaces dans la Recherche globale", () => {
  const baseResearch = new TFolder("Projet/_Recherche");
  const docs = new TFolder("Projet/_Recherche/Chapitre 1");
  const chronology = new TFile("Projet/_Recherche/Chapitre 1/Chronology.md");
  docs.children = [chronology];
  baseResearch.children = [docs];
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [chapitreA] }],
  });

  view.renderAssociatedResearchFolders(contentEl, baseResearch);

  const groupHead = findAll(contentEl, (c) => c.getAttr("data-research-group") === "spaces")[0];
  assert.ok(groupHead, "le header Espaces est présent");
  const groupSection = groupHead.parent.parent;
  const chapterTitle = findAll(groupSection, (c) =>
    c.classes.has("feuillets-notes-section-title") && c.text === "Chapitre 1"
  )[0];
  assert.ok(chapterTitle, "Chapitre 1 est dans le groupe Espaces");
  assert.notEqual(chapterTitle.parent.parent.parent.parent, contentEl, "Chapitre 1 n'est pas une section sœur du body Recherche");
  const chronologyName = findAll(groupSection, (c) => c.text === "Chronology")[0];
  assert.ok(chronologyName, "Chronology reste descendant du dossier associé");
});

test("renderAssociatedResearchFolders ne rend pas séparément un lien TFile descendant d'un lien TFolder", () => {
  const baseResearch = new TFolder("Projet/_Recherche");
  const chapter = new TFolder("Vault/Chapitre 1");
  const sheet = new TFolder("Vault/Chapitre 1/Feuille 1");
  const chronology = new TFile("Vault/Chapitre 1/Chronology.md");
  const sheetNote = new TFile("Vault/Chapitre 1/Feuille 1/Note.md");
  chapter.children = [sheet, chronology];
  sheet.parent = chapter;
  chronology.parent = chapter;
  sheet.children = [sheetNote];
  sheetNote.parent = sheet;
  const binderFolder = new TFolder(CHAPITRE_A);
  const binderFile = new TFile(SCENE, "");

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [
      { folder: chapter, binderNodes: [binderFolder] },
      { folder: sheet, binderNodes: [binderFile] },
    ],
  });

  view.renderAssociatedResearchFolders(contentEl, baseResearch);

  const spaces = findAll(contentEl, (c) => c.getAttr("data-research-group") === "spaces")[0];
  assert.ok(spaces, "la rubrique Espaces est visible");
  const groupSection = spaces.parent.parent;
  const chapterTitles = findAll(groupSection, (c) =>
    c.classes.has("feuillets-notes-section-title") && c.text === "Chapitre 1"
  );
  const sheetTitles = findAll(groupSection, (c) =>
    c.classes.has("feuillets-notes-section-title") && c.text === "Feuille 1"
  );
  assert.equal(chapterTitles.length, 1, "la racine Recherche associée apparaît une fois");
  assert.equal(sheetTitles.length, 0, "le dossier lié au feuillet n'est pas une section autonome");

  const sheetRows = findAll(groupSection, (c) =>
    c.classes.has("feuillets-research-subfolder") && c.text === ""
  );
  assert.ok(sheetRows.length > 0, "Feuille 1 reste visible comme sous-dossier du dossier parent");
  assert.ok(
    findAll(groupSection, (c) => c.text === "Note").length > 0,
    "le contenu du dossier lié au feuillet reste accessible dans l'arborescence"
  );
  assert.ok(
    findAll(groupSection, (c) => c.text === "Chronology").length > 0,
    "Chronology.md reste visible dans le dossier associé parent"
  );
});

test("renderAssociatedResearchFolders place les dossiers associés dans la rubrique Espaces", () => {
  const docs = new TFolder("Vault/Docs");
  const note = new TFile("Vault/Docs/Chronology.md");
  docs.children = [note];
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [chapitreA] }],
  });

  view.renderAssociatedResearchFolders(contentEl, new TFolder("Projet/_Recherche"));

  const group = findAll(contentEl, (c) => c.getAttr("data-research-group") === "spaces")[0];
  assert.ok(group, "la rubrique virtuelle Espaces existe");
  const groupSection = group.parent;
  const folderTitle = findAll(groupSection, (c) =>
    c.classes.has("feuillets-notes-section-title") && c.text === "Docs"
  )[0];
  assert.ok(folderTitle, "le dossier associé est rendu dans Espaces");
  assert.equal(folderTitle.parent.parent.parent.parent, groupSection, "le dossier associé reste descendant de la rubrique Espaces");
});

test("renderAssociatedResearchFolders : clic sur l'en-tête plie/déplie le contenu (même mécanisme que les autres rubriques)", () => {
  const docs = new TFolder("Vault/Docs");
  const note = new TFile("Vault/Docs/Notice.md");
  docs.children = [note];
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [chapitreA] }],
  });
  view.render = async () => {};

  view.renderAssociatedResearchFolders(contentEl, null);

  const heads = findAll(contentEl, (c) => c.classes.has("feuillets-notes-section-head"));
  assert.equal(heads.length, 2);
  assert.doesNotThrow(() => heads[0].events.get("click")({}));
  assert.equal(
    view.plugin.settings.collapsed["research:spaces"],
    true,
    "l'état replié est mémorisé sous la clé de la rubrique ESPACES"
  );
});

/* --- D (rendu) : un même dossier associé à plusieurs nœuds Binder
   n'apparaît qu'une fois, avec un badge listant les deux. --- */

test("renderAssociatedResearchFolders affiche une seule fois un dossier associé à deux nœuds Binder", () => {
  const docs = new TFolder("Vault/Docs");
  const chapitreA = new TFolder(CHAPITRE_A);
  chapitreA.name = "Chapitre A";
  const chapitreB = new TFolder(CHAPITRE_B);
  chapitreB.name = "Chapitre B";

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [chapitreA, chapitreB] }],
  });

  view.renderAssociatedResearchFolders(contentEl, null);

  const sectionTitles = findAll(contentEl, (c) => c.classes.has("feuillets-notes-section-title"));
  const folderTitles = sectionTitles.filter((c) => c.text === "Docs");
  assert.equal(folderTitles.length, 1, "le dossier n'apparaît qu'une seule fois");

  const badges = findAll(contentEl, (c) => c.classes.has("feuillets-research-linked-badge"));
  assert.equal(badges.length, 1);
  assert.equal(badges[0].text, "2 espaces");
});

/* --- C. Déduplication --- */

test("renderAssociatedResearchFolders ne réaffiche pas un dossier déjà sous la racine Recherche du projet", () => {
  const baseResearch = new TFolder("Projet/_Recherche");
  const sources = new TFolder("Projet/_Recherche/Sources");
  baseResearch.children = [sources];
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: sources, binderNodes: [chapitreA] }],
  });
  view.app.vault.getAbstractFileByPath = (path) => path === sources.path ? sources : null;

  view.renderAssociatedResearchFolders(contentEl, baseResearch);

  assert.equal(contentEl.children.length, 0, "rien n'est rendu : déjà visible naturellement");
});

test("renderAssociatedResearchFolders ne réaffiche pas la racine Recherche elle-même", () => {
  const baseResearch = new TFolder("Projet/_Recherche");
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: baseResearch, binderNodes: [chapitreA] }],
  });

  view.renderAssociatedResearchFolders(contentEl, baseResearch);

  assert.equal(contentEl.children.length, 0);
});

test("renderAssociatedResearchFolders affiche quand même un dossier associé DIFFÉRENT de la racine Recherche", () => {
  const baseResearch = new TFolder("Projet/_Recherche");
  const docs = new TFolder("Vault/Docs");
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [chapitreA] }],
  });

  view.renderAssociatedResearchFolders(contentEl, baseResearch);

  const names = findAll(contentEl, (c) => c.classes.has("feuillets-notes-section-title"));
  assert.ok(names.some((n) => n.text === "Docs"));
});

/* --- 4. Les associations ESPACES conservent leurs actions physiques --- */

test("un dossier associé sous ESPACES conserve ses actions et sa cible de dépôt", () => {
  const docs = new TFolder("Vault/Docs");
  const note = new TFile("Vault/Docs/Notice.md");
  docs.children = [note];
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [chapitreA] }],
  });
  let dropTargetCalls = 0;
  view.attachResearchDropTarget = () => { dropTargetCalls += 1; };

  view.renderAssociatedResearchFolders(contentEl, null);

  const folderRows = findAll(contentEl, (c) => c.classes.has("feuillets-notes-section-head"));
  let actionCount = 0;
  for (const row of folderRows) {
    const actionButtons = findAll(row, (c) => c.tag === "button" && c.tooltip === t("shared.research.folderActions"));
    actionCount += actionButtons.length;
  }
  assert.equal(actionCount, 1, "le dossier associé conserve son menu ⋯");
  assert.equal(dropTargetCalls, 1, "le dossier associé conserve sa cible de dépôt");
});

/* Micro-correctif "navigation des fichiers Recherche externes" (dernier
   lot avant 2.5, §16-18) : un FICHIER d'un dossier associé externe garde
   désormais son bouton ⋯, mais son menu se limite à la navigation — voir
   showResearchFileContextMenu(navigationOnly) et
   test/research-external-file-menu.test.js pour la couverture complète du
   contenu du menu. */
test("un fichier d'un dossier associé externe garde son bouton ⋯ (menu limité à la navigation)", () => {
  const docs = new TFolder("Vault/Docs");
  const note = new TFile("Vault/Docs/Notice.md");
  note.basename = "Notice";
  docs.children = [note];
  const chapitreA = new TFolder(CHAPITRE_A);

  const { view, contentEl } = createResearchViewHarness({
    linkedFolders: [{ folder: docs, binderNodes: [chapitreA] }],
  });
  const calls = [];
  view.showResearchFileContextMenu = (_e, file, navigationOnly) => calls.push({ file, navigationOnly });

  view.renderAssociatedResearchFolders(contentEl, null);

  const actionsLabel = t("shared.research.folderActions");
  const fileHeader = findAll(contentEl, (c) => c.classes.has("feuillets-research-item-header"))[0];
  const fileActionBtn = findAll(fileHeader, (c) => c.tag === "button" && c.tooltip === actionsLabel)[0];
  assert.ok(fileActionBtn, "le bouton ⋯ du fichier externe doit être présent");
  fileActionBtn.events.get("click")({ stopPropagation() {} });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file.path, note.path);
  assert.equal(calls[0].navigationOnly, undefined, "le fichier associé conserve le menu Recherche normal");
});

/* --- E (rendu) : orpheline déjà filtrée en amont, rien à faire ici --- */

test("renderAssociatedResearchFolders ne rend rien quand la collecte est vide (association orpheline)", () => {
  const { view, contentEl } = createResearchViewHarness({ linkedFolders: [] });

  assert.doesNotThrow(() => view.renderAssociatedResearchFolders(contentEl, null));
  assert.equal(contentEl.children.length, 0);
});

/* --- H. i18n --- */

test("le libellé « Dossiers associés » est disponible en français et en anglais", () => {
  const previous = getLocale();
  try {
    setLocale("fr");
    assert.equal(t("shared.research.linkedFolders"), "Dossiers associés");
    setLocale("en");
    assert.equal(t("shared.research.linkedFolders"), "Linked folders");
  } finally {
    setLocale(previous);
  }
});

test("renderAssociatedResearchFolders : l'en-tête suit la locale active (aucun texte français codé en dur)", () => {
  const previous = getLocale();
  try {
    const docs = new TFolder("Vault/Docs");
    const chapitreA = new TFolder(CHAPITRE_A);

    setLocale("en");
    const { view, contentEl } = createResearchViewHarness({
      linkedFolders: [{ folder: docs, binderNodes: [chapitreA] }],
    });
    view.renderAssociatedResearchFolders(contentEl, null);

    const groupTitle = findAll(contentEl, (c) =>
      c.classes.has("feuillets-notes-section-title")
    )[0];
    assert.equal(groupTitle.text, "Workspaces");
  } finally {
    setLocale(previous);
  }
});
