import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

/* Ajustement "aperçu du Binder" (suite du micro-lot "simplification
 * définitive du Binder") : le menu « Aperçu de la fiche » du Binder ne
 * propose plus jamais Notes de travail ni Tags, et jamais synopsis ET
 * résumé long à la fois — un seul champ sémantique, celui du mode du
 * projet courant (règle EXISTANTE PROJECT_MODES[...].defaults.cardContent,
 * voir utils/project-modes.ts) :
 * - Fiction   → synopsis
 * - Non-fiction / Libre → summary
 *
 * Résolution EFFECTIVE d'une valeur brute de `listPanePreviewField`
 * (jamais migrée sur disque, voir utils/binder-preview.ts) :
 * - none/absent            → none
 * - extrait                → extrait
 * - synopsis OU summary    → champ sémantique du mode COURANT
 * - tags, notes, inconnue  → none
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

/* Mêmes valeurs `defaults.cardContent` que PROJECT_MODES (utils/project-modes.ts) :
 * Fiction → "synopsis", Non-fiction/Libre → "summary". */
const CARD_CONTENT_BY_MODE = { fiction: "synopsis", nonfiction: "summary", free: "summary" };

function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md");
  a.basename = "A";
  root.children = [a];
  a.parent = root;
  return { root, a };
}

function buildView({ root, a }, { mode = "fiction", ...settingsOverrides } = {}) {
  const settings = {
    projectFolder: root.path,
    binderSelectedPath: root.path,
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
    listPanePreviewField: "synopsis",
    listPanePreviewLines: 2,
    ...settingsOverrides,
  };
  const contentEl = new FakeElement();
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: {} };

  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [a],
    getWordCounts: async () => new Map([[a.path, { wc: 300 }]]),
    buildNumbering: () => new Map(),
    fmOf: () => ({ synopsis: "Synopsis de A.", summary: "Résumé long de A.", status: "" }),
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
    // Mode du projet — reproduit la forme réelle de PROJECT_MODES[mode]
    // (utils/project-modes.ts), pas une nouvelle notion.
    projectMode: () => ({ defaults: { cardContent: CARD_CONTENT_BY_MODE[mode] } }),
  };

  const view = new FeuilletsView(
    {
      app: {
        vault: {
          getAbstractFileByPath: (path) => (path === root.path ? root : null),
          cachedRead: async () => "Contenu.",
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

function itemFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-item[data-path]").find((el) => el.getAttr("data-path") === path);
}

function previewTextOf(itemEl) {
  const prev = findAll(itemEl, (el) => el.classes.has("feuillets-item-preview"))[0];
  return prev ? prev.text : undefined;
}

function fieldMenuTitles(view) {
  view.showSplitPaneOptionsMenu({ clientX: 0, clientY: 0 });
  const menu = Menu.lastShown;
  // Les entrées de champ précèdent le premier séparateur.
  const sepIdx = menu.items.findIndex((i) => i.separator);
  return menu.items.slice(0, sepIdx).filter((i) => !i.disabled).map((i) => i.title);
}

/* ===================== 1-3 — menu selon le mode ===================== */

test("1. Fiction : menu = Aucun / Extrait du texte / Synopsis — jamais summary/notes/tags", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture, { mode: "fiction" });
  const titles = fieldMenuTitles(view);
  assert.equal(titles.length, 3, "exactement 3 entrées de champ");
});

test("2. Non-fiction : menu = Aucun / Extrait du texte / Résumé long — jamais synopsis/notes/tags", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture, { mode: "nonfiction" });
  const titles = fieldMenuTitles(view);
  assert.equal(titles.length, 3, "exactement 3 entrées de champ");
});

test("3. Libre : même comportement que Non-fiction", async () => {
  const fixtureNF = buildFixture();
  const { view: viewNF } = buildView(fixtureNF, { mode: "nonfiction" });
  const titlesNF = fieldMenuTitles(viewNF);

  const fixtureFree = buildFixture();
  const { view: viewFree } = buildView(fixtureFree, { mode: "free" });
  const titlesFree = fieldMenuTitles(viewFree);

  assert.deepEqual(titlesFree, titlesNF);
});

/* Vérification directe des VALEURS (pas seulement le compte) via les clés
 * de réglage effectivement écrites par chaque entrée du menu. */
function fieldMenuKeys(view) {
  view.showSplitPaneOptionsMenu({ clientX: 0, clientY: 0 });
  const menu = Menu.lastShown;
  const sepIdx = menu.items.findIndex((i) => i.separator);
  const S = view.plugin.settings;
  return menu.items.slice(0, sepIdx).filter((i) => !i.disabled).map((i) => {
    const before = S.listPanePreviewField;
    i.callback();
    const written = S.listPanePreviewField;
    S.listPanePreviewField = before;
    return written;
  });
}

test("1bis. Fiction : les clés proposées sont exactement none/extrait/synopsis", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture, { mode: "fiction" });
  assert.deepEqual(fieldMenuKeys(view), ["none", "extrait", "synopsis"]);
});

test("2bis. Non-fiction : les clés proposées sont exactement none/extrait/summary", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture, { mode: "nonfiction" });
  assert.deepEqual(fieldMenuKeys(view), ["none", "extrait", "summary"]);
});

test("3bis. Libre : les clés proposées sont exactement none/extrait/summary", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture, { mode: "free" });
  assert.deepEqual(fieldMenuKeys(view), ["none", "extrait", "summary"]);
});

/* ===================== 4-7 — résolution des anciennes valeurs ===================== */

test("4. ancienne valeur 'synopsis' dans un projet Non-fiction : aperçu effectif = summary", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { mode: "nonfiction", listPanePreviewField: "synopsis" });
  await view.render(true);
  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(previewTextOf(itemA), "Résumé long de A.");
});

test("5. ancienne valeur 'summary' dans un projet Fiction : aperçu effectif = synopsis", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { mode: "fiction", listPanePreviewField: "summary" });
  await view.render(true);
  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(previewTextOf(itemA), "Synopsis de A.");
});

test("6. ancienne valeur 'tags' : aperçu effectif = none (aucun aperçu rendu)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { mode: "fiction", listPanePreviewField: "tags" });
  await view.render(true);
  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(previewTextOf(itemA), undefined);
});

test("7. ancienne valeur 'notes' : aperçu effectif = none (aucun aperçu rendu)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { mode: "fiction", listPanePreviewField: "notes" });
  await view.render(true);
  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(previewTextOf(itemA), undefined);
});

/* ===================== 8-9 — nombre de lignes ===================== */

test("8. menu local : exactement 3 entrées de lignes (1, 2, 3)", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture, { mode: "fiction", listPanePreviewField: "synopsis" });
  view.showSplitPaneOptionsMenu({ clientX: 0, clientY: 0 });
  const menu = Menu.lastShown;
  const lineItems = menu.items.filter((i) => i.title === "1" || i.title === "2" || i.title === "3");
  assert.equal(lineItems.length, 3);
  assert.ok(!menu.items.some((i) => i.title === "4"), "jamais 4 lignes proposées");
});

test("9. ancienne valeur listPanePreviewLines=6 : rendu borné à 3 lignes maximum (3.9em)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, {
    mode: "fiction",
    listPanePreviewField: "synopsis",
    listPanePreviewLines: 6,
  });
  await view.render(true);
  const itemA = itemFor(contentEl, fixture.a.path);
  const prev = findAll(itemA, (el) => el.classes.has("feuillets-item-preview"))[0];
  assert.ok(prev);
  assert.equal(prev.style.maxHeight, "3.9000000000000004em");
});
