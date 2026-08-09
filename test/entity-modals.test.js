import assert from "node:assert/strict";
import test from "node:test";
import { Menu, TFile, TFolder } from "obsidian";
import {
  AppearancesModal,
  FolderGoalModal,
  ManageSavedFiltersModal,
  SaveResearchFilterModal,
  TagsModal,
} from "../src/ui/entity-modals.js";
import { BoardView } from "../src/views/board-view.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.value = "";
    this.text = options.text ?? "";
    this.attributes = { ...(options.attr ?? {}) };
    this.style = { cssText: "", setProperty() {} };
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  addClass(classNames) {
    for (const className of classNames.split(" ")) this.classes.add(className);
  }

  hide() { this.hidden = true; }

  setText(text) {
    this.text = String(text);
    return this;
  }

  setAttr(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, callback) {
    this.events.set(type, callback);
  }

  async trigger(type, event = {}) {
    await this.events.get(type)?.(event);
  }

  focus() {}

  empty() {
    this.children = [];
  }

  remove() {
    this.removed = true;
  }
}

function findElements(element, predicate) {
  const found = [];
  for (const child of element.children) {
    if (predicate(child)) found.push(child);
    found.push(...findElements(child, predicate));
  }
  return found;
}

function createModal(ModalClass, args) {
  const modal = new ModalClass(...args);
  modal.app = args[0];
  modal.contentEl = new FakeElement();
  modal.close = () => {};
  return modal;
}

test("TagsModal normalise et déduplique les tags avant la sauvegarde", async () => {
  const file = new TFile("Projet/scene.md");
  let savedFrontmatter;
  const app = {
    fileManager: {
      async processFrontMatter(_file, update) {
        savedFrontmatter = {};
        update(savedFrontmatter);
      },
    },
  };
  const plugin = { settings: {}, titleFor: () => "Scène", tagsOf: () => [] };
  const modal = createModal(TagsModal, [app, plugin, file]);
  let closed = false;
  modal.close = () => { closed = true; };

  modal.onOpen();
  const input = findElements(modal.contentEl, (element) => element.tag === "input")[0];
  input.value = "#roman, enquete roman #enquete";
  await findElements(modal.contentEl, (element) => element.tag === "button")[0].trigger("click");

  assert.deepEqual(savedFrontmatter.tags, ["roman", "enquete"]);
  assert.equal(closed, true);
});

test("TagsModal supprime les tags quand la saisie est vide", async () => {
  const file = new TFile("Projet/scene.md");
  let savedFrontmatter;
  const app = {
    fileManager: {
      async processFrontMatter(_file, update) {
        savedFrontmatter = { tags: ["ancien"] };
        update(savedFrontmatter);
      },
    },
  };
  const plugin = { settings: {}, titleFor: () => "Scène", tagsOf: () => ["ancien"] };
  const modal = createModal(TagsModal, [app, plugin, file]);

  modal.onOpen();
  const input = findElements(modal.contentEl, (element) => element.tag === "input")[0];
  input.value = "";
  await findElements(modal.contentEl, (element) => element.tag === "button")[0].trigger("click");

  assert.equal("tags" in savedFrontmatter, false);
});

test("BoardView : Modifier les tags ouvre TagsModal pour la carte concernée", () => {
  const file = new TFile("Projet/Manuscrit/Scène.md");
  const parent = new TFolder("Projet/Manuscrit");
  file.parent = parent;
  const contentEl = new FakeElement();
  const app = {
    vault: { cachedRead: async () => "Texte." },
    workspace: {},
  };
  const plugin = {
    settings: { statuses: [], showProgress: false, showCardTags: false },
    fmOf: () => ({}),
    roleOfFile: () => "scene",
    labelOf: () => "",
    labelColor: () => null,
    shortTitleFor: () => file.basename,
  };
  const view = new BoardView({ app, contentEl }, plugin);
  view.wcMap = new Map([[file.path, 0]]);
  view.filterActive = () => true;

  const originalOpen = TagsModal.prototype.open;
  let openedFor = null;
  TagsModal.prototype.open = function () { openedFor = this.file; };
  try {
    view.renderCard(contentEl, parent, file, 0, [file], new Map(), () => {});
    const more = findElements(contentEl, (element) => element.classes.has("feuillets-card-more"))[0];
    more.events.get("click")({ stopPropagation() {} });
    const editTags = Menu.lastShown.items.find((item) => item.title === "Modifier les tags…");
    editTags.callback();

    assert.equal(openedFor, file);
  } finally {
    TagsModal.prototype.open = originalOpen;
  }
});

