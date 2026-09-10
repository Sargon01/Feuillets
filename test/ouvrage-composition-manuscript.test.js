import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { manuscriptBodyFiles, CompileSelectionModal } from "../src/ui/selection-modals.js";
import { frontTitleCandidates, FirstPagePanel } from "../src/ui/first-page-panel.js";
import { FrontMatterPanel } from "../src/ui/front-matter-panel.js";
import { BibliographyPanel } from "../src/ui/bibliography-panel.js";
import { AnnexesPanel } from "../src/ui/annexes-panel.js";
import { bibliographyEntriesForEditorialRoot } from "../src/services/bibliography-generator.js";
import {
  contentVariantsFilePath,
  createContentVariant,
  loadContentVariants,
  updateContentVariant,
} from "../src/services/content-variants.js";
import {
  contentExtractionsFilePath,
  createContentExtraction,
  loadContentExtractions,
  updateContentExtraction,
} from "../src/services/content-extractions.js";
import {
  contentCollectionsFilePath,
  createContentCollection,
  loadContentCollections,
  updateContentCollection,
} from "../src/services/content-collections.js";
import { createCompositionBinding } from "../src/services/ouvrage-composition.js";
import { registerOuvrage } from "../src/services/editorial-roots.js";
import { EditionWorkspaceContent } from "../src/ui/edition-workspace-content.js";
import { createFakeVault } from "./helpers/fake-vault.js";

