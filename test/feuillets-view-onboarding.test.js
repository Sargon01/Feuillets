import assert from "node:assert/strict";
import test from "node:test";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { hasKnownProject } from "../src/services/folder-structure.js";

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
