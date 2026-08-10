import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, MarkdownRenderer, Platform } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  rememberExportScope,
  currentExportScope,
  exportBaseName,
  runExportWorkflow,
} from "../src/services/export-workflow.js";
import { createFileScope, createFolderScope, createSelectionScope, createProjectScope } from "../src/services/compile-scope.js";

/** Petit projet minimal — un feuillet, une page de titre — suffisant pour
 * que compile()/exportViaNative produisent réellement un fichier de sortie,
 * exactement comme test/compile-export.test.js. */
function buildProject() {
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const scene = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "---\ntitle: Départ\n---\nTexte.");
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [scene];
  scene.parent = chapter;

  const { vault, fileManager } = createFakeVault([manuscript, chapter, scene]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([[scene.path, { title: "Départ", compile: true }]]);
  const app = {
    vault,
    fileManager,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatter.get(file.path) || {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: [chapter.name] },
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    exportTemplate: "classique",
    projectMeta: {},
    manuscriptTitle: "",
    manuscriptAuthor: "",
  };
  return { app, settings, manuscript, chapter, scene };
}

function fakePlugin(app, settings, projectFolder) {
  return {
    settings,
    activeExportScope: null,
    getProjectFolder() {
      return app.vault.getAbstractFileByPath(projectFolder) || null;
    },
  };
}

test("currentExportScope : aucun projet actif → null", () => {
  const { settings } = buildProject();
  const plugin = fakePlugin({ vault: { getAbstractFileByPath: () => null } }, settings, "Projet/Manuscrit");
  assert.equal(currentExportScope(plugin), null);
});

test("currentExportScope : sans portée de session mémorisée → portée Projet entier", () => {
  const { app, settings, manuscript } = buildProject();
  const plugin = fakePlugin(app, settings, manuscript.path);
  const scope = currentExportScope(plugin);
  assert.deepEqual(scope, { type: "project", projectRoot: manuscript.path });
  // La portée retournée doit avoir été mémorisée sur le plugin.
  assert.deepEqual(plugin.activeExportScope, scope);
});

test("currentExportScope : mémorisation d'une portée fichier, réutilisée telle quelle", () => {
  const { app, settings, manuscript, scene } = buildProject();
  const plugin = fakePlugin(app, settings, manuscript.path);
  const fileScope = createFileScope(manuscript.path, scene.path);
  rememberExportScope(plugin, fileScope);
  assert.deepEqual(currentExportScope(plugin), fileScope);
});

test("currentExportScope : mémorisation d'une portée dossier, réutilisée telle quelle", () => {
  const { app, settings, manuscript, chapter } = buildProject();
  const plugin = fakePlugin(app, settings, manuscript.path);
  const folderScope = createFolderScope(manuscript.path, chapter.path);
  rememberExportScope(plugin, folderScope);
  assert.deepEqual(currentExportScope(plugin), folderScope);
});

test("currentExportScope : mémorisation d'une portée sélection, réutilisée telle quelle", () => {
  const { app, settings, manuscript, scene } = buildProject();
  const plugin = fakePlugin(app, settings, manuscript.path);
  const selectionScope = createSelectionScope(manuscript.path, [scene.path]);
  rememberExportScope(plugin, selectionScope);
  assert.deepEqual(currentExportScope(plugin), selectionScope);
});

test("currentExportScope : changement de projectRoot → l'ancienne portée de session est ignorée", () => {
  const { app, settings, manuscript, scene } = buildProject();
  const plugin = fakePlugin(app, settings, manuscript.path);
  // Portée mémorisée pour un AUTRE projet.
  rememberExportScope(plugin, createFileScope("Ancien/Projet", scene.path));
  const scope = currentExportScope(plugin);
  assert.equal(scope.type, "project");
  assert.equal(scope.projectRoot, manuscript.path);
});

test("exportBaseName : utilise le preset actif (activePresetConfig), pas une seconde logique", () => {
  const { settings } = buildProject();
  settings.compilePresets = [{ fileName: "Sous-titre.md" }];
  settings.activePreset = 0;
  assert.equal(exportBaseName(settings), "Sous-titre");
});

test("exportBaseName : repli sur Manuscrit sans preset ni compileFileName", () => {
  const { settings } = buildProject();
  settings.compilePresets = [];
  settings.activePreset = -1;
  delete settings.compileFileName;
  assert.equal(exportBaseName(settings), "Manuscrit");
});

test("runExportWorkflow : conserve scope/format/baseName explicites et mémorise la portée utilisée", async () => {
  const { app, settings, manuscript } = buildProject();
  const plugin = fakePlugin(app, settings, manuscript.path);
  const scope = createProjectScope(manuscript.path);

  const outPath = await runExportWorkflow(app, plugin, scope, "md", "MonExport");

  assert.match(outPath, /MonExport\.md$/);
  assert.deepEqual(plugin.activeExportScope, scope);
  const written = app.vault.getAbstractFileByPath(outPath);
  assert.ok(written, "le fichier compilé doit exister dans le coffre");
});

