import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (path) => new URL(`../.test-dist/${path}`, import.meta.url).href;
const modulePath = (path) => isCompiledTest ? `../${path}` : compiledModule(path);

const { Notice, Platform, Setting, TFolder } = await import(
  isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js")
);
const { createFakeVault } = await import(modulePath("test/helpers/fake-vault.js"));
const { DEFAULT_SETTINGS } = await import(modulePath("src/default-settings.js"));
const { LayoutModal } = await import(modulePath("src/ui/layout-modal.js"));
const { CompileSelectionModal } = await import(modulePath("src/ui/selection-modals.js"));

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

test("LayoutModal ouvre les contrôles, rétablit un modèle absent et masque PDF sur mobile", async () => {
  const restoreSetting = installSettingStub();
  const previousMobile = Platform.isMobile;
  const previousOpen = CompileSelectionModal.prototype.open;
  let selectionOpened = 0;
  Platform.isMobile = true;
  CompileSelectionModal.prototype.open = () => { selectionOpened += 1; };
  try {
    const { modal } = createModal({ templateKey: "supprime" });
    const { contentEl } = modal;
    await modal.onOpen();
    const dropdowns = controls(contentEl, "dropdown");
    assert.equal(modal.templates.length > 0, true);
    assert.equal(modal.templateKey, modal.templates[0].key);
    assert.equal(dropdowns.length, 3);
    assert.equal(dropdowns[2].options.some((option) => option.value === "pdf"), false);
    assert.equal(controls(contentEl, "button").length, 2);
    controls(contentEl, "button")[0].click();
    assert.equal(selectionOpened, 1);
  } finally {
    Platform.isMobile = previousMobile;
    CompileSelectionModal.prototype.open = previousOpen;
    restoreSetting();
  }
});

test("LayoutModal sauvegarde et notifie les changements de preset, modèle et format", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal, settings, calls } = createModal();
    await modal.onOpen();
    const dropdowns = controls(modal.contentEl, "dropdown");
    await dropdowns[0].change("0");
    await dropdowns[1].change("moderne");
    await dropdowns[2].change("epub");
    assert.equal(settings.activePreset, 0);
    assert.equal(settings.exportTemplate, "moderne");
    assert.equal(modal.templateLabel, modal.templates.find((item) => item.key === "moderne").label);
    assert.equal(settings.exportFormat, "epub");
    assert.equal(calls.save, 3);
    assert.equal(calls.notify, 3);
  } finally {
    restoreSetting();
  }
});

test("LayoutModal exporte les modèles intégrés et signale le résultat", async () => {
  const restoreSetting = installSettingStub();
  const notices = [];
  const previousNotice = Notice.onCreate;
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { modal, files } = createModal();
    await modal.onOpen();
    await controls(modal.contentEl, "extra")[0].click();
    await controls(modal.contentEl, "extra")[0].click();
    assert.equal([...files.keys()].some((path) => path.endsWith("Resources/Layouts/classique.md")), true);
    assert.equal(notices.length, 2);
  } finally {
    Notice.onCreate = previousNotice;
    restoreSetting();
  }
});

test("LayoutModal compile Markdown et délègue les autres exports après fermeture", () => {
  for (const format of ["md", "docx", "odt", "epub", "pdf"]) {
    const { modal, calls } = createModal({ exportFormat: format });
    modal.doExport();
    assert.equal(calls.close, 1);
    assert.equal(calls.compile, format === "md" ? 1 : 0);
    assert.deepEqual(calls.export, format === "md" ? [] : [format]);
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
      assert.equal(modal.styles[role].marginTopPt <= initialMargin, true);

      modal.select("header");
      const headerToggle = controls(modal.inspectorEl, "toggle")[0];
      await headerToggle.change(true);
      assert.equal(calls.save > 0, true);

      modal.select(role);
      const sizeInput = controls(modal.inspectorEl, "text")[0];
      await sizeInput.change("18");
      assert.equal(modal.styles[role].fontSizePt, 18);
      assert.equal(calls.frontmatter.length, 2);
    });
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
