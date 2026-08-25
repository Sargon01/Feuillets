import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownRenderer, Notice, TFile, TFolder, Component } from "obsidian";
import { exportPresentationPdf, exportPresentationPlanPdf, exportPresentationHandoutPdf } from "../src/services/presentation-pdf-export.js";
import { layoutFilePath } from "../src/services/layout-store.js";
import { createPresentationSlideAnchor } from "../src/services/presentation-layout-overrides.js";
import { splitPresentationMarkdownWithRanges } from "../src/services/presentation.js";
import { annotationsFilePath } from "../src/services/annotations.js";

/* FakeElement DOM factice — même convention que test/presentation-slide-renderer.test.js
   (le vrai renderPresentationSlide tourne réellement dessus), étendue avec le contrat
   iframe/document/DOMParser déjà éprouvé par test/export-pdf.test.js (contentDocument/
   contentWindow isolés, DOMParser du squelette d'impression). */
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.classes = new Set();
    const style = {}; style.setProperty = (name, value) => { style[name] = value; }; style.removeProperty = (name) => { delete style[name]; };
    this.style = style;
    this.text = options.text || ""; this.attrs = new Map(); this._listeners = [];
    this.clientWidth = 1280; this.clientHeight = 720; this.scrollWidth = 1280; this.scrollHeight = 720;
    if (options.cls) this.className = options.cls;
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) this.attrs.set(k, String(v));
    this.classList = { add: (...names) => names.forEach((n) => this.classes.add(n)), remove: (...names) => names.forEach((n) => this.classes.delete(n)), toggle: (n, force) => (force ? this.classes.add(n) : this.classes.delete(n)), contains: (name) => this.classes.has(name) };
    if (this.tagName === "IFRAME") {
      this.contentDocument = createFakeIframeDocument();
      this.contentWindow = {
        printed: 0, focused: 0, calls: [],
        focus() { this.focused++; this.calls.push("focus"); },
        print() { this.printed++; this.calls.push("print"); },
        setTimeout: (cb) => { cb(); return 0; },
        clearTimeout: () => {},
        // Ne rappelle JAMAIS le callback — preuve que l'export ne dépend plus
        // de requestAnimationFrame (une iframe hors écran/minuscule peut le
        // throttler/suspendre indéfiniment dans Chromium réel).
        requestAnimationFrame: () => 0,
      };
      if (activeFrames) activeFrames.push(this);
    }
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get innerText() { return (this.text || "") + this.children.filter((c) => c.tagName !== "SVG").map((c) => c.innerText || c.text || "").join(""); }
  set innerText(value) { this.text = value; }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove?.(); child.parentElement = this; this.children.push(child); return child; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  cloneNode(deep) {
    const clone = new FakeElement(this.tagName, { text: this.text });
    clone.attrs = new Map(this.attrs);
    clone.classes = new Set(this.classes);
    clone.clientWidth = this.clientWidth; clone.clientHeight = this.clientHeight;
    clone.scrollWidth = this.scrollWidth; clone.scrollHeight = this.scrollHeight;
    for (const [key, value] of Object.entries(this.style)) {
      if (typeof value !== "function") clone.style[key] = value;
    }
    if (this.tagName === "IMG") { clone.complete = this.complete; clone.naturalWidth = this.naturalWidth; clone.naturalHeight = this.naturalHeight; }
    if (this.tagName === "VIDEO") { clone.videoWidth = this.videoWidth || 0; clone.videoHeight = this.videoHeight || 0; }
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  get childNodes() { return this.children; }
  querySelector(selector) { return descendants(this).slice(1).find((el) => matches(el, selector)) || null; }
  querySelectorAll(selector) { return descendants(this).slice(1).filter((el) => matches(el, selector)); }
  remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight }; }
  addEventListener(type, listener, options = {}) { this._listeners.push({ type, listener, once: options?.once, signal: options?.signal }); }
  removeEventListener(type, listener) { this._listeners = this._listeners.filter((entry) => entry.type !== type || entry.listener !== listener); }
  dispatch(type) {
    for (const entry of [...this._listeners]) {
      if (entry.type !== type) continue;
      if (entry.signal && entry.signal.aborted) continue;
      entry.listener();
      if (entry.once) { const i = this._listeners.indexOf(entry); if (i >= 0) this._listeners.splice(i, 1); }
    }
  }
  get textContent() { return this.text; }
  set textContent(value) { this.text = value; }
}
function matches(el, selector) {
  return selector.split(",").map((v) => v.trim()).some((part) => matchesOne(el, part));
}
function matchesOne(el, part) {
  if (part.startsWith(".")) return el.classes.has(part.slice(1));
  const attrMatch = part.match(/^([a-zA-Z]*)\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attrMatch) {
    const [, tag, attr, value] = attrMatch;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    if (value !== undefined) return el.getAttribute(attr) === value;
    return el.attrs.has(attr);
  }
  return el.tagName === part.toUpperCase();
}
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

let activeFrames = null;

/* Document isolé de l'iframe d'impression — même contrat que
   test/export-pdf.test.js : open() vide réellement le document (pas de
   squelette reconstruit tant que rien n'est inséré). */
