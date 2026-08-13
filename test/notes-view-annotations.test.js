import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder, MarkdownView } from "obsidian";
import { NotesView } from "../src/views/notes-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { saveAnnotations } from "../src/services/annotations.js";

/* Chantier annotations — lot 4 : page centralisée dans NotesView. Ne
   revalide PAS la persistance/résolution (lot 1) ni le modal/update/delete/
   rafraîchissement CodeMirror (lot 3, déjà couverts par
   test/annotations.test.js et test/annotation-editing.test.js) — vérifie
   seulement ce que ce lot ajoute : ligne d'accès, page secondaire,
   regroupement, navigation, délégation de « Modifier » à
   plugin.openAnnotationEditor. */

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
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(classNames) { for (const c of classNames.split(" ")) this.classes.add(c); }
  removeClass(className) { this.classes.delete(className); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
  prepend(child) { this.children = [child, ...this.children.filter((c) => c !== child)]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  blur() {}
  hide() {}
  show() {}
  contains(target) { return this === target || this.children.some((c) => c.contains(target)); }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

async function trigger(element, type, event = {}) {
  await element.events.get(type)?.(event);
}

const SCENE_CONTENT = "Il faisait nuit. Le chat dormait tranquillement. Il faisait nuit.";
const OTHER_CONTENT = "Un tout autre passage, dans un autre feuillet du Manuscrit.";

function fixture() {
  const volume = new TFolder("Projet");
  const root = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre");
  const scene = new TFile("Projet/Manuscrit/Chapitre/Scène.md", SCENE_CONTENT);
  const other = new TFile("Projet/Manuscrit/Chapitre/Autre.md", OTHER_CONTENT);
  volume.children = [root];
  root.parent = volume;
  root.children = [chapter];
  chapter.parent = root;
  chapter.children = [scene, other];
  scene.parent = chapter;
  other.parent = chapter;
  const { vault } = createFakeVault([volume, root, chapter, scene, other]);
  vault.cachedRead = (file) => vault.read(file);

  const settings = { projectFolder: root.path, collapsed: {}, notesSectionOrder: [], projectMeta: {} };
  const leafCalls = [];
  const app = {
    vault,
    workspace: {
      getActiveFile: () => scene,
      getLeaf: () => {
        const leaf = {
          openFile: async (file, opts) => { leafCalls.push({ file, opts }); },
          view: null,
        };
        return leaf;
      },
      setActiveLeaf: () => {},
      on: () => ({}),
    },
    metadataCache: { on: () => ({}) },
    fileManager: { processFrontMatter: async () => {} },
  };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    getChronoFolder: () => null,
    parseStoryDate: () => null,
    tagsOf: () => [],
    titleFor: (file) => file.basename,
    async saveSettings() {},
    openAnnotationEditor: async () => {},
  };
  const contentEl = new FakeElement();
  const view = new NotesView({ app, contentEl }, plugin);
  view.fm = () => ({});

  return { app, plugin, settings, view, contentEl, root, chapter, scene, other, leafCalls, vault };
}

test.skip("ancienne entrée Annotations séparée remplacée par Notes et annotations", async () => {
  const { view, scene } = fixture();
  const wrapper = new FakeElement();
  await view.renderAnnotationsRow(wrapper, scene);
  assert.equal(wrapper.children.length, 0);
});

test.skip("ancien compteur Annotations remplacé par la page unifiée", async () => {
  const { view, app, settings, scene, other } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [
      { id: "a1", file: "Chapitre/Scène.md", start: 0, end: 2, quote: "Il", prefix: "", suffix: " ", text: "", color: "yellow" },
      { id: "a2", file: "Chapitre/Autre.md", start: 0, end: 2, quote: "Un", prefix: "", suffix: " ", text: "", color: "blue" },
    ],
  });

  const wrapper = new FakeElement();
  await view.renderAnnotationsRow(wrapper, scene);

  const count = allElements(wrapper).find((el) => el.classes.has("feuillets-notes-section-count"));
  assert.ok(count, "le compteur est rendu");
  assert.equal(count.text, "2");

  const head = allElements(wrapper).find((el) => el.classes.has("feuillets-notes-section-head"));
  assert.ok(head);
  view.render = () => {}; // isole le clic : seul notesPage nous intéresse ici
  head.events.get("click")();
  assert.equal(view.notesPage, "annotations");
  void other; // fixture complète, non utilisé dans cette assertion précise
});

