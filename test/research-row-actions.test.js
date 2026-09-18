import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, Menu } from "obsidian";
import { ResearchView } from "../src/views/research-view.js";
import { t } from "../src/i18n/index.js";

/* FakeElement minimal — même contrat que les autres tests de
   base-feuillets-view.ts (voir research-plus-menu.test.js) : assez de DOM
   factice pour que createEl/createDiv/createSpan/setText/setAttr/setIcon
   (icône mémorisée sur `.icon`, voir obsidian-runtime-stub.mjs)
   fonctionnent, jamais partagé entre fichiers de test (convention du
   dépôt). */
class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.attrs = new Map();
    this.tag = options.tag || "div";
    this.style = {};
    if (options.cls) this.addClass(options.cls);
  }
  addClass(className) {
    for (const part of String(className).split(/\s+/)) if (part) this.classes.add(part);
    return this;
  }
  removeClass(className) {
    for (const part of String(className).split(/\s+/)) this.classes.delete(part);
    return this;
  }
  hasClass(className) { return this.classes.has(className); }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }
  find(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    for (const child of this.children) {
      if (className && child.classes.has(className)) return child;
      const nested = child.find(selector);
      if (nested) return nested;
    }
    return null;
  }
  findAll(predicate) {
    const results = [];
    for (const child of this.children) {
      if (predicate(child)) results.push(child);
      results.push(...child.findAll(predicate));
    }
    return results;
  }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs.set(name, value); return this; }
  getAttr(name) { return this.attrs.get(name); }
  addEventListener(type, callback) {
    this.events ||= new Map();
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(callback);
  }
  click(type = "click") {
    for (const cb of this.events?.get(type) || []) cb({ type, stopPropagation() {} });
  }
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function buildView() {
  const insertCalls = [];
  const openCalls = [];
  const renderCalls = [];
  const fakeLeaf = { openFile: async () => {} };
  const app = {
    workspace: {
      getLeaf: (...args) => { openCalls.push(args); return fakeLeaf; },
      setActiveLeaf: () => {},
      trigger: () => {},
    },
  };
  const plugin = {
    app,
    settings: {},
    titleFor: (f) => f.basename,
    tagsOf: () => [],
    insertIntoActiveEditor: (link) => insertCalls.push(link),
  };
  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);
  /* Clic sur le nom d'une fiche Markdown déclenche `void this.render()`
     (rendu complet du panneau) — hors de portée de ce fichier de test
     (dédié aux actions de ligne) : stubé comme dans research-plus-
     menu.test.js, sans quoi le vrai render() touche `document`, absent de
     ce harnais, et fait planter le test de façon asynchrone. */
  view.render = async (force) => { renderCalls.push(force); };
  return { view, app, insertCalls, openCalls, renderCalls };
}

/** Rend une seule ligne de fichier Recherche et retourne les boutons de
 * son en-tête, identifiés par l'icône Lucide posée dessus (`.icon`,
 * mémorisé par le stub setIcon — voir obsidian-runtime-stub.mjs). */
function renderRow(file, root = folder("Projet/_Recherche")) {
  const { view, insertCalls, openCalls, renderCalls } = buildView();
  const list = new FakeElement();
  view.renderResearchFileRow(list, file, root);
  const row = list.children[0];
  const header = row.children[0];
  const buttons = header.findAll((el) => el.tag === "button");
  const byIcon = (icon) => buttons.find((b) => b.icon === icon);
  return { view, row, header, buttons, byIcon, insertCalls, openCalls, renderCalls };
}

/** Colonne icône/indicateur d'une ligne — jamais un bouton, le seul élément
 * portant la classe feuillets-research-item-icon dans l'en-tête. */
function iconColumn(header) {
  return header.findAll((el) => el.classes.has("feuillets-research-item-icon"))[0];
}

/** Élément nom — seul élément cliquable de la ligne depuis la
 * simplification des lignes Recherche (plus toute la ligne). */
function nameElOf(header) {
  return header.findAll((el) => el.classes.has("feuillets-research-item-name"))[0];
}

const previewableNames = [
  ["Notes.md", "Markdown"],
  ["Portrait.png", "image"],
  ["Source.pdf", "PDF"],
  ["Tableau.canvas", "Canvas"],
  ["Vue.base", "Base"],
  ["Croquis.excalidraw.md", "Excalidraw"],
  ["Croquis.excalidraw 1.md", "Excalidraw (variante de collision)"],
];

for (const [name, label] of previewableNames) {
  test(`œil présent pour ${label} (${name})`, () => {
    const { byIcon } = renderRow(new TFile(`Projet/_Recherche/${name}`));
    assert.ok(byIcon("eye"), `${label} doit avoir le bouton œil`);
  });
}

