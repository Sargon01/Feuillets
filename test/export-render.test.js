import { test } from "node:test";
import assert from "node:assert/strict";
import { Component, MarkdownRenderer, Notice } from "obsidian";
import {
  preserveBlankLinesForFrontPage,
  composeDocumentMedia,
  renderManuscriptHtml,
  renderManuscriptHtmlWithFrontPages,
} from "../src/services/export-render.js";
import { applyPedagogicalSemantics, PEDAGOGICAL_ROLE_ICON } from "../src/utils/pedagogical-roles.js";
import { applyFeuilletsDirectiveMarkers } from "../src/utils/feuillets-directives.js";

class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.parentElement = null;
    this.children = [];
    this._attributes = new Map();
    this.classList = {
      add: (...names) => this.className = `${this.className} ${names.join(" ")}`.trim(),
      contains: (name) => this.className.split(/\s+/).includes(name),
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
    };
  }

  get textContent() {
    return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text;
  }

  get ownerDocument() {
    return globalThis.document;
  }

  set textContent(value) {
    this.children = [];
    this._text = value;
  }

  get attributes() {
    return Array.from(this._attributes, ([name, value]) => ({ name, value }));
  }

  get className() {
    return this.getAttribute("class") || "";
  }

  set className(value) {
    this.setAttribute("class", value);
  }

  get innerHTML() {
    if (!this.children.length) return this._text;
    return this.children.map((child) => child.outerHTML).join("");
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }

  get outerHTML() {
    const attrs = this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join("");
    return `<${this.tagName.toLowerCase()}${attrs}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }

  setAttribute(name, value) {
    this._attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this._attributes.get(name) || null;
  }

  removeAttribute(name) {
    this._attributes.delete(name);
  }

  appendChild(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.remove();
    child.parentElement = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }

  /* Sous-ensemble minimal du helper Obsidian réel (Node#createSpan) — voir
     src/utils/pedagogical-roles.ts (applyRoleMarkerIcon), seul consommateur
     dans ce fichier de test. */
  createSpan(o = {}) {
    const span = new FakeElement("span");
    if (o.cls) span.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
    if (o.attr) for (const [name, value] of Object.entries(o.attr)) span.setAttribute(name, value);
    if (o.prepend) this.insertBefore(span, this.children[0] || null);
    else this.appendChild(span);
    return span;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  replaceWith(replacement) {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    this.parentElement = null;
    replacement.remove();
    replacement.parentElement = parent;
    parent.children[index] = replacement;
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
    const parts = selectors.split(",").map((selector) => selector.trim());
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
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

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
}

function element(tag, text, attributes = {}) {
  const result = new FakeElement(tag, text);
  for (const [name, value] of Object.entries(attributes)) result.setAttribute(name, value);
  return result;
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const previousCreateEl = globalThis.createEl;
  const previousCreateDiv = globalThis.createDiv;
  const previousCreateSpan = globalThis.createSpan;
  globalThis.document = {
    createElement: (tag) => element(tag),
    createTreeWalker: (root) => {
      const nodes = [];
      const visit = (node) => {
        if (node._text) {
          nodes.push({
            parentElement: node,
            get nodeValue() { return node._text; },
            set nodeValue(value) { node._text = value || ""; },
          });
        }
        node.children.forEach(visit);
      };
      visit(root);
      let index = 0;
      return { nextNode: () => nodes[index++] || null };
    },
  };
  globalThis.Image = class {
    naturalWidth = 640;
    naturalHeight = 480;
    set src(_value) { queueMicrotask(() => this.onload()); }
  };
  // Fonctions globales autonomes createEl/createDiv d'Obsidian (nœud
  // détaché, non ajouté à un parent) — voir export-render.ts.
  globalThis.createEl = (tag, options = {}) => { const el = element(tag, options.text || ""); if (options.cls) el.className = options.cls; return el; };
  globalThis.createDiv = (options = {}) => { const el = globalThis.createEl("div", options); if (options.cls) el.className = options.cls; return el; };
  globalThis.createSpan = (options = {}) => { const el = globalThis.createEl("span", options); if (options.cls) el.className = options.cls; return el; };
  return () => {
    globalThis.document = previousDocument;
    globalThis.Image = previousImage;
    globalThis.createEl = previousCreateEl;
    globalThis.createDiv = previousCreateDiv;
    globalThis.createSpan = previousCreateSpan;
  };
}

function fakeApp(files = []) {
  return {
    metadataCache: { getFirstLinkpathDest: (linkpath) => files.find((file) => file.path === linkpath) || null },
    vault: {
      getFiles: () => files,
      readBinary: async (file) => file.bytes,
    },
  };
}

function setRenderer(render) {
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = render;
  return () => { MarkdownRenderer.render = previousRender; };
}

test("composeDocumentMedia : une image portrait rassemble paragraphe et liste dans le contenu latéral", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p");
    const image = element("img");
    imageBlock.appendChild(image);
    const paragraph = element("p", "Présentation");
    const list = element("ul", "Question 1");
    container.appendChild(imageBlock);
    container.appendChild(paragraph);
    container.appendChild(list);

    composeDocumentMedia(container, new Map([[image, { width: 300, height: 500 }]]));

    const media = container.children[0];
    assert.match(media.className, /feuillets-doc-media-block/);
    assert.match(media.className, /feuillets-doc-media-portrait/);
    assert.equal(media.children[0].className, "feuillets-doc-media-figure");
    assert.equal(media.children[0].children[0], imageBlock);
    assert.equal(media.children[1].className, "feuillets-doc-media-content");
    assert.deepEqual(media.children[1].children, [paragraph, list]);
    assert.doesNotMatch(media.className, /portrait-flow/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : média + rôle pédagogique forme une paire côte à côte", () => {
  const restoreDom = installDom();
  try {
    const container = element("div"); const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
    const role = element("div", "Question", { class: "feuillets-pedagogical-role feuillets-role-questions" });
    container.appendChild(imageBlock); container.appendChild(role);
    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));
    assert.equal(container.children.length, 1); assert.match(container.children[0].className, /feuillets-document-media-role-pair-side/);
    assert.equal(container.children[0].children[0].className.includes("feuillets-doc-media-block"), true); assert.equal(container.children[0].children[1], role);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : le rôle document AVANT une image n'entre pas dans le pairing média automatique", () => {
  const restoreDom = installDom();
  try {
    // > [!document] Figure 1 — Carte
    // ![[carte.png]]
    const container = element("div");
    const role = element("div", "Figure 1 — Carte", { class: "feuillets-pedagogical-role feuillets-role-document" });
    const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
    container.appendChild(role); container.appendChild(imageBlock);
    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));
    // Le pairing existant n'associe qu'une image SUIVIE d'un rôle (ordre
    // image -> marqueur) — ici l'ordre est inversé (marqueur -> image),
    // donc aucun pairing, quel que soit le rôle. Repère puis image normale.
    assert.equal(container.children.length, 2);
    assert.equal(container.children[0], role);
    assert.equal(container.children[0].className.includes("feuillets-document-media-role-pair"), false);
    assert.equal(container.children[1].className.includes("feuillets-doc-media-block"), true);
    assert.equal(container.children[1].className.includes("feuillets-document-media-role-pair"), false);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : directive dessous force la paire empilée et disparaît", () => {
  const restoreDom = installDom();
  try {
    const container = element("div"); const imageBlock = element("p", "", { class: "feuillets-directive-dessous" }); const image = element("img"); imageBlock.appendChild(image);
    const role = element("div", "Question", { class: "feuillets-pedagogical-role feuillets-role-questions" });
    container.appendChild(imageBlock); container.appendChild(role);
    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));
    assert.match(container.children[0].className, /feuillets-document-media-role-pair-stacked/); assert.doesNotMatch(container.children[0].innerHTML, /directive-dessous/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : média + warning ne forme pas de paire", () => {
  const restoreDom = installDom();
  try {
    const container = element("div"); const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
    container.appendChild(imageBlock); container.appendChild(element("div", "Alerte", { class: "callout" }));
    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));
    assert.equal(container.children.length, 2); assert.equal(container.children[0].className.includes("feuillets-document-media-role-pair"), false);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : portrait + intro + citation conserve une citation unique dans le flux flottant", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p");
    const image = element("img");
    imageBlock.appendChild(image);
    const intro = element("p", "Les mots soulignés sont définis au tableau.");
    const quote = element("blockquote");
    const paragraphs = ["P1", "P2", "P3", "P4"].map((text) => element("p", text));
    paragraphs.forEach((paragraph) => quote.appendChild(paragraph));
    const heading = element("h3", "Texte 2");
    container.appendChild(imageBlock);
    container.appendChild(intro);
    container.appendChild(quote);
    container.appendChild(heading);

    composeDocumentMedia(container, new Map([[image, { width: 631, height: 631 }]]));

    const media = container.children[0];
    assert.match(media.className, /feuillets-doc-media-portrait-flow/);
    assert.equal(media.children.length, 1);
    assert.equal(container.querySelectorAll("blockquote").length, 1);
    assert.equal(container.children[1], intro);
    assert.equal(container.children[2], quote);
    assert.deepEqual(quote.children, paragraphs);
    assert.doesNotMatch(quote.className, /feuillets-doc-quote-split-(?:start|continuation)/);
    assert.match(heading.className, /feuillets-doc-media-portrait-flow-clear/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : une image carrée suivie de texte devient portraitLike", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p");
    const image = element("img");
    imageBlock.appendChild(image);
    const paragraph = element("p", "Texte associé");
    container.appendChild(imageBlock);
    container.appendChild(paragraph);

    composeDocumentMedia(container, new Map([[image, { width: 600, height: 600 }]]));

    assert.match(container.children[0].className, /feuillets-doc-media-portrait/);
    assert.doesNotMatch(container.children[0].className, /portrait-flow/);
    assert.equal(container.children[0].children[1].children[0], paragraph);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : une image quasi carrée suivie d'une image reste paysage", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const firstBlock = element("p"); const first = element("img"); firstBlock.appendChild(first);
    const secondBlock = element("p"); const second = element("img"); secondBlock.appendChild(second);
    container.appendChild(firstBlock); container.appendChild(secondBlock);

    composeDocumentMedia(container, new Map([[first, { width: 660, height: 600 }], [second, { width: 700, height: 400 }]]));

    assert.match(container.children[0].className, /feuillets-doc-media-landscape/);
    assert.doesNotMatch(container.children[0].className, /portrait/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : une image imbriquée dans une liste ne transforme jamais la liste entière en média", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const list = element("ol");
    const item = element("li");
    const question = element("p", "Question");
    const imageBlock = element("p");
    const image = element("img");
    imageBlock.appendChild(image);
    item.appendChild(question); item.appendChild(imageBlock); list.appendChild(item); container.appendChild(list);

    composeDocumentMedia(container, new Map([[image, { width: 500, height: 700 }]]));

    assert.equal(container.children[0], list);
    assert.doesNotMatch(list.className, /feuillets-doc-media-block/);
    assert.equal(container.textContent.includes("Question"), true);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : une image paysage reste un bloc empilé sans aspirer le contenu suivant", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p");
    const image = element("img");
    imageBlock.appendChild(image);
    const following = element("p", "Exercice suivant");
    container.appendChild(imageBlock);
    container.appendChild(following);

    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

    assert.match(container.children[0].className, /feuillets-doc-media-landscape/);
    assert.equal(container.children[0].children.length, 1);
    assert.equal(container.children[1], following);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : paysage + description + liste place le premier item à gauche sans perdre la numérotation", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p");
    const image = element("img", "Gravure");
    imageBlock.appendChild(image);
    const description = element("p", "Cette gravure est extraite de l'Encyclopédie.");
    const list = element("ol");
    const items = ["Décrivez", "Il s'agit", "Qui étaient", "Sur ce document"].map((text) => element("li", text));
    items.forEach((item) => list.appendChild(item));
    container.appendChild(imageBlock);
    container.appendChild(description);
    container.appendChild(list);

    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

    const media = container.children[0];
    assert.match(media.className, /feuillets-doc-media-landscape-context/);
    assert.equal(media.children[0].className, "feuillets-doc-media-content");
    assert.equal(media.children[1].className, "feuillets-doc-media-figure");
    assert.equal(media.children[0].children[0], description);
    assert.equal(media.children[0].children[1].children[0], items[0]);
    assert.equal(container.children[1], list);
    assert.equal(list.getAttribute("start"), "2");
    assert.deepEqual(list.children, items.slice(1));
    const text = container.textContent;
    for (const value of ["Gravure", "Encyclopédie", ...items.map((item) => item.textContent)]) assert.equal(text.includes(value), true);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : le start d'une liste ordonnée est préservé dans les deux colonnes", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p");
    const image = element("img");
    imageBlock.appendChild(image);
    const description = element("p", "Description");
    const list = element("ol", "", { start: "4" });
    list.appendChild(element("li", "Quatre"));
    list.appendChild(element("li", "Cinq"));
    container.appendChild(imageBlock); container.appendChild(description); container.appendChild(list);

    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

    assert.equal(container.children[0].children[0].children[1].getAttribute("start"), "4");
    assert.equal(list.getAttribute("start"), "5");
  } finally { restoreDom(); }
});

/* ===== LOT 3A — surcharge locale `%% image: … %%` =====
 * applyFeuilletsDirectiveMarkers pose les classes `feuillets-image-placement-*`
 * / `feuillets-image-width-*` directement sur l'<img> (voir feuillets-directives.ts) ;
 * ces tests-ci vérifient la consommation par composeDocumentMedia, au même
 * niveau que le test "directive dessous" existant ci-dessus. */

test("composeDocumentMedia : alignement gauche/centre/droite/pleine-largeur, aucun float ni position absolue", () => {
  const restoreDom = installDom();
  try {
    for (const [cls, expected] of [
      ["feuillets-image-placement-left", "left"],
      ["feuillets-image-placement-center", "center"],
      ["feuillets-image-placement-right", "right"],
      ["feuillets-image-placement-full", "full"],
    ]) {
      const container = element("div");
      const imageBlock = element("p");
      const image = element("img", "", { class: cls });
      imageBlock.appendChild(image);
      container.appendChild(imageBlock);

      composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

      const media = container.children[0];
      assert.match(media.className, /feuillets-doc-media-block/, expected);
      assert.match(media.className, new RegExp(cls), expected);
      assert.doesNotMatch(media.className, /portrait|landscape/, expected);
      assert.equal(media.children[0].className, "feuillets-doc-media-figure", expected);
      assert.equal(media.children.length, 1, expected);
      assert.equal(image.classList.contains(cls), false, expected);
      // aucune trace de float/position absolue dans les classes posées.
      assert.doesNotMatch(media.className, /float|absolute|fixed/, expected);
    }
  } finally { restoreDom(); }
});

test("composeDocumentMedia : les 8 largeurs autorisées, aucune autre valeur", () => {
  const restoreDom = installDom();
  try {
    for (const width of [25, 33, 40, 50, 60, 67, 75, 100]) {
      const container = element("div");
      const imageBlock = element("p");
      const image = element("img", "", { class: `feuillets-image-placement-center feuillets-image-width-${width}` });
      imageBlock.appendChild(image);
      container.appendChild(imageBlock);

      composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

      const media = container.children[0];
      assert.match(media.className, new RegExp(`feuillets-image-width-${width}\\b`));
      for (const other of [25, 33, 40, 50, 60, 67, 75, 100].filter((w) => w !== width)) {
        assert.doesNotMatch(media.className, new RegExp(`feuillets-image-width-${other}\\b`));
      }
    }
  } finally { restoreDom(); }
});

test("composeDocumentMedia : la portée d'une surcharge est limitée à la première image associée", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const aBlock = element("p"); const a = element("img", "", { class: "feuillets-image-placement-right feuillets-image-width-40" }); aBlock.appendChild(a);
    const bBlock = element("p"); const b = element("img"); bBlock.appendChild(b);
    container.appendChild(aBlock); container.appendChild(bBlock);

    composeDocumentMedia(container, new Map([[a, { width: 800, height: 400 }], [b, { width: 800, height: 400 }]]));

    assert.match(container.children[0].className, /feuillets-image-placement-right/);
    assert.match(container.children[0].className, /feuillets-image-width-40/);
    // b (sans surcharge) suit le comportement automatique historique — ici
    // paysage empilé, comme le test "reste un bloc empilé" ci-dessus.
    assert.match(container.children[1].className, /feuillets-doc-media-landscape/);
    assert.doesNotMatch(container.children[1].className, /feuillets-image-placement/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : `auto` équivaut strictement à l'absence de surcharge", () => {
  const restoreDom = installDom();
  try {
    const withoutDirective = element("div");
    const b1 = element("p"); const i1 = element("img"); b1.appendChild(i1); withoutDirective.appendChild(b1);
    composeDocumentMedia(withoutDirective, new Map([[i1, { width: 800, height: 400 }]]));

    const withAuto = element("div");
    // `auto` ne pose jamais de classe (§6) : à ce stade du pipeline (après
    // applyFeuilletsDirectiveMarkers), rien ne distingue plus ce cas de
    // l'absence totale de directive — la structure produite doit être identique.
    const b2 = element("p"); const i2 = element("img"); b2.appendChild(i2); withAuto.appendChild(b2);
    composeDocumentMedia(withAuto, new Map([[i2, { width: 800, height: 400 }]]));

    assert.equal(withoutDirective.children[0].className, withAuto.children[0].className);
    assert.doesNotMatch(withAuto.children[0].className, /feuillets-image-placement|feuillets-image-width/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : une directive invalide ne pose aucune classe de surcharge (comportement automatique)", () => {
  const restoreDom = installDom();
  try {
    // Une directive invalide (ex. "droite 37%") n'est jamais convertie en
    // marqueur par prepareFeuilletsDirectives — l'<img> qui en résulte
    // n'porte donc jamais de classe feuillets-image-*, exactement comme
    // en l'absence totale de directive.
    const container = element("div");
    const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
    const following = element("p", "Texte");
    container.appendChild(imageBlock); container.appendChild(following);

    composeDocumentMedia(container, new Map([[image, { width: 631, height: 631 }]]));

    assert.doesNotMatch(container.children[0].className, /feuillets-image-placement|feuillets-image-width/);
    assert.match(container.children[0].className, /feuillets-doc-media-portrait/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : directive dessous + directive image sur le même média — orthogonales", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p", "", { class: "feuillets-directive-dessous" });
    const image = element("img", "", { class: "feuillets-image-placement-center feuillets-image-width-60" });
    imageBlock.appendChild(image);
    const role = element("div", "Explication", { class: "feuillets-pedagogical-role feuillets-role-explication" });
    container.appendChild(imageBlock); container.appendChild(role);

    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

    // dessous décide uniquement l'empilement du pairing...
    assert.match(container.children[0].className, /feuillets-document-media-role-pair-stacked/);
    assert.doesNotMatch(container.children[0].innerHTML, /directive-dessous/);
    // ...image décide uniquement l'alignement/largeur du média, à l'intérieur de la paire.
    const media = container.children[0].children[0];
    assert.match(media.className, /feuillets-image-placement-center/);
    assert.match(media.className, /feuillets-image-width-60/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : le rôle document reste exclu du pairing même avec une surcharge image", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p"); const image = element("img", "", { class: "feuillets-image-placement-center feuillets-image-width-75" }); imageBlock.appendChild(image);
    // Un rôle "document" n'est jamais taggé feuillets-pedagogical-role par
    // applyPedagogicalSemantics (voir pedagogical-roles.ts, hors périmètre
    // de ce lot) — composeDocumentMediaRoles ne le voit donc jamais comme
    // éligible au pairing, quelle que soit la surcharge sur l'image.
    const role = element("div", "Figure 1", { class: "feuillets-role-document" });
    container.appendChild(imageBlock); container.appendChild(role);

    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

    assert.equal(container.children.length, 2);
    assert.match(container.children[0].className, /feuillets-image-placement-center/);
    assert.equal(container.children[0].className.includes("feuillets-document-media-role-pair"), false);
    assert.equal(container.children[1], role);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : une surcharge désactive le portrait-flow SEULEMENT pour cette image", () => {
  const restoreDom = installDom();
  try {
    // Reprend exactement le montage du test "portrait-flow" gelé ci-dessus
    // (image carrée + citation), mais avec une directive explicite : le
    // flottant historique doit être désactivé pour CETTE image seulement.
    const container = element("div");
    const imageBlock = element("p");
    const image = element("img", "", { class: "feuillets-image-placement-right feuillets-image-width-33" });
    imageBlock.appendChild(image);
    const quote = element("blockquote");
    quote.appendChild(element("p", "Citation"));
    container.appendChild(imageBlock);
    container.appendChild(quote);

    // Deuxième image, sans directive, dans un montage séparé : le gel du
    // portrait-flow doit rester intact pour elle.
    const other = element("div");
    const otherBlock = element("p"); const otherImage = element("img"); otherBlock.appendChild(otherImage);
    const otherQuote = element("blockquote"); otherQuote.appendChild(element("p", "Citation"));
    other.appendChild(otherBlock); other.appendChild(otherQuote);

    composeDocumentMedia(container, new Map([[image, { width: 631, height: 631 }]]));
    composeDocumentMedia(other, new Map([[otherImage, { width: 631, height: 631 }]]));

    assert.doesNotMatch(container.children[0].className, /portrait-flow/);
    assert.match(container.children[0].className, /feuillets-image-placement-right/);
    assert.equal(container.querySelectorAll("blockquote").length, 1);
    assert.match(other.children[0].className, /feuillets-doc-media-portrait-flow/);
  } finally { restoreDom(); }
});

test("composeDocumentMedia : un groupe multi-images sans surcharge conserve le comportement automatique historique", () => {
  const restoreDom = installDom();
  try {
    // Même montage que le test "quasi carrée suivie d'une image reste
    // paysage" existant ci-dessus — non-régression explicite pour ce lot :
    // aucune des deux images ne porte de directive, le groupe garde son
    // comportement automatique intact.
    const container = element("div");
    const firstBlock = element("p"); const first = element("img"); firstBlock.appendChild(first);
    const secondBlock = element("p"); const second = element("img"); secondBlock.appendChild(second);
    container.appendChild(firstBlock); container.appendChild(secondBlock);

    composeDocumentMedia(container, new Map([[first, { width: 660, height: 600 }], [second, { width: 700, height: 400 }]]));

    assert.match(container.children[0].className, /feuillets-doc-media-landscape/);
    assert.doesNotMatch(container.children[0].className, /portrait|feuillets-image-placement/);
    assert.match(container.children[1].className, /feuillets-doc-media-landscape/);
    assert.doesNotMatch(container.children[1].className, /feuillets-image-placement/);
  } finally { restoreDom(); }
});

test("renderManuscriptHtml (pipeline réel) : `%% image: droite 40% %%` disparaît et surcharge le média final", async () => {
  const restoreDom = installDom();
  const imageFile = { path: "assets/carte.png", name: "carte.png", basename: "carte", extension: "png", bytes: new Uint8Array([1, 2, 3]).buffer };
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    // Simule le rendu Obsidian réel : la ligne-marqueur ("FEUILLETS-IMAGE-
    // DIRECTIVE:droite-40", posée par prepareFeuilletsDirectives à partir de
    // "%% image: droite 40% %%") produit son propre paragraphe, suivi
    // immédiatement du bloc média — même convention que les tests "pipeline
    // réel" existants pour ligne/espace ci-dessus (le stub MarkdownRenderer
    // construit directement le DOM attendu, aucun vrai parseur en jeu ici).
    container.appendChild(element("p", "FEUILLETS-IMAGE-DIRECTIVE:droite-40"));
    const embed = element("span", "", { class: "internal-embed", src: "assets/carte.png" });
    embed.appendChild(element("img", "", { src: "app://vault/assets/carte.png" }));
    const imageBlock = element("p");
    imageBlock.appendChild(embed);
    container.appendChild(imageBlock);
  });
  try {
    const { containerEl, images } = await renderManuscriptHtml(fakeApp([imageFile]), "%% image: droite 40% %%\n![[carte.png]]", "Source.md");
    assert.equal(containerEl.textContent.includes("FEUILLETS-IMAGE-DIRECTIVE"), false);
    assert.equal(containerEl.textContent.includes("image:"), false);
    const [image] = Array.from(images.keys());
    assert.notEqual(image, undefined);

    composeDocumentMedia(containerEl, images);

    const media = containerEl.querySelector(".feuillets-doc-media-block");
    assert.notEqual(media, null);
    assert.match(media.className, /feuillets-image-placement-right/);
    assert.match(media.className, /feuillets-image-width-40/);
    assert.notEqual(media.querySelector("img"), null);
    assert.match(media.querySelector("img").getAttribute("src"), /^data:image\/png;base64,/);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml (pipeline réel) : directive invalide reste inerte de bout en bout", async () => {
  const restoreDom = installDom();
  const imageFile = { path: "assets/carte.png", name: "carte.png", basename: "carte", extension: "png", bytes: new Uint8Array([1, 2, 3]).buffer };
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    // Une directive invalide n'est jamais convertie en marqueur — elle
    // resterait donc visible telle quelle si un vrai parseur Markdown la
    // rendait ; ici le stub la simule sous forme de texte littéral, jamais
    // sous forme de marqueur FEUILLETS-IMAGE-DIRECTIVE.
    container.appendChild(element("p", "%% image: droite 37% %%"));
    const embed = element("span", "", { class: "internal-embed", src: "assets/carte.png" });
    embed.appendChild(element("img", "", { src: "app://vault/assets/carte.png" }));
    const imageBlock = element("p");
    imageBlock.appendChild(embed);
    container.appendChild(imageBlock);
  });
  try {
    const { containerEl, images } = await renderManuscriptHtml(fakeApp([imageFile]), "%% image: droite 37% %%\n![[carte.png]]", "Source.md");
    const [image] = Array.from(images.keys());
    assert.notEqual(image, undefined);
    composeDocumentMedia(containerEl, images);
    const media = containerEl.querySelector(".feuillets-doc-media-block");
    assert.notEqual(media, null);
    assert.doesNotMatch(media.className, /feuillets-image-placement|feuillets-image-width/);
  } finally { restoreRenderer(); restoreDom(); }
});

/* ===== LOT 3B — compositions explicites `%% colonnes: … %%` =====
 * applyFeuilletsDirectiveMarkers retrouve le marqueur "FEUILLETS-COLUMNS-
 * DIRECTIVE:…" dans le DOM déjà rendu et y déplace (jamais ne clone) les
 * deux blocs structurels qui suivent — testé directement ici, au même
 * niveau que le producteur (comme les tests "pipeline réel" existants pour
 * ligne/espace ci-dessus construisent le DOM déjà rendu à la main). */

function columnsMarkerText(composition, ratio) {
  return `FEUILLETS-COLUMNS-DIRECTIVE:${composition}:${ratio.replace("/", "-")}`;
}

test("applyFeuilletsDirectiveMarkers : composition image-texte — les trois ratios (§24/§35)", () => {
  const restoreDom = installDom();
  try {
    for (const ratio of ["40/60", "50/50", "60/40"]) {
      const container = element("div");
      const marker = element("p", columnsMarkerText("image-texte", ratio));
      const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
      const textBlock = element("p", "Texte d'explication.");
      container.appendChild(marker); container.appendChild(imageBlock); container.appendChild(textBlock);

      applyFeuilletsDirectiveMarkers(container);

      assert.equal(container.children.length, 1, ratio);
      const wrapper = container.children[0];
      assert.match(wrapper.className, /\bfeuillets-columns\b/, ratio);
      assert.match(wrapper.className, new RegExp(`feuillets-columns-${ratio.replace("/", "-")}\\b`), ratio);
      assert.equal(wrapper.children.length, 2, ratio);
      const [firstCol, secondCol] = wrapper.children;
      assert.match(firstCol.className, /feuillets-column-first/, ratio);
      assert.match(firstCol.className, /feuillets-column-media/, ratio);
      assert.equal(firstCol.children.length, 1, ratio);
      assert.equal(firstCol.children[0], imageBlock, ratio);
      assert.equal(firstCol.children[0].children[0], image, ratio);
      assert.match(secondCol.className, /feuillets-column-second/, ratio);
      assert.match(secondCol.className, /feuillets-column-text/, ratio);
      assert.equal(secondCol.children[0], textBlock, ratio);
      assert.equal(textBlock.textContent, "Texte d'explication.", ratio);
      assert.equal(container.textContent.includes("FEUILLETS-COLUMNS-DIRECTIVE"), false, ratio);
    }
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : composition texte-image — ordre et ratio (§23/§36)", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const marker = element("p", columnsMarkerText("texte-image", "60/40"));
    const textBlock = element("p", "Cette carte présente l'espace étudié.");
    const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
    container.appendChild(marker); container.appendChild(textBlock); container.appendChild(imageBlock);

    applyFeuilletsDirectiveMarkers(container);

    const wrapper = container.children[0];
    assert.match(wrapper.className, /feuillets-columns-60-40/);
    const [firstCol, secondCol] = wrapper.children;
    assert.match(firstCol.className, /feuillets-column-first feuillets-column-text|feuillets-column-text feuillets-column-first/);
    assert.equal(firstCol.children[0], textBlock);
    assert.equal(firstCol.children[0].textContent, "Cette carte présente l'espace étudié.");
    assert.match(secondCol.className, /feuillets-column-second/);
    assert.match(secondCol.className, /feuillets-column-media/);
    assert.equal(secondCol.children[0], imageBlock);
    assert.equal(secondCol.children[0].children[0], image);
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : composition image-image 50/50 — deux images visibles, aucun troisième bloc absorbé (§21/§37 A/D)", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const marker = element("p", columnsMarkerText("image-image", "50/50"));
    const aBlock = element("p"); const a = element("img"); aBlock.appendChild(a);
    const bBlock = element("p"); const b = element("img"); bBlock.appendChild(b);
    const cBlock = element("p"); const c = element("img"); cBlock.appendChild(c);
    container.appendChild(marker); container.appendChild(aBlock); container.appendChild(bBlock); container.appendChild(cBlock);

    applyFeuilletsDirectiveMarkers(container);

    assert.equal(container.children.length, 2);
    const wrapper = container.children[0];
    assert.match(wrapper.className, /feuillets-columns-50-50/);
    assert.equal(wrapper.children[0].children[0], aBlock);
    assert.equal(wrapper.children[1].children[0], bBlock);
    assert.match(wrapper.children[0].className, /feuillets-column-media/);
    assert.match(wrapper.children[1].className, /feuillets-column-media/);
    // c reste hors wrapper — comportement automatique historique préservé
    // (aucune classe de composition, aucune absorption).
    assert.equal(container.children[1], cBlock);
    assert.doesNotMatch(cBlock.className, /feuillets-column/);
    // les deux images du wrapper sont bien visibles (présentes dans le DOM,
    // non retirées, non dupliquées).
    assert.deepEqual(container.querySelectorAll("img"), [a, b, c]);
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : composition image-image 40/60 puis 60/40 — le ratio inverse réellement la largeur relative (§22/§37 B/C)", () => {
  const restoreDom = installDom();
  try {
    for (const ratio of ["40/60", "60/40"]) {
      const container = element("div");
      const marker = element("p", columnsMarkerText("image-image", ratio));
      const aBlock = element("p"); const a = element("img"); aBlock.appendChild(a);
      const bBlock = element("p"); const b = element("img"); bBlock.appendChild(b);
      container.appendChild(marker); container.appendChild(aBlock); container.appendChild(bBlock);

      applyFeuilletsDirectiveMarkers(container);

      const wrapper = container.children[0];
      assert.match(wrapper.className, new RegExp(`feuillets-columns-${ratio.replace("/", "-")}\\b`), ratio);
      // Les deux ratios produisent des classes distinctes — pas seulement
      // une classe sans effet : 40/60 et 60/40 ne partagent aucune classe
      // de ratio commune.
      const other = ratio === "40/60" ? "60/40" : "40/60";
      assert.doesNotMatch(wrapper.className, new RegExp(`feuillets-columns-${other.replace("/", "-")}\\b`), ratio);
    }
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : la colonne texte accepte paragraphe, liste et callout (§25/§38)", () => {
  const restoreDom = installDom();
  try {
    // paragraphe (déjà couvert par le test image-texte ci-dessus) + liste.
    const withList = element("div");
    const marker1 = element("p", columnsMarkerText("image-texte", "40/60"));
    const imageBlock1 = element("p"); const image1 = element("img"); imageBlock1.appendChild(image1);
    const list = element("ul");
    const item1 = element("li", "Point 1"); const item2 = element("li", "Point 2");
    list.appendChild(item1); list.appendChild(item2);
    withList.appendChild(marker1); withList.appendChild(imageBlock1); withList.appendChild(list);
    applyFeuilletsDirectiveMarkers(withList);
    const wrapper1 = withList.children[0];
    assert.match(wrapper1.className, /feuillets-columns-40-60/);
    assert.equal(wrapper1.children[1].children[0], list);
    assert.deepEqual(list.children, [item1, item2]);

    // ordered list — même helper générique, pas codé uniquement pour `ul`.
    const withOl = element("div");
    const marker2 = element("p", columnsMarkerText("image-texte", "40/60"));
    const imageBlock2 = element("p"); const image2 = element("img"); imageBlock2.appendChild(image2);
    const ol = element("ol"); ol.appendChild(element("li", "Un"));
    withOl.appendChild(marker2); withOl.appendChild(imageBlock2); withOl.appendChild(ol);
    applyFeuilletsDirectiveMarkers(withOl);
    assert.match(withOl.children[0].className, /feuillets-columns-40-60/);
    assert.equal(withOl.children[0].children[1].children[0], ol);

    // callout/rôle sémantique Feuillets déjà taggé (applyPedagogicalSemantics
    // tourne avant applyFeuilletsDirectiveMarkers dans le pipeline réel).
    const withRole = element("div");
    const marker3 = element("p", columnsMarkerText("image-texte", "50/50"));
    const imageBlock3 = element("p"); const image3 = element("img"); imageBlock3.appendChild(image3);
    const role = element("div", "Explication", { class: "feuillets-pedagogical-role feuillets-role-explication" });
    withRole.appendChild(marker3); withRole.appendChild(imageBlock3); withRole.appendChild(role);
    applyFeuilletsDirectiveMarkers(withRole);
    const wrapper3 = withRole.children[0];
    assert.match(wrapper3.className, /feuillets-columns-50-50/);
    assert.equal(wrapper3.children[1].children[0], role);
    assert.equal(role.textContent, "Explication");
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : structure incompatible — aucun wrapper, aucun bloc perdu, aucun ordre changé (§9/§39)", () => {
  const restoreDom = installDom();
  try {
    // colonnes image-image puis image puis paragraphe : le deuxième bloc
    // n'est pas un slot image valide.
    const container = element("div");
    const marker = element("p", columnsMarkerText("image-image", "50/50"));
    const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
    const textBlock = element("p", "Texte");
    container.appendChild(marker); container.appendChild(imageBlock); container.appendChild(textBlock);

    applyFeuilletsDirectiveMarkers(container);

    assert.equal(container.children.length, 2);
    assert.equal(container.children[0], imageBlock);
    assert.equal(container.children[1], textBlock);
    assert.doesNotMatch(imageBlock.className, /feuillets-column/);
    assert.doesNotMatch(textBlock.className, /feuillets-column/);
    assert.equal(container.textContent.includes("FEUILLETS-COLUMNS-DIRECTIVE"), false);

    // colonnes image-texte puis deux images : le deuxième bloc n'est pas un
    // slot texte valide (il porte une image).
    const container2 = element("div");
    const marker2 = element("p", columnsMarkerText("image-texte", "40/60"));
    const aBlock = element("p"); const a = element("img"); aBlock.appendChild(a);
    const bBlock = element("p"); const b = element("img"); bBlock.appendChild(b);
    container2.appendChild(marker2); container2.appendChild(aBlock); container2.appendChild(bBlock);

    applyFeuilletsDirectiveMarkers(container2);

    assert.equal(container2.children.length, 2);
    assert.equal(container2.children[0], aBlock);
    assert.equal(container2.children[1], bBlock);
    assert.doesNotMatch(aBlock.className, /feuillets-column/);
    assert.doesNotMatch(bBlock.className, /feuillets-column/);
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : priorité 3B — aucun pairing automatique media-role supplémentaire (§18/§40)", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const marker = element("p", columnsMarkerText("image-texte", "40/60"));
    const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
    const role = element("div", "Explication du document.", { class: "feuillets-pedagogical-role feuillets-role-explication", "data-callout": "explication" });
    container.appendChild(marker); container.appendChild(imageBlock); container.appendChild(role);

    applyFeuilletsDirectiveMarkers(container);
    // composeDocumentMedia (pairing média+rôle automatique) tourne ensuite
    // dans le pipeline réel (preview-view.ts/export-pdf.ts) — appelé ici
    // explicitement pour vérifier qu'il ne crée AUCUN wrapper supplémentaire
    // par-dessus la composition 3B déjà en place.
    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

    // Un seul wrapper au total : le `.feuillets-columns` — jamais un
    // second niveau `.feuillets-document-media-role-pair` imbriqué.
    assert.equal(container.children.length, 1);
    const wrapper = container.children[0];
    assert.match(wrapper.className, /feuillets-columns-40-60/);
    assert.equal(container.querySelectorAll(".feuillets-document-media-role-pair").length, 0);
    assert.equal(container.querySelectorAll(".feuillets-doc-media-block").length, 0);
    assert.equal(container.querySelectorAll(".feuillets-columns").length, 1);
    assert.equal(wrapper.children[1].children[0], role);
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : `document/doc` reste exclu du pairing automatique, mais autorisé explicitement en 3B (§19/§41)", () => {
  const restoreDom = installDom();
  try {
    // A. SANS 3B : image suivie d'un rôle document — comportement historique
    // (déjà couvert par le test composeDocumentMedia dédié plus haut, répété
    // ici pour la non-régression explicite du lot).
    const withoutColumns = element("div");
    const imageBlock = element("p"); const image = element("img"); imageBlock.appendChild(image);
    const docRole = element("div", "Figure 1", { class: "feuillets-role-document", "data-callout": "document" });
    withoutColumns.appendChild(imageBlock); withoutColumns.appendChild(docRole);
    composeDocumentMedia(withoutColumns, new Map([[image, { width: 800, height: 400 }]]));
    assert.equal(withoutColumns.children.length, 2);
    assert.equal(withoutColumns.children[0].className.includes("feuillets-document-media-role-pair"), false);

    // B. AVEC 3B explicite : la composition fonctionne parce qu'elle est
    // explicite — cela ne modifie EN RIEN le contrat A ci-dessus.
    const withColumns = element("div");
    const marker = element("p", columnsMarkerText("image-texte", "40/60"));
    const imageBlock2 = element("p"); const image2 = element("img"); imageBlock2.appendChild(image2);
    const docRole2 = element("div", "Document 1", { class: "feuillets-role-document", "data-callout": "document" });
    withColumns.appendChild(marker); withColumns.appendChild(imageBlock2); withColumns.appendChild(docRole2);

    applyFeuilletsDirectiveMarkers(withColumns);

    assert.equal(withColumns.children.length, 1);
    const wrapper = withColumns.children[0];
    assert.match(wrapper.className, /feuillets-columns-40-60/);
    assert.equal(wrapper.children[1].children[0], docRole2);
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : une image dans une composition 3B ne déclenche pas le portrait-flow externe (§17/§42)", () => {
  const restoreDom = installDom();
  try {
    // A. portrait carré + citation SANS directive 3B : comportement gelé
    // historique (déjà exercé par le test composeDocumentMedia gelé
    // ci-dessus — répété ici pour la non-régression explicite du lot).
    const frozen = element("div");
    const imageBlockA = element("p"); const imageA = element("img"); imageBlockA.appendChild(imageA);
    const quoteA = element("blockquote"); quoteA.appendChild(element("p", "Citation"));
    frozen.appendChild(imageBlockA); frozen.appendChild(quoteA);
    composeDocumentMedia(frozen, new Map([[imageA, { width: 631, height: 631 }]]));
    assert.match(frozen.children[0].className, /feuillets-doc-media-portrait-flow/);

    // B. la même forme d'image, mais associée à un texte via 3B : reste
    // dans sa colonne, ne déclenche aucun flow externe.
    const inColumns = element("div");
    const marker = element("p", columnsMarkerText("image-texte", "40/60"));
    const imageBlockB = element("p"); const imageB = element("img"); imageBlockB.appendChild(imageB);
    const textB = element("p", "Texte associé.");
    inColumns.appendChild(marker); inColumns.appendChild(imageBlockB); inColumns.appendChild(textB);

    applyFeuilletsDirectiveMarkers(inColumns);
    composeDocumentMedia(inColumns, new Map([[imageB, { width: 631, height: 631 }]]));

    const wrapper = inColumns.children[0];
    assert.match(wrapper.className, /feuillets-columns-40-60/);
    assert.doesNotMatch(wrapper.innerHTML, /portrait-flow/);
    assert.equal(inColumns.querySelectorAll(".feuillets-doc-media-portrait-flow").length, 0);
    assert.equal(wrapper.children[1].children[0], textB);
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : `%% dessous %%` isolée reste strictement inchangée (§30/§47)", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p", "", { class: "feuillets-directive-dessous" });
    const image = element("img"); imageBlock.appendChild(image);
    const role = element("div", "Question", { class: "feuillets-pedagogical-role feuillets-role-questions" });
    container.appendChild(imageBlock); container.appendChild(role);

    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

    assert.match(container.children[0].className, /feuillets-document-media-role-pair-stacked/);
    assert.doesNotMatch(container.children[0].innerHTML, /directive-dessous/);
    assert.equal(container.querySelectorAll(".feuillets-columns").length, 0);
  } finally { restoreDom(); }
});

test("applyFeuilletsDirectiveMarkers : `%% image: … %%` (LOT 3A) hors composition reste strictement fonctionnel (§16/§31/§43)", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const imageBlock = element("p");
    const image = element("img", "", { class: "feuillets-image-placement-right feuillets-image-width-33" });
    imageBlock.appendChild(image);
    container.appendChild(imageBlock);

    composeDocumentMedia(container, new Map([[image, { width: 800, height: 400 }]]));

    const media = container.children[0];
    assert.match(media.className, /feuillets-image-placement-right/);
    assert.match(media.className, /feuillets-image-width-33/);
    assert.equal(container.querySelectorAll(".feuillets-columns").length, 0);
  } finally { restoreDom(); }
});

test("renderManuscriptHtml (pipeline réel, LOT 3B) : `%% colonnes: image-image 50/50 %%` — marqueur absent, deux images, un wrapper 50/50", async () => {
  const restoreDom = installDom();
  const aFile = { path: "assets/a.png", name: "a.png", basename: "a", extension: "png", bytes: new Uint8Array([1, 2, 3]).buffer };
  const bFile = { path: "assets/b.png", name: "b.png", basename: "b", extension: "png", bytes: new Uint8Array([4, 5, 6]).buffer };
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("p", "FEUILLETS-COLUMNS-DIRECTIVE:image-image:50-50"));
    const aEmbed = element("span", "", { class: "internal-embed", src: "assets/a.png" });
    aEmbed.appendChild(element("img", "", { src: "app://vault/assets/a.png" }));
    const aBlock = element("p"); aBlock.appendChild(aEmbed);
    const bEmbed = element("span", "", { class: "internal-embed", src: "assets/b.png" });
    bEmbed.appendChild(element("img", "", { src: "app://vault/assets/b.png" }));
    const bBlock = element("p"); bBlock.appendChild(bEmbed);
    container.appendChild(aBlock); container.appendChild(bBlock);
  });
  try {
    const { containerEl, images } = await renderManuscriptHtml(fakeApp([aFile, bFile]), "%% colonnes: image-image 50/50 %%\n\n![[a.png]]\n\n![[b.png]]", "Source.md");
    assert.equal(containerEl.textContent.includes("FEUILLETS-COLUMNS-DIRECTIVE"), false);
    assert.equal(containerEl.textContent.includes("colonnes:"), false);
    assert.equal(images.size, 2);
    assert.equal(containerEl.querySelectorAll(".feuillets-columns").length, 1);
    const wrapper = containerEl.querySelector(".feuillets-columns");
    assert.match(wrapper.className, /feuillets-columns-50-50/);
    assert.equal(wrapper.querySelectorAll(".feuillets-column").length, 2);
    const imgs = wrapper.querySelectorAll("img");
    assert.equal(imgs.length, 2);
    for (const img of imgs) assert.match(img.getAttribute("src"), /^data:image\/png;base64,/);
    // aucune duplication : chaque image n'apparaît qu'une fois dans tout le document.
    assert.equal(containerEl.querySelectorAll("img").length, 2);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml (pipeline réel, LOT 3B) : `%% colonnes: image-texte 40/60 %%` — image + texte, ordre correct", async () => {
  const restoreDom = installDom();
  const imageFile = { path: "assets/a.png", name: "a.png", basename: "a", extension: "png", bytes: new Uint8Array([1, 2, 3]).buffer };
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("p", "FEUILLETS-COLUMNS-DIRECTIVE:image-texte:40-60"));
    const embed = element("span", "", { class: "internal-embed", src: "assets/a.png" });
    embed.appendChild(element("img", "", { src: "app://vault/assets/a.png" }));
    const imageBlock = element("p"); imageBlock.appendChild(embed);
    container.appendChild(imageBlock);
    container.appendChild(element("p", "Texte."));
  });
  try {
    const { containerEl, images } = await renderManuscriptHtml(fakeApp([imageFile]), "%% colonnes: image-texte 40/60 %%\n\n![[a.png]]\n\nTexte.", "Source.md");
    assert.equal(containerEl.textContent.includes("FEUILLETS-COLUMNS-DIRECTIVE"), false);
    assert.equal(images.size, 1);
    const wrapper = containerEl.querySelector(".feuillets-columns");
    assert.notEqual(wrapper, null);
    assert.match(wrapper.className, /feuillets-columns-40-60/);
    const [firstCol, secondCol] = wrapper.querySelectorAll(".feuillets-column");
    assert.match(firstCol.className, /feuillets-column-media/);
    assert.notEqual(firstCol.querySelector("img"), null);
    assert.match(secondCol.className, /feuillets-column-text/);
    assert.equal(secondCol.textContent, "Texte.");
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml (pipeline réel) : document sans directive `colonnes` — comportement historique intact (§32/§47)", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const imageBlock = element("p"); const image = element("img", "", { src: "app://vault/portrait.png" });
    imageBlock.appendChild(image);
    const quote = element("blockquote"); quote.appendChild(element("p", "Citation"));
    container.appendChild(imageBlock); container.appendChild(quote);
  });
  try {
    const { containerEl, images } = await renderManuscriptHtml(fakeApp(), "![[portrait.png]]\n\n> Citation", "Source.md");
    assert.equal(containerEl.querySelectorAll(".feuillets-columns").length, 0);
    const [image] = Array.from(images.keys());
    if (image) composeDocumentMedia(containerEl, images);
    // Aucune trace du mécanisme 3B dans un document qui ne l'utilise pas.
    assert.equal(containerEl.querySelectorAll(".feuillets-column").length, 0);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml : décharge toujours le composant et nettoie le DOM rendu", async () => {
  const restoreDom = installDom();
  const calls = [];
  const previousLoad = Component.prototype.load;
  const previousUnload = Component.prototype.unload;
  Component.prototype.load = () => calls.push("load");
  Component.prototype.unload = () => calls.push("unload");
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const paragraph = element("p", "Texte", { "data-footnote-id": "fn1", "data-line": "7" });
    container.appendChild(element("button", "Copier"));
    container.appendChild(element("span", "", { class: "callout-icon" }));
    container.appendChild(paragraph);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    assert.deepEqual(calls, ["load", "unload"]);
    assert.equal(containerEl.querySelector("button"), null);
    assert.equal(containerEl.querySelector(".callout-icon"), null);
    assert.equal(containerEl.querySelector("p").getAttribute("data-line"), null);
    assert.equal(containerEl.querySelector("p").getAttribute("data-footnote-id"), "fn1");
  } finally {
    restoreRenderer();
    Component.prototype.load = previousLoad;
    Component.prototype.unload = previousUnload;
    restoreDom();
  }
});

test("renderManuscriptHtml : applique les rôles pédagogiques après le rendu natif", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const questions = element("div", "", { "data-callout": "questions" });
    questions.appendChild(element("ol", "Question AQuestion B"));
    container.appendChild(questions);
    container.appendChild(element("div", "", { "data-callout": "warning" }));
    container.appendChild(element("div", "", { "data-callout": "pagebreak" }));
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "> [!questions]", "Source.md");
    const questions = containerEl.querySelector(".feuillets-role-questions");
    assert.equal(questions.classList.contains("feuillets-role-questions"), true);
    assert.equal(questions.querySelector("ol") !== null, true);
    assert.equal(containerEl.querySelectorAll(".feuillets-pedagogical-role").length, 1);
    assert.equal(containerEl.querySelector(".feuillets-pagebreak")?.classList.contains("feuillets-pagebreak"), true);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml : titre explicite du rôle document conservé et marqué feuillets-role-title-explicit", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const callout = element("div", "", { "data-callout": "document" });
    const title = element("div", "", { class: "callout-title" });
    title.appendChild(element("div", "Doc 2 : Carte", { class: "callout-title-inner" }));
    callout.appendChild(title);
    callout.appendChild(element("div", "Description.", { class: "callout-content" }));
    container.appendChild(callout);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "> [!document] Doc 2 : Carte\n> Description.", "Source.md");
    const role = containerEl.querySelector(".feuillets-role-document");
    assert.equal(role.classList.contains("feuillets-role-title-explicit"), true);
    assert.equal(role.classList.contains("feuillets-role-title-auto"), false);
    assert.equal(role.querySelector(".callout-title-inner").textContent, "Doc 2 : Carte");
    assert.equal(role.querySelector(".callout-content").textContent, "Description.");
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml : [!doc] sans titre explicite (alias) est marqué feuillets-role-title-auto", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const callout = element("div", "", { "data-callout": "doc" });
    const title = element("div", "", { class: "callout-title" });
    title.appendChild(element("div", "doc", { class: "callout-title-inner" }));
    callout.appendChild(title);
    container.appendChild(callout);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "> [!doc]", "Source.md");
    const role = containerEl.querySelector(".feuillets-role-document");
    assert.equal(role.classList.contains("feuillets-role-title-auto"), true);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml : [!definition] sans titre explicite reste feuillets-role-title-auto, contenu conservé", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const callout = element("div", "", { "data-callout": "definition" });
    const title = element("div", "", { class: "callout-title" });
    title.appendChild(element("div", "definition", { class: "callout-title-inner" }));
    callout.appendChild(title);
    callout.appendChild(element("div", "Une onde est...", { class: "callout-content" }));
    container.appendChild(callout);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "> [!definition]\n> Une onde est...", "Source.md");
    const role = containerEl.querySelector(".feuillets-role-definition");
    assert.equal(role.classList.contains("feuillets-role-title-auto"), true);
    assert.equal(role.querySelector(".callout-content").textContent, "Une onde est...");
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

// ---------- Icônes Lucide réelles des repères sémantiques (setIcon) ----------

/** Callout minimal { data-callout, .callout-title > .callout-icon (natif,
 * vide — comme dans le contexte de rendu détaché) + .callout-title-inner,
 * .callout-content optionnel } — assez pour applyPedagogicalSemantics, sans
 * dépendre du moteur MarkdownRenderer. */
function buildRoleCallout(calloutType, titleText, contentText) {
  const callout = element("div", "", { "data-callout": calloutType });
  const title = element("div", "", { class: "callout-title" });
  title.appendChild(element("span", "", { class: "callout-icon" }));
  title.appendChild(element("div", titleText, { class: "callout-title-inner" }));
  callout.appendChild(title);
  if (contentText !== undefined) callout.appendChild(element("div", contentText, { class: "callout-content" }));
  return callout;
}

test("applyPedagogicalSemantics : SHOW / [!problematique] => icône réelle circle-help", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    container.appendChild(buildRoleCallout("problematique", "problematique"));
    applyPedagogicalSemantics(container);

    const marker = container.querySelector(".feuillets-role-marker-icon");
    assert.notEqual(marker, null);
    const svg = marker.querySelector("svg");
    assert.notEqual(svg, null);
    assert.equal(svg.getAttribute("data-icon"), "circle-help");
  } finally { restoreDom(); }
});

test("applyPedagogicalSemantics : SHOW / [!questions] => icône circle-help, questionnaire inchangé", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const callout = buildRoleCallout("questions", "questions");
    const list = element("ol"); list.appendChild(element("li", "Question 1"));
    callout.appendChild(list);
    container.appendChild(callout);
    applyPedagogicalSemantics(container);

    const role = container.querySelector(".feuillets-role-questions");
    const marker = role.querySelector(".feuillets-role-marker-icon");
    assert.equal(marker.querySelector("svg").getAttribute("data-icon"), "circle-help");
    assert.equal(role.querySelector("ol").querySelector("li").textContent, "Question 1");
  } finally { restoreDom(); }
});

test("applyPedagogicalSemantics : SHOW / [!correction] => icône check-check", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    container.appendChild(buildRoleCallout("correction", "correction"));
    applyPedagogicalSemantics(container);

    assert.equal(container.querySelector(".feuillets-role-marker-icon").querySelector("svg").getAttribute("data-icon"), "check-check");
  } finally { restoreDom(); }
});

test("applyPedagogicalSemantics : SHOW / [!document] Doc 2 : Carte => icône file-text, titre conservé", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    container.appendChild(buildRoleCallout("document", "Doc 2 : Carte"));
    applyPedagogicalSemantics(container);

    const role = container.querySelector(".feuillets-role-document");
    assert.equal(role.querySelector(".feuillets-role-marker-icon").querySelector("svg").getAttribute("data-icon"), "file-text");
    assert.equal(role.querySelector(".callout-title-inner").textContent, "Doc 2 : Carte");
  } finally { restoreDom(); }
});

test("applyPedagogicalSemantics : SHOW / [!doc] Figure 3 — Prototype => rôle document, icône file-text", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    container.appendChild(buildRoleCallout("doc", "Figure 3 — Prototype"));
    applyPedagogicalSemantics(container);

    const role = container.querySelector(".feuillets-role-document");
    assert.notEqual(role, null);
    assert.equal(role.querySelector(".feuillets-role-marker-icon").querySelector("svg").getAttribute("data-icon"), "file-text");
    assert.equal(role.querySelector(".callout-title-inner").textContent, "Figure 3 — Prototype");
  } finally { restoreDom(); }
});

test("applyPedagogicalSemantics : SHOW / [!retenir] => icône bookmark (une autre famille, preuve du mapping générique)", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    container.appendChild(buildRoleCallout("retenir", "retenir"));
    applyPedagogicalSemantics(container);

    assert.equal(container.querySelector(".feuillets-role-marker-icon").querySelector("svg").getAttribute("data-icon"), "bookmark");
  } finally { restoreDom(); }
});

test("applyPedagogicalSemantics : les 16 rôles résolvent leur icône depuis PEDAGOGICAL_ROLE_ICON, sans liste dupliquée", () => {
  const restoreDom = installDom();
  try {
    for (const [role, iconRef] of Object.entries(PEDAGOGICAL_ROLE_ICON)) {
      const container = element("div");
      container.appendChild(buildRoleCallout(role, role));
      applyPedagogicalSemantics(container);
      const roleEl = container.querySelector(`.feuillets-role-${role}`);
      assert.notEqual(roleEl, null, `rôle ${role} : classe canonique absente`);
      const marker = roleEl.querySelector(".feuillets-role-marker-icon");
      assert.notEqual(marker, null, `rôle ${role} : aucun slot d'icône`);
      const svg = marker.querySelector("svg");
      assert.notEqual(svg, null, `rôle ${role} : aucune icône injectée`);
      assert.equal(svg.getAttribute("data-icon"), iconRef.replace(/^lucide-/, ""), `rôle ${role}`);
    }
  } finally { restoreDom(); }
});

