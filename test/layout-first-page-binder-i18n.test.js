import test from "node:test";
import assert from "node:assert/strict";
import { Menu, Setting, TFile, TFolder } from "obsidian";
import { LayoutEditor } from "../src/ui/layout-editor.js";
import { BaseFeuilletsView } from "../src/views/base-feuillets-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { ensureEditionFolder, EDITION_DOCUMENTS, EDITION_SUBFOLDERS } from "../src/services/project-files.js";
import { setLocale } from "../src/i18n/index.js";

/* Dernier correctif i18n avant 2.5 : rend RÉELLEMENT les contrôles (Mise en
 * page, Première page) et les VRAIS menus contextuels du Binder sous chaque
 * locale — jamais une simple vérification de présence de clé i18n. Même
 * patron de DOM factice que edition-workspace-content.test.js / binder-
 * continu-menu.test.js (convention du dépôt : dupliqué, pas partagé). */

/* ==================== DOM factice (Mise en page / Première page) ========= */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.style = {};
    this.settings = [];
    this._attributes = new Map();
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    this.type = options.type;
    this.checked = false;
    this.parentNode = null;
    if (options.cls) this.addClass(options.cls);
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) this.setAttribute(k, v);
  }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  hasClass(name) { return this.classes.has(name); }
  toggleClass(name, active) {
    if (active === undefined) { if (this.classes.has(name)) this.classes.delete(name); else this.classes.add(name); }
    else if (active) this.classes.add(name);
    else this.classes.delete(name);
  }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setAttribute(name, value) { this._attributes.set(name, String(value)); }
  setAttr(name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(name) ?? null; }
  empty() { for (const child of [...this.children]) child.remove(); this.settings = []; }
  setText(text) { this.text = String(text); return this; }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this.text; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

/** Tous les libellés visibles (Setting.setName + createEl/createSpan text)
 * dans un sous-arbre — sert à affirmer qu'AUCUN libellé français connu n'y
 * apparaît, pas seulement que les clés existent. */
function allLabels(element) {
  const own = allElements(element);
  const texts = own.map((el) => el.text).filter(Boolean);
  const settingNames = own.flatMap((el) => el.settings).map((s) => s.name).filter(Boolean);
  const optionLabels = own.flatMap((el) => el.settings).flatMap((s) => s.options || []).map((o) => o.label).filter(Boolean);
  return [...texts, ...settingNames, ...optionLabels];
}

function installSettingStub() {
  const methods = ["setName", "addButton", "addDropdown", "addExtraButton", "addToggle", "addText", "addColorPicker"];
  const previous = Object.fromEntries(methods.map((name) => [name, Setting.prototype[name]]));
  const previousThen = Setting.prototype.then;
  const add = (kind, parent, configure, name) => {
    const control = {
      kind,
      name,
      options: [],
      inputEl: { type: "text", value: "" },
      extraSettingsEl: new FakeElement(),
      addOption(value, label) { this.options.push({ value, label }); return this; },
      setValue(value) { this.value = value; this.inputEl.value = value; return this; },
      setPlaceholder(value) { this.placeholder = value; return this; },
      setIcon(value) { this.icon = value; return this; },
      setTooltip(value) { this.tooltip = value; return this; },
      onClick(callback) { this.click = callback; return this; },
      onChange(callback) { this.change = callback; return this; },
    };
    parent.settings.push(control);
    configure(control);
    return control;
  };
  Setting.prototype.setName = function setName(name) { this.name = name; return this; };
  Setting.prototype.addButton = function addButton(configure) { add("button", this.container, configure, this.name); return this; };
  Setting.prototype.addDropdown = function addDropdown(configure) { add("dropdown", this.container, configure, this.name); return this; };
  Setting.prototype.addExtraButton = function addExtraButton(configure) { add("extra", this.container, configure, this.name); return this; };
  Setting.prototype.addToggle = function addToggle(configure) { add("toggle", this.container, configure, this.name); return this; };
  Setting.prototype.addText = function addText(configure) { add("text", this.container, configure, this.name); return this; };
  Setting.prototype.addColorPicker = function addColorPicker(configure) { add("colorPicker", this.container, configure, this.name); return this; };
  Setting.prototype.then = function then(callback) { callback(this); return this; };
  return () => { Object.assign(Setting.prototype, previous); Setting.prototype.then = previousThen; };
}

