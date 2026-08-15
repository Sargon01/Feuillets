import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, Notice, TFile, TFolder } from "obsidian";
import { NewProjectModal, OpenExistingFolderModal, TransformToProjectModal } from "../src/ui/project-modals.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { fr } from "../src/i18n/fr.js";
import { en } from "../src/i18n/en.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = options.value ?? "";
    this.text = options.text ?? "";
    this.attributes = { ...(options.attr ?? {}) };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  /* Les boutons de ces modales déclenchent un `void create()`/`void open()`
     fire-and-forget (même patron qu'un vrai clic DOM, qui ne peut pas non
     plus être "attendu" par le navigateur) : `await` sur l'appel synchrone
     du handler ne suffit pas à attendre la chaîne de promesses qu'il lance.
     On attend une frontière de macrotâche (setTimeout), qui ne se déclenche
     qu'une fois TOUTE la file de microtâches vidée — quel que soit le
     nombre d'attentes internes (ensureFolder, saveSettings, ouverture du
     fichier…). */
  async trigger(type, event = {}) {
    this.events.get(type)?.(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  focus() {}
  empty() { this.children = []; }
}

function findElements(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findElements(child, predicate));
  }
  return found;
}

function createModal(ModalClass, app, plugin, ...args) {
  const modal = new ModalClass(app, plugin, ...args);
  modal.app = app;
  modal.contentEl = new FakeElement();
  modal.close = () => { modal.closed = true; };
  return modal;
}

/** Fausse feuille de travail : openFile() installe une MarkdownView minimale
 * portant un editor espionnable, comme le ferait Obsidian pour de vrai. */
function fakeLeaf() {
  const editor = {
    cursor: null,
    lastLine: () => 1,
    getLine: () => "",
    setCursor(pos) { this.cursor = pos; },
    focus() {},
  };
  const leaf = {
    openedWith: null,
    async openFile(file, opts) {
      leaf.openedWith = { file, opts };
      leaf.view = Object.assign(new MarkdownView(), { editor, file });
    },
  };
  return leaf;
}

function fakeApp(vault) {
  const leaf = fakeLeaf();
  return {
    vault,
    workspace: {
      leaf,
      activeLeaves: [],
      getLeaf: () => leaf,
      setActiveLeaf(l) { this.activeLeaves.push(l); },
    },
  };
}

function freshSettings() {
  return { wordGoal: 1500, projectFolder: "", projects: [], projectMeta: {} };
}

function fakePlugin(settings) {
  const calls = [];
  return {
    settings,
    calls,
    async saveSettings() { calls.push("save"); },
    renderAllViews() { calls.push("render"); },
    updateStatusBar() { calls.push("statusBar"); },
  };
}

function withNotices(fn) {
  const notices = [];
  const previous = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  return Promise.resolve(fn(notices)).finally(() => { Notice.onCreate = previous; });
}

test("NewProjectModal : crée la structure minimale, active le projet, ouvre la scène et affiche le message de succès", async () => {
  await withNotices(async (notices) => {
    const { vault } = createFakeVault([]);
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(NewProjectModal, app, plugin);

    modal.onOpen();
    const inputs = findElements(modal.contentEl, (el) => el.tag === "input");
    inputs[0].value = "Roman1";
    inputs[1].value = "Camille Autrice";
    findElements(modal.contentEl, (el) => el.tag === "select")[0].value = "fiction";
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    assert.ok(vault.getAbstractFileByPath("Roman1/Manuscrit/Chapitre 1") instanceof TFolder);
    assert.ok(vault.getAbstractFileByPath("Roman1/_Feuillets/Recherche") instanceof TFolder);
    assert.ok(vault.getAbstractFileByPath("Roman1/_Feuillets/Ressources/Modèles") instanceof TFolder);
    const scene = vault.getAbstractFileByPath("Roman1/Manuscrit/Chapitre 1/Scène 1.md");
    assert.ok(scene instanceof TFile);
    const titlePage = vault.getAbstractFileByPath("Roman1/Manuscrit/Front/Page de titre.md");
    assert.match(titlePage.content, /author: Camille Autrice/);
    assert.equal(settings.projectFolder, "Roman1/Manuscrit");
    assert.equal(settings.projectMeta["Roman1/Manuscrit"].author, "Camille Autrice");
    assert.deepEqual(plugin.calls, ["save", "render", "statusBar"]);
    assert.equal(app.workspace.leaf.openedWith.file, scene);
    assert.equal(app.workspace.leaf.openedWith.opts.active, true);
    assert.ok(app.workspace.activeLeaves.includes(app.workspace.leaf));
    assert.equal(app.workspace.leaf.view.editor.cursor.line, 1);
    assert.ok(modal.closed);
    assert.deepEqual(notices, ["Votre projet est prêt. Commencez à écrire dans votre première scène."]);
  });
});