test("applyPedagogicalSemantics : un callout natif ([!warning]) ne reçoit jamais de feuillets-role-marker-icon", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    const callout = element("div", "", { "data-callout": "warning" });
    const title = element("div", "", { class: "callout-title" });
    title.appendChild(element("span", "", { class: "callout-icon" }));
    title.appendChild(element("div", "Danger", { class: "callout-title-inner" }));
    callout.appendChild(title);
    callout.appendChild(element("div", "Texte", { class: "callout-content" }));
    container.appendChild(callout);
    applyPedagogicalSemantics(container);

    assert.equal(callout.classList.contains("feuillets-pedagogical-role"), false);
    assert.equal(container.querySelector(".feuillets-role-marker-icon"), null);
    assert.equal(container.querySelector(".callout-title-inner").textContent, "Danger");
  } finally { restoreDom(); }
});

test("applyPedagogicalSemantics : idempotence — appliquer deux fois ne duplique jamais l'icône", () => {
  const restoreDom = installDom();
  try {
    const container = element("div");
    container.appendChild(buildRoleCallout("problematique", "problematique"));
    applyPedagogicalSemantics(container);
    applyPedagogicalSemantics(container);

    const markers = container.querySelectorAll(".feuillets-role-marker-icon");
    assert.equal(markers.length, 1);
    assert.equal(markers[0].querySelectorAll("svg").length, 1);
    assert.equal(markers[0].querySelector("svg").getAttribute("data-icon"), "circle-help");
  } finally { restoreDom(); }
});

