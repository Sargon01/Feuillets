import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TFolder, Menu, Notice } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ResearchView } from "../src/views/research-view.js";
import { EXCALIDRAW_PLUGIN_ID } from "../src/services/research-create.js";
import { t } from "../src/i18n/index.js";

globalThis.window ??= {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
};

/* FakeElement minimal — même contrat que les autres tests de
   base-feuillets-view.ts (voir base-feuillets-bibliography.test.js) : assez
   de DOM factice pour que createEl/createDiv/createSpan/setText/setAttr
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
  querySelector(selector) { return this.find(selector); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs.set(name, value); return this; }
  getAttr(name) { return this.attrs.get(name); }
  setAttribute(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name); }
  empty() { this.children = []; }
  addEventListener(type, callback) {
    this.events ||= new Map();
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(callback);
  }
}

function folder(path, children = []) {
  const value = new TFolder(path);
  value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function buildView({ excalidrawActive = false, excalidrawAddsItem = excalidrawActive } = {}) {
  const root = folder("Recherche");
  const { vault } = createFakeVault([root]);
  const triggerCalls = [];
  const drawingCalls = [];
  const leafOpenFileCalls = [];
  const fakeLeaf = {
    openFile: async (file, opts) => { leafOpenFileCalls.push({ file, opts }); },
  };
  const app = {
    vault,
    workspace: {
      getLeaf: () => fakeLeaf,
      setActiveLeaf: () => {},
      /* Simule l'enregistrement RÉEL d'Excalidraw sur "file-menu" (voir
         research-create.test.js) : le dossier cible est capturé par SA
         PROPRE fermeture, jamais passé en argument au callback. */
      trigger: (name, menu, file, source) => {
        triggerCalls.push([name, menu, file, source]);
        if (name === "file-menu" && excalidrawAddsItem) {
          menu.addItem((item) => {
            item.setTitle("New drawing").setIcon("excalidraw-icon").onClick((evt) => {
              drawingCalls.push({ evt, folder: file });
            });
          });
        }
      },
    },
    plugins: { enabledPlugins: new Set(excalidrawActive ? [EXCALIDRAW_PLUGIN_ID] : []) },
  };
  const newFolderCalls = [];
  const renderCalls = [];
  const plugin = { app, settings: {}, newFolder: (f) => { newFolderCalls.push(f); } };
  const contentEl = new FakeElement();
  const leaf = { app, contentEl };
  const view = new ResearchView(leaf, plugin);
  view.render = async (force) => { renderCalls.push(force); };
  return { app, plugin, view, root, triggerCalls, drawingCalls, newFolderCalls, renderCalls, leafOpenFileCalls };
}

function itemsOf(menu) {
  return menu.items.filter((i) => !i.separator);
}

test("showResearchCreateMenu : 5 entrées dans l'ordre (fiche, Canvas, Base, Excalidraw, sous-dossier) quand Excalidraw est actif", () => {
  const { view, root } = buildView({ excalidrawActive: true });
  const ficheCalls = [];
  view.showResearchCreateMenu({ type: "click" }, root, () => { ficheCalls.push(true); });

  const items = itemsOf(Menu.lastShown);
  assert.deepEqual(items.map((i) => i.title), [
    t("shared.research.newSheetMenuItem"),
    t("shared.research.newCanvas"),
    t("shared.research.newBase"),
    t("shared.research.newExcalidraw"),
    t("binder.newSubfolder"),
  ]);

  items[0].callback();
  assert.equal(ficheCalls.length, 1);
});

test("showResearchCreateMenu : masque « Nouveau dessin Excalidraw » quand le greffon est absent (présence conditionnelle)", () => {
  const { view, root } = buildView({ excalidrawActive: false });
  view.showResearchCreateMenu({ type: "click" }, root, () => {});
  const titles = itemsOf(Menu.lastShown).map((i) => i.title);
  assert.equal(titles.includes(t("shared.research.newExcalidraw")), false);
  assert.deepEqual(titles, [
    t("shared.research.newSheetMenuItem"),
    t("shared.research.newCanvas"),
    t("shared.research.newBase"),
    t("binder.newSubfolder"),
  ]);
});

test("showResearchCreateMenu : « Nouveau Canvas » dépose un .canvas JSON valide dans le dossier ciblé, l'ouvre puis rafraîchit", async () => {
  const { view, root, renderCalls, leafOpenFileCalls } = buildView();
  view.showResearchCreateMenu({ type: "click" }, root, () => {});
  const canvasItem = itemsOf(Menu.lastShown).find((i) => i.title === t("shared.research.newCanvas"));
  canvasItem.callback();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const created = view.app.vault.getAbstractFileByPath("Recherche/Canvas.canvas");
  assert.ok(created);
  assert.deepEqual(JSON.parse(created.content), { nodes: [], edges: [] });
  assert.equal(leafOpenFileCalls.length, 1);
  assert.equal(leafOpenFileCalls[0].file, created);
  assert.deepEqual(renderCalls, [true]);
});

