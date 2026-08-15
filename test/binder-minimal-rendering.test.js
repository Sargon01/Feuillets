import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

/* Micro-lot "simplification définitive du Binder" : le Binder redevient
 * strictement un navigateur de structure — indentation, chevron, icône
 * neutre, liseré de label, fond de ligne, titre, aperçu facultatif très
 * court. Plus jamais de barre de progression, nombre de mots, tags/chips ni
 * pastille de statut sur une ligne Binder, MÊME si les anciens réglages
 * (`binderShowTags`/`binderShowStatus`/`binderShowProgress`/
 * `binderShowWords`) sont encore à `true` en donnée sauvegardée (aucune
 * migration, simplement inertes pour ce rendu — voir renderFileRow et
 * buildDisplayOptionsMenu, feuillets-view.ts).
 *
 * Même harnais minimal que test/binder-label-icon-and-native-selection.test.js
 * (aucun Continu actif nécessaire ici). */

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
    binderLayout: "split",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    binderShowLabels: true,
    // Anciens réglages volontairement à `true` : ne doivent plus produire
    // aucun rendu dans le Binder (§9-A du micro-lot).
    binderShowTags: true,
    binderShowStatus: true,
    binderShowProgress: true,
    binderShowWords: true,
    listPanePreviewField: "synopsis",
    listPanePreviewLines: 2,
    ...overrides,
  };
}

function buildFixture() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md");
  const b = new TFile("Roman/Manuscrit/B.md");
  a.basename = "A";
  b.basename = "B";
  root.children = [a, b];
  a.parent = root;
  b.parent = root;
  return { root, a, b };
}

function buildView({ root, a, b }, settingsOverrides = {}) {
  const settings = baseSettings({ projectFolder: root.path, binderSelectedPath: root.path, ...settingsOverrides });
  const contentEl = new FakeElement();
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: {} };

  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [a, b],
    getWordCounts: async () => new Map([[a.path, { wc: 672 }], [b.path, { wc: 120 }]]),
    buildNumbering: () => new Map(),
    fmOf: () => ({ synopsis: "Résumé.", status: "Brouillon" }),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    tagsOf: () => ["dervis", "tekke"],
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
          getAbstractFileByPath: (path) => (path === root.path ? root : null),
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

function itemFor(contentEl, path) {
  return contentEl.querySelectorAll(".feuillets-item[data-path]").find((el) => el.getAttr("data-path") === path);
}

/* ===================== A — rendu minimal, anciens réglages à true ===================== */

test("Binder : binderShowTags/Status/Progress/Words à true ne créent malgré tout aucun tag chip / status dot / anneau / nombre de mots", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.ok(itemA, "la ligne du feuillet A doit exister");

  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-status-dot")).length, 0);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-tags")).length, 0);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-tag-chip")).length, 0);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-ring")).length, 0);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-item-wc")).length, 0);
});

test("Binder : le titre reste l'information dominante — un feuillet sans aperçu ne rend que son titre dans le corps de ligne", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { listPanePreviewField: "none" });
  await view.render(true);

  const itemB = itemFor(contentEl, fixture.b.path);
  const body = findAll(itemB, (el) => el.classes.has("feuillets-item-body"))[0];
  assert.ok(body);
  assert.equal(findAll(body, (el) => el.classes.has("feuillets-item-preview")).length, 0);
});

/* ===================== E — aperçu 0/1/2/3 lignes =====================
 * (résolution du champ effectif synopsis/summary/tags/notes/lignes >3 :
 * voir test/binder-preview-field-resolution.test.js) */

test("mode compact : aucun aperçu rendu même si un champ d'aperçu est choisi", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { binderCompact: true, listPanePreviewField: "synopsis" });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-item-preview")).length, 0);
});

test("mode standard + aperçu 'none' : aucun aperçu rendu", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { listPanePreviewField: "none" });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-item-preview")).length, 0);
});

test("mode standard + aperçu activé + 1 ligne configurée : hauteur bornée à 1 ligne (1.3em)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { listPanePreviewField: "synopsis", listPanePreviewLines: 1 });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const preview = findAll(itemA, (el) => el.classes.has("feuillets-item-preview"))[0];
  assert.ok(preview, "l'aperçu doit être rendu");
  assert.equal(preview.style.maxHeight, "1.3em");
});

test("mode standard + aperçu activé + 2 lignes configurées : hauteur bornée à 2 lignes (2.6em)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { listPanePreviewField: "synopsis", listPanePreviewLines: 2 });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const preview = findAll(itemA, (el) => el.classes.has("feuillets-item-preview"))[0];
  assert.ok(preview, "l'aperçu doit être rendu");
  assert.equal(preview.style.maxHeight, "2.6em");
});

test("mode standard + aperçu activé + 3 lignes configurées : hauteur bornée à 3 lignes (3.9em)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { listPanePreviewField: "synopsis", listPanePreviewLines: 3 });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const preview = findAll(itemA, (el) => el.classes.has("feuillets-item-preview"))[0];
  assert.ok(preview, "l'aperçu doit être rendu");
  assert.equal(preview.style.maxHeight, "3.9000000000000004em");
});

test("ancienne valeur listPanePreviewLines=6 (donnée non migrée) : rendu borné à 3 lignes maximum (3.9em), jamais 6", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { listPanePreviewField: "synopsis", listPanePreviewLines: 6 });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const preview = findAll(itemA, (el) => el.classes.has("feuillets-item-preview"))[0];
  assert.ok(preview, "l'aperçu doit être rendu");
  assert.equal(preview.style.maxHeight, "3.9000000000000004em");
});

/* ===================== B — menu d'affichage ===================== */

test("le menu d'affichage du Binder ne propose plus tags/statut/progression/mots, garde le liseré de label et les options existantes", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture);
  const menu = new Menu();
  view.buildDisplayOptionsMenu(menu);

  const S = view.plugin.settings;
  // Les toggles (construits par `toggle()`) sont les seuls items du menu à
  // porter un état `checked` — contrairement à "Options supplémentaires",
  // qui a un callback mais aucun `setChecked`.
  const toggleItems = menu.items.filter((i) => typeof i.callback === "function" && i.checked !== undefined);
  // Un seul toggle attendu ici : celui du liseré de label — plus aucun pour
  // tags/statut/progression/mots.
  assert.equal(toggleItems.length, 1, "un seul toggle doit rester dans ce menu (liseré de label)");

  const before = S.binderShowLabels;
  await toggleItems[0].callback();
  assert.equal(S.binderShowLabels, !before, "le toggle restant doit bien piloter binderShowLabels");

  // Les anciens réglages ne doivent plus être modifiables depuis ce menu,
  // même si leurs clés restent en donnée pour compatibilité.
  assert.equal(S.binderShowTags, true);
  assert.equal(S.binderShowStatus, true);
  assert.equal(S.binderShowProgress, true);
  assert.equal(S.binderShowWords, true);

  // "Options supplémentaires" (accès aux réglages complets) reste présent.
  assert.ok(menu.items.some((i) => i.icon === "settings"), "l'accès aux réglages complets doit rester");
});

/* Le menu local (showSplitPaneOptionsMenu) — choix de champ ET nombre de
 * lignes — est couvert par test/binder-preview-field-resolution.test.js
 * (grammaire Fiction/Non-fiction/Libre, résolution des anciennes valeurs,
 * bornes 1-3). */