test("LEGACY/HIDE : le slot d'icône est masqué par le CSS toujours émis (aucun changement visuel)", async () => {
  // applyPedagogicalSemantics ne connaît pas le mode (elle est partagée par
  // Preview ET PDF, tous deux détachés du DOM/CSS applicatif d'Obsidian —
  // voir export-pdf.ts, jamais modifié par ce correctif) : le slot d'icône
  // est donc toujours injecté, mais restait déjà — et reste — invisible en
  // dehors du mode "show", via la règle CSS TOUJOURS émise par
  // templateToCss (utils/export-templates.ts), vérifiée ci-dessous pour les
  // deux modes concernés.
  const { templateToCss } = await import("../src/utils/export-templates.js");
  const { EXPORT_TEMPLATES } = await import("../src/utils/export-templates.js");
  for (const mode of [undefined, "legacy", "hide"]) {
    const css = templateToCss({ ...EXPORT_TEMPLATES.classique, ...(mode ? { semanticRoleMarkers: mode } : {}) });
    assert.match(css, /\.feuillets-pedagogical-role \.callout-title \.feuillets-role-marker-icon \{ display: none; \}/, `mode ${mode}`);
  }
});

test("renderManuscriptHtml (pipeline réel) : [!document] Doc 2 : Carte en mode show => SVG réel sérialisé, titre conservé", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(buildRoleCallout("document", "Doc 2 : Carte"));
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "> [!document] Doc 2 : Carte", "Source.md");
    const role = containerEl.querySelector(".feuillets-role-document");
    assert.notEqual(role, null);
    const marker = role.querySelector(".feuillets-role-marker-icon");
    assert.notEqual(marker, null);
    const svg = marker.querySelector("svg");
    assert.notEqual(svg, null);
    assert.equal(svg.tagName, "SVG");
    assert.equal(role.querySelector(".callout-title-inner").textContent, "Doc 2 : Carte");
    // Le HTML final (celui réellement injecté dans le <style>/<body> du
    // Preview/PDF, voir preview-view.ts/export-pdf.ts) sérialise bien un
    // <svg> réel dans le slot d'icône — pas seulement un emplacement vide.
    // (stripObsidianCruft retire ensuite les attributs data-* du DOM
    // rendu — y compris le data-icon du STUB de test, comportement déjà
    // existant et volontaire, indépendant de ce correctif — d'où la
    // vérification sur la présence du <svg>, pas sur cet attribut ici ;
    // le mapping exact rôle -> icône est déjà couvert par les tests
    // applyPedagogicalSemantics ci-dessus, en amont du strip.)
    assert.match(role.outerHTML, /<svg[^>]*>/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml : associe les directives aux questions dans l'ordre DOM", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const callout = element("div", "", { "data-callout": "questions" }); const content = element("div", "", { class: "callout-content" });
    const first = element("ol"); first.appendChild(element("li", "Question 1")); content.appendChild(first); content.appendChild(element("p", "FEUILLETS-DIRECTIVE:ligne:3"));
    const second = element("ol"); second.appendChild(element("li", "Question 2")); content.appendChild(second); content.appendChild(element("p", "FEUILLETS-DIRECTIVE:espace:6"));
    const third = element("ol"); third.appendChild(element("li", "Question 3")); content.appendChild(third); content.appendChild(element("p", "FEUILLETS-DIRECTIVE:espace:55mm"));
    callout.appendChild(content); container.appendChild(callout);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    const items = containerEl.querySelectorAll("li");
    assert.equal(items[0].querySelectorAll(".feuillets-answer-line").length, 3);
    assert.equal(items[1].querySelectorAll(".feuillets-answer-line").length, 0);
    assert.equal(items[1].querySelector(".feuillets-answer-space").getAttribute("style"), "height: 6lh;");
    assert.equal(items[2].querySelector(".feuillets-answer-space").getAttribute("style"), "height: 55mm;");
    assert.equal(containerEl.querySelector(".feuillets-role-questions").textContent.includes("FEUILLETS-DIRECTIVE"), false);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml : le pipeline Markdown retire les marqueurs intégrés aux LI", async () => {
  const restoreDom = installDom();
  let renderedMarkdown = "";
  const restoreRenderer = setRenderer(async (_app, markdown, container) => {
    renderedMarkdown = markdown;
    const callout = element("div", "", { "data-callout": "questions" }); const list = element("ol");
    list.appendChild(element("li", "Première question.\nFEUILLETS-DIRECTIVE:ligne:3"));
    list.appendChild(element("li", "Deuxième question.\nFEUILLETS-DIRECTIVE:espace:6"));
    list.appendChild(element("li", "Troisième question.\nFEUILLETS-DIRECTIVE:espace:55 mm"));
    callout.appendChild(list); container.appendChild(callout);
  });
  const markdown = "> [!questions]\n> 1. Première question.\n>    %% ligne: 3 %%\n>\n> 2. Deuxième question.\n>    %% espace: 6 %%\n>\n> 3. Troisième question.\n>    %% espace: 55 mm %%";
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), markdown, "Source.md");
    const items = containerEl.querySelectorAll("li");
    assert.match(renderedMarkdown, /FEUILLETS-DIRECTIVE:ligne:3/);
    assert.equal(items[0].querySelectorAll(".feuillets-answer-line").length, 3);
    assert.equal(items[1].querySelectorAll(".feuillets-answer-line").length, 0);
    assert.equal(items[1].querySelector(".feuillets-answer-space").getAttribute("style"), "height: 6lh;");
    assert.equal(items[2].querySelector(".feuillets-answer-space").getAttribute("style"), "height: 55mm;");
    assert.equal(containerEl.textContent.includes("FEUILLETS-DIRECTIVE"), false);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml : deux lignes par défaut et ligne:1 explicite", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const callout = element("div", "", { "data-callout": "questions" }); const list = element("ol");
    list.appendChild(element("li", "Question sans directive."));
    list.appendChild(element("li", "Question courte.\nFEUILLETS-DIRECTIVE:ligne:1"));
    callout.appendChild(list); container.appendChild(callout);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    const items = containerEl.querySelectorAll("li");
    assert.equal(items[0].querySelectorAll(".feuillets-answer-line").length, 2);
    assert.equal(items[1].querySelectorAll(".feuillets-answer-line").length, 1);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml : traite un marqueur dans un paragraphe du LI sans retirer la question", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const callout = element("div", "", { "data-callout": "questions" }); const list = element("ol"); const item = element("li");
    item.appendChild(element("p", "Question conservée. FEUILLETS-DIRECTIVE:ligne:3")); list.appendChild(item); callout.appendChild(list); container.appendChild(callout);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    const item = containerEl.querySelector("li");
    assert.equal(item.querySelector("p").textContent.includes("Question conservée."), true);
    assert.equal(item.querySelectorAll(".feuillets-answer-line").length, 3);
    assert.equal(containerEl.textContent.includes("FEUILLETS-DIRECTIVE"), false);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml : une directive orpheline disparaît et laisse le défaut", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const callout = element("div", "", { "data-callout": "questions" }); const content = element("div", "", { class: "callout-content" }); const list = element("ol");
    content.appendChild(element("p", "FEUILLETS-DIRECTIVE:ligne:3")); list.appendChild(element("li", "Question après marqueur orphelin.")); content.appendChild(list); callout.appendChild(content); container.appendChild(callout);
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    const item = containerEl.querySelector("li");
    assert.equal(item.querySelectorAll(".feuillets-answer-line").length, 2);
    assert.equal(containerEl.textContent.includes("FEUILLETS-DIRECTIVE"), false);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml : ignore les orphelines, sous-listes et listes ordinaires", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const callout = element("div", "", { "data-callout": "questions" }); const content = element("div"); const list = element("ol");
    const question = element("li", "Question"); const sublist = element("ul"); const subitem = element("li", "Sous-question");
    subitem.appendChild(element("p", "FEUILLETS-DIRECTIVE:ligne:3")); sublist.appendChild(subitem); question.appendChild(sublist); list.appendChild(question);
    content.appendChild(element("p", "FEUILLETS-DIRECTIVE:espace:6")); content.appendChild(list); content.appendChild(element("p", "FEUILLETS-DIRECTIVE:ligne:2")); content.appendChild(element("p", "FEUILLETS-DIRECTIVE:espace:6"));
    callout.appendChild(content); container.appendChild(callout);
    const ordinary = element("ol"); ordinary.appendChild(element("li", "Liste ordinaire")); container.appendChild(ordinary); container.appendChild(element("p", "FEUILLETS-DIRECTIVE:ligne:3"));
  });
  try {
    const { containerEl } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    const items = containerEl.querySelectorAll("li");
    assert.equal(items[0].querySelectorAll(".feuillets-answer-line").length, 0);
    assert.equal(items[0].querySelector(".feuillets-answer-space").getAttribute("style"), "height: 6lh;");
    assert.equal(items[1].querySelectorAll(".feuillets-answer-line").length, 0);
    assert.equal(items[2].classList.contains("feuillets-answer-custom"), false);
    assert.equal(containerEl.textContent.includes("FEUILLETS-DIRECTIVE"), false);
  } finally { restoreRenderer(); restoreDom(); }
});

