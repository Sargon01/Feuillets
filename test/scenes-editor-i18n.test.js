import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MarkdownView, Menu, Notice, Setting, TFile } from "obsidian";
import {
  MergeModal,
  TextInputModal,
  initScenesEditor,
} from "../src/scenes-editor.js";
import { en } from "../src/i18n/en.js";
import { fr } from "../src/i18n/fr.js";
import { setLocale } from "../src/i18n/index.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.text = options.text ?? "";
    this._settings = [];
  }
  empty() { this.children = []; this._settings = []; }
  createEl(_tag, options = {}) {
    const child = new FakeElement(options);
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  addEventListener() {}
  addClasses() {}
}

function textOf(element) {
  return [element.text, ...element.children.flatMap(textOf)].filter(Boolean);
}

function createPlugin() {
  const events = new Map();
  const commands = [];
  const ribbons = [];
  return {
    app: {
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      workspace: {
        on(name, callback) { events.set(name, callback); return { name, callback }; },
        getActiveViewOfType: () => null,
      },
      vault: {},
      fileManager: {},
    },
    settings: {
      mergeModeDefault: "heading",
      mergeKeepSeparatorDefault: true,
      mergeYamlPreset: "roman",
      mergeNotesSeparator: "\n\n",
    },
    getProjectFolder: () => ({ path: "Projet" }),
    fmOf: () => ({}),
    shortTitleFor: (file) => file.basename,
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    saveSettings: async () => {},
    addCommand(command) { commands.push(command); },
    addRibbonIcon(...args) { ribbons.push(args); },
    registerEvent() {},
    registerExistingProjectFolder: async () => {},
    _events: events,
    _commands: commands,
    _ribbons: ribbons,
  };
}

function modalContent(modal) {
  modal.contentEl = new FakeElement();
  modal.setTitle = (title) => { modal.title = title; };
  modal.close = () => {};
  return modal;
}

test("ScenesEditor : TextInputModal traduit ses boutons", () => {
  const originalAddText = Setting.prototype.addText;
  globalThis.window = globalThis;
  Setting.prototype.addText = function addText(callback) {
    callback({ setValue() { return this; }, onChange() { return this; }, inputEl: { focus() {} } });
    return this;
  };
  try {
    for (const [locale, expected] of [["fr", ["Valider", "Annuler"]], ["en", ["Confirm", "Cancel"]]]) {
      setLocale(locale);
      const modal = modalContent(new TextInputModal({}, "Titre", [{ name: "x", label: "Champ", value: "" }], () => {}));
      modal.onOpen();
      assert.deepEqual(modal.contentEl._settings.at(-1).controls.map((control) => control.text), expected);
    }
  } finally {
    Setting.prototype.addText = originalAddText;
    setLocale("fr");
  }
});

test("ScenesEditor : MergeModal traduit ses libellés sans changer les modes internes", () => {
  const target = new TFile("Projet/Cible.md");
  const source = new TFile("Projet/Source.md");
  const plugin = createPlugin();
  for (const [locale, expectedTitle, expectedMode] of [["fr", "Fusion", "Titre intermédiaire"], ["en", "Merge", "Intermediate heading"]]) {
    setLocale(locale);
    const modal = modalContent(new MergeModal({}, plugin, [target, source]));
    modal.plan = {
      target,
      sources: [source],
      mergeMode: "heading",
      keepSeparator: true,
      localRules: {},
      summary: "Résumé",
      preview: { tags: [], statut: "", compiler: false, objectif: 0, notes: "", excerpts: ["Texte"], yamlLabel: "Roman", yamlEntries: [] },
    };
    modal.render();
    assert.equal(modal.title, expectedTitle);
    assert.equal(modal.contentEl._settings[0].name, locale === "fr" ? "Scène cible" : "Target scene");
    const modes = modal.contentEl._settings[1].controls[0].options;
    assert.deepEqual(modes.map((mode) => mode.value), ["heading", "comment", "continuous"]);
    assert.equal(modes[0].label, expectedMode);
    assert.ok(textOf(modal.contentEl).includes(locale === "fr" ? "Résumé YAML" : "YAML summary"));
  }
  setLocale("fr");
});

test("ScenesEditor : titres, commandes et menus contextuels sont traduits", async () => {
  const plugin = createPlugin();
  globalThis.window = { innerWidth: 100, innerHeight: 100 };
  const originalShowAtPosition = Menu.prototype.showAtPosition;
  const originalOpen = TextInputModal.prototype.open;
  let shownMenu = null;
  const openedTitles = [];
  Menu.prototype.showAtPosition = function showAtPosition() { shownMenu = this; return this; };
  TextInputModal.prototype.open = function open() { openedTitles.push(this.titleText); return this; };
  try {
    for (const [locale, expected] of [["fr", ["Scinder la scène", "Scinder", ["Scinder la scène", "Dupliquer la scène", "Déplacer la scène"]]], ["en", ["Split scene", "Split", ["Split the scène", "Duplicate the scène", "Move the scène"]]]]) {
      setLocale(locale);
      initScenesEditor(plugin);
      assert.ok(plugin._commands.some((command) => command.name === expected[0]));
      plugin.isSceneFile = () => true;
      const file = new TFile("Projet/Scene.md");
      const view = Object.assign(new MarkdownView(), {
        file,
        editor: { getSelection: () => "Texte", getCursor: () => ({}), getValue: () => "Texte" },
      });
      plugin.app.workspace.getActiveViewOfType = () => view;
      await plugin.splitSceneFile(file);
      await plugin.duplicateSceneFile(file);
      await plugin.moveSceneFile(file);
      assert.deepEqual(openedTitles.splice(-3), expected[2]);
      plugin.openSceneMenu(file);
      assert.ok(shownMenu.items.some((item) => item.title === expected[1]));
    }
  } finally {
    Menu.prototype.showAtPosition = originalShowAtPosition;
    TextInputModal.prototype.open = originalOpen;
    setLocale("fr");
  }
});

test("ScenesEditor : les Notices principales utilisent i18n", async () => {
  const plugin = createPlugin();
  initScenesEditor(plugin);
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    setLocale("fr");
    await plugin.splitSceneFile(null);
    await plugin.mergeManyScenes([], new TFile("Projet/Cible.md"));
    assert.deepEqual(notices, ["Aucune scène active.", "Aucune scène à fusionner."]);
    notices.length = 0;
    setLocale("en");
    await plugin.splitSceneFile(null);
    await plugin.mergeManyScenes([], new TFile("Projet/Cible.md"));
    assert.deepEqual(notices, ["No active scène.", "No scène to merge."]);
  } finally {
    Notice.onCreate = null;
    setLocale("fr");
  }
});

test("ScenesEditor : les clés ajoutées existent dans les deux langues et les anciennes chaînes ciblées ont disparu", async () => {
  const sceneKeys = Object.keys(fr).filter((key) => key.startsWith("scenesEditor."));
  assert.ok(sceneKeys.length > 0);
  for (const key of sceneKeys) assert.ok(en[key], `${key} manque en anglais`);

  const source = await readFile("src/scenes-editor.ts", "utf8");
  for (const text of [
    "Scène cible",
    "Mode de fusion",
    "Options YAML",
    "Scinder la scène",
    "Dupliquer la scène",
    "Déplacer la scène",
    "Fusionner les scènes sélectionnées",
    "Un fichier avec ce nom existe déjà.",
  ]) {
    assert.equal(source.includes(`\"${text}\"`), false, text);
  }
});