/* Petit DOM factice pour tester les composants sans Obsidian */
class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.classes = new Set();
    this._attributes = new Map();
    this._eventListeners = new Map();
    this.style = {};
  }
  addEventListener(type, listener) {
    if (!this._eventListeners.has(type)) this._eventListeners.set(type, []);
    this._eventListeners.get(type).push(listener);
  }
  dispatch(type, event) {
    const list = this._eventListeners.get(type);
    if (list) [...list].forEach((fn) => fn(event || { target: this }));
  }
  click() {
    if (this.tagName === "INPUT") {
      this.checked = !this.checked;
      this.dispatch("change");
    } else {
      this.dispatch("click");
    }
  }
  toggleClass(cls, val) {
    if (val === undefined) { if (this.classes.has(cls)) this.classes.delete(cls); else this.classes.add(cls); }
    else if (val) this.classes.add(cls);
    else this.classes.delete(cls);
  }
  hasClass(cls) { return this.classes.has(cls); }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(value) { this.children = []; this._text = value; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  addClass(name) { this.classes.add(name); }
  setText(value) { this.textContent = value; }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options.text || "");
    if (options.cls) child.className = options.cls;
    if (options.value !== undefined) child.value = options.value;
    if (options.type !== undefined) child.type = options.type;
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) child.setAttribute(k, v);
    return this.appendChild(child);
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matches(node, selector) {
  const attr = selector.match(/^\[([^=\]]+)="?([^"\]]*)"?\]$/);
  if (attr) return node.getAttribute(attr[1]) === attr[2];
  if (selector.startsWith(".")) return node.classes.has(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

function installDom() {
  const previous = { createEl: globalThis.createEl, createDiv: globalThis.createDiv, createSpan: globalThis.createSpan };
  globalThis.createEl = (tag, options = {}) => { const el = new FakeElement(tag, options.text || ""); if (options.cls) el.className = options.cls; return el; };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
  return () => {
    globalThis.createEl = previous.createEl;
    globalThis.createDiv = previous.createDiv;
    globalThis.createSpan = previous.createSpan;
  };
}

/** Crée un environnement complet avec WARPI, NEFES et AUTRE_TOME */
function buildManuscriptEnvironment() {
  const warpi = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const courriers = new TFolder("WARPI/Courriers");
  const cours = new TFolder("WARPI/Cours");
  const autreTome = new TFolder("WARPI/AUTRE_TOME");
  nefes.parent = warpi;
  courriers.parent = warpi;
  cours.parent = warpi;
  autreTome.parent = warpi;
  warpi.children = [nefes, courriers, cours, autreTome];

  const chap1 = new TFile("WARPI/NEFES/Chapitre 1.md", "---\ntitle: Chapitre 1\ncompile: true\n---\nContenu 1.");
  chap1.extension = "md";
  chap1.parent = nefes;

  const chap2 = new TFile("WARPI/NEFES/Chapitre 2.md", "---\ntitle: Chapitre 2\ncompile: false\n---\nContenu 2.");
  chap2.extension = "md";
  chap2.parent = nefes;
  nefes.children = [chap1, chap2];

  const lettre = new TFile("WARPI/Courriers/Lettre.md", "---\ntitle: Lettre\ncompile: true\n---\nLettre.");
  lettre.extension = "md";
  lettre.parent = courriers;
  courriers.children = [lettre];

  const lecon = new TFile("WARPI/Cours/Lecon.md", "---\ntitle: Lecon\ncompile: true\n---\nLecon.");
  lecon.extension = "md";
  lecon.parent = cours;
  cours.children = [lecon];

  const introAutre = new TFile("WARPI/AUTRE_TOME/Intro.md", "---\ntitle: Intro Autre\ncompile: true\n---\nIntro.");
  introAutre.extension = "md";
  introAutre.parent = autreTome;
  autreTome.children = [introAutre];

  const entries = [warpi, nefes, courriers, cours, autreTome, chap1, chap2, lettre, lecon, introAutre];
  const { vault, files } = createFakeVault(entries);
  vault.files = files;

  const fileFrontmatters = new Map([
    [chap1.path, { compile: true }],
    [chap2.path, { compile: false }],
    [lettre.path, { compile: true }],
    [lecon.path, { compile: true }],
    [introAutre.path, { compile: true }],
  ]);

  const fileManager = {
    processFrontMatter: async (file, fn) => {
      const data = { ...(fileFrontmatters.get(file.path) || {}) };
      fn(data);
      fileFrontmatters.set(file.path, data);
    },
  };

  const app = {
    vault,
    fileManager,
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: fileFrontmatters.get(file.path) || {},
      }),
    },
  };

  const settings = {
    projectFolder: "WARPI",
    orders: {},
    folderPositions: {},
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: false,
    separator: "\n\n",
    footnoteRenumberOnCompile: true,
    level1Role: "parties",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    autoRename: true,
    renamePrefix: "chapitre",
    compileFileName: "Manuscrit.md",
    activePreset: -1,
    compilePresets: [
      { name: "Preset 1", fileName: "Sortie.md", folderTitles: true, chapterTitles: true, sceneTitles: false },
    ],
    projectMeta: {},
  };

  registerOuvrage(settings, warpi, nefes);
  registerOuvrage(settings, warpi, autreTome);

  const plugin = {
    settings,
    app,
    getProjectFolder: () => warpi,
    saveSettings: async () => {},
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshBinderViews: () => {},
    renderAllViews: () => {},
    fmOf: (file) => fileFrontmatters.get(file.path) || {},
    shortTitleFor: (file) => file.basename || file.path.split("/").pop().replace(/\.md$/, ""),
    editorialRootForComposition: () => nefes,
  };

  return { warpi, nefes, courriers, cours, autreTome, chap1, chap2, lettre, lecon, introAutre, app, plugin, settings, fileFrontmatters, vault };
}

