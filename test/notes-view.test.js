import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { TFile, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
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
    this.style = { removeProperty: () => {} };
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }
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
  view.renderPropertiesRow = () => {};
  view.renderCitedEntities = async () => { calls.entities += 1; };
  view.renderCollapsibleTextarea = (_wrapper, _label, key) => { calls.sections.push(key); };
  view.renderWorkingNotesRow = () => { calls.sections.push("notes"); };
  view.renderFootnotesRow = async () => { calls.footnotes += 1; };
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
  view.renderFolderNoteLinks = (_wrapper, file) => rendered.push(file);
  view.renderPropertiesRow = () => {};
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

test("NotesView.renderFolderNoteLinks : fil d'Ariane dans l'ordre hiérarchique, un clic par niveau ouvre la bonne note de dossier (viewedFile inchangé)", async () => {
  const root = new TFolder("Projet");
  const partie = new TFolder("Projet/Partie 1");
  partie.parent = root;
  const chapitre = new TFolder("Projet/Partie 1/Chapitre 1");
  chapitre.parent = partie;
  const scene = makeFile("Projet/Partie 1/Chapitre 1/scene.md");
  scene.parent = chapitre;

  const { view, contentEl, plugin } = createNotesView({ activeFile: scene, root });
  plugin.roleOfFolder = (folder) => (folder === partie ? "partie" : folder === chapitre ? "chapitre" : null);
  const notes = new Map([
    [partie.path, makeFile("Projet/Partie 1/_note.md")],
    [chapitre.path, makeFile("Projet/Partie 1/Chapitre 1/_note.md")],
  ]);
  plugin.getOrCreateFolderNote = async (folder) => notes.get(folder.path);
  view.render = async () => {};

  view.renderFolderNoteLinks(contentEl, scene);

  const box = contentEl.children.find((el) => el.classes.has("feuillets-notes-folder-links"));
  assert.ok(box, "conteneur du fil d'Ariane présent");

  // Ordre hiérarchique conservé (Partie avant Chapitre), un seul chevron
  // entre les deux maillons, aucune pastille.
  assert.deepEqual(box.children.map((el) => el.text), ["Partie 1", "›", "Chapitre 1"]);
  const items = box.children.filter((el) => el.classes.has("feuillets-notes-folder-link"));
  const seps = box.children.filter((el) => el.classes.has("feuillets-notes-folder-sep"));
  assert.equal(items.length, 2);
  assert.equal(seps.length, 1);

  // Chaque niveau reste cliquable et ouvre sa propre note de dossier dans
  // ce même panneau (viewedFile), sans toucher au document de l'éditeur.
  items[0].events.get("click")({ preventDefault() {} });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(view.viewedFile, notes.get(partie.path));

  items[1].events.get("click")({ preventDefault() {} });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(view.viewedFile, notes.get(chapitre.path));
});

test("NotesView.renderFolderNoteLinks : une seule note de dossier affiche seulement son nom, sans séparateur", () => {
  const root = new TFolder("Projet");
  const chapitre = new TFolder("Projet/Chapitre 1");
  chapitre.parent = root;
  const scene = makeFile("Projet/Chapitre 1/scene.md");
  scene.parent = chapitre;

  const { view, contentEl, plugin } = createNotesView({ activeFile: scene, root });
  plugin.roleOfFolder = (folder) => (folder === chapitre ? "chapitre" : null);

  view.renderFolderNoteLinks(contentEl, scene);

  const box = contentEl.children.find((el) => el.classes.has("feuillets-notes-folder-links"));
  assert.ok(box);
  assert.deepEqual(box.children.map((el) => el.text), ["Chapitre 1"]);
  assert.equal(box.children.some((el) => el.classes.has("feuillets-notes-folder-sep")), false);
});