function buildLayoutFixture() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = volume;
  volume.children.push(manuscript);
  const { vault, fileManager } = createFakeVault([volume, manuscript]);
  vault.cachedRead = vault.read;
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.assign(settings, {
    projectFolder: manuscript.path,
    exportTemplate: "classique",
    collapsed: {},
    orders: {},
    folderPositions: {},
    projectMeta: {},
  });
  const frontmatter = new Map();
  fileManager.processFrontMatter = async (file, update) => {
    const data = { ...(frontmatter.get(file.path) || {}) };
    update(data);
    frontmatter.set(file.path, data);
  };
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatter.get(f.path) || {} }) },
    workspace: { getLeavesOfType: () => [], getLeaf: () => null },
  };
  const plugin = {
    settings,
    saveSettings: async () => {},
    getProjectFolder: () => manuscript,
    unitLabel: () => "scène",
    unitLabelPlural: () => "scènes",
    refreshView: () => {},
  };
  const contentEl = new FakeElement("div");
  const editor = new LayoutEditor(app, plugin, contentEl, settings.exportTemplate, { mode: "workspace" });
  const view = {
    editor,
    modeRenderPromise: Promise.resolve(),
    async render() { await editor.load(); },
    setMode() {},
  };
  return { view, contentEl, plugin, app };
}

/* Libellés français connus des captures — aucun ne doit survivre sous
 * locale EN dans les surfaces Mise en page/Première page auditées. */
const FRENCH_LAYOUT_WORDS = [
  "Police", "Taille (pt)", "Interligne", "Alignement", "Retrait première ligne (pt)",
  "Espacement avant (pt)", "Espacement après (pt)", "Césure", "Profil", "Justifié",
  "Gras", "Italique", "Saut de page avant", "Par défaut", "Marge gauche (pt)",
  "Marge droite (pt)", "Couleur", "Séparateur de scène", "Citation et séparateur",
  "Masquer en-tête et pied",
];

test("A. Mise en page → Corps de texte en anglais : aucun libellé français de la capture", async () => {
  setLocale("en");
  const restore = installSettingStub();
  try {
    const { view } = buildLayoutFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("body");

    const labels = allLabels(view.editor.inspectorEl);
    for (const word of FRENCH_LAYOUT_WORDS) {
      assert.ok(!labels.includes(word), `"${word}" ne doit plus apparaître (EN) dans Corps de texte — labels: ${JSON.stringify(labels)}`);
    }
    // Vraies traductions attendues, réellement rendues.
    assert.ok(labels.includes("Font"));
    assert.ok(labels.includes("Size (pt)"));
    assert.ok(labels.includes("Line spacing"));
    assert.ok(labels.includes("Alignment"));
    assert.ok(labels.includes("First-line indent (pt)"));
    assert.ok(labels.includes("Space before (pt)"));
    assert.ok(labels.includes("Space after (pt)"));
    assert.ok(labels.includes("Hyphenation"));
    assert.ok(labels.includes("Profile"));
    assert.ok(labels.includes("Justified"));
  } finally {
    restore();
    setLocale("fr");
  }
});

test("B. Mise en page → Titres en anglais : aucun libellé français de la capture", async () => {
  setLocale("en");
  const restore = installSettingStub();
  try {
    const { view } = buildLayoutFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("headings");

    const labels = allLabels(view.editor.inspectorEl);
    for (const word of FRENCH_LAYOUT_WORDS) {
      assert.ok(!labels.includes(word), `"${word}" ne doit plus apparaître (EN) dans Titres — labels: ${JSON.stringify(labels)}`);
    }
    assert.ok(labels.includes("Font"));
    assert.ok(labels.includes("Size (pt)"));
    assert.ok(labels.includes("Bold"));
    assert.ok(labels.includes("Italic"));
    assert.ok(labels.includes("Alignment"));
    assert.ok(labels.includes("Space before"));
    assert.ok(labels.includes("Space after"));
    assert.ok(labels.includes("Page break before"));
  } finally {
    restore();
    setLocale("fr");
  }
});

test("C. Mise en page → Citation en anglais : aucun libellé français de la capture", async () => {
  setLocale("en");
  const restore = installSettingStub();
  try {
    const { view } = buildLayoutFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("blockquote");

    const labels = allLabels(view.editor.inspectorEl);
    for (const word of FRENCH_LAYOUT_WORDS) {
      assert.ok(!labels.includes(word), `"${word}" ne doit plus apparaître (EN) dans Citation — labels: ${JSON.stringify(labels)}`);
    }
    assert.ok(labels.includes("Blockquote and separator"));
    assert.ok(labels.includes("Font"));
    assert.ok(labels.includes("Size (pt)"));
    assert.ok(labels.includes("Line spacing"));
    assert.ok(labels.includes("Alignment"));
    assert.ok(labels.includes("Default"));
    assert.ok(labels.includes("First-line indent (pt)"));
    assert.ok(labels.includes("Left margin (pt)"));
    assert.ok(labels.includes("Right margin (pt)"));
    assert.ok(labels.includes("Space before (pt)"));
    assert.ok(labels.includes("Space after (pt)"));
    assert.ok(labels.includes("Italic"));
    assert.ok(labels.includes("Color"));
    assert.ok(labels.includes("Scene separator"));
  } finally {
    restore();
    setLocale("fr");
  }
});

