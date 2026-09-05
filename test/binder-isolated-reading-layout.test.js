import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

/* LOT "binder isolé + simplification cartes/plan", §1-4/§26 : le Binder
 * isolé (`_binderWorkingRootPath` pointant sur un sous-dossier) réutilise
 * EXACTEMENT l'état `isIsolated` déjà calculé dans renderHierarchyBody —
 * aucune nouvelle préférence, aucune donnée modifiée. La seule différence
 * avec le Binder normal est visuelle : les lignes FICHIER (`.feuillets-item`)
 * perdent leur icône de type et leur colonne chevron réservée, et la
 * profondeur ne consomme plus de largeur (masquage/CSS via
 * `.feuillets-binder-isolated`, voir styles.css). Les vrais dossiers
 * conservent chevron/icône/indentation dans les deux cas.
 *
 * Même harnais minimal que test/binder-minimal-rendering.test.js. */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle) };

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
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
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

function findAll(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findAll(child, predicate));
  }
  return found;
}

function baseSettings(overrides = {}) {
  return {
    projectFolder: "",
    projects: [],
    projectMeta: {},
    binderLayout: "tree",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    binderShowLabels: true,
    binderShowTags: true,
    binderShowStatus: true,
    binderShowProgress: true,
    binderShowWords: true,
    listPanePreviewField: "synopsis",
    listPanePreviewLines: 2,
    ...overrides,
  };
}

/* root (Roman/Manuscrit)
 *  ├── A.md
 *  ├── B.md
 *  └── Chapitre 1/  (sous-dossier réel, conservé structuré même isolé)
 *       └── C.md
 */
function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md");
  const b = new TFile("Roman/Manuscrit/B.md");
  a.basename = "A";
  b.basename = "B";

  const sub = new TFolder("Roman/Manuscrit/Chapitre 1");
  const c = new TFile("Roman/Manuscrit/Chapitre 1/C.md");
  c.basename = "C";
  sub.children = [c];
  c.parent = sub;

  root.children = [a, b, sub];
  a.parent = root;
  b.parent = root;
  sub.parent = root;

  return { root, a, b, sub, c };
}

function buildView(fixture, settingsOverrides = {}) {
  const { root } = fixture;
  const settings = baseSettings({ projectFolder: root.path, binderSelectedPath: root.path, ...settingsOverrides });
  const contentEl = new FakeElement();
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: {} };

  const byPath = new Map();
  const register = (f) => byPath.set(f.path, f);
  register(fixture.root);
  register(fixture.sub);

  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [fixture.a, fixture.b, fixture.c],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({ synopsis: "Résumé sur trois lignes maximum, jamais plus.", status: "Brouillon" }),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    tagsOf: () => [],
    labelOf: () => "",
    labelsOf: () => [],
    labelColor: () => null,
    roleOfFile: () => "scene",
    projectDisplayName: () => "Roman",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => workLeaf,
    getStatusColor: () => "#00ff00",
  };

  const view = new FeuilletsView(
    {
      app: {
        vault: {
          getAbstractFileByPath: (path) => byPath.get(path) || null,
          cachedRead: async () => "Contenu du feuillet.",
        },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
        workspace: {
          leftSplit: { name: "left" },
          rightSplit: { name: "right" },
          rootSplit,
          getLeavesOfType: () => [],
          getActiveViewOfType: () => null,
          getMostRecentLeaf: (splitRoot) => (splitRoot === rootSplit ? workLeaf : null),
          setActiveLeaf: () => {},
          revealLeaf: async () => {},
        },
      },
      contentEl,
    },
    plugin
  );
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  return { view, contentEl, plugin };
}

function listEl(contentEl) {
  return findAll(contentEl, (el) => el.classes.has("feuillets-list"))[0];
}

function itemFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-item[data-path]").find((el) => el.getAttr("data-path") === path);
}

function folderRowFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-folder-row[data-path]").find((el) => el.getAttr("data-path") === path);
}

/* ===================== 1 — Binder normal (non isolé) ===================== */

test("Binder normal : pas de classe isolée, profondeur posée, icône fichier toujours présente", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const list = listEl(contentEl);
  assert.ok(list, "le conteneur .feuillets-list doit exister");
  assert.equal(list.classes.has("feuillets-binder-isolated"), false);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.ok(itemA, "la ligne du feuillet A doit exister");
  assert.equal(itemA.style._props["--feuillets-binder-depth"], "0");
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-binder-node-icon")).length, 1);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-folder-chevron")).length, 1);
});

/* ===================== 2 — Binder isolé sur un sous-dossier =====================
 * Isolation testée en isolant directement `sub` (Chapitre 1) : le fichier
 * C.md isolé y est à depth 0 — mais la classe/CSS de neutralisation reste
 * purement visuelle et s'applique de la même façon quelle que soit la
 * profondeur. */

test("Binder isolé : classe feuillets-binder-isolated présente sur le conteneur commun", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view.plugin.workspaceFolderPath = fixture.sub.path;
  await view.render(true);

  const list = listEl(contentEl);
  assert.ok(list);
  assert.equal(list.classes.has("feuillets-binder-isolated"), true);
});

