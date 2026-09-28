import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

/* Micro-lot "simplification définitive du Binder", puis micro-lot "repère
 * d'avancement sans dashboard" : le Binder reste un navigateur de structure
 * — indentation, chevron, icône neutre, liseré de label, fond de ligne,
 * titre, aperçu facultatif très court — auquel s'ajoutent, uniquement quand
 * explicitement activés, une pastille de statut compacte et une micro-barre
 * de progression sur la MÊME ligne que le titre (voir renderBinderIndicators,
 * feuillets-view.ts). Tags/chips et nombre de mots en chiffres restent eux
 * INERTES même à `true` en donnée sauvegardée (`binderShowTags`/
 * `binderShowWords`, aucune migration, voir buildDisplayOptionsMenu).
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
    binderLayout: "tree",
    binderCompact: false,
    binderTreeWidth: 240,
    collapsed: {},
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    binderShowLabels: true,
    // Réactivés (§1 du micro-lot "repère d'avancement sans dashboard") :
    // status dot / progress ring DO render when explicitly on. Tags/words
    // stay inert even at `true` (§9-A of the earlier micro-lot).
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

test("Binder : binderShowTags/Words à true still create no tag chip / word count number — binderShowStatus does show its status dot, binderShowProgress shows no ring absent a valid goal", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.ok(itemA, "la ligne du feuillet A doit exister");

  // Status is reactivated: the fixture's file has status "Brouillon" and
  // binderShowStatus is true, so its dot renders on the title row.
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-status-dot")).length, 1);
  // Tags/word count remain permanently inert, whatever the setting.
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-tags")).length, 0);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-tag-chip")).length, 0);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-item-wc")).length, 0);
  // Progress is reactivated too, but this fixture's file has no valid word
  // goal — no ring is ever rendered for a goal-less sheet.
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-ring")).length, 0);
});

test("Binder : with binderShowStatus/Progress on and a valid goal set, both the status dot and the progress ring render on the title row, never a second line", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view.plugin.fmOf = () => ({ synopsis: "Résumé.", status: "Brouillon", goal: 1000 });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const nameRow = findAll(itemA, (el) => el.classes.has("feuillets-item-name-row"))[0];
  assert.ok(nameRow, "the name row must exist");
  const indicators = findAll(nameRow, (el) => el.classes.has("feuillets-binder-indicators"));
  assert.equal(indicators.length, 1, "indicators belong to the existing title row, never a second row");
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-status-dot")).length, 1);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-ring")).length, 1);
  // No permanent percentage text is ever rendered.
  assert.doesNotMatch(itemA.text || "", /%/);
});

test("Test C — status dot: correct color and a translated, human-readable accessible label, never a raw internal id", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const dot = findAll(itemA, (el) => el.classes.has("feuillets-status-dot"))[0];
  assert.ok(dot, "the fixture's status 'Brouillon' must produce a dot once binderShowStatus is on");
  assert.equal(dot.style.background, "#00ff00", "color comes from plugin.getStatusColor(), never a local color table");
  assert.equal(dot.getAttr("aria-label"), "Brouillon", "the accessible label is the readable status name, never an internal id like 'in_progress'");
});

test("Test E — progress ring: goal 1000, word count 500 -> exactly 50%, via the existing fillRing() engine, never a visible '50 %' text", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view.plugin.fmOf = () => ({ synopsis: "Résumé.", status: "", goal: 1000 });
  view.plugin.getWordCounts = async () => new Map([[fixture.a.path, { wc: 500 }], [fixture.b.path, { wc: 0 }]]);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const ring = findAll(itemA, (el) => el.classes.has("feuillets-ring"))[0];
  assert.ok(ring, "a valid goal must produce a ring");
  assert.equal(ring.style._props["--pct"], "50%");
  assert.equal(ring.getAttr("aria-valuenow"), "50");
  assert.equal(ring.getAttr("role"), "progressbar");
  assert.doesNotMatch(itemA.text || "", /50\s*%/, "the percentage is available via aria/tooltip, never as visible row text");
});

test("Binder : with binderShowStatus/Progress off, no indicators render at all, even with a status and a valid goal", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture, { binderShowStatus: false, binderShowProgress: false });
  view.plugin.fmOf = () => ({ synopsis: "Résumé.", status: "Brouillon", goal: 1000 });
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-binder-indicators")).length, 0);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-status-dot")).length, 0);
  assert.equal(findAll(itemA, (el) => el.classes.has("feuillets-ring")).length, 0);
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

test("le menu d'affichage du Binder propose liseré de label + statut + progression, mais toujours pas tags/mots", async () => {
  const fixture = buildFixture();
  const { view } = buildView(fixture);
  const menu = new Menu();
  view.buildDisplayOptionsMenu(menu);

  const S = view.plugin.settings;
  // Les toggles (construits par `toggle()`) sont les seuls items du menu à
  // porter un état `checked` — contrairement à "Options supplémentaires",
  // qui a un callback mais aucun `setChecked`.
  const toggleItems = menu.items.filter((i) => typeof i.callback === "function" && i.checked !== undefined);
  // Trois toggles désormais : liseré de label, statut, progression — plus
  // aucun pour tags/mots.
  assert.equal(toggleItems.length, 3, "label stripes + status dot + progress bars, nothing else");

  const before = S.binderShowLabels;
  await toggleItems[0].callback();
  assert.equal(S.binderShowLabels, !before, "the first toggle must drive binderShowLabels");

  const statusBefore = S.binderShowStatus;
  await toggleItems[1].callback();
  assert.equal(S.binderShowStatus, !statusBefore, "the second toggle must drive binderShowStatus");

  const progressBefore = S.binderShowProgress;
  await toggleItems[2].callback();
  assert.equal(S.binderShowProgress, !progressBefore, "the third toggle must drive binderShowProgress");

  // Tags/words remain permanently absent from this menu, even though their
  // settings still exist for backward compatibility.
  assert.equal(menu.items.some((i) => i.title === "Pastilles de tags" || i.title === "Tag chips"), false);
  assert.equal(menu.items.some((i) => i.title === "Nombre de mots en chiffres" || i.title === "Word count numbers"), false);
  assert.equal(S.binderShowTags, true);
  assert.equal(S.binderShowWords, true);

  // "Options supplémentaires" (accès aux réglages complets) reste présent.
  assert.ok(menu.items.some((i) => i.icon === "settings"), "l'accès aux réglages complets doit rester");
});

/* Le menu local (showSplitPaneOptionsMenu) — choix de champ ET nombre de
 * lignes — est couvert par test/binder-preview-field-resolution.test.js
 * (grammaire Fiction/Non-fiction/Libre, résolution des anciennes valeurs,
 * bornes 1-3). */
