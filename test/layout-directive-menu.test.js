import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { MarkdownView, Menu, TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { loadLayoutStore } from "../src/services/layout-store.js";

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

test("§45 — titre : « Disposition… » présente pour la pagination", () => {
  const { manuscript, file } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.registerLayoutDirectiveContextMenu();
  const cb = handlers["editor-menu"][0];

  const menu = new Menu();
  cb(menu, fakeEditor("# Titre\n\nTexte.", 0), markdownView(file));

  assert.ok(menu.items.find((i) => i.title === t("editorMenu.layoutDirective")));
});

test("§45 — texte isolé : « Disposition… » présente pour la pagination", () => {
  const { manuscript, file } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.registerLayoutDirectiveContextMenu();
  const cb = handlers["editor-menu"][0];

  const menu = new Menu();
  cb(menu, fakeEditor("Un paragraphe seul.", 0), markdownView(file));

  assert.ok(menu.items.find((i) => i.title === t("editorMenu.layoutDirective")));
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

test("layout menu: an outside Markdown file is excluded even with an active project", () => {
  const { manuscript } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.registerLayoutDirectiveContextMenu();
  const menu = new Menu();
  handlers["editor-menu"][0](menu, fakeEditor("Paragraph.", 0), markdownView(new TFile("Elsewhere/Note.md")));
  assert.equal(menu.items.length, 0);
});

test("layout menu: Continu never receives layout actions", () => {
  const { manuscript, file } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.registerLayoutDirectiveContextMenu();
  const menu = new Menu();
  handlers["editor-menu"][0](menu, fakeEditor("Paragraph.", 0), { file, getViewType: () => "feuillets-scrivenings" });
  assert.equal(menu.items.length, 0);
});

test("layout menu: cursor-only actions preserve source bytes and independent properties", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const source = "---\ntitle: Scene\n---\n\nAn ordinary paragraph.  \n\nNext paragraph.\n";
  const file = new TFile(`${manuscript.path}/Scene.md`, source);
  volume.children = [manuscript]; manuscript.parent = volume; manuscript.children = [file]; file.parent = manuscript;
  const { plugin, handlers } = editorMenuHarness(manuscript);
  plugin.app.vault = createFakeVault([volume, manuscript, file]).vault;
  let refreshes = 0;
  plugin.app.workspace.getLeavesOfType = () => { refreshes++; return []; };
  plugin.refreshDocumentLayoutPageBreaks = async () => {};
  plugin.registerLayoutDirectiveContextMenu();
  const menu = new Menu();
  const editor = fakeEditor(source, 4);
  editor.replaceRange = () => { throw new Error("Markdown must never be changed"); };
  handlers["editor-menu"][0](menu, editor, markdownView(file));
  await new Promise((done) => setImmediate(done));
  const entries = menu.items[0].submenu.items;
  const align = entries[0].submenu.items;
  assert.equal(align[0].checked, true);
  assert.equal(align[0].disabled, false);
  await Promise.all([align[2].click(), entries[1].submenu.items[3].click(), entries[2].submenu.items[0].submenu.items[2].click()]);
  await entries[3].click();
  let store = await loadLayoutStore(plugin.app, plugin.settings);
  assert.equal(store.overrides.length, 2);
  const local = store.overrides.find((entry) => entry.kind === "paragraph-layout");
  assert.equal(local.alignment, "center"); assert.equal(local.firstLineIndentPt, 18); assert.equal(local.spacingBeforePt, 6);
  await align[0].click();
  store = await loadLayoutStore(plugin.app, plugin.settings);
  assert.ok(store.overrides.some((entry) => entry.kind === "page-break-before"));
  assert.equal(store.overrides.find((entry) => entry.kind === "paragraph-layout").firstLineIndentPt, 18);
  assert.equal(refreshes, 5);
  assert.deepEqual(Buffer.from(await plugin.app.vault.read(file)), Buffer.from(source));
});

test("layout menu: typography is omitted for headings, images, lists, code and questions", () => {
  const { manuscript, file } = projectFiles();
  for (const source of ["# Heading", "![[image.png]]", "- List", "    code", "> [!questions]\n> 1. Why?"]) {
    const { plugin, handlers } = editorMenuHarness(manuscript);
    plugin.registerLayoutDirectiveContextMenu();
    const menu = new Menu();
    handlers["editor-menu"][0](menu, fakeEditor(source, source.includes("questions") ? 1 : 0), markdownView(file));
    const entries = menu.items[0].submenu.items;
    assert.equal(entries[0].title, t("modal.layoutDirective.pageBreakBefore"));
    assert.equal(entries.length, source.includes("questions") ? 2 : 1);
  }
});

test("layout menu: answer entry delegates to the existing modal with the selected question", () => {
  const { manuscript, file } = projectFiles();
  const { plugin, handlers } = editorMenuHarness(manuscript);
  let captured;
  plugin.openLayoutDirectiveModal = async (...args) => { captured = args; };
  plugin.registerLayoutDirectiveContextMenu();
  const source = "> [!questions]\n> 1. First?\n> 2. Second?";
  const menu = new Menu(); const editor = fakeEditor(source, 2);
  handlers["editor-menu"][0](menu, editor, markdownView(file));
  menu.items[0].submenu.items[1].click();
  assert.equal(captured[0], editor); assert.equal(captured[1], file);
  const selected = captured[2].question.anchor;
  assert.equal(source.slice(selected.startOffset, selected.endOffset), "> 2. Second?");
});