test("NotesView.renderFolderNoteLinks n'affiche rien sans note de dossier dans la hiérarchie", () => {
  const root = new TFolder("Projet");
  const scene = makeFile("Projet/scene.md");
  scene.parent = root;
  const { view, contentEl, plugin } = createNotesView({ activeFile: scene, root });
  plugin.roleOfFolder = () => null;

  view.renderFolderNoteLinks(contentEl, scene);

  assert.equal(contentEl.children.some((el) => el.classes.has("feuillets-notes-folder-links")), false);
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

function stubAuxSections(view) {
  view.renderFolderNoteLinks = () => {};
  view.renderPropertiesRow = () => {};
  view.renderCitedEntities = async () => {};
  view.renderFootnotesRow = async () => {};
}

/** Enregistre les clés passées à renderCollapsibleTextarea tout en
 * laissant l'implémentation réelle s'exécuter (stockage frontmatter
 * `notes` inchangé) — contrairement à isolateBodySections qui la
 * remplace entièrement. */
function spyOnCollapsibleTextarea(view) {
  const original = view.renderCollapsibleTextarea.bind(view);
  const calls = [];
  view.renderCollapsibleTextarea = (...args) => {
    calls.push(args[2]);
    return original(...args);
  };
  return calls;
}

test("NotesView : Notes de travail n'est plus un textarea direct dans la vue principale", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl, frontmatters } = createNotesView({ activeFile: active });
  frontmatters.set(active.path, { notes: "Idée de scène" });
  stubAuxSections(view);
  const textareaCalls = spyOnCollapsibleTextarea(view);

  await view.render(true);

  // La vue principale ne passe plus par renderCollapsibleTextarea pour
  // "notes" (elle le fait toujours pour "synopsis").
  assert.deepEqual(textareaCalls, ["synopsis"]);

  const all = allElements(contentEl);
  assert.equal(all.some((el) => el.tag === "textarea"), false);

  const row = all.find(
    (el) => el.tag === "span" && el.classes.has("feuillets-notes-section-title") && el.text === "Notes de travail"
  );
  assert.ok(row, "ligne compacte « Notes de travail » attendue");
});

test("NotesView : cliquer sur la ligne Notes de travail ouvre la vue secondaire dans le même panneau", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl } = createNotesView({ activeFile: active });
  stubAuxSections(view);

  await view.render(true);
  const head = allElements(contentEl).find(
    (el) => el.classes.has("feuillets-notes-section-head") && el.classes.has("feuillets-clickable")
  );
  assert.ok(head);

  let renders = 0;
  view.render = async () => { renders += 1; };
  head.events.get("click")();

  assert.equal(view.notesPage, "working-notes");
  assert.equal(renders, 1);
});

test("NotesView : la vue secondaire Notes de travail lit/écrit toujours la propriété frontmatter notes", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl, frontmatters, writes } = createNotesView({ activeFile: active });
  frontmatters.set(active.path, { notes: "Contenu existant" });
  stubAuxSections(view);
  view.notesPage = "working-notes";
  const textareaCalls = spyOnCollapsibleTextarea(view);

  await view.render(true);

  // Rien d'autre que la barre de retour + le champ notes dans la vue
  // secondaire.
  assert.deepEqual(textareaCalls, ["notes"]);

  const all = allElements(contentEl);
  assert.ok(all.some((el) => el.classes.has("feuillets-notes-back-bar")));
  const preview = all.find((el) => el.classes.has("feuillets-flat-text-cell"));
  assert.ok(preview);
  assert.equal(preview.text, "Contenu existant");

  // Édition : clic sur l'aperçu → textarea → blur enregistre via le même
  // processFrontMatter que l'ancien affichage direct.
  preview.events.get("click")({ stopPropagation() {} });
  const textarea = allElements(contentEl).find((el) => el.tag === "textarea");
  assert.ok(textarea);
  textarea.value = "Nouveau contenu";
  textarea.events.get("blur")();
  await Promise.resolve();

  assert.equal(writes.at(-1)?.data.notes, "Nouveau contenu");
  assert.equal(frontmatters.get(active.path).notes, "Nouveau contenu");
});

test("NotesView : Retour depuis Notes de travail restaure la vue principale du feuillet", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl } = createNotesView({ activeFile: active });
  stubAuxSections(view);
  view.notesPage = "working-notes";

  await view.render(true);
  const backBtn = allElements(contentEl).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn);

  let renders = 0;
  view.render = async () => { renders += 1; };
  backBtn.events.get("click")();

  assert.equal(view.notesPage, "home");
  assert.equal(renders, 1);
});

