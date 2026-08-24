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
  const methods = ["setName", "addButton", "addDropdown", "addExtraButton", "addToggle", "addText", "addColorPicker", "then"];
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
  Setting.prototype.addColorPicker = function addColorPicker(configure) { add("colorPicker", this.container, configure); return this; };
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

test("LayoutModal indique la rubrique active et édite un seul niveau de titre à la fois", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal, calls } = createModal();
    await modal.onOpen();
    modal.template.headings.h1.fontSizePt = 31;
    modal.template.headings.h1.fontFamily = "Futura";
    modal.template.headings.h2.fontSizePt = 19;
    modal.template.headings.h2.fontFamily = "Futura";

    modal.select("headings");
    assert.equal(modal.navigationButtons.headings.classes.has("is-active"), true);
    assert.equal(modal.navigationButtons.page.classes.has("is-active"), false);
    assert.equal(modal.selectedHeading, "h1");

    const headingChoices = allElements(modal.inspectorEl).filter((el) => el.classes.has("feuillets-heading-level"));
    assert.equal(headingChoices.length, 6);
    assert.equal(headingChoices[0].text, "H1");
    assert.equal(headingChoices[0].classes.has("is-active"), true);
    assert.equal(allElements(modal.inspectorEl).filter((el) => el.classes.has("feuillets-heading-editor")).length, 1);
    assert.equal(controls(modal.inspectorEl, "text")[0].value, "Futura");
    assert.equal(controls(modal.inspectorEl, "text")[1].value, "31");

    const h2 = headingChoices.find((el) => el.text === "H2");
    h2.events.get("click")();
    assert.equal(modal.selectedHeading, "h2");
    assert.equal(controls(modal.inspectorEl, "text")[0].value, "Futura");
    assert.equal(controls(modal.inspectorEl, "text")[1].value, "19");
    assert.equal(modal.template.headings.h1.fontSizePt, 31);

    await controls(modal.inspectorEl, "text")[1].change("22");
    assert.equal(modal.template.headings.h2.fontSizePt, 22);
    assert.equal(modal.template.headings.h1.fontSizePt, 31);
    assert.equal(calls.frontmatter.at(-1).frontmatter.version, 2);
    assert.equal(calls.frontmatter.at(-1).frontmatter.headings.h2.fontSizePt, 22);
    await controls(modal.inspectorEl, "text")[0].change("Arial");
    assert.equal(modal.template.headings.h2.fontFamily, "Arial");
    assert.equal(calls.frontmatter.at(-1).frontmatter.headings.h2.fontFamily, "Arial");
    await controls(modal.inspectorEl, "text")[0].change("");
    assert.equal(modal.template.headings.h2.fontFamily, undefined);
    assert.equal(calls.frontmatter.at(-1).frontmatter.headings.h2.fontFamily, undefined);
  } finally {
    restoreSetting();
  }
});

test("LayoutModal : l'inspecteur Citation enregistre et efface les surcharges locales", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal, calls } = createModal();
    await modal.onOpen();
    modal.select("blockquote");
    const texts = controls(modal.inspectorEl, "text");
    const dropdowns = controls(modal.inspectorEl, "dropdown");
    assert.equal(texts.length, 10);
    assert.equal(dropdowns.length, 2);
    await texts[0].change("Futura");
    await texts[1].change("13");
    await texts[2].change("1.2");
    await texts[3].change("8");
    await texts[4].change("12");
    await texts[5].change("13");
    await texts[6].change("10");
    await texts[7].change("11");
    await dropdowns[0].change("center");
    await dropdowns[1].change("false");
    await texts[8].change("#123456");
    assert.deepEqual(modal.template.blockquote, { fontFamily: "Futura", fontSizePt: 13, lineHeight: 1.2, firstLineIndentPt: 8, marginLeftPt: 12, marginRightPt: 13, marginTopPt: 10, marginBottomPt: 11, align: "center", italic: false, colorHex: "#123456" });
    assert.deepEqual(calls.frontmatter.at(-1).frontmatter.blockquote, modal.template.blockquote);
    await texts[0].change("");
    await texts[1].change("");
    assert.equal(modal.template.blockquote.fontFamily, undefined);
    assert.equal(modal.template.blockquote.fontSizePt, undefined);
  } finally { restoreSetting(); }
});