const nonPreviewableNames = [
  ["Manuscrit.docx", "DOCX"],
  ["Notes.odt", "ODT"],
  ["Livre.epub", "EPUB"],
  ["Donnees.xls", "XLS"],
  ["Donnees.xlsx", "XLSX"],
  ["Donnees.ods", "ODS"],
  ["Donnees.csv", "CSV"],
  ["Donnees.tsv", "TSV"],
  ["Diapo.ppt", "PPT"],
  ["Diapo.pptx", "PPTX"],
  ["Diapo.odp", "ODP"],
  ["Notes.rtf", "RTF"],
];

for (const [name, label] of nonPreviewableNames) {
  test(`œil absent pour ${label} (${name})`, () => {
    const { byIcon } = renderRow(new TFile(`Projet/_Recherche/${name}`));
    assert.equal(byIcon("eye"), undefined, `${label} ne doit jamais avoir le bouton œil`);
  });
}

/* ===== réduction des actions visibles : plus de chaîne, plus d'ouverture
   directe — seuls le nom, l'œil (conditionnel) et "..." subsistent. ===== */

test("aucun bouton chaîne ni bouton d'ouverture directe, pour aucun type de fichier Recherche", () => {
  const names = [
    "Notes.md",
    "Portrait.png",
    "Source.pdf",
    "Tableau.canvas",
    "Vue.base",
    "Croquis.excalidraw.md",
    "Manuscrit.docx",
    "Notes.odt",
    "Livre.epub",
    "Donnees.xlsx",
    "Diapo.pptx",
    "Notes.rtf",
  ];
  for (const name of names) {
    const { byIcon, buttons } = renderRow(new TFile(`Projet/_Recherche/${name}`));
    assert.equal(byIcon("link"), undefined, `${name} ne doit plus avoir de bouton chaîne`);
    assert.equal(byIcon("external-link"), undefined, `${name} ne doit plus avoir de bouton d'ouverture directe`);
    // structure finale : au plus 2 boutons (œil conditionnel + "...").
    assert.ok(buttons.length <= 2, `${name} ne doit garder que l'œil et "..." (trouvé ${buttons.length} boutons)`);
  }
});

test("\"...\" reste toujours disponible, pour absolument tous les types", () => {
  const names = [
    "Notes.md",
    "Portrait.png",
    "Source.pdf",
    "Tableau.canvas",
    "Vue.base",
    "Croquis.excalidraw.md",
    "Manuscrit.docx",
    "Notes.odt",
    "Livre.epub",
    "Donnees.xlsx",
    "Diapo.pptx",
    "Notes.rtf",
  ];
  for (const name of names) {
    const { byIcon } = renderRow(new TFile(`Projet/_Recherche/${name}`));
    const menuBtn = byIcon("more-horizontal");
    assert.ok(menuBtn, `${name} doit garder "..."`);
    assert.ok(menuBtn.classes.has("feuillets-research-item-menu-btn"), `${name} : "..." doit rester visible en permanence (jamais masqué au survol)`);
  }
});

test("l'œil (quand présent) porte la classe qui le masque hors survol/focus (display: none, voir styles.css) — aucune largeur réservée", () => {
  const { byIcon } = renderRow(new TFile("Projet/_Recherche/Notes.md"));
  const eyeBtn = byIcon("eye");
  assert.ok(eyeBtn);
  assert.ok(eyeBtn.classes.has("feuillets-research-item-eye"), "l'œil doit porter la classe qui le masque par défaut sans réserver de largeur");
  assert.equal(eyeBtn.classes.has("feuillets-research-item-action"), false, "l'œil n'est plus une action générique à opacité réduite — il a son propre traitement (display: none)");
});

/* ===== préservation des comportements du nom (seul élément cliquable) ===== */

test("clic sur le nom d'un fichier Markdown : ouvre toujours la vue Recherche in situ (outils de citation compris, voir renderFileView)", () => {
  const { view, header, renderCalls } = renderRow(new TFile("Projet/_Recherche/Notes.md"));
  nameElOf(header).click();
  assert.equal(view.viewingFile && view.viewingFile.path, "Projet/_Recherche/Notes.md", "le clic sur le nom doit toujours activer la vue in situ (et ses outils de citation)");
  assert.equal(renderCalls.length, 1, "le panneau doit toujours se rafraîchir pour afficher la fiche");
});

test("clic sur le nom d'une pièce jointe : ouvre toujours son visualiseur natif, comportement inchangé", () => {
  const { header, openCalls } = renderRow(new TFile("Projet/_Recherche/Manuscrit.docx"));
  nameElOf(header).click();
  assert.deepEqual(openCalls, [["tab"]], "une pièce jointe s'ouvre toujours dans un nouvel onglet au clic sur son nom");
});

test("Ctrl/Cmd+clic sur le nom : ouvre toujours dans un nouveau panneau, comportement inchangé", () => {
  const { header, openCalls } = renderRow(new TFile("Projet/_Recherche/Notes.md"));
  const nameEl = nameElOf(header);
  nameEl.events.get("click")[0]({ type: "click", ctrlKey: true, stopPropagation() {} });
  assert.deepEqual(openCalls, [[true]]);
});

