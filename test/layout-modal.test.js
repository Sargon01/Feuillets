import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Setting, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { createFakeVault } = await import(modulePath("test/helpers/fake-vault.js"));
const { DEFAULT_SETTINGS } = await import(modulePath("src/default-settings.js"));
const { LayoutModal } = await import(modulePath("src/ui/layout-modal.js"));

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.style = {};
    this.settings = [];
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  toggleClass(name, active) { if (active) this.classes.add(name); else this.classes.delete(name); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  empty() { this.children = []; this.settings = []; }
  setText(text) { this.text = String(text); return this; }
  querySelectorAll(selector) {
    if (selector !== 'input[type="number"]') return [];
    return this.settings.filter((setting) => setting.kind === "text" && setting.inputEl.type === "number").map((setting) => setting.inputEl);
  }
}

function cloneSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function installSettingStub() {
  const methods = ["setName", "addButton", "addDropdown", "addExtraButton", "addToggle", "addText", "then"];
  const previous = Object.fromEntries(methods.map((name) => [name, Setting.prototype[name]]));
  const add = (kind, parent, configure) => {
    const control = {
      kind,
      options: [],
      inputEl: { type: "text", value: "" },
      extraSettingsEl: new FakeElement(),
      addOption(value, label) { this.options.push({ value, label }); return this; },
      setValue(value) { this.value = value; this.inputEl.value = value; return this; },
      setButtonText(value) { this.text = value; return this; },
      setCta() { this.cta = true; return this; },
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
  Setting.prototype.addButton = function addButton(configure) { add("button", this.container, configure); return this; };
  Setting.prototype.addDropdown = function addDropdown(configure) { add("dropdown", this.container, configure); return this; };
  Setting.prototype.addExtraButton = function addExtraButton(configure) { add("extra", this.container, configure); return this; };
  Setting.prototype.addToggle = function addToggle(configure) { add("toggle", this.container, configure); return this; };
  Setting.prototype.addText = function addText(configure) { add("text", this.container, configure); return this; };
  Setting.prototype.then = function then(callback) { callback(this); return this; };
  return () => Object.assign(Setting.prototype, previous);
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function controls(element, kind) {
  return allElements(element).flatMap((item) => item.settings).filter((control) => control.kind === kind);
}

function createModal({ templateKey = "classique", exportFormat = "docx" } = {}) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  manuscript.parent = volume;
  volume.children.push(manuscript);
  const { vault, fileManager, files } = createFakeVault([volume, manuscript]);
  const settings = cloneSettings();
  Object.assign(settings, {
    projectFolder: manuscript.path,
    exportFormat,
    exportTemplate: templateKey,
    compilePresets: [{ name: "Premier jet" }],
  });
  const calls = { save: 0, notify: 0, compile: 0, export: [], close: 0, frontmatter: [] };
  fileManager.processFrontMatter = async (file, update) => {
    const frontmatter = {};
    update(frontmatter);
    calls.frontmatter.push({ file, frontmatter });
  };
  const app = { vault, fileManager };
  const plugin = {
    settings,
    async saveSettings() { calls.save += 1; },
    compile() { calls.compile += 1; },
    exportFile(format) { calls.export.push(format); },
  };
  const modal = new LayoutModal(app, plugin, templateKey, "Classique", () => { calls.notify += 1; });
  modal.app = app;
  modal.contentEl = new FakeElement();
  modal.modalEl = new FakeElement();
  modal.close = () => { calls.close += 1; };
  return { modal, app, plugin, settings, calls, files };
}

async function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  try {
    await run(listeners);
  } finally {
    globalThis.document = previousDocument;
  }
}

test("LayoutModal initialise son état local", () => {
  const { modal, plugin } = createModal({ templateKey: "moderne" });
  assert.equal(modal.plugin, plugin);
  assert.equal(modal.templateKey, "moderne");
  assert.equal(modal.templateLabel, "Classique");
  assert.equal(typeof modal.onChange, "function");
  assert.deepEqual(modal.styles, {});
  assert.deepEqual(modal.roles, []);
  assert.equal(modal.selected, null);
  assert.deepEqual(modal.blockEls, {});
});

test("LayoutModal reste un éditeur visuel sans réglages d'export dupliqués", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal } = createModal({ templateKey: "supprime" });
    const { contentEl } = modal;
    await modal.onOpen();
    assert.equal(modal.templates.length > 0, true);
    assert.equal(modal.templateKey, modal.templates[0].key);
    assert.equal(allElements(contentEl).some((el) => el.classes.has("feuillets-tp-configbar")), false);
    assert.equal(allElements(contentEl).some((el) => el.classes.has("feuillets-tp-footer")), false);
    assert.equal(controls(contentEl, "dropdown").length, 0);
    assert.equal(typeof modal.doExport, "undefined");
  } finally {
    restoreSetting();
  }
});

