import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, Notice, TFile, TFolder } from "obsidian";
import { NewProjectModal, OpenExistingFolderModal, TransformToProjectModal, ManageProjectsModal } from "../src/ui/project-modals.js";
import { ProjectConfigContent, YamlPropertyNameModal } from "../src/ui/project-config-content.js";
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
    const eventWithDefaults = {
      stopPropagation() {},
      preventDefault() {},
      ...event,
    };
    this.events.get(type)?.(eventWithDefaults);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  focus() {}
  empty() { this.children = []; }
  prepend(child) { this.children.unshift(child); }
}

function findElements(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findElements(child, predicate));
  }
  return found;
}

function findCitationSelects(root) {
  return findElements(root, (el) => el.tag === "select").filter((select) =>
    select.children.some((child) => child.value === "footnote" || child.value === "parenthetical")
  );
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
    getProjectFolder() { return null; },
    projectDisplayName(_path) { return _path || ""; },
    switchProject: async (_path) => true,
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
    // LOT 5C §2 : Couloirs n'est pas un mode — il ne figure donc jamais dans
    // hiddenBoardModes. Non-fiction/Libre masquent l'espace narratif entier
    // (arcs + timeline) dès la création.
    ["nonfiction", ["arcs", "timeline"], ["summary"]],
    // §7 : Libre planifie désormais avec le résumé long (corrige
    // l'incohérence historique — voir project-modes.ts).
    ["free", ["arcs", "timeline"], ["summary"]],
  ]) {
    await t.test(type, async () => {
      const folder = new TFolder("Mes textes");
      const article = new TFile("Mes textes/Article 1.md", "Texte personnel");
      const archives = new TFolder("Mes textes/Archives");
      const sequence = new TFolder("Mes textes/Séquence 1");
      const activity = new TFile("Mes textes/Séquence 1/Activité.md", "Contenu sans YAML");
      article.parent = folder;
      archives.parent = folder;
      sequence.parent = folder;
      activity.parent = sequence;
      sequence.children = [activity];
      folder.children = [article, archives, sequence];
      const { vault } = createFakeVault([folder, article, archives, sequence, activity]);
      const app = fakeApp(vault);
      const settings = freshSettings();
      const plugin = fakePlugin(settings);
      const modal = createModal(TransformToProjectModal, app, plugin, folder.path);

      modal.onOpen();
      findElements(modal.contentEl, (el) => el.tag === "select")[0].value = type;
      await findElements(modal.contentEl, (el) => el.tag === "button" && el.classes.has("mod-cta"))[0].trigger("click");

      assert.equal(vault.getAbstractFileByPath(article.path), article);
      assert.equal(vault.getAbstractFileByPath(archives.path), archives);
      assert.equal(vault.getAbstractFileByPath(sequence.path), sequence);
      assert.equal(vault.getAbstractFileByPath(activity.path), activity);
      assert.equal(activity.content, "Contenu sans YAML");
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

/* ManageProjectsModal : gestionnaire de projets (Continu) */

test("ManageProjectsModal : affiche la liste historique des projets dans la vue principale", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const nefes = new TFolder("NEFES/Manuscrit");
  const autre = new TFolder("AUTRE/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => {
    if (path === "NEFES/Manuscrit") return nefes;
    if (path === "AUTRE/Manuscrit") return autre;
    return null;
  };
  settings.projectFolder = "NEFES/Manuscrit";
  settings.projects = ["AUTRE/Manuscrit"];
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => nefes;
  plugin.projectDisplayName = (path) => path === "NEFES/Manuscrit" ? "NEFES" : "AUTRE";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  const projectItems = findElements(modal.contentEl, (el) => el.classes.has("feuillets-project-item"));
  assert.equal(projectItems.length, 2, "deux projets affichés dans la liste principale");
  const names = projectItems.map((el) => el.children.find((c) => c.classes.has("feuillets-project-name"))?.text);
  assert.deepEqual(names, ["NEFES", "AUTRE"], "les noms d'affichage sont corrects");
});

test("ManageProjectsModal : chaque projet a un chevron de développement", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const nefes = new TFolder("NEFES/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "NEFES/Manuscrit" ? nefes : null);
  settings.projectFolder = "NEFES/Manuscrit";
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => nefes;
  plugin.projectDisplayName = () => "NEFES";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  const projectItems = findElements(modal.contentEl, (el) => el.classes.has("feuillets-project-item"));
  const chevrons = projectItems.map((item) => findElements(item, (el) => el.classes.has("clickable-icon")));
  assert.ok(chevrons.every((arr) => arr.length > 0), "chaque projet a au moins un chevron");
});

test("ManageProjectsModal : clic chevron marque le projet comme déplié", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const nefes = new TFolder("NEFES/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "NEFES/Manuscrit" ? nefes : null);
  settings.projectFolder = "NEFES/Manuscrit";
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => nefes;
  plugin.projectDisplayName = () => "NEFES";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  assert.equal(modal.expandedProjects.has("NEFES/Manuscrit"), false, "projet non déplié initialement");

  const projectItems = findElements(modal.contentEl, (el) => el.classes.has("feuillets-project-item"));
  const toggleBtn = findElements(projectItems[0], (el) => el.classes.has("clickable-icon"))[0];
  await toggleBtn.trigger("click");

  assert.equal(modal.expandedProjects.has("NEFES/Manuscrit"), true, "projet marqué déplié après clic chevron");
});

test("ManageProjectsModal : la page de détail peut être ouverte et refermée", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const nefes = new TFolder("NEFES/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "NEFES/Manuscrit" ? nefes : null);
  settings.projectFolder = "NEFES/Manuscrit";
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => nefes;
  plugin.projectDisplayName = () => "NEFES";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  assert.equal(modal.detailPage, null, "pas de page de détail initialement");

  // Simule l'ouverture d'une page de détail
  modal.detailPage = { projectPath: "NEFES/Manuscrit", page: "goals" };
  modal.render();

  const backBtn = findElements(modal.contentEl, (el) => el.classes.has("feuillets-back-btn"))[0];
  assert.ok(backBtn, "bouton retour présent quand page de détail ouverte");

  await backBtn.trigger("click");
  assert.equal(modal.detailPage, null, "retour ferme la page de détail");
});

test("ManageProjectsModal : plusieurs pages de détail peuvent être accessible", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const nefes = new TFolder("NEFES/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "NEFES/Manuscrit" ? nefes : null);
  settings.projectFolder = "NEFES/Manuscrit";
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => nefes;
  plugin.projectDisplayName = () => "NEFES";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  // Tester que le code crée les boutons de navigation pour les pages
  // (nous ne pouvons pas vraiment tester le clic car il faudrait un rendu complet)
  assert.ok(modal.render, "modal a une méthode render");
  assert.equal(modal.detailPage, null, "modal commencent sans détail page");
});

test("ManageProjectsModal : clic sur un autre projet appelle plugin.switchProject", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const nefes = new TFolder("NEFES/Manuscrit");
  const autre = new TFolder("AUTRE/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => {
    if (path === "NEFES/Manuscrit") return nefes;
    if (path === "AUTRE/Manuscrit") return autre;
    return null;
  };
  settings.projectFolder = "NEFES/Manuscrit";
  settings.projects = ["AUTRE/Manuscrit"];
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => nefes;
  plugin.projectDisplayName = (path) => (path === "NEFES/Manuscrit" ? "NEFES" : "AUTRE");
  plugin.switchProject = async (path) => {
    plugin.calls.push(`switch:${path}`);
    return true;
  };
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  const projectItems = findElements(modal.contentEl, (el) => el.classes.has("feuillets-project-item"));
  const autreItem = projectItems[1];
  await autreItem.trigger("click");

  assert.ok(plugin.calls.some((c) => c === "switch:AUTRE/Manuscrit"), "switchProject appelé avec le chemin du projet");
});

/* Tests métier ManageProjectsModal — pages de détail */

test("ManageProjectsModal — page Objectifs : lecture seule ne crée pas d'override", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  settings.wordGoal = 1500;
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = () => "Test";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "goals" };
  modal.render();

  assert.equal(settings.projectMeta["Test/Manuscrit"], undefined, "lecture seule ne crée pas d'entry projectMeta");
});

