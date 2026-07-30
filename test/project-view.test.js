import assert from "node:assert/strict";
import test from "node:test";
import { Notice, Platform, TFolder } from "obsidian";
import { EXPORT_TEMPLATES } from "../src/utils/export-templates.js";
import { LayoutModal } from "../src/ui/layout-modal.js";
import { CompileSelectionModal } from "../src/ui/selection-modals.js";
import { ProjectView } from "../src/views/project-view.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    this.children.push(child);
    return child;
  }

  createDiv(options = {}) {
    return this.createEl("div", options);
  }

  createSpan(options = {}) {
    return this.createEl("span", options);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addClass(classNames) {
    for (const className of classNames.split(" ")) this.classes.add(className);
  }

  addEventListener(type, callback) {
    this.events.set(type, callback);
  }

  empty() {
    this.children = [];
  }

  setText(text) {
    this.text = String(text);
    return this;
  }
}

function allElements(element) {
  return [element, ...element.children.flatMap(allElements)];
}

function createView({ root = new TFolder("Projet"), exportFormat = "docx" } = {}) {
  const contentEl = new FakeElement();
  const settings = { exportFormat };
  const calls = { save: 0, compile: 0, export: [] };
  const app = { vault: { getAbstractFileByPath: () => null } };
  const plugin = {
    settings,
    getProjectFolder: () => root,
    async saveSettings() { calls.save += 1; },
    compile() { calls.compile += 1; },
    exportFile(format) { calls.export.push(format); },
  };
  const view = new ProjectView({ app, contentEl }, plugin);
  view.renderSectionHead = (section, _icon, _title, _namespace, _key, renderActions) => {
    renderActions(section.createDiv());
    return false;
  };
  view.iconBtn = (parent, _icon, _title, onClick) => {
    const button = parent.createEl("button");
    button.addEventListener("click", onClick);
    return button;
  };
  return { view, contentEl, settings, calls };
}

async function withFakeDocument(run) {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag, options) => new FakeElement(tag, options) };
  try {
    await run();
  } finally {
    globalThis.document = previousDocument;
  }
}

test("ProjectView affiche uniquement l'état vide sans projet actif", async () => {
  const { view, contentEl } = createView({ root: null });

  await view.render();

  assert.equal(contentEl.children.length, 1);
  assert.equal(contentEl.children[0].classes.has("feuillets-empty"), true);
});

test("ProjectView affiche la section de compilation avec un projet actif", async () => {
  await withFakeDocument(async () => {
    const { view, contentEl } = createView();
    await view.render();

    assert.equal(allElements(contentEl).some((element) => element.classes.has("feuillets-project-section")), true);
  });
});

test("ProjectView enregistre le format sélectionné", async () => {
  await withFakeDocument(async () => {
    const { view, contentEl, settings, calls } = createView();
    await view.render();
    const formatSelect = allElements(contentEl).find((element) => element.tag === "select");
    formatSelect.value = "epub";

    await formatSelect.events.get("change")();

    assert.equal(settings.exportFormat, "epub");
    assert.equal(calls.save, 1);
  });
});

test("ProjectView ne propose pas le PDF sur mobile", async () => {
  const previousMobile = Platform.isMobile;
  Platform.isMobile = true;
  try {
    await withFakeDocument(async () => {
      const { view, contentEl } = createView();
      await view.render();
      const formatSelect = allElements(contentEl).find((element) => element.tag === "select");
      assert.equal(formatSelect.children.some((option) => option.value === "pdf"), false);
    });
  } finally {
    Platform.isMobile = previousMobile;
  }
});

test("ProjectView compile en Markdown et délègue les autres formats", async () => {
  await withFakeDocument(async () => {
    for (const format of ["md", "docx", "odt", "epub", "pdf"]) {
      const { view, contentEl, calls } = createView({ exportFormat: format });
      await view.render();
      const exportButton = allElements(contentEl).find((element) => element.classes.has("feuillets-export-cta-btn"));
      exportButton.events.get("click")();

      if (format === "md") {
        assert.equal(calls.compile, 1);
        assert.deepEqual(calls.export, []);
      } else {
        assert.equal(calls.compile, 0);
        assert.deepEqual(calls.export, [format]);
      }
    }
  });
});

test("ProjectView notifie sans ouvrir LayoutModal lorsqu'aucun modèle n'est disponible", async () => {
  const savedTemplates = { ...EXPORT_TEMPLATES };
  const originalOpen = LayoutModal.prototype.open;
  const notices = [];
  let layoutOpened = false;
  for (const key of Object.keys(EXPORT_TEMPLATES)) delete EXPORT_TEMPLATES[key];
  LayoutModal.prototype.open = () => { layoutOpened = true; };
  Notice.onCreate = (message) => notices.push(message);

  try {
    await withFakeDocument(async () => {
      const { view, contentEl } = createView();
      await view.render();
      const layoutRow = allElements(contentEl).find((element) => element.classes.has("feuillets-project-row"));
      layoutRow.events.get("click")();
    });
  } finally {
    Object.assign(EXPORT_TEMPLATES, savedTemplates);
    LayoutModal.prototype.open = originalOpen;
    Notice.onCreate = null;
  }

  assert.equal(layoutOpened, false);
  assert.equal(notices.length, 1);
});

test("ProjectView ouvre la sélection des feuillets sans modifier les réglages", async () => {
  const originalOpen = CompileSelectionModal.prototype.open;
  let opened = 0;
  CompileSelectionModal.prototype.open = () => { opened += 1; };

  try {
    await withFakeDocument(async () => {
      const { view, contentEl, settings, calls } = createView({ exportFormat: "odt" });
      await view.render();
      const selectionButton = allElements(contentEl).find((element) => element.tag === "button" && !element.classes.has("feuillets-export-cta-btn"));
      selectionButton.events.get("click")();

      assert.equal(settings.exportFormat, "odt");
      assert.equal(calls.save, 0);
    });
  } finally {
    CompileSelectionModal.prototype.open = originalOpen;
  }

  assert.equal(opened, 1);
});