function createFakeIframeDocument() {
  return {
    documentElement: null, head: null, body: null,
    // Ne résout JAMAIS — preuve que l'export ne dépend plus de `fonts.ready`
    // (une Promise suspendue indéfiniment ne doit plus jamais être attendue
    // avant `print()`).
    fonts: { ready: new Promise(() => {}) },
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
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousParser = globalThis.DOMParser;
  const previousWindow = globalThis.window;
  const previousCreateDiv = globalThis.createDiv;
  const previousCreateEl = globalThis.createEl;
  const body = new FakeElement("body");
  const head = new FakeElement("head");
  const frames = [];
  activeFrames = frames;
  const document = {
    body, head,
    // Ne résout JAMAIS — même preuve que côté iframe (voir
    // createFakeIframeDocument) pour le document Obsidian principal.
    fonts: { ready: new Promise(() => {}) },
    querySelector: (selector) => matches(head, selector) ? head : (descendants(head).slice(1).find((el) => matches(el, selector)) || null),
    querySelectorAll: (selector) => descendants(head).slice(1).filter((el) => matches(el, selector)),
  };
  globalThis.document = document;
  globalThis.DOMParser = class {
    parseFromString(html) {
      if (/^<html>/.test(html)) {
        const htmlEl = new FakeElement("html");
        const headEl = new FakeElement("head");
        const bodyEl = new FakeElement("body");
        htmlEl.appendChild(headEl);
        htmlEl.appendChild(bodyEl);
        headEl.appendChild(new FakeElement("meta"));
        headEl.appendChild(new FakeElement("title"));
        headEl.appendChild(new FakeElement("style"));
        return { documentElement: htmlEl, body: bodyEl };
      }
      const bodyEl = new FakeElement("body");
      return { body: bodyEl };
    }
  };
  globalThis.window = { setTimeout: (cb) => { cb(); return 0; }, clearTimeout: () => {} };
  // Fonctions globales autonomes createEl/createDiv d'Obsidian (nœud détaché,
  // non ajouté à un parent) — voir aussi test/export-pdf.test.js.
  globalThis.createEl = (tag, options = {}) => new FakeElement(tag, options);
  globalThis.createDiv = (options = {}) => globalThis.createEl("div", options);
  return {
    body, head, frames,
    restore() {
      globalThis.document = previousDocument;
      globalThis.DOMParser = previousParser;
      globalThis.window = previousWindow;
      globalThis.createDiv = previousCreateDiv;
      globalThis.createEl = previousCreateEl;
      activeFrames = null;
    },
  };
}

function heading(container, text) { return container.createEl("h1", { text }); }
function knownMedia(container, w, h) {
  const media = container.createEl("p");
  const img = media.createEl("img");
  img.complete = true; img.naturalWidth = w; img.naturalHeight = h;
  return { media, img };
}
function unknownMedia(container) {
  const media = container.createEl("p");
  // `src` obligatoire : un média SANS source ne déclenchera jamais `load`, et
  // n'est donc jamais considéré comme « en attente » (voir utils/presentation-media.ts).
  const img = media.createEl("img", { attr: { src: "app://local/carte.png" } });
  img.complete = false; img.naturalWidth = 0; img.naturalHeight = 0;
  return { media, img };
}

function appFor(content) {
  const file = new TFile("Cours.md", content);
  const app = { vault: { read: async (target) => target.content } };
  return { app, file };
}

function printedDeck(dom) {
  const iframe = dom.frames[dom.frames.length - 1];
  return iframe.contentDocument.body.children.find((c) => c.classes.has("feuillets-presentation-print-deck")) || null;
}
function printedPages(dom) {
  const deck = printedDeck(dom);
  return deck ? deck.children : [];
}

test("exportPresentationPdf : nombre de pages = nombre de slides finales, ordre conservé, 1280×720, 1 seul print()", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Slide 1\n\n---\n\n# Slide 2\n\n---\n\n# Slide 3");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });

    const iframe = dom.frames[dom.frames.length - 1];
    assert.ok(iframe, "une iframe d'impression a été créée");
    assert.equal(iframe.contentWindow.printed, 1, "print() appelé une seule fois");
    assert.deepEqual(iframe.contentWindow.calls, ["focus", "print"], "focus() précède immédiatement print()");

    const pages = printedPages(dom);
    assert.equal(pages.length, 3, "3 pages imprimées pour 3 slides");
    for (const page of pages) {
      assert.equal(page.classes.has("feuillets-presentation-print-page"), true);
      // Page physique A4 PAYSAGE (format papier), et non la boîte 16:9.
      assert.equal(page.style.width, "297mm");
      assert.equal(page.style.height, "210mm");
      const section = page.children[0];
      assert.ok(section, "la page contient la section de slide clonée");
      assert.equal(section.classes.has("feuillets-presentation-render-slide"), true);
      assert.equal(section.style.visibility, "visible", "section imprimée visible");
      assert.equal(section.style.display, "block");
      assert.equal(section.style.opacity, "1");
      // La slide garde sa taille de COMPOSITION : seule l'échelle l'adapte.
      assert.equal(section.style.width, "1280px");
      assert.equal(section.style.height, "720px");
    }
    assert.match(pages[0].querySelector("h1").text, /Slide 1/);
    assert.match(pages[1].querySelector("h1").text, /Slide 2/);
    assert.match(pages[2].querySelector("h1").text, /Slide 3/);

    // Aucun contrôle de navigation/toolbar/compteur projeté dans une page imprimée.
    for (const page of pages) {
      assert.equal(page.querySelector(".feuillets-presentation-toolbar"), null);
      assert.equal(page.querySelector(".feuillets-presentation-counter"), null);
    }

    // Cleanup : render root retiré du document principal, iframe retirée après impression.
    assert.equal(dom.body.children.some((c) => c.classes.has("feuillets-presentation-pdf-export-root")), false);
    assert.equal(dom.body.children.includes(iframe), false);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("RÉGRESSION page blanche — cas minimal « # Bonjour » : 1 page, texte réellement présent, section visible et imprimable, print() une seule fois", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });

    const iframe = dom.frames[dom.frames.length - 1];
    assert.ok(iframe, "une iframe d'impression a été créée");

    // Structure DOM FINALE envoyée dans l'iframe — pas seulement que le
    // renderer a été appelé : body → .print-deck → .print-page → section.
    const deck = printedDeck(dom);
    assert.ok(deck, "body > .feuillets-presentation-print-deck présent");
    const pages = printedPages(dom);
    assert.equal(pages.length, 1, "1 page pour 1 slide");

    const page = pages[0];
    assert.equal(page.classes.has("feuillets-presentation-print-page"), true);
    const section = page.children[0];
    assert.ok(section, "la page contient une section de slide");
    assert.equal(section.classes.has("feuillets-presentation-render-slide"), true);

    // Le texte est réellement présent dans le DOM imprimé (pas juste rendu
    // quelque part hors du clone final).
    const h1 = section.querySelector("h1");
    assert.ok(h1, "un <h1> est présent dans la section imprimée");
    assert.match(h1.text, /Bonjour/);

    // La section n'est pas marquée inactive/cachée, et le clone est
    // explicitement imprimable.
    assert.equal(section.classes.has("is-active"), true);
    assert.equal(section.style.display, "block");
    assert.equal(section.style.visibility, "visible");
    assert.equal(section.style.opacity, "1");
    assert.notEqual(section.style.display, "none");
    assert.notEqual(section.style.visibility, "hidden");

    assert.equal(iframe.contentWindow.printed, 1, "print() appelé une seule fois");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("RÉGRESSION page blanche — contenu riche (texte + image + callout questions) : tout visible, aucune toolbar copiée", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    heading(container, "Document");
    knownMedia(container, 400, 300);
    const callout = container.createEl("div", { attr: { "data-callout": "questions" } });
    callout.className = "callout";
    const title = callout.createEl("div", { text: "Questions" });
    title.className = "callout-title";
    const content = callout.createEl("div", { text: "Question" });
    content.className = "callout-content";
  };
  try {
    const { app, file } = appFor("## Document\n\n![image](test.png)\n\n> [!questions]\n> Question");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });

    const pages = printedPages(dom);
    assert.equal(pages.length, 1);
    const section = pages[0].children[0];

    assert.match(section.querySelector("h2")?.text || section.querySelector("h1")?.text || "", /Document/);
    assert.ok(section.querySelector("img"), "l'image est présente");
    assert.ok(section.querySelector("[data-callout]"), "le callout questions est présent");
    assert.equal(section.style.visibility, "visible");
    assert.equal(section.style.display, "block");

    // Aucune toolbar/navigation copiée dans la page imprimée.
    assert.equal(section.querySelector(".feuillets-presentation-toolbar"), null);
    assert.equal(section.querySelector(".feuillets-presentation-button"), null);
    assert.equal(section.querySelector(".feuillets-presentation-counter"), null);

    const iframe = dom.frames[dom.frames.length - 1];
    assert.equal(iframe.contentWindow.printed, 1);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("exportPresentationPdf : clone les <style>/<link rel=stylesheet> du document Obsidian courant dans l'iframe", async () => {
  const dom = installDom();
  dom.head.appendChild(new FakeElement("style", { text: ".theme { color: red; }" }));
  const link = dom.head.createEl("link", { attr: { rel: "stylesheet", href: "app://theme.css" } });
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Slide unique");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });
    const iframe = dom.frames[dom.frames.length - 1];
    const clonedStyles = iframe.contentDocument.head.querySelectorAll("style");
    const clonedLinks = iframe.contentDocument.head.querySelectorAll('link[rel="stylesheet"]');
    assert.ok(clonedStyles.length >= 1, "au moins un <style> cloné (le fixture + le style d'impression)");
    assert.equal(clonedLinks.length, 1);
    assert.equal(clonedLinks[0].getAttribute("href"), link.getAttribute("href"));
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("exportPresentationPdf : 0 slide (markdown vide) => Notice, pas de print", async () => {
  const dom = installDom();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { app, file } = appFor("");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });
    assert.equal(dom.frames.length, 0, "aucune iframe créée");
    assert.equal(notices.length, 1);
  } finally { Notice.onCreate = null; dom.restore(); }
});

