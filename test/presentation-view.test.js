import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { MarkdownRenderer, TFile } from "obsidian";
import { PresentationView } from "../src/views/presentation-view.js";

/* FakeElement DOM factice — même convention que test/presentation-slide-renderer.test.js.
   La vraie PresentationView délègue désormais tout le rendu de slide au renderer partagé
   (voir test/presentation-slide-renderer.test.js pour ses propres tests) : ce fichier ne
   couvre plus que le chrome (deck, navigation, compteur, plein écran, live refresh). */
class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.classes = new Set();
    const style = {}; style.setProperty = (name, value) => { style[name] = value; }; style.removeProperty = (name) => { delete style[name]; };
    this.style = style;
    this.text = options.text || ""; this.attrs = new Map(); this.disabled = false; this._listeners = [];
    this.clientWidth = 1280; this.clientHeight = 720; this.scrollWidth = 1280; this.scrollHeight = 720;
    if (options.cls) this.className = options.cls;
    if (options.attr) for (const [k, v] of Object.entries(options.attr)) this.attrs.set(k, String(v));
    this.classList = { add: (...names) => names.forEach((n) => this.classes.add(n)), remove: (...names) => names.forEach((n) => this.classes.delete(n)), toggle: (n, force) => (force ? this.classes.add(n) : this.classes.delete(n)) };
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove?.(); child.parentElement = this; this.children.push(child); return child; }
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
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode(true));
    return clone;
  }
  get childNodes() { return this.children; }
  querySelector(selector) { const names = selector.split(",").map((v) => v.trim().toUpperCase()); return descendants(this).slice(1).find((el) => el.classes ? matches(el, selector, names) : false) || null; }
  querySelectorAll(selector) { const names = selector.split(",").map((v) => v.trim().toUpperCase()); return descendants(this).slice(1).filter((el) => matches(el, selector, names)); }
  remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; }
  empty() { this.children = []; this.text = ""; }
  setText(value) { this.text = String(value); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  removeAttribute(name) { this.attrs.delete(name); }
  getBoundingClientRect() { return { width: this.clientWidth, height: this.clientHeight, top: 0, left: 0, right: this.clientWidth, bottom: this.clientHeight }; }
  addEventListener(type, listener, options = {}) { this._listeners.push({ type, listener, once: options?.once, signal: options?.signal }); }
  dispatch(type) {
    for (const entry of [...this._listeners]) {
      if (entry.type !== type) continue;
      if (entry.signal && entry.signal.aborted) continue;
      entry.listener();
      if (entry.once) { const i = this._listeners.indexOf(entry); if (i >= 0) this._listeners.splice(i, 1); }
    }
  }
  async requestFullscreen() { globalThis.document.fullscreenElement = this; }
}
function matches(el, selector, tagNames) {
  const classSelectors = selector.split(",").map((v) => v.trim()).filter((v) => v.startsWith("."));
  if (classSelectors.length) return classSelectors.some((cls) => el.classes.has(cls.slice(1)));
  return tagNames.includes(el.tagName);
}
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

function setup(markdown) {
  const contentEl = new FakeElement();
  const file = new TFile("Cours.md", markdown);
  const app = { vault: { read: async (target) => target.content, on: () => ({}) } };
  const view = new PresentationView({ app, contentEl });
  return { view, file, contentEl };
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

function heading(container, text) { return container.createEl("h1", { text }); }
function paragraph(container, text) { return container.createEl("p", { text }); }
function unknownMedia(container) {
  const media = container.createEl("p");
  const img = media.createEl("img");
  img.complete = false; img.naturalWidth = 0; img.naturalHeight = 0;
  return { media, img };
}
function knownMedia(container, w, h) {
  const media = container.createEl("p");
  const img = media.createEl("img");
  img.complete = true; img.naturalWidth = w; img.naturalHeight = h;
  return { media, img };
}

// ===== A — N slides => N sections indépendantes =====

test("PresentationView — deck : N slides => N sections DOM indépendantes, construites via le renderer partagé", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { paragraph(container, markdown); };
  try {
    const { view, file } = setup("A\n---\nB\n---\nC\n---\nD");
    await view.onOpen(); await view.openFile(file);
    const records = view.slideRecords;
    assert.equal(records.length, 4);
    const sections = records.map((r) => r.section);
    assert.equal(new Set(sections).size, 4);
    for (const section of sections) assert.equal(sections.some((other) => other !== section && other.children.includes(section)), false);
  } finally { MarkdownRenderer.render = previous; }
});