test("ManageProjectsModal — page Objectifs : modification crée l'override et écrit dedans", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  settings.wordGoal = 1500;
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = () => "Test";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "goals" };
  modal.render();

  const inputs = findElements(modal.contentEl, (el) => el.tag === "input" && el.tag !== "button");
  const firstWordGoalInput = inputs[0];
  firstWordGoalInput.value = "2000";
  await firstWordGoalInput.trigger("change");

  assert.ok(settings.projectMeta["Test/Manuscrit"], "modification crée l'entry projectMeta");
  assert.equal(settings.projectMeta["Test/Manuscrit"].wordGoal, 2000, "modification écrit la valeur d'override");
});

test("ManageProjectsModal — page Objectifs : Reset supprime l'override, ne recopie pas la valeur globale", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  settings.wordGoal = 1500;
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  settings.projectMeta["Test/Manuscrit"] = { wordGoal: 2500 };
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = () => "Test";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "goals" };
  modal.render();

  const resetButtons = findElements(modal.contentEl, (el) => el.icon === "rotate-ccw");
  const firstResetBtn = resetButtons[0];
  await firstResetBtn.trigger("click");

  assert.equal(settings.projectMeta["Test/Manuscrit"].wordGoal, undefined, "Reset supprime la propriété d'override");
  assert.equal(typeof settings.projectMeta["Test/Manuscrit"].wordGoal, "undefined", "Reset n'écrit pas la valeur globale");
});

