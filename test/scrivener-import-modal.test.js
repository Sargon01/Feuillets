import test from "node:test";
import assert from "node:assert/strict";
import { Notice, Platform } from "obsidian";
import { ScrivenerImportModal } from "../src/ui/scrivener-import-modal.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.attributes = options.attr ?? {};
    this.text = options.text ?? "";
    this.value = options.value ?? "";
    if (options.cls) this.addClass(options.cls);
  }

  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(names) { for (const name of names.split(" ")) this.classes.add(name); }
  removeClass() {}
  addEventListener(name, callback) { this.events.set(name, callback); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attributes[name] = value; }
  empty() { this.children = []; }
}

function allElements(element) { return [element, ...element.children.flatMap(allElements)]; }

test("ScrivenerImportModal.analyze : refuse proprement hors desktop (aucun require Node)", async () => {
  const modal = new ScrivenerImportModal({}, {});
  modal.contentEl = new FakeElement();
  modal.showForm();

  const inputs = allElements(modal.contentEl).filter((el) => el.tag === "input");
  const scrivInput = inputs[0];
  const nameInput = inputs[1];
  scrivInput.value = "/Users/toi/Documents/Mon Roman.scriv";
  nameInput.value = "Mon Roman";

  const analyzeBtn = allElements(modal.contentEl).find((el) => el.tag === "button" && el.text === "Analyser le projet");
  assert.ok(analyzeBtn, "bouton Analyser introuvable");

  const notices = [];
  Notice.onCreate = (message) => notices.push(message);
  const previousDesktop = Platform.isDesktop;
  Platform.isDesktop = false;
  try {
    await analyzeBtn.events.get("click")();
    assert.equal(notices.length, 1);
    assert.match(notices[0], /indisponible/i);
  } finally {
    Platform.isDesktop = previousDesktop;
    Notice.onCreate = null;
  }
});