/* ========================================================================== */
/* TEST 1 : Contenu du manuscrit (CompileSelectionModal avec editorialRoot)   */
/* ========================================================================== */
test("LOT 5B — Test 1 : Contenu du manuscrit restreint strictement à NEFES (Courriers, Cours, AUTRE_TOME exclus)", async () => {
  const restoreDom = installDom();
  try {
    const env = buildManuscriptEnvironment();
    const { app, plugin, nefes, chap1, chap2, lettre, lecon, introAutre } = env;

    // 1. manuscriptBodyFiles sur NEFES ne renvoie que les fichiers de NEFES
    const bodyFiles = manuscriptBodyFiles(app, plugin.settings, nefes);
    assert.deepEqual(bodyFiles.map((f) => f.path), [chap1.path, chap2.path]);
    assert.ok(!bodyFiles.some((f) => f.path.includes("Courriers")));
    assert.ok(!bodyFiles.some((f) => f.path.includes("Cours")));
    assert.ok(!bodyFiles.some((f) => f.path.includes("AUTRE_TOME")));

    // 2. CompileSelectionModal avec editorialRoot = NEFES
    const modal = new CompileSelectionModal(app, plugin, nefes);
    modal.modalEl = new FakeElement("div");
    modal.contentEl = new FakeElement("div");
    modal.onOpen();

    // Vérification du compteur dans la modale : 1 sur 2 (chap1=true, chap2=false)
    const counterEl = modal.contentEl.querySelector(".feuillets-compile-selection-counter");
    assert.ok(counterEl.textContent.includes("1 sur 2"), "Compteur restreint à NEFES");

    // Bouton Tout
    const buttons = modal.contentEl.querySelectorAll("button");
    const selectAllBtn = buttons.find((b) => b.textContent === "Tout");
    selectAllBtn.click();

    // Sauvegarde
    const saveBtn = buttons.find((b) => b.textContent === "Enregistrer");
    saveBtn.click();
    await Promise.resolve(); await Promise.resolve();

    // Seul chap2 a été modifié
    assert.equal(plugin.fmOf(chap1).compile, true);
    assert.notEqual(plugin.fmOf(chap2).compile, false);

    // Les fichiers extérieurs n'ont JAMAIS été touchés
    assert.equal(plugin.fmOf(lettre).compile, true);
    assert.equal(plugin.fmOf(lecon).compile, true);
    assert.equal(plugin.fmOf(introAutre).compile, true);
  } finally {
    restoreDom();
  }
});

/* ========================================================================== */
/* TEST 2 : Première page (FirstPagePanel avec editorialRoot = NEFES)         */
/* ========================================================================== */
test("LOT 5B — Test 2 : Première page ne retient que les pages de titre de NEFES", () => {
  const env = buildManuscriptEnvironment();
  const { app, plugin, warpi, nefes, autreTome, vault } = env;

  const warpiFront = new TFolder("WARPI/Front");
  warpiFront.parent = warpi;
  const titreWarpi = new TFile("WARPI/Front/Titre Global.md", "---\ntitle: Titre Global\ntype: titre\n---");
  titreWarpi.extension = "md";
  titreWarpi.parent = warpiFront;
  warpiFront.children = [titreWarpi];
  warpi.children.push(warpiFront);
  vault.files.set(warpiFront.path, warpiFront);
  vault.files.set(titreWarpi.path, titreWarpi);

  const nefesFront = new TFolder("WARPI/NEFES/Front");
  nefesFront.parent = nefes;
  const titreNefes = new TFile("WARPI/NEFES/Front/Titre NEFES.md", "---\ntitle: Titre NEFES\ntype: titre\n---");
  titreNefes.extension = "md";
  titreNefes.parent = nefesFront;
  nefesFront.children = [titreNefes];
  nefes.children.push(nefesFront);
  vault.files.set(nefesFront.path, nefesFront);
  vault.files.set(titreNefes.path, titreNefes);

  const autreFront = new TFolder("WARPI/AUTRE_TOME/Front");
  autreFront.parent = autreTome;
  const titreAutre = new TFile("WARPI/AUTRE_TOME/Front/Titre Autre.md", "---\ntitle: Titre Autre\ntype: titre\n---");
  titreAutre.extension = "md";
  titreAutre.parent = autreFront;
  autreFront.children = [titreAutre];
  autreTome.children.push(autreFront);
  vault.files.set(autreFront.path, autreFront);
  vault.files.set(titreAutre.path, titreAutre);

  app.metadataCache.getFileCache = (file) => {
    if (file.path === titreWarpi.path) return { frontmatter: { type: "titre" } };
    if (file.path === titreNefes.path) return { frontmatter: { type: "titre" } };
    if (file.path === titreAutre.path) return { frontmatter: { type: "titre" } };
    return { frontmatter: {} };
  };

  const candidates = frontTitleCandidates(app, plugin, nefes);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].path, titreNefes.path, "Seul le titre de NEFES est retourné");

  const container = new FakeElement("div");
  const panel = new FirstPagePanel(app, plugin, container, {}, nefes);
  assert.deepEqual(panel.frontTitleCandidates().map((f) => f.path), [titreNefes.path]);
});

