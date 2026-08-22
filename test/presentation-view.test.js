import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { MarkdownRenderer, TFile } from "obsidian";
import { PresentationView } from "../src/views/presentation-view.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.classes = new Set(); this.style = { setProperty(name, value) { this[name] = value; } };
    this.text = options.text || ""; this.events = new Map(); this.attrs = new Map(); this.disabled = false;
    this.clientWidth = 1280; this.clientHeight = 720; this.scrollWidth = 1280; this.scrollHeight = 720;
    if (options.cls) this.className = options.cls;
    this.classList = { add: (...names) => names.forEach((name) => this.classes.add(name)), remove: (...names) => names.forEach((name) => this.classes.delete(name)), toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name) };
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.appendChild(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.remove?.(); child.parentElement = this; this.children.push(child); return child; }
  get childNodes() { return this.children; }
  querySelector(selector) {
    const names = selector.split(",").map((value) => value.trim().toUpperCase());
    return descendants(this).slice(1).find((child) => names.includes(child.tagName)) || null;
  }
  querySelectorAll(selector) {
    const names = selector.split(",").map((value) => value.trim().toUpperCase());
    return descendants(this).slice(1).filter((child) => names.includes(child.tagName));
  }
  remove() { if (!this.parentElement) return; const i = this.parentElement.children.indexOf(this); if (i >= 0) this.parentElement.children.splice(i, 1); this.parentElement = null; }
  empty() { this.children = []; this.text = ""; }
  setText(value) { this.text = String(value); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
}

function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

function setup(markdown) {
  const contentEl = new FakeElement();
  const file = new TFile("Cours.md", markdown);
  const app = { vault: { read: async (target) => target.content, on: () => ({}) } };
  const view = new PresentationView({ app, contentEl });
  return { view, file, contentEl };
}

test("PresentationView : rend trois slides et borne la navigation", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    container.createEl("h1", { text: markdown.trim() });
  };
  try {
    const { view, file, contentEl } = setup("# Un\n---\n# Deux\n---\n# Trois");
    await view.onOpen(); await view.openFile(file);
    const counter = descendants(contentEl).find((el) => el.classes.has("feuillets-presentation-counter"));
    assert.equal(counter.text, "1 / 3");
    await view.next(); assert.equal(counter.text, "2 / 3");
    await view.previous(); await view.previous(); assert.equal(counter.text, "1 / 3");
    await view.last(); await view.next(); assert.equal(counter.text, "3 / 3");
    await view.first(); assert.equal(counter.text, "1 / 3");
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationView : affiche l'état vide et marque l'overflow", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, _markdown, container) => {
    container.createEl("p", { text: "Trop long" });
    container.scrollHeight = 900;
  };
  try {
    const { view, file, contentEl } = setup("");
    await view.onOpen(); await view.openFile(file);
    assert.equal(descendants(contentEl).some((el) => el.text === "Aucune diapositive"), true);
    file.content = "Texte";
    await view.openFile(file);
    assert.equal(descendants(contentEl).some((el) => el.classes.has("feuillets-presentation-has-overflow")), true);
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationView : les zones média bornent les images sans masquer un vrai overflow", async () => {
  const css = await readFile("styles.css", "utf8");
  assert.match(css, /presentation-layout-media-text \.feuillets-presentation-inner \{ display: grid; grid-template-columns: minmax\(0, 45fr\) minmax\(0, 55fr\); grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(css, /presentation-layout-media-text \.feuillets-presentation-media img \{ max-width: min\(calc\(100% \* var\(--feuillets-presentation-media-scale\)\), var\(--feuillets-presentation-explicit-width, 100%\)\);/);
  assert.match(css, /presentation-layout-media \.feuillets-presentation-inner \{ display: grid; grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(css, /presentation-layout-gallery \.feuillets-presentation-inner \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(css, /\.feuillets-presentation-inner img \{ display: block; max-width: min\(calc\(100% \* var\(--feuillets-presentation-media-scale\)\)/);
});

test("PresentationView : media-questions place les portraits courts à gauche et les cartes ou longues listes en pile", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    container.createEl("h1", { text: "Titre" });
    const media = container.createEl("p");
    const image = media.createEl("img");
    [image.naturalWidth, image.naturalHeight] = markdown.includes("carte") ? [1600, 900] : [600, 900];
    const list = container.createEl("ol");
    const count = markdown.includes("longue") ? 8 : 4;
    for (let index = 0; index < count; index++) list.createEl("li", { text: `Question ${index + 1}` });
  };
  try {
    const { view, file, contentEl } = setup("portrait");
    await view.onOpen(); await view.openFile(file);
    const inner = descendants(contentEl).find((element) => element.classes.has("feuillets-presentation-inner"));
    assert.equal(inner.classes.has("feuillets-presentation-media-questions-side"), true);
    file.content = "carte";
    await view.openFile(file);
    assert.equal(inner.classes.has("feuillets-presentation-media-questions-stacked"), true);
    file.content = "longue";
    await view.openFile(file);
    assert.equal(inner.classes.has("feuillets-presentation-media-questions-stacked"), true);
    assert.equal(descendants(inner).filter((element) => element.tagName === "IMG").length, 1);
    assert.equal(descendants(inner).filter((element) => element.tagName === "LI").length, 8);
  } finally { MarkdownRenderer.render = previous; }
});

test("PresentationView : le fit continu retient le premier candidat et conserve le warning au dernier", async () => {
  const previous = MarkdownRenderer.render;
  MarkdownRenderer.render = async (_app, markdown, container) => {
    const media = container.createEl("p");
    const image = media.createEl("img");
    image.complete = true;
    Object.defineProperty(container, "scrollHeight", { configurable: true, get() {
      const style = container.parentElement.style;
      if (markdown === "fit" && style["--feuillets-presentation-media-scale"] === "0.85") return 720;
      return 722;
    } });
  };
  try {
    const { view, file, contentEl } = setup("fit");
    await view.onOpen(); await view.openFile(file);
    const slide = descendants(contentEl).find((element) => element.classes.has("feuillets-presentation-slide"));
    assert.equal(slide.style["--feuillets-presentation-media-scale"], "0.85");
    assert.equal(slide.style["--feuillets-presentation-body-size"], "32px");
    assert.equal(slide.classes.has("feuillets-presentation-has-overflow"), false);
    file.content = "never";
    await view.openFile(file);
    assert.equal(slide.style["--feuillets-presentation-media-scale"], "0.35");
    assert.equal(slide.style["--feuillets-presentation-body-size"], "18px");
    assert.equal(slide.classes.has("feuillets-presentation-has-overflow"), true);
  } finally { MarkdownRenderer.render = previous; }
});