test("le nom n'est jamais transformé en bouton générique : \"...\" et l'œil restent des <button> distincts, séparés du nom", () => {
  const { header } = renderRow(new TFile("Projet/_Recherche/Notes.md"));
  const nameEl = nameElOf(header);
  assert.notEqual(nameEl.tag, "button", "le nom reste un simple conteneur cliquable, jamais un <button>");
});

/* ===== non-régression : ouvrir côte à côte (menu ⋯) ===== */

test("ouvrir côte à côte (non-régression) : disponible depuis le menu ⋯ d'un fichier non-média", () => {
  const { byIcon, openCalls } = renderRow(new TFile("Projet/_Recherche/Manuscrit.docx"));
  const moreBtn = byIcon("more-horizontal");
  assert.ok(moreBtn, "le bouton ⋯ doit être présent pour un fichier non-média");

  moreBtn.click();
  assert.ok(Menu.lastShown, "le menu contextuel doit s'ouvrir");
  const splitItem = Menu.lastShown.items.find((i) => i.title === t("binder.research.openSplit"));
  assert.ok(splitItem, "\"Ouvrir côte à côte\" doit être proposé");

  splitItem.callback();
  assert.deepEqual(openCalls, [["split", "vertical"]], "doit ouvrir dans une vue scindée");
});

/* ===== rendu : l'icône Excalidraw est effectivement appliquée par
   renderResearchFileRow (pas seulement calculée par researchFileIcon —
   c'est précisément le bug corrigé ici : l'icône était calculée mais
   jamais posée sur un fichier Markdown). ===== */

test("rendu : l'icône \"pencil\" est effectivement demandée pour un dessin Excalidraw, y compris sa variante de collision", () => {
  for (const name of ["Dessin.excalidraw.md", "Dessin.excalidraw 1.md"]) {
    const { header } = renderRow(new TFile(`Projet/_Recherche/${name}`));
    const icon = iconColumn(header);
    assert.ok(icon, `${name} doit avoir une colonne icône`);
    assert.equal(icon.icon, "pencil", `${name} doit demander l'icône "pencil" (jamais "pencil-ruler")`);
    assert.equal(icon.classes.has("feuillets-research-item-type-badge"), false, `${name} garde une icône, jamais un indicateur textuel`);
  }
});

test("rendu (non-régression) : une note Markdown ordinaire garde l'icône \"file-text\"", () => {
  const { header } = renderRow(new TFile("Projet/_Recherche/Notes.md"));
  const icon = iconColumn(header);
  assert.ok(icon, "une fiche Markdown doit avoir une colonne icône");
  assert.equal(icon.icon, "file-text");
});

test("rendu : exactement une colonne icône par fichier", () => {
  const { header } = renderRow(new TFile("Projet/_Recherche/Dessin.excalidraw.md"));
  const icons = header.findAll((el) => el.classes.has("feuillets-research-item-icon"));
  assert.equal(icons.length, 1);
});

/* ===== indicateurs de type (fichiers documentaires non Markdown) ===== */

test("indicateurs de type : PDF/DOCX/ODT/RTF/EPUB/XLSX/PPTX affichent un petit texte fixe dans la colonne icône, jamais une icône Lucide", () => {
  const cases = [
    ["Source.pdf", "PDF"],
    ["Manuscrit.docx", "DOCX"],
    ["Notes.odt", "ODT"],
    ["Notes.rtf", "RTF"],
    ["Livre.epub", "EPUB"],
    ["Donnees.xlsx", "XLSX"],
    ["Diapo.pptx", "PPTX"],
  ];
  for (const [name, label] of cases) {
    const { header } = renderRow(new TFile(`Projet/_Recherche/${name}`));
    const icon = iconColumn(header);
    assert.ok(icon, `${name} doit avoir une colonne icône`);
    assert.ok(icon.classes.has("feuillets-research-item-type-badge"), `${name} doit utiliser l'indicateur textuel`);
    assert.equal(icon.text, label, `${name} doit afficher "${label}"`);
    assert.equal(icon.icon, undefined, `${name} ne doit jamais demander d'icône Lucide en plus de l'indicateur`);
  }
});

test("indicateurs de type : images, Canvas, Base et Excalidraw gardent leur icône dédiée, jamais un indicateur textuel", () => {
  const cases = [
    ["Portrait.png", "image"],
    ["Tableau.canvas", "layout-dashboard"],
    ["Vue.base", "database"],
    ["Dessin.excalidraw.md", "pencil"],
  ];
  for (const [name, iconName] of cases) {
    const { header } = renderRow(new TFile(`Projet/_Recherche/${name}`));
    const icon = iconColumn(header);
    assert.equal(icon.classes.has("feuillets-research-item-type-badge"), false, `${name} ne doit jamais utiliser l'indicateur textuel`);
    assert.equal(icon.icon, iconName);
  }
});