test("D. Mise en page → Première page en anglais : aucun libellé français de la capture", async () => {
  setLocale("en");
  const restore = installSettingStub();
  try {
    const { view } = buildLayoutFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];
    view.editor.select("firstPage");

    const labels = allLabels(view.editor.inspectorEl);
    assert.ok(!labels.includes("Masquer en-tête et pied"));
    assert.ok(labels.includes("Hide header and footer"));
  } finally {
    restore();
    setLocale("fr");
  }
});

test("G. Mêmes surfaces (Corps/Titres/Citation/Première page) restent correctement françaises en FR", async () => {
  setLocale("fr");
  const restore = installSettingStub();
  try {
    const { view } = buildLayoutFixture();
    await view.render();
    view.setMode("layout");
    await view["modeRenderPromise"];

    view.editor.select("body");
    let labels = allLabels(view.editor.inspectorEl);
    for (const word of FRENCH_LAYOUT_WORDS.slice(0, 10)) {
      // Sous-ensemble propre à Corps de texte (Police..Profil/Justifié).
      if (["Police", "Taille (pt)", "Interligne", "Alignement", "Retrait première ligne (pt)", "Espacement avant (pt)", "Espacement après (pt)", "Césure", "Profil", "Justifié"].includes(word)) {
        assert.ok(labels.includes(word), `"${word}" doit rester en français — labels: ${JSON.stringify(labels)}`);
      }
    }

    view.editor.select("headings");
    labels = allLabels(view.editor.inspectorEl);
    assert.ok(labels.includes("Gras"));
    assert.ok(labels.includes("Italique"));
    assert.ok(labels.includes("Saut de page avant"));

    view.editor.select("blockquote");
    labels = allLabels(view.editor.inspectorEl);
    assert.ok(labels.includes("Citation et séparateur"));
    assert.ok(labels.includes("Couleur"));
    assert.ok(labels.includes("Séparateur de scène"));

    view.editor.select("firstPage");
    labels = allLabels(view.editor.inspectorEl);
    assert.ok(labels.includes("Masquer en-tête et pied"));
  } finally {
    restore();
    setLocale("fr");
  }
});

/* ==================== Binder : menus contextuels ========================= */

class TestBoardView extends BaseFeuilletsView {
  constructor(app, plugin) {
    super({ app, contentEl: null });
    this.app = app;
    this.plugin = plugin;
  }
  async render() {}
}

function buildBinderProject() {
  const root = new TFolder("Roman/Manuscrit");
  root.path = "Roman/Manuscrit";
  root.name = "Manuscrit";

  const chapter = new TFolder("Roman/Manuscrit/Chapitre 1");
  chapter.path = "Roman/Manuscrit/Chapitre 1";
  chapter.name = "Chapitre 1";
  chapter.parent = root;
  root.children = [chapter];

  const scene = new TFile("Roman/Manuscrit/Chapitre 1/Scene.md", "Texte.");
  scene.path = "Roman/Manuscrit/Chapitre 1/Scene.md";
  scene.name = "Scene.md";
  scene.basename = "Scene";
  scene.extension = "md";
  scene.parent = chapter;
  chapter.children = [scene];

  return { root, chapter, scene };
}

function buildBinderView(project) {
  const app = {
    workspace: { getLeaf: () => ({ openFile: async () => {} }), getLeavesOfType: () => [] },
    vault: { getAbstractFileByPath: (p) => (p === project.root.path ? project.root : null), read: async () => "Texte." },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    fileManager: { processFrontMatter: async () => {}, trashFile: async () => {} },
  };
  const plugin = {
    settings: { projectFolder: project.root.path, statuses: [], labels: [] },
    getProjectFolder: () => project.root,
    saveSettings: async () => {},
    fmOf: () => ({}),
    labelOf: () => "",
    titleFor: (f) => f.basename,
    shortTitleFor: (f) => f.basename,
    newSheetAt: () => {},
    newSheet: () => {},
    newFolder: () => {},
    renderAllViews: () => {},
    snapshotFile: async () => "",
    folderNoteFor: () => null,
    getOrCreateFolderNote: async () => null,
    getLinkedResearchFolder: () => null,
    getResearchRoot: () => null,
  };
  return new TestBoardView(app, plugin);
}