test("LayoutModal — Corps : le contrôle « Couleur du texte » n'écrit rien à l'ouverture, se sauvegarde au changement, se réinitialise", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal, calls } = createModal();
    await modal.onOpen();
    modal.select("body");
    assert.equal(modal.template.body.colorHex, undefined, "ouverture seule : aucune mutation");
    const notifyBefore = calls.notify;

    const colorPicker = controls(modal.inspectorEl, "colorPicker")[0];
    assert.ok(colorPicker, "le contrôle couleur du corps existe");
    await colorPicker.change("#223344");
    assert.equal(modal.template.body.colorHex, "#223344");
    assert.equal(calls.frontmatter.at(-1).frontmatter.body.colorHex, "#223344");
    assert.equal(calls.notify, notifyBefore + 1, "la Preview est rafraîchie une seule fois");

    const reset = controls(modal.inspectorEl, "extra")[0];
    assert.ok(reset, "le bouton de réinitialisation existe");
    await reset.click();
    assert.equal(modal.template.body.colorHex, undefined);
    assert.equal(calls.frontmatter.at(-1).frontmatter.body.colorHex, undefined);
  } finally {
    restoreSetting();
  }
});

test("LayoutModal — Titres : Couleur et Souligné n'affectent que le niveau sélectionné (H1 puis H6)", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal, calls } = createModal();
    await modal.onOpen();
    modal.select("headings");
    assert.equal(modal.selectedHeading, "h1");

    let colorPicker = controls(modal.inspectorEl, "colorPicker")[0];
    let underlineToggle = controls(modal.inspectorEl, "toggle").at(-1);
    assert.ok(colorPicker, "H1 : le contrôle « Couleur » existe");
    assert.ok(underlineToggle, "H1 : le contrôle « Souligné » existe");

    await colorPicker.change("#AA1122");
    assert.equal(modal.template.headings.h1.colorHex, "#AA1122");
    await underlineToggle.change(true);
    assert.equal(modal.template.headings.h1.underline, true);
    // Aucun autre niveau n'est affecté.
    for (const level of ["h2", "h3", "h4", "h5", "h6"]) {
      assert.equal(modal.template.headings[level].colorHex, undefined);
      assert.equal(modal.template.headings[level].underline, undefined);
    }
    assert.equal(calls.frontmatter.at(-1).frontmatter.headings.h1.colorHex, "#AA1122");
    assert.equal(calls.frontmatter.at(-1).frontmatter.headings.h1.underline, true);

    // Reset : H1 retrouve l'héritage (colorHex supprimé), le soulignement
    // explicite (contrôle séparé) reste inchangé par le reset couleur.
    const resetH1Color = controls(modal.inspectorEl, "extra").at(-1);
    await resetH1Color.click();
    assert.equal(modal.template.headings.h1.colorHex, undefined);

    // H6 : mêmes contrôles disponibles, pas de traitement spécial H1-H3.
    const headingChoices = allElements(modal.inspectorEl).filter((el) => el.classes.has("feuillets-heading-level"));
    const h6 = headingChoices.find((el) => el.text === "H6");
    h6.events.get("click")();
    assert.equal(modal.selectedHeading, "h6");
    colorPicker = controls(modal.inspectorEl, "colorPicker")[0];
    underlineToggle = controls(modal.inspectorEl, "toggle").at(-1);
    assert.ok(colorPicker, "H6 : le contrôle « Couleur » existe aussi");
    assert.ok(underlineToggle, "H6 : le contrôle « Souligné » existe aussi");
    await colorPicker.change("#334455");
    await underlineToggle.change(false);
    assert.equal(modal.template.headings.h6.colorHex, "#334455");
    assert.equal(modal.template.headings.h6.underline, false);
    assert.equal(modal.template.headings.h1.colorHex, undefined, "H1 reste inchangé par l'édition de H6");
  } finally {
    restoreSetting();
  }
});

