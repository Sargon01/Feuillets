import { test } from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile, TFolder } from "obsidian";
import { addOpenWithPreviewItem } from "../src/views/preview-view.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";

/* Défaut confirmé manuellement : « Ouvrir avec aperçu » n'apparaissait pas
 * au clic droit dans le Binder.
 *
 * DEUX causes, corrigées l'une après l'autre :
 *  1. le Binder construit son PROPRE `Menu`
 *     (BaseFeuilletsView.showFileContextMenu) et ne passe jamais par le hook
 *     `workspace.on("file-menu")` où l'entrée avait d'abord été posée ;
 *  2. la condition d'affichage exigeait `roleOfFile(...) === "scene"`. Dans
 *     une structure Partie → feuillets (le cas dès que `level1Role` vaut
 *     « parties », ce qui est la configuration réelle du projet de l'autrice
 *     comme du projet de démonstration Candide), ces feuillets sont classés
 *     « chapitre » : l'entrée restait invisible partout.
 *
 * Ces tests EXÉCUTENT le callback réel de l'entrée, et construisent le VRAI
 * menu du Binder : vérifier que la chaîne existe dans le code ne prouverait
 * rien. */

function buildProject({ level1Role = "chapitres" } = {}) {
  const root = new TFolder("Roman/Manuscrit");
  root.path = "Roman/Manuscrit";
  root.name = "Manuscrit";

  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.name = "Chapitre 1";
  chapter.parent = root;
  root.children = [chapter];

  // Une VRAIE scène : fichier dans un dossier-chapitre.
  const scene = new TFile("Roman/Manuscrit/Chapitre 1/01 Été.md", "Texte.");
  scene.path = "Roman/Manuscrit/Chapitre 1/01 Été.md";
  scene.name = "01 Été.md";
  scene.basename = "01 Été";
  scene.extension = "md";
  scene.parent = chapter;
  chapter.children = [scene];

  // Un feuillet posé à la racine du manuscrit : roleOfFile le classe
  // « chapitre ». Il reste un feuillet Markdown parfaitement éditable, donc
  // parfaitement affichable dans l'aperçu.
  const chapterFile = new TFile("Roman/Manuscrit/Prologue.md", "Texte.");
  chapterFile.path = "Roman/Manuscrit/Prologue.md";
  chapterFile.name = "Prologue.md";
  chapterFile.basename = "Prologue";
  chapterFile.extension = "md";
  chapterFile.parent = root;
  root.children.push(chapterFile);

  // Une fiche HORS projet : jamais concernée par l'aperçu du manuscrit.
  const outside = new TFile("Roman/Recherche/Personnages.md", "Fiche.");
  outside.path = "Roman/Recherche/Personnages.md";
  outside.name = "Personnages.md";
  outside.basename = "Personnages";
  outside.extension = "md";
  outside.parent = new TFolder("Roman/Recherche");

  // Le manuscrit compilé : une SORTIE, pas un feuillet à écrire.
  const compiled = new TFile("Roman/Manuscrit/Manuscrit.md", "Tout le texte.");
  compiled.path = "Roman/Manuscrit/Manuscrit.md";
  compiled.name = "Manuscrit.md";
  compiled.basename = "Manuscrit";
  compiled.extension = "md";
  compiled.parent = root;

  const settings = {
    projectFolder: "Roman/Manuscrit",
    level1Role,
    compileFileName: "Manuscrit.md",
    orders: {},
    folderPositions: {},
    labels: [],
    statuses: [],
    projectMeta: {},
  };

  return { root, chapter, scene, chapterFile, outside, compiled, settings };
}

/** Espace de travail minimal, qui enregistre RÉELLEMENT ce que le callback
 *  d'« Ouvrir avec aperçu » fait : fichier ouvert, feuilles créées, focus. */