test("NewProjectModal (non-fiction) : ouvre automatiquement Chapitre 1.md, pas de Scène", async () => {
  await withNotices(async (notices) => {
    const { vault } = createFakeVault([]);
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(NewProjectModal, app, plugin);

    modal.onOpen();
    const inputs = findElements(modal.contentEl, (el) => el.tag === "input");
    inputs[0].value = "Essai1";
    findElements(modal.contentEl, (el) => el.tag === "select")[0].value = "nonfiction";
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    const chapterFile = vault.getAbstractFileByPath("Essai1/Manuscrit/Partie 1/Chapitre 1.md");
    assert.ok(chapterFile instanceof TFile);
    assert.equal(vault.getAbstractFileByPath("Essai1/Manuscrit/Chapitre 1/Scène 1.md"), null);
    assert.equal(app.workspace.leaf.openedWith.file, chapterFile);
    assert.deepEqual(notices, ["Votre projet est prêt. Commencez à écrire dans votre première scène."]);
  });
});

test("NewProjectModal : refuse un nom vide, sans créer ni sauvegarder", async () => {
  await withNotices(async (notices) => {
    const { vault } = createFakeVault([]);
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(NewProjectModal, app, plugin);

    modal.onOpen();
    findElements(modal.contentEl, (el) => el.tag === "input")[0].value = "   ";
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    assert.deepEqual(notices, ["Donne un nom au projet."]);
    assert.deepEqual(plugin.calls, []);
    assert.equal(settings.projectFolder, "");
    assert.equal(modal.closed, undefined);
  });
});

test("NewProjectModal : refuse un dossier déjà existant", async () => {
  await withNotices(async (notices) => {
    const existing = new TFolder("Roman1");
    const { vault } = createFakeVault([existing]);
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(NewProjectModal, app, plugin);

    modal.onOpen();
    findElements(modal.contentEl, (el) => el.tag === "input")[0].value = "Roman1";
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    assert.deepEqual(notices, ["« Roman1 » existe déjà."]);
    assert.equal(vault.getAbstractFileByPath("Roman1/Manuscrit"), null);
    assert.deepEqual(plugin.calls, []);
  });
});

test("OpenExistingFolderModal : active un dossier existant sans déplacer, renommer ni modifier de fichier", async () => {
  await withNotices(async (notices) => {
    const folder = new TFolder("MonRoman");
    const scene = new TFile("MonRoman/Scène.md", "---\ntitle: Déjà écrit\n---\nDu texte déjà là.");
    folder.children = [scene];
    scene.parent = folder;
    const { vault } = createFakeVault([folder, scene]);
    const originalContent = scene.content;
    const originalPath = scene.path;
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(OpenExistingFolderModal, app, plugin);

    modal.onOpen();
    findElements(modal.contentEl, (el) => el.tag === "input")[0].value = "MonRoman";
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    assert.equal(settings.projectFolder, "MonRoman");
    assert.ok(settings.projects.includes("MonRoman"));
    assert.equal(scene.path, originalPath);
    assert.equal(scene.content, originalContent);
    assert.equal(vault.getAbstractFileByPath("MonRoman/_Recherche"), null);
    assert.deepEqual(notices, ["Projet activé : MonRoman"]);
    assert.ok(modal.closed);
  });
});

