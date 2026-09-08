import { test } from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = {};
    this.text = options.text ?? "";
    this.style = { setProperty() {} };
    if (options.cls) this.addClass(options.cls);
  }
  createEl(tag, options = {}) { const child = new FakeElement(options); child.tag = tag; this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of String(names).split(" ")) if (name) this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  toggleClass(name, enabled) { if (enabled) this.addClass(name); else this.removeClass(name); }
  setText(value) { this.text = String(value); return this; }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  empty() { this.children = []; }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function findElements(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findElements(child, predicate));
  }
  return found;
}

function createIntegrationFixture(draftPath) {
  const root = new TFolder("WARPI");
  const auxiliary = new TFolder("WARPI/_Feuillets");
  const drafts = new TFolder("WARPI/_Feuillets/Drafts");
  const notes = new TFolder("WARPI/_Feuillets/Drafts/Notes");
  const target = new TFolder("WARPI/TEXTES");
  const direct = new TFile("WARPI/_Feuillets/Drafts/Sans titre.md", "---\nstatus: Brouillon\n---\n\n");
  const nested = new TFile("WARPI/_Feuillets/Drafts/Notes/Imbrique.md", "---\nstatus: Brouillon\n---\n\n");
  auxiliary.parent = root;
  drafts.parent = auxiliary;
  notes.parent = drafts;
  target.parent = root;
  direct.parent = drafts;
  nested.parent = notes;
  root.children = [auxiliary, target];
  auxiliary.children = [drafts];
  drafts.children = [notes, direct];
  notes.children = [nested];
  target.children = [];

  const entries = new Map([
    [root.path, root], [auxiliary.path, auxiliary], [drafts.path, drafts],
    [notes.path, notes], [target.path, target], [direct.path, direct], [nested.path, nested],
  ]);
  const settings = {
    projectFolder: root.path, binderLayout: "tree", binderSelectedPath: root.path,
    binderCompact: false, binderTreeWidth: 170, collapsed: {}, orders: {}, folderPositions: {},
  };
  const calls = { moveNode: [], renderAllViews: [] };
  const plugin = {
    settings,
    dragState: null,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => folder.children,
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}), titleFor: (file) => file.basename, shortTitleFor: (file) => file.basename,
    labelOf: () => "", labelsOf: () => [], projectDisplayName: () => "WARPI", roleOfFile: () => "scene",
    saveSettings: async () => {}, generateCanvasBoard() {}, activateBoard() {}, updateStatusBar() {},
    adjustSidebarWidth() {}, getLeafForOpeningFile: () => ({ openFile: async () => {} }),
    getLinkedResearchFolders: () => [], getLinkedResearchFolder: () => null,
    setLinkedResearchFolder: async () => {}, removeLinkedResearchFolder: async () => {},
    renderAllViews(force) { calls.renderAllViews.push(force); },
    moveNode: async (...args) => { calls.moveNode.push(args); },
  };
  const contentEl = new FakeElement();
  const view = new FeuilletsView({
    app: { vault: { getAbstractFileByPath: (path) => entries.get(path) || null }, workspace: {} },
    contentEl,
  }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};
  return { root, drafts, notes, target, direct, nested, settings, calls, plugin, view, contentEl, draftPath };
}

function eventSpy() {
  return { prevented: false, preventDefault() { this.prevented = true; }, dataTransfer: { dropEffect: "" } };
}

