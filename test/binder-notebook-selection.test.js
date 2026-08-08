import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";

/* Lot 7 — « Ajouter la sélection au Carnet » : le menu Binder n'est testé
 * qu'à travers `showFileContextMenu`, exactement comme les tests Binder ↔
 * Recherche existants (test/feuillets-view-onboarding.test.js) — jamais en
 * instanciant main.ts (voir Lot 6 : le stub Obsidian de test n'exporte pas
 * `Plugin`, l'import échouerait). */

class FakeElement {
  constructor() {
    this.children = [];
    this.classes = new Set();
  }
  createEl(tag) {
    const el = new FakeElement();
    el.tag = tag;
    this.children.push(el);
    return el;
  }
  createDiv() { return this.createEl("div"); }
  createSpan() { return this.createEl("span"); }
  addClass(c) { this.classes.add(c); return this; }
  setAttr() {}
  empty() { this.children = []; }
  querySelector() { return null; }
}

class TestView extends BaseFeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: new FakeElement() });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

/** Manuscrit A/B/C/D (ordre Binder canonique) + un dossier, une fiche
 * Recherche et une note de dossier — pour tester l'admissibilité ET l'ordre
 * indépendamment de l'ordre d'un `Set` de sélection. */
function makeProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Recherche");
  const chapterFolder = new TFolder("Projet/Manuscrit/Chapitre 1");
  const folderNote = new TFile("Projet/Manuscrit/Chapitre 1/Chapitre 1.md", "Note de dossier");
  const a = new TFile("Projet/Manuscrit/Chapitre 1/A.md", "A");
  const b = new TFile("Projet/Manuscrit/Chapitre 1/B.md", "B");
  const c = new TFile("Projet/Manuscrit/Chapitre 1/C.md", "C");
  const d = new TFile("Projet/Manuscrit/Chapitre 1/D.md", "D");
  const researchFile = new TFile("Projet/Recherche/Ney.md", "Recherche");

  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  manuscript.children = [chapterFolder];
  chapterFolder.parent = manuscript;
  chapterFolder.children = [folderNote, a, b, c, d];
  for (const f of [folderNote, a, b, c, d]) f.parent = chapterFolder;
  research.children = [researchFile];
  researchFile.parent = research;

  const allFiles = new Map();
  for (const f of [volume, manuscript, research, chapterFolder, folderNote, a, b, c, d, researchFile]) {
    allFiles.set(f.path, f);
  }
  const vault = { allFiles, getAbstractFileByPath: (p) => allFiles.get(p) || null };

  // Ordre Binder canonique du manuscrit entier : A, B, C, D (folderNote
  // exclue, comme une vraie note de dossier — jamais listée par
  // flattenFiles dans le vrai service).
  const canonicalOrder = [a, b, c, d];

  return { volume, manuscript, research, chapterFolder, folderNote, a, b, c, d, researchFile, vault, canonicalOrder };
}

function makePlugin(project, overrides = {}) {
  const sceneFiles = new Set([project.a.path, project.b.path, project.c.path, project.d.path]);
  return {
    settings: { projectFolder: project.manuscript.path },
    getProjectFolder: () => project.manuscript,
    // Reflète le vrai `flattenFiles` : ordre Binder canonique, indépendant
    // de tout ordre de sélection.
    flattenFiles: () => project.canonicalOrder,
    isSceneFile: (f) => sceneFiles.has(f.path),
    shortTitleFor: (f) => f.basename,
    titleFor: (f) => f.basename,
    addFileToNotebook: async () => {},
    addFilesToNotebook: async () => {},
    fmOf: () => ({}),
    labelOf: () => "",
    _binderMultiSelect: null,
    ...overrides,
  };
}

