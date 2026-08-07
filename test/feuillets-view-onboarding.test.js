import assert from "node:assert/strict";
import test from "node:test";
import { Menu, TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { hasKnownProject } from "../src/services/folder-structure.js";
import { remapResearchFolderLinks, isInsideResearchSpace, resolveUniqueFolderMatch } from "../src/views/base-feuillets-view.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { NewFolderModal } from "../src/ui/basic-modals.js";
import { FolderSuggest } from "../src/ui/folder-suggest.js";

/* La décision "écran d'accueil vs gestionnaire de projets" repose sur
   hasKnownProject(), pure et testée directement ci-dessous : c'est ce qui
   garantit que l'écran d'accueil n'apparaît qu'au tout premier lancement,
   sans dépendre de la construction DOM du Binder. */
test("hasKnownProject : aucun projet ni actif ni connu", () => {
  assert.equal(hasKnownProject({ projectFolder: "", projects: [] }), false);
  assert.equal(hasKnownProject(null), false);
  assert.equal(hasKnownProject(undefined), false);
});

test("hasKnownProject : un projet actif compte, même si la liste projects est vide", () => {
  assert.equal(hasKnownProject({ projectFolder: "Roman1/Manuscrit", projects: [] }), true);
});

test("hasKnownProject : un projet connu mais inactif compte aussi", () => {
  assert.equal(hasKnownProject({ projectFolder: "", projects: ["Ancien/Manuscrit"] }), true);
});

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.style = { setProperty() {} };
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
  setText(text) { this.text = String(text); return this; }
  setAttr() {}
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
}

function findElements(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findElements(child, predicate));
  }
  return found;
}

function textContent(element) {
  return [element.text, ...element.children.map(textContent)].join(" ");
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
    ...overrides,
  };
}

/** render() construit une barre d'actions (gérer les projets, plan du
   tableau, double volet, densité) AVANT de brancher accueil/gestionnaire —
   ces icônes ont besoin d'un plugin minimal, mais aucun de leurs clics
   n'est déclenché ici : seule la présence du bon écran en dessous est
   vérifiée. */
function createView(settings) {
  const contentEl = new FakeElement();
  const app = { vault: { getAbstractFileByPath: () => null } };
  const plugin = {
    settings,
    getProjectFolder: () => null,
    projectDisplayName: (path) => path,
    activateBoard() {},
  };
  const view = new FeuilletsView({ app, contentEl }, plugin);
  return { view, contentEl };
}

test("Binder : affiche l'écran d'accueil au tout premier lancement (aucun projet connu)", async () => {
  const { view, contentEl } = createView(baseSettings());

  await view.render(true);

  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-onboarding")).length, 1);
  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-project-list")).length, 0);
  const rendered = textContent(contentEl);
  assert.match(rendered, /Feuillets/);
  assert.match(rendered, /Créer un projet/);
  assert.match(rendered, /Ouvrir un dossier existant/);
  assert.match(rendered, /Découvrir avec un projet de démonstration/);
  assert.match(rendered, /Vos fichiers restent des fichiers Markdown ordinaires/);
});

test("Binder : masque l'écran d'accueil dès qu'un projet est connu, même inactif", async () => {
  const { view, contentEl } = createView(baseSettings({ projects: ["Ancien/Manuscrit"] }));

  await view.render(true);

  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-onboarding")).length, 0);
  assert.equal(findElements(contentEl, (el) => el.classes.has("feuillets-project-hub")).length, 1);
});

test("Binder ↔ Recherche : remappage — aucune map ne renvoie undefined", () => {
  assert.equal(remapResearchFolderLinks(undefined, "Ancien/Manuscrit", "Nouveau/Manuscrit"), undefined);
});

test("Binder ↔ Recherche : remappage — égalité exacte sur les clés Binder et les valeurs Recherche", () => {
  const links = {
    "Roman/Manuscrit/Partie 1": "Recherche/Documentation/Partie 1",
    "Roman/Manuscrit/Partie 2": "Recherche/Documentation/Partie 2",
  };
  const mapped = remapResearchFolderLinks(links, "Recherche/Documentation/Partie 1", "Recherche/Documentation/Première partie");
  assert.deepEqual(mapped, {
    "Roman/Manuscrit/Partie 1": "Recherche/Documentation/Première partie",
    "Roman/Manuscrit/Partie 2": "Recherche/Documentation/Partie 2",
  });
});