test("exportPresentationPdf : verrou anti-double-export — un second appel pendant le premier est refusé (Notice, pas de seconde iframe)", async () => {
  const dom = installDom();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const previousRender = MarkdownRenderer.render;
  let releaseFirstRender;
  const firstRenderGate = new Promise((resolve) => { releaseFirstRender = resolve; });
  let renderCalls = 0;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    renderCalls++;
    if (renderCalls === 1) await firstRenderGate;
    heading(container, markdown.trim());
  };
  try {
    const { app, file } = appFor("# Slide unique");
    const firstExport = exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });
    // Le premier export est bloqué au tout premier rendu : le verrou est déjà posé.
    const secondExport = exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });
    await secondExport;
    assert.equal(dom.frames.length, 0, "pas de seconde iframe pendant que le premier export tourne");
    assert.equal(notices.length, 1);
    releaseFirstRender();
    await firstExport;
    assert.equal(dom.frames.length, 1, "le premier export va bien jusqu'au bout");
  } finally { MarkdownRenderer.render = previousRender; Notice.onCreate = null; dom.restore(); }
});

test("exportPresentationPdf : média pending — attente bornée puis reconstruction UNE SEULE FOIS de la slide concernée", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  let mediaReady = false;
  let renderCallCount = 0;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    renderCallCount++;
    if (mediaReady) knownMedia(container, 400, 300);
    else unknownMedia(container);
  };
  try {
    const { app, file } = appFor("![carte](carte.png)");
    // La stabilisation attend le lot (timeout synchrone dans ce test) : on bascule
    // `mediaReady` à true pour simuler « le média s'est résolu pendant l'attente »
    // avant que le setTimeout synchrone du test ne débloque waitForMediaBatch.
    const originalSetTimeout = globalThis.window.setTimeout;
    globalThis.window.setTimeout = (cb, ms) => { mediaReady = true; return originalSetTimeout(cb, ms); };
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });

    const iframe = dom.frames[dom.frames.length - 1];
    const pages = printedPages(dom);
    assert.equal(pages.length, 1);
    // La reconstruction a bien repris le média désormais résolu.
    assert.ok(pages[0].querySelector("img"), "le média reste présent dans la page imprimée");
    assert.equal(iframe.contentWindow.printed, 1);
    // planner (1 probe) + build initial (1) + reconstruction unique (1) = 3 appels — jamais plus.
    assert.equal(renderCallCount, 3, "au maximum un rerender de stabilisation, jamais une boucle");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("RÉGRESSION blocage impression — requestAnimationFrame qui ne rappelle jamais n'empêche pas print()", async () => {
  // Le fake contentWindow.requestAnimationFrame ne rappelle JAMAIS son callback
  // (voir FakeElement) : si le code de production en dépendait encore, cet
  // export resterait bloqué indéfiniment et ce test ne se terminerait jamais.
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });
    const iframe = dom.frames[dom.frames.length - 1];
    assert.deepEqual(iframe.contentWindow.calls, ["focus", "print"]);
    assert.equal(iframe.contentWindow.printed, 1);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("RÉGRESSION blocage impression — document.fonts.ready qui ne résout jamais n'empêche pas print()", async () => {
  // globalThis.document.fonts.ready et doc.fonts.ready (iframe) sont tous les
  // deux des Promise qui ne résolvent JAMAIS (voir installDom/
  // createFakeIframeDocument) : si le code de production les attendait
  // encore, cet export resterait bloqué indéfiniment.
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });
    const iframe = dom.frames[dom.frames.length - 1];
    assert.deepEqual(iframe.contentWindow.calls, ["focus", "print"]);
    assert.equal(iframe.contentWindow.printed, 1);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("exportPresentationPdf : aucun load d'iframe déclenché — le timeout 300ms factice suffit à atteindre focus()/print()", async () => {
  // Aucun test de ce fichier n'appelle jamais iframe.dispatch("load") : cette
  // suite entière prouve déjà que le repli 300ms (jamais l'événement load)
  // suffit à atteindre l'impression. Ce test l'affirme explicitement.
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });
    const iframe = dom.frames[dom.frames.length - 1];
    assert.deepEqual(iframe.contentWindow.calls, ["focus", "print"], "jamais de load déclenché ici, le timeout suffit");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("exportPresentationPdf : load d'iframe déclenché AVANT le timeout — pas de double print, pas de double résolution", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  const originalSetTimeout = globalThis.window.setTimeout;
  const pendingTimeouts = [];
  // Capture les callbacks setTimeout du document PRINCIPAL sans les exécuter
  // — seul un déclenchement manuel de "load" (ou de ce callback capturé)
  // doit résoudre l'attente d'impression.
  globalThis.window.setTimeout = (cb) => { pendingTimeouts.push(cb); return pendingTimeouts.length; };
  try {
    const { app, file } = appFor("# Bonjour");
    const exportPromise = exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });

    // Laisse les micro-tâches (lecture du fichier, planification, rendu réel
    // de la slide) s'écouler jusqu'à ce que l'iframe d'impression existe et
    // que l'attente load/timeout soit posée (1 setTimeout capturé).
    let iframe = null;
    for (let i = 0; i < 50 && (!iframe || pendingTimeouts.length < 1); i++) {
      await Promise.resolve();
      iframe = dom.frames[dom.frames.length - 1] ?? iframe;
    }
    assert.ok(iframe, "l'iframe d'impression a bien été créée");
    assert.equal(pendingTimeouts.length, 1, "l'attente load/timeout de 300ms est bien posée");
    assert.deepEqual(iframe.contentWindow.calls, [], "print() n'est pas encore parti");

    // Le load arrive avant le repli 300ms : résout l'attente immédiatement.
    iframe.dispatch("load");
    await exportPromise;
    assert.deepEqual(iframe.contentWindow.calls, ["focus", "print"]);
    assert.equal(iframe.contentWindow.printed, 1, "print() appelé une seule fois malgré le load");

    // Le timeout de 300ms, capturé plus tôt, « arrive » ensuite en retard
    // (simulation du cas où load ET timeout finiraient par se déclencher
    // tous les deux dans un vrai Chromium) : ne doit produire aucun second
    // print(), la résolution étant déjà réglée (garde `settled`).
    pendingTimeouts[0]();
    assert.equal(iframe.contentWindow.printed, 1, "toujours un seul print() après le timeout tardif");
    assert.deepEqual(iframe.contentWindow.calls, ["focus", "print"]);
  } finally { MarkdownRenderer.render = previousRender; globalThis.window.setTimeout = originalSetTimeout; dom.restore(); }
});