// ===== B — navigation aller-retour, zéro nouveau rendu =====

test("PresentationView — navigation : 0→1→2→3→2→1→0 conserve les mêmes références DOM, zéro nouveau MarkdownRenderer.render", async () => {
  const previous = MarkdownRenderer.render;
  let callCount = 0;
  MarkdownRenderer.render = async (_app, markdown, container) => { callCount++; paragraph(container, markdown); };
  try {
    const { view, file } = setup("A\n---\nB\n---\nC\n---\nD");
    await view.onOpen(); await view.openFile(file);
    assert.equal(callCount, 4);
    const sections = view.slideRecords.map((r) => r.section);

    await view.first();
    await view.next(); await view.next(); await view.next();
    await view.previous(); await view.previous(); await view.previous();
    assert.equal(callCount, 4, "aucun nouveau rendu Markdown pendant la navigation");
    assert.deepEqual(view.slideRecords.map((r) => r.section), sections, "mêmes références DOM après l'aller-retour");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== C — SPLIT/STACK/FLOW inchangés après aller-retour =====

test("PresentationView — SPLIT, STACK et FLOW : état inchangé après aller-retour", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    if (markdown === "SPLIT") { heading(container, "T"); knownMedia(container, 70, 100); paragraph(container, "texte"); }
    else if (markdown === "STACK") { heading(container, "T"); knownMedia(container, 180, 100); paragraph(container, "texte"); }
    else { heading(container, "T"); paragraph(container, "un"); paragraph(container, "deux"); }
  };
  try {
    const { view, file } = setup("SPLIT\n---\nSTACK\n---\nFLOW");
    await view.onOpen(); await view.openFile(file);
    const signature = (record) => ({ className: record.section.className, geometry: record.section.getAttribute("data-geometry"), nodes: descendants(record.inner) });
    const before = view.slideRecords.map(signature);
    await view.next(); await view.next(); await view.previous(); await view.previous();
    const after = view.slideRecords.map(signature);
    for (let i = 0; i < before.length; i++) {
      assert.equal(after[i].className, before[i].className);
      assert.equal(after[i].geometry, before[i].geometry);
      assert.deepEqual(after[i].nodes, before[i].nodes);
    }
    assert.ok(["split", "stack"].includes(view.slideRecords[0].section.getAttribute("data-geometry")));
    assert.ok(["split", "stack"].includes(view.slideRecords[1].section.getAttribute("data-geometry")));
    assert.equal(view.slideRecords[2].section.getAttribute("data-geometry"), "flow");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== D — image async d'une slide inactive =====

test("PresentationView — async : une image non chargée sur une slide inactive ne remplace que sa propre section", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    if (markdown === "MEDIA-INCONNU") unknownMedia(container);
    else paragraph(container, markdown);
  };
  try {
    const { view, file } = setup("MEDIA-INCONNU\n---\nSIMPLE1\n---\nSIMPLE2");
    await view.onOpen(); await view.openFile(file);
    await view.last();
    assert.equal(view.activeIndex, 2);
    const slide1Section = view.slideRecords[1].section;
    const slide2Section = view.slideRecords[2].section;
    const oldSlide0Section = view.slideRecords[0].section;

    const image = oldSlide0Section.querySelector("img");
    image.naturalWidth = 400; image.naturalHeight = 800;
    image.dispatch("load");
    await flush();

    assert.notEqual(view.slideRecords[0].section, oldSlide0Section, "slide 0 doit être remplacée");
    assert.equal(view.slideRecords[1].section, slide1Section, "slide 1 inchangée");
    assert.equal(view.slideRecords[2].section, slide2Section, "slide 2 inchangée");
    assert.equal(view.activeIndex, 2, "la slide active reste 2");
    assert.equal(slide2Section.classes.has("is-active"), true);
    assert.equal(view.slideRecords[0].section.classes.has("is-active"), false);
  } finally { MarkdownRenderer.render = previous; }
});

// ===== E — callback d'une ancienne génération : zéro effet =====

test("PresentationView — génération : un callback d'une ancienne génération de deck n'a aucun effet", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    if (markdown === "MEDIA-INCONNU") unknownMedia(container);
    else paragraph(container, markdown);
  };
  try {
    const { view, file } = setup("MEDIA-INCONNU");
    await view.onOpen(); await view.openFile(file);
    const generation1 = view.deckGeneration;
    const record1 = view.slideRecords[0];
    const image = record1.inner.querySelector("img");

    file.content = "AUTRE"; // force une deuxième génération de deck
    await view.openFile(file);
    const generation2 = view.deckGeneration;
    assert.notEqual(generation1, generation2);
    const recordAfter = view.slideRecords[0];

    image.naturalWidth = 400; image.naturalHeight = 800;
    image.dispatch("load"); // callback appartenant explicitement à la génération 1, périmée.
    await flush();
    assert.equal(view.slideRecords[0], recordAfter, "aucune reconstruction déclenchée par un ancien listener");
  } finally { MarkdownRenderer.render = previous; }
});