test("renderManuscriptHtml : décharge le composant si le rendu Obsidian échoue", async () => {
  const restoreDom = installDom();
  const calls = [];
  const previousLoad = Component.prototype.load;
  const previousUnload = Component.prototype.unload;
  Component.prototype.load = () => calls.push("load");
  Component.prototype.unload = () => calls.push("unload");
  const restoreRenderer = setRenderer(async () => { throw new Error("rendu indisponible"); });
  try {
    await assert.rejects(renderManuscriptHtml(fakeApp(), "texte", "Source.md"), /rendu indisponible/);
    assert.deepEqual(calls, ["load", "unload"]);
  } finally {
    restoreRenderer();
    Component.prototype.load = previousLoad;
    Component.prototype.unload = previousUnload;
    restoreDom();
  }
});

test("renderManuscriptHtml : extrait et retire les notes de bas de page", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const section = element("section", "", { class: "footnotes" });
    const note = element("li", "", { id: "fn1" });
    note.appendChild(element("p", "Une note "));
    note.appendChild(element("a", "↩", { class: "footnote-backref" }));
    section.appendChild(note);
    container.appendChild(section);
  });
  try {
    const { containerEl, footnotes } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    // `html` garde le lien de retour (aller-retour HTML/EPUB) ; `text`
    // (utilisé par DOCX) en reste privé — voir extractFootnotes.
    assert.deepEqual(footnotes, [
      { id: "fn1", html: '<p>Une note </p><a class="footnote-backref">↩</a>', text: "Une note" },
    ]);
    assert.equal(footnotes[0].html.includes("$1"), false);
    assert.equal(containerEl.querySelector("section.footnotes"), null);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml : retire un slash final des notes sans injecter $1", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const section = element("section", "", { class: "footnotes" });
    const note = element("li", "", { id: "fn-slash" });
    note.appendChild(element("p", "Une note / "));
    note.appendChild(element("a", "↩", { class: "footnote-backref" }));
    section.appendChild(note);
    container.appendChild(section);
  });
  try {
    const { footnotes } = await renderManuscriptHtml(fakeApp(), "texte", "Source.md");
    assert.deepEqual(footnotes, [
      { id: "fn-slash", html: '<p>Une note</p><a class="footnote-backref">↩</a>', text: "Une note" },
    ]);
    assert.equal(footnotes[0].html.includes("$1"), false);
    assert.doesNotMatch(footnotes[0].html, /\/\s*<\/p>/);
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("renderManuscriptHtml : inline une image interne, conserve sa légende et isole son erreur", async () => {
  const restoreDom = installDom();
  const imageFile = { path: "assets/image.png", name: "image.png", basename: "image", extension: "png", bytes: new Uint8Array([1, 2, 3]).buffer };
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => errors.push(args);
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    const embed = element("span", "", { class: "internal-embed", src: "assets/image.png" });
    embed.appendChild(element("img", "", { src: "app://vault/assets/image.png", alt: "Une légende" }));
    container.appendChild(embed);
    container.appendChild(element("img", "", { src: "https://example.test/image.png" }));
    container.appendChild(element("img", "", { src: "app://vault/missing.png" }));
  });
  try {
    const { containerEl, images } = await renderManuscriptHtml(fakeApp([imageFile]), "texte", "Source.md");
    const figure = containerEl.querySelector("figure");
    const image = figure.querySelector("img");
    assert.match(image.getAttribute("src"), /^data:image\/png;base64,AQID$/);
    assert.equal(figure.querySelector("figcaption").textContent, "Une légende");
    assert.deepEqual(images.get(image), { bytes: new Uint8Array([1, 2, 3]), ext: "png", width: 640, height: 480, caption: "Une légende" });
    assert.equal(containerEl.querySelectorAll("img")[1].getAttribute("src"), "https://example.test/image.png");
    assert.equal(errors.length, 0);
  } finally {
    restoreRenderer();
    console.error = previousError;
    restoreDom();
  }
});

