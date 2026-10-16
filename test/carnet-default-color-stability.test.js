import test from "node:test";
import assert from "node:assert/strict";
import { CarnetDefaultStylesContent } from "../src/ui/carnet-default-styles.js";
import { CarnetsContent } from "../src/ui/carnets-content.js";

class Element {
  constructor(options = {}) {
    this.children = []; this.attributes = new Map(); this.events = new Map(); this.value = options.value ?? "";
    this.ownerDocument = { activeElement: null }; this.pressedWrites = 0; this.classWrites = 0;
    this.classes = new Set((options.cls ?? "").split(" "));
    this.classList = { add: (name) => this.classes.add(name), toggle: (name, selected) => { this.classWrites++; if (selected) this.classes.add(name); else this.classes.delete(name); } };
    for (const [key, value] of Object.entries(options.attr ?? {})) this.attributes.set(key, value);
  }
  createEl(tag, options) { const child = new Element(options); child.tag = tag; this.children.push(child); return child; }
  createDiv(options) { return this.createEl("div", options); }
  createSpan(options) { return this.createEl("span", options); }
  addClass(name) { this.classes.add(name); }
  setAttribute(key, value) { if (key === "aria-pressed") this.pressedWrites++; this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  addEventListener(type, callback) { this.events.set(type, callback); }
  click() { this.events.get("click")?.(); }
  all() { return [this, ...this.children.flatMap((child) => child.all())]; }
}

function fixture(saved = {}) {
  const host = new Element(), settings = { carnetDefaultStyles: saved };
  let saves = 0;
  const content = new CarnetDefaultStylesContent(host, () => settings, async () => { saves++; content.refresh(); });
  const palette = host.all().filter((element) => element.getAttribute("data-default-field") === "cardColor");
  const choose = (color) => palette.find((button) => button.getAttribute("data-default-value") === color).click();
  const reset = () => host.all().forEach((element) => { element.pressedWrites = 0; element.classWrites = 0; });
  const writes = () => host.all().reduce((total, element) => total + element.pressedWrites, 0);
  const selected = () => palette.filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.getAttribute("data-default-value"));
  reset();
  return { host, content, settings, palette, choose, reset, writes, selected, get saves() { return saves; } };
}

test("default-to-custom, custom-to-custom and reset change each indicator once despite persistence refreshes", () => {
  const f = fixture(), mounted = f.host.all();
  for (const color of ["1", "4", ""]) {
    f.reset(); f.choose(color); f.content.refresh(); f.content.refresh();
    assert.deepEqual(f.selected(), [color]); assert.equal(f.writes(), 2);
    assert.equal(f.host.all().reduce((total, element) => total + element.classWrites, 0), 2);
    assert.equal(f.settings.carnetDefaultStyles.note?.color, color || undefined);
    assert.deepEqual(f.host.all(), mounted);
  }
  assert.equal(f.saves, 3);
});

test("rapid default color changes settle on the last preference without repeated idle mutations", () => {
  const f = fixture(), colors = ["1", "2", "3", "4", "5", "6", "", "6", "3", "1", ""];
  for (const color of colors) f.choose(color);
  assert.equal(f.saves, colors.length); assert.equal(f.writes(), colors.length * 2);
  assert.deepEqual(f.selected(), [""]); assert.deepEqual(f.settings.carnetDefaultStyles, {});
  f.reset(); for (let frame = 0; frame < 120; frame++) f.content.refresh();
  assert.equal(f.writes(), 0); assert.equal(f.saves, colors.length);
});

test("a persisted custom default restores its indicator without a settings write", () => {
  const f = fixture({ note: { color: "5" } });
  assert.deepEqual(f.selected(), ["5"]); assert.equal(f.saves, 0);
  f.content.refresh(); assert.equal(f.writes(), 0);
});

test("default subgroups collapse independently and restore their state without replacing controls", () => {
  const f = fixture(), sections = f.host.all().filter((element) => element.getAttribute("data-carnet-section"));
  assert.deepEqual(sections.map((section) => section.getAttribute("data-carnet-section")), ["defaults.cards", "defaults.connections"]);
  const [cards, connections] = sections, [cardsHead, cardsBody] = cards.children, [edgesHead, edgesBody] = connections.children;
  assert.equal(cardsHead.getAttribute("aria-expanded"), "false"); assert.equal(cardsBody.hidden, true);
  assert.equal(edgesHead.getAttribute("aria-expanded"), "false"); assert.equal(edgesBody.hidden, true);
  assert.equal(cardsHead.getAttribute("aria-controls"), cardsBody.getAttribute("id"));
  const mounted = f.host.all(), input = mounted.find((element) => element.getAttribute("data-default-field") === "size");
  input.value = "23"; input.ownerDocument.activeElement = input;
  cardsHead.click();
  assert.equal(cardsBody.hidden, false); assert.equal(edgesBody.hidden, true);
  edgesHead.click(); cardsHead.click();
  assert.equal(cardsBody.hidden, true); assert.equal(edgesBody.hidden, false);
  assert.equal(input.value, "23"); assert.deepEqual(f.host.all(), mounted);
  assert.deepEqual(f.settings.carnetDefaultStyles, {});
  const host = new Element();
  new CarnetDefaultStylesContent(host, () => f.settings, async () => {});
  const restored = host.all().filter((element) => element.getAttribute("data-carnet-section"));
  assert.deepEqual(restored.map((section) => section.children[0].getAttribute("aria-expanded")), ["false", "true"]);
});

test("default properties expose labeled native controls, reset choices and preserved values", () => {
  const f = fixture({ note: { style: "rounded", textStyle: { size: 24, align: "center" } }, edge: { geometry: "map", arrows: "both" } });
  const controls = f.host.all().filter((element) => element.tag === "select" || element.tag === "input");
  assert.equal(controls.length, 7);
  for (const control of controls) assert(control.getAttribute("aria-label"));
  for (const [field, value] of [["style", "rounded"], ["size", "24"], ["align", "center"], ["geometry", "map"], ["arrows", "both"]]) {
    assert.equal(controls.find((element) => element.getAttribute("data-default-field") === field).value, value);
  }
  assert.equal(f.saves, 0);
});

test("the five main Carnets sections retain their order and accessible section headings", () => {
  const host = new Element(), settings = { collapsed: { "carnets.manager": true } };
  new CarnetsContent({}, { settings, saveSettings: async () => {} }, host);
  const sections = host.children.filter((element) => element.getAttribute("data-carnet-section"));
  assert.deepEqual(sections.map((section) => section.getAttribute("data-carnet-section")), ["manager", "inspector", "tools", "defaults", "display"]);
  for (const section of sections) {
    const [head, body] = section.children;
    assert.equal(head.tag, "button"); assert.equal(head.getAttribute("type"), "button");
    assert.equal(head.getAttribute("aria-controls"), body.getAttribute("id"));
    assert(head.children[0].icon); assert.match(head.children[2].icon, /^chevron-/);
    const wasHidden = body.hidden;
    head.click(); assert.equal(body.hidden, !wasHidden); assert.equal(head.getAttribute("aria-expanded"), String(wasHidden));
  }
});