function makeApp(project) {
  return {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
}

// F. Menu Binder — un seul feuillet : comportement inchangé.

test("Lot 7 — un seul feuillet sélectionné → « Ajouter au Carnet » (comportement historique inchangé)", () => {
  const project = makeProject();
  const captured = [];
  const plugin = makePlugin(project, { addFileToNotebook: async (f) => captured.push(f) });
  const view = new TestView(makeApp(project), plugin);

  view.showFileContextMenu({ preventDefault() {} }, project.a, project.chapterFolder, 0, []);

  const menu = Menu.lastShown;
  const item = menu.items.find((i) => i.title === "Ajouter au Carnet");
  assert.ok(item, "l'entrée historique doit exister pour un seul feuillet");
  assert.equal(menu.items.some((i) => i.title === "Ajouter la sélection au Carnet"), false);

  item.callback();
  assert.deepEqual(captured, [project.a]);
});

// F. Trois feuillets manuscrit sélectionnés → action batch, ordre Binder.

test("Lot 7 — trois feuillets manuscrit sélectionnés (Cmd-clic dans le désordre) → « Ajouter la sélection au Carnet », appelée dans l'ORDRE BINDER", () => {
  const project = makeProject();
  // Sélection construite volontairement dans le désordre : C, A, B — jamais
  // l'ordre attendu du Carnet.
  const selection = new Set([project.c.path, project.a.path, project.b.path]);
  const captured = [];
  const plugin = makePlugin(project, {
    _binderMultiSelect: selection,
    addFilesToNotebook: async (files) => captured.push(files),
  });
  const view = new TestView(makeApp(project), plugin);

  // Clic droit sur B (un des éléments déjà sélectionnés).
  view.showFileContextMenu({ preventDefault() {} }, project.b, project.chapterFolder, 1, []);

  const menu = Menu.lastShown;
  assert.equal(menu.items.some((i) => i.title === "Ajouter au Carnet"), false, "remplacée, jamais les deux à la fois");
  const item = menu.items.find((i) => i.title === "Ajouter la sélection au Carnet");
  assert.ok(item, "l'entrée batch doit exister");
  assert.equal(item.icon, "notebook");

  item.callback();
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].map((f) => f.path), [project.a.path, project.b.path, project.c.path],
    "A, B, C — jamais C, A, B (ordre du Set de sélection)");
});

// F. Sélection mixte feuillet + dossier → pas d'action batch.

test("Lot 7 — sélection feuillet + dossier → aucune action Carnet (ni batch, ni simple)", () => {
  const project = makeProject();
  const selection = new Set([project.a.path, project.chapterFolder.path]);
  const plugin = makePlugin(project, { _binderMultiSelect: selection });
  const view = new TestView(makeApp(project), plugin);

  view.showFileContextMenu({ preventDefault() {} }, project.a, project.manuscript, 0, []);

  const menu = Menu.lastShown;
  assert.equal(menu.items.some((i) => i.title === "Ajouter la sélection au Carnet"), false);
  assert.equal(menu.items.some((i) => i.title === "Ajouter au Carnet"), false,
    "jamais un repli silencieux sur le seul fichier cliqué");
});

// F. Sélection mixte feuillet manuscrit + Recherche → pas d'action batch.

test("Lot 7 — sélection feuillet manuscrit + fiche Recherche → aucune action Carnet", () => {
  const project = makeProject();
  const selection = new Set([project.a.path, project.researchFile.path]);
  const plugin = makePlugin(project, { _binderMultiSelect: selection });
  const view = new TestView(makeApp(project), plugin);

  view.showFileContextMenu({ preventDefault() {} }, project.a, project.chapterFolder, 0, []);

  const menu = Menu.lastShown;
  assert.equal(menu.items.some((i) => i.title === "Ajouter la sélection au Carnet"), false);
  assert.equal(menu.items.some((i) => i.title === "Ajouter au Carnet"), false);
});

// F. Sélection avec une note de dossier → pas d'action batch (isSceneFile l'exclut).

test("Lot 7 — sélection incluant une note de dossier → aucune action Carnet", () => {
  const project = makeProject();
  const selection = new Set([project.a.path, project.folderNote.path]);
  const plugin = makePlugin(project, { _binderMultiSelect: selection });
  const view = new TestView(makeApp(project), plugin);

  view.showFileContextMenu({ preventDefault() {} }, project.a, project.chapterFolder, 0, []);

  const menu = Menu.lastShown;
  assert.equal(menu.items.some((i) => i.title === "Ajouter la sélection au Carnet"), false);
});

// F. Le clic droit sur un élément déjà sélectionné ne détruit pas la sélection.

test("Lot 7 — le clic droit sur un élément déjà sélectionné préserve la sélection avant l'action batch", () => {
  const project = makeProject();
  const selection = new Set([project.a.path, project.b.path, project.c.path]);
  const captured = [];
  const plugin = makePlugin(project, {
    _binderMultiSelect: selection,
    addFilesToNotebook: async (files) => captured.push(files),
  });
  const view = new TestView(makeApp(project), plugin);

  // ensureSelectionForContextMenu (appelée par le vrai handler DOM, pas ici)
  // ne doit jamais avoir besoin d'intervenir : la sélection existante doit
  // rester intacte quand on clique droit sur un membre déjà sélectionné.
  view.showFileContextMenu({ preventDefault() {} }, project.c, project.chapterFolder, 2, []);
  assert.equal(selection.size, 3, "la sélection n'est jamais vidée par showFileContextMenu");

  const item = Menu.lastShown.items.find((i) => i.title === "Ajouter la sélection au Carnet");
  item.callback();
  assert.deepEqual(captured[0].map((f) => f.path), [project.a.path, project.b.path, project.c.path]);
});