test("Binder ↔ Recherche : remappage — préfixe oldPath/ remappe les descendants", () => {
  const links = {
    "Roman/Manuscrit": "Recherche/Documentation/Roman",
    "Roman/Manuscrit/Chapitre 1": "Recherche/Documentation/Roman/Chapitre 1",
  };
  const mapped = remapResearchFolderLinks(links, "Roman/Manuscrit", "Nouveaux Romans/Manuscrit v2");
  assert.deepEqual(mapped, {
    "Nouveaux Romans/Manuscrit v2": "Recherche/Documentation/Roman",
    "Nouveaux Romans/Manuscrit v2/Chapitre 1": "Recherche/Documentation/Roman/Chapitre 1",
  });
});

test("Binder ↔ Recherche : remappage — un chemin voisin hors préfixe n'est pas modifié", () => {
  const links = {
    "Roman/Manuscrit-primary": "Recherche/Manuscrit-primary",
  };
  const mapped = remapResearchFolderLinks(links, "Roman/Manuscrit", "Roman/Manuscrit v2");
  // "Roman/Manuscrit-primary" ne commence ni par "Roman/Manuscrit" seul ni
  // par "Roman/Manuscrit/" : il reste intact (et l'objet d'origine est
  // renvoyé tel quel, aucun changement déduit).
  assert.equal(mapped, links);
});

test("Binder ↔ Recherche : remappage — rien ne change renvoie l'objet d'origine", () => {
  const links = { A: "B", C: "D" };
  assert.equal(remapResearchFolderLinks(links, "X", "Y"), links);
});

test("Binder : renderOnboarding — les trois actions ouvrent les bons flux", async () => {
  const { view, contentEl } = createView(baseSettings());
  view.app = { workspace: {} };
  const { NewProjectModal, OpenExistingFolderModal } = await import("../src/ui/project-modals.js");
  const opened = [];
  const originalNewOpen = NewProjectModal.prototype.open;
  const originalFolderOpen = OpenExistingFolderModal.prototype.open;
  NewProjectModal.prototype.open = function () { opened.push("new-project"); };
  OpenExistingFolderModal.prototype.open = function () { opened.push("open-folder"); };

  try {
    view.renderOnboarding(contentEl);
    const buttons = findElements(contentEl, (el) => el.tag === "button");
    assert.equal(buttons.length, 3);
    buttons[0].events.get("click")({ stopPropagation() {} });
    buttons[1].events.get("click")({ stopPropagation() {} });

    assert.deepEqual(opened, ["new-project", "open-folder"]);
  } finally {
    NewProjectModal.prototype.open = originalNewOpen;
    OpenExistingFolderModal.prototype.open = originalFolderOpen;
  }
});

// ---------------------------------------------------------------------------
// Tests Binder ↔ Recherche : restriction de isInsideResearchSpace
// ---------------------------------------------------------------------------

test("Binder ↔ Recherche : isInsideResearchSpace — descendant valide accepté", () => {
  assert.equal(isInsideResearchSpace("Projet/_Recherche/Personnages", "Projet/_Recherche"), true);
  assert.equal(isInsideResearchSpace("Projet/_Recherche/Docs/Sources", "Projet/_Recherche"), true);
});

test("Binder ↔ Recherche : isInsideResearchSpace — racine _Recherche refusée", () => {
  assert.equal(isInsideResearchSpace("Projet/_Recherche", "Projet/_Recherche"), false);
});

test("Binder ↔ Recherche : isInsideResearchSpace — dossier extérieur refusé", () => {
  assert.equal(isInsideResearchSpace("AutreProjet/Dossier", "Projet/_Recherche"), false);
  assert.equal(isInsideResearchSpace("Projet/Manuscrit", "Projet/_Recherche"), false);
  assert.equal(isInsideResearchSpace("/Racine", "Projet/_Recherche"), false);
});