/* ========================================================================== */
/* TEST 3 : Pages liminaires (FrontMatterPanel avec editorialRoot = NEFES)    */
/* ========================================================================== */
test("LOT 5B — Test 3 : Pages liminaires restreintes au dossier Front de NEFES", async () => {
  const restoreDom = installDom();
  try {
    const env = buildManuscriptEnvironment();
    const { app, plugin, warpi, nefes, vault } = env;

    const warpiFront = new TFolder("WARPI/Front");
    warpiFront.parent = warpi;
    const dedicaceWarpi = new TFile("WARPI/Front/Dédicace Global.md", "---\ntitle: Dédicace Global\n---");
    dedicaceWarpi.extension = "md";
    dedicaceWarpi.parent = warpiFront;
    warpiFront.children = [dedicaceWarpi];
    warpi.children.push(warpiFront);
    vault.files.set(warpiFront.path, warpiFront);
    vault.files.set(dedicaceWarpi.path, dedicaceWarpi);

    const nefesFront = new TFolder("WARPI/NEFES/Front");
    nefesFront.parent = nefes;
    const dedicaceNefes = new TFile("WARPI/NEFES/Front/Dédicace NEFES.md", "---\ntitle: Dédicace NEFES\n---");
    dedicaceNefes.extension = "md";
    dedicaceNefes.parent = nefesFront;
    nefesFront.children = [dedicaceNefes];
    nefes.children.push(nefesFront);
    vault.files.set(nefesFront.path, nefesFront);
    vault.files.set(dedicaceNefes.path, dedicaceNefes);

    app.metadataCache.getFileCache = () => ({ frontmatter: {} });

    const container = new FakeElement("div");
    const panel = new FrontMatterPanel(app, plugin, container, {}, nefes);
    await panel.renderExpandedList(container);

    assert.equal(panel.pages().length, 1);
    assert.equal(panel.pages()[0].path, dedicaceNefes.path);

    const keys = container.querySelectorAll(".feuillets-properties-key");
    assert.equal(keys.length, 1);
    assert.ok(keys[0].textContent.includes("Dédicace NEFES"));

    // Cas d'un ouvrage sans dossier Front : état vide, aucun repli sur WARPI
    const videFolder = new TFolder("WARPI/VIDE");
    videFolder.parent = warpi;
    vault.files.set(videFolder.path, videFolder);
    const containerVide = new FakeElement("div");
    const panelVide = new FrontMatterPanel(app, plugin, containerVide, {}, videFolder);
    await panelVide.renderExpandedList(containerVide);
    assert.equal(panelVide.pages().length, 0);
    assert.ok(!containerVide.textContent.includes("Dédicace Global"));
  } finally {
    restoreDom();
  }
});

/* ========================================================================== */
/* TEST 4 : Variantes (content-variants.ts avec editorialRoot = NEFES)        */
/* ========================================================================== */
test("LOT 5B — Test 4 : Variantes stockées dans NEFES et préservent les métadonnées", async () => {
  const env = buildManuscriptEnvironment();
  const { app, plugin, warpi, nefes } = env;

  const nefesPath = contentVariantsFilePath(app, plugin.settings, nefes);
  const warpiPath = contentVariantsFilePath(app, plugin.settings, warpi);
  assert.ok(nefesPath.includes("NEFES"));
  assert.ok(!warpiPath.includes("NEFES"));

  const variant = await createContentVariant(app, plugin.settings, "Variante NEFES", ["introduction"], "keep", nefes);
  assert.ok(variant.id);

  const nefesStore = await loadContentVariants(app, plugin.settings, nefes);
  assert.equal(nefesStore.variants.length, 1);
  assert.equal(nefesStore.variants[0].name, "Variante NEFES");

  const warpiStore = await loadContentVariants(app, plugin.settings, warpi);
  assert.equal(warpiStore.variants.length, 0);

  await updateContentVariant(app, plugin.settings, variant.id, { name: "NEFES Modifiée", excludedRoles: ["introduction"], questionAnswerSpace: "keep" }, nefes);
  const updatedStore = await loadContentVariants(app, plugin.settings, nefes);
  assert.equal(updatedStore.variants[0].name, "NEFES Modifiée");
  assert.deepEqual(updatedStore.variants[0].excludedRoles, ["introduction"]);
});