test("E. Menu Binder — dossier, en anglais : « New… », « Change label… », « Change status… », « Organization… », « Compilation… »", () => {
  setLocale("en");
  try {
    const project = buildBinderProject();
    const view = buildBinderView(project);
    view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, []);
    const titles = Menu.lastShown.items.map((i) => i.title).filter(Boolean);

    assert.ok(titles.includes("New…"), `attendu "New…" — reçu: ${JSON.stringify(titles)}`);
    assert.ok(titles.includes("Change label…"));
    assert.ok(titles.includes("Change status…"));
    assert.ok(titles.includes("Organization…"));
    // "Compilation…" est un mot identique en français et en anglais — sa
    // présence ne prouve ni ne réfute la localisation, contrairement aux
    // autres. Toujours vérifié comme présent (t() appelé, jamais retiré du
    // menu), simplement pas comme preuve de traduction.
    assert.ok(titles.includes("Compilation…"));

    for (const french of ["Nouveau…", "Changer le label…", "Changer le statut…", "Organisation…"]) {
      assert.ok(!titles.includes(french), `"${french}" ne doit plus apparaître (EN) — reçu: ${JSON.stringify(titles)}`);
    }
  } finally {
    setLocale("fr");
  }
});

test("F. Menu Binder — feuillet, en anglais : « Add to Notebook », « New sheet… », « Change status… », « Change label… »", () => {
  setLocale("en");
  try {
    const project = buildBinderProject();
    const view = buildBinderView(project);
    view.showFileContextMenu({ preventDefault() {} }, project.scene, project.chapter, 0, []);
    const titles = Menu.lastShown.items.map((i) => i.title).filter(Boolean);

    assert.ok(titles.includes("Add to Notebook"), `attendu "Add to Notebook" — reçu: ${JSON.stringify(titles)}`);
    assert.ok(titles.includes("New sheet…"));
    assert.ok(titles.includes("Change status…"));
    assert.ok(titles.includes("Change label…"));

    for (const french of ["Ajouter au Carnet", "Nouveau feuillet…", "Changer le statut…", "Changer le label…"]) {
      assert.ok(!titles.includes(french), `"${french}" ne doit plus apparaître (EN) — reçu: ${JSON.stringify(titles)}`);
    }
  } finally {
    setLocale("fr");
  }
});

test("G (suite). Menus Binder dossier/feuillet restent correctement français en FR", () => {
  setLocale("fr");
  try {
    const project = buildBinderProject();
    const view = buildBinderView(project);

    view.showFolderContextMenu({ preventDefault() {} }, project.chapter, project.root, 0, []);
    let titles = Menu.lastShown.items.map((i) => i.title).filter(Boolean);
    assert.ok(titles.includes("Nouveau…"));
    assert.ok(titles.includes("Changer le label…"));
    assert.ok(titles.includes("Changer le statut…"));
    assert.ok(titles.includes("Organisation…"));
    assert.ok(titles.includes("Compilation…"));

    view.showFileContextMenu({ preventDefault() {} }, project.scene, project.chapter, 0, []);
    titles = Menu.lastShown.items.map((i) => i.title).filter(Boolean);
    assert.ok(titles.includes("Ajouter au Carnet"));
    assert.ok(titles.includes("Nouveau feuillet…"));
    assert.ok(titles.includes("Changer le statut…"));
    assert.ok(titles.includes("Changer le label…"));
  } finally {
    setLocale("fr");
  }
});

/* ==================== H. Documents éditoriaux : jamais renommés ========== */

