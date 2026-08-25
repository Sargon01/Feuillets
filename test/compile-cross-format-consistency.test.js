import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { MarkdownRenderer, TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile } from "../src/services/compile-export.js";
import { exportDocx } from "../src/services/export-docx.js";
import { exportEpub } from "../src/services/export-epub.js";
import { exportOdt } from "../src/services/export-odt.js";
import { renderManuscriptHtml } from "../src/services/export-render.js";

/* Item 3 du chantier « Compilation professionnelle — Lot 1 » : DOCX et EPUB
 * partagent un seul pipeline de rendu (renderManuscriptHtml*, voir
 * export-render.js) — ce test vérifie CE FAIT structurellement plutôt que
 * de le supposer : les deux exports d'un même compile() doivent contenir
 * les mêmes titres de chapitre, le même texte de scène, et le même nombre
 * de notes de bas de page. Les différences de PRÉSENTATION (mise en page,
 * pagination) restent hors de portée ici — voir la matrice de capacités. */

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
  set textContent(value) {
    this.children = [];
    this._text = value;
  }
  get childNodes() {
    if (this.children.length) return this.children;
    if (this._text) return [{ nodeType: 3, nodeValue: this._text, textContent: this._text }];
    return [];
  }
  get nodeType() {
    return 1;
  }
  get attributes() {
    return Array.from(this._attributes, ([name, value]) => ({ name, value }));
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  get classList() {
    const self = this;
    return {
      contains: (name) => (self.getAttribute("class") || "").split(/\s+/).includes(name),
      add: (...names) => self.setAttribute("class", [...new Set(`${self.getAttribute("class") || ""} ${names.join(" ")}`.trim().split(/\s+/))].join(" ")),
      remove: (...names) => self.setAttribute("class", (self.getAttribute("class") || "").split(/\s+/).filter((name) => !names.includes(name)).join(" ")),
    };
  }
  get innerHTML() {
    if (!this.children.length) return this._text;
    return this.children.map((c) => c.outerHTML).join("");
  }
  get outerHTML() {
    const attrs = this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join("");
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
  setAttribute(name, value) {
    this._attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this._attributes.delete(name);
  }
  getAttribute(name) {
    return this._attributes.get(name) ?? null;
  }
  appendChild(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
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
  matches(selector) {
    const attribute = selector.match(/\[([^\]]+)\]$/);
    const base = attribute ? selector.slice(0, -attribute[0].length) : selector;
    if (attribute && !this._attributes.has(attribute[1])) return false;
    if (base === "*") return true;
    const [tag, ...classes] = base.split(".");
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const ownClasses = (this.className || "").split(/\s+/);
    return classes.every((name) => ownClasses.includes(name));
  }
  querySelectorAll(selectors) {
    const parts = selectors.split(",").map((s) => s.trim());
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.nodeType !== 1) continue;
        if (parts.some((selector) => child.matches(selector))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selectors) {
    return this.querySelectorAll(selectors)[0] || null;
  }
}

function text(value) {
  return {
    nodeType: 3,
    nodeValue: value,
    textContent: value,
    get outerHTML() {
      return value;
    },
    cloneNode() {
      return text(value);
    },
    remove() {},
  };
}

function el(tag, textContent, attributes = {}) {
  const result = new FakeElement(tag, textContent);
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  return result;
}

function mixed(tag, parts, attributes = {}) {
  const result = new FakeElement(tag, "");
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  result.children = parts.map((part) => (typeof part === "string" ? text(part) : part));
  return result;
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;
  const previousXMLSerializer = globalThis.XMLSerializer;
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;
  globalThis.document = { createElement: (tag) => el(tag) };
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.XMLSerializer = class {
    serializeToString(node) {
      return node && typeof node.outerHTML === "string" ? node.outerHTML : String(node?.textContent ?? "");
    }
  };
  // Fonctions globales autonomes createEl/createDiv d'Obsidian (nœud
  // détaché, non ajouté à un parent) — voir export-render.ts.
  globalThis.createEl = (tag, options = {}) => el(tag, options.text || "");
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  return () => {
    globalThis.document = previousDocument;
    globalThis.Node = previousNode;
    globalThis.XMLSerializer = previousXMLSerializer;
    globalThis.createEl = previousCreateEl;
    globalThis.createDiv = previousCreateDiv;
  };
}

function setRenderer(render) {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = render;
  return () => {
    MarkdownRenderer.render = previous;
  };
}

test("pipeline Document réel : une solution exclue disparaît après nettoyage Obsidian", async () => {
  const restoreDom = installDom();
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    assert.equal(markdown, "texte normal\n\n[!solution]\ntexte solution\n\ntexte normal");
    container.appendChild(el("p", "texte normal"));
    container.appendChild(el("div", "texte solution", { class: "callout", "data-callout": "solution" }));
    container.appendChild(el("p", "texte normal"));
  };
  try {
    const result = await renderManuscriptHtml({}, "texte normal\n\n[!solution]\ntexte solution\n\ntexte normal", "Feuillet.md", [], {
      id: "without-solution",
      name: "Sans solution",
      excludedRoles: ["solution"],
      questionAnswerSpace: "keep",
    });
    assert.deepEqual(result.containerEl.children.map((child) => child.textContent), ["texte normal", "texte normal"]);
    assert.equal(result.containerEl.textContent, "texte normaltexte normal");
  } finally {
    MarkdownRenderer.render = previous;
    restoreDom();
  }
});