test("NotesView : un changement de fichier actif réinitialise la page secondaire", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, handlers } = createNotesView({ activeFile: active });
  view.render = async () => {};
  view.registerEvent = () => {};
  view.notesPage = "working-notes";

  await view.onOpen();
  handlers.workspace.get("file-open")(active);

  assert.equal(view.notesPage, "home");
});

test("NotesView : note de dossier → Notes de travail → Retour revient à la note de dossier", async () => {
  const active = makeFile("Projet/scene.md");
  const folderNote = makeFile("Projet/Chapitre.md");
  const { view, contentEl, files } = createNotesView({ activeFile: active });
  files.set(folderNote.path, folderNote);
  stubAuxSections(view);
  view.viewedFile = folderNote;
  view.notesPage = "working-notes";

  await view.render(true);
  // Une seule barre de retour affichée pendant les Notes de travail —
  // celle de la note de dossier ne doit pas apparaître en plus.
  const backBars = allElements(contentEl).filter((el) => el.classes.has("feuillets-notes-back-bar"));
  assert.equal(backBars.length, 1);
  const backBtn = allElements(contentEl).find((el) => el.classes.has("feuillets-back-btn"));

  let renders = 0;
  view.render = async () => { renders += 1; };
  backBtn.events.get("click")();

  // Le Retour ferme seulement les Notes de travail : la note de dossier
  // consultée reste affichée.
  assert.equal(view.notesPage, "home");
  assert.equal(view.viewedFile, folderNote);
  assert.equal(renders, 1);
});

test("NotesView : note de dossier → Propriétés → Retour revient à la note de dossier", async () => {
  const active = makeFile("Projet/scene.md");
  const folderNote = makeFile("Projet/Chapitre.md");
  const { view, contentEl, files } = createNotesView({ activeFile: active });
  files.set(folderNote.path, folderNote);
  stubAuxSections(view);
  view.viewedFile = folderNote;
  view.notesPage = "properties";

  await view.render(true);
  const backBars = allElements(contentEl).filter((el) => el.classes.has("feuillets-notes-back-bar"));
  assert.equal(backBars.length, 1);
  const backBtn = allElements(contentEl).find((el) => el.classes.has("feuillets-back-btn"));

  let renders = 0;
  view.render = async () => { renders += 1; };
  backBtn.events.get("click")();

  assert.equal(view.notesPage, "home");
  assert.equal(view.viewedFile, folderNote);
  assert.equal(renders, 1);
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

test("NotesView ouvre les deux actions de propriétés sans écrire ni modifier les réglages (plus de bouton Diff)", () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl, plugin, writes } = createNotesView({ activeFile: active });
  const settingsBefore = JSON.stringify(plugin.settings);
  const originals = [ProjectPropertiesModal.prototype.open, ProjectTagsModal.prototype.open];
  let openings = 0;
  ProjectPropertiesModal.prototype.open = () => { openings += 1; };
  ProjectTagsModal.prototype.open = () => { openings += 1; };
  view.renderSectionHead = (_section, _icon, _title, _namespace, _key, renderActions) => {
    renderActions(contentEl);
    return true;
  };
  try {
    view.renderFilePropertiesSection(contentEl, active);
    const buttons = allElements(contentEl).filter((element) => element.tag === "button");
    assert.equal(buttons.length, 2, "le bouton history (Diff) a déménagé vers Relecture");
    for (const button of buttons) button.events.get("click")();
    assert.equal(openings, 2);
    assert.deepEqual(writes, []);
    assert.equal(JSON.stringify(plugin.settings), settingsBefore);
  } finally {
    [ProjectPropertiesModal.prototype.open, ProjectTagsModal.prototype.open] = originals;
  }
});

function stubHomeNoise(view) {
  // N'isole que ce qui n'est pas sous test (fil d'Ariane, Contexte) —
  // laisse les vraies implémentations de la ligne Propriétés et de la
  // ligne Notes de bas de page tourner, contrairement à stubAuxSections.
  view.renderFolderNoteLinks = () => {};
  view.renderCitedEntities = async () => {};
}