test("showResearchCreateMenu : « Nouvelle Base » dépose un .base filtré sur le dossier ciblé, l'ouvre puis rafraîchit", async () => {
  const { view, root, renderCalls, leafOpenFileCalls } = buildView();
  view.showResearchCreateMenu({ type: "click" }, root, () => {});
  const baseItem = itemsOf(Menu.lastShown).find((i) => i.title === t("shared.research.newBase"));
  baseItem.callback();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const created = view.app.vault.getAbstractFileByPath("Recherche/Base.base");
  assert.ok(created);
  assert.match(created.content, /file\.inFolder\("Recherche"\)/);
  assert.match(created.content, /type: table/);
  assert.equal(leafOpenFileCalls.length, 1);
  assert.deepEqual(renderCalls, [true]);
});

test("showResearchCreateMenu : « Nouveau dessin Excalidraw » exécute directement le callback \"New drawing\" du dossier ciblé, sans aucun menu contextuel intermédiaire", () => {
  const { view, root, triggerCalls, drawingCalls } = buildView({ excalidrawActive: true });
  view.showResearchCreateMenu({ type: "click" }, root, () => {});
  const outerMenu = Menu.lastShown; // le menu « + » lui-même, déjà affiché.
  const excaliItem = itemsOf(outerMenu).find((i) => i.title === t("shared.research.newExcalidraw"));
  const clickEvt = { type: "click" };
  excaliItem.callback(clickEvt);

  // "file-menu" bien déclenché sur le dossier ciblé, jamais un identifiant de commande.
  assert.equal(triggerCalls.length, 1);
  const [name, menu, file, source] = triggerCalls[0];
  assert.equal(name, "file-menu");
  assert.ok(menu instanceof Menu);
  assert.equal(file, root);
  assert.equal(source, "file-explorer-context-menu");

  // Le callback "New drawing" a bien tourné, ciblé sur le bon dossier —
  // et aucun .excalidraw.md n'a été fabriqué par ce plugin.
  assert.equal(drawingCalls.length, 1);
  assert.equal(drawingCalls[0].evt, clickEvt);
  assert.equal(drawingCalls[0].folder, root);
  assert.equal(view.app.vault.getFiles().length, 0);

  // Aucun menu contextuel intermédiaire : Menu.lastShown reste le menu
  // « + » lui-même, jamais un second popup issu du clic sur l'entrée.
  assert.equal(Menu.lastShown, outerMenu);
  assert.equal(menu.event, undefined);
  assert.equal(menu.position, undefined);
});

test("showResearchCreateMenu : Excalidraw actif mais aucun item de dessin ajouté -> Notice, rien n'est créé, jamais de menu affiché", () => {
  const { view, root } = buildView({ excalidrawActive: true, excalidrawAddsItem: false });
  const notices = [];
  const previousOnCreate = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    view.showResearchCreateMenu({ type: "click" }, root, () => {});
    const outerMenu = Menu.lastShown;
    const excaliItem = itemsOf(outerMenu).find((i) => i.title === t("shared.research.newExcalidraw"));
    excaliItem.callback({ type: "click" });

    assert.equal(notices.length, 1);
    assert.equal(notices[0], t("main.notice.excalidrawDrawingUnavailable"));
    assert.equal(Menu.lastShown, outerMenu);
    assert.equal(view.app.vault.getFiles().length, 0);
  } finally {
    Notice.onCreate = previousOnCreate;
  }
});

test("showResearchCreateMenu : « Nouveau sous-dossier » réutilise le flux existant plugin.newFolder", () => {
  const { view, root, newFolderCalls } = buildView();
  view.showResearchCreateMenu({ type: "click" }, root, () => {});
  const subfolderItem = itemsOf(Menu.lastShown).find((i) => i.title === t("binder.newSubfolder"));
  subfolderItem.callback();
  assert.deepEqual(newFolderCalls, [root]);
});

/* ===== les 3 surfaces (racine, sous-dossier, dossier associé) délèguent
   au même menu — vérification du branchement, la composition du menu
   elle-même est déjà entièrement couverte ci-dessus. */

test("renderSection route le « + » de la racine ET des dossiers associés (même appel) vers showResearchCreateMenu pour un dossier réel", () => {
  const source = readFileSync(resolve(process.cwd(), "src/views/base-feuillets-view.ts"), "utf8");
  assert.match(
    source,
    /onCreate: onCreate\s*\?\s*\(folderOrFiles instanceof TFolder\s*\?\s*\(event: MouseEvent\) => this\.showResearchCreateMenu\(event, folderOrFiles, onCreate\)/,
    "renderSection doit ouvrir showResearchCreateMenu quand la rubrique est adossée à un vrai dossier"
  );
});

test("renderAssociatedResearchFolders (dossiers Recherche associés) passe le dossier réel à renderSection, donc au même menu", () => {
  const source = readFileSync(resolve(process.cwd(), "src/views/base-feuillets-view.ts"), "utf8");
  assert.match(
    source,
    /this\.promptCreateResearchFileInFolder\(folder\);\s*\n\s*},\s*\n\s*"linked",/,
    "renderAssociatedResearchFolders doit toujours appeler renderSection avec `folder` (TFolder) comme cible de création"
  );
});

test("renderResearchSubfolder route son bouton « + » vers showResearchCreateMenu", () => {
  const source = readFileSync(resolve(process.cwd(), "src/views/base-feuillets-view.ts"), "utf8");
  assert.match(
    source,
    /this\.showResearchCreateMenu\(event, folder, \(\) => this\.promptCreateResearchFileInFolder\(folder\)\)/,
    "renderResearchSubfolder doit ouvrir le même menu de création que la racine"
  );
});