test("FolderGoalModal sauvegarde un objectif positif avant de fermer", async () => {
  const folder = new TFolder("Projet/Acte 1");
  const order = [];
  const plugin = {
    settings: { folderGoals: {} },
    async saveSettings() { order.push("save"); },
    renderAllViews() { order.push("render"); },
  };
  const modal = createModal(FolderGoalModal, [{}, plugin, folder]);
  modal.close = () => { order.push("close"); };

  modal.onOpen();
  findElements(modal.contentEl, (element) => element.tag === "input")[0].value = "450";
  await findElements(modal.contentEl, (element) => element.classes.has("mod-cta"))[0].trigger("click");

  assert.equal(plugin.settings.folderGoals[folder.path], 450);
  assert.deepEqual(order, ["save", "render", "close"]);
});

for (const value of ["", "0", "-1"]) {
  test(`FolderGoalModal retire l'objectif non valide ${JSON.stringify(value)}`, async () => {
    const folder = new TFolder("Projet/Acte 1");
    const plugin = {
      settings: { folderGoals: { [folder.path]: 200 } },
      async saveSettings() {},
      renderAllViews() {},
    };
    const modal = createModal(FolderGoalModal, [{}, plugin, folder]);

    modal.onOpen();
    findElements(modal.contentEl, (element) => element.tag === "input")[0].value = value;
    await findElements(modal.contentEl, (element) => element.classes.has("mod-cta"))[0].trigger("click");

    assert.equal(folder.path in plugin.settings.folderGoals, false);
  });
}

test("SaveResearchFilterModal ferme avant d'appeler le callback", () => {
  const order = [];
  const modal = createModal(SaveResearchFilterModal, [{}, (name) => { order.push(`callback:${name}`); }]);
  modal.close = () => { order.push("close"); };

  modal.onOpen();
  findElements(modal.contentEl, (element) => element.tag === "input")[0].value = "  Recherche active  ";
  findElements(modal.contentEl, (element) => element.classes.has("mod-cta"))[0].events.get("click")();

  assert.deepEqual(order, ["close", "callback:Recherche active"]);
});

test("SaveResearchFilterModal ignore une saisie vide", () => {
  let called = false;
  const modal = createModal(SaveResearchFilterModal, [{}, () => { called = true; }]);
  let closed = false;
  modal.close = () => { closed = true; };

  modal.onOpen();
  findElements(modal.contentEl, (element) => element.classes.has("mod-cta"))[0].events.get("click")();

  assert.equal(called, false);
  assert.equal(closed, false);
});

test("ManageSavedFiltersModal sauvegarde, réaffiche puis notifie après suppression", async () => {
  const root = new TFolder("Projet");
  const order = [];
  const plugin = {
    settings: {
      projectMeta: {
        [root.path]: { savedResearchFilters: [{ name: "Un", search: "mot" }, { name: "Deux", tag: "idée" }] },
      },
    },
    async saveSettings() { order.push("save"); },
  };
  const modal = createModal(ManageSavedFiltersModal, [{}, plugin, root, () => { order.push("change"); }]);

  modal.onOpen();
  modal.render = () => { order.push("render"); };
  await findElements(modal.contentEl, (element) => element.classes.has("clickable-icon"))[0].trigger("click");

  assert.deepEqual(plugin.settings.projectMeta[root.path].savedResearchFilters, [{ name: "Deux", tag: "idée" }]);
  assert.deepEqual(order, ["save", "render", "change"]);
});

test("AppearancesModal affiche l'état vide sans accéder au workspace", async () => {
  const entityFile = new TFile("Projet/personnage.md");
  const app = { workspace: { getLeaf() { throw new Error("navigation inattendue"); } } };
  const plugin = {
    titleFor: () => "Personnage",
    getProjectFolder: () => null,
    buildNumbering: () => new Map(),
    async findAppearances() { return []; },
    getChapters: () => [],
    shortTitleFor: () => "",
  };
  const modal = createModal(AppearancesModal, [app, plugin, entityFile]);

  await modal.onOpen();

  assert.equal(findElements(modal.contentEl, (element) => element.classes.has("feuillets-empty")).length, 2);
});