test("renderManuscriptHtml : poursuit l'export lorsqu'une image interne est illisible", async () => {
  const restoreDom = installDom();
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => errors.push(args);
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("img", "", { src: "app://vault/image.png" }));
  });
  const app = fakeApp([{ path: "image.png", name: "image.png", extension: "png", bytes: new ArrayBuffer(0) }]);
  app.vault.readBinary = async () => { throw new Error("lecture impossible"); };
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { containerEl, images, missingResources } = await renderManuscriptHtml(app, "texte", "Source.md");
    assert.equal(images.size, 0);
    assert.equal(containerEl.querySelector("img").getAttribute("src"), "app://vault/image.png");
    assert.equal(errors.length, 1);
    // Jamais silencieux : signalé à la fois dans la structure retournée...
    assert.deepEqual(missingResources, ["app://vault/image.png"]);
    // ...et par une Notice visible, pas seulement dans la console.
    assert.equal(notices.length, 1);
    assert.match(notices[0], /1 image\(s\) introuvable/);
  } finally {
    restoreRenderer();
    console.error = previousError;
    Notice.onCreate = null;
    restoreDom();
  }
});

test("renderManuscriptHtml : une image absente du coffre (jamais résolue) est signalée, pas juste ignorée", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("img", "", { src: "app://vault/fantome.png" }));
  });
  const app = fakeApp([]); // coffre vide : aucun fichier ne peut résoudre cette image
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { images, missingResources } = await renderManuscriptHtml(app, "texte", "Source.md");
    assert.equal(images.size, 0);
    assert.deepEqual(missingResources, ["app://vault/fantome.png"]);
    assert.equal(notices.length, 1);
  } finally {
    restoreRenderer();
    Notice.onCreate = null;
    restoreDom();
  }
});