test("exportPresentationPdf : print() qui échoue — aucune rejection non gérée, Notice d'erreur, verrou libéré, cleanup effectué", async () => {
  const dom = installDom();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    // Fait échouer print() UNIQUEMENT pour l'iframe créée par cet export :
    // production appelle `document.body.createEl("iframe", …)`, une méthode
    // d'instance FakeElement — on l'intercepte au niveau du prototype pour
    // remplacer print() sur le contentWindow juste après sa construction.
    const originalCreateEl = FakeElement.prototype.createEl;
    FakeElement.prototype.createEl = function (tag, options = {}) {
      const el = originalCreateEl.call(this, tag, options);
      if (tag === "iframe") {
        el.contentWindow.print = () => { throw new Error("print failed"); };
      }
      return el;
    };
    try {
      // exportPresentationPdf ne rejette JAMAIS (catch interne) : `await`
      // direct suffit à prouver l'absence de rejection non gérée.
      await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });
    } finally {
      FakeElement.prototype.createEl = originalCreateEl;
    }

    assert.equal(notices.length, 1, "une Notice d'erreur affichée");
    assert.match(notices[0], /impossible de lancer l'impression/i);

    const iframe = dom.frames[dom.frames.length - 1];
    assert.deepEqual(iframe.contentWindow.calls, ["focus"], "focus() a eu lieu avant l'échec de print()");
    // Cleanup effectué : l'iframe qui a échoué est retirée du document principal.
    assert.equal(dom.body.children.includes(iframe), false, "l'iframe défaillante a été nettoyée");

    // Verrou libéré : un second export peut démarrer normalement (pas de
    // Notice "déjà en cours").
    notices.length = 0;
    const { app: app2, file: file2 } = appFor("# Deuxième essai");
    await exportPresentationPdf({ app: app2, component: new Component(), file: file2, pageFormat: "a4-landscape" });
    assert.equal(notices.length, 0, "aucune Notice « déjà en cours » : le verrou a bien été libéré");
    assert.equal(dom.frames.length, 2, "le second export est allé jusqu'au bout normalement");
  } finally { MarkdownRenderer.render = previousRender; Notice.onCreate = null; dom.restore(); }
});

/** Fixture projet minimale : dossier projet + layout.json contenant UN override
 * `slide-layout` déjà stocké, résolu par les MÊMES fonctions publiques que
 * PresentationView/PresentationPreviewView (voir layout-store.ts et
 * presentation-layout-overrides.ts) — jamais une seconde résolution. */
function projectFixtureWithSlideLayout(markdown, slideIndex, layout) {
  const root = new TFolder("Projet");
  const settings = { projectFolder: "Projet" };
  const vaultNodes = new Map([[root.path, root]]);
  const file = new TFile("Projet/Cours.md", markdown);
  const app = {
    vault: {
      read: async (target) => target.content,
      getAbstractFileByPath: (path) => vaultNodes.get(path) ?? null,
    },
  };
  const slides = splitPresentationMarkdownWithRanges(markdown);
  const anchor = createPresentationSlideAnchor(markdown, slides[slideIndex]);
  const store = {
    version: 2,
    overrides: [{ id: "fixture-override", file: "Cours.md", kind: "slide-layout", anchor, layout }],
  };
  const path = layoutFilePath(app, settings);
  vaultNodes.set(path, new TFile(path, JSON.stringify(store)));
  return { app, file, settings };
}

