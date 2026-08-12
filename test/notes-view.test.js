import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { TFile, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { DiffModal } = await import(modulePath("src/ui/diff-modal.js"));
const { ProjectPropertiesModal, ProjectTagsModal } = await import(modulePath("src/ui/project-properties-modals.js"));
const { NotesView } = await import(modulePath("src/views/notes-view.js"));

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    this.attributes = options.attr ?? {};
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const className of classNames.split(" ")) this.classes.add(className); }
  removeClass(className) { this.classes.delete(className); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  prepend(child) { this.children = [child, ...this.children.filter((current) => current !== child)]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  blur() {}
  hide() {}
  show() {}
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function makeFile(path, content = "", mtime = 1) {
  const file = new TFile(path, content);
  file.stat = { mtime };
  return file;
}

function createNotesView({ activeFile = null, root = new TFolder("Projet"), settings = {} } = {}) {
  const contentEl = new FakeElement();
  const files = new Map(activeFile ? [[activeFile.path, activeFile]] : []);
  const frontmatters = new Map(activeFile ? [[activeFile.path, {}]] : []);
  const handlers = { workspace: new Map(), vault: new Map(), metadata: new Map() };
  const writes = [];
  const app = {
    vault: {
      getAbstractFileByPath(path) { return files.get(path) ?? null; },
      async cachedRead(file) { return file.content; },
      on(name, callback) { handlers.vault.set(name, callback); return { name, callback }; },
    },
    workspace: {
      getActiveFile() { return activeFile; },
      getLeaf() { return {}; },
      on(name, callback) { handlers.workspace.set(name, callback); return { name, callback }; },
    },
    metadataCache: {
      on(name, callback) { handlers.metadata.set(name, callback); return { name, callback }; },
    },
    fileManager: {
      async processFrontMatter(file, update) {
        const data = frontmatters.get(file.path) ?? {};
        update(data);
        frontmatters.set(file.path, data);
        writes.push({ file, data: { ...data } });
      },
    },
  };
  const plugin = {
    settings: {
      collapsed: {},
      notesShowEntities: false,
      notesShowSynopsis: true,
      notesShowResume: true,
      notesShowNotes: true,
      notesShowFootnotes: false,
      notesSectionOrder: ["Synopsis", "Résumé", "Notes"],
      ...settings,
    },
    getProjectFolder: () => root,
    getChronoFolder: () => null,
    parseStoryDate: () => null,
    hasSources: () => false,
    isFrontMatter: () => false,
    getResearchRoot: () => null,
    tagsOf: () => [],
    titleFor: (file) => file.basename,
    async saveSettings() {},
  };
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = (file) => frontmatters.get(file.path) ?? {};
  return { view, app, plugin, contentEl, files, frontmatters, handlers, writes };
}

function isolateBodySections(view, calls) {
  view.renderFolderNoteLinks = () => {};
  view.renderFilePropertiesSection = () => {};
  view.renderCitedEntities = async () => { calls.entities += 1; };
  view.renderCollapsibleTextarea = (_wrapper, _label, key) => { calls.sections.push(key); };
  view.renderFootnotesSection = async () => { calls.footnotes += 1; };
}

test("NotesView remet currentPath à null sans fichier, sans projet ou hors projet", async () => {
  for (const options of [
    {},
    { activeFile: makeFile("Projet/scene.md"), root: null },
    { activeFile: makeFile("Autre/scene.md") },
  ]) {
    const { view, contentEl } = createNotesView(options);
    view.currentPath = "Projet/ancienne.md";
    await view.render(true);
    assert.equal(view.currentPath, null);
    assert.equal(allElements(contentEl).some((element) => element.classes.has("feuillets-empty")), true);
  }
});

test("NotesView suit le fichier actif valide et revient au fichier actif si la note consultée disparaît", async () => {
  const active = makeFile("Projet/scene.md");
  const viewed = makeFile("Projet/Chapitre.md");
  const { view, files } = createNotesView({ activeFile: active });
  const rendered = [];
  view.renderFolderNoteLinks = () => {};
  view.renderFilePropertiesSection = (_wrapper, file) => rendered.push(file);
  view.renderCitedEntities = async () => {};
  view.renderCollapsibleTextarea = () => {};

  await view.render(true);
  assert.equal(view.currentPath, active.path);
  assert.equal(rendered.at(-1), active);

  view.viewedFile = viewed;
  await view.render(true);
  assert.equal(view.viewedFile, null);
  assert.equal(rendered.at(-1), active);
  assert.equal(files.has(viewed.path), false);
});

test("NotesView abandonne une note de dossier au changement de fichier et filtre ses événements", async () => {
  const active = makeFile("Projet/scene.md");
  const viewed = makeFile("Projet/Chapitre.md");
  const other = makeFile("Projet/autre.md");
  const { view, handlers, writes } = createNotesView({ activeFile: active });
  const renders = [];
  view.render = async (force) => { renders.push(force); };
  view.viewedFile = viewed;
  view.currentPath = active.path;
  view.registerEvent = () => {};

  await view.onOpen();
  assert.deepEqual(renders, [true]);

  handlers.workspace.get("file-open")(active);
  assert.equal(view.viewedFile, null);
  assert.deepEqual(renders, [true, true]);

  handlers.vault.get("modify")(other);
  handlers.metadata.get("changed")(other);
  assert.deepEqual(renders, [true, true]);

  handlers.vault.get("modify")(active);
  handlers.metadata.get("changed")(active);
  assert.deepEqual(renders, [true, true, undefined, undefined]);
  assert.deepEqual(writes, []);
});

test("NotesView ne rerend pas pendant une édition sauf avec force", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl } = createNotesView({ activeFile: active });
  const calls = { sections: [], entities: 0, footnotes: 0 };
  isolateBodySections(view, calls);
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: { tagName: "INPUT" } };
  contentEl.contains = () => true;
  try {
    await view.render();
    assert.deepEqual(calls.sections, []);
    await view.render(true);
    // Projet fiction par repli (aucun projectFolder défini) : Synopsis
    // s'affiche, Résumé reste masqué même si notesShowResume est activé.
    assert.deepEqual(calls.sections, ["synopsis", "notes"]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("NotesView affiche le retour d'une note de dossier et revient au fichier actif", async () => {
  const active = makeFile("Projet/scene.md");
  const folderNote = makeFile("Projet/Chapitre.md");
  const { view, contentEl, files } = createNotesView({ activeFile: active });
  files.set(folderNote.path, folderNote);
  view.viewedFile = folderNote;
  isolateBodySections(view, { sections: [], entities: 0, footnotes: 0 });

  await view.render(true);
  const backButton = allElements(contentEl).find((element) => element.classes.has("feuillets-back-btn"));
  assert.ok(backButton);
  let renders = 0;
  view.render = async () => { renders += 1; };
  backButton.events.get("click")();
  assert.equal(view.viewedFile, null);
  assert.equal(renders, 1);
});

test("NotesView respecte les réglages et l'ordre des sections", async () => {
  const active = makeFile("Projet/scene.md", "Texte\n[^a]: note");
  const { view, plugin } = createNotesView({
    activeFile: active,
    settings: {
      notesShowEntities: true,
      notesShowSynopsis: true,
      notesShowResume: false,
      notesShowNotes: true,
      notesShowFootnotes: true,
      notesSectionOrder: ["Notes", "Résumé", "Synopsis"],
    },
  });
  plugin.hasSources = () => true;
  const calls = { sections: [], entities: 0, footnotes: 0 };
  isolateBodySections(view, calls);

  await view.render(true);
  assert.deepEqual(calls.sections, ["notes", "synopsis", "sources"]);
  assert.equal(calls.entities, 1);
  assert.equal(calls.footnotes, 1);
});

test("NotesView n'affiche jamais Synopsis et Résumé ensemble, selon le mode du projet", async () => {
  const cases = [
    { type: "fiction", expected: ["synopsis", "notes"] },
    { type: "nonfiction", expected: ["summary", "notes"] },
    { type: "libre", expected: ["summary", "notes"] },
  ];
  for (const { type, expected } of cases) {
    const root = new TFolder("Projet");
    const active = makeFile("Projet/scene.md");
    const { view, files } = createNotesView({
      activeFile: active,
      root,
      settings: {
        projectFolder: root.path,
        projectMeta: { [root.path]: { type } },
        notesShowSynopsis: true,
        notesShowResume: true,
        notesShowNotes: true,
      },
    });
    files.set(root.path, root);
    const calls = { sections: [], entities: 0, footnotes: 0 };
    isolateBodySections(view, calls);

    await view.render(true);
    assert.deepEqual(calls.sections, expected, `mode ${type}`);
  }
});

test("NotesView n'affiche ni entités ni notes de bas de page lorsqu'elles sont désactivées", async () => {
  const active = makeFile("Projet/scene.md");
  const { view } = createNotesView({ activeFile: active });
  const calls = { sections: [], entities: 0, footnotes: 0 };
  isolateBodySections(view, calls);

  await view.render(true);
  assert.equal(calls.entities, 0);
  assert.equal(calls.footnotes, 0);
});

test("NotesView ajoute une propriété non vide et ignore une clé vide", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl, frontmatters, writes } = createNotesView({ activeFile: active });
  const previousCss = globalThis.CSS;
  globalThis.CSS = { escape: (value) => value };
  view.renderSectionHead = (_section, _icon, _title, _namespace, _key, renderActions) => {
    renderActions(new FakeElement());
    return false;
  };
  let renders = 0;
  view.render = async () => { renders += 1; };
  try {
    view.renderFilePropertiesSection(contentEl, active);
    const input = allElements(contentEl).find((element) => element.tag === "input");
    input.value = "nouvelle-propriete";
    await input.events.get("keydown")({ key: "Enter" });
    assert.deepEqual(frontmatters.get(active.path), { "nouvelle-propriete": "" });
    assert.equal(renders, 1);
    assert.equal(writes.length, 1);

    input.value = "   ";
    await input.events.get("keydown")({ key: "Enter" });
    assert.equal(writes.length, 1);
  } finally {
    globalThis.CSS = previousCss;
  }
});

test("NotesView ouvre les trois actions de propriétés sans écrire ni modifier les réglages", () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl, plugin, writes } = createNotesView({ activeFile: active });
  const settingsBefore = JSON.stringify(plugin.settings);
  const originals = [ProjectPropertiesModal.prototype.open, ProjectTagsModal.prototype.open, DiffModal.prototype.open];
  let openings = 0;
  ProjectPropertiesModal.prototype.open = () => { openings += 1; };
  ProjectTagsModal.prototype.open = () => { openings += 1; };
  DiffModal.prototype.open = () => { openings += 1; };
  view.renderSectionHead = (_section, _icon, _title, _namespace, _key, renderActions) => {
    renderActions(contentEl);
    return true;
  };
  try {
    view.renderFilePropertiesSection(contentEl, active);
    const buttons = allElements(contentEl).filter((element) => element.tag === "button");
    assert.equal(buttons.length, 3);
    for (const button of buttons) button.events.get("click")();
    assert.equal(openings, 3);
    assert.deepEqual(writes, []);
    assert.equal(JSON.stringify(plugin.settings), settingsBefore);
  } finally {
    [ProjectPropertiesModal.prototype.open, ProjectTagsModal.prototype.open, DiffModal.prototype.open] = originals;
  }
});
