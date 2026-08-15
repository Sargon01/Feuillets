import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

/* Micro-chantier finition Continu + corrections visuelles Binder, REVU par le
 * micro-lot "simplification définitive du Binder" :
 *
 * - Grammaire label FINALE : l'icône fichier/dossier reste TOUJOURS neutre,
 *   avec ou sans label — jamais colorée par le label (tentative jugée moins
 *   lisible et redondante avec le liseré à la validation visuelle réelle).
 * - Le liseré de label n'est plus le liseré de LIGNE historique
 *   (`item.style.boxShadow`) : c'est désormais un petit emplacement dédié
 *   (`.feuillets-label-swatch`) appartenant au NŒUD, juste avant l'icône
 *   fichier (voir renderFileRow, feuillets-view.ts) — réservé sur toutes les
 *   lignes fichiers dès que l'affichage des labels est actif, coloré via
 *   `--feuillets-label-color` uniquement avec `.has-label`.
 * - §26 (inchangé) : Maj+clic / Cmd+Ctrl+clic sur une ligne (densité avec
 *   aperçu) ne doivent jamais démarrer une sélection native de texte
 *   (§16-18) — vérifié ici au niveau du handler `mousedown` ajouté par
 *   renderFileRow.
 *
 * Même harnais minimal que test/binder-continu-membership.test.js (aucun
 * Continu actif nécessaire ici — hors périmètre de ces deux corrections). */

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

/** `a` porte un label jaune résolu ; `b` n'en porte aucun — même patron que
 * le reste du plugin (labelOf -> labelColor, jamais un second système). */
function buildView({ root, a, b }) {
  const settings = baseSettings({ projectFolder: root.path, binderSelectedPath: root.path });
  const contentEl = new FakeElement();
  const rootSplit = { name: "root" };
  const workLeaf = { getRoot: () => rootSplit, view: {} };
  const previews = new Map([
    [a.path, "Résumé de A"],
    [b.path, "Résumé de B"],
  ]);

  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [a, b],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: (file) => ({ synopsis: previews.get(file.path) || "" }),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    tagsOf: () => [],
    labelOf: (file) => (file.path === a.path ? "Intrigue A" : ""),
    labelsOf: () => [],
    labelColor: (name) => (name === "Intrigue A" ? "#e0c341" : null),
    roleOfFile: () => "scene",
    projectDisplayName: () => "Roman",
    saveSettings: async () => {},
    generateCanvasBoard() {},
    getLeafForOpeningFile: () => workLeaf,
  };

  const view = new FeuilletsView(
    {
      app: {
        vault: { getAbstractFileByPath: (path) => (path === root.path ? root : null) },
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

function iconOf(item) {
  return findAll(item, (el) => el.classes.has("feuillets-binder-node-icon"))[0];
}

function swatchOf(item) {
  return findAll(item, (el) => el.classes.has("feuillets-label-swatch"))[0];
}

function previewOf(item) {
  return findAll(item, (el) => el.classes.has("feuillets-item-preview"))[0];
}

/* ===================== §25 — couleur du liseré de label ===================== */

test("feuillet AVEC label résolu : l'icône reste NEUTRE (aucune couleur JS), le liseré dédié (avant l'icône) porte seul la couleur du label", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  const iconA = iconOf(itemA);
  assert.ok(iconA, "l'icône du feuillet doit exister");
  // `.has-label`/`--feuillets-label-color` peuvent encore être posées par
  // buildBinderNodeIcon (retour arrière CSS uniquement, voir styles.css) —
  // ce test ne l'exige NI ne l'interdit : seul compte l'absence d'effet
  // visuel (vérifié ci-dessous par lecture directe de styles.css).

  // Le liseré dédié (§4 du micro-lot "simplification définitive du Binder")
  // est l'UNIQUE représentation visuelle du label — plus aucun box-shadow
  // sur la ligne entière.
  assert.equal(itemA.style.boxShadow, undefined);
  const swatchA = swatchOf(itemA);
  assert.ok(swatchA, "le petit emplacement de label doit exister avant l'icône");
  assert.equal(swatchA.classes.has("has-label"), true);
  assert.equal(swatchA.style._props["--feuillets-label-color"], "#e0c341");
});

test("feuillet SANS label : icône neutre, emplacement de label transparent (réservé pour l'alignement) mais sans .has-label", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemB = itemFor(contentEl, fixture.b.path);
  const iconB = iconOf(itemB);
  assert.ok(iconB);
  assert.equal(iconB.classes.has("has-label"), false);
  assert.equal(itemB.style.boxShadow, undefined);
  const swatchB = swatchOf(itemB);
  assert.ok(swatchB, "l'emplacement doit rester réservé pour l'alignement même sans label");
  assert.equal(swatchB.classes.has("has-label"), false);
});

test("affichage des labels désactivé : aucun emplacement de label dans le DOM", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  view.plugin.settings.binderShowLabels = false;
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.equal(swatchOf(itemA), undefined);
});

