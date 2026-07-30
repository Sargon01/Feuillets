import test from "node:test";
import assert from "node:assert/strict";
import { ScriveningsManager } from "../src/views/scrivenings-editor.js";

class FakeElement {
  constructor(tagName, text = "") {
    this.tagName = tagName.toUpperCase();
    this._text = text;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.offsetTop = 42;
  }

  set textContent(value) { this._text = value; }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options.text || ""); return this.appendChild(child); }
  createSpan(options = {}) { return this.createEl("span", options); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) { this.children.splice(index, 1); child.parentNode = null; } return child; }
}

function installDom() {
  const previousDocument = globalThis.document;
  const previousCreateDiv = globalThis.createDiv;
  const previousGetComputedStyle = globalThis.getComputedStyle;
  const body = new FakeElement("body");
  globalThis.document = {
    body,
    createTextNode(text) { return { nodeType: 3, text }; },
  };
  globalThis.createDiv = () => new FakeElement("div");
  globalThis.getComputedStyle = () => ({
    boxSizing: "border-box", width: "400px", paddingTop: "4px", paddingRight: "4px",
    paddingBottom: "4px", paddingLeft: "4px", borderTopWidth: "1px", borderRightWidth: "1px",
    borderBottomWidth: "1px", borderLeftWidth: "1px", fontFamily: "monospace", fontSize: "14px",
    fontWeight: "400", lineHeight: "1.5", letterSpacing: "normal",
  });
  return {
    body,
    restore() {
      globalThis.document = previousDocument;
      globalThis.createDiv = previousCreateDiv;
      globalThis.getComputedStyle = previousGetComputedStyle;
    },
  };
}

test("measureCaretOffsetTop : construit un clone détaché, mesure et nettoie document.body", () => {
  const dom = installDom();
  try {
    const manager = new ScriveningsManager({}, new FakeElement("div"), () => {});
    const textarea = new FakeElement("textarea");
    textarea.value = "Bonjour tout le monde";

    const top = manager.measureCaretOffsetTop(textarea, 7);

    assert.equal(top, 42);
    assert.equal(dom.body.children.length, 0);
  } finally {
    dom.restore();
  }
});