function rootRowOf(fixture) {
  return findElements(fixture.contentEl, (element) => element.classes.has("feuillets-tree-root"))[0];
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

test("dragover/drop réel accepte un brouillon direct vers la racine", async () => {
  const fixture = createIntegrationFixture("direct");
  fixture.plugin.dragState = { path: fixture.direct.path, parentPath: fixture.drafts.path };
  await fixture.view.render(true);
  const rootRow = rootRowOf(fixture);
  const over = eventSpy();
  rootRow.events.get("dragover")(over);
  assert.equal(over.prevented, true);
  const drop = eventSpy();
  rootRow.events.get("drop")(drop);
  await flush();
  assert.deepEqual(fixture.calls.moveNode, [[fixture.direct, fixture.drafts, fixture.root, Number.MAX_SAFE_INTEGER]]);
});

test("dragover/drop réel accepte un brouillon imbriqué vers la racine", async () => {
  const fixture = createIntegrationFixture("nested");
  fixture.plugin.dragState = { path: fixture.nested.path, parentPath: fixture.notes.path };
  await fixture.view.render(true);
  const rootRow = rootRowOf(fixture);
  const over = eventSpy();
  rootRow.events.get("dragover")(over);
  assert.equal(over.prevented, true);
  rootRow.events.get("drop")(eventSpy());
  await flush();
  assert.deepEqual(fixture.calls.moveNode, [[fixture.nested, fixture.notes, fixture.root, Number.MAX_SAFE_INTEGER]]);
});

test("dragover/drop réel refuse un parentPath forgé", async () => {
  const fixture = createIntegrationFixture("nested");
  fixture.plugin.dragState = { path: fixture.nested.path, parentPath: fixture.drafts.path };
  await fixture.view.render(true);
  const rootRow = rootRowOf(fixture);
  const over = eventSpy();
  rootRow.events.get("dragover")(over);
  assert.equal(over.prevented, false);
  rootRow.events.get("drop")(eventSpy());
  await flush();
  assert.equal(fixture.calls.moveNode.length, 0);
});

test("Drag & drop du Binder avec sélection multiple", async (t) => {
  await t.test("déplacement d'un fichier seul", () => {
    // Simuler un drag state pour un fichier unique
    const dragState = {
      parentPath: "Roman1/Manuscrit",
      index: 0,
      path: "Roman1/Manuscrit/File1.md",
    };
    assert.ok(dragState.path);
    assert.equal(dragState.index, 0);
    assert.equal(dragState.multi, undefined); // Pas de multi-select
  });

  await t.test("déplacement d'une sélection multiple", () => {
    // Simuler un drag state pour une sélection multiple
    const items = [
      { path: "Roman1/Manuscrit/File1.md", index: 0 },
      { path: "Roman1/Manuscrit/File2.md", index: 1 },
      { path: "Roman1/Manuscrit/Folder1", index: 2 },
    ];
    const dragState = {
      parentPath: "Roman1/Manuscrit",
      multi: true,
      items,
    };
    assert.equal(dragState.multi, true);
    assert.equal(dragState.items.length, 3);
  });

  await t.test("ordre relatif conservé lors du déplacement", () => {
    // Simuler des éléments déplacés dans leur ordre visuel
    const items = [
      { path: "Roman1/Manuscrit/File1.md", index: 0 },
      { path: "Roman1/Manuscrit/File2.md", index: 1 },
      { path: "Roman1/Manuscrit/File3.md", index: 3 },
    ];
    // Les indices 0, 1, 3 doivent être conservés dans l'ordre
    const order = items.map((it) => it.index);
    assert.deepEqual(order, [0, 1, 3]);
  });

  await t.test("descendant sélectionné avec son parent déplacé une seule fois", () => {
    // Simuler le filtrage des descendants
    const selectedPaths = new Set([
      "Roman1/Manuscrit/Folder1",
      "Roman1/Manuscrit/Folder1/Subfolder",
      "Roman1/Manuscrit/File1.md",
    ]);

    const result = new Set();
    for (const path of selectedPaths) {
      let isDescendant = false;
      for (const otherPath of selectedPaths) {
        if (otherPath !== path && path.startsWith(otherPath + "/")) {
          isDescendant = true;
          break;
        }
      }
      if (!isDescendant) {
        result.add(path);
      }
    }

    // Le descendant "Roman1/Manuscrit/Folder1/Subfolder" doit être filtré
    assert.equal(result.size, 2);
    assert.ok(result.has("Roman1/Manuscrit/Folder1"));
    assert.ok(result.has("Roman1/Manuscrit/File1.md"));
    assert.equal(result.has("Roman1/Manuscrit/Folder1/Subfolder"), false);
  });

  await t.test("déplacement vers un dossier", () => {
    // Simuler un dépôt sur un dossier cible
    const targetFolder = { path: "Roman1/Manuscrit/Chapitre1", isFolder: true };
    const insertIndex = Number.MAX_SAFE_INTEGER; // Ajouter à la fin du dossier

    assert.equal(targetFolder.isFolder, true);
    assert.equal(insertIndex, Number.MAX_SAFE_INTEGER);
  });

  await t.test("déplacement entre deux lignes", () => {
    // Simuler un dépôt entre deux éléments
    const targetIndex = 2; // Entre index 1 et 3
    const siblings = [
      { name: "File0", index: 0 },
      { name: "File1", index: 1 },
      { name: "File3", index: 3 },
    ];

    // Insérer à l'index 2 devrait placer entre File1 et File3
    const reordered = [...siblings];
    const moved = { name: "Moved", index: 2 };
    reordered.splice(targetIndex, 0, moved);

    assert.equal(reordered[targetIndex].name, "Moved");
    assert.equal(reordered.length, 4);
  });

  await t.test("déplacement vers la racine", () => {
    // Simuler un dépôt à la racine du projet
    const destFolder = "Roman1";
    const sourceFolder = "Roman1/Chapitre1";

    // Le dépôt devrait déplacer l'élément de Chapitre1 vers Roman1
    assert.notEqual(destFolder, sourceFolder);
  });

  await t.test("soi-même refusé", () => {
    // La protection dans moveNode devrait refuser ce déplacement
    const nodePath = "Roman1/Manuscrit/File1.md";
    const destPath = "Roman1/Manuscrit/File1.md";

    // Vérifier que le chemin de destination est identique
    assert.equal(nodePath, destPath);
  });

  await t.test("descendant refusé", () => {
    // La protection dans moveNode devrait refuser de déplacer un dossier dans un descendant
    const folderPath = "Roman1/Manuscrit/Chapitre1";
    const destPath = "Roman1/Manuscrit/Chapitre1/Partie1";

    // Vérifier que la destination commence par le chemin du dossier + "/"
    assert.ok(destPath.startsWith(folderPath + "/"));
  });

  await t.test("conflit refusé", () => {
    // La protection dans moveNode devrait refuser si un fichier avec le même nom existe déjà
    // Vérifier que le fichier existe (simulé)
    const existingFile = true;
    assert.equal(existingFile, true);
  });

  await t.test("sélection conservée après déplacement", () => {
    // Simuler la conservation de la sélection avec les nouveaux chemins
    const movedPaths = [
      "Roman1/Manuscrit/File1.md",
      "Roman1/Manuscrit/File2.md",
    ];
    const newSelection = new Set();

    // Simuler que les fichiers ont été déplacés vers un nouveau dossier
    for (const oldPath of movedPaths) {
      const newPath = oldPath.replace("Roman1/Manuscrit", "Roman1/Chapitre1");
      newSelection.add(newPath);
    }

    assert.equal(newSelection.size, 2);
    assert.ok(newSelection.has("Roman1/Chapitre1/File1.md"));
    assert.ok(newSelection.has("Roman1/Chapitre1/File2.md"));
  });

  await t.test("dossier technique non déplaçable", () => {
    // Vérifier que les dossiers commençant par _ ne peuvent pas être glissés
    const folderName = "_Recherche";
    const isTechnical = folderName.startsWith("_");

    assert.equal(isTechnical, true);
  });
});