test("LayoutModal reconstruit la maquette, sélectionne ses zones et préserve le modèle source", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal } = createModal();
    await modal.onOpen();
    const source = JSON.stringify(modal.styles);
    await modal.renderLayout();
    assert.equal(modal.selected, null);
    assert.equal(modal.roles.length > 0, true);
    assert.equal(Object.keys(modal.blockEls).length, modal.roles.length);
    modal.select(modal.roles[0]);
    assert.equal(modal.blockEls[modal.roles[0]].classes.has("is-selected"), true);
    assert.equal(modal.blockEls[modal.roles[0]].style.textAlign, modal.styles[modal.roles[0]].align || "center");
    modal.select("header");
    assert.equal(modal.headerBand.classes.has("is-selected"), true);
    modal.select("footer");
    assert.equal(modal.footerBand.classes.has("is-selected"), true);
    assert.equal(JSON.stringify(modal.styles), source);
  } finally {
    restoreSetting();
  }
});

test("LayoutModal gère les bandes, le glisser-déposer et les inspecteurs sans écriture prématurée", async () => {
  const restoreSetting = installSettingStub();
  try {
    await withFakeDocument(async (listeners) => {
      const { modal, settings, calls } = createModal();
      await modal.onOpen();
      settings.pdfEnableHeaders = false;
      settings.pdfHideFirstPageHeader = true;
      modal.renderBands();
      assert.equal(modal.headerBand.classes.has("is-muted"), true);
      assert.equal(modal.footerBand.classes.has("is-muted"), true);

      const role = modal.roles[0];
      const initialMargin = modal.styles[role].marginTopPt || 0;
      modal.startDrag({ clientY: 100, preventDefault() {} }, role);
      listeners.get("pointermove")({ clientY: -100 });
      assert.equal(modal.styles[role].marginTopPt >= 0, true);
      await listeners.get("pointerup")();
      assert.equal(listeners.size, 0);
      assert.equal(calls.frontmatter.length, 1);
      assert.equal(calls.notify, 1, "la sauvegarde du gabarit avertit l’aperçu qui l’a ouvert");
      assert.equal(modal.styles[role].marginTopPt <= initialMargin, true);

      modal.select("header");
      const headerToggle = controls(modal.inspectorEl, "toggle")[0];
      await headerToggle.change(true);
      assert.equal(calls.save > 0, true);
      assert.equal(calls.notify, 2, "les bandes en-tête/pied avertissent aussi l’aperçu");

      modal.select(role);
      const sizeInput = controls(modal.inspectorEl, "text")[0];
      await sizeInput.change("18");
      assert.equal(modal.styles[role].fontSizePt, 18);
      assert.equal(calls.frontmatter.length, 2);
      assert.equal(calls.notify, 3);
    });
  } finally {
    restoreSetting();
  }
});

/* Ces réglages vivaient dans le panneau Export de l'aperçu, qui n'en garde
   plus aucun : le modal visuel est désormais leur unique interface. Ils
   écrivent les MÊMES clés que celles lues par l'aperçu et par les exports
   PDF/DOCX/ODT — aucune valeur n'a été perdue au déménagement. */
test("LayoutModal — en-têtes, pieds, distances et espacements sont réglables ici et nulle part ailleurs", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal, settings, calls } = createModal();
    await modal.onOpen();

    modal.select("header");
    const headerTexts = controls(modal.inspectorEl, "text");
    // gauche, centre, droite, distance au bord, espace en-tête/corps
    assert.equal(headerTexts.length, 5, "les cinq champs d'en-tête sont présents");
    await headerTexts[1].change("{title} — {author}");
    assert.equal(settings.pdfHeaderCenter, "{title} — {author}");
    await headerTexts[3].change("1.2");
    assert.equal(settings.pdfHeaderDistanceCm, 1.2);
    await headerTexts[4].change("6");
    assert.equal(settings.pdfHeaderBodyGapPt, 6);

    modal.select("footer");
    const footerToggle = controls(modal.inspectorEl, "toggle")[0];
    await footerToggle.change(false);
    assert.equal(settings.pdfEnableFooters, false);
    const footerTexts = controls(modal.inspectorEl, "text");
    // format du numéro, pied gauche, pied centre, distance, espace corps/pied
    assert.equal(footerTexts.length, 5);
    await footerTexts[1].change("Brouillon");
    assert.equal(settings.pdfFooterLeft, "Brouillon");
    await footerTexts[2].change("{chapter}");
    assert.equal(settings.pdfFooterCenter, "{chapter}");
    await footerTexts[3].change("1.5");
    assert.equal(settings.pdfFooterDistanceCm, 1.5);
    await footerTexts[4].change("9");
    assert.equal(settings.pdfFooterBodyGapPt, 9);

    // Première page différente : le même unique réglage, côté en-tête.
    modal.select("header");
    const headerToggles = controls(modal.inspectorEl, "toggle");
    await headerToggles.at(-1).change(false);
    assert.equal(settings.pdfHideFirstPageHeader, false);
    assert.equal(calls.save > 0, true, "chaque changement est persisté dans les réglages centraux");
    assert.equal(calls.notify > 0, true, "et l'aperçu ouvert est prévenu");
  } finally {
    restoreSetting();
  }
});

test("LayoutModal ne compile ni n'exporte lorsqu'elle est simplement fermée", () => {
  const { modal, calls } = createModal();
  modal.onClose();
  assert.equal(calls.compile, 0);
  assert.deepEqual(calls.export, []);
});
