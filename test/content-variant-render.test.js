import test from "node:test";
import assert from "node:assert/strict";
import { applyContentVariant } from "../src/services/content-variant-render.js";

class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = { contains: (name) => this.classes.has(name), remove: (name) => this.classes.delete(name), add: (name) => this.classes.add(name) };
  }
  get textContent() { return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text; }
  set textContent(value) { this.children = []; this._text = value; }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/u).filter(Boolean)); }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index >= 0 ? this.parentElement.children[index + 1] || null : null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  remove() { if (this.parentElement) { const index = this.parentElement.children.indexOf(this); if (index >= 0) this.parentElement.children.splice(index, 1); this.parentElement = null; } }
  matches(selector) {
    const tag = selector.match(/^[a-z][a-z0-9-]*/iu)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    for (const cls of selector.matchAll(/\.([a-z0-9_-]+)/giu)) if (!this.classes.has(cls[1])) return false;
    for (const attr of selector.matchAll(/\[([a-z0-9-]+)(?:=["']?([^\]"']+)["']?)?\]/giu)) {
      if (!this.attributes.has(attr[1])) return false;
      if (attr[2] !== undefined && this.getAttribute(attr[1]) !== attr[2]) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const found = [];
    for (const part of selector.split(",").map((value) => value.trim())) {
      const tokens = part.split(/\s+/u);
      const visit = (node) => {
        for (const child of node.children) {
          if (tokens.length === 1 ? child.matches(tokens[0]) : child.matches(tokens[tokens.length - 1]) && hasAncestor(child, tokens.slice(0, -1))) found.push(child);
          visit(child);
        }
      };
      visit(this);
    }
    return [...new Set(found)];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function hasAncestor(node, tokens) {
  let current = node.parentElement;
  for (let i = tokens.length - 1; i >= 0; i--) {
    while (current && !current.matches(tokens[i])) current = current.parentElement;
    if (!current) return false;
    current = current.parentElement;
  }
  return true;
}

function root(...children) { return new FakeElement("div").append(...children); }
FakeElement.prototype.append = function append(...children) { children.forEach((child) => this.appendChild(child)); return this; };
function role(name, text = "role") {
  const el = new FakeElement("blockquote", text);
  el.setAttribute("data-callout", name);
  if (["introduction", "solution", "source", "questions", "preuve"].includes(name)) {
    el.classList.add("feuillets-semantic-role");
  }
  el.classList.add(`feuillets-role-${name}`);
  return el;
}
function variant(excludedRoles = [], questionAnswerSpace = "keep") { return { id: "v1", name: "V", excludedRoles, questionAnswerSpace }; }

test("variante absente : DOM inchangé", () => {
  const content = new FakeElement("p", "texte");
  const container = root(content);
  applyContentVariant(container, null);
  assert.equal(container.children[0], content);
  assert.equal(container.textContent, "texte");
});

test("texte ordinaire, rôle inclus et callout non canonique restent présents", () => {
  const ordinary = new FakeElement("p", "ordinaire");
  const included = role("solution", "solution");
  const ordinaryCallout = role("correction", "legacy");
  const container = root(ordinary, included, ordinaryCallout);
  applyContentVariant(container, variant(["introduction"]));
  assert.equal(container.children.length, 3);
  assert.equal(container.textContent, "ordinairesolutionlegacy");
});

test("un ou plusieurs rôles canoniques exclus disparaissent", () => {
  const container = root(role("introduction"), role("solution"), role("source"));
  container.children[0].attributes.delete("data-callout");
  container.children[1].attributes.delete("data-callout");
  container.children[2].attributes.delete("data-callout");
  applyContentVariant(container, variant(["solution", "introduction"]));
  assert.deepEqual(container.children.map((child) => child.className), ["feuillets-semantic-role feuillets-role-source"]);
});

test("les anciens rôles correction et lesson ne sont jamais filtrés", () => {
  const container = root(role("correction"), role("lesson"));
  applyContentVariant(container, variant(["solution"]));
  assert.equal(container.children.length, 2);
});

test("questions reste conservé et ses espaces sont masqués uniquement en mode hide", () => {
  const questions = role("questions");
  questions.appendChild(new FakeElement("span", "Question"));
  questions.appendChild(new FakeElement("span", "réponse"));
  const line = new FakeElement("span"); line.classList.add("feuillets-answer-line"); questions.appendChild(line);
  const space = new FakeElement("span"); space.classList.add("feuillets-answer-space"); questions.appendChild(space);
  const keep = root(questions);
  applyContentVariant(keep, variant([], "keep"));
  assert.equal(keep.children[0].children.length, 4);
  applyContentVariant(keep, variant([], "hide"));
  assert.equal(keep.children[0].children.length, 2);
  assert.equal(keep.textContent, "Questionréponse");
});

test("image d'un rôle exclu disparaît et le saut du bloc suivant reste intact", () => {
  const excluded = role("preuve");
  excluded.appendChild(new FakeElement("img"));
  const following = new FakeElement("p", "suite");
  following.classList.add("feuillets-page-break-before");
  const container = root(excluded, following);
  applyContentVariant(container, variant(["preuve"]));
  assert.equal(container.querySelector("img"), null);
  assert.equal(container.children[0].classList.contains("feuillets-page-break-before"), true);
  assert.equal(container.textContent, "suite");
});

test("variante neutre : le DOM reste strictement inchangé", () => {
  const ordinary = new FakeElement("p", "texte");
  const notes = new FakeElement("section"); notes.classList.add("footnotes");
  const item = new FakeElement("li", "note"); item.setAttribute("id", "fn1"); notes.appendChild(item);
  const container = root(ordinary, notes);
  const beforeChildren = [...container.children];
  applyContentVariant(container, variant([], "keep"));
  assert.deepEqual(container.children, beforeChildren);
  assert.equal(notes.children[0], item);
});

test("un callout non canonique reste présent même sans rôle sémantique", () => {
  const ordinaryCallout = role("correction", "legacy");
  ordinaryCallout.attributes.delete("data-callout");
  const container = root(ordinaryCallout);
  applyContentVariant(container, variant(["solution"]));
  assert.equal(container.children[0], ordinaryCallout);
});

test("note d'un rôle exclu est retirée avec sa note orpheline", () => {
  const excluded = role("source");
  const ref = new FakeElement("a"); ref.setAttribute("href", "#fn1"); excluded.appendChild(ref);
  const notes = new FakeElement("section"); notes.classList.add("footnotes");
  const item = new FakeElement("li", "note"); item.setAttribute("id", "fn1"); notes.appendChild(item);
  const container = root(excluded, notes);
  applyContentVariant(container, variant(["source"]));
  assert.equal(container.querySelector("section"), null);
});