test("RÉGRESSION page blanche RÉELLE (Chromium) — le deck porte la classe `print` d'Obsidian, sinon `body > :not(.print) { display: none !important }` d'app.css le masque à l'impression", async () => {
  // app.css d'Obsidian contient, dans son bloc @media print :
  //   body > :not(.print) { display: none !important; }
  // Comme l'export clone les feuilles de style de la fenêtre Obsidian, cette
  // règle atterrit dans le document d'impression. Sans la classe `print` sur
  // le deck (enfant direct de body), TOUT le contenu est masqué au moment
  // exact de l'impression → une unique page blanche. Aucune spécificité ne
  // bat ce !important : seule la classe prévue par Obsidian le neutralise.
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });

    const deck = printedDeck(dom);
    assert.ok(deck, "le deck est bien présent dans le body imprimé");
    assert.equal(deck.classes.has("print"), true, "le deck porte la classe `print` : `body > :not(.print)` ne le masque plus");
    assert.equal(deck.classes.has("feuillets-presentation-print-deck"), true);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("RÉGRESSION format de page — la feuille d'impression (@page A4 paysage) est la DERNIÈRE du head, après les styles Obsidian clonés", async () => {
  const dom = installDom();
  // Une feuille Obsidian clonée, qui sera insérée dans le head d'impression.
  dom.head.appendChild(new FakeElement("style", { text: ".theme { color: red; }" }));
  dom.head.createEl("link", { attr: { rel: "stylesheet", href: "app://theme.css" } });
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });

    const iframe = dom.frames[dom.frames.length - 1];
    const headChildren = iframe.contentDocument.head.children;
    const last = headChildren[headChildren.length - 1];
    assert.equal(last.tagName, "STYLE", "le dernier nœud du head est bien un <style>");
    assert.match(last.text, /@page/, "c'est bien NOTRE feuille d'impression");
    // Nom de format + mot-clé d'orientation : forme honorée par Chromium
    // (identique au pipeline PDF Document éprouvé). Une taille en deux
    // longueurs explicites y était ignorée → repli en A4 portrait.
    assert.match(last.text, /size:\s*A4 landscape/, "A4 paysage déclaré sous la forme nom + orientation");
    assert.doesNotMatch(last.text, /\d+(\.\d+)?in\s+\d+(\.\d+)?in/, "plus aucune taille en deux longueurs explicites");
    // À spécificité égale, la dernière règle gagne : plus aucune feuille
    // Obsidian clonée ne peut passer après notre @page.
    const ourIndex = headChildren.indexOf(last);
    const clonedStyle = headChildren.find((el) => el.tagName === "STYLE" && /theme/.test(el.text || ""));
    assert.ok(clonedStyle, "la feuille Obsidian a bien été clonée");
    assert.ok(headChildren.indexOf(clonedStyle) < ourIndex, "les styles Obsidian précèdent notre feuille d'impression");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("A4 paysage : la slide 16:9 est mise à l'échelle « contain » et centrée — jamais étirée, jamais recadrée", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "a4-landscape" });

    const page = printedPages(dom)[0];
    const section = page.children[0];

    // Page A4 paysage, slide toujours composée en 1280×720.
    assert.equal(page.style.width, "297mm");
    assert.equal(page.style.height, "210mm");
    assert.equal(section.style.width, "1280px");
    assert.equal(section.style.height, "720px");

    // Échelle « contain » : min(largeur, hauteur). A4 paysage = 1122,52×793,70px
    // → la largeur limite (1122,52/1280 ≈ 0,877), pas la hauteur (793,70/720 ≈ 1,102).
    const pageWidthPx = (297 * 96) / 25.4;
    const pageHeightPx = (210 * 96) / 25.4;
    const expected = Math.min(pageWidthPx / 1280, pageHeightPx / 720);
    const match = /^scale\(([\d.]+)\)$/.exec(section.style.transform);
    assert.ok(match, `transform doit être un scale() simple, reçu : ${section.style.transform}`);
    const actual = Number(match[1]);
    assert.ok(Math.abs(actual - expected) < 1e-9, `échelle contain attendue ${expected}, reçue ${actual}`);
    assert.ok(actual < 1, "la slide est réduite pour tenir dans la largeur A4");

    // UNE seule échelle pour les deux axes → aucune déformation possible.
    assert.doesNotMatch(section.style.transform, /scale\([^)]*,/, "jamais deux facteurs d'échelle distincts");
    // Centrée dans la page, bandes réparties également en haut et en bas.
    assert.equal(section.style.transformOrigin, "center center");
    assert.equal(page.style.display, "flex");
    assert.equal(page.style.alignItems, "center");
    assert.equal(page.style.justifyContent, "center");
    assert.equal(page.style.overflow, "hidden");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("pageFormat « 16:9 » : la page adopte EXACTEMENT la taille de composition, aucune bande, aucune mise à l'échelle", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "16:9" });

    const page = printedPages(dom)[0];
    const section = page.children[0];

    // La page EST la boîte de composition — pas de format papier, pas de
    // conversion mm/in (voir printPageGeometry : source du repli en A4
    // portrait la fois précédente).
    assert.equal(page.style.width, "1280px");
    assert.equal(page.style.height, "720px");
    assert.equal(section.style.width, "1280px");
    assert.equal(section.style.height, "720px");
    assert.equal(section.style.transform, "scale(1)", "aucune réduction : la page correspond exactement à l'écran projeté");

    const iframe = dom.frames[dom.frames.length - 1];
    const printStyleEl = iframe.contentDocument.head.children.at(-1);
    assert.match(printStyleEl.text, /@page/);
    // Dimensions en PIXELS, jamais une conversion en pouces/mm : c'est le
    // point précis qui avait échoué avec « 13.333333in 7.5in » (repli
    // silencieux en A4 portrait). Non vérifiable ici au-delà du DOM produit —
    // un test manuel dans Obsidian reste nécessaire (voir le message final).
    assert.match(printStyleEl.text, /size:\s*1280px 720px/);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("pageFormat : les deux formats produisent un DOM d'impression distinct pour le MÊME document — aucun état partagé entre exports", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const { app, file } = appFor("# Bonjour");
    await exportPresentationPdf({ app, component: new Component(), file, pageFormat: "16:9" });
    const page169 = printedPages(dom)[0];
    assert.equal(page169.style.width, "1280px");

    const { app: app2, file: file2 } = appFor("# Bonjour");
    await exportPresentationPdf({ app: app2, component: new Component(), file: file2, pageFormat: "a4-landscape" });
    const pageA4 = printedPages(dom)[0];
    assert.equal(pageA4.style.width, "297mm", "le format A4 n'est pas resté « collé » depuis l'export 16:9 précédent");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("exportPresentationPdf : un override slide-layout de layout.json (« columns ») atteint bien renderPresentationSlide, exactement comme l'aperçu", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { heading(container, markdown.trim()); };
  try {
    const markdown = "# Slide A\n\n---\n\n# Slide B\n\nTexte B";
    const { app, file, settings } = projectFixtureWithSlideLayout(markdown, 1, "columns");
    await exportPresentationPdf({ app, component: new Component(), file, settings, pageFormat: "a4-landscape" });

    const pages = printedPages(dom);
    assert.equal(pages.length, 2);
    const [sectionA, sectionB] = pages.map((page) => page.children[0]);

    // Seule la 2ᵉ slide porte l'override — l'attribut posé par
    // renderPresentationSlide lui-même prouve que layoutOverride lui a bien
    // été transmis (voir presentation-slide-renderer.ts), sans rien tester
    // du moteur de layout ici.
    assert.equal(sectionA.getAttribute("data-layout-override"), null, "aucun override sur la 1ʳᵉ slide");
    assert.equal(sectionB.getAttribute("data-layout-override"), "columns", "l'override « columns » a atteint le renderer pour la 2ᵉ slide");

    const iframe = dom.frames[dom.frames.length - 1];
    assert.equal(iframe.contentWindow.printed, 1);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

/* ==================================================================
 * exportPresentationPlanPdf — Plan de présentation (A4 portrait, plusieurs
 * slides par page). Ces tests couvrent la STRUCTURE réellement produite
 * (voir en-tête de fichier : FakeDOM ne simule jamais le moteur de layout
 * Chromium réel), pas le rendu Chromium lui-même.
 * ================================================================== */

/** Fixture projet minimale, avec un annotations.json optionnel déjà stocké
 * au chemin réel (annotationsFilePath) — même principe que
 * projectFixtureWithSlideLayout ci-dessus pour layout.json. */
function planFixture(markdown, annotationsJson) {
  const root = new TFolder("Projet");
  const settings = { projectFolder: "Projet" };
  const vaultNodes = new Map([[root.path, root]]);
  const file = new TFile("Projet/Cours.md", markdown);
  const app = {
    vault: {
      read: async (target) => target.content,
      getAbstractFileByPath: (path) => vaultNodes.get(path) ?? null,
    },
  };
  if (annotationsJson !== undefined) {
    const path = annotationsFilePath(app, settings);
    vaultNodes.set(path, new TFile(path, annotationsJson));
  }
  return { app, file, settings };
}

/** Annotation presentationNote résoluble par offsets exacts dans `markdown`
 * (même convention que test/annotations.test.js : prefix/suffix réels). */
function planNote(markdown, { id, text, quote }) {
  const start = markdown.indexOf(quote);
  if (start < 0) throw new Error(`quote introuvable dans le fixture : ${quote}`);
  const end = start + quote.length;
  return {
    id, file: "Cours.md", start, end, quote,
    prefix: markdown.slice(Math.max(0, start - 8), start),
    suffix: markdown.slice(end, end + 8),
    text, color: "yellow", presentationNote: true,
  };
}

function annotationsStore(annotations) {
  return JSON.stringify({ version: 1, annotations });
}

function planPage(dom, index = 0) {
  return printedPages(dom)[index];
}

const FOUR_SLIDES_MARKDOWN = [
  "# Slide 1\n\nPassage un ici.",
  "# Slide 2\n\nPassage deux ici.",
  "# Slide 3\n\nPassage trois ici.",
  "# Slide 4\n\nPassage quatre ici.",
].join("\n\n---\n\n");

/** Une note par slide de FOUR_SLIDES_MARKDOWN (ou un sous-ensemble de ses
 * quatre passages) — pour les tests qui vérifient la disposition
 * `stacked` d'une carte ANNOTÉE (sans note, une carte est `thumbnail-only`). */
function notesForAllSlides(markdown, quotes = ["Passage un ici", "Passage deux ici", "Passage trois ici", "Passage quatre ici"]) {
  return annotationsStore(
    quotes.filter((quote) => markdown.includes(quote)).map((quote, i) => planNote(markdown, { id: `n${i}`, text: `Note ${i + 1}`, quote }))
  );
}

function headingRender() {
  return async (_app, markdown, container) => {
    const title = markdown.trim().split("\n")[0];
    heading(container, title);
    const rest = markdown.trim().split("\n").slice(1).join(" ").trim();
    if (rest) container.createEl("p", { text: rest });
  };
}

test("Plan — plan complet : iframe créée, deck `.print` présent, @page A4 portrait, print() une seule fois", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN);
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });

    const iframe = dom.frames[dom.frames.length - 1];
    assert.ok(iframe, "une iframe d'impression a été créée");
    const deck = printedDeck(dom);
    assert.ok(deck, "le deck du plan est présent dans le body imprimé");
    assert.equal(deck.classes.has("print"), true, "le deck porte la classe `print` d'Obsidian");
    assert.equal(deck.classes.has("feuillets-presentation-print-deck"), true);

    const printStyleEl = iframe.contentDocument.head.children.at(-1);
    assert.match(printStyleEl.text, /@page/);
    assert.match(printStyleEl.text, /size:\s*A4 portrait/);

    assert.equal(iframe.contentWindow.printed, 1, "print() appelé une seule fois");
    assert.deepEqual(iframe.contentWindow.calls, ["focus", "print"]);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Plan — matrice 2×2 FIXE : 4 slides → une page data-capacity=4, grille 2 colonnes × 2 lignes, 4 cartes", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN, notesForAllSlides(FOUR_SLIDES_MARKDOWN));
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });

    const pages = printedPages(dom);
    assert.equal(pages.length, 1);
    const page = pages[0];
    assert.equal(page.getAttribute("data-capacity"), "4");
    assert.equal(page.style.display, "grid");
    assert.equal(page.style.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    assert.equal(page.style.gridTemplateRows, "repeat(2, minmax(0, 1fr))");

    const cards = page.querySelectorAll(".feuillets-presentation-plan-card");
    assert.equal(cards.length, 4);
    cards.forEach((card, index) => {
      assert.equal(card.getAttribute("data-layout"), "stacked");
      assert.equal(card.getAttribute("data-slide-index"), String(index));
      const body = card.querySelector(".feuillets-presentation-plan-body");
      const frame = body.querySelector(".feuillets-presentation-plan-thumbnail-frame");
      const notes = body.querySelector(".feuillets-presentation-plan-notes");
      // Miniature AVANT notes dans le corps de la carte : ordre du DOM.
      assert.equal(body.children.indexOf(frame) < body.children.indexOf(notes), true);
    });
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("RÉGRESSION matrice — 2 ou 3 slides gardent EXACTEMENT la même grille 2×2, jamais une colonne étirée", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    for (const count of [2, 3]) {
      const markdown = FOUR_SLIDES_MARKDOWN.split("\n\n---\n\n").slice(0, count).join("\n\n---\n\n");
      const { app, file, settings } = planFixture(markdown, notesForAllSlides(markdown));
      await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });
      const page = planPage(dom);
      assert.equal(page.getAttribute("data-capacity"), "4", `${count} slides : la capacité de la page reste 4`);
      assert.equal(page.style.gridTemplateColumns, "repeat(2, minmax(0, 1fr))", `${count} slides : toujours 2 colonnes`);
      assert.equal(page.style.gridTemplateRows, "repeat(2, minmax(0, 1fr))", `${count} slides : toujours 2 lignes`);
      assert.equal(page.querySelectorAll(".feuillets-presentation-plan-card").length, count, "les emplacements restants restent simplement vides");
    }
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("RÉGRESSION matrice — 5 slides : page 1 pleine (4 cartes) ET page 2 avec la même grille 2×2 pour 1 carte", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  const markdown = Array.from({ length: 5 }, (_, i) => `# Slide ${i + 1}\n\nPassage ${i + 1} ici.`).join("\n\n---\n\n");
  try {
    const { app, file, settings } = planFixture(markdown);
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });

    const pages = printedPages(dom);
    assert.equal(pages.length, 2);
    assert.equal(pages[0].querySelectorAll(".feuillets-presentation-plan-card").length, 4);
    assert.equal(pages[1].querySelectorAll(".feuillets-presentation-plan-card").length, 1);
    for (const page of pages) {
      assert.equal(page.getAttribute("data-capacity"), "4");
      assert.equal(page.style.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
      assert.equal(page.style.gridTemplateRows, "repeat(2, minmax(0, 1fr))");
      assert.equal(page.style.width, "210mm");
      assert.equal(page.style.minHeight, "297mm");
    }
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Plan — géométrie A4 : 210mm de large, min-height 297mm, hauteur auto et overflow visible (jamais de troncature)", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const note = planNote(FOUR_SLIDES_MARKDOWN, { id: "n1", text: "Une note exceptionnellement longue.".repeat(30), quote: "Passage un ici" });
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN, annotationsStore([note]));
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });
    const page = planPage(dom);
    assert.equal(page.style.width, "210mm");
    assert.equal(page.style.minHeight, "297mm");
    assert.equal(page.style.height, "auto");
    assert.equal(page.style.overflow, "visible");
    const notes = page.querySelector(".feuillets-presentation-plan-notes");
    assert.equal(notes.style.overflow, "visible");
    assert.notEqual(notes.style.textOverflow, "ellipsis");
    assert.equal(notes.style.whiteSpace, "pre-wrap");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Plan — miniature : clone toujours 1280×720, frame 16:9, positionné dans la frame, transformOrigin top left, échelle calculée (jamais .22, jamais %)", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN);
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });
    const page = planPage(dom);
    const frame = page.querySelector(".feuillets-presentation-plan-thumbnail-frame");
    assert.equal(frame.classes.has("feuillets-presentation-thumbnail-frame"), true, "classe commune de l'ajusteur partagé");
    assert.equal(frame.style.overflow, "hidden");
    assert.equal(frame.style.aspectRatio, "16 / 9");

    const clone = frame.children[0];
    assert.ok(clone, "la frame contient bien le clone de la slide");
    assert.equal(clone.style.width, "1280px");
    assert.equal(clone.style.height, "720px");
    assert.equal(clone.style.position, "absolute");
    assert.equal(clone.style.transformOrigin, "top left");
    const match = /^scale\(([\d.]+)\)$/.exec(clone.style.transform);
    assert.ok(match, `transform doit être un scale() simple calculé, reçu : ${clone.style.transform}`);
    assert.notEqual(match[1], "0.22");
    assert.notEqual(match[1], ".22");
    assert.doesNotMatch(clone.style.width, /%/, "jamais de largeur en % sur le clone");
    assert.doesNotMatch(clone.style.transform, /,/, "un seul facteur d'échelle, jamais deux");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Plan — le DOM final de la slide est cloné : classes du vrai renderer présentes, aucun canvas, aucune image de capture générée", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN);
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });
    const page = planPage(dom);
    const clone = page.querySelector(".feuillets-presentation-plan-thumbnail-frame").children[0];
    assert.equal(clone.classes.has("feuillets-presentation-render-slide"), true);
    assert.equal(clone.classes.has("is-active"), true);
    assert.equal(page.querySelector("canvas"), null, "jamais de canvas (aucune rasterisation)");
    assert.ok(clone.querySelector("h1"), "le contenu réel de la slide (h1) est bien présent dans le clone");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Plan — numérotation : notes-only avec slides originales 2 et 7 → titres « Diapositive 2 »/« Diapositive 7 », jamais renumérotées depuis 1", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  const slides = Array.from({ length: 8 }, (_, i) => `# Slide ${i + 1}\n\nPassage ${i + 1} ici.`);
  const markdown = slides.join("\n\n---\n\n");
  try {
    const notes = [
      planNote(markdown, { id: "n2", text: "note slide 2", quote: "Passage 2 ici" }),
      planNote(markdown, { id: "n7", text: "note slide 7", quote: "Passage 7 ici" }),
    ];
    const { app, file, settings } = planFixture(markdown, annotationsStore(notes));
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "notes-only" });

    const page = planPage(dom);
    const cards = page.querySelectorAll(".feuillets-presentation-plan-card");
    assert.equal(cards.length, 2);
    assert.equal(cards[0].getAttribute("data-slide-index"), "1", "index RÉEL de la Slide 2 dans le deck (0-based)");
    assert.equal(cards[1].getAttribute("data-slide-index"), "6", "index RÉEL de la Slide 7 dans le deck (0-based)");
    // notes-only inchangé : les deux cartes ont forcément une note (c'est
    // pourquoi elles figurent dans la sélection) → jamais thumbnail-only.
    assert.equal(cards[0].getAttribute("data-layout"), "stacked");
    assert.equal(cards[1].getAttribute("data-layout"), "stacked");
    const headingText1 = cards[0].querySelector(".feuillets-presentation-plan-heading").text;
    const headingText2 = cards[1].querySelector(".feuillets-presentation-plan-heading").text;
    assert.match(headingText1, /^Diapositive 2\b/);
    assert.match(headingText2, /^Diapositive 7\b/);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Plan — notes : bon texte dans la bonne carte ; plan complet, slide sans note → thumbnail-only sans aucune zone .plan-notes", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const notes = [planNote(FOUR_SLIDES_MARKDOWN, { id: "n1", text: "Commentaire pour la slide 2", quote: "Passage deux ici" })];
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN, annotationsStore(notes));
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });

    const page = planPage(dom);
    const cards = page.querySelectorAll(".feuillets-presentation-plan-card");
    assert.equal(cards.length, 4, "plan complet : les 4 slides sont présentes, avec ou sans note");

    const notesOfCard = (card) => card.querySelectorAll(".feuillets-presentation-plan-note");
    // Slides 1, 3, 4 sans note : data-layout="thumbnail-only", AUCUNE zone
    // `.feuillets-presentation-plan-notes` créée du tout (pas juste vide).
    for (const index of [0, 2, 3]) {
      assert.equal(cards[index].getAttribute("data-layout"), "thumbnail-only");
      assert.equal(cards[index].querySelector(".feuillets-presentation-plan-notes"), null, `carte ${index} : aucune zone notes du tout`);
      assert.equal(notesOfCard(cards[index]).length, 0);
      // Miniature EN HAUT de la case, espace libre en dessous : c'est là
      // qu'on écrit des commentaires manuscrits sur le tirage papier.
      assert.equal(cards[index].querySelector(".feuillets-presentation-plan-body").style.justifyContent, "flex-start");
    }
    // Slide 2 annotée : miniature en haut, notes dessous.
    assert.equal(cards[1].getAttribute("data-layout"), "stacked");
    assert.equal(cards[1].querySelector(".feuillets-presentation-plan-body").style.justifyContent, "flex-start");
    assert.ok(
      cards.every((card) => card.querySelector(".feuillets-presentation-plan-body").style.justifyContent === "flex-start"),
      "toutes les miniatures sont alignées en haut de leur case, annotées ou non",
    );
    assert.equal(notesOfCard(cards[1]).length, 1, "Slide 2 porte bien la note");
    assert.match(notesOfCard(cards[1])[0].text, /Commentaire pour la slide 2/);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Plan — dernière page : break-after auto, pas de page blanche terminale imposée", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  const markdown = Array.from({ length: 5 }, (_, i) => `# Slide ${i + 1}\n\nPassage ${i + 1} ici.`).join("\n\n---\n\n");
  try {
    const { app, file, settings } = planFixture(markdown);
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });

    const pages = printedPages(dom);
    assert.equal(pages.length, 2);
    assert.equal(pages[0].style.breakAfter, "page");
    assert.equal(pages[0].style.pageBreakAfter, "always");
    assert.equal(pages[1].style.breakAfter, "auto", "dernière page : jamais de saut imposé après elle");
    assert.equal(pages[1].style.pageBreakAfter, "auto");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Plan — erreurs : annotations.json corrompu => Notice, aucune impression", async () => {
  const dom = installDom();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN, "{ ceci n'est pas du JSON valide");
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });
    assert.equal(dom.frames.length, 0, "aucune iframe créée : rien n'est imprimé");
    assert.equal(notices.length, 1);
  } finally { MarkdownRenderer.render = previousRender; Notice.onCreate = null; dom.restore(); }
});