test("TransformToProjectModal : exige un type explicite avant toute initialisation", async () => {
  await withNotices(async (notices) => {
    const folder = new TFolder("MonRoman");
    const { vault } = createFakeVault([folder]);
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(TransformToProjectModal, app, plugin, folder.path);

    modal.onOpen();
    const select = findElements(modal.contentEl, (el) => el.tag === "select")[0];
    assert.equal(select.value, "");
    assert.equal(select.children[0].text, "Choisir le type de projet…");
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    assert.deepEqual(settings.projectMeta, {});
    assert.deepEqual(settings.projects, []);
    assert.equal(vault.getAbstractFileByPath("MonRoman/_Recherche/Personnages"), null);
    assert.deepEqual(plugin.calls, []);
    assert.deepEqual(notices, ["Choisissez un type de projet."]);
  });
});

test("TransformToProjectModal : initialise après le choix explicite d'un type", async () => {
  await withNotices(async (notices) => {
    const folder = new TFolder("MonRoman");
    const { vault } = createFakeVault([folder]);
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(TransformToProjectModal, app, plugin, folder.path);

    modal.onOpen();
    findElements(modal.contentEl, (el) => el.tag === "select")[0].value = "fiction";
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    assert.equal(settings.projectMeta[folder.path].type, "fiction");
    assert.ok(settings.projects.includes(folder.path));
    assert.equal(settings.projectFolder, folder.path);
    assert.ok(vault.getAbstractFileByPath("MonRoman/_Feuillets/Recherche/Personnages") instanceof TFolder);
    assert.equal(vault.getAbstractFileByPath("MonRoman/_Recherche"), null);
    assert.deepEqual(settings.projectMeta[folder.path].hiddenBoardModes, ["timeline"]);
    assert.deepEqual(plugin.calls, ["save", "render", "statusBar"]);
    assert.ok(modal.closed);
    assert.deepEqual(notices, ["« MonRoman » est maintenant un projet Feuillets."]);
  });
});

test("TransformToProjectModal : préserve le dossier existant et initialise le modèle V2 selon le type", async (t) => {
  for (const [type, hiddenBoardModes, visibleColumns] of [
    ["fiction", ["timeline"], ["synopsis", "pov", "status"]],
    ["nonfiction", ["arcs", "timeline"], ["summary"]],
    // §7 : Libre planifie désormais avec le résumé long (corrige
    // l'incohérence historique — voir project-modes.ts).
    ["free", ["arcs", "timeline"], ["summary"]],
  ]) {
    await t.test(type, async () => {
      const folder = new TFolder("Mes textes");
      const article = new TFile("Mes textes/Article 1.md", "Texte personnel");
      const archives = new TFolder("Mes textes/Archives");
      article.parent = folder;
      archives.parent = folder;
      folder.children = [article, archives];
      const { vault } = createFakeVault([folder, article, archives]);
      const app = fakeApp(vault);
      const settings = freshSettings();
      const plugin = fakePlugin(settings);
      const modal = createModal(TransformToProjectModal, app, plugin, folder.path);

      modal.onOpen();
      findElements(modal.contentEl, (el) => el.tag === "select")[0].value = type;
      await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

      assert.equal(vault.getAbstractFileByPath(article.path), article);
      assert.equal(vault.getAbstractFileByPath(archives.path), archives);
      assert.ok(vault.getAbstractFileByPath(`Mes textes/_Feuillets/Recherche`) instanceof TFolder, "Recherche");
      assert.ok(vault.getAbstractFileByPath(`Mes textes/_Feuillets/Ressources`) instanceof TFolder, "Ressources");
      for (const name of ["Edition", "Journal", "Snapshots", "Backups", "Sortie"]) {
        assert.equal(vault.getAbstractFileByPath(`Mes textes/_Feuillets/${name}`), null, `pas de ${name} lazy au bootstrap`);
      }
      assert.equal(vault.getAbstractFileByPath("Mes textes/_Recherche"), null);
      assert.equal(vault.getAbstractFileByPath("Mes textes/Manuscrit"), null);
      assert.equal(vault.getAbstractFileByPath("Mes textes/Front"), null);
      assert.equal(vault.getAbstractFileByPath("Mes textes/Partie 1"), null);
      assert.equal(vault.getAbstractFileByPath("Mes textes/Chapitre 1"), null);
      assert.equal(vault.getAbstractFileByPath("Mes textes/Nouveau texte.md"), null);
      const meta = settings.projectMeta[folder.path];
      assert.equal(meta.type, type);
      assert.deepEqual(meta.hiddenBoardModes, hiddenBoardModes);
      assert.deepEqual(Object.keys(meta.outlineCols).filter((key) => meta.outlineCols[key]), visibleColumns);
    });
  }
});

