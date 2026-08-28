import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { ResearchView } from "../src/views/research-view.js";
import { t } from "../src/i18n/index.js";

/* Correctif d'accessibilité UI du Prompt 1 (Carnet de dossier) : les actions
 * « Créer/Ouvrir le Carnet » existent déjà dans showFolderContextMenu et
 * showResearchFolderContextMenu — ces tests prouvent qu'elles sont bien
 * ATTEIGNABLES depuis le vrai DOM (clic droit Binder, bouton « … »
 * Recherche), jamais recopiées en dur ici (aucun appel direct à
 * canUseFolderCarnet/hasFolderCarnet/openFolderCarnet en dehors des API
 * plugin prévues). */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (h) => clearTimeout(h), requestAnimationFrame: () => 0 };

class FakeElement {
  constructor(options = {}) {
    this.children = []; this.classes = new Set(); this.events = new Map(); this.attrs = {};
    this.text = options.text ?? "";
    this.style = { _props: {}, setProperty(n, v) { this._props[n] = v; } };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) { const c = new FakeElement(options); c.tag = tag; this.children.push(c); return c; }
  createDiv(o = {}) { return this.createEl("div", o); }
  createSpan(o = {}) { return this.createEl("span", o); }
  addClass(cn) { for (const c of String(cn).split(" ")) if (c) this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  toggleClass(c, on) { on ? this.classes.add(c) : this.classes.delete(c); }
  hide() {} show() {} scrollIntoView() {}
  setText(t2) { this.text = String(t2); return this; }
  setAttr(n, v) { this.attrs[n] = v; }
  getAttr(n) { return this.attrs[n] ?? null; }
  addEventListener(t2, cb) { this.events.set(t2, cb); }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function findAll(root, pred) {
  const out = [];
  const walk = (el) => { for (const c of el.children) { if (pred(c)) out.push(c); walk(c); } };
  walk(root);
  return out;
}
function folderName(row) {
  return findAll(row, (e) => e.classes.has("feuillets-folder-name"))[0]?.text;
}

/* ============================= A. BINDER ============================= */

function createTreeModeFixture() {
  const root = new TFolder("Projet");
  const chapitre = new TFolder("Projet/Chapitre1");
  const scene = new TFile("Projet/Chapitre1/Scene.md");
  root.children = [chapitre];
  chapitre.children = [scene];
  chapitre.parent = root;
  scene.parent = chapitre;

  const allFiles = new Map([
    ["Projet", root],
    ["Projet/Chapitre1", chapitre],
    ["Projet/Chapitre1/Scene.md", scene],
    ["", new TFolder("")],
  ]);

  const settings = {
    projectFolder: root.path, projects: [], projectMeta: {}, binderLayout: "tree",
    binderSelectedPath: root.path, binderCompact: false, binderTreeWidth: 170,
    binderTreeCollapsed: false, binderListCollapsed: false, binderSplitRecursive: true,
    collapsed: {}, orders: {}, folderPositions: {},
  };

  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (f) => (f && f.children) || [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (f) => f.basename,
    shortTitleFor: (f) => f.basename,
    labelOf: () => "", labelsOf: () => [],
    projectDisplayName: (p) => (p === root.path ? "Projet" : p),
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {}, activateBoard() {},
    renderAllViews() {}, updateStatusBar() {}, adjustSidebarWidth() {},
    newFolder() {}, newSheet() {}, moveNode: async () => {},
    getLeafForOpeningFile: () => ({ id: "work-leaf", openFile: async () => {} }),
    getLinkedResearchFolder: () => null, getLinkedResearchFolders: () => [],
    setLinkedResearchFolder: async () => {}, removeLinkedResearchFolder: async () => {},
    dragState: null,
    /* `function` (pas de flèche) + lecture de `this.settings` : reproduit
       la vraie forme de FeuilletsPlugin#canUseFolderCarnet, pour que tout
       appel en RÉFÉRENCE DÉTACHÉE (perte de `this`) fasse échouer le test
       exactement comme dans la vraie régression (voir addFolderCarnetMenuItem). */
    canUseFolderCarnet: function (folder) { return folder.path.startsWith(`${this.settings.projectFolder}/`); },
    hasFolderCarnet: function () { return this.settings != null && false; },
    openFolderCarnet: async function () { void this.settings; },
    folderNoteFor: () => null,
    tagsOf: () => [],
  };

  const view = new FeuilletsView({
    app: {
      vault: { getAbstractFileByPath: (p) => allFiles.get(p) || null, getRoot: () => allFiles.get("") },
      workspace: { setActiveLeaf: () => {}, getLeaf: () => ({ id: "l", openFile: async () => {} }), revealLeaf: async () => {} },
    },
    contentEl,
  }, plugin);
  const dragHandlerCalls = [];
  view.attachDragHandlers = (...args) => { dragHandlerCalls.push(args); };
  view.updateActiveHighlight = () => {};

  return { view, contentEl, root, chapitre, scene, dragHandlerCalls };
}

test("Binder (tree) — la ligne du dossier reçoit un handler contextmenu qui appelle showFolderContextMenu", async () => {
  const { view, contentEl, chapitre } = createTreeModeFixture();
  let calledWith = null;
  view.showFolderContextMenu = (...args) => { calledWith = args[1]; };
  await view.render(true);

  const rows = findAll(contentEl, (el) => el.classes.has("feuillets-folder-row"));
  const chapRow = rows.find((r) => folderName(r) === "Chapitre1");
  assert.ok(chapRow, "la ligne du dossier existe");
  assert.ok(chapRow.events.has("contextmenu"), "un handler contextmenu est attaché à la ligne dossier");

  chapRow.events.get("contextmenu")({ preventDefault() {}, stopPropagation() {} });
  assert.equal(calledWith, chapitre, "showFolderContextMenu (existant) est appelé avec le bon dossier");
});

test("Binder (tree) — l'item Carnet du menu dossier reste conditionné par canUseFolderCarnet", async () => {
  const { view, contentEl } = createTreeModeFixture();
  await view.render(true);

  const rows = findAll(contentEl, (el) => el.classes.has("feuillets-folder-row"));
  const chapRow = rows.find((r) => folderName(r) === "Chapitre1");
  chapRow.events.get("contextmenu")({ preventDefault() {}, stopPropagation() {} });

  const menu = Menu.lastShown;
  const carnetItem = menu.items.find((i) => i.title === t("carnet.folder.create") || i.title === t("carnet.folder.open"));
  assert.ok(carnetItem, "l'item Carnet (Créer/Ouvrir) est présent quand canUseFolderCarnet renvoie true");
});

test("Binder (tree) — une ligne de FICHIER n'acquiert pas le comportement contextmenu du dossier (elle garde le sien, dédié aux fichiers)", async () => {
  const { view, contentEl, scene } = createTreeModeFixture();
  let folderMenuCalls = 0;
  let fileMenuCalledWith = null;
  view.showFolderContextMenu = () => { folderMenuCalls += 1; };
  view.showFileContextMenu = (...args) => { fileMenuCalledWith = args[1]; };
  await view.render(true);

  const fileRows = findAll(contentEl, (el) => el.classes.has("feuillets-item"));
  const sceneRow = fileRows.find((r) => findAll(r, (e) => e.classes.has("feuillets-item-name"))[0]?.text.trim() === scene.basename);
  assert.ok(sceneRow, "la ligne du fichier existe");
  assert.ok(sceneRow.events.has("contextmenu"), "le fichier garde son propre handler contextmenu");

  sceneRow.events.get("contextmenu")({ preventDefault() {}, stopPropagation() {} });
  assert.equal(folderMenuCalls, 0, "showFolderContextMenu n'est jamais appelé pour une ligne de fichier");
  assert.equal(fileMenuCalledWith, scene, "le fichier reçoit son propre menu (showFileContextMenu), jamais le menu dossier");
});

test("Binder (tree) — clic simple, chevron et drag&drop du dossier restent posés (non-régression)", async () => {
  const { view, contentEl, chapitre, dragHandlerCalls } = createTreeModeFixture();
  await view.render(true);

  const rows = findAll(contentEl, (el) => el.classes.has("feuillets-folder-row"));
  const chapRow = rows.find((r) => folderName(r) === "Chapitre1");
  assert.ok(chapRow.events.has("click"), "clic simple toujours présent");
  assert.ok(chapRow.events.has("dblclick"), "double-clic (isolation) toujours présent");
  assert.ok(
    dragHandlerCalls.some((args) => args[2] === chapitre.parent && args[0] === chapRow),
    "attachDragHandlers est toujours appelé pour la ligne dossier (drag & drop toujours actif)"
  );
});

/* ============================ B. RECHERCHE ============================ */

function createResearchFolderHarness({ canUseFolderCarnetResult, hasFolderCarnet = false, folder }) {
  const settings = { researchSearch: "", researchTagFilter: "", collapsed: {}, projectMeta: {}, labels: [], canUseFolderCarnetResult };
  const plugin = {
    settings,
    getProjectFolder: () => null,
    getResearchRoot: () => null,
    getChronoFolder: () => null,
    async ensureFolder() {},
    async saveSettings() {},
    tagsOf: () => [],
    titleFor: (f) => f.basename?.replace(/\.md$/, "") ?? f.name,
    fmOf: () => ({}),
    labelOf: () => "",
    labelColor: () => null,
    newFolder() {},
    getLinkedResearchFolders: () => [],
    /* `function` + lecture de `this.settings`, comme dans createTreeModeFixture
       ci-dessus : un appel en référence détachée (la régression corrigée par
       addFolderCarnetMenuItem) ferait échouer ce test avec la même TypeError
       que dans la vraie console Obsidian. */
    canUseFolderCarnet: function () { return this.settings.canUseFolderCarnetResult; },
    hasFolderCarnet: function () { return this.settings != null && hasFolderCarnet; },
    openFolderCarnet: async function () { void this.settings; },
  };
  const contentEl = new FakeElement();
  const leaf = { app: { vault: {} }, contentEl };
  const view = new ResearchView(leaf, plugin);

  view.iconBtn = (parent, _icon, tooltip, onClick) => {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    btn.tag = "button";
    btn.tooltip = tooltip;
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  };
  view.attachResearchDropTarget = () => {};
  view.attachResearchDragSource = () => {};
  view.addPreviewBtn = () => new FakeElement();
  view.researchFolderClipboardPath = undefined;

  return { view, contentEl, folder };
}

test("Recherche — le bouton « … » d'un dossier appelle showResearchFolderContextMenu (le vrai menu existant)", () => {
  const folder = new TFolder("Projet/_Recherche/Sources");
  folder.children = [];
  let calledWith = null;
  const { view, contentEl } = createResearchFolderHarness({ canUseFolderCarnetResult: true, folder });
  view.showResearchFolderContextMenu = (_e, f) => { calledWith = f; };

  view.renderSection(contentEl, "Sources", folder);

  const actionsLabel = t("shared.research.folderActions");
  const btn = findAll(contentEl, (c) => c.tag === "button" && c.tooltip === actionsLabel)[0];
  assert.ok(btn, "le bouton « … » est présent et n'est pas retiré du DOM");
  btn.events.get("click")({ stopPropagation() {} });
  assert.equal(calledWith, folder, "le clic appelle bien showResearchFolderContextMenu avec ce dossier");
});

test("Recherche — canUseFolderCarnet(folder) === true : l'item Carnet est présent dans le menu réel du bouton « … »", () => {
  const folder = new TFolder("Projet/_Recherche/Sources");
  folder.children = [];
  const { view, contentEl } = createResearchFolderHarness({ canUseFolderCarnetResult: true, folder });

  view.renderSection(contentEl, "Sources", folder);

  const actionsLabel = t("shared.research.folderActions");
  const btn = findAll(contentEl, (c) => c.tag === "button" && c.tooltip === actionsLabel)[0];
  btn.events.get("click")({ stopPropagation() {} });

  const menu = Menu.lastShown;
  const carnetItem = menu.items.find((i) => i.title === t("carnet.folder.create") || i.title === t("carnet.folder.open"));
  assert.ok(carnetItem, "l'item Carnet apparaît dans le menu Recherche quand canUseFolderCarnet est vrai");
});

test("Recherche — dossier hors projectRoot (canUseFolderCarnet === false) : le bouton reste actif mais sans action Carnet", () => {
  const folder = new TFolder("Vault/Docs");
  folder.children = [];
  const { view, contentEl } = createResearchFolderHarness({ canUseFolderCarnetResult: false, folder });

  view.renderSection(contentEl, "Docs", folder);

  const actionsLabel = t("shared.research.folderActions");
  const btn = findAll(contentEl, (c) => c.tag === "button" && c.tooltip === actionsLabel)[0];
  assert.ok(btn, "le bouton reste présent : d'autres actions Recherche restent disponibles");
  btn.events.get("click")({ stopPropagation() {} });

  const menu = Menu.lastShown;
  const carnetItem = menu.items.find((i) => i.title === t("carnet.folder.create") || i.title === t("carnet.folder.open"));
  assert.equal(carnetItem, undefined, "aucune action Carnet exposée pour un dossier hors projectRoot");
  assert.ok(menu.items.some((i) => i.title === t("binder.newSubfolder")), "les anciennes actions Recherche restent, elles, disponibles");
});

test("Recherche — les anciennes gardes du menu restent intactes (« Coller » désactivé sans presse-papiers)", () => {
  const folder = new TFolder("Projet/_Recherche/Sources");
  folder.children = [];
  const { view, contentEl } = createResearchFolderHarness({ canUseFolderCarnetResult: true, folder });
  view.researchFolderClipboardPath = undefined;

  view.renderSection(contentEl, "Sources", folder);
  const actionsLabel = t("shared.research.folderActions");
  const btn = findAll(contentEl, (c) => c.tag === "button" && c.tooltip === actionsLabel)[0];
  btn.events.get("click")({ stopPropagation() {} });

  const menu = Menu.lastShown;
  const pasteItem = menu.items.find((i) => i.title === t("shared.research.pasteFolder"));
  assert.ok(pasteItem, "l'item Coller existe toujours");
  assert.equal(pasteItem.disabled, true, "toujours désactivé sans presse-papiers rempli (garde préexistante inchangée)");
});
