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
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
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
  const leaf = { app: { vault: {} }, contentEl };
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
    c.classes.has("feuillets-research-linked-group-title")
  )[0];
  assert.ok(groupTitle, "l'en-tête « Dossiers associés » doit être rendu");
  assert.equal(groupTitle.text, t("shared.research.linkedFolders"));

  const names = findAll(contentEl, (c) => c.classes.has("feuillets-research-item-name"));
  assert.ok(
    names.some((n) => n.text === "Notice"),
    "le contenu du dossier associé (son fichier) est bien rendu, comme n'importe quelle rubrique Recherche"
  );
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
  assert.equal(heads.length, 1);
  assert.doesNotThrow(() => heads[0].events.get("click")({}));
  assert.equal(
    view.plugin.settings.collapsed[docs.path],
    true,
    "l'état replié est mémorisé sous la clé du VRAI dossier"
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
  assert.equal(badges[0].text, "Chapitre A · Chapitre B");
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

/* --- 4. Aucune modification du dossier externe (lecture/navigation seule) --- */

test("un dossier associé externe n'a ni menu d'actions (au niveau dossier) ni glisser-déposer", () => {
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

  // Le dossier lui-même reste sans menu d'actions (renommer/déplacer/
  // supprimer un dossier externe reste interdit) — voir renderSection,
  // `if (folderOrFiles instanceof TFolder && !external)`.
  const folderRows = findAll(contentEl, (c) => c.classes.has("feuillets-notes-section-head"));
  for (const row of folderRows) {
    const actionButtons = findAll(row, (c) => c.tag === "button" && c.tooltip === t("shared.research.folderActions"));
    assert.equal(actionButtons.length, 0, "pas de menu ⋯ sur l'en-tête du dossier externe");
  }
  assert.equal(dropTargetCalls, 0, "un dossier externe n'est jamais cible de dépôt");
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
  const fileActionBtn = findAll(contentEl, (c) => c.tag === "button" && c.tooltip === actionsLabel)[0];
  assert.ok(fileActionBtn, "le bouton ⋯ du fichier externe doit être présent");
  fileActionBtn.events.get("click")({ stopPropagation() {} });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file.path, note.path);
  assert.equal(calls[0].navigationOnly, true, "navigationOnly doit être vrai pour un fichier externe");
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
      c.classes.has("feuillets-research-linked-group-title")
    )[0];
    assert.equal(groupTitle.text, "Linked folders");
  } finally {
    setLocale(previous);
  }
});