test("NotesView : la vue principale n'affiche que la ligne compacte Propriétés, jamais l'éditeur YAML complet", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl, frontmatters } = createNotesView({ activeFile: active });
  frontmatters.set(active.path, { titre: "Chapitre 1" });
  stubHomeNoise(view);
  view.renderCollapsibleTextarea = () => {};
  view.renderWorkingNotesRow = () => {};

  await view.render(true);

  const all = allElements(contentEl);
  // La ligne compacte est bien là…
  assert.ok(all.some((el) => el.text === "Propriétés"));
  // … mais aucune trace de l'éditeur YAML complet (ligne de propriété ni
  // champ d'ajout) tant qu'on ne clique pas dessus.
  assert.equal(all.some((el) => el.classes.has("feuillets-properties-row")), false);
  assert.equal(all.some((el) => el.classes.has("feuillets-properties-add-row")), false);
});

test("NotesView : cliquer sur la ligne Propriétés ouvre l'éditeur YAML complet dans le même panneau", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl, frontmatters } = createNotesView({ activeFile: active });
  frontmatters.set(active.path, { titre: "Chapitre 1" });
  stubHomeNoise(view);
  view.renderCollapsibleTextarea = () => {};
  view.renderWorkingNotesRow = () => {};

  await view.render(true);
  const head = allElements(contentEl).find(
    (el) =>
      el.classes.has("feuillets-notes-section-head") &&
      el.classes.has("feuillets-clickable") &&
      el.children.some((child) => child.text === "Propriétés")
  );
  assert.ok(head, "ligne compacte « Propriétés » attendue");

  // Le gestionnaire de clic déclenche lui-même un render() en tâche de
  // fond (`void this.render()`) : neutralisé le temps du clic pour piloter
  // nous-mêmes le rendu déterministe qui suit, sans double rendu concurrent
  // qui traînerait après la fin du test.
  const realRender = view.render.bind(view);
  view.render = async () => {};
  head.events.get("click")();
  view.render = realRender;

  assert.equal(view.notesPage, "properties");
  await view.render(true);
  const all = allElements(contentEl);
  assert.ok(all.some((el) => el.classes.has("feuillets-notes-back-bar")));
  const row = all.find((el) => el.classes.has("feuillets-properties-row"));
  assert.ok(row, "éditeur YAML complet attendu dans la page secondaire");
});

test("NotesView : Retour depuis Propriétés restaure la vue principale du feuillet", async () => {
  const active = makeFile("Projet/scene.md");
  const { view, contentEl } = createNotesView({ activeFile: active });
  stubAuxSections(view);
  view.notesPage = "properties";

  await view.render(true);
  const backBtn = allElements(contentEl).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn);

  let renders = 0;
  view.render = async () => { renders += 1; };
  backBtn.events.get("click")();

  assert.equal(view.notesPage, "home");
  assert.equal(renders, 1);
});

test("NotesView : aucune ligne Notes de bas de page quand le feuillet n'en contient aucune", async () => {
  const active = makeFile("Projet/scene.md", "Texte sans note.");
  const { view, contentEl } = createNotesView({
    activeFile: active,
    settings: { notesShowFootnotes: true },
  });
  stubHomeNoise(view);
  view.renderCollapsibleTextarea = () => {};
  view.renderWorkingNotesRow = () => {};

  await view.render(true);

  const all = allElements(contentEl);
  assert.equal(all.some((el) => el.text === "Notes de bas de page"), false);
});

test("NotesView : la ligne Notes de bas de page affiche le nombre réel de définitions", async () => {
  const active = makeFile(
    "Projet/scene.md",
    "Texte.[^a] Suite.[^b]\n\n[^a]: Première note\n[^b]: Deuxième note"
  );
  const { view, contentEl } = createNotesView({
    activeFile: active,
    settings: { notesShowFootnotes: true },
  });
  stubHomeNoise(view);
  view.renderCollapsibleTextarea = () => {};
  view.renderWorkingNotesRow = () => {};

  await view.render(true);

  const all = allElements(contentEl);
  const title = all.find((el) => el.text === "Notes de bas de page");
  assert.ok(title, "ligne « Notes de bas de page » attendue");
  const head = title.parentNode;
  const count = head.children.find((el) => el.classes.has("feuillets-notes-section-count"));
  assert.ok(count);
  assert.equal(count.text, "2");
  // Aucune mention « (Relecture) » dans cette interface.
  assert.equal(all.some((el) => typeof el.text === "string" && el.text.includes("Relecture")), false);
});