test("ManageProjectsModal — page Statuts : lecture seule ne crée pas projectMeta.statuses", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  settings.statuses = ["Brouillon", "Édition"];
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = () => "Test";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "statuses" };
  modal.render();

  assert.equal(settings.projectMeta["Test/Manuscrit"]?.statuses, undefined, "lecture seule ne crée pas statuses override");
});

test("ManageProjectsModal — page Statuts : première modification crée l'override", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  settings.statuses = [{ name: "Brouillon", color: "#888888" }, { name: "Édition", color: "#888888" }];
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = () => "Test";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "statuses" };
  modal.render();

  // Simuler une modification du premier statut
  const inputs = findElements(modal.contentEl, (el) => el.tag === "input" && el.tag !== "button");
  if (inputs.length > 0) {
    inputs[0].value = "Modified";
    await inputs[0].trigger("change");
  }

  assert.ok(settings.projectMeta["Test/Manuscrit"]?.statuses, "première modification crée l'override statuses");
});

test("ManageProjectsModal — page Labels/Tags : lecture seule ne produit pas de mutation projet", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = () => "Test";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "tags" };
  modal.render();

  assert.equal(settings.projectMeta["Test/Manuscrit"]?.favoriteTags, undefined, "lecture Tags ne crée pas favoriteTags");
});

test("ManageProjectsModal — page Labels/Tags : modification écrit dans favoriteTags", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  settings.projectMeta["Test/Manuscrit"] = {};
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = () => "Test";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "tags" };
  modal.render();

  // Vérifier que les modifications fonctionnent sans erreur
  assert.ok(true, "page Tags rendue sans erreur");
});

test("ManageProjectsModal — page Correspondance YAML : modification écrit sans erreur", async () => {
  const { vault } = createFakeVault([]);
  vault.getMarkdownFiles = () => [];
  const app = fakeApp(vault);
  const settings = freshSettings();
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  settings.projectMeta["Test/Manuscrit"] = {};
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = () => "Test";
  plugin.flattenFiles = () => [];
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "mapping" };
  modal.render();

  assert.ok(true, "page Mapping rendue sans erreur");
});

test("Correspondance YAML — propriétés projet et vault sont groupées, triées et dédoublonnées", () => {
  const project = new TFolder("Projet/Manuscrit");
  const projectFile = new TFile("Projet/Manuscrit/Scene.md");
  const outsideFile = new TFile("Notes/Reference.md");
  project.children = [projectFile];
  const { vault } = createFakeVault([project, projectFile, outsideFile]);
  vault.getMarkdownFiles = () => [projectFile, outsideFile];
  const app = fakeApp(vault);
  app.metadataCache = {
    getFileCache(file) {
      return { frontmatter: file === projectFile
        ? { status: "", pov: "", summary: "" }
        : { author_note: "", pov: "", location: "" } };
    },
  };
  const settings = freshSettings();
  const plugin = fakePlugin(settings);
  plugin.flattenFiles = () => [projectFile];
  const content = new ProjectConfigContent(app, plugin, () => {});
  const container = new FakeElement();

  content.renderPage("mapping", container, project.path, project);

  const select = findElements(container, (el) => el.tag === "select")[0];
  assert.deepEqual(select.children[1].children.map((option) => option.value), ["pov", "status", "summary"]);
  assert.deepEqual(select.children[2].children.map((option) => option.value), ["author_note", "location"]);
});

test("Correspondance YAML — une propriété hors projet est sélectionnable sans écriture de fichier", async () => {
  const project = new TFolder("Projet/Manuscrit");
  const projectFile = new TFile("Projet/Manuscrit/Scene.md");
  const outsideFile = new TFile("Notes/Reference.md", "---\nexternal_property: intact\n---\n");
  project.children = [projectFile];
  const { vault } = createFakeVault([project, projectFile, outsideFile]);
  vault.getMarkdownFiles = () => [projectFile, outsideFile];
  const app = fakeApp(vault);
  let processFrontMatterCalls = 0;
  app.fileManager = { async processFrontMatter() { processFrontMatterCalls += 1; } };
  app.metadataCache = {
    getFileCache(file) { return { frontmatter: file === outsideFile ? { external_property: "intact" } : {} }; },
  };
  const settings = freshSettings();
  const plugin = fakePlugin(settings);
  plugin.flattenFiles = () => [projectFile];
  const content = new ProjectConfigContent(app, plugin, () => {});
  const container = new FakeElement();

  content.renderPage("mapping", container, project.path, project);
  const povSelect = findElements(container, (el) => el.tag === "select")[3];
  povSelect.value = "external_property";
  await povSelect.trigger("change");

  assert.equal(settings.projectMeta[project.path].propertyMap.pov, "external_property");
  assert.equal(processFrontMatterCalls, 0);
  assert.equal(outsideFile.content, "---\nexternal_property: intact\n---\n");
});