test("runExportWorkflow : sans argument, retombe sur currentExportScope/settings.exportFormat/exportBaseName", async () => {
  const { app, settings, manuscript } = buildProject();
  settings.exportFormat = "md";
  const plugin = fakePlugin(app, settings, manuscript.path);

  const outPath = await runExportWorkflow(app, plugin);

  assert.match(outPath, /Manuscrit\.md$/);
  assert.deepEqual(plugin.activeExportScope, { type: "project", projectRoot: manuscript.path });
});

/* docx utilise container.children (installMinimalPrintDom suffit, comme pour
   pdf) ; odt/epub lisent container.childNodes et sérialisent via
   XMLSerializer — même petit DOM que test/export-odt.test.js et
   test/export-epub.test.js (convention du dépôt : dupliqué, pas partagé). */
const DOM_INSTALLERS = {
  md: null,
  docx: installMinimalPrintDom,
  odt: installChildNodesDom,
  epub: installChildNodesDom,
};

for (const format of ["md", "docx", "odt", "epub"]) {
  test(`runExportWorkflow : accepte le format ${format}`, async () => {
    const { app, settings, manuscript } = buildProject();
    const plugin = fakePlugin(app, settings, manuscript.path);
    const scope = createProjectScope(manuscript.path);

    const dom = DOM_INSTALLERS[format]?.();
    try {
      const outPath = await runExportWorkflow(app, plugin, scope, format, "Export");
      assert.match(outPath, new RegExp(`Export\\.${format}$`));
    } finally {
      dom?.restore();
    }
  });
}

/** DOM minimal pour odt/epub (services/export-odt.ts, export-epub.ts) :
 * `childNodes`/`nodeType`, un global `Node` et un `XMLSerializer` — jamais
 * requis par docx (qui lit `.children`) ni par md (aucun rendu HTML). */
function installChildNodesDom() {
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;
  const previousXMLSerializer = globalThis.XMLSerializer;
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;

  class FakeElement {
    constructor(tagName, text = "") {
      this.tagName = tagName.toUpperCase();
      this._text = text;
      this.parentElement = null;
      this.children = [];
      this._attributes = new Map();
    }
    get textContent() {
      return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text;
    }
    get childNodes() {
      if (this.children.length) return this.children;
      if (this._text) return [{ nodeType: 3, nodeValue: this._text, textContent: this._text }];
      return [];
    }
    get nodeType() { return 1; }
    get attributes() { return Array.from(this._attributes, ([name, value]) => ({ name, value })); }
    get className() { return this.getAttribute("class") || ""; }
    get classList() {
      const self = this;
      return { contains: (name) => (self.getAttribute("class") || "").split(/\s+/).includes(name) };
    }
    get innerHTML() {
      if (!this.children.length) return this._text;
      return this.children.map((c) => c.outerHTML).join("");
    }
    get outerHTML() {
      const attrs = this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join("");
      return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
    }
    setAttribute(name, value) { this._attributes.set(name, String(value)); }
    getAttribute(name) { return this._attributes.get(name) ?? null; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
    remove() {
      if (!this.parentElement) return;
      const i = this.parentElement.children.indexOf(this);
      if (i >= 0) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    }
    cloneNode(deep) {
      const clone = new FakeElement(this.tagName, this._text);
      for (const { name, value } of this.attributes) clone.setAttribute(name, value);
      if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
      return clone;
    }
    querySelectorAll() { return []; }
    querySelector() { return null; }
  }

  const el = (tag, text) => new FakeElement(tag, text);
  globalThis.document = { createElement: (tag) => el(tag) };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class {
    serializeToString(node) {
      return node && typeof node.outerHTML === "string" ? node.outerHTML : String(node?.textContent ?? "");
    }
  };
  globalThis.createEl = (tag, options = {}) => el(tag, options.text || "");
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);

  return {
    restore() {
      globalThis.document = previousDocument;
      globalThis.Node = previousNode;
      globalThis.XMLSerializer = previousXMLSerializer;
      globalThis.createEl = previousCreateEl;
      globalThis.createDiv = previousCreateDiv;
    },
  };
}

test("runExportWorkflow : accepte le format pdf (imprime via une iframe, même moteur que l'aperçu)", async () => {
  const { app, settings, manuscript } = buildProject();
  const plugin = fakePlugin(app, settings, manuscript.path);
  const scope = createProjectScope(manuscript.path);

  const previousMobile = Platform.isMobile;
  const previousRender = MarkdownRenderer.render;
  const dom = installMinimalPrintDom();
  Platform.isMobile = false;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.appendChild(dom.makeEl("p", "Corps"));
  };
  try {
    await runExportWorkflow(app, plugin, scope, "pdf", "Export");
    assert.equal(dom.frames.length, 1, "l'export PDF doit avoir imprimé via une iframe");
  } finally {
    Platform.isMobile = previousMobile;
    MarkdownRenderer.render = previousRender;
    dom.restore();
  }
});

/** Environnement d'impression minimal — juste assez pour que exportPdf()
 * (services/export-pdf.ts, moteur INCHANGÉ dans cette phase) construise son
 * iframe sans lever d'exception. Volontairement réduit par rapport au
 * harnais complet de test/export-pdf.test.js : ce test ne vérifie QUE le
 * branchement du format "pdf" par runExportWorkflow, pas la pagination. */