function buildWorkspace() {
  const opened = { files: [], viewStates: [], revealed: 0, activeLeafSet: 0 };
  const previewLeaves = [];
  const workspace = {
    getLeaf: (kind) => {
      const leaf = {
        kind,
        openFile: async (f) => { opened.files.push({ kind, path: f.path }); },
        setViewState: async (state) => { opened.viewStates.push(state); previewLeaves.push(leaf); },
      };
      return leaf;
    },
    getLeavesOfType: () => previewLeaves,
    revealLeaf: () => { opened.revealed++; },
    setActiveLeaf: () => { opened.activeLeafSet++; },
  };
  return { workspace, opened };
}

function buildApp(project, workspace) {
  return {
    workspace,
    /* roleOfFile/getProjectFolder résolvent la racine du projet DANS LE
       COFFRE : sans ce lookup, la racine vaut null et rien n'est reconnu. */
    vault: {
      getAbstractFileByPath: (p) => (p === project.root.path ? project.root : null),
      read: async () => "Texte.",
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    fileManager: { processFrontMatter: async () => {}, trashFile: async () => {} },
  };
}

/** Construit le menu via le helper partagé (chemin utilisé par le Binder,
 *  le Tableau et la vue Scènes). */
function openContextMenu(file, project) {
  const { workspace, opened } = buildWorkspace();
  const plugin = {
    settings: project.settings,
    getProjectFolder: () => project.root,
    saveSettings: async () => {},
  };
  const app = buildApp(project, workspace);
  const menu = new Menu();
  const added = addOpenWithPreviewItem(menu, app, plugin, file);
  return { menu, added, opened, settings: project.settings, plugin };
}

const ENTRY_TITLE = "Ouvrir avec aperçu";

function entryOf(menu) {
  return menu.items.find((i) => i.title === ENTRY_TITLE);
}

test("menu contextuel : entrée présente sur une scène, et son callback ouvre réellement les deux feuilles", async () => {
  const project = buildProject();
  const { menu, added, opened, settings } = openContextMenu(project.scene, project);

  assert.equal(added, true, "l'entrée doit être ajoutée pour une scène");
  const entry = entryOf(menu);
  assert.ok(entry);
  assert.equal(entry.icon, "eye");

  // EXÉCUTION RÉELLE du callback — vérifier la présence d'une chaîne dans
  // le code ne prouverait rien.
  entry.callback();
  await new Promise((r) => globalThis.setTimeout(r, 0));

  assert.deepEqual(opened.files.map((f) => f.path), ["Roman/Manuscrit/Chapitre 1/01 Été.md"]);
  assert.equal(opened.viewStates.length, 1, "un seul aperçu créé");
  assert.equal(opened.viewStates[0].type, "feuillets-manuscript-preview");
  assert.equal(settings.previewMode, "scene", "l'aperçu doit s'ouvrir en mode Scène");
  assert.ok(opened.activeLeafSet > 0, "le focus doit revenir à l'écriture");
});

test("menu contextuel : un feuillet classé « chapitre » reste ouvrable avec l'aperçu (cause du défaut)", () => {
  // Structure Partie → feuillets, la configuration réelle du projet : ces
  // feuillets ne sont pas des « scènes » au sens de roleOfFile, et l'entrée
  // n'apparaissait donc JAMAIS.
  const parties = buildProject({ level1Role: "parties" });
  const inPartie = openContextMenu(parties.scene, parties);
  assert.equal(inPartie.added, true, "un feuillet rangé sous une Partie doit rester ouvrable");

  // Feuillet posé directement à la racine du manuscrit : même conclusion.
  const flat = buildProject();
  assert.equal(openContextMenu(flat.chapterFile, flat).added, true);
});

test("menu contextuel : entrée absente hors projet, hors Markdown et sur le manuscrit compilé", () => {
  const project = buildProject();

  assert.equal(openContextMenu(project.outside, project).added, false, "fiche hors du manuscrit");
  assert.equal(openContextMenu(project.compiled, project).added, false, "sortie de compilation");

  const image = new TFile("Roman/Manuscrit/Chapitre 1/carte.png", "");
  image.extension = "png";
  image.parent = project.chapter;
  assert.equal(openContextMenu(image, project).added, false, "fichier non éditable");

  // Un dossier n'est pas un TFile : la fonction doit le refuser sans lever.
  assert.equal(openContextMenu(project.chapter, project).added, false, "dossier");
});

test("menu contextuel : une PreviewView déjà ouverte est réutilisée, jamais dupliquée", async () => {
  const project = buildProject();
  const { menu, opened } = openContextMenu(project.scene, project);
  const entry = entryOf(menu);

  entry.callback();
  await new Promise((r) => globalThis.setTimeout(r, 0));
  assert.equal(opened.viewStates.length, 1);

  // Deuxième appel : l'aperçu existe déjà, aucune feuille supplémentaire.
  entry.callback();
  await new Promise((r) => globalThis.setTimeout(r, 0));
  assert.equal(opened.viewStates.length, 1, "aucun aperçu dupliqué");
  assert.equal(opened.files.length, 2, "la scène est bien rouverte à chaque fois");
});

/* ================= Le VRAI menu contextuel du Binder =================
   Ce qui précède teste le helper. Ci-dessous, on construit le menu que le
   Binder Feuillets construit réellement au clic droit
   (BaseFeuilletsView.showFileContextMenu) : c'est le seul test qui aurait
   attrapé le défaut d'origine, où l'entrée existait mais n'était jamais
   ajoutée à CE menu-là. */

class TestBinderView extends BaseFeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: null });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

