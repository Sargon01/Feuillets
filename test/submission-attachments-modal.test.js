import assert from "node:assert/strict";
import test from "node:test";
import { SubmissionAttachmentsModal } from "../src/ui/submission-attachments-modal.js";

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.events = new Map();
    this.checked = false;
    this.text = options.text ?? "";
    this.attributes = { ...(options.attr ?? {}) };
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

  addClass(classNames) {
    for (const className of classNames.split(" ")) this.classes.add(className);
  }

  setText(text) {
    this.text = String(text);
    return this;
  }

  addEventListener(type, callback) {
    this.events.set(type, callback);
  }
}

function allEls(el) {
  return [el, ...el.children.flatMap(allEls)];
}

function openModal(candidates, onConfirm) {
  const modal = new SubmissionAttachmentsModal({}, candidates, onConfirm);
  modal.contentEl = new FakeElement();
  modal.close = () => {};
  modal.onOpen();
  return modal;
}

function checkboxesAndLabels(modal) {
  const els = allEls(modal.contentEl);
  const rows = els.filter((e) => e.classes.has("feuillets-read-selection-row"));
  return rows.map((row) => ({
    checkbox: row.children.find((c) => c.tag === "input"),
    label: row.children.find((c) => c.tag === "span"),
  }));
}

test("SubmissionAttachmentsModal : une ligne par candidat, case cochée selon checkedByDefault", () => {
  const candidates = [
    { id: "biographie", label: "Biographie", path: "Roman1/Edition/Biographie.md", checkedByDefault: false },
  ];
  const modal = openModal(candidates, () => {});

  const rows = checkboxesAndLabels(modal);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].checkbox.checked, true);
  assert.equal(rows[0].checkbox.disabled, true);
  assert.equal(rows[0].label.text, "Manuscrit DOCX — inclus automatiquement");
  assert.equal(rows[1].checkbox.checked, false);
});

test("SubmissionAttachmentsModal : confirmer transmet uniquement les chemins cochés", () => {
  const candidates = [
    { id: "synopsis", label: "Synopsis", path: "Roman1/Edition/Synopsis.md", checkedByDefault: true },
    { id: "biographie", label: "Biographie", path: "Roman1/Edition/Biographie.md", checkedByDefault: false },
  ];
  let confirmed = null;
  const modal = openModal(candidates, (paths) => { confirmed = paths; });

  const buttons = allEls(modal.contentEl).filter((e) => e.tag === "button");
  const confirmBtn = buttons.find((b) => b.text === "Continue" || b.text === "Continuer");
  confirmBtn.events.get("click")();

  assert.deepEqual(confirmed, ["Roman1/Edition/Synopsis.md"]);
});

test("SubmissionAttachmentsModal : cocher manuellement une case supplémentaire l'inclut à la confirmation", () => {
  const candidates = [
    { id: "synopsis", label: "Synopsis", path: "Roman1/Edition/Synopsis.md", checkedByDefault: true },
    { id: "biographie", label: "Biographie", path: "Roman1/Edition/Biographie.md", checkedByDefault: false },
  ];
  let confirmed = null;
  const modal = openModal(candidates, (paths) => { confirmed = paths; });

  const rows = checkboxesAndLabels(modal);
  rows[2].checkbox.checked = true;

  const buttons = allEls(modal.contentEl).filter((e) => e.tag === "button");
  const confirmBtn = buttons.find((b) => b.text === "Continue" || b.text === "Continuer");
  confirmBtn.events.get("click")();

  assert.deepEqual(confirmed, ["Roman1/Edition/Synopsis.md", "Roman1/Edition/Biographie.md"]);
});

test("SubmissionAttachmentsModal : annuler n'appelle jamais onConfirm", () => {
  let called = false;
  const modal = openModal([], () => { called = true; });

  const buttons = allEls(modal.contentEl).filter((e) => e.tag === "button");
  const cancelBtn = buttons.find((b) => b.text === "Cancel" || b.text === "Annuler");
  cancelBtn.events.get("click")();

  assert.equal(called, false);
});

test("SubmissionAttachmentsModal : aucun candidat — manuscrit obligatoire et message d'absence affiché", () => {
  let confirmed = null;
  const modal = openModal([], (paths) => { confirmed = paths; });
  const rows = checkboxesAndLabels(modal);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].checkbox.checked, true);
  assert.equal(rows[0].checkbox.disabled, true);

  const buttons = allEls(modal.contentEl).filter((e) => e.tag === "button");
  const confirmBtn = buttons.find((b) => b.text === "Continue" || b.text === "Continuer");
  confirmBtn.events.get("click")();
  assert.deepEqual(confirmed, []);
});