function installMinimalPrintDom() {
  const previousDocument = globalThis.document;
  const previousParser = globalThis.DOMParser;
  const previousWindow = globalThis.window;
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;
  const previousCreateSpan = globalThis.createSpan;

  class FakeElement {
    constructor(tagName, text = "") {
      this.tagName = tagName.toUpperCase();
      this._text = text;
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.classes = new Set();
      this.offsetHeight = 30;
      this.classList = { contains: (name) => this.classes.has(name) };
      this._attributes = new Map();
      if (this.tagName === "IFRAME") {
        this.contentDocument = {
          documentElement: null,
          head: null,
          body: null,
          createElement: (tag) => new FakeElement(tag),
          importNode(node) { return node; },
          open() { this.documentElement = null; this.head = null; this.body = null; },
          close() {},
          replaceChildren(htmlEl) {
            this.documentElement = htmlEl;
            this.head = htmlEl.children.find((c) => c.tagName === "HEAD") || null;
            this.body = htmlEl.children.find((c) => c.tagName === "BODY") || null;
          },
        };
        this.contentWindow = { focus() {}, print() {} };
        frames.push(this);
      }
    }
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
    set textContent(value) { this.children = []; this._text = value; }
    get className() { return [...this.classes].join(" "); }
    set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
    get innerHTML() { return this._rawHtml !== undefined ? this._rawHtml : (this.children.length ? this.children.map((c) => c.outerHTML).join("") : this._text); }
    set innerHTML(value) { this._rawHtml = value; this.children = []; }
    get outerHTML() {
      const classAttr = this.classes.size ? ` class="${this.className}"` : "";
      return `<${this.tagName.toLowerCase()}${classAttr}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
    }
    addClass(name) { this.classes.add(name); }
    setAttribute(name, value) { this._attributes.set(name, String(value)); }
    getAttribute(name) { return this._attributes.get(name) ?? null; }
    createEl(tag, options = {}) { const child = new FakeElement(tag, options.text || ""); if (options.cls) child.className = options.cls; return this.appendChild(child); }
    createDiv(options = {}) { return this.createEl("div", options); }
    createSpan(options = {}) { return this.createEl("span", options); }
    appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
    prepend(child) { child.remove(); child.parentNode = this; this.children.unshift(child); }
    after(child) { const parent = this.parentNode; const index = parent.children.indexOf(this); child.remove(); child.parentNode = parent; parent.children.splice(index + 1, 0, child); }
    removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) { this.children.splice(index, 1); child.parentNode = null; } return child; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    cloneNode(deep) { const clone = new FakeElement(this.tagName, this._text); clone.className = this.className; clone.offsetHeight = this.offsetHeight; if (deep) for (const c of this.children) clone.appendChild(c.cloneNode(true)); return clone; }
    querySelector(selector) {
      if (/^[a-z]+$/i.test(selector)) {
        const tag = selector.toUpperCase();
        for (const child of this.children) {
          if (child.tagName === tag) return child;
          const found = child.querySelector(selector);
          if (found) return found;
        }
      }
      return null;
    }
    querySelectorAll() { return []; }
  }
  class RawNode extends FakeElement {
    constructor(html) { super("span"); this.html = html; }
    get outerHTML() { return this.html; }
    cloneNode() { return new RawNode(this.html); }
  }

  const frames = [];
  const body = new FakeElement("body");
  body.contains = (node) => body.children.includes(node);
  globalThis.document = { body, createElement: (tag) => new FakeElement(tag) };
  globalThis.DOMParser = class {
    parseFromString(html) {
      if (/^<html>/.test(html)) {
        const htmlEl = new FakeElement("html");
        const headEl = new FakeElement("head");
        const bodyEl = new FakeElement("body");
        htmlEl.appendChild(headEl);
        htmlEl.appendChild(bodyEl);
        const metaEl = new FakeElement("meta");
        metaEl.setAttribute("charset", "utf-8");
        headEl.appendChild(metaEl);
        headEl.appendChild(new FakeElement("title"));
        headEl.appendChild(new FakeElement("style"));
        return { documentElement: htmlEl, body: bodyEl };
      }
      const bodyEl = new FakeElement("body");
      bodyEl.appendChild(new RawNode(html));
      return { body: bodyEl };
    }
  };
  globalThis.window = { setTimeout(callback) { callback(); return 0; } };
  globalThis.createEl = (tag, options = {}) => { const el = new FakeElement(tag, options.text || ""); if (options.cls) el.className = options.cls; return el; };
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);

  return {
    frames,
    makeEl: (tag, text) => new FakeElement(tag, text),
    restore() {
      globalThis.document = previousDocument;
      globalThis.DOMParser = previousParser;
      globalThis.window = previousWindow;
      globalThis.createEl = previousCreateEl;
      globalThis.createDiv = previousCreateDiv;
      globalThis.createSpan = previousCreateSpan;
    },
  };
}