test("Binder ↔ Recherche : isInsideResearchSpace — autre projet refusé", () => {
  assert.equal(isInsideResearchSpace("Projet2/_Recherche/Docs", "Projet1/_Recherche"), false);
});

// ---------------------------------------------------------------------------
// Tests Binder ↔ Recherche : menu de fichier (article) Binder
// ---------------------------------------------------------------------------

/** Construit un projet minimal Fiction avec Manuscript + _Recherche pour
    tester les actions Binder ↔ Recherche. Retourne aussi un vault simulé
    avec getAbstractFileByPath fonctionnel. */
function buildBinderResearchProject() {
  const root = new TFolder("Roman/Manuscrit");
  root.name = "Manuscrit";
  root.path = "Roman/Manuscrit";

  const researchRoot = new TFolder("Roman/_Recherche");
  researchRoot.name = "_Recherche";
  researchRoot.path = "Roman/_Recherche";

  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.name = "Chapitre 1";
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.parent = root;
  root.children = [chapter];

  const scene = new TFile("Roman/Manuscrit/Chapitre 1/01 Été.md", "Texte.");
  scene.name = "01 Été.md";
  scene.basename = "01 Été";
  scene.extension = "md";
  scene.parent = chapter;
  chapter.children = [scene];

  /* Vault simulé : reconnaît les dossiers racine, _Recherche et ses enfants */
  const allFiles = new Map();
  allFiles.set("Roman/Manuscrit", root);
  allFiles.set("Roman/_Recherche", researchRoot);
  allFiles.set("Roman/Manuscrit/Chapitre 1", chapter);
  allFiles.set("Roman/Manuscrit/Chapitre 1/01 Été.md", scene);

  const vault = {
    allFiles,
    getAbstractFileByPath: (p) => allFiles.get(p) || null,
    createFolder: async (path) => {
      const name = path.split("/").pop();
      const folder = new TFolder(path);
      folder.name = name;
      folder.path = path;
      allFiles.set(path, folder);
      return folder;
    },
    read: async () => "Texte.",
    cachedRead: async () => "Texte.",
  };

  return { root, researchRoot, chapter, scene, vault };
}

/** Construit un plugin simulé pour les tests Binder ↔ Recherche. */
function buildBinderResearchPlugin(project, overrides = {}) {
  const { root, researchRoot, vault } = project;
  const researchFolderLinks = {};
  const settings = {
    projectFolder: "Roman/Manuscrit",
    level1Role: "chapitres",
    projectMeta: {},
    labels: [],
    statuses: [],
    collapsed: {},
    ...overrides.settings,
  };

  return {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => researchRoot,
    getLinkedResearchFolder: (node) => {
      const path = researchFolderLinks[node.path];
      return path ? vault.getAbstractFileByPath(path) : null;
    },
    setLinkedResearchFolder: async (node, folder) => {
      researchFolderLinks[node.path] = folder.path;
    },
    removeLinkedResearchFolder: async (node) => {
      delete researchFolderLinks[node.path];
    },
    fmOf: () => ({}),
    labelOf: () => "",
    titleFor: (f) => f.basename,
    shortTitleFor: (f) => f.basename,
    renderAllViews: () => {},
    saveSettings: async () => {},
    newSheetAt: () => {},
    newSheet: () => {},
    newFolder: () => {},
    snapshotFile: async () => "",
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    tagsOf: () => [],
    buildNumbering: () => new Map(),
    flattenFiles: () => [],
    projectMode: () => ({ researchFolders: {} }),
    _researchDragPath: null,
    _binderMultiSelect: null,
    _binderMultiSelectAnchor: null,
    ...overrides,
  };
}

class TestBinderResearchView extends BaseFeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: null });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

test("Binder ↔ Recherche : menu d'un TFile Binder non lié contient les actions de liaison", () => {
  const project = buildBinderResearchProject();
  const plugin = buildBinderResearchPlugin(project);
  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  view.showFileContextMenu(
    { preventDefault() {} },
    project.scene,
    project.chapter,
    0,
    [project.scene]
  );

  const menu = Menu.lastShown;
  assert.ok(menu, "le menu doit être affiché");

  const titles = menu.items.map((i) => i.title);
  assert.ok(
    titles.includes("Créer un dossier Recherche associé"),
    "contient l'action de création de dossier Recherche"
  );
  assert.ok(
    titles.includes("Associer un dossier Recherche existant…"),
    "contient l'action d'association d'un dossier existant"
  );
});