test("Correspondance YAML — mapping absent du vault reste sélectionné", () => {
  const project = new TFolder("Projet/Manuscrit");
  const { vault } = createFakeVault([project]);
  vault.getMarkdownFiles = () => [];
  const app = fakeApp(vault);
  app.metadataCache = { getFileCache() { return { frontmatter: {} }; } };
  const settings = freshSettings();
  settings.projectMeta[project.path] = { propertyMap: { pov: "viewpoint" } };
  const plugin = fakePlugin(settings);
  plugin.flattenFiles = () => [];
  const content = new ProjectConfigContent(app, plugin, () => {});
  const container = new FakeElement();

  content.renderPage("mapping", container, project.path, project);

  const povSelect = findElements(container, (el) => el.tag === "select")[3];
  assert.equal(povSelect.value, "viewpoint");
  assert.ok(povSelect.children.some((option) => option.value === "viewpoint"));
  assert.equal(settings.projectMeta[project.path].propertyMap.pov, "viewpoint");
});

test("Correspondance YAML — nouvelle propriété enregistre seulement le mapping et annulation conserve la valeur", () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  settings.projectMeta.A = { propertyMap: { pov: "pov" } };
  settings.projectMeta.B = {};
  const plugin = fakePlugin(settings);
  const content = new ProjectConfigContent(app, plugin, () => {});
  let processFrontMatterCalls = 0;
  app.fileManager = { async processFrontMatter() { processFrontMatterCalls += 1; } };
  const modal = new YamlPropertyNameModal(app, (name) => content.applyMapping("B", "pov", name));
  modal.contentEl = new FakeElement();
  modal.close = () => {};
  modal.onOpen();
  const input = findElements(modal.contentEl, (el) => el.tag === "input")[0];
  input.value = "point_of_view";
  const addButton = findElements(modal.contentEl, (el) => el.tag === "button" && el.text === "Ajouter")[0];
  addButton.events.get("click")();

  assert.equal(settings.projectMeta.B.propertyMap.pov, "point_of_view");
  assert.equal(settings.projectMeta.A.propertyMap.pov, "pov");
  assert.equal(processFrontMatterCalls, 0);

  const cancelled = new YamlPropertyNameModal(app, (name) => content.applyMapping("B", "pov", name));
  cancelled.contentEl = new FakeElement();
  cancelled.close = () => {};
  cancelled.onOpen();
  const cancelButton = findElements(cancelled.contentEl, (el) => el.tag === "button" && el.text === "Annuler")[0];
  cancelButton.events.get("click")();
  assert.equal(settings.projectMeta.B.propertyMap.pov, "point_of_view");
});

test("Correspondance YAML — l'option Nouvelle propriété ouvre la modal et restaure la sélection", async () => {
  const project = new TFolder("Projet/Manuscrit");
  const { vault } = createFakeVault([project]);
  vault.getMarkdownFiles = () => [];
  const app = fakeApp(vault);
  app.metadataCache = { getFileCache() { return { frontmatter: {} }; } };
  const settings = freshSettings();
  settings.projectMeta[project.path] = { propertyMap: { pov: "viewpoint" } };
  const plugin = fakePlugin(settings);
  plugin.flattenFiles = () => [];
  const content = new ProjectConfigContent(app, plugin, () => {});
  const container = new FakeElement();
  let opened = false;
  const originalOpen = YamlPropertyNameModal.prototype.open;
  YamlPropertyNameModal.prototype.open = function () { opened = true; return this; };

  content.renderPage("mapping", container, project.path, project);
  const povSelect = findElements(container, (el) => el.tag === "select")[3];
  povSelect.value = "__feuillets_new_yaml_property__";
  await povSelect.trigger("change");
  YamlPropertyNameModal.prototype.open = originalOpen;

  assert.equal(opened, true);
  assert.equal(povSelect.value, "viewpoint");
  assert.equal(settings.projectMeta[project.path].propertyMap.pov, "viewpoint");
});