test("renderManuscriptHtml : aucune Notice quand toutes les images sont résolues", async () => {
  const restoreDom = installDom();
  const imageFile = { path: "image.png", name: "image.png", basename: "image", extension: "png", bytes: new Uint8Array([1]).buffer };
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("img", "", { src: "app://vault/image.png" }));
  });
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { missingResources } = await renderManuscriptHtml(fakeApp([imageFile]), "texte", "Source.md");
    assert.deepEqual(missingResources, []);
    assert.equal(notices.length, 0);
  } finally {
    restoreRenderer();
    Notice.onCreate = null;
    restoreDom();
  }
});

test("renderManuscriptHtml : une image locale EXISTANTE est inlinée en data: (comportement inchangé)", async () => {
  const restoreDom = installDom();
  const imageFile = { path: "image.png", name: "image.png", basename: "image", extension: "png", bytes: new Uint8Array([9, 9]).buffer };
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("img", "", { src: "app://vault/image.png" }));
  });
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { containerEl, images, missingResources } = await renderManuscriptHtml(fakeApp([imageFile]), "texte", "Source.md");
    assert.match(containerEl.querySelector("img").getAttribute("src"), /^data:image\/png;base64,/);
    assert.equal(images.size, 1);
    assert.deepEqual(missingResources, []);
    assert.equal(notices.length, 0);
  } finally {
    restoreRenderer();
    Notice.onCreate = null;
    restoreDom();
  }
});