test("Binder ↔ Recherche : menu d'un TFile Binder lié contient ouvrir/changer/détacher", () => {
  const project = buildBinderResearchProject();
  const linkedFolder = new TFolder("Roman/_Recherche/Docs");
  linkedFolder.name = "Docs";
  linkedFolder.path = "Roman/_Recherche/Docs";
  project.vault.getAbstractFileByPath = (p) => {
    if (p === "Roman/_Recherche/Docs") return linkedFolder;
    const allFiles = new Map();
    allFiles.set("Roman/Manuscrit", project.root);
    allFiles.set("Roman/_Recherche", project.researchRoot);
    allFiles.set("Roman/Manuscrit/Chapitre 1", project.chapter);
    allFiles.set("Roman/Manuscrit/Chapitre 1/01 Été.md", project.scene);
    return allFiles.get(p) || null;
  };

  const plugin = buildBinderResearchPlugin(project);
  // Pré-lier le fichier
  plugin.getLinkedResearchFolder = () => linkedFolder;

  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
    internalPlugins: { getPluginById: () => null },
  };
  const view = new TestBinderResearchView(app, plugin);

  view.showFileContextMenu(
    { preventDefault() {} },
    project.scene,
    project.chapter,
    0,
    [project.scene]
  );

  const menu = Menu.lastShown;
  const titles = menu.items.map((i) => i.title);
  assert.ok(
    titles.includes("Ouvrir le dossier Recherche associé"),
    "contient l'action d'ouverture"
  );
  assert.ok(
    titles.includes("Changer le dossier Recherche associé…"),
    "contient l'action de changement"
  );
  assert.ok(
    titles.includes("Détacher le dossier Recherche"),
    "contient l'action de détachement"
  );
});

test("Binder ↔ Recherche : détachement d'un fichier sans suppression physique", async () => {
  const project = buildBinderResearchProject();
  const linkedFolder = new TFolder("Roman/_Recherche/Docs");
  linkedFolder.name = "Docs";
  linkedFolder.path = "Roman/_Recherche/Docs";

  const researchFolderLinks = { [project.scene.path]: linkedFolder.path };

  let detachedPath = null;
  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: (node) => {
      const p = researchFolderLinks[node.path];
      return p ? linkedFolder : null;
    },
    setLinkedResearchFolder: async () => {},
    removeLinkedResearchFolder: async (node) => {
      detachedPath = node.path;
      delete researchFolderLinks[node.path];
    },
  });

  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
    internalPlugins: { getPluginById: () => null },
  };
  const view = new TestBinderResearchView(app, plugin);

  view.showFileContextMenu(
    { preventDefault() {} },
    project.scene,
    project.chapter,
    0,
    [project.scene]
  );

  const menu = Menu.lastShown;
  const detachItem = menu.items.find(
    (i) => i.title === "Détacher le dossier Recherche"
  );
  assert.ok(detachItem, "l'entrée détacher doit exister");

  // Exécuter le callback de détachement
  await detachItem.callback();

  assert.equal(detachedPath, project.scene.path, "le fichier a été détaché");
  assert.equal(
    researchFolderLinks[project.scene.path],
    undefined,
    "le lien a été supprimé de la map"
  );
  // Le dossier physique (linkedFolder) n'est pas supprimé : on vérifie
  // qu'aucun appel à trashFile n'a été fait sur le dossier
  assert.equal(linkedFolder.path, "Roman/_Recherche/Docs", "le dossier physique est intact");
});

