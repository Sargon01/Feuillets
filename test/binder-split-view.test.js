import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { t } from "../src/i18n/index.js";

/* Correctif final Binder 2.5 — double vue (modèle Ulysses) : remplace le
 * premier essai (Manuscrit/Coffre, S.binderDualPane) par un vrai split
 * dossiers-à-gauche / listing-à-droite piloté par S.binderLayout
 * ("tree" = simple, "split" = double) et S.binderSelectedPath.
 * Couvre : dispatch de mode, hiérarchie des dossiers gauche, master/detail
 * gauche → droite, "+" racine/dossier, largeur de la sidebar, toolbar,
 * Vault repliable et sa liaison Recherche. */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle), requestAnimationFrame: () => 0 };

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = {};
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
  addClass(classNames) { for (const c of String(classNames).split(" ")) if (c) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  scrollIntoView() {}
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const classNames = (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const attrNames = (selector.match(/\[[\w-]+\]/g) || []).map((a) => a.slice(1, -1));
    const matches = [];
    const walk = (el) => {
      for (const child of el.children) {
        const classOk = classNames.every((c) => child.classes.has(c));
        const attrOk = attrNames.every((a) => Object.prototype.hasOwnProperty.call(child.attrs, a));
        if (classOk && attrOk) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
}

function findAll(root, predicate) {
  const out = [];
  const walk = (el) => {
    for (const child of el.children) {
      if (predicate(child)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/* Le clic simple sur le nom d'un dossier (Binder 2.5) programme l'ouverture
 * Continu après BINDER_CLICK_DELAY_MS (220ms, voir renderHierarchyContents
 * dans feuillets-view.ts) pour laisser un double-clic s'annoncer d'abord —
 * il faut donc attendre plus que ce délai avant de vérifier openFolderInContinu. */
function flushClickDelay() {
  return new Promise((resolve) => setTimeout(resolve, 260));
}

function baseSettings(overrides = {}) {
  return {
    projectFolder: "",
    projects: [],
    projectMeta: {},
    binderLayout: "split",
    binderSelectedPath: "",
    binderCompact: false,
    binderTreeWidth: 170,
    binderTreeCollapsed: false,
    binderListCollapsed: false,
    binderSplitRecursive: true,
    collapsed: {},
    orders: {},
    folderPositions: {},
    ...overrides,
  };
}

function makeVault(allFiles) {
  return {
    getAbstractFileByPath: (path) => allFiles.get(path) || null,
    getRoot: () => allFiles.get("") ?? (() => {
      const root = new TFolder("");
      root.name = "";
      allFiles.set("", root);
      return root;
    })(),
  };
}

/** Construit un plugin minimal + une vue, sur un projet NEFES à plat, prêt
 * pour renderSplitBody. `vaultChildren` peuple `app.vault.getRoot().children`
 * (mini-navigateur Vault) séparément de l'arbre du projet. */
function createSplitFixture({ settingsOverrides = {}, vaultChildren = [], researchRoot = null, versionsRoot = null, linkedResearch = [] } = {}) {
  const root = new TFolder("NEFES");
  const front = new TFolder("NEFES/Front");
  const subhanallah = new TFolder("NEFES/Subhanallah");
  const elHamdulillah = new TFolder("NEFES/El Hamdulillah");
  const allahuEkber = new TFolder("NEFES/Allahu Ekber");
  const chapitreX = new TFolder("NEFES/El Hamdulillah/Chapitre X");
  root.children = [front, subhanallah, elHamdulillah, allahuEkber];
  elHamdulillah.children = [chapitreX];
  front.children = [];
  subhanallah.children = [];
  allahuEkber.children = [];
  chapitreX.children = [];
  for (const f of [front, subhanallah, elHamdulillah, allahuEkber, chapitreX]) f.parent = root;
  chapitreX.parent = elHamdulillah;

  const feuillet1 = new TFile("NEFES/El Hamdulillah/Feuillet1.md");
  const feuillet2 = new TFile("NEFES/El Hamdulillah/Feuillet2.md");
  elHamdulillah.children = [chapitreX, feuillet1, feuillet2];

  const vaultRoot = new TFolder("");
  vaultRoot.name = "";
  vaultRoot.children = vaultChildren;

  const allFiles = new Map([
    ["NEFES", root],
    ["NEFES/Front", front],
    ["NEFES/Subhanallah", subhanallah],
    ["NEFES/El Hamdulillah", elHamdulillah],
    ["NEFES/Allahu Ekber", allahuEkber],
    ["NEFES/El Hamdulillah/Chapitre X", chapitreX],
    ["NEFES/El Hamdulillah/Feuillet1.md", feuillet1],
    ["NEFES/El Hamdulillah/Feuillet2.md", feuillet2],
    ["", vaultRoot],
  ]);
  for (const f of vaultChildren) allFiles.set(f.path, f);

  const settings = baseSettings({ projectFolder: root.path, binderSelectedPath: root.path, ...settingsOverrides });

  const calls = {
    newFolder: [], newSheet: [], attachDragHandlers: [], moveNode: [],
    setLinkedResearchFolder: [], removeLinkedResearchFolder: [], renderAllViews: [],
    adjustSidebarWidth: 0,
  };

  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => researchRoot,
    getVersionsRoot: () => versionsRoot,
    getOrderedChildren: (folder) => (folder && folder.children) || [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: (path) => (path === root.path ? "NEFES" : path),
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    activateBoard() {},
    renderAllViews(force) { calls.renderAllViews.push(force); },
    updateStatusBar() {},
    adjustSidebarWidth() { calls.adjustSidebarWidth++; },
    newFolder(folder) { calls.newFolder.push(folder); },
    newSheet(folder) { calls.newSheet.push(folder); },
    moveNode: async (...args) => { calls.moveNode.push(args); },
    getLeafForOpeningFile: () => ({ id: "work-leaf", openFile: async () => {} }),
    getLinkedResearchFolder: () => null,
    getLinkedResearchFolders: () => linkedResearch,
    setLinkedResearchFolder: async (...args) => { calls.setLinkedResearchFolder.push(args); },
    removeLinkedResearchFolder: async (...args) => { calls.removeLinkedResearchFolder.push(args); },
    dragState: null,
  };

  const view = new FeuilletsView({
    app: {
      vault: makeVault(allFiles),
      workspace: {
        setActiveLeaf: () => {},
        getLeaf: (kind, dir) => ({ id: `leaf-${kind || "default"}-${dir || ""}`, openFile: async () => {} }),
        revealLeaf: async () => {},
      },
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = (...args) => calls.attachDragHandlers.push(args);
  view.updateActiveHighlight = () => {};

  return { view, contentEl, plugin, settings, root, front, subhanallah, elHamdulillah, allahuEkber, chapitreX, feuillet1, feuillet2, vaultRoot, calls };
}

/** Fixture "Blog" du CORRECTIF FINAL (§31 et suivants) :
 * Projet/
 *   Articles/
 *   Blog/
 *     2025/
 *     2026/ (Article A.md, Article B.md)
 *     Brouillons/
 *   Newsletter/
 */
function createBlogFixture({ settingsOverrides = {}, binderWorkingRootPath } = {}) {
  const root = new TFolder("Projet");
  const articles = new TFolder("Projet/Articles");
  const blog = new TFolder("Projet/Blog");
  const y2025 = new TFolder("Projet/Blog/2025");
  const y2026 = new TFolder("Projet/Blog/2026");
  const brouillons = new TFolder("Projet/Blog/Brouillons");
  const newsletter = new TFolder("Projet/Newsletter");

  root.children = [articles, blog, newsletter];
  blog.children = [y2025, y2026, brouillons];
  articles.children = [];
  y2025.children = [];
  brouillons.children = [];
  for (const f of [articles, blog, newsletter]) f.parent = root;
  for (const f of [y2025, y2026, brouillons]) f.parent = blog;

  const articleA = new TFile("Projet/Blog/2026/Article A.md");
  const articleB = new TFile("Projet/Blog/2026/Article B.md");
  articleA.parent = y2026;
  articleB.parent = y2026;
  y2026.children = [articleA, articleB];

  const allFiles = new Map([
    ["Projet", root],
    ["Projet/Articles", articles],
    ["Projet/Blog", blog],
    ["Projet/Blog/2025", y2025],
    ["Projet/Blog/2026", y2026],
    ["Projet/Blog/Brouillons", brouillons],
    ["Projet/Newsletter", newsletter],
    ["Projet/Blog/2026/Article A.md", articleA],
    ["Projet/Blog/2026/Article B.md", articleB],
    ["", new TFolder("")],
  ]);

  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: blog.path,
    ...settingsOverrides,
  });

  const calls = { newFolder: [], newSheet: [], attachDragHandlers: [], moveNode: [], renderAllViews: [], adjustSidebarWidth: 0 };

  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => (folder && folder.children) || [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: (path) => (path === root.path ? "Projet" : path),
    roleOfFile: () => "scene",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    activateBoard() {},
    renderAllViews(force) { calls.renderAllViews.push(force); },
    updateStatusBar() {},
    adjustSidebarWidth() { calls.adjustSidebarWidth++; },
    newFolder(folder) { calls.newFolder.push(folder); },
    newSheet(folder) { calls.newSheet.push(folder); },
    moveNode: async (...args) => { calls.moveNode.push(args); },
    getLeafForOpeningFile: () => ({ id: "work-leaf", openFile: async () => {} }),
    getLinkedResearchFolder: () => null,
    setLinkedResearchFolder: async () => {},
    removeLinkedResearchFolder: async () => {},
    dragState: null,
  };
  const view = new FeuilletsView({
    app: {
      vault: makeVault(allFiles),
      workspace: {
        setActiveLeaf: () => {},
        getLeaf: (kind, dir) => ({ id: `leaf-${kind || "default"}-${dir || ""}`, openFile: async () => {} }),
        revealLeaf: async () => {},
      },
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = (...args) => calls.attachDragHandlers.push(args);
  view.updateActiveHighlight = () => {};
  if (binderWorkingRootPath) view.plugin.workspaceFolderPath = binderWorkingRootPath;

  return { view, contentEl, plugin, settings, root, articles, blog, y2025, y2026, brouillons, newsletter, articleA, articleB, calls };
}

/* --- §38-39 : dispatch de mode + hiérarchie --- */

test("binderLayout=tree : aucun .feuillets-split, renderHierarchyBody classique", async () => {
  const { view, contentEl } = createSplitFixture({ settingsOverrides: { binderLayout: "tree" } });
  await view.render(true);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-split")).length, 0);
  assert.ok(findAll(contentEl, (el) => el.classes.has("feuillets-list")).length >= 1);
});

test("binderLayout=split : split + treePane + resizer + listPane", async () => {
  const { view, contentEl } = createSplitFixture();
  await view.render(true);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-split")).length, 1);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane")).length, 1);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-split-resizer")).length, 1);
  assert.equal(findAll(contentEl, (el) => el.classes.has("feuillets-list-pane")).length, 1);
});

test("le nom de la racine réelle (NEFES) apparaît à gauche, jamais MANUSCRIPT", async () => {
  const { view, contentEl } = createSplitFixture();
  await view.render(true);
  const rootRow = findAll(contentEl, (el) => el.classes.has("feuillets-tree-root"))[0];
  assert.ok(rootRow);
  const rootName = findAll(rootRow, (el) => el.classes.has("feuillets-folder-name"))[0];
  assert.equal(rootName.text, "NEFES");
  const names = findAll(contentEl, (el) => el.classes.has("feuillets-folder-name")).map((el) => el.text);
  assert.ok(!names.includes("MANUSCRIPT"));
  assert.ok(!names.includes("Manuscrit"));
});

test("dossiers frères de même profondeur ; un sous-dossier imbriqué est seul indenté davantage", async () => {
  const { view, contentEl } = createSplitFixture();
  await view.render(true);
  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const rows = findAll(treePane, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"));
  const byName = (name) => rows.find((r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === name);
  const front = byName("Front");
  const elH = byName("El Hamdulillah");
  const allahu = byName("Allahu Ekber");
  const chapitreX = byName("Chapitre X");
  assert.ok(front && elH && allahu && chapitreX);
  assert.equal(front.style.paddingLeft, elH.style.paddingLeft);
  assert.equal(elH.style.paddingLeft, allahu.style.paddingLeft);
  assert.notEqual(chapitreX.style.paddingLeft, elH.style.paddingLeft);
});

/* --- §40 : master/detail --- */

test("sélectionner un dossier gauche pilote le volet droit, sans Continu ni isolation", async () => {
  const { view, contentEl, settings, calls } = createSplitFixture();
  let openFolderInContinuCalled = false;
  let isolateFolderCalled = false;
  view.openFolderInContinu = async () => { openFolderInContinuCalled = true; };
  view.isolateFolder = () => { isolateFolderCalled = true; };
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const rows = findAll(treePane, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"));
  const elHRow = rows.find((r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === "El Hamdulillah");
  view.render = async () => {};
  elHRow.events.get("click")({ stopPropagation() {} });
  await flush();

  assert.equal(settings.binderSelectedPath, "NEFES/El Hamdulillah");
  assert.equal(openFolderInContinuCalled, false);
  assert.equal(isolateFolderCalled, false);
  assert.deepEqual(calls.moveNode, []);
});

test("volet droit liste le contenu du dossier sélectionné (renderFileRow 2.5)", async () => {
  const { view, contentEl, plugin, settings, feuillet1, feuillet2 } = createSplitFixture({
    settingsOverrides: { binderSelectedPath: "NEFES", binderSplitRecursive: false },
  });
  plugin.workspaceFolderPath = "NEFES/El Hamdulillah";
  await view.render(true);
  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  const items = findAll(listPane, (el) => el.classes.has("feuillets-item"));
  const paths = items.map((el) => el.attrs["data-path"]);
  assert.ok(paths.includes(feuillet1.path));
  assert.ok(paths.includes(feuillet2.path));
  assert.equal(settings.binderSelectedPath, "NEFES", "binderSelectedPath reste distinct du workspace actif");
});

/* --- §30 : un seul moteur Binder — plus de renderFilesOf --- */

test("renderFilesOf n'existe plus dans la vue (une seule source, feuillets-view.ts)", async () => {
  const path = (await import("node:path")).join(process.cwd(), "src/views/feuillets-view.ts");
  const src = await (await import("node:fs/promises")).readFile(path, "utf8");
  assert.equal(src.includes("renderFilesOf"), false, "renderFilesOf a été retiré (moteur partagé renderHierarchyContents)");
});

/* --- §31 : Blog — le dossier choisi n'est pas répété à droite, profondeur locale --- */

test("Blog choisi à gauche : Blog n'est pas répété à droite, 2025/2026/Brouillons à profondeur locale 0", async () => {
  const { view, contentEl, plugin, blog } = createBlogFixture();
  plugin.workspaceFolderPath = blog.path;
  await view.render(true);

  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  const rightFolderRows = findAll(listPane, (el) => el.classes.has("feuillets-folder-row"));
  const rightNames = rightFolderRows.map((r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text);

  assert.ok(!rightNames.includes("Blog"), "Blog lui-même n'est jamais répété à droite");
  assert.ok(rightNames.includes("2025"));
  assert.ok(rightNames.includes("2026"));
  assert.ok(rightNames.includes("Brouillons"));

  const depthOf = (name) => {
    const row = rightFolderRows.find((r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === name);
    return row.style._props["--feuillets-binder-depth"];
  };
  assert.equal(depthOf("2025"), "0");
  assert.equal(depthOf("2026"), "0");
  assert.equal(depthOf("Brouillons"), "0");
});

test("workspace imbriqué : la Library reste globale et le volet droit reste local", async () => {
  const { view, contentEl, plugin, y2026, articleA, articleB } = createBlogFixture();
  plugin.workspaceFolderPath = y2026.path;
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const globalNames = findAll(treePane, (el) => el.classes.has("feuillets-folder-name")).map((el) => el.text);
  assert.ok(globalNames.includes("Blog"));
  assert.ok(globalNames.includes("2026"));

  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  const rightItems = findAll(listPane, (el) => el.classes.has("feuillets-item")).map((el) => el.attrs["data-path"]);
  assert.deepEqual(rightItems, [articleA.path, articleB.path]);
  assert.equal(findAll(listPane, (el) => el.classes.has("feuillets-folder-row")).length, 0);
});

/* --- §32 : sous-dossier à droite = vraie ligne Binder 2.5 --- */

test("2026 à droite : chevron replie, clic ouvre en Continu, double-clic isole, menu contextuel 2.5", async () => {
  const { view, contentEl, y2026 } = createBlogFixture();
  let openFolderInContinuCalled = null;
  let isolateFolderCalled = null;
  view.openFolderInContinu = async (f) => { openFolderInContinuCalled = f; };
  view.isolateFolder = (f) => { isolateFolderCalled = f; };
  view.showFolderContextMenu = () => { view._menuShown = true; };
  await view.render(true);

  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  const row2026 = findAll(listPane, (el) => el.classes.has("feuillets-folder-row")).find(
    (r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === "2026"
  );
  assert.ok(row2026, "2026 est une vraie ligne dossier Binder 2.5 à droite");

  row2026.events.get("click")({ preventDefault() {}, stopPropagation() {} });
  await flushClickDelay();
  assert.equal(openFolderInContinuCalled, y2026);

  row2026.events.get("dblclick")({ preventDefault() {} });
  assert.equal(isolateFolderCalled, y2026);

  row2026.events.get("contextmenu")({ preventDefault() {} });
  assert.ok(view._menuShown, "showFolderContextMenu 2.5 appelé");
});

/* --- §33/§34 : sous-dossier à gauche = navigation, chevron = repli seul --- */

test("2026 à gauche : sélectionne le displayRoot, ne touche pas workingRoot, jamais de Continu", async () => {
  const { view, contentEl, settings, y2026 } = createBlogFixture();
  let openFolderInContinuCalled = false;
  view.openFolderInContinu = async () => { openFolderInContinuCalled = true; };
  view.isolateFolder = () => { throw new Error("ne doit jamais isoler"); };
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const row2026 = findAll(treePane, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root")).find(
    (r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === "2026"
  );
  view.render = async () => {};
  row2026.events.get("click")();
  await flush();

  assert.equal(settings.binderSelectedPath, y2026.path);
  assert.equal(openFolderInContinuCalled, false);
});

test("micro-correctif : aucun chevron dans la Library gauche", async () => {
  const { view, contentEl } = createBlogFixture();
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  // §37/Vault : le mini-navigateur Vault (feuillets-binder-research-row)
  // garde volontairement son propre chevron — seuls les dossiers du
  // manuscrit (arbre projet) en sont dépouillés ici.
  const childRows = findAll(
    treePane,
    (el) =>
      el.classes.has("feuillets-folder-row") &&
      !el.classes.has("feuillets-tree-root") &&
      !el.classes.has("feuillets-binder-research-row")
  );
  for (const row of childRows) {
    const chevrons = findAll(row, (el) => el.classes.has("feuillets-cell-icon"));
    assert.equal(chevrons.length, 0, "plus aucun chevron sur une ligne de dossier de la Library gauche");
  }
});

test("clic Blog à gauche : sélectionne Blog et le déplie (a des sous-dossiers)", async () => {
  const { view, contentEl, settings, blog } = createBlogFixture();
  let openFolderInContinuCalled = false;
  view.openFolderInContinu = async () => { openFolderInContinuCalled = true; };
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const blogRow = findAll(treePane, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root")).find(
    (r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === "Blog"
  );
  assert.equal(settings.collapsed[blog.path], undefined, "Blog déplié par défaut");
  view.render = async () => {};
  blogRow.events.get("click")();
  await flush();

  assert.equal(settings.binderSelectedPath, blog.path, "le clic sélectionne Blog comme displayRoot");
  assert.equal(settings.collapsed[blog.path], true, "le premier clic déplie→replie l'état initial (déplié par défaut, donc replie)");
  assert.equal(openFolderInContinuCalled, false);
});

test("second clic Blog à gauche : replie sans changer la sélection", async () => {
  const { view, contentEl, settings, blog } = createBlogFixture({
    settingsOverrides: { binderSelectedPath: "Projet/Blog", collapsed: {} },
  });
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const blogRow = findAll(treePane, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root")).find(
    (r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === "Blog"
  );
  view.render = async () => {};

  // 1er clic : Blog était déplié (collapsed absent) → replie.
  blogRow.events.get("click")();
  await flush();
  assert.equal(settings.collapsed[blog.path], true);
  assert.equal(settings.binderSelectedPath, blog.path);

  // 2nd clic : Blog était replié → déplie à nouveau, sélection inchangée.
  blogRow.events.get("click")();
  await flush();
  assert.equal(settings.collapsed[blog.path], undefined);
  assert.equal(settings.binderSelectedPath, blog.path, "la sélection ne bouge jamais au clic sur le même dossier");
});

test("clic dossier gauche (2026, sans sous-dossier) : active le workspace, sans Continu ni isolation", async () => {
  const { view, contentEl, settings, y2026 } = createBlogFixture();
  let openFolderInContinuCalled = false;
  let isolateFolderCalled = false;
  view.openFolderInContinu = async () => { openFolderInContinuCalled = true; };
  view.isolateFolder = () => { isolateFolderCalled = true; };
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const row2026 = findAll(treePane, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root")).find(
    (r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === "2026"
  );
  view.render = async () => {};
  row2026.events.get("click")();
  await flush();

  assert.equal(settings.binderSelectedPath, y2026.path);
  assert.equal(settings.collapsed[y2026.path], undefined, "2026 n'a pas de sous-dossier : rien à replier");
  assert.equal(openFolderInContinuCalled, false);
  assert.equal(isolateFolderCalled, false);
  assert.equal(view.plugin.workspaceFolderPath, y2026.path, "le clic gauche active le scope partagé");
});

/* --- §37 : Library gauche sans icône folder/folder-open --- */

test("aucune icône folder/folder-open sur les dossiers enfants de la Library gauche", async () => {
  const { view, contentEl } = createBlogFixture();
  await view.render(true);
  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const childRows = findAll(treePane, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"));
  for (const row of childRows) {
    const icons = findAll(row, (el) => el.icon === "folder" || el.icon === "folder-open");
    assert.equal(icons.length, 0, "pas d'icône folder/folder-open dans la Library gauche");
  }
});

/* --- §38 : isolation réelle depuis le volet droit --- */

test("double-clic sur 2026 à droite active le workspace sans réduire la Library globale", async () => {
  const { view, contentEl, settings, blog, y2026 } = createBlogFixture();
  await view.render(true);
  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  const row2026 = findAll(listPane, (el) => el.classes.has("feuillets-folder-row")).find(
    (r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === "2026"
  );
  view.render = async () => {};
  row2026.events.get("dblclick")({ preventDefault() {} });
  await flush();

  assert.equal(view.plugin.workspaceFolderPath, y2026.path);

  await FeuilletsView.prototype.render.call(view, true);
  const rootRow = findAll(contentEl, (el) => el.classes.has("feuillets-tree-root"))[0];
  const backIcon = findAll(rootRow, (el) => el.icon === "files")[0];
  assert.equal(backIcon, undefined, "la Library reste globale et n'affiche pas de retour d'isolation");
  assert.equal(settings.binderSelectedPath, blog.path, "binderSelectedPath reste inchangé par l'isolation elle-même");
});

/* --- §41 : "+" et drag --- */

test('le "+" racine propose Nouveau dossier… et Importer un plan…', async () => {
  const { view, contentEl, calls, root } = createSplitFixture();
  await view.render(true);
  const rootRow = findAll(contentEl, (el) => el.classes.has("feuillets-tree-root"))[0];
  const addBtn = findAll(rootRow, (el) => el.classes.has("feuillets-folder-add"))[0];
  assert.ok(addBtn);

  const menus = [];
  const original = Menu.prototype.showAtMouseEvent;
  Menu.prototype.showAtMouseEvent = function () { menus.push(this); };
  try {
    addBtn.events.get("click")({ preventDefault() {}, stopPropagation() {} });
    const menu = menus[0];
    menu.items.find((i) => i.title === t("binder.newFolder")).callback();
    assert.deepEqual(calls.newFolder, [root]);
    assert.ok(menu.items.some((i) => i.title === t("binder.importOutline")));
  } finally {
    Menu.prototype.showAtMouseEvent = original;
  }
});

test('le "+" d\'un dossier propose Nouveau sous-dossier… et Nouveau feuillet ici (sélectionne puis newSheet)', async () => {
  const { view, contentEl, calls, elHamdulillah, settings } = createSplitFixture();
  view.render = async () => {};
  await FeuilletsView.prototype.render.call(view, true);
  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const rows = findAll(treePane, (el) => el.classes.has("feuillets-folder-row") && !el.classes.has("feuillets-tree-root"));
  const elHRow = rows.find((r) => findAll(r, (el) => el.classes.has("feuillets-folder-name"))[0]?.text === "El Hamdulillah");
  const addBtn = findAll(elHRow, (el) => el.classes.has("feuillets-folder-add"))[0];

  const menus = [];
  const original = Menu.prototype.showAtMouseEvent;
  Menu.prototype.showAtMouseEvent = function () { menus.push(this); };
  try {
    addBtn.events.get("click")({ preventDefault() {}, stopPropagation() {} });
    const menu = menus[0];
    menu.items.find((i) => i.title === t("binder.newSubfolder")).callback();
    assert.deepEqual(calls.newFolder, [elHamdulillah]);

    menu.items.find((i) => i.title === t("binder.newSheetHere")).callback();
    await flush();
    assert.equal(settings.binderSelectedPath, elHamdulillah.path);
    assert.deepEqual(calls.newSheet, [elHamdulillah]);
  } finally {
    Menu.prototype.showAtMouseEvent = original;
  }
});

test("les dossiers du volet gauche utilisent le moteur de drag existant (attachDragHandlers)", async () => {
  const { view, calls } = createSplitFixture();
  await view.render(true);
  assert.ok(calls.attachDragHandlers.length >= 4, "un appel attachDragHandlers par dossier rendu");
});

/* --- §42 : largeur / toolbar --- */

/* --- §2/§36 : UN SEUL bouton de vue (columns-2), plus de bouton `list` --- */

test("un clic sur l'unique bouton columns-2 bascule binderLayout et rappelle adjustSidebarWidth", async () => {
  const { view, settings, calls } = createSplitFixture({ settingsOverrides: { binderLayout: "tree" } });
  let buttons = [];
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    buttons.push(button);
    return button;
  };
  view.render = async () => {};

  for (let i = 0; i < 3; i++) {
    buttons = [];
    await FeuilletsView.prototype.render.call(view, true);
    calls.adjustSidebarWidth = 0;
    assert.equal(buttons.filter((b) => b.icon === "columns-2").length, 1, "un seul bouton de mode");
    assert.equal(buttons.find((b) => b.icon === "list"), undefined, "aucun bouton list dédié à la vue simple");
    buttons.find((b) => b.icon === "columns-2").events.get("click")();
    await flush();
    assert.equal(settings.binderLayout, "split");
    assert.ok(calls.adjustSidebarWidth >= 1, "adjustSidebarWidth rappelé immédiatement au moins une fois");

    buttons = [];
    await FeuilletsView.prototype.render.call(view, true);
    calls.adjustSidebarWidth = 0;
    buttons.find((b) => b.icon === "columns-2").events.get("click")();
    await flush();
    assert.equal(settings.binderLayout, "tree");
    assert.ok(calls.adjustSidebarWidth >= 1);
  }
});

test("main.ts adjustSidebarWidth() : 250 en simple, 380 en double, sans dérive sur plusieurs cycles", async () => {
  const { default: FeuilletsPlugin } = await import("../src/main.js");
  const { VIEW_SIDEBAR } = await import("../src/constants.js");
  const sizes = [];
  const leftSplit = { collapsed: false, setSize(w) { sizes.push(w); } };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = {
    workspace: {
      leftSplit,
      rightSplit: { collapsed: true, setSize() {} },
      getLeavesOfType: (type) => (type === VIEW_SIDEBAR ? [{}] : []),
    },
  };
  plugin.settings = { binderLayout: "tree" };

  for (let i = 0; i < 3; i++) {
    plugin.settings.binderLayout = "split";
    plugin.adjustSidebarWidth();
    plugin.settings.binderLayout = "tree";
    plugin.adjustSidebarWidth();
  }

  assert.equal(sizes.length, 6);
  assert.ok(sizes.every((w, i) => w === (i % 2 === 0 ? 380 : 250)), "alterne 380/250 sans dérive : " + sizes.join(","));
});

test("bouton de mode unique : columns-2, feuillets-mode-active seulement en double ; rows-3 reste Densité ; aucune icône download", async () => {
  const { view } = createSplitFixture({ settingsOverrides: { binderLayout: "tree" } });
  const buttons = [];
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    button.classes = new Set();
    button.addClass = (c) => button.classes.add(c);
    if (onClick) button.addEventListener("click", onClick);
    buttons.push(button);
    return button;
  };
  await view.render(true);
  const icons = buttons.map((b) => b.icon);
  assert.equal(icons.filter((i) => i === "columns-2").length, 1, "une seule icône columns-2");
  assert.equal(icons.includes("list"), false, "aucun bouton list dédié à la vue simple");
  assert.ok(icons.includes("rows-3"), "Densité reste rows-3");
  assert.equal(icons.includes("download"), false);

  const splitBtn = buttons.find((b) => b.icon === "columns-2");
  assert.ok(!splitBtn.classes.has("feuillets-mode-active"));
});

/* --- §43-44 : Vault repliable --- */

test("Vault replié par défaut au premier binder:vault:true, ses enfants apparaissent au clic puis disparaissent au second", async () => {
  const doc = new TFolder("Documentation");
  doc.children = [];
  const { view, contentEl, settings } = createSplitFixture({
    vaultChildren: [doc],
    settingsOverrides: { collapsed: { "binder:vault": true } },
  });
  await view.render(true);
  let vaultNames = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).map((el) =>
    findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text
  );
  assert.ok(vaultNames.includes(t("binder.vault.label")));
  assert.ok(!vaultNames.includes("Documentation"), "Vault replié : aucun enfant visible");

  const vaultRow = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-root"))[0];
  view.render = async () => {};
  vaultRow.events.get("click")();
  await flush();
  assert.equal(settings.collapsed["binder:vault"], undefined);

  await FeuilletsView.prototype.render.call(view, true);
  vaultNames = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).map((el) =>
    findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text
  );
  assert.ok(vaultNames.includes("Documentation"), "Vault déplié : ses enfants directs apparaissent");
});

test("un dossier Vault utilise sa propre clé binder:vault:<chemin>, jamais S.collapsed[chemin] brut", async () => {
  const doc = new TFolder("Documentation");
  const sub = new TFolder("Documentation/Soufisme");
  sub.children = [];
  doc.children = [sub];
  const { view, contentEl, settings } = createSplitFixture({
    vaultChildren: [doc],
    settingsOverrides: { collapsed: {} },
  });
  await view.render(true);
  const docRow = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).find(
    (el) => findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text === "Documentation"
  );
  view.render = async () => {};
  docRow.events.get("click")();
  await flush();
  assert.equal(settings.collapsed["binder:vault:Documentation"], false, "premier clic : déplié (défaut replié)");
  assert.equal(settings.collapsed["Documentation"], undefined, "jamais la clé brute du dossier");
});

/* --- §44 : fichiers Vault --- */

test("clic simple sur un fichier Vault l'ouvre dans la leaf de travail sans toucher binderSelectedPath", async () => {
  const note = new TFile("Documentation/Notice.md");
  note.basename = "Notice";
  const doc = new TFolder("Documentation");
  doc.children = [note];
  const { view, contentEl, settings } = createSplitFixture({
    vaultChildren: [doc],
    settingsOverrides: { collapsed: {} },
  });
  await view.render(true);
  view.render = async () => {};
  const docRow = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).find(
    (el) => findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text === "Documentation"
  );
  docRow.events.get("click")();
  await flush();
  await FeuilletsView.prototype.render.call(view, true);

  const fileRow = findAll(contentEl, (el) => el.classes.has("feuillets-item") && el.classes.has("feuillets-binder-research-row"))[0];
  assert.ok(fileRow, "le fichier Vault est bien rendu");
  const before = settings.binderSelectedPath;
  fileRow.events.get("click")();
  assert.equal(settings.binderSelectedPath, before, "binderSelectedPath inchangé");
});

test("menu ⋯ d'un fichier Vault : Ouvrir / nouvel onglet / côte à côte, aucune administration", async () => {
  const note = new TFile("Documentation/Notice.md");
  note.basename = "Notice";
  const doc = new TFolder("Documentation");
  doc.children = [note];
  const { view, contentEl } = createSplitFixture({
    vaultChildren: [doc],
    settingsOverrides: { collapsed: {} },
  });
  await view.render(true);
  const docRow = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).find(
    (el) => findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text === "Documentation"
  );
  view.render = async () => {};
  docRow.events.get("click")();
  await flush();
  await FeuilletsView.prototype.render.call(view, true);

  const fileRow = findAll(contentEl, (el) => el.classes.has("feuillets-item") && el.classes.has("feuillets-binder-research-row"))[0];
  const actionsBtn = findAll(fileRow, (el) => el.attrs["aria-label"] === t("binder.vault.fileActions"))[0];
  const menus = [];
  const original = Menu.prototype.showAtMouseEvent;
  Menu.prototype.showAtMouseEvent = function () { menus.push(this); };
  try {
    actionsBtn.events.get("click")({ stopPropagation() {} });
    const titles = menus[0].items.map((i) => i.title);
    assert.deepEqual(titles, [t("binder.vault.open"), t("binder.research.openNewTab"), t("binder.research.openSplit")]);
  } finally {
    Menu.prototype.showAtMouseEvent = original;
  }
});

/* --- §45 : Vault → Recherche --- */

test("clic droit sur un dossier Vault non lié : Utiliser comme dossier Recherche appelle setLinkedResearchFolder(selectedFolder, vaultFolder)", async () => {
  const soufisme = new TFolder("Documentation/Soufisme");
  soufisme.children = [];
  const doc = new TFolder("Documentation");
  doc.children = [soufisme];
  const selectedPath = "NEFES/El Hamdulillah";
  const { view, contentEl, calls, plugin } = createSplitFixture({
    vaultChildren: [doc],
    settingsOverrides: { binderSelectedPath: selectedPath, collapsed: {} },
  });
  plugin.workspaceFolderPath = selectedPath;
  await view.render(true);
  const docRow = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).find(
    (el) => findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text === "Documentation"
  );
  view.render = async () => {};
  docRow.events.get("click")();
  await flush();
  await FeuilletsView.prototype.render.call(view, true);

  const soufismeRow = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).find(
    (el) => findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text === "Soufisme"
  );
  const menus = [];
  const original = Menu.prototype.showAtMouseEvent;
  Menu.prototype.showAtMouseEvent = function () { menus.push(this); };
  try {
    soufismeRow.events.get("contextmenu")({ preventDefault() {} });
    const menu = menus[0];
    assert.equal(menu.items.length, 1);
    assert.equal(menu.items[0].title, t("binder.vault.useAsResearch"));
    menu.items[0].callback();
    await flush();
    assert.equal(calls.setLinkedResearchFolder.length, 1);
    assert.equal(calls.setLinkedResearchFolder[0][0].path, selectedPath);
    assert.equal(calls.setLinkedResearchFolder[0][1].path, soufisme.path);
    assert.deepEqual(calls.newFolder, []);
    assert.deepEqual(calls.moveNode, []);
  } finally {
    Menu.prototype.showAtMouseEvent = original;
  }
});

test("clic droit sur un dossier Vault déjà lié : Retirer le dossier Recherche associé appelle removeLinkedResearchFolder", async () => {
  const soufisme = new TFolder("Documentation/Soufisme");
  soufisme.children = [];
  const doc = new TFolder("Documentation");
  doc.children = [soufisme];
  const selectedPath = "NEFES/El Hamdulillah";
  const { view, contentEl, calls, plugin } = createSplitFixture({
    vaultChildren: [doc],
    settingsOverrides: { binderSelectedPath: selectedPath, collapsed: {} },
  });
  plugin.workspaceFolderPath = selectedPath;
  plugin.getLinkedResearchFolder = (node) => (node.path === selectedPath ? soufisme : null);
  await view.render(true);
  const docRow = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).find(
    (el) => findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text === "Documentation"
  );
  view.render = async () => {};
  docRow.events.get("click")();
  await flush();
  await FeuilletsView.prototype.render.call(view, true);

  const soufismeRow = findAll(contentEl, (el) => el.classes.has("feuillets-binder-research-row")).find(
    (el) => findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text === "Soufisme"
  );
  const menus = [];
  const original = Menu.prototype.showAtMouseEvent;
  Menu.prototype.showAtMouseEvent = function () { menus.push(this); };
  try {
    soufismeRow.events.get("contextmenu")({ preventDefault() {} });
    const menu = menus[0];
    assert.equal(menu.items.length, 1);
    assert.equal(menu.items[0].title, t("binder.vault.removeResearchLink"));
    menu.items[0].callback();
    await flush();
    assert.equal(calls.removeLinkedResearchFolder.length, 1);
    assert.equal(calls.removeLinkedResearchFolder[0][0].path, selectedPath);
  } finally {
    Menu.prototype.showAtMouseEvent = original;
  }
});

/* --- §36/§47 : Export rapide reste retiré --- */

test("aucune trace d'Export rapide Binder (icône download, réglages binderQuickExport*)", async () => {
  const { view } = createSplitFixture();
  const buttons = [];
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    buttons.push(button);
    return button;
  };
  await view.render(true);
  assert.equal(buttons.find((b) => b.icon === "download"), undefined);
});

/* --- §48 : restauration Recherche + Versions dans la double vue (e2570de) --- */

test("double vue : sections Recherche puis Versions puis Coffre, dans cet ordre, dans le volet gauche", async () => {
  const researchRoot = new TFolder("NEFES/_Recherche");
  researchRoot.children = [];
  const versionsRoot = new TFolder("NEFES/_Versions");
  const versionFile = new TFile("NEFES/_Versions/Version A.md");
  versionsRoot.children = [versionFile];
  const { view, contentEl, plugin, settings, root } = createSplitFixture({ researchRoot, versionsRoot });
  plugin.shortTitleFor = (f) => `SHORT-${f.basename}`;
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const rootSections = findAll(treePane, (el) => el.classes.has("feuillets-binder-research-root"));
  const names = rootSections.map((r) => findAll(r, (n) => n.classes.has("feuillets-folder-name"))[0]?.text);
  assert.deepEqual(names, ["Recherche", "Versions", "Vault"], "Manuscrit → Recherche → Versions → Coffre");

  // Icônes : search par défaut pour Recherche, history pour Versions.
  assert.ok(findAll(rootSections[0], (el) => el.icon === "search").length > 0, "icône search pour Recherche");
  assert.ok(findAll(rootSections[1], (el) => el.icon === "history").length > 0, "icône history pour Versions");

  // Labels des fichiers Versions via shortTitleFor (jamais titleFor).
  const versionItemNames = findAll(treePane, (el) => el.classes.has("feuillets-item")).map((el) =>
    findAll(el, (n) => n.classes.has("feuillets-item-name"))[0]?.text
  );
  assert.deepEqual(versionItemNames, ["SHORT-Version A"], "labels fichiers Versions via shortTitleFor");

  // Le simple rendu des sections ne touche jamais la sélection Binder.
  assert.equal(settings.binderSelectedPath, root.path, "binderSelectedPath inchangé par le rendu");
});

test("double vue : racines Recherche/Versions absentes = seul le Coffre reste, comportement inchangé", async () => {
  const { view, contentEl } = createSplitFixture();
  await view.render(true);
  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const rootSections = findAll(treePane, (el) => el.classes.has("feuillets-binder-research-root"));
  const names = rootSections.map((r) => findAll(r, (n) => n.classes.has("feuillets-folder-name"))[0]?.text);
  assert.deepEqual(names, ["Vault"], "seul le Coffre reste quand getResearchRoot/getVersionsRoot renvoient null");
});

/* --- §49 : projection des dossiers associés (getLinkedResearchFolders) dans
   la section Recherche de la double vue. --- */

/** Noms (dans l'ordre du DOM) de toutes les lignes de la zone Recherche du
 * volet gauche — sections racines (Recherche/Versions/Coffre), enfants
 * internes, dossiers associés externes et lignes Coffre. */
function researchRowNames(treePane) {
  return findAll(treePane, (el) => el.classes.has("feuillets-binder-research-row")).map((row) => {
    const name =
      findAll(row, (el) => el.classes.has("feuillets-folder-name"))[0] ??
      findAll(row, (el) => el.classes.has("feuillets-item-name"))[0];
    return name ? name.text : "";
  });
}

test("double vue : la section Recherche projette un dossier associé externe après la racine interne (icône link)", async () => {
  const researchRoot = new TFolder("NEFES/_Recherche");
  researchRoot.children = [new TFolder("NEFES/_Recherche/essai")];
  const externe = new TFolder("Vault/CÉRÉMONIES");
  externe.children = [];
  const { view, contentEl } = createSplitFixture({
    researchRoot,
    linkedResearch: [{ folder: externe, binderNodes: [] }],
  });
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const names = researchRowNames(treePane);
  assert.ok(names.includes("Recherche"), "racine Recherche interne toujours là");
  assert.ok(names.includes("essai"), "enfant interne de la racine Recherche toujours là");
  assert.ok(names.includes("CÉRÉMONIES"), "dossier associé externe projété dans Recherche");
  assert.ok(
    names.indexOf("CÉRÉMONIES") > names.indexOf("Recherche") &&
      names.indexOf("CÉRÉMONIES") < names.indexOf("Vault"),
    "le dossier externe apparaît entre la racine Recherche et le Coffre"
  );

  // Distinction visuelle discrète : icône link native sur la ligne du
  // dossier externe uniquement.
  const extRow = findAll(treePane, (el) =>
    el.classes.has("feuillets-binder-research-row") &&
    findAll(el, (n) => n.classes.has("feuillets-folder-name"))[0]?.text === "CÉRÉMONIES"
  )[0];
  assert.ok(extRow, "ligne du dossier associé externe présente");
  assert.ok(findAll(extRow, (el) => el.icon === "link").length > 0, "icône link sur le dossier externe");
});

test("double vue : un dossier associé externe ne devient jamais un élément du volet droit (Binder)", async () => {
  const researchRoot = new TFolder("NEFES/_Recherche");
  researchRoot.children = [];
  const externe = new TFolder("Vault/CÉRÉMONIES");
  externe.children = [];
  const { view, contentEl } = createSplitFixture({
    researchRoot,
    linkedResearch: [{ folder: externe, binderNodes: [] }],
  });
  await view.render(true);

  const listPane = findAll(contentEl, (el) => el.classes.has("feuillets-list-pane"))[0];
  assert.ok(listPane, "volet droit présent");
  const rightNames = findAll(listPane, (el) => el.classes.has("feuillets-folder-name") || el.classes.has("feuillets-item-name")).map((el) => el.text);
  assert.ok(!rightNames.includes("CÉRÉMONIES"), "le dossier externe n'apparaît pas dans le volet droit");
  assert.ok(rightNames.includes("Front"), "le volet droit rend bien le contenu Binder normal (enfants du dossier sélectionné)");
});

test("double vue : un dossier associé déjà contenu dans la racine Recherche n'est pas dupliqué", async () => {
  const researchRoot = new TFolder("NEFES/_Recherche");
  const sources = new TFolder("NEFES/_Recherche/Sources");
  researchRoot.children = [sources];
  const { view, contentEl } = createSplitFixture({
    researchRoot,
    linkedResearch: [{ folder: sources, binderNodes: [] }],
  });
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const count = researchRowNames(treePane).filter((n) => n === "Sources").length;
  assert.equal(count, 1, "Sources n'apparaît qu'une fois : rendu interne seul, pas de projection dupliquée");
});

test("double vue : un dossier associé égal à la racine Recherche n'est pas dupliqué", async () => {
  const researchRoot = new TFolder("NEFES/_Recherche");
  researchRoot.children = [];
  const { view, contentEl } = createSplitFixture({
    researchRoot,
    linkedResearch: [{ folder: researchRoot, binderNodes: [] }],
  });
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const count = researchRowNames(treePane).filter((n) => n === "Recherche").length;
  assert.equal(count, 1, "la racine Recherche n'apparaît qu'une seule fois");
});

test("double vue : le dossier associé externe reste aussi visible dans le Coffre à son emplacement réel", async () => {
  const researchRoot = new TFolder("NEFES/_Recherche");
  researchRoot.children = [];
  const externe = new TFolder("Vault/CÉRÉMONIES");
  externe.children = [];
  const { view, contentEl } = createSplitFixture({
    researchRoot,
    linkedResearch: [{ folder: externe, binderNodes: [] }],
    vaultChildren: [externe],
  });
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const count = researchRowNames(treePane).filter((n) => n === "CÉRÉMONIES").length;
  assert.equal(count, 2, "une fois sous Recherche (associé) et une fois sous Coffre (emplacement physique), rien de masqué");
});

test("double vue : sans dossier associé, la section Recherche reste strictement identique", async () => {
  const researchRoot = new TFolder("NEFES/_Recherche");
  researchRoot.children = [new TFolder("NEFES/_Recherche/essai")];
  const { view, contentEl } = createSplitFixture({ researchRoot });
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  assert.deepEqual(
    researchRowNames(treePane),
    ["Recherche", "essai", "Vault"],
    "racine interne + ses enfants uniquement, aucun enfant supplémentaire"
  );
});

test("double vue : ordre général toujours Manuscrit → Recherche → Versions → Coffre", async () => {
  const researchRoot = new TFolder("NEFES/_Recherche");
  researchRoot.children = [];
  const versionsRoot = new TFolder("NEFES/_Versions");
  versionsRoot.children = [];
  const { view, contentEl } = createSplitFixture({ researchRoot, versionsRoot });
  await view.render(true);

  const treePane = findAll(contentEl, (el) => el.classes.has("feuillets-tree-pane"))[0];
  const allNames = findAll(treePane, (el) => el.classes.has("feuillets-folder-name")).map((el) => el.text);
  const iManuscrit = allNames.indexOf("Front");
  const iRecherche = allNames.indexOf("Recherche");
  const iVersions = allNames.indexOf("Versions");
  const iVault = allNames.indexOf("Vault");
  assert.ok(iManuscrit >= 0 && iRecherche >= 0 && iVersions >= 0 && iVault >= 0, "les quatre sections sont présentes");
  assert.ok(iManuscrit < iRecherche && iRecherche < iVersions && iVersions < iVault, "Manuscrit → Recherche → Versions → Coffre");
});