test("LayoutModal gère les bandes, le glisser-déposer et les inspecteurs V2 sans écriture dans les réglages globaux", async () => {
  const restoreSetting = installSettingStub();
  try {
    await withFakeDocument(async (listeners) => {
      const { modal, calls } = createModal();
      await modal.onOpen();
      modal.template.header.enabled = false;
      modal.template.firstPage.hideHeader = true;
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
      assert.equal(modal.template.header.enabled, true);
      assert.equal(calls.save, 0, "l'éditeur ne persiste jamais settings.pdf…");
      assert.equal(calls.notify, 2, "les bandes en-tête/pied avertissent aussi l’aperçu");

      modal.select(role);
      const sizeInput = controls(modal.inspectorEl, "text")[0];
      await sizeInput.change("18");
      assert.equal(modal.styles[role].fontSizePt, 18);
      assert.equal(calls.frontmatter.length, 3);
      assert.equal(calls.notify, 3);
    });
  } finally {
    restoreSetting();
  }
});

test("LayoutModal — en-têtes, pieds, distances et espacements sont sauvegardés dans le V2, jamais dans settings.pdf…", async () => {
  const restoreSetting = installSettingStub();
  try {
    const { modal, settings, calls } = createModal();
    const pdfBefore = JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith("pdf"))));
    await modal.onOpen();

    modal.select("header");
    const headerTexts = controls(modal.inspectorEl, "text");
    // gauche, centre, droite, distance au bord, espace en-tête/corps
    assert.equal(headerTexts.length, 5, "les cinq champs d'en-tête sont présents");
    await headerTexts[1].change("{title} — {author}");
    assert.equal(modal.template.header.center, "{title} — {author}");
    await headerTexts[3].change("1.2");
    assert.equal(modal.template.header.distanceCm, 1.2);
    await headerTexts[4].change("6");
    assert.equal(modal.template.header.bodyGapPt, 6);

    modal.select("footer");
    const footerToggle = controls(modal.inspectorEl, "toggle")[0];
    await footerToggle.change(false);
    assert.equal(modal.template.footer.enabled, false);
    const footerTexts = controls(modal.inspectorEl, "text");
    // format du numéro, pied gauche, pied centre, distance, espace corps/pied
    assert.equal(footerTexts.length, 5);
    await footerTexts[1].change("Brouillon");
    assert.equal(modal.template.footer.left, "Brouillon");
    await footerTexts[2].change("{chapter}");
    assert.equal(modal.template.footer.center, "{chapter}");
    await footerTexts[3].change("1.5");
    assert.equal(modal.template.footer.distanceCm, 1.5);
    await footerTexts[4].change("9");
    assert.equal(modal.template.footer.bodyGapPt, 9);

    modal.select("firstPage");
    await controls(modal.inspectorEl, "toggle")[0].change(false);
    assert.equal(modal.template.firstPage.hideHeader, false);
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith("pdf")))), pdfBefore);
    assert.equal(calls.frontmatter.length > 0, true);
    const saved = calls.frontmatter.at(-1).frontmatter;
    assert.equal(saved.version, 2);
    assert.equal(saved.header.center, "{title} — {author}");
    assert.equal(saved.footer.left, "Brouillon");
    assert.equal(saved.firstPage.hideHeader, false);
    for (const legacy of ["indent", "indentPt", "paragraphSpacing", "paragraphSpacingPt", "marginCm", "pageOrientation", "chapterTitle", "pageNumbers", "pageNumberPosition"]) {
      assert.equal(legacy in saved, false, `${legacy} ne doit pas être réintroduit`);
    }
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