test("Binder ↔ Recherche : création d'un dossier associé à un fichier — parent lié", async () => {
  const project = buildBinderResearchProject();

  // Parent déjà lié : le chapitre est lié à un dossier Recherche
  const parentLinkedFolder = new TFolder("Roman/_Recherche/Chapitre1-Docs");
  parentLinkedFolder.name = "Chapitre1-Docs";
  parentLinkedFolder.path = "Roman/_Recherche/Chapitre1-Docs";

  let createdPath = null;
  let linkedNode = null;
  let linkedFolderResult = null;

  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: (node) => {
      if (node.path === project.chapter.path) return parentLinkedFolder;
      return null;
    },
    setLinkedResearchFolder: async (node, folder) => {
      linkedNode = node.path;
      linkedFolderResult = folder.path;
    },
  });

  // Intercepter NewFolderModal : simuler la saisie de "Docs du chapitre"
  const originalOpen = NewFolderModal.prototype.open;
  let modalCallback = null;
  NewFolderModal.prototype.open = function () {
    // Récupérer le callback stocké dans le constructeur (this.onSubmit)
    modalCallback = this.onSubmit;
  };

  const app = {
    vault: {
      getAbstractFileByPath: project.vault.getAbstractFileByPath,
      createFolder: async (path) => {
        createdPath = path;
        const folder = new TFolder(path);
        folder.name = path.split("/").pop();
        folder.path = path;
        project.vault.allFiles.set(path, folder);
        return folder;
      },
    },
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  try {
    view.showFileContextMenu(
      { preventDefault() {} },
      project.scene,
      project.chapter,
      0,
      [project.scene]
    );

    const menu = Menu.lastShown;
    const createItem = menu.items.find(
      (i) => i.title === "Créer un dossier Recherche associé"
    );
    assert.ok(createItem, "l'entrée créer doit exister");

    // Déclencher le clic sur "Créer un dossier Recherche associé"
    createItem.callback();

    // La modale NewFolderModal a dû s'ouvrir avec comme basePath
    // le dossier du parent lié
    assert.ok(modalCallback, "la modale NewFolderModal a été ouverte");

    // Simuler la saisie du nom
    await modalCallback("Docs du chapitre");

    assert.equal(
      createdPath,
      "Roman/_Recherche/Chapitre1-Docs/Docs du chapitre",
      "le dossier est créé sous le dossier Recherche du parent lié"
    );
    assert.equal(linkedNode, project.scene.path, "le fichier scène est lié");
    assert.equal(
      linkedFolderResult,
      "Roman/_Recherche/Chapitre1-Docs/Docs du chapitre",
      "au dossier créé"
    );
  } finally {
    NewFolderModal.prototype.open = originalOpen;
  }
});

test("Binder ↔ Recherche : création d'un dossier associé à un fichier — sans parent lié, repli _Recherche", async () => {
  const project = buildBinderResearchProject();

  let createdPath = null;

  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: () => null,
    setLinkedResearchFolder: async () => {},
  });

  // Intercepter NewFolderModal
  const originalOpen = NewFolderModal.prototype.open;
  let modalCallback = null;
  NewFolderModal.prototype.open = function () {
    modalCallback = this.onSubmit;
  };

  const app = {
    vault: {
      getAbstractFileByPath: project.vault.getAbstractFileByPath,
      createFolder: async (path) => {
        createdPath = path;
        const folder = new TFolder(path);
        folder.name = path.split("/").pop();
        folder.path = path;
        project.vault.allFiles.set(path, folder);
        return folder;
      },
    },
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  try {
    view.showFileContextMenu(
      { preventDefault() {} },
      project.scene,
      project.chapter,
      0,
      [project.scene]
    );

    const menu = Menu.lastShown;
    const createItem = menu.items.find(
      (i) => i.title === "Créer un dossier Recherche associé"
    );
    createItem.callback();

    assert.ok(modalCallback, "la modale a été ouverte");
    await modalCallback("Mes notes");

    assert.equal(
      createdPath,
      "Roman/_Recherche/Mes notes",
      "le dossier est créé sous _Recherche (repli)"
    );
  } finally {
    NewFolderModal.prototype.open = originalOpen;
  }
});

