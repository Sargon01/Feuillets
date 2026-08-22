import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkdownView, Menu, TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";

/* Même harnais que test/editor-context-menu-unification.test.js (§15) : le
 * plugin est exercé via Object.create(FeuilletsPlugin.prototype), le stub
 * Obsidian de test n'exportant pas `Plugin`. */
function editorMenuHarness(projectFolder) {
  const handlers = {};
  const workspace = {
    on(name, cb) {
      (handlers[name] ||= []).push(cb);
      return {};
    },
  };
  const app = { workspace };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.settings = { projectFolder: projectFolder?.path };
  plugin.getProjectFolder = () => projectFolder || null;
  plugin.registerEvent = () => {};
  return { plugin, handlers };
}

function markdownView(file) {
  const view = new MarkdownView();
  view.file = file;
  return view;
}

function fakeEditor(content, cursorLine) {
  return {
    getValue: () => content,
    getCursor: () => ({ line: cursorLine, ch: 0 }),
    replaceRange: () => {},
  };
}

function projectFiles() {
  const manuscript = new TFolder("Projet/Manuscrit");
  const file = new TFile(`${manuscript.path}/Scène.md`, "");
  return { manuscript, file };
}

test("§45 — projet Feuillets + image : « Disposition… » présente", () => {
  const { manuscript, file } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.registerLayoutDirectiveContextMenu();
  const cb = handlers["editor-menu"][0];

  const menu = new Menu();
  cb(menu, fakeEditor("![[image.png]]", 0), markdownView(file));

  const entry = menu.items.find((i) => i.title === t("editorMenu.layoutDirective"));
  assert.ok(entry, "l'entrée « Disposition… » doit être présente");
});

test("§45 — hors projet Feuillets : « Disposition… » absente", () => {
  const outside = new TFile("Ailleurs/Note.md", "");
  const { plugin, handlers } = editorMenuHarness(null);
  plugin.registerLayoutDirectiveContextMenu();
  const cb = handlers["editor-menu"][0];

  const menu = new Menu();
  cb(menu, fakeEditor("![[image.png]]", 0), markdownView(outside));

  assert.equal(menu.items.find((i) => i.title === t("editorMenu.layoutDirective")), undefined);
});

test("§45 — bloc non admissible (titre) : « Disposition… » absente", () => {
  const { manuscript, file } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.registerLayoutDirectiveContextMenu();
  const cb = handlers["editor-menu"][0];

  const menu = new Menu();
  cb(menu, fakeEditor("# Titre\n\nTexte.", 0), markdownView(file));

  assert.equal(menu.items.find((i) => i.title === t("editorMenu.layoutDirective")), undefined);
});

test("§45 — texte isolé sans composition possible : « Disposition… » absente", () => {
  const { manuscript, file } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.registerLayoutDirectiveContextMenu();
  const cb = handlers["editor-menu"][0];

  const menu = new Menu();
  cb(menu, fakeEditor("Un paragraphe seul.", 0), markdownView(file));

  assert.equal(menu.items.find((i) => i.title === t("editorMenu.layoutDirective")), undefined);
});

test("§45 — pas de MarkdownView (ex. autre type de vue) : jamais d'entrée", () => {
  const { manuscript, file: _file } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.registerLayoutDirectiveContextMenu();
  const cb = handlers["editor-menu"][0];

  const menu = new Menu();
  cb(menu, fakeEditor("![[image.png]]", 0), {});

  assert.equal(menu.items.length, 0);
});