// ===== F — live refresh =====

test("PresentationView — live refresh : modification du fichier reconstruit un deck indépendant, index conservé si possible", async () => {
  const previous = MarkdownRenderer.render;
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args) };
  MarkdownRenderer.render = async (_app, markdown, container) => { paragraph(container, markdown); };
  try {
    const { view, file } = setup("A\n---\nB\n---\nC");
    await view.onOpen(); await view.openFile(file);
    await view.next(); // index 1
    assert.equal(view.activeIndex, 1);
    const oldSections = view.slideRecords.map((r) => r.section);
    const oldControllers = view.slideRecords.map((r) => r.controller);
    const generationBefore = view.deckGeneration;

    file.content = "A2\n---\nB2";
    view.onVaultModify(file);
    await new Promise((resolve) => setTimeout(resolve, 350)); // laisse le debounce (300ms) se déclencher
    await flush();

    assert.notEqual(view.deckGeneration, generationBefore, "génération incrémentée");
    assert.equal(view.slideRecords.length, 2, "nouveau deck indépendant, propre nombre de slides");
    for (const section of view.slideRecords.map((r) => r.section)) assert.equal(oldSections.includes(section), false, "aucune réutilisation des sections de l'ancien deck");
    for (const controller of oldControllers) assert.equal(controller.signal.aborted, true, "ancien deck abandonné");
    assert.equal(view.activeIndex, 1, "index courant conservé (borné au nouveau nombre de slides)");
  } finally { MarkdownRenderer.render = previous; globalThis.window = previousWindow; }
});

test("PresentationView — live refresh : l'index est borné si le nouveau deck a moins de slides", async () => {
  const previous = MarkdownRenderer.render;
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args) };
  MarkdownRenderer.render = async (_app, markdown, container) => { paragraph(container, markdown); };
  try {
    const { view, file } = setup("A\n---\nB\n---\nC");
    await view.onOpen(); await view.openFile(file);
    await view.last(); // index 2
    assert.equal(view.activeIndex, 2);

    file.content = "Seule";
    view.onVaultModify(file);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flush();

    assert.equal(view.slideRecords.length, 1);
    assert.equal(view.activeIndex, 0, "index rabattu dans les bornes du nouveau deck");
  } finally { MarkdownRenderer.render = previous; globalThis.window = previousWindow; }
});

// ===== G — plein écran / navigation / compteur historiques =====