function buildBinder(project) {
  const { workspace, opened } = buildWorkspace();
  const app = buildApp(project, workspace);
  const plugin = {
    settings: project.settings,
    getProjectFolder: () => project.root,
    saveSettings: async () => {},
    fmOf: () => ({}),
    labelOf: () => "",
    titleFor: (f) => f.basename,
    newSheetAt: () => {},
    newSheet: () => {},
    newFolder: () => {},
    renderAllViews: () => {},
    snapshotFile: async () => "",
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    /* Association Binder ↔ Recherche : le menu de dossier appelle
       getLinkedResearchFolder dès sa construction (voir
       base-feuillets-view.ts, showFolderContextMenu) — sans stub, le clic
       droit d'un dossier lève une erreur. */
    getLinkedResearchFolder: () => null,
    getResearchRoot: () => null,
  };
  return { view: new TestBinderView(app, plugin), opened, project };
}

test("Binder — le menu contextuel RÉEL propose « Ouvrir avec aperçu » sur un feuillet", async () => {
  // Structure Partie → feuillets : exactement le cas qui ne marchait pas.
  const project = buildProject({ level1Role: "parties" });
  const { view, opened } = buildBinder(project);

  view.showFileContextMenu({ preventDefault() {} }, project.scene, project.chapter, 0, []);
  const menu = Menu.lastShown;
  assert.ok(menu, "le Binder doit avoir affiché son menu");

  const entry = entryOf(menu);
  assert.ok(entry, "« Ouvrir avec aperçu » doit figurer dans le menu du Binder");
  assert.equal(entry.icon, "eye");

  entry.callback();
  await new Promise((r) => globalThis.setTimeout(r, 0));
  assert.deepEqual(opened.files.map((f) => f.path), [project.scene.path]);
  assert.equal(opened.viewStates.length, 1, "une feuille adjacente d'aperçu est créée");
  assert.equal(opened.viewStates[0].type, "feuillets-manuscript-preview");

  // Deuxième clic droit : l'aperçu existant est réutilisé.
  view.showFileContextMenu({ preventDefault() {} }, project.scene, project.chapter, 0, []);
  entryOf(Menu.lastShown).callback();
  await new Promise((r) => globalThis.setTimeout(r, 0));
  assert.equal(opened.viewStates.length, 1, "aucun second aperçu");
});

test("Binder — le menu contextuel d'un DOSSIER ne propose pas l'aperçu", () => {
  const project = buildProject();
  const { view } = buildBinder(project);

  view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, []);
  const menu = Menu.lastShown;
  assert.ok(menu);
  assert.equal(entryOf(menu), undefined, "un dossier (partie/chapitre) n'est pas ouvrable dans l'aperçu");
});