test("TransformToProjectModal : conserve une Recherche legacy sans migration", async () => {
  const folder = new TFolder("Ancien");
  const legacyResearch = new TFolder("Ancien/_Recherche");
  legacyResearch.parent = folder;
  folder.children = [legacyResearch];
  const { vault } = createFakeVault([folder, legacyResearch]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const modal = createModal(TransformToProjectModal, app, fakePlugin(settings), folder.path);

  modal.onOpen();
  findElements(modal.contentEl, (el) => el.tag === "select")[0].value = "free";
  await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

  assert.equal(vault.getAbstractFileByPath("Ancien/_Recherche"), legacyResearch);
});

test("TransformToProjectModal : garde la Recherche V2 prioritaire lorsqu'elle coexiste avec le legacy", async () => {
  const folder = new TFolder("Mixte");
  const legacyResearch = new TFolder("Mixte/_Recherche");
  const auxiliary = new TFolder("Mixte/_Feuillets");
  const canonicalResearch = new TFolder("Mixte/_Feuillets/Recherche");
  legacyResearch.parent = folder;
  auxiliary.parent = folder;
  canonicalResearch.parent = auxiliary;
  folder.children = [legacyResearch, auxiliary];
  auxiliary.children = [canonicalResearch];
  const { vault } = createFakeVault([folder, legacyResearch, auxiliary, canonicalResearch]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const modal = createModal(TransformToProjectModal, app, fakePlugin(settings), folder.path);

  modal.onOpen();
  findElements(modal.contentEl, (el) => el.tag === "select")[0].value = "free";
  await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

  assert.equal(vault.getAbstractFileByPath("Mixte/_Feuillets/Recherche"), canonicalResearch);
  assert.equal(vault.getAbstractFileByPath("Mixte/_Recherche"), legacyResearch);
});

test("les libellés des deux parcours existent en français et en anglais", () => {
  for (const dictionary of [fr, en]) {
    assert.ok(dictionary["modal.openFolder.title"]);
    assert.ok(dictionary["modal.transformProject.title"]);
    assert.ok(dictionary["modal.transformProject.typePlaceholder"]);
    assert.ok(dictionary["modal.transformProject.typeRequired"]);
  }
});

test("OpenExistingFolderModal : refuse un chemin qui n'est pas un dossier", async () => {
  await withNotices(async (notices) => {
    const scene = new TFile("MonRoman/Scène.md", "texte");
    const { vault } = createFakeVault([scene]);
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(OpenExistingFolderModal, app, plugin);

    modal.onOpen();
    findElements(modal.contentEl, (el) => el.tag === "input")[0].value = "MonRoman/Scène.md";
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    assert.deepEqual(notices, ["Ce chemin ne correspond à aucun dossier du coffre."]);
    assert.equal(settings.projectFolder, "");
  });
});

test("OpenExistingFolderModal : refuse un champ vide", async () => {
  await withNotices(async (notices) => {
    const { vault } = createFakeVault([]);
    const app = fakeApp(vault);
    const settings = freshSettings();
    const plugin = fakePlugin(settings);
    const modal = createModal(OpenExistingFolderModal, app, plugin);

    modal.onOpen();
    await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

    assert.deepEqual(notices, ["Choisissez un dossier."]);
  });
});