/** Rendu markdown->DOM minimal mais fidèle : titres `# `, un appel/def de
 *  note par scène, reconnu par des marqueurs simples plutôt qu'un vrai
 *  parseur — suffisant puisque render() est stubé de toute façon dans ces
 *  tests (comme dans export-render.test.js et footnote-export.test.js). */
function fakeRender(markdown, container) {
  const blocks = markdown.split(/\n\n+/);
  let noteIndex = 0;
  for (const block of blocks) {
    if (/^\[\^\d+\]:/.test(block)) {
      noteIndex++;
      const noteText = block.replace(/^\[\^\d+\]:\s*/, "");
      const section = container.children.find((c) => c.tagName === "SECTION") || (() => {
        const s = el("section", "", { class: "footnotes" });
        s.children = [el("ol")];
        container.appendChild(s);
        return s;
      })();
      const ol = section.children[0];
      const backref = el("a", "↩", { class: "footnote-backref", href: `#fnref${noteIndex}` });
      ol.appendChild(mixed("li", [`${noteText} `, backref], { id: `fn${noteIndex}` }));
      continue;
    }
    const headingMatch = block.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      container.appendChild(el(`h${headingMatch[1].length}`, headingMatch[2]));
      continue;
    }
    const noteRefMatch = block.match(/\[\^(\d+)\]/);
    if (noteRefMatch) {
      const [whole, n] = noteRefMatch;
      const [before, after] = [block.slice(0, noteRefMatch.index), block.slice(noteRefMatch.index + whole.length)];
      const sup = mixed("sup", [el("a", n, { href: `#fn${n}` })], { class: "footnote-ref" });
      container.appendChild(mixed("p", [before, sup, after]));
      continue;
    }
    container.appendChild(el("p", block));
  }
}

function fakeRenderWithCallouts(markdown, container) {
  for (const block of markdown.split(/\n\n+/)) {
    const callout = block.match(/^> \[!([\w-]+)\]\n(?:> ?.*\n?)+$/);
    if (callout) {
      const body = block.split("\n").slice(1).map((line) => line.replace(/^> ?/, "")).join("\n");
      container.appendChild(el("div", body, { class: "callout", "data-callout": callout[1] }));
    } else if (block.trim()) {
      container.appendChild(el("p", block));
    }
  }
}