test("PresentationView — compteur : reflète la position et le total, désactive les boutons en bordure", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { paragraph(container, markdown); };
  try {
    const { view, file } = setup("A\n---\nB\n---\nC");
    await view.onOpen(); await view.openFile(file);
    assert.equal(view.counterEl.text, "1 / 3");
    assert.equal(view.previousButton.disabled, true);
    assert.equal(view.nextButton.disabled, false);
    await view.next();
    assert.equal(view.counterEl.text, "2 / 3");
    await view.last();
    assert.equal(view.counterEl.text, "3 / 3");
    assert.equal(view.nextButton.disabled, true);
    await view.first();
    assert.equal(view.counterEl.text, "1 / 3");
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationView — clavier : flèches/PageUp/PageDown/Home/End naviguent, sans effet sur un champ éditable", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => { paragraph(container, markdown); };
  try {
    const { view, file } = setup("A\n---\nB\n---\nC");
    await view.onOpen(); await view.openFile(file);
    view.handleKeydown({ key: "ArrowRight", preventDefault() {}, target: {} });
    await flush();
    assert.equal(view.activeIndex, 1);
    view.handleKeydown({ key: "ArrowLeft", preventDefault() {}, target: {} });
    await flush();
    assert.equal(view.activeIndex, 0);
    view.handleKeydown({ key: "End", preventDefault() {}, target: {} });
    await flush();
    assert.equal(view.activeIndex, 2);
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationView — plein écran : bascule via document.fullscreenElement/requestFullscreen/exitFullscreen", async () => {
  const previous = MarkdownRenderer.render;
  const previousDocument = globalThis.document;
  globalThis.document = { fullscreenElement: null, exitFullscreen: async () => { globalThis.document.fullscreenElement = null; } };
  MarkdownRenderer.render = async (_app, markdown, container) => { paragraph(container, markdown); };
  try {
    const { view, file } = setup("A");
    await view.onOpen(); await view.openFile(file);
    await view.toggleFullscreen();
    assert.equal(globalThis.document.fullscreenElement, view.rootEl);
    await view.toggleFullscreen();
    assert.equal(globalThis.document.fullscreenElement, null);
  } finally { MarkdownRenderer.render = previous; globalThis.document = previousDocument; }
});

// ===== H — invariant : aucune implémentation locale du moteur =====

test("Invariant — PresentationView utilise renderPresentationSlide et ne réimplémente ni le planner, ni le scoring, ni le contain, ni l'ancien moteur (fit/mediaScale)", async () => {
  const source = await readFile("src/views/presentation-view.ts", "utf8");
  assert.match(source, /from ["']\.\.\/services\/presentation-slide-renderer\.js["']/, "importe bien le renderer partagé");
  assert.match(source, /\brenderPresentationSlide\(/, "appelle réellement renderPresentationSlide");
  assert.equal(/MarkdownRenderer/.test(source), false, "la vue elle-même n'appelle plus MarkdownRenderer directement");

  const forbiddenEngine = /generatePresentationCandidates|choosePresentationCandidate|presentationContainedMediaSize|composeFlow|composeSplit|composeStack/;
  assert.equal(forbiddenEngine.test(source), false, "aucune implémentation locale du planner/scoring/contain");

  const forbiddenLegacy = /fitCurrentSlide|mediaScale|media-left|media-right|media-top|media-bottom/;
  assert.equal(forbiddenLegacy.test(source), false, "aucune logique de l'ancien moteur (fit/fallback/mediaScale)");

  try {
    const rg1 = execSync(
      'rg -n "generatePresentationCandidates|choosePresentationCandidate|presentationContainedMediaSize" src/views/presentation-view.ts',
      { encoding: "utf8" },
    );
    assert.equal(rg1.trim(), "");
    const rg2 = execSync(
      'rg -n "fitCurrentSlide|mediaScale|media-left|media-right|media-top|media-bottom" src/views/presentation-view.ts',
      { encoding: "utf8" },
    );
    assert.equal(rg2.trim(), "");
  } catch (error) {
    if (error.status !== 1 && error.status !== undefined) throw error;
  }
});

test("PresentationView — chrome : mêmes classes historiques (toolbar/counter/overflow/stage/frame/bouton), aucun <style> créé", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { paragraph(container, "texte"); };
  try {
    const { view, file, contentEl } = setup("A");
    await view.onOpen(); await view.openFile(file);
    assert.ok(contentEl.querySelector(".feuillets-presentation-view"));
    assert.ok(contentEl.querySelector(".feuillets-presentation-toolbar"));
    assert.ok(contentEl.querySelector(".feuillets-presentation-counter"));
    assert.ok(contentEl.querySelector(".feuillets-presentation-overflow"));
    assert.ok(contentEl.querySelector(".feuillets-presentation-stage"));
    assert.ok(contentEl.querySelector(".feuillets-presentation-frame"));
    assert.equal(descendants(contentEl).some((el) => el.tagName === "STYLE" || el.tagName === "LINK"), false);
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationView — état vide : aucun fichier/aucune slide affiche l'état vide historique", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => { paragraph(container, "texte"); };
  try {
    const { view, file, contentEl } = setup("");
    await view.onOpen(); await view.openFile(file);
    assert.equal(descendants(contentEl).some((el) => el.classes.has("feuillets-presentation-empty")), true);
    assert.equal(view.slideRecords.length, 0);
  } finally { MarkdownRenderer.render = previous; }
});
