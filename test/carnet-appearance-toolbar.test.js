import test from "node:test";
import assert from "node:assert/strict";
import { attachAppearanceToolbar } from "../src/carnet/canvas/appearance-toolbar.js";
import { setLocale } from "../src/i18n/index.js";

setLocale("en");

class Element {
  constructor(tag = "div", options = {}) {
    this.tag = tag; this.children = []; this.parentElement = null; this.attrs = { ...options.attr }; this.events = new Map();
    this.textContent = options.text ?? ""; this.classes = new Set((options.cls ?? "").split(" "));
    this.classList = { add: (v) => this.classes.add(v), remove: (v) => this.classes.delete(v), toggle: (v, on) => on ? this.classes.add(v) : this.classes.delete(v) };
  }
  get isConnected() { return this.root || !!this.parentElement?.isConnected; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  createEl(tag, options) { return this.appendChild(new Element(tag, options)); }
  createDiv(options) { return this.createEl("div", options); }
  createSvg(tag, options) { return this.createEl(tag, options); }
  createSpan(options) { return this.createEl("span", options); }
  remove() { const parent = this.parentElement; if (parent) parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null; }
  replaceWith(next) { const parent = this.parentElement; next.remove(); parent.children.splice(parent.children.indexOf(this), 1, next); next.parentElement = parent; this.parentElement = null; }
  querySelector() { return this.children.find((child) => child.attrs.native === "direction") ?? null; }
  removeEventListener(event) { this.events.delete(event); }
  empty() { for (const child of [...this.children]) child.remove(); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(event, callback) { this.events.set(event, callback); }
  click() { this.events.get("click")?.(); }
}
const walk = (el) => [el, ...el.children.flatMap(walk)];
const byClass = (el, cls) => walk(el).filter((e) => e.classes.has(cls));

function fixture() {
  const clone = (v) => structuredClone(v), data = { nodes: ["a", "b"].map((id, i) => ({ id, type: "text", text: "**Bold** and [link](target)", x: i * 300, y: 0, width: 200, height: 100, unknown: true })), edges: [{ id: "ab", fromNode: "a", toNode: "b", toEnd: "none" }] };
  const canvas = { nodes: new Map(), edges: new Map(), selection: new Set(), saves: 0, history: [clone(data)], index: 0,
    getData() { return { nodes: [...this.nodes.values()].map((n) => n.getData()), edges: [...this.edges.values()].map((e) => e.getData()) }; },
    importData(d) { for (const n of d.nodes) this.nodes.get(n.id).setData(n); for (const e of d.edges) this.edges.get(e.id).setData(e); },
    requestSave(addHistory) { assert.equal(addHistory, false); this.saves++; }, markDirty() {},
    pushHistory(d) { this.history.splice(++this.index); this.history.push(clone(d)); },
    undo() { this.importData(this.history[--this.index]); }, redo() { this.importData(this.history[++this.index]); },
  };
  canvas.requestPushHistory = Object.assign(() => {}, { run() {}, cancel() {} });
  for (const kind of ["nodes", "edges"]) for (const raw of data[kind]) canvas[kind].set(raw.id, { raw: clone(raw), getData() { return clone(this.raw); }, setData(d) { this.raw = clone(d); } });
  const menuEl = new Element(); menuEl.root = true;
  canvas.menu = { menuEl, render(changed) { if (changed) { menuEl.empty(); for (const name of ["remove", "color", "zoom"]) menuEl.createEl("button", { attr: { native: name } }); if ([...canvas.selection].some((target) => canvas.edges.get(target.getData().id) === target)) menuEl.createEl("button", { attr: { native: "direction" } }); } } };
  const original = canvas.menu.render; let active = true, refreshed = 0;
  const binding = attachAppearanceToolbar(canvas, () => refreshed++, () => active);
  const select = (...targets) => { canvas.selection = new Set(targets); canvas.menu.render(true); };
  const button = () => byClass(menuEl, "feuillets-appearance-button")[0];
  const panel = () => byClass(menuEl, "feuillets-appearance-panel")[0];
  const change = (field, value) => { const option = walk(panel()).find((e) => e.attrs["data-appearance-field"] === field && e.attrs["data-appearance-value"] === value); assert(option); option.click(); };
  return { canvas, menuEl, binding, select, button, panel, change, original, setActive(v) { active = v; }, get refreshed() { return refreshed; } };
}
for (const kind of ["note", "edge"]) test(`${kind} icon choices apply immediately, remain open and create separate native history actions`, () => {
  const f = fixture(), c = f.canvas, target = kind === "note" ? c.nodes.get("a") : c.edges.get("ab");
  f.select(target); const before = c.getData(); assert.equal(f.button().attrs["data-appearance-kind"], kind);
  assert.deepEqual(f.menuEl.children.filter((e) => e.attrs.native).map((e) => e.attrs.native), ["remove", "color", "zoom"]);
  f.button().click(); const panel = f.panel(); assert(panel);
  const controls = byClass(panel, "feuillets-appearance-option"); assert.equal(controls.length, kind === "note" ? 5 : 10);
  assert(controls.every((button) => button.attrs["aria-label"] && button.textContent === "" && (button.children.length || button.icon)));
  assert.equal(walk(panel).filter((e) => e.tag === "select" || e.attrs["data-appearance-field"] === "color").length, 0);
  if (kind === "note") {
    f.change("style", "plain"); assert.equal(c.saves, 0);
    f.change("style", "rounded"); assert.equal(c.saves, 1); assert.deepEqual(c.getData().nodes[0], { ...before.nodes[0], feuillets_note_style: "rounded" });
    f.change("style", "rounded"); assert.equal(c.saves, 1);
    f.change("style", "filled"); assert.equal(c.saves, 2);
    assert.deepEqual(c.getData().edges, before.edges);
  } else {
    f.change("pattern", "dashed"); assert.equal(c.saves, 0);
    f.change("pattern", "dotted"); assert.equal(c.saves, 1);
    f.change("width", "thick"); assert.equal(c.saves, 2);
    f.change("arrows", "both"); assert.equal(c.saves, 3);
    f.change("arrows", "both"); assert.equal(c.saves, 3);
    const edge = c.getData().edges[0]; assert.deepEqual(edge.feuillets_edge_style, { pattern: "dotted", width: "thick" }); assert.equal(edge.fromEnd, "arrow"); assert.equal(edge.toEnd, "arrow");
    assert.deepEqual(c.getData().nodes, before.nodes);
  }
  const after = c.getData(); assert.equal(f.panel(), panel);
  c.undo(); c.menu.render(true); assert.equal(f.panel(), panel); assert.notDeepEqual(c.getData(), after);
  c.redo(); c.menu.render(true); assert.equal(f.panel(), panel); assert.deepEqual(c.getData(), after);
  for (const group of byClass(panel, "feuillets-appearance-row")) assert.equal(group.children.filter((e) => e.attrs["aria-pressed"] === "true").length, 1);
  assert.equal(c.getData().nodes[0].color, undefined);
  f.binding.cleanup(); assert.equal(c.menu.render, f.original); assert.equal(byClass(f.menuEl, "feuillets-appearance-button").length, 0);
  assert.equal(f.menuEl.children.filter((e) => e.attrs.native === "direction").length, kind === "edge" ? 1 : 0);
});
test("line previews distinguish patterns, widths and all four arrow configurations", () => {
  const f = fixture(); f.select(f.canvas.edges.get("ab")); f.button().click();
  const controls = byClass(f.panel(), "feuillets-appearance-option");
  const paths = (field) => controls.filter((e) => e.attrs["data-appearance-field"] === field).map((e) => walk(e).filter((e) => e.tag === "path"));
  assert.deepEqual(paths("pattern").map((p) => p[0].attrs["stroke-dasharray"]), ["none", "4 3", "0.5 4"]);
  assert.deepEqual(paths("width").map((p) => p[0].attrs["stroke-width"]), ["1.25", "2", "3"]);
  assert.deepEqual(paths("arrows").map((p) => p.length), [1, 2, 2, 3]);
});
test("outside pointer events and selection changes close the panel without duplicate native controls", () => {
  const f = fixture(), c = f.canvas, a = c.nodes.get("a"), edge = c.edges.get("ab");
  f.select(a); f.button().click(); const nativeColor = f.menuEl.children.find((e) => e.attrs.native === "color");
  f.menuEl.events.get("pointerdown")({ composedPath: () => [nativeColor, f.menuEl] }); assert(!f.panel());
  f.button().click(); f.select(edge); assert(!f.panel()); assert.equal(f.button().attrs["data-appearance-kind"], "edge");
  f.button().click(); const panel = f.panel();
  for (let i = 0; i < 12; i++) { c.menu.render(true); f.binding.refresh(); assert.equal(f.panel(), panel); assert.equal(byClass(f.menuEl, "feuillets-appearance-button").length, 1); assert.equal(f.menuEl.children.filter((e) => e.attrs.native === "color").length, 1); }
  f.setActive(false); f.binding.refresh(); assert(!f.panel());
  f.setActive(true); f.button().click(); c.isDragging = true; c.menu.render(); assert(!f.panel()); assert(!f.button());
  f.binding.cleanup(); f.binding.cleanup(); assert.equal(c.menu.render, f.original); assert.equal(f.menuEl.events.has("pointerdown"), false);
});
test("unsupported selections are excluded and native direction controls remain available", () => {
  const f = fixture(), c = f.canvas, a = c.nodes.get("a"), b = c.nodes.get("b");
  for (const metadata of [{ type: "file" }, { type: "group" }, { feuillets_plan_version: 2 }, { feuillets_block_id: "map" }]) {
    const original = a.getData(); Object.assign(a.raw, metadata); f.select(a); assert(!f.button()); a.setData(original);
  }
  f.select(a, b); assert(!f.button()); f.select(); assert(!f.button());
  c.edges.get("ab").raw.feuillets_managed = "mindmap"; f.select(c.edges.get("ab")); assert(!f.button());
  assert.equal(f.menuEl.children.filter((e) => e.attrs.native === "direction").length, 1);
  assert.equal(attachAppearanceToolbar({}, () => {}, () => true), null);
});

test("typography controls preserve native card color, apply successive choices and disappear for other selections", () => {
  const f = fixture(), c = f.canvas; f.select(c.nodes.get("a"));
  const typography = () => byClass(f.menuEl, "feuillets-typography-button");
  assert.equal(typography().length, 1); typography()[0].click();
  f.change("size", "increase"); f.change("align", "justify"); f.change("textColor", "red");
  assert.deepEqual(c.nodes.get("a").getData().feuillets_text_style, { size: 18, align: "justify", color: "red" });
  assert.equal(c.saves, 3); assert.equal(c.nodes.get("a").getData().color, undefined);
  f.change("textColor", "red"); assert.equal(c.saves, 3);
  f.change("size", "decrease"); assert.equal(c.nodes.get("a").getData().feuillets_text_style.size, undefined);
  f.change("size", "default"); f.change("align", "left"); f.change("textColor", "default");
  assert.equal(c.nodes.get("a").getData().feuillets_text_style, undefined);
  for (let i = 0; i < 5; i++) { c.menu.render(true); assert.equal(typography().length, 1); }
  f.select(c.edges.get("ab")); assert.equal(typography().length, 0); assert(!f.panel());
  f.select(c.nodes.get("a"), c.nodes.get("b")); assert.equal(typography().length, 0);
  f.binding.cleanup(); assert.equal(typography().length, 0);
});