test("NotesView : cliquer sur la ligne Notes de bas de page ouvre la page secondaire avec les N notes", async () => {
  const active = makeFile(
    "Projet/scene.md",
    "Texte.[^a] Suite.[^b]\n\n[^a]: Première note\n[^b]: Deuxième note"
  );
  const { view, contentEl } = createNotesView({
    activeFile: active,
    settings: { notesShowFootnotes: true },
  });
  stubHomeNoise(view);
  view.renderCollapsibleTextarea = () => {};
  view.renderWorkingNotesRow = () => {};

  await view.render(true);
  const title = allElements(contentEl).find((el) => el.text === "Notes de bas de page");
  const head = title.parentNode;
  // Même précaution que pour la ligne Propriétés : neutraliser le render()
  // interne déclenché par le clic pour piloter nous-mêmes un rendu
  // déterministe, sans double rendu concurrent.
  const realRender = view.render.bind(view);
  view.render = async () => {};
  head.events.get("click")();
  view.render = realRender;

  assert.equal(view.notesPage, "footnotes");
  await view.render(true);
  const all = allElements(contentEl);
  assert.ok(all.some((el) => el.classes.has("feuillets-notes-back-bar")));
  const entries = all.filter((el) => el.classes.has("feuillets-flat-text-cell"));
  assert.equal(entries.length, 2);
  assert.ok(entries.some((el) => el.children.some((c) => c.text === "[^a] ")));
  assert.ok(entries.some((el) => el.children.some((c) => c.text === "[^b] ")));
});

test("NotesView : Retour depuis Notes de bas de page restaure la vue principale du feuillet", async () => {
  const active = makeFile("Projet/scene.md", "Texte.[^a]\n\n[^a]: Une note");
  const { view, contentEl } = createNotesView({
    activeFile: active,
    settings: { notesShowFootnotes: true },
  });
  stubAuxSections(view);
  view.notesPage = "footnotes";

  await view.render(true);
  const backBtn = allElements(contentEl).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn);

  let renders = 0;
  view.render = async () => { renders += 1; };
  backBtn.events.get("click")();

  assert.equal(view.notesPage, "home");
  assert.equal(renders, 1);
});

test("NotesView : notesShowFootnotes=false masque la ligne d'accès et la page", async () => {
  const active = makeFile("Projet/scene.md", "Texte.[^a]\n\n[^a]: Une note");
  const { view, contentEl } = createNotesView({
    activeFile: active,
    settings: { notesShowFootnotes: false },
  });
  stubAuxSections(view);
  view.renderCollapsibleTextarea = () => {};
  view.renderWorkingNotesRow = () => {};

  await view.render(true);
  assert.equal(allElements(contentEl).some((el) => el.text === "Notes de bas de page"), false);

  // Même en forçant la page secondaire (ex. réglage désactivé après
  // navigation), elle ne doit pas s'afficher.
  view.notesPage = "footnotes";
  await view.render(true);
  assert.equal(view.notesPage, "home");
  assert.equal(allElements(contentEl).some((el) => el.classes.has("feuillets-notes-back-bar")), false);
});

test("NotesView : ordre de la vue principale — Propriétés → Synopsis/Résumé → Références → Notes de travail → Notes de bas de page", async () => {
  const active = makeFile("Projet/scene.md", "Texte.[^a]\n\n[^a]: Une note");
  const { view, contentEl, plugin } = createNotesView({
    activeFile: active,
    settings: {
      notesShowEntities: true,
      notesShowSynopsis: true,
      notesShowResume: false,
      notesShowNotes: true,
      notesShowFootnotes: true,
      notesSectionOrder: ["Synopsis", "Résumé", "Notes"],
    },
  });
  plugin.hasSources = () => false;
  view.renderFolderNoteLinks = () => {};
  const order = [];
  view.renderPropertiesRow = () => order.push("properties");
  view.renderCitedEntities = async () => { order.push("entities"); };
  view.renderCollapsibleTextarea = (_wrapper, _label, key) => order.push(key);
  view.renderWorkingNotesRow = () => order.push("notes");
  view.renderFootnotesRow = async () => { order.push("footnotes"); };

  await view.render(true);

  assert.deepEqual(order, ["properties", "synopsis", "entities", "notes", "footnotes"]);
});