test("Plan — erreurs : notes-only sans aucune note => Notice, aucune impression", async () => {
  const dom = installDom();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN);
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "notes-only" });
    assert.equal(dom.frames.length, 0);
    assert.equal(notices.length, 1);
  } finally { MarkdownRenderer.render = previousRender; Notice.onCreate = null; dom.restore(); }
});

test("Plan — erreurs : annotation presentationNote non résoluble => Notice d'avertissement, mais impression des autres slides quand même", async () => {
  const dom = installDom();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const unresolved = {
      id: "n-lost", file: "Cours.md", start: 0, end: 5, quote: "passage disparu depuis longtemps",
      prefix: "inconnu", suffix: "inconnu", text: "note perdue", color: "yellow", presentationNote: true,
    };
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN, annotationsStore([unresolved]));
    await exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });

    assert.equal(notices.length, 1, "une Notice d'avertissement pour la note non résoluble");
    const iframe = dom.frames[dom.frames.length - 1];
    assert.ok(iframe, "l'impression a bien lieu malgré la note non résoluble");
    assert.equal(iframe.contentWindow.printed, 1);
    const page = planPage(dom);
    assert.equal(page.querySelectorAll(".feuillets-presentation-plan-card").length, 4, "les 4 autres slides sont bien imprimées");
  } finally { MarkdownRenderer.render = previousRender; Notice.onCreate = null; dom.restore(); }
});