test("renderManuscriptHtml : une URL distante (http/https) n'est JAMAIS traitée comme un fichier du coffre introuvable", async () => {
  const restoreDom = installDom();
  const remoteUrl = "https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png";
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    container.appendChild(element("img", "", { src: remoteUrl }));
  });
  const app = fakeApp([]);
  // L'URL distante ne doit JAMAIS atteindre les méthodes de résolution
  // locale d'Obsidian — si elle le fait, le test échoue immédiatement.
  app.metadataCache.getFirstLinkpathDest = (linkpath) => {
    throw new Error(`getFirstLinkpathDest ne doit jamais recevoir une URL distante : ${linkpath}`);
  };
  app.vault.readBinary = async () => {
    throw new Error("readBinary ne doit jamais être appelé pour une URL distante");
  };
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { containerEl, images, missingResources } = await renderManuscriptHtml(app, "texte", "Source.md");
    assert.equal(containerEl.querySelector("img").getAttribute("src"), remoteUrl, "l'URL distante est conservée telle quelle dans l'export");
    assert.equal(images.size, 0, "une image distante n'est pas inlinée en data:");
    assert.deepEqual(missingResources, [], "aucune URL distante ne doit apparaître parmi les ressources introuvables");
    assert.equal(notices.length, 0, "aucune Notice « introuvable dans le coffre » pour une URL distante");
  } finally {
    restoreRenderer();
    Notice.onCreate = null;
    restoreDom();
  }
});