/* ========================================================================== */
/* TEST 5 : Extractions (content-extractions.ts avec editorialRoot = NEFES)    */
/* ========================================================================== */
test("LOT 5B — Test 5 : Extractions stockées dans NEFES et indépendantes", async () => {
  const env = buildManuscriptEnvironment();
  const { app, plugin, warpi, nefes } = env;

  const nefesPath = contentExtractionsFilePath(app, plugin.settings, nefes);
  assert.ok(nefesPath.includes("NEFES"));

  const extraction = await createContentExtraction(app, plugin.settings, "Extrait NEFES", ["introduction"], nefes);
  const nefesStore = await loadContentExtractions(app, plugin.settings, nefes);
  assert.equal(nefesStore.extractions.length, 1);
  assert.equal(nefesStore.extractions[0].name, "Extrait NEFES");

  const warpiStore = await loadContentExtractions(app, plugin.settings, warpi);
  assert.equal(warpiStore.extractions.length, 0);

  await updateContentExtraction(app, plugin.settings, extraction.id, { name: "Extrait Renommé", triggerRoles: ["introduction"] }, nefes);
  const updatedStore = await loadContentExtractions(app, plugin.settings, nefes);
  assert.equal(updatedStore.extractions[0].name, "Extrait Renommé");
  assert.deepEqual(updatedStore.extractions[0].triggerRoles, ["introduction"]);
});

/* ========================================================================== */
/* TEST 6 : Collections (content-collections.ts avec editorialRoot = NEFES)    */
/* ========================================================================== */
test("LOT 5B — Test 6 : Collections stockées dans NEFES et indépendantes", async () => {
  const env = buildManuscriptEnvironment();
  const { app, plugin, warpi, nefes } = env;

  const nefesPath = contentCollectionsFilePath(app, plugin.settings, nefes);
  assert.ok(nefesPath.includes("NEFES"));

  const collection = await createContentCollection(app, plugin.settings, "Collection NEFES", ["definition"], nefes);
  const nefesStore = await loadContentCollections(app, plugin.settings, nefes);
  assert.equal(nefesStore.collections.length, 1);
  assert.equal(nefesStore.collections[0].name, "Collection NEFES");

  const warpiStore = await loadContentCollections(app, plugin.settings, warpi);
  assert.equal(warpiStore.collections.length, 0);

  await updateContentCollection(app, plugin.settings, collection.id, { name: "Collection Renommée", roles: ["definition"] }, nefes);
  const updatedStore = await loadContentCollections(app, plugin.settings, nefes);
  assert.equal(updatedStore.collections[0].name, "Collection Renommée");
  assert.deepEqual(updatedStore.collections[0].roles, ["definition"]);
});