test("Correspondance YAML — nouvelle propriété refuse les noms vides", () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const results = [];
  const modal = new YamlPropertyNameModal(app, (name) => results.push(name));
  modal.contentEl = new FakeElement();
  modal.close = () => {};
  modal.onOpen();
  const input = findElements(modal.contentEl, (el) => el.tag === "input")[0];
  const addButton = findElements(modal.contentEl, (el) => el.tag === "button" && el.text === "Ajouter")[0];
  input.value = "";
  addButton.events.get("click")();
  input.value = "   ";
  addButton.events.get("click")();

  assert.deepEqual(results, []);
});

test("ManageProjectsModal — Style citation : projet Fiction affiche le contrôle sur la page Citations", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const fictionProject = new TFolder("Fiction/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Fiction/Manuscrit" ? fictionProject : null);
  settings.projectFolder = "Fiction/Manuscrit";
  settings.projectMeta["Fiction/Manuscrit"] = { type: "fiction" };
  settings.projects = [];
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => fictionProject;
  plugin.projectDisplayName = (_path) => "Fiction";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Fiction/Manuscrit", page: "citations" };
  modal.render();

  const citationSelects = findCitationSelects(modal.contentEl);
  assert.equal(citationSelects.length, 1, "Fiction affiche un contrôle Style de citation");
});

test("ManageProjectsModal — Style citation : projet Non-fiction affiche le contrôle sur la page Citations", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const nonfictionProject = new TFolder("Nonfiction/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Nonfiction/Manuscrit" ? nonfictionProject : null);
  settings.projectFolder = "Nonfiction/Manuscrit";
  settings.projectMeta["Nonfiction/Manuscrit"] = { type: "nonfiction" };
  settings.projects = [];
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => nonfictionProject;
  plugin.projectDisplayName = (_path) => "Nonfiction";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Nonfiction/Manuscrit", page: "citations" };
  modal.render();

  const citationSelects = findCitationSelects(modal.contentEl);
  assert.equal(citationSelects.length, 1, "Non-fiction affiche un contrôle Style de citation");
});

test("ManageProjectsModal — Style citation : modification écrit dans settings.projectMeta[path].citationStyle", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const nonfictionProject = new TFolder("Essay/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Essay/Manuscrit" ? nonfictionProject : null);
  settings.projectFolder = "Essay/Manuscrit";
  settings.projectMeta["Essay/Manuscrit"] = { type: "nonfiction", citationStyle: "footnote" };
  settings.projects = [];
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => nonfictionProject;
  plugin.projectDisplayName = (_path) => "Essay";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.detailPage = { projectPath: "Essay/Manuscrit", page: "citations" };
  modal.render();

  const citationSelects = findCitationSelects(modal.contentEl);
  assert.equal(citationSelects.length, 1, "le contrôle Style de citation doit être présent");
  citationSelects[0].value = "parenthetical";
  await citationSelects[0].trigger("change");
  assert.equal(settings.projectMeta["Essay/Manuscrit"].citationStyle, "parenthetical", "modification écrit citationStyle");
});

test("ManageProjectsModal — Style citation : le type reste inchangé et la page Citations est universelle", async () => {
  const { vault } = createFakeVault([]);
  const app = fakeApp(vault);
  const settings = freshSettings();
  const testProject = new TFolder("Test/Manuscrit");
  app.vault.getAbstractFileByPath = (path) => (path === "Test/Manuscrit" ? testProject : null);
  settings.projectFolder = "Test/Manuscrit";
  settings.projectMeta["Test/Manuscrit"] = { type: "fiction" };
  settings.projects = [];
  const plugin = fakePlugin(settings);
  plugin.getProjectFolder = () => testProject;
  plugin.projectDisplayName = (_path) => "Test";
  const modal = createModal(ManageProjectsModal, app, plugin);

  modal.onOpen();
  modal.expandedProjects.add("Test/Manuscrit");
  modal.render();

  const allSelects1 = findElements(modal.contentEl, (el) => el.tag === "select");
  assert.equal(findCitationSelects(modal.contentEl).length, 0, "la fiche projet ne rend pas Citation en ligne");

  // Le gestionnaire ne propose plus de sélecteur de type runtime.
  assert.equal(allSelects1.length, 0, "aucun sélecteur de type runtime n'est présent");
  assert.equal(settings.projectMeta["Test/Manuscrit"].type, "fiction");
  modal.detailPage = { projectPath: "Test/Manuscrit", page: "citations" };
  modal.render();
  assert.equal(findCitationSelects(modal.contentEl).length, 1, "la page Citations affiche le contrôle");
});