test("collection réelle : le manuscrit dérivé commun est utilisé par DOCX, ODT et EPUB", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, markdown, container) => fakeRender(markdown, container));
  try {
    const volume = new TFolder("Collection");
    const manuscript = new TFolder("Collection/Manuscrit");
    const scene = new TFile("Collection/Manuscrit/Scène.md", "Texte extérieur.\n\n> [!definition]\n> Définition.\n\n> [!preuve]\n> Preuve.\n\n> [!source]\n> Source.");
    volume.children = [manuscript]; manuscript.parent = volume;
    manuscript.children = [scene]; scene.parent = manuscript;
    const { vault } = createFakeVault([volume, manuscript, scene]);
    vault.cachedRead = vault.read;
    const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
    const settings = {
      projectFolder: manuscript.path, level1Role: "chapitres", orders: {}, compileFileName: "Collection.md",
      insertFolderTitles: false, insertTitles: false, insertSceneTitles: false, separator: "\n\n",
      activePreset: -1, compilePresets: [], exportFrenchTypography: false,
    };
    const result = await compile(app, settings, null, null, null, {
      writeOutput: false,
      contentCollection: { id: "defs-sources", name: "Définitions et sources", roles: ["definition", "source"] },
    });
    assert.ok(result);
    assert.doesNotMatch(result.manuscript, /Texte extérieur|Preuve/);
    assert.match(result.manuscript, /Définition|Source/);
    const input = { markdown: result.manuscript, title: "Collection", author: "", sourcePath: result.outPath, segments: result.segments };
    const docx = await exportDocx(app, settings, input);
    const odt = await exportOdt(app, settings, input);
    const epub = await exportEpub(app, settings, input);
    const docxXml = await (await JSZip.loadAsync(docx)).file("word/document.xml").async("string");
    const odtXml = await (await JSZip.loadAsync(odt)).file("content.xml").async("string");
    const epubXml = await (await JSZip.loadAsync(epub)).file("OEBPS/chapitres.xhtml").async("string");
    for (const output of [docxXml, odtXml, epubXml]) {
      assert.match(output, /Définition/);
      assert.match(output, /Source/);
      assert.doesNotMatch(output, /Preuve|Texte extérieur/);
    }
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("collection + variante réelle : exclure source conserve seulement definition", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, markdown, container) => fakeRenderWithCallouts(markdown, container));
  try {
    const scene = new TFile("Variante/Manuscrit/Scène.md", "Texte ordinaire.\n\n> [!definition]\n> Définition.\n\n> [!preuve]\n> Preuve.\n\n> [!source]\n> Source.");
    const manuscript = new TFolder("Variante/Manuscrit");
    const volume = new TFolder("Variante");
    volume.children = [manuscript]; manuscript.parent = volume; manuscript.children = [scene]; scene.parent = manuscript;
    const { vault } = createFakeVault([volume, manuscript, scene]); vault.cachedRead = vault.read;
    const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
    const settings = { projectFolder: manuscript.path, level1Role: "chapitres", orders: {}, compileFileName: "Variante.md", insertFolderTitles: false, insertTitles: false, insertSceneTitles: false, separator: "\n\n", activePreset: -1, compilePresets: [], exportFrenchTypography: false };
    const result = await compile(app, settings, null, null, null, { writeOutput: false, contentCollection: { id: "defs-sources", name: "Définitions et sources", roles: ["definition", "source"] } });
    assert.ok(result);
    const variant = { id: "without-source", name: "Sans source", excludedRoles: ["source"], questionAnswerSpace: "keep" };
    const input = { markdown: result.manuscript, title: "Variante", author: "", sourcePath: result.outPath, segments: result.segments, contentVariant: variant };
    const epub = await exportEpub(app, settings, input);
    const epubXml = await (await JSZip.loadAsync(epub)).file("OEBPS/chapitres.xhtml").async("string");
    assert.match(epubXml, /Définition/);
    assert.doesNotMatch(epubXml, /Source|Preuve|Texte ordinaire/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("compile -> DOCX et EPUB : mêmes titres de chapitre, même texte, même nombre de notes", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, markdown, container) => fakeRender(markdown, container));
  try {
    const volume = new TFolder("Roman");
    const manuscript = new TFolder("Roman/Manuscrit");
    const chap1 = new TFolder("Roman/Manuscrit/Chapitre 1");
    const chap2 = new TFolder("Roman/Manuscrit/Chapitre 2");
    const scene1 = new TFile(
      "Roman/Manuscrit/Chapitre 1/Scène 1.md",
      "---\ntitle: Départ\n---\nUn fait notable[^1].\n\n[^1]: Source du fait."
    );
    const scene2 = new TFile("Roman/Manuscrit/Chapitre 2/Scène 1.md", "---\ntitle: Suite\n---\nDeuxième texte.");
    volume.children = [manuscript];
    manuscript.parent = volume;
    manuscript.children = [chap1, chap2];
    chap1.parent = manuscript;
    chap2.parent = manuscript;
    chap1.children = [scene1];
    chap2.children = [scene2];
    scene1.parent = chap1;
    scene2.parent = chap2;

    const { vault } = createFakeVault([volume, manuscript, chap1, chap2, scene1, scene2]);
    vault.cachedRead = vault.read;
    const frontmatter = new Map([
      [scene1.path, { title: "Départ", compile: true }],
      [scene2.path, { title: "Suite", compile: true }],
    ]);
    const app = { vault, metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) } };
    const settings = {
      projectFolder: manuscript.path,
      level1Role: "chapitres",
      orders: { [manuscript.path]: [chap1.name, chap2.name] },
      folderPositions: {},
      compileFileName: "Manuscrit.md",
      insertFolderTitles: false,
      insertTitles: true,
      insertSceneTitles: false,
      separator: "\n\n",
      activePreset: -1,
      compilePresets: [],
      exportFrenchTypography: false,
    };

    const result = await compile(app, settings);
    assert.ok(result);

    const ctx = {
      markdown: result.manuscript,
      title: "Mon roman",
      author: "Autrice",
      sourcePath: result.outPath,
      segments: result.segments,
    };

    const docxBytes = await exportDocx(app, settings, ctx);
    const epubBytes = await exportEpub(app, settings, ctx);

    const docxZip = await JSZip.loadAsync(docxBytes);
    const documentXml = await docxZip.file("word/document.xml").async("string");
    const footnotesXml = (await docxZip.file("word/footnotes.xml")?.async("string")) || "";

    const epubZip = await JSZip.loadAsync(epubBytes);
    const chapterXhtml = await epubZip.file("OEBPS/chapitres.xhtml").async("string");

    // Mêmes titres de chapitre dans les deux formats (insertTitles: true
    // insère le nom du dossier-chapitre comme titre — "Chapitre 1"/"2").
    for (const chapterTitle of ["Chapitre 1", "Chapitre 2"]) {
      assert.match(documentXml, new RegExp(chapterTitle), `DOCX doit contenir "${chapterTitle}"`);
      assert.match(chapterXhtml, new RegExp(chapterTitle), `EPUB doit contenir "${chapterTitle}"`);
    }
    // Même texte de scène dans les deux formats.
    for (const bodyText of ["Un fait notable", "Deuxième texte"]) {
      assert.match(documentXml, new RegExp(bodyText));
      assert.match(chapterXhtml, new RegExp(bodyText));
    }
    // Même nombre de notes : une vraie référence Word, un <li> EPUB.
    const docxRefCount = (documentXml.match(/<w:footnoteReference/g) || []).length;
    const epubNoteCount = (chapterXhtml.match(/<li id="fn\d+"/g) || []).length;
    assert.equal(docxRefCount, 1);
    assert.equal(epubNoteCount, 1);
    assert.match(footnotesXml, /Source du fait/);
    assert.match(chapterXhtml, /Source du fait/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});