/* ========================================================================== */
/* TEST 7 : Bibliographie (fonction partagée unique & 0 repli sur WARPI)       */
/* ========================================================================== */
test("LOT 5B — Test 7 : Bibliographie retourne [] et décompte 0 pour un ouvrage sans sources", () => {
  const env = buildManuscriptEnvironment();
  const { app, plugin, warpi, nefes, vault } = env;

  const warpiRecherche = new TFolder("WARPI/_Recherche");
  warpiRecherche.parent = warpi;
  const warpiBiblio = new TFolder("WARPI/_Recherche/Bibliographie");
  warpiBiblio.parent = warpiRecherche;
  const ficheGlobal = new TFile("WARPI/_Recherche/Bibliographie/Fiche Global.md", "---\ntitle: Fiche Global\n---");
  ficheGlobal.extension = "md";
  ficheGlobal.parent = warpiBiblio;
  warpiBiblio.children = [ficheGlobal];
  warpiRecherche.children = [warpiBiblio];
  warpi.children.push(warpiRecherche);
  vault.files.set(warpiRecherche.path, warpiRecherche);
  vault.files.set(warpiBiblio.path, warpiBiblio);
  vault.files.set(ficheGlobal.path, ficheGlobal);

  const globalEntries = bibliographyEntriesForEditorialRoot(app, plugin.settings, warpi);
  assert.equal(globalEntries.length, 1);

  const nefesEntries = bibliographyEntriesForEditorialRoot(app, plugin.settings, nefes);
  assert.deepEqual(nefesEntries, [], "Aucun repli vers la recherche globale");

  const binding = createCompositionBinding(plugin, warpi, nefes);
  const container = new FakeElement("div");
  const panel = new BibliographyPanel(app, plugin, container, binding, {}, nefes);
  assert.equal(panel.referenceCount(), 0);

  const nefesRecherche = new TFolder("WARPI/NEFES/_Recherche");
  nefesRecherche.parent = nefes;
  const nefesBiblio = new TFolder("WARPI/NEFES/_Recherche/Bibliographie");
  nefesBiblio.parent = nefesRecherche;
  const ficheNefes = new TFile("WARPI/NEFES/_Recherche/Bibliographie/Fiche NEFES.md", "---\ntitle: Fiche NEFES\n---");
  ficheNefes.extension = "md";
  ficheNefes.parent = nefesBiblio;
  nefesBiblio.children = [ficheNefes];
  nefesRecherche.children = [nefesBiblio];
  nefes.children.push(nefesRecherche);
  vault.files.set(nefesRecherche.path, nefesRecherche);
  vault.files.set(nefesBiblio.path, nefesBiblio);
  vault.files.set(ficheNefes.path, ficheNefes);

  app.metadataCache.getFileCache = (file) => {
    if (file.path === ficheGlobal.path) return { frontmatter: { title: "Fiche Global" } };
    if (file.path === ficheNefes.path) return { frontmatter: { title: "Fiche NEFES" } };
    return { frontmatter: {} };
  };

  const localEntries = bibliographyEntriesForEditorialRoot(app, plugin.settings, nefes);
  assert.equal(localEntries.length, 1);
  assert.equal(localEntries[0].title, "Fiche NEFES");
  const panelWithLocal = new BibliographyPanel(app, plugin, container, binding, {}, nefes);
  assert.equal(panelWithLocal.referenceCount(), 1);
});

/* ========================================================================== */
/* TEST 8 : Annexes (AnnexesPanel avec editorialRoot = NEFES)                 */
/* ========================================================================== */
test("LOT 5B — Test 8 : Annexes restreintes au dossier Annexes de NEFES", () => {
  const env = buildManuscriptEnvironment();
  const { app, plugin, warpi, nefes, vault } = env;

  const warpiAnnexes = new TFolder("WARPI/Annexes");
  warpiAnnexes.parent = warpi;
  const annexeGlobal = new TFile("WARPI/Annexes/Annexe Global.md", "---\ntitle: Annexe Global\n---");
  annexeGlobal.extension = "md";
  annexeGlobal.parent = warpiAnnexes;
  warpiAnnexes.children = [annexeGlobal];
  warpi.children.push(warpiAnnexes);
  vault.files.set(warpiAnnexes.path, warpiAnnexes);
  vault.files.set(annexeGlobal.path, annexeGlobal);

  const nefesAnnexes = new TFolder("WARPI/NEFES/Annexes");
  nefesAnnexes.parent = nefes;
  const annexeNefes = new TFile("WARPI/NEFES/Annexes/Annexe NEFES.md", "---\ntitle: Annexe NEFES\n---");
  annexeNefes.extension = "md";
  annexeNefes.parent = nefesAnnexes;
  nefesAnnexes.children = [annexeNefes];
  nefes.children.push(nefesAnnexes);
  vault.files.set(nefesAnnexes.path, nefesAnnexes);
  vault.files.set(annexeNefes.path, annexeNefes);

  const binding = createCompositionBinding(plugin, warpi, nefes);
  const container = new FakeElement("div");
  const panel = new AnnexesPanel(app, plugin, container, binding, nefes, {});
  assert.equal(panel.fileCount(), 1);

  const videFolder = new TFolder("WARPI/VIDE");
  videFolder.parent = warpi;
  vault.files.set(videFolder.path, videFolder);
  const panelVide = new AnnexesPanel(app, plugin, container, binding, videFolder, {});
  assert.equal(panelVide.fileCount(), 0);
});