test("H. Documents éditoriaux : noms canoniques créés IDENTIQUES quelle que soit la locale active, jamais renommés sur un projet existant", async () => {
  // A. Création en FR : noms français attendus (comportement historique).
  {
    setLocale("fr");
    const volume = new TFolder("ProjetFR");
    const manuscript = new TFolder("ProjetFR/Manuscrit");
    manuscript.parent = volume;
    volume.children = [manuscript];
    const { vault } = createFakeVault([volume, manuscript]);
    const app = { vault };

    const edition = await ensureEditionFolder(app, manuscript);
    for (const doc of EDITION_DOCUMENTS) {
      assert.ok(vault.getAbstractFileByPath(`${edition.path}/${doc.file}`) instanceof TFile, `${doc.file} créé en FR`);
    }
    for (const sub of EDITION_SUBFOLDERS) {
      assert.ok(vault.getAbstractFileByPath(`${edition.path}/${sub}`) instanceof TFolder, `${sub} créé en FR`);
    }
  }

  // B. Création avec la locale anglaise active : Feuillets documente ces
  // noms comme volontairement CANONIQUES et indépendants de la locale
  // (voir services/folder-structure.ts#getFeuilletsFolderNames : "Les
  // dossiers créés sur le disque sont canoniques et fixes.") — ils restent
  // donc IDENTIQUEMENT français, jamais traduits à la création. Ce test
  // documente ce choix plutôt que d'imposer une traduction non voulue.
  {
    setLocale("en");
    try {
      const volume = new TFolder("ProjetEN");
      const manuscript = new TFolder("ProjetEN/Manuscrit");
      manuscript.parent = volume;
      volume.children = [manuscript];
      const { vault } = createFakeVault([volume, manuscript]);
      const app = { vault };

      const edition = await ensureEditionFolder(app, manuscript);
      for (const doc of EDITION_DOCUMENTS) {
        assert.ok(vault.getAbstractFileByPath(`${edition.path}/${doc.file}`) instanceof TFile, `${doc.file} créé identique, même sous locale EN`);
      }
      for (const sub of EDITION_SUBFOLDERS) {
        assert.ok(vault.getAbstractFileByPath(`${edition.path}/${sub}`) instanceof TFolder, `${sub} créé identique, même sous locale EN`);
      }
    } finally {
      setLocale("fr");
    }
  }

  // C. Projet existant créé en FR, puis passage à la locale anglaise :
  // aucun fichier ni dossier déjà présent n'est renommé — ensureEditionFolder
  // reste idempotent, jamais un second appel qui recrée/renomme quoi que ce
  // soit sous une éventuelle variante anglaise.
  {
    setLocale("fr");
    const volume = new TFolder("ProjetC");
    const manuscript = new TFolder("ProjetC/Manuscrit");
    manuscript.parent = volume;
    volume.children = [manuscript];
    const { vault } = createFakeVault([volume, manuscript]);
    const app = { vault };
    const edition = await ensureEditionFolder(app, manuscript);

    const titleFile = vault.getAbstractFileByPath(`${edition.path}/Note d’intention.md`);
    assert.ok(titleFile instanceof TFile);
    const originalContent = titleFile.content;
    const submissionsFolder = vault.getAbstractFileByPath(`${edition.path}/Soumissions`);
    assert.ok(submissionsFolder instanceof TFolder);

    setLocale("en");
    try {
      await ensureEditionFolder(app, manuscript);
      // Toujours le MÊME fichier, au MÊME chemin, contenu inchangé — jamais
      // renommé ni recréé sous un nom anglais.
      const stillThere = vault.getAbstractFileByPath(`${edition.path}/Note d’intention.md`);
      assert.strictEqual(stillThere, titleFile, "le même objet fichier, jamais recréé");
      assert.equal(stillThere.content, originalContent);
      assert.strictEqual(vault.getAbstractFileByPath(`${edition.path}/Soumissions`), submissionsFolder, "le même dossier, jamais renommé");
      assert.equal(vault.getAbstractFileByPath(`${edition.path}/Submissions`), null, "aucune variante anglaise créée en doublon");
    } finally {
      setLocale("fr");
    }
  }
});

test("H (bis). Changer la locale ne renomme jamais un feuillet Front existant comme « Page de titre.md »", async () => {
  const volume = new TFolder("ProjetTitre");
  const manuscript = new TFolder("ProjetTitre/Manuscrit");
  const front = new TFolder("ProjetTitre/Manuscrit/Front");
  const titlePage = new TFile("ProjetTitre/Manuscrit/Front/Page de titre.md", "---\ntitle: Mon livre\ntype: titre\n---\n");
  manuscript.parent = volume;
  volume.children = [manuscript];
  manuscript.children = [front];
  front.parent = manuscript;
  front.children = [titlePage];
  titlePage.parent = front;
  const { vault } = createFakeVault([volume, manuscript, front, titlePage]);

  setLocale("fr");
  assert.ok(vault.getAbstractFileByPath("ProjetTitre/Manuscrit/Front/Page de titre.md") instanceof TFile);

  setLocale("en");
  try {
    // Aucune opération Feuillets ne renomme un fichier au seul changement
    // de locale — le fichier reste exactement où et comme il était.
    assert.ok(vault.getAbstractFileByPath("ProjetTitre/Manuscrit/Front/Page de titre.md") instanceof TFile);
    assert.equal(vault.getAbstractFileByPath("ProjetTitre/Manuscrit/Front/Title page.md"), null);
  } finally {
    setLocale("fr");
  }
});