test("Plan — verrou anti-double-export partagé avec exportPresentationPdf (même verrou module)", async () => {
  const dom = installDom();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const previousRender = MarkdownRenderer.render;
  let releaseFirstRender;
  const firstRenderGate = new Promise((resolve) => { releaseFirstRender = resolve; });
  let renderCalls = 0;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    renderCalls++;
    if (renderCalls === 1) await firstRenderGate;
    heading(container, markdown.trim());
  };
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN);
    const first = exportPresentationPlanPdf({ app, component: new Component(), file, settings, scope: "all" });
    const second = exportPresentationPdf({ app, component: new Component(), file, settings, pageFormat: "16:9" });
    await second;
    assert.equal(dom.frames.length, 0, "le second export (classique) est refusé pendant que le plan tourne");
    assert.equal(notices.length, 1);
    releaseFirstRender();
    await first;
    assert.equal(dom.frames.length, 1, "le premier export (plan) va bien jusqu'au bout");
  } finally { MarkdownRenderer.render = previousRender; Notice.onCreate = null; dom.restore(); }
});

/* ==================================================================
 * Support à distribuer (handout) — 2 ou 4 diapositives par page A4
 * portrait, sans note. Même préparation, même pipeline d'impression et
 * MÊME couche de composition A4 que le Plan.
 * ================================================================== */