test.skip("ancienne page Annotations remplacée par Notes et annotations", async () => {
  const { view, app, settings } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{ id: "a1", file: "Chapitre/Scène.md", start: 0, end: 2, quote: "Il", prefix: "", suffix: " ", text: "note", color: "yellow" }],
  });

  view.notesPage = "annotations";
  await view.render(true);

  const backBtn = allElements(view.contentEl).find((el) => el.classes.has("feuillets-back-btn"));
  assert.ok(backBtn, "la barre de retour est affichée");
  assert.ok(allElements(view.contentEl).some((el) => el.text === "note"), "le contenu de la page Annotations est rendu");

  // Retour : referme la page secondaire. Seul l'état notesPage nous
  // intéresse ici (le rendu de la vue principale est déjà couvert par les
  // tests existants) — on isole donc le clic comme le fait déjà le reste
  // de la suite (voir test/notes-view.test.js, même patron).
  view.render = () => {};

  backBtn.events.get("click")();
  assert.equal(view.notesPage, "home");
});

test.skip("regroupement couvert par la page unifiée", async () => {
  const { view, app, settings, scene } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [
      { id: "other-1", file: "Chapitre/Autre.md", start: 0, end: 2, quote: "Un", prefix: "", suffix: " ", text: "sur Autre", color: "blue" },
      { id: "current-1", file: "Chapitre/Scène.md", start: 0, end: 2, quote: "Il", prefix: "", suffix: " ", text: "sur Scène", color: "yellow" },
    ],
  });

  const wrapper = new FakeElement();
  await view.renderAnnotationsPanel(wrapper, scene);

  const flat = allElements(wrapper);
  const currentIdx = flat.findIndex((el) => el.text === "sur Scène");
  const otherHeadingIdx = flat.findIndex((el) => el.classes.has("feuillets-annotation-file-heading"));
  const otherIdx = flat.findIndex((el) => el.text === "sur Autre");

  assert.ok(currentIdx >= 0 && otherHeadingIdx >= 0 && otherIdx >= 0);
  assert.ok(currentIdx < otherHeadingIdx, "l'annotation du feuillet courant précède le regroupement des autres");
  assert.ok(otherHeadingIdx < otherIdx, "le sous-titre de fichier précède ses annotations");
  assert.equal(otherHeadingIdx >= 0 && flat[otherHeadingIdx].text, "Autre"); // titleFor() = basename
});

test.skip("clic annotation désormais ouvre le popover ancré au passage", async () => {
  const { view, app, settings, scene, leafCalls } = fixture();
  const quote = "Le chat dormait tranquillement";
  const start = SCENE_CONTENT.indexOf(quote);
  const end = start + quote.length;
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{ id: "a1", file: "Chapitre/Scène.md", start, end, quote, prefix: "", suffix: "", text: "", color: "green" }],
  });

  const selections = [];
  const fakeEditor = {
    getValue: () => SCENE_CONTENT,
    offsetToPos: (offset) => ({ line: 0, ch: offset }),
    setSelection: (from, to) => selections.push({ from, to }),
    scrollIntoView: () => {},
    focus: () => {},
  };
  // Court-circuite getLeaf() pour fournir un leaf dont la vue est
  // reconnue comme MarkdownView par openFileAndSelectRange (utils/dom.ts).
  app.workspace.getLeaf = () => {
    const leaf = { openFile: async (file, opts) => leafCalls.push({ file, opts }), view: null };
    leaf.view = Object.assign(Object.create(MarkdownView.prototype), { editor: fakeEditor });
    return leaf;
  };

  const wrapper = new FakeElement();
  await view.renderAnnotationsPanel(wrapper, scene);

  const row = allElements(wrapper).find((el) => el.classes.has("feuillets-annotation-row"));
  assert.ok(row.classes.has("feuillets-clickable"));
  await trigger(row, "click");
  await Promise.resolve(); // laisse la promesse d'ouverture se résoudre

  assert.equal(leafCalls.length, 1);
  assert.equal(leafCalls[0].file.path, scene.path);
  assert.deepEqual(selections[0], { from: { line: 0, ch: start }, to: { line: 0, ch: end } });
});