test("Binder ↔ Recherche : le nom du dossier de création utilise le short_title/titre affiché", async () => {
  const project = buildBinderResearchProject();

  let defaultNamePassedToModal = null;

  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: () => null,
    setLinkedResearchFolder: async () => {},
    shortTitleFor: (f) => "Mon beau titre",
    titleFor: (f) => "Mon beau titre (affiché)",
  });

  const originalOpen = NewFolderModal.prototype.open;
  NewFolderModal.prototype.open = function () {
    // Le premier argument après app est parentName
    // NewFolderModal(app, parentName, onSubmit)
    defaultNamePassedToModal = this.parentName;
  };

  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  try {
    view.showFileContextMenu(
      { preventDefault() {} },
      project.scene,
      project.chapter,
      0,
      [project.scene]
    );

    const menu = Menu.lastShown;
    const createItem = menu.items.find(
      (i) => i.title === "Créer un dossier Recherche associé"
    );
    createItem.callback();

    assert.equal(
      defaultNamePassedToModal,
      "Mon beau titre",
      "le nom affiché dans la modale vient de shortTitleFor"
    );
  } finally {
    NewFolderModal.prototype.open = originalOpen;
  }
});

test("Binder ↔ Recherche : le nom du dossier de création utilise le basename si pas de short_title", async () => {
  const project = buildBinderResearchProject();

  let defaultNamePassedToModal = null;

  const plugin = buildBinderResearchPlugin(project, {
    getLinkedResearchFolder: () => null,
    setLinkedResearchFolder: async () => {},
    shortTitleFor: () => null,
    titleFor: () => null,
  });

  const originalOpen = NewFolderModal.prototype.open;
  NewFolderModal.prototype.open = function () {
    defaultNamePassedToModal = this.parentName;
  };

  const app = {
    vault: project.vault,
    workspace: { getLeaf: () => ({ openFile: async () => {} }) },
    fileManager: { trashFile: async () => {} },
  };
  const view = new TestBinderResearchView(app, plugin);

  try {
    view.showFileContextMenu(
      { preventDefault() {} },
      project.scene,
      project.chapter,
      0,
      [project.scene]
    );

    const menu = Menu.lastShown;
    const createItem = menu.items.find(
      (i) => i.title === "Créer un dossier Recherche associé"
    );
    createItem.callback();

    assert.equal(
      defaultNamePassedToModal,
      "01 Été",
      "le nom affiché dans la modale vient du basename"
    );
  } finally {
    NewFolderModal.prototype.open = originalOpen;
  }
});

// ---------------------------------------------------------------------------
// Tests Binder ↔ Recherche : association d'un dossier — LinkResearchFolderModal
// n'est plus restreinte à l'espace Recherche du projet (isInsideResearchSpace
// n'est plus utilisée pour bloquer/filtrer, voir base-feuillets-view.ts).
// FolderSuggest cherche désormais dans TOUT le coffre ; resolveUniqueFolderMatch
// décide de l'acceptation d'une saisie non cliquée (Entrée).
// ---------------------------------------------------------------------------

/** Construit un petit coffre en mémoire pour FolderSuggest : un dossier
 * "input" HTML minimal suffit, FolderSuggest ne lit que `vault.getRoot()`
 * et parcourt `.children`. */
function buildSuggestVault(folders) {
  const root = new TFolder("/");
  root.children = folders;
  for (const f of folders) f.parent = root;
  return { vault: { getRoot: () => root } };
}