test("Support 4/page : matrice 2×2, 4 cellules, aucune zone de notes, @page A4 portrait, print() une seule fois", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN, notesForAllSlides(FOUR_SLIDES_MARKDOWN));
    await exportPresentationHandoutPdf({ app, component: new Component(), file, settings, slidesPerPage: 4 });

    const iframe = dom.frames[dom.frames.length - 1];
    assert.ok(iframe);
    assert.equal(iframe.contentWindow.printed, 1);
    assert.deepEqual(iframe.contentWindow.calls, ["focus", "print"]);
    assert.match(iframe.contentDocument.head.children.at(-1).text, /size:\s*A4 portrait/);

    const pages = printedPages(dom);
    assert.equal(pages.length, 1);
    const page = pages[0];
    assert.equal(page.getAttribute("data-slides-per-page"), "4");
    assert.equal(page.style.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
    assert.equal(page.style.gridTemplateRows, "repeat(2, minmax(0, 1fr))");
    assert.equal(page.querySelectorAll(".feuillets-presentation-handout-cell").length, 4);
    // Document destiné au PUBLIC : jamais de note EXPORTÉE, même quand le
    // feuillet en a — mais des réglures pour écrire à la main.
    assert.equal(page.querySelector(".feuillets-presentation-plan-notes"), null);
    assert.equal(page.querySelector(".feuillets-presentation-plan-note"), null);
    for (const cell of page.querySelectorAll(".feuillets-presentation-handout-cell")) {
      const rules = cell.querySelector(".feuillets-presentation-handout-rules");
      assert.ok(rules, "chaque diapositive est suivie de lignes de prise de notes");
      assert.equal(rules.querySelectorAll(".feuillets-presentation-handout-rules-rule").length, 9);
      // Réglures APRÈS la miniature dans l'ordre du DOM.
      const frame = cell.querySelector(".feuillets-presentation-handout-thumbnail-frame");
      assert.ok(cell.children.indexOf(frame) < cell.children.indexOf(rules));
    }
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Support 2/page : grille 1 colonne × 2 lignes, 2 pages pour 4 slides", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN);
    await exportPresentationHandoutPdf({ app, component: new Component(), file, settings, slidesPerPage: 2 });

    const pages = printedPages(dom);
    assert.equal(pages.length, 2);
    for (const page of pages) {
      assert.equal(page.getAttribute("data-slides-per-page"), "2");
      assert.equal(page.style.gridTemplateColumns, "repeat(1, minmax(0, 1fr))");
      assert.equal(page.style.gridTemplateRows, "repeat(2, minmax(0, 1fr))");
      assert.equal(page.querySelectorAll(".feuillets-presentation-handout-cell").length, 2);
      assert.equal(page.style.width, "210mm");
      assert.equal(page.style.minHeight, "297mm");
      // 2/page : la miniature pleine largeur occupe presque toute la
      // cellule, il ne reste que la place de deux réglures.
      for (const rules of page.querySelectorAll(".feuillets-presentation-handout-rules")) {
        assert.equal(rules.querySelectorAll(".feuillets-presentation-handout-rules-rule").length, 2);
      }
    }
    assert.equal(pages[0].style.breakAfter, "page");
    assert.equal(pages[1].style.breakAfter, "auto");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Support : mêmes miniatures que le Plan — clone 1280×720 contain, jamais de canvas ni de capture", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN);
    await exportPresentationHandoutPdf({ app, component: new Component(), file, settings, slidesPerPage: 4 });

    const page = planPage(dom);
    const frame = page.querySelector(".feuillets-presentation-handout-thumbnail-frame");
    assert.ok(frame);
    assert.equal(frame.classes.has("feuillets-presentation-thumbnail-frame"), true, "même classe que le Plan : un seul ajusteur partagé");
    assert.equal(frame.style.aspectRatio, "16 / 9");
    const clone = frame.children[0];
    assert.equal(clone.style.width, "1280px");
    assert.equal(clone.style.height, "720px");
    assert.equal(clone.style.transformOrigin, "top left");
    assert.match(clone.style.transform, /^scale\([\d.]+\)$/);
    assert.equal(clone.classes.has("feuillets-presentation-render-slide"), true);
    assert.equal(page.querySelector("canvas"), null);
    // Numérotation réelle du deck, comme le Plan.
    assert.match(page.querySelector(".feuillets-presentation-handout-caption").text, /^Diapositive 1$/);
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Support : 0 slide => Notice, aucune impression ; verrou partagé avec les autres exports", async () => {
  const dom = installDom();
  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  try {
    const { app, file, settings } = planFixture("");
    await exportPresentationHandoutPdf({ app, component: new Component(), file, settings, slidesPerPage: 4 });
    assert.equal(dom.frames.length, 0);
    assert.equal(notices.length, 1);
  } finally { Notice.onCreate = null; dom.restore(); }
});

test("Support 6/page : grille 2 colonnes × 3 lignes, 3 réglures par diapositive", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  const markdown = Array.from({ length: 7 }, (_, i) => `# Slide ${i + 1}\n\nPassage ${i + 1} ici.`).join("\n\n---\n\n");
  try {
    const { app, file, settings } = planFixture(markdown);
    await exportPresentationHandoutPdf({ app, component: new Component(), file, settings, slidesPerPage: 6 });

    const pages = printedPages(dom);
    assert.equal(pages.length, 2, "7 diapositives → 6 + 1");
    for (const page of pages) {
      assert.equal(page.getAttribute("data-slides-per-page"), "6");
      assert.equal(page.style.gridTemplateColumns, "repeat(2, minmax(0, 1fr))");
      assert.equal(page.style.gridTemplateRows, "repeat(3, minmax(0, 1fr))");
    }
    assert.equal(pages[0].querySelectorAll(".feuillets-presentation-handout-cell").length, 6);
    assert.equal(pages[1].querySelectorAll(".feuillets-presentation-handout-cell").length, 1, "dernière page incomplète : même grille, emplacements vides");

    for (const rules of pages[0].querySelectorAll(".feuillets-presentation-handout-rules")) {
      assert.equal(rules.querySelectorAll(".feuillets-presentation-handout-rules-rule").length, 3);
    }
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});

test("Support : les réglures sont de VRAIES bordures imprimables, jamais un fond dégradé", async () => {
  const dom = installDom();
  const previousRender = MarkdownRenderer.render;
  MarkdownRenderer.render = headingRender();
  try {
    const { app, file, settings } = planFixture(FOUR_SLIDES_MARKDOWN);
    await exportPresentationHandoutPdf({ app, component: new Component(), file, settings, slidesPerPage: 4 });
    const rule = planPage(dom).querySelector(".feuillets-presentation-handout-rules-rule");
    assert.ok(rule);
    assert.match(rule.style.borderBottom, /solid/);
    assert.equal(rule.style.backgroundImage, undefined, "aucun repeating-linear-gradient");
    // PAS FIXE d'écriture : les réglures ne sont jamais étirées pour
    // remplir la place restante (c'est ce qui les éloignait trop).
    assert.equal(rule.style.height, "7mm");
    assert.equal(rule.style.flex, "none");
    assert.equal(rule.parentElement.style.justifyContent, "flex-start");
  } finally { MarkdownRenderer.render = previousRender; dom.restore(); }
});