test.skip("annotation non résolue reste visible et supprimable dans la page unifiée", async () => {
  const { view, app, settings, scene, leafCalls } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{
      id: "a1",
      file: "Chapitre/Scène.md",
      start: 999,
      end: 1010,
      quote: "passage qui n'existe plus du tout",
      prefix: "inconnu",
      suffix: "inconnu",
      text: "",
      color: "pink",
    }],
  });

  const wrapper = new FakeElement();
  await view.renderAnnotationsPanel(wrapper, scene);

  const row = allElements(wrapper).find((el) => el.classes.has("feuillets-annotation-row"));
  assert.equal(row.classes.has("feuillets-clickable"), false);
  assert.equal(row.events.has("click"), false);
  const excerpt = allElements(row).find((el) => el.classes.has("feuillets-annotation-excerpt"));
  assert.equal(excerpt.text, "Passage introuvable");
  assert.equal(excerpt.classes.has("feuillets-annotation-missing"), true);

  await trigger(row, "click");
  assert.equal(leafCalls.length, 0, "aucune navigation pour une annotation non résolue");
});

test.skip("crayon remplacé par suppression directe", async () => {
  const { view, app, settings, plugin, scene } = fixture();
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{ id: "a1", file: "Chapitre/Scène.md", start: 0, end: 2, quote: "Il", prefix: "", suffix: " ", text: "avant", color: "yellow" }],
  });

  const calls = [];
  let capturedOnChange = null;
  plugin.openAnnotationEditor = async (id, onChange) => {
    calls.push(id);
    capturedOnChange = onChange;
  };

  const wrapper = new FakeElement();
  await view.renderAnnotationsPanel(wrapper, scene);
  const editBtn = allElements(wrapper).find((el) => el.classes.has("feuillets-annotation-edit"));
  assert.ok(editBtn);

  await trigger(editBtn, "click", { stopPropagation: () => {} });
  assert.deepEqual(calls, ["a1"]);
  assert.equal(typeof capturedOnChange, "function");

  let renderedAgain = 0;
  view.render = async () => { renderedAgain += 1; };
  capturedOnChange();
  assert.equal(renderedAgain, 1, "la liste est rerendue après modification/suppression");
});

test.skip("JSON corrompu couvert par la page unifiée", async () => {
  const { view, app, root, scene } = fixture();
  await app.vault.createFolder("Projet/_Feuillets");
  await app.vault.createFolder("Projet/_Feuillets/Ressources");
  await app.vault.createFolder("Projet/_Feuillets/Ressources/Ressources internes");
  await app.vault.create("Projet/_Feuillets/Ressources/Ressources internes/annotations.json", "{ pas du json valide");

  const wrapper = new FakeElement();
  await view.renderAnnotationsPanel(wrapper, scene);

  assert.ok(allElements(wrapper).some((el) => el.classes.has("feuillets-empty")));
  const raw = app.vault.getAbstractFileByPath("Projet/_Feuillets/Ressources/Ressources internes/annotations.json");
  assert.equal(raw.content, "{ pas du json valide");
  void root;
});

test.skip("ordre ancien remplacé par une entrée unique", async () => {
  const { view, app, settings, scene } = fixture();
  scene.content += "\n\n[^1]: Une note de bas de page.\n"; // pour que renderFootnotesRow ait quelque chose à afficher
  settings.notesShowNotes = true;
  settings.notesShowFootnotes = true;
  settings.notesShowEntities = false;
  settings.notesShowSynopsis = false;
  settings.notesShowResume = false;
  settings.notesSectionOrder = ["Notes"];
  await saveAnnotations(app, settings, {
    version: 1,
    annotations: [{ id: "a1", file: "Chapitre/Scène.md", start: 0, end: 2, quote: "Il", prefix: "", suffix: " ", text: "", color: "yellow" }],
  });

  view.renderFolderNoteLinks = () => {};
  view.renderPropertiesRow = () => {};
  view.renderCitedEntities = async () => {};
  await view.render(true);

  const titles = allElements(view.contentEl)
    .filter((el) => el.classes.has("feuillets-notes-section-title"))
    .map((el) => el.text);

  const notesIdx = titles.indexOf("Notes de travail");
  const annotationsIdx = titles.indexOf("Annotations");
  const footnotesIdx = titles.indexOf("Notes de bas de page");
  assert.ok(notesIdx >= 0 && annotationsIdx >= 0 && footnotesIdx >= 0);
  assert.ok(notesIdx < annotationsIdx && annotationsIdx < footnotesIdx, "Annotations reste entre Notes de travail et Notes de bas de page");
});
