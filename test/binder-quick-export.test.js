import assert from "node:assert/strict";
import test from "node:test";
import { Menu, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { t } from "../src/i18n/index.js";

/* Même FakeElement minimal que feuillets-view-onboarding.test.js — dupliqué
 * plutôt que partagé (convention du dépôt), suffisant pour laisser render()
 * construire sa barre d'icônes sans jsdom. */
class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.style = { _props: {}, setProperty(name, value) { this._props[name] = value; } };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  setText(text) { this.text = String(text); return this; }
  setAttr() {}
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
}

/* Dernier lot UX avant 2.5, §11 — Binder : icône Export rapide.
 * Points de non-régression couverts ici :
 *  16. icône Export en DERNIÈRE position après Filtres (voir aussi
 *      feuillets-view-onboarding.test.js) ;
 *  17. portée : sélection > isolation > projet ;
 *  18. clic simple réutilise le format courant (settings.exportFormat) ;
 *  19. clic droit propose les quatre formats + « Ouvrir Édition ». */

function buildProject() {
  const root = new TFolder("Roman/Manuscrit");
  root.path = "Roman/Manuscrit";
  root.name = "Manuscrit";

  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.name = "Chapitre 1";
  chapter.parent = root;
  root.children = [chapter];

  const { vault, fileManager } = createFakeVault([root, chapter]);
  const settings = {
    projectFolder: root.path,
    level1Role: "chapitres",
    compileFileName: "Manuscrit.md",
    exportFormat: "epub",
    orders: {},
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {},
  };
  const app = { vault, fileManager, workspace: {}, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  return { app, root, chapter, settings };
}

function buildView(project) {
  const activatedSurfaces = [];
  const plugin = {
    settings: project.settings,
    activeExportScope: null,
    getProjectFolder: () => project.root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: () => [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: (path) => path,
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    renderAllViews() {},
    updateStatusBar() {},
    newSheet() {},
    newFolder() {},
    activateCentralSurface: async (surface, mode) => { activatedSurfaces.push([surface, mode]); },
  };
  const contentEl = new FakeElement();
  const view = new FeuilletsView({ app: project.app, contentEl }, plugin);
  view.app = project.app;
  view.plugin = plugin;
  return { view, plugin, activatedSurfaces, contentEl };
}

test("binderQuickExportScope : sans sélection ni isolation → portée projet", () => {
  const project = buildProject();
  const { view } = buildView(project);
  const scope = view.binderQuickExportScope();
  assert.deepEqual(scope, { type: "project", projectRoot: project.root.path });
});

test("binderQuickExportScope : dossier isolé sans sélection → portée folder", () => {
  const project = buildProject();
  const { view } = buildView(project);
  view._binderWorkingRootPath = project.chapter.path;
  const scope = view.binderQuickExportScope();
  assert.deepEqual(scope, { type: "folder", projectRoot: project.root.path, path: project.chapter.path });
});

test("binderQuickExportScope : sélection Binder multiple prime sur l'isolation", () => {
  const project = buildProject();
  const { view } = buildView(project);
  view._binderWorkingRootPath = project.chapter.path;
  view.plugin._binderMultiSelect = new Set([project.chapter.path]);
  const scope = view.binderQuickExportScope();
  assert.equal(scope.type, "selection");
  assert.deepEqual(scope.paths, [project.chapter.path]);
});

test("binderQuickExportScope : jamais le feuillet actif comme portée implicite", () => {
  const project = buildProject();
  const { view } = buildView(project);
  // Aucune sélection, aucune isolation : la portée doit rester "projet",
  // quel que soit le fichier actuellement ouvert dans l'éditeur.
  const scope = view.binderQuickExportScope();
  assert.equal(scope.type, "project");
});

test("binderQuickExportFormat : reflète settings.exportFormat, repli docx si absent/md", () => {
  const project = buildProject();
  const { view } = buildView(project);
  assert.equal(view.binderQuickExportFormat(), "epub");
  project.settings.exportFormat = "md";
  assert.equal(view.binderQuickExportFormat(), "docx");
  delete project.settings.exportFormat;
  assert.equal(view.binderQuickExportFormat(), "docx");
});

test("Binder — Export rapide : clic simple exporte avec la portée et le format courants (md, sans DOM)", async () => {
  const project = buildProject();
  project.settings.exportFormat = "md";
  const { view, plugin } = buildView(project);

  const buttons = [];
  view.iconBtn = (_parent, icon, tooltip) => {
    const button = { icon, tooltip, listeners: new Map(), addEventListener(type, cb) { this.listeners.set(type, cb); } };
    buttons.push(button);
    return button;
  };
  // Rendu réel du Binder pour construire la barre d'icônes (aucune isolation,
  // aucune sélection → portée projet attendue).
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  await view.render(true);

  const exportBtn = buttons.find((b) => b.icon === "download");
  assert.ok(exportBtn, "l'icône download doit être présente");
  assert.ok(exportBtn.tooltip.includes(t("preview.scope.project")), "tooltip reflète la portée courante");

  const click = exportBtn.listeners.get("click");
  assert.ok(click, "un clic simple doit être câblé");
  await click();
  assert.deepEqual(plugin.activeExportScope, { type: "project", projectRoot: project.root.path });
});

test("Binder — Export rapide : le VRAI BaseFeuilletsView.iconBtn (non substitué) attache un listener click fonctionnel", async () => {
  const project = buildProject();
  project.settings.exportFormat = "md";
  const { view, plugin, contentEl } = buildView(project);

  // AUCUNE substitution de view.iconBtn ici : on exerce le vrai chemin
  // (parent.createEl("button") + addEventListener externe), exactement
  // comme Recherche/Filtres déjà en production — pas un raccourci de test.
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  await view.render(true);

  const findByIcon = (el, icon) => {
    if (el.icon === icon) return el;
    for (const child of el.children || []) {
      const found = findByIcon(child, icon);
      if (found) return found;
    }
    return null;
  };
  const exportBtn = findByIcon(contentEl, "download");
  assert.ok(exportBtn, "l'icône download est bien présente dans le DOM réel");

  const click = exportBtn.events.get("click");
  assert.ok(click, "le vrai iconBtn + addEventListener externe câblent bien un listener click");
  await click();
  assert.deepEqual(plugin.activeExportScope, { type: "project", projectRoot: project.root.path }, "le clic réel déclenche bien runExportWorkflow avec la portée projet");
});

test("Binder — Export rapide : clic droit propose DOCX/PDF/EPUB/ODT puis Ouvrir Édition", async () => {
  const project = buildProject();
  const { view, activatedSurfaces } = buildView(project);

  const buttons = [];
  view.iconBtn = (_parent, icon, tooltip) => {
    const button = { icon, tooltip, listeners: new Map(), addEventListener(type, cb) { this.listeners.set(type, cb); } };
    buttons.push(button);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  await view.render(true);

  const exportBtn = buttons.find((b) => b.icon === "download");
  const contextmenu = exportBtn.listeners.get("contextmenu");
  assert.ok(contextmenu, "un clic droit doit être câblé");
  contextmenu({ preventDefault() {} });

  const menu = Menu.lastShown;
  const titles = menu.items.filter((i) => !i.separator).map((i) => i.title);
  assert.deepEqual(titles, [
    t("binder.quickExport.exportDocx"),
    t("binder.quickExport.exportPdf"),
    t("binder.quickExport.exportEpub"),
    t("binder.quickExport.exportOdt"),
    t("binder.quickExport.openEdition"),
  ]);

  const openEdition = menu.items.find((i) => i.title === t("binder.quickExport.openEdition"));
  await openEdition.callback();
  assert.deepEqual(activatedSurfaces, [["edition", "composition"]]);
});