test("dossier : aucun mécanisme de label dossier réel dans ce plugin (labelColor=null) — icône neutre, jamais déduite des enfants ni du premier feuillet", async () => {
  // Fixture avec un sous-dossier CONTENANT un feuillet AVEC label (fixture.a
  // porte "Intrigue A", voir buildView) — pour vérifier explicitement que
  // l'icône du DOSSIER ne récupère jamais la couleur d'un enfant.
  const root = new TFolder("Roman/Manuscrit");
  const chapitre = new TFolder("Roman/Manuscrit/Chapitre 1");
  const a = new TFile("Roman/Manuscrit/Chapitre 1/A.md");
  a.basename = "A";
  chapitre.children = [a];
  root.children = [chapitre];
  a.parent = chapitre;
  chapitre.parent = root;

  const { view, contentEl } = buildView({ root, a, b: a });
  await view.render(true);

  const folderRows = contentEl.querySelectorAll(".feuillets-folder-row[data-path]");
  assert.equal(folderRows.length, 1, "le dossier Chapitre 1 doit être rendu");
  const folderIcon = iconOf(folderRows[0]);
  assert.ok(folderIcon, "l'icône du dossier doit exister");
  assert.equal(folderIcon.classes.has("has-label"), false, "aucun mécanisme de label dossier réel : icône neutre");
  assert.equal(swatchOf(folderRows[0]), undefined, "les dossiers n'ont jamais d'emplacement de label");

  // Le liseré dédié du feuillet A, lui, garde bien sa couleur — preuve que
  // la neutralité du dossier n'est pas un effet de bord d'un
  // labelOf/labelColor cassé, mais bien l'absence réelle de mécanisme
  // dossier.
  const itemA = itemFor(contentEl, a.path);
  const swatchA = swatchOf(itemA);
  assert.ok(swatchA);
  assert.equal(swatchA.style._props["--feuillets-label-color"], "#e0c341");
});

/* ===================== Grammaire label FINALE (icône neutre + liseré) ===================== */

test("styles.css : .feuillets-binder-node-icon.has-label n'applique plus AUCUNE couleur (icône toujours neutre) — aucune palette codée en dur sur l'icône", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const css = readFileSync(join(process.cwd(), "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  const hasLabelRule = css.match(/\.feuillets-binder-node-icon\.has-label\s*\{([^}]*)\}/);
  if (hasLabelRule) {
    assert.doesNotMatch(hasLabelRule[1], /color\s*:/i, "l'icône ne doit plus jamais être recolorée par le label");
  }

  const neutralRule = css.match(/\.feuillets-binder-node-icon\s*\{([^}]*)\}/);
  assert.ok(neutralRule, "la règle de base de l'icône doit exister");
  assert.match(neutralRule[1], /color:\s*var\(--text-muted\)/, "l'icône reste sur la couleur neutre existante, jamais une couleur codée en dur");

  // Le liseré historique de LABEL (couleur dynamique légitime, sur la ligne
  // — pas sur l'icône) doit lui rester intact.
  assert.match(css, /\.feuillets-item\b[^{]*\{[^}]*\}/, "au moins une règle .feuillets-item doit exister (structure Binder)");
});

/* ===================== §26 — jamais de sélection native des aperçus ===================== */

test("Maj+clic sur une ligne AVEC aperçu visible : le mousedown correspondant appelle preventDefault (empêche la sélection native)", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  assert.ok(previewOf(itemA), "l'aperçu doit bien être rendu pour ce test");

  let prevented = false;
  itemA.events.get("mousedown")({ shiftKey: true, ctrlKey: false, metaKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test("Cmd+clic (metaKey) sur une ligne avec aperçu : preventDefault appelé au mousedown", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemB = itemFor(contentEl, fixture.b.path);
  let prevented = false;
  itemB.events.get("mousedown")({ shiftKey: false, ctrlKey: false, metaKey: true, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test("Ctrl+clic sur une ligne avec aperçu : preventDefault appelé au mousedown", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  let prevented = false;
  itemA.events.get("mousedown")({ shiftKey: false, ctrlKey: true, metaKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test("clic simple (aucun modificateur) sur une ligne avec aperçu : mousedown ne prévient rien — jamais de double sélection/logique parasite", async () => {
  const fixture = buildFixture();
  const { view, contentEl } = buildView(fixture);
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  let prevented = false;
  itemA.events.get("mousedown")({ shiftKey: false, ctrlKey: false, metaKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test("non-régression §27 : le clic simple ouvre toujours normalement le fichier — l'ajout du mousedown ne remplace ni ne double la logique click", async () => {
  const fixture = buildFixture();
  const { view, contentEl, plugin } = buildView(fixture);
  const openedPaths = [];
  const leaf = { openFile: async (file) => { openedPaths.push(file.path); } };
  plugin.getLeafForOpeningFile = () => leaf;
  await view.render(true);

  const itemA = itemFor(contentEl, fixture.a.path);
  itemA.events.get("click")({ shiftKey: false, ctrlKey: false, metaKey: false, preventDefault: () => {}, stopPropagation: () => {} });
  await Promise.resolve();

  assert.deepEqual(openedPaths, [fixture.a.path], "clic simple → ouverture normale, comportement historique inchangé");
});

test("la classe CSS .feuillets-item-preview passe bien à user-select: none dans styles.css (jamais 'text') — vérifié par lecture directe de la feuille de style", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const css = readFileSync(join(process.cwd(), "styles.css"), "utf8");
  const match = css.match(/\.feuillets-item-preview\s*\{[^}]*\}/);
  assert.ok(match, "la règle .feuillets-item-preview doit exister dans styles.css");
  assert.match(match[0], /user-select:\s*none/);
  assert.doesNotMatch(match[0], /user-select:\s*text/);
});