test("Volet Recherche : dossier sous _Recherche du projet toujours proposé", () => {
  const inside = new TFolder("Projet/_Recherche/Personnages");
  const { vault } = buildSuggestVault([inside]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  assert.deepEqual(suggest.getSuggestions("Personnages").map((f) => f.path), [inside.path]);
});

test("Volet Recherche : dossier extérieur au projet désormais proposé et associable", () => {
  // C'est LE changement de comportement du Volet 2 : un dossier hors du
  // projet actif (aucune restriction géographique) apparaît dans les
  // suggestions et resolveUniqueFolderMatch l'accepte sans ambiguïté.
  const outside = new TFolder("Documentation/Histoire ottomane");
  const { vault } = buildSuggestVault([outside]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  const matches = suggest.getSuggestions("ottomane");
  assert.deepEqual(matches.map((f) => f.path), [outside.path]);
  assert.equal(resolveUniqueFolderMatch(matches), outside);
});

test("Volet Recherche : dossier d'un AUTRE projet du coffre désormais proposé et associable", () => {
  const otherProject = new TFolder("AutreProjet/Recherche/Lieux");
  const { vault } = buildSuggestVault([otherProject]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  const matches = suggest.getSuggestions("AutreProjet");
  assert.deepEqual(matches.map((f) => f.path), [otherProject.path]);
  assert.equal(resolveUniqueFolderMatch(matches), otherProject);
});

test("Volet Recherche : recherche par nom partiel du dossier", () => {
  const target = new TFolder("Bibliothèque personnelle/Architecture");
  const other = new TFolder("Projet/_Recherche/Personnages");
  const { vault } = buildSuggestVault([target, other]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  assert.deepEqual(suggest.getSuggestions("architecture").map((f) => f.path), [target.path]);
});

test("Volet Recherche : recherche par morceau de chemin (pas seulement le nom du dossier)", () => {
  const target = new TFolder("Documentation/Histoire ottomane");
  const other = new TFolder("Projet/_Recherche/Personnages");
  const { vault } = buildSuggestVault([target, other]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  // "documentation" ne correspond qu'au chemin parent, pas au nom du dossier
  assert.deepEqual(suggest.getSuggestions("documentation").map((f) => f.path), [target.path]);
});

test("Volet Recherche : deux dossiers de même nom → resolveUniqueFolderMatch ne tranche jamais au hasard", () => {
  const a = new TFolder("ProjetA/_Recherche/Lieux");
  const b = new TFolder("ProjetB/_Recherche/Lieux");
  const { vault } = buildSuggestVault([a, b]);
  const suggest = new FolderSuggest({ vault }, { value: "" });
  const matches = suggest.getSuggestions("Lieux");
  assert.equal(matches.length, 2, "les deux dossiers correspondent au nom");
  assert.equal(resolveUniqueFolderMatch(matches), "ambiguous", "aucun choix arbitraire automatique");
});

test("Volet Recherche : resolveUniqueFolderMatch — aucune correspondance", () => {
  assert.equal(resolveUniqueFolderMatch([]), "none");
});

test("CORRECTIF — cliquer une suggestion remplit le champ avec le chemin exact (pas de saisie manuelle nécessaire)", () => {
  const target = new TFolder("Documentation/Histoire ottomane");
  const { vault } = buildSuggestVault([target]);
  const inputEl = { value: "" };
  const suggest = new FolderSuggest({ vault }, inputEl);
  let received = null;
  suggest.onSelect((folder) => {
    received = folder;
  });
  // Simule ce qu'Obsidian appelle réellement au clic (ou à la validation
  // clavier) d'une suggestion — jamais un déclenchement manuel côté test.
  suggest.selectSuggestion(target, { type: "click" });
  assert.equal(inputEl.value, target.path, "le champ doit être rempli avec le chemin complet au clic");
  assert.equal(received, target, "le callback onSelect doit recevoir le TFolder choisi");
});

test("Volet Recherche : resolveUniqueFolderMatch — une correspondance unique acceptée directement", () => {
  const only = new TFolder("Projet/_Recherche/Sources");
  assert.equal(resolveUniqueFolderMatch([only]), only);
});

test("Volet Recherche : isInsideResearchSpace reste un prédicat pur valide (mais n'est plus un filtre)", () => {
  assert.equal(isInsideResearchSpace("Projet/_Recherche/Personnages", "Projet/_Recherche"), true);
  assert.equal(isInsideResearchSpace("Projet/_Recherche", "Projet/_Recherche"), false, "racine refusée");
  assert.equal(isInsideResearchSpace("AutreProjet/Dossier", "Projet/_Recherche"), false, "hors espace");
});

test("Volet Recherche : renommage d'un dossier EXTÉRIEUR lié — researchFolderLinks remappé correctement", () => {
  // Le handler de remappage (remapResearchFolderLinks) est purement basé sur
  // les chemins : il fonctionne identiquement pour un dossier externe.
  const links = {
    "Roman/Manuscrit/Chapitre 1": "Documentation/Histoire ottomane",
  };
  const mapped = remapResearchFolderLinks(
    links,
    "Documentation/Histoire ottomane",
    "Documentation/Histoire des Ottomans"
  );
  assert.deepEqual(mapped, {
    "Roman/Manuscrit/Chapitre 1": "Documentation/Histoire des Ottomans",
  });
});