test("renderManuscriptHtml : une URL distante portée par le wrapper .internal-embed (casse/espace compris) est aussi reconnue", async () => {
  const restoreDom = installDom();
  const remoteUrl = "  HTTPS://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png  ";
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    // Reproduit un embed externe ![[…]] : le wrapper .internal-embed porte
    // le lien ORIGINAL (ici une URL distante, avec casse et espace parasite),
    // tandis que l'<img> rendu peut porter un placeholder tout différent.
    const embed = element("span", "", { class: "internal-embed", src: remoteUrl });
    embed.appendChild(element("img", "", { src: "app://local-placeholder/inconnu" }));
    container.appendChild(embed);
  });
  const app = fakeApp([]);
  app.metadataCache.getFirstLinkpathDest = (linkpath) => {
    throw new Error(`getFirstLinkpathDest ne doit jamais recevoir une URL distante : ${linkpath}`);
  };
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { containerEl, images, missingResources } = await renderManuscriptHtml(app, "texte", "Source.md");
    assert.equal(
      containerEl.querySelector("img").getAttribute("src"),
      remoteUrl.trim(),
      "l'<img> reprend l'URL réelle du wrapper plutôt que son placeholder local"
    );
    assert.equal(images.size, 0);
    assert.deepEqual(missingResources, []);
    assert.equal(notices.length, 0);
  } finally {
    restoreRenderer();
    Notice.onCreate = null;
    restoreDom();
  }
});

test("renderManuscriptHtml : une image locale ABSENTE répétée plusieurs fois ne produit qu'UN seul avertissement (dédupliqué)", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, _markdown, container) => {
    for (let i = 0; i < 5; i++) {
      container.appendChild(element("img", "", { src: "app://vault/fantome.png" }));
    }
  });
  const app = fakeApp([]);
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { missingResources } = await renderManuscriptHtml(app, "texte", "Source.md");
    assert.deepEqual(missingResources, ["app://vault/fantome.png"], "une seule entrée malgré 5 occurrences identiques");
    assert.equal(notices.length, 1, "une seule Notice, jamais une par occurrence");
    assert.match(notices[0], /1 image\(s\) introuvable/, "le compte reflète les sources UNIQUES, pas les occurrences");
  } finally {
    restoreRenderer();
    Notice.onCreate = null;
    restoreDom();
  }
});

test("renderManuscriptHtmlWithFrontPages : isole les pages Front et étiquette leurs rôles", async () => {
  const restoreDom = installDom();
  const restoreRenderer = setRenderer(async (_app, markdown, container) => {
    for (const block of markdown.split("\n\n")) container.appendChild(element("p", block));
  });
  try {
    const segments = [{ frontType: "titre", text: "FEUILLETS-FPROLE:auteur\n\nHalim" }, { text: "Corps" }];
    const { containerEl } = await renderManuscriptHtmlWithFrontPages(fakeApp(), "ignoré", segments, "Source.md");
    const frontPage = containerEl.querySelector(".feuillets-frontpage-titre");
    assert.ok(frontPage);
    assert.equal(frontPage.querySelector("p").textContent, "Halim");
    assert.equal(frontPage.querySelector("p").getAttribute("data-fp-role"), "auteur");
    assert.equal(containerEl.querySelectorAll("p").at(-1).textContent, "Corps");
  } finally {
    restoreRenderer();
    restoreDom();
  }
});

test("preserveBlankLinesForFrontPage : matérialise chaque ligne vide", () => {
  assert.equal(preserveBlankLinesForFrontPage("\nTitre\n\n\nAuteur\n"), " \n\nTitre\n\n \n\n \n\nAuteur\n\n ");
  assert.equal(preserveBlankLinesForFrontPage(""), " ");
});
