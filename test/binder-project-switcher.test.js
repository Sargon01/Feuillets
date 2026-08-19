import test from "node:test";
import assert from "node:assert/strict";
import { TFolder, Menu } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";
import { t } from "../src/i18n/index.js";

/* Sélecteur de projet de l'en-tête Binder (split) : un chevron dans la ligne
 * racine, visible UNIQUEMENT avec au moins deux projets VALIDES, ouvrant un
 * Menu natif Obsidian dont chaque choix passe par le chemin UNIQUE
 * `plugin.switchProject` (commande `switch-project`, gestionnaire de projets
 * et ce chevron partagent la même méthode). `stopPropagation()` : jamais le
 * clic de la ligne racine (selectFolder). */

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = { escape: (value) => String(value).replace(/["\\]/g, "\\$&") };
}
globalThis.window ??= { setTimeout: (...args) => setTimeout(...args), clearTimeout: (handle) => clearTimeout(handle), requestAnimationFrame: () => 0 };

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attrs = {};
    this.text = options.text ?? "";
    this.style = { _props: {}, setProperty(name, value) { this._props[name] = value; } };
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
  addClass(classNames) { for (const c of String(classNames).split(" ")) if (c) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  toggleClass(className, on) { on ? this.classes.add(className) : this.classes.delete(className); }
  hide() { this.hidden = true; }
  show() { this.hidden = false; }
  scrollIntoView() {}
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  empty() { this.children = []; }
  querySelector() { return null; }
  querySelectorAll(selector) {
    const classNames = (selector.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    const attrNames = (selector.match(/\[[\w-]+\]/g) || []).map((a) => a.slice(1, -1));
    const matches = [];
    const walk = (el) => {
      for (const child of el.children) {
        const classOk = classNames.every((c) => child.classes.has(c));
        const attrOk = attrNames.every((a) => Object.prototype.hasOwnProperty.call(child.attrs, a));
        if (classOk && attrOk) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function findAll(root, predicate) {
  const out = [];
  const walk = (el) => {
    for (const child of el.children) {
      if (predicate(child)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function baseSettings(overrides = {}) {
  return {
    projectFolder: "",
    projects: [],
    projectMeta: {},
    binderLayout: "split",
    binderSelectedPath: "",
    binderCompact: false,
    binderTreeWidth: 170,
    binderTreeCollapsed: false,
    binderListCollapsed: false,
    binderSplitRecursive: true,
    collapsed: {},
    orders: {},
    folderPositions: {},
    ...overrides,
  };
}

function makeVault(allFiles) {
  return {
    getAbstractFileByPath: (path) => allFiles.get(path) || null,
    getRoot: () => allFiles.get("") ?? (() => {
      const root = new TFolder("");
      root.name = "";
      allFiles.set("", root);
      return root;
    })(),
  };
}

/** Deux projets VALIDES : NEFES (actif) + AUTRE (dans settings.projects).
 * `plugin.switchProject` est un espion : le seul chemin de changement autorisé
 * doit être cette méthode — jamais une mutation directe de settings. */
function createSwitcherFixture({ settingsOverrides = {}, withSecondProject = true } = {}) {
  const root = new TFolder("NEFES");
  const autre = new TFolder("AUTRE");
  root.children = [];
  autre.children = [];

  const vaultRoot = new TFolder("");
  vaultRoot.name = "";
  vaultRoot.children = [];

  const allFiles = new Map([
    ["NEFES", root],
    ["AUTRE", autre],
    ["", vaultRoot],
  ]);

  const settings = baseSettings({
    projectFolder: root.path,
    binderSelectedPath: root.path,
    projects: withSecondProject ? [autre.path] : [],
    ...settingsOverrides,
  });

  const calls = {
    switchProject: [],
    saveSettings: 0,
    renderAllViews: [],
  };

  const contentEl = new FakeElement();
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getResearchRoot: () => null,
    getVersionsRoot: () => null,
    getOrderedChildren: (folder) => (folder && folder.children) || [],
    flattenFiles: () => [],
    getWordCounts: async () => new Map(),
    buildNumbering: () => new Map(),
    fmOf: () => ({}),
    titleFor: (file) => file.basename,
    shortTitleFor: (file) => file.basename,
    labelOf: () => "",
    labelsOf: () => [],
    projectDisplayName: (path) => (path === root.path ? "NEFES" : "Autre Projet"),
    roleOfFile: () => "scene",
    saveSettings: async () => { calls.saveSettings++; },
    generateCanvasBoard() {},
    activateBoard() {},
    renderAllViews(force) { calls.renderAllViews.push(force); },
    updateStatusBar() {},
    adjustSidebarWidth() {},
    newFolder() {},
    newSheet() {},
    moveNode: async () => {},
    getLeafForOpeningFile: () => ({ id: "work-leaf", openFile: async () => {} }),
    getLinkedResearchFolder: () => null,
    dragState: null,
    // Chemin UNIQUE de changement de projet — espionné.
    switchProject: async (path) => { calls.switchProject.push(path); return true; },
  };

  const view = new FeuilletsView({
    app: {
      vault: makeVault(allFiles),
      workspace: {
        setActiveLeaf: () => {},
        getLeaf: (kind, dir) => ({ id: `leaf-${kind || "default"}-${dir || ""}`, openFile: async () => {} }),
        revealLeaf: async () => {},
      },
    },
    contentEl,
  }, plugin);
  view.attachDragHandlers = () => {};
  view.updateActiveHighlight = () => {};

  return { view, contentEl, plugin, settings, root, autre, calls };
}

function switcherOf(contentEl) {
  return findAll(contentEl, (el) => el.classes.has("clickable-icon") && el.attrs["aria-label"] === t("binder.switchProject"));
}

function rootRowOf(contentEl) {
  return findAll(contentEl, (el) => el.classes.has("feuillets-tree-root"))[0];
}

/* --- Pas de switcher avec un seul projet valide --- */

test("1 projet valide : aucun chevron dans l'en-tête racine", async () => {
  const { view, contentEl } = createSwitcherFixture({ withSecondProject: false });
  await view.render(true);
  assert.equal(switcherOf(contentEl).length, 0);
});

test("2 projets valides : chevron présent, icône Lucide chevron-down", async () => {
  const { view, contentEl } = createSwitcherFixture();
  await view.render(true);
  const switcher = switcherOf(contentEl);
  assert.equal(switcher.length, 1);
  assert.equal(switcher[0].icon, "chevron-down");
  assert.equal(switcher[0].attrs["title"], t("binder.switchProject"));
});

test("le chevron est un enfant direct de la ligne racine, après le nom", async () => {
  const { view, contentEl } = createSwitcherFixture();
  await view.render(true);
  const rootRow = rootRowOf(contentEl);
  assert.ok(rootRow);
  const switcher = switcherOf(rootRow);
  assert.equal(switcher.length, 1);
  const nameIdx = rootRow.children.findIndex((c) => c.classes.has("feuillets-folder-name"));
  const btnIdx = rootRow.children.indexOf(switcher[0]);
  assert.ok(nameIdx >= 0 && btnIdx > nameIdx);
});

/* --- Menu natif : noms d'affichage, projet actif coché --- */

test("le menu liste les noms d'affichage des projets, actif coché", async () => {
  const { view, contentEl } = createSwitcherFixture();
  await view.render(true);
  Menu.lastShown = null;
  const switchBtn = switcherOf(contentEl)[0];
  switchBtn.events.get("click")({ stopPropagation() {} });

  const menu = Menu.lastShown;
  assert.ok(menu, "un Menu natif doit s'ouvrir");
  assert.equal(menu.items.length, 2);
  assert.deepEqual(
    menu.items.map((i) => i.title),
    ["NEFES", "Autre Projet"],
    "titre = plugin.projectDisplayName(path), pas le chemin brut"
  );
  const active = menu.items.find((i) => i.title === "NEFES");
  const other = menu.items.find((i) => i.title === "Autre Projet");
  assert.equal(active.checked, true, "le projet actif est coché");
  assert.equal(other.checked, false, "les autres ne le sont pas");
});

/* --- Clic : passage UNIQUE par plugin.switchProject --- */

test("choisir un projet dans le menu appelle switchProject, jamais une mutation directe", async () => {
  const { view, contentEl, settings, calls, autre } = createSwitcherFixture();
  await view.render(true);
  Menu.lastShown = null;
  switcherOf(contentEl)[0].events.get("click")({ stopPropagation() {} });
  const menu = Menu.lastShown;
  const item = menu.items.find((i) => i.title === "Autre Projet");
  assert.ok(item);
  item.callback();
  await flush();

  assert.deepEqual(calls.switchProject, [autre.path], "l'unique méthode de changement est plugin.switchProject");
  assert.equal(settings.projectFolder, "NEFES", "le menu ne mute pas settings.projectFolder lui-même");
  assert.equal(calls.saveSettings, 0, "le menu ne sauvegarde pas lui-même (switchProject s'en charge)");
});

test("le clic chevron seul (sans choix) n'appelle rien", async () => {
  const { view, contentEl, calls } = createSwitcherFixture();
  await view.render(true);
  Menu.lastShown = null;
  switcherOf(contentEl)[0].events.get("click")({ stopPropagation() {} });
  await flush();
  assert.ok(Menu.lastShown, "le menu s'ouvre bien");
  assert.deepEqual(calls.switchProject, [], "aucun changement tant qu'aucun élément n'est choisi");
});

/* --- stopPropagation : jamais le clic de la ligne racine --- */

test("le clic chevron stoppe la propagation et ne déclenche pas selectFolder de la racine", async () => {
  const { view, contentEl, settings } = createSwitcherFixture({
    settingsOverrides: { binderSelectedPath: "NEFES/Front" },
  });
  await view.render(true);

  // Détecter selectFolder : la ligne racine ramènerait binderSelectedPath à
  // NEFES et re-rendrait. `view.render` est espionné pour le détecter.
  let renders = 0;
  const origRender = view.render.bind(view);
  view.render = async (...args) => { renders++; return origRender(...args); };
  await view.render(true);

  const rootRow = rootRowOf(contentEl);
  const switchBtn = switcherOf(contentEl)[0];
  assert.ok(switchBtn && rootRow);

  const event = { stopped: false, stopPropagation() { this.stopped = true; } };
  switchBtn.events.get("click")(event);
  assert.equal(event.stopped, true, "le chevron appelle stopPropagation");

  // Émulation de la propagation DOM : si le clic avait atteint la racine,
  // selectFolder aurait remis la sélection sur NEFES. Comme il est stoppé,
  // ce handler ne s'exécute jamais.
  if (!event.stopped) rootRow.events.get("click")();
  await flush();

  assert.equal(settings.binderSelectedPath, "NEFES/Front", "selectFolder de la racine n'a pas été déclenché");
  assert.equal(renders, 1, "pas de re-render dû au clic chevron (seul le render initial a eu lieu)");
});

/* --- Clic sur le nom du projet : ouvre ManageProjectsModal --- */

test("le nom du projet (racine réelle) est interactif et accessible", async () => {
  const { view, contentEl } = createSwitcherFixture();
  await view.render(true);
  const rootRow = rootRowOf(contentEl);
  const rootName = rootRow.children.find((c) => c.classes.has("feuillets-folder-name"));
  assert.ok(rootName);
  assert.equal(rootName.getAttr("role"), "button", "le nom a role='button'");
  assert.equal(rootName.getAttr("tabindex"), "0", "le nom est dans le flux de tabulation");
  assert.ok(rootName.events.has("click"), "le nom a un gestionnaire click");
  assert.ok(rootName.events.has("keydown"), "le nom a un gestionnaire keydown");
});

test("clic sur le nom du projet n'appelle pas switchProject", async () => {
  const { view, contentEl, calls } = createSwitcherFixture();
  await view.render(true);
  const rootRow = rootRowOf(contentEl);
  const rootName = rootRow.children.find((c) => c.classes.has("feuillets-folder-name"));

  rootName.events.get("click")({ preventDefault() {}, stopPropagation() {} });
  await flush();

  assert.deepEqual(calls.switchProject, [], "clic nom n'appelle pas switchProject (c'est pour le chevron seul)");
});

test("clic sur le nom du projet ne déclenche pas selectFolder", async () => {
  const { view, contentEl, settings } = createSwitcherFixture({
    settingsOverrides: { binderSelectedPath: "NEFES/autre" },
  });
  await view.render(true);
  const rootRow = rootRowOf(contentEl);
  const rootName = rootRow.children.find((c) => c.classes.has("feuillets-folder-name"));

  const initialPath = settings.binderSelectedPath;
  rootName.events.get("click")({ preventDefault() {}, stopPropagation() {} });
  await flush();

  assert.equal(settings.binderSelectedPath, initialPath, "clic nom ne change pas binderSelectedPath");
});

test("touche Enter sur le nom du projet déclenche le gestionnaire keydown", async () => {
  const { view, contentEl } = createSwitcherFixture();
  await view.render(true);
  const rootRow = rootRowOf(contentEl);
  const rootName = rootRow.children.find((c) => c.classes.has("feuillets-folder-name"));

  const prevented = { value: false };
  const keyEvent = {
    key: "Enter",
    preventDefault() { prevented.value = true; },
    stopPropagation() {},
  };
  assert.doesNotThrow(() => rootName.events.get("keydown")(keyEvent), "touche Enter ne lève pas");
  assert.equal(prevented.value, true, "preventDefault est appelé pour Enter");
});

test("touche Espace sur le nom du projet déclenche le gestionnaire keydown et prévient par défaut", async () => {
  const { view, contentEl } = createSwitcherFixture();
  await view.render(true);
  const rootRow = rootRowOf(contentEl);
  const rootName = rootRow.children.find((c) => c.classes.has("feuillets-folder-name"));

  const prevented = { value: false };
  const keyEvent = {
    key: " ",
    preventDefault() { prevented.value = true; },
    stopPropagation() {},
  };
  assert.doesNotThrow(() => rootName.events.get("keydown")(keyEvent), "touche Espace ne lève pas");
  assert.equal(prevented.value, true, "preventDefault est appelé pour Espace");
});

test("clic sur le chevron n'ouvre pas ManageProjectsModal, ouvre Menu natif", async () => {
  const { view, contentEl } = createSwitcherFixture();
  await view.render(true);
  Menu.lastShown = null;

  const switchBtn = switcherOf(contentEl)[0];
  switchBtn.events.get("click")({ stopPropagation() {} });

  assert.ok(Menu.lastShown, "le chevron ouvre un Menu natif");
});