test("Binder isolé : la ligne fichier réserve toujours la profondeur/icône en TypeScript (neutralisation purement CSS)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view.plugin.workspaceFolderPath = fixture.sub.path;
  await view.render(true);

  const itemC = itemFor(contentEl, fixture.c.path);
  assert.ok(itemC, "la ligne du feuillet C doit exister");
  // Le rendu TS ne change pas : l'icône et le chevron réservé restent posés
  // dans le DOM (c'est styles.css qui les masque sous .feuillets-binder-isolated).
  assert.equal(findAll(itemC, (el) => el.classes.has("feuillets-binder-node-icon")).length, 1);
  assert.equal(findAll(itemC, (el) => el.classes.has("feuillets-folder-chevron") && el.classes.has("is-empty")).length, 1);
  // Le liseré de label reste conservé.
  assert.equal(findAll(itemC, (el) => el.classes.has("feuillets-label-swatch")).length, 1);
});

test("Binder isolé : l'aperçu 1/2/3 lignes reste inchangé", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { listPanePreviewField: "synopsis", listPanePreviewLines: 3 });
  view.plugin.workspaceFolderPath = fixture.sub.path;
  await view.render(true);

  const itemC = itemFor(contentEl, fixture.c.path);
  const preview = findAll(itemC, (el) => el.classes.has("feuillets-item-preview"))[0];
  assert.ok(preview, "l'aperçu doit être rendu");
  assert.equal(preview.style.maxHeight, "3.9000000000000004em");
});

/* ===================== 3 — Sous-dossiers dans le Binder isolé =====================
 * On isole ici la racine du projet elle-même n'a pas de sens (non isolé) ;
 * pour observer un sous-dossier RÉEL dans un Binder isolé, on isole un
 * dossier parent qui contient encore Chapitre 1 comme enfant : ici on
 * ajoute un niveau au-dessus. */

function buildFixtureWithGrandparent() {
  const root = new TFolder("Roman/Manuscrit");
  const part = new TFolder("Roman/Manuscrit/Partie 1");
  const a = new TFile("Roman/Manuscrit/Partie 1/A.md");
  a.basename = "A";
  const sub = new TFolder("Roman/Manuscrit/Partie 1/Chapitre 1");
  const c = new TFile("Roman/Manuscrit/Partie 1/Chapitre 1/C.md");
  c.basename = "C";

  sub.children = [c];
  c.parent = sub;
  part.children = [a, sub];
  a.parent = part;
  sub.parent = part;
  root.children = [part];
  part.parent = root;

  return { root, part, a, sub, c };
}

function buildViewWithGrandparent(fixture, settingsOverrides = {}) {
  const { root } = fixture;
  const settings = baseSettings({ projectFolder: root.path, binderSelectedPath: root.path, ...settingsOverrides });
  const contentEl = new FakeElement();
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: {} };

  const byPath = new Map();
  byPath.set(fixture.root.path, fixture.root);
  byPath.set(fixture.part.path, fixture.part);
  byPath.set(fixture.sub.path, fixture.sub);

  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [fixture.a, fixture.c],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({ synopsis: "Résumé." }),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    tagsOf: () => [],
    labelOf: () => "",
    labelsOf: () => [],
    labelColor: () => null,
    roleOfFile: () => "scene",
    projectDisplayName: () => "Roman",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => workLeaf,
    getStatusColor: () => "#00ff00",
  };

  const view = new FeuilletsView(
    {
      app: {
        vault: {
          getAbstractFileByPath: (path) => byPath.get(path) || null,
          cachedRead: async () => "Contenu du feuillet.",
        },
        metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
        workspace: {
          leftSplit: { name: "left" },
          rightSplit: { name: "right" },
          rootSplit,
          getLeavesOfType: () => [],
          getActiveViewOfType: () => null,
          getMostRecentLeaf: (splitRoot) => (splitRoot === rootSplit ? workLeaf : null),
          setActiveLeaf: () => {},
          revealLeaf: async () => {},
        },
      },
      contentEl,
    },
    plugin
  );
  view.iconBtn = (parent, icon, tooltip, onClick) => {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    button.icon = icon;
    if (onClick) button.addEventListener("click", onClick);
    return button;
  };
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  return { view, contentEl, plugin };
}

test("Binder isolé : un sous-dossier réel conserve chevron, icône dossier et indentation", async () => {
  const fixture = buildFixtureWithGrandparent();
  const { view, contentEl } = buildViewWithGrandparent(fixture);
  view.plugin.workspaceFolderPath = fixture.part.path;
  await view.render(true);

  const list = listEl(contentEl);
  assert.equal(list.classes.has("feuillets-binder-isolated"), true);

  const subRow = folderRowFor(contentEl, fixture.sub.path);
  assert.ok(subRow, "la ligne du sous-dossier Chapitre 1 doit exister");
  assert.equal(findAll(subRow, (el) => el.classes.has("feuillets-binder-node-icon")).length, 1);
  assert.equal(findAll(subRow, (el) => el.classes.has("feuillets-folder-chevron")).length, 1);
  assert.equal(subRow.style._props["--feuillets-binder-depth"], "0");
});

/* ===================== 4 — Retour au projet complet ===================== */

test("Binder : retour au projet complet retire la classe isolée et restaure le rendu normal", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);

  view.plugin.workspaceFolderPath = fixture.sub.path;
  await view.render(true);
  assert.equal(listEl(contentEl).classes.has("feuillets-binder-isolated"), true);

  view.plugin.workspaceFolderPath = undefined;
  await view.render(true);

  const list = listEl(contentEl);
  assert.equal(list.classes.has("feuillets-binder-isolated"), false);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.ok(itemA);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-binder-node-icon")).length, 1);
});