/* ========================================================================== */
/* TEST 9 : Exactement un rafraîchissement & portée conservée                */
/* ========================================================================== */
test("LOT 5B — Test 9 : Exactement 1 refreshPreview() et compileScope conservée sur update, reset et preset", async () => {
  const restoreDom = installDom();
  try {
    const env = buildManuscriptEnvironment();
    const { warpi, nefes, plugin, app } = env;

    let refreshCalls = 0;
    const initialScope = { type: "folder", projectRoot: "WARPI/NEFES", folder: nefes };
    const preview = {
      compileScope: initialScope,
      refreshPreview: async () => {
        refreshCalls++;
        assert.equal(preview.compileScope, initialScope);
      },
      refreshForLayoutChange: async () => {
        await preview.refreshPreview();
      },
    };

    plugin.getCentralPreviewView = () => preview;

    // 1. update() via le binding direct
    refreshCalls = 0;
    const binding = createCompositionBinding(plugin, warpi, nefes);
    await binding.update({ separator: "---" });
    assert.equal(refreshCalls, 1, "update() appelle refreshPreview() exactement 1 fois");
    assert.equal(preview.compileScope, initialScope, "la portée reste strictement inchangée");

    // 2. resetToProject() via le binding direct
    refreshCalls = 0;
    await binding.resetToProject();
    assert.equal(refreshCalls, 1, "resetToProject() appelle refreshPreview() exactement 1 fois");
    assert.equal(preview.compileScope, initialScope, "la portée reste strictement inchangée");

    // 3. Application d'un preset via EditionCompositionContent dans EditionWorkspaceContent
    const workspaceContainer = new FakeElement("div");
    const previewLeaf = { view: preview };
    app.workspace = {
      getLeavesOfType: () => [previewLeaf],
    };

    const workspace = new EditionWorkspaceContent(app, plugin, workspaceContainer, {
      initialMode: "composition",
      linkedPreviewLeaf: previewLeaf,
    });
    await workspace.render();

    refreshCalls = 0;
    const compContent = workspace["compositionContent"];
    assert.ok(compContent, "EditionCompositionContent monté");

    await compContent["runApplyPreset"](0);
    assert.equal(refreshCalls, 1, "applyPreset appelle refreshPreview() exactement 1 fois (0 doublon)");
    assert.equal(preview.compileScope, initialScope, "la portée reste strictement inchangée");
  } finally {
    restoreDom();
  }
});

/* ========================================================================== */
/* TEST 10 : Non-régression WARPI (portée globale inchangée)                   */
/* ========================================================================== */
test("LOT 5B — Test 10 : Non-régression WARPI (comportement historique intégral conservé)", async () => {
  const env = buildManuscriptEnvironment();
  const { app, plugin, warpi, chap1, chap2, lettre, lecon, introAutre } = env;

  const allFiles = manuscriptBodyFiles(app, plugin.settings, warpi);
  assert.ok(allFiles.some((f) => f.path === chap1.path));
  assert.ok(allFiles.some((f) => f.path === chap2.path));
  assert.ok(allFiles.some((f) => f.path === lettre.path));
  assert.ok(allFiles.some((f) => f.path === lecon.path));
  assert.ok(allFiles.some((f) => f.path === introAutre.path));

  const warpiBinding = createCompositionBinding(plugin, warpi, warpi);
  assert.equal(warpiBinding.isOuvrage, false);
  assert.equal(warpiBinding.isInherited, false);

  await warpiBinding.update({ separator: "GLOBAL-SEP" });
  assert.equal(plugin.settings.separator, "GLOBAL-SEP");
});
