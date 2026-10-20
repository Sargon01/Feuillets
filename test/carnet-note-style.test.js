import test from "node:test";
import assert from "node:assert/strict";
import { applyNoteAppearance, applyNoteStyle, attachCarnetNoteStyles, isFreeNote, registerCarnetNoteStyleMenu } from "../src/carnet/canvas/note-style.js";
import { Menu } from "obsidian";
import { t } from "../src/i18n/index.js";
import { normalizeTextStyle } from "../src/carnet/canvas/text-style.js";

const clone = (value) => structuredClone(value);
function fixture() {
  const original = { nodes: ["a", "b", "c", "d"].map((id, index) => ({ id, type: "text", text: "**Bold** *italic* [link](target)\n\n- First\n- Second", x: index * 300, y: 30, width: 240, height: 180, custom: { retained: true } })), edges: [], customRoot: "retained" };
  const canvas = { nodes: new Map(), history: [clone(original)], index: 0, saves: 0,
    getData() { return { ...clone(original), nodes: [...this.nodes.values()].map((node) => clone(node.raw)) }; },
    importData(data) { for (const raw of data.nodes) { const node = this.nodes.get(raw.id); if (node) node.setData(clone(raw)); } },
    requestSave() { this.saves++; },
    pushHistory(data) { this.history.splice(++this.index); this.history.push(clone(data)); },
    undo() { this.importData(this.history[--this.index], true); },
    redo() { this.importData(this.history[++this.index], true); },
  };
  canvas.requestPushHistory = Object.assign(() => {}, { run() {}, cancel() {} });
  for (const raw of original.nodes) {
    const classes = new Set();
    canvas.nodes.set(raw.id, { id: raw.id, raw: clone(raw), getData() { return clone(this.raw); }, setData(data) { this.raw = clone(data); }, nodeEl: { classList: { toggle(name, on) { on ? classes.add(name) : classes.delete(name); }, remove(...names) { names.forEach((name) => classes.delete(name)); } } }, classes });
  }
  return canvas;
}

test("four independent styles preserve all Markdown and unknown properties, default removes only the style", () => {
  const canvas = fixture();
  const before = canvas.getData();
  const binding = attachCarnetNoteStyles(canvas);
  for (const [index, style] of ["plain", "outline", "rounded", "filled"].entries()) {
    const id = before.nodes[index].id;
    assert.equal(applyNoteStyle(canvas, id, style), true);
    binding.refresh();
    assert.equal(canvas.nodes.get(id).classes.has(`feuillets-note-${style}`), true);
  }
  for (const raw of canvas.getData().nodes) { const { feuillets_note_style, ...rest } = raw; assert.deepEqual(rest, before.nodes.find((n) => n.id === raw.id)); }
  assert.equal(canvas.saves, 4);
  assert.equal(applyNoteStyle(canvas, "a", "plain"), true);
  assert.equal(canvas.saves, 4);
  assert.equal(canvas.history.length, 5);
  assert.equal(applyNoteStyle(canvas, "a", undefined), true);
  binding.refresh();
  assert.deepEqual(canvas.nodes.get("a").getData(), before.nodes[0]);
  assert.deepEqual([...canvas.nodes.get("a").classes], ["feuillets-note-plain"]);
});

test("native history and reopening restore styles and cleanup restores the import method", () => {
  const canvas = fixture();
  const originalImport = canvas.importData;
  const binding = attachCarnetNoteStyles(canvas);
  const instance = canvas.nodes.get("a");
  applyNoteStyle(canvas, "a", "plain"); binding.refresh();
  canvas.undo();
  assert.deepEqual([...instance.classes], ["feuillets-note-plain"]);
  canvas.redo();
  assert.equal(instance.classes.has("feuillets-note-plain"), true);
  assert.equal(canvas.nodes.get("a"), instance);
  const persisted = JSON.parse(JSON.stringify(canvas.getData()));
  const reopened = fixture(); reopened.importData(persisted);
  const reopenedBinding = attachCarnetNoteStyles(reopened); reopenedBinding.refresh();
  assert.equal(reopened.nodes.get("a").classes.has("feuillets-note-plain"), true);
  binding.cleanup(); binding.cleanup(); reopenedBinding.cleanup();
  assert.equal(canvas.importData, originalImport);
  assert.equal(instance.classes.size, 0);
  assert.equal(instance.getData().feuillets_note_style, "plain");
});

test("structural nodes and incomplete or readonly runtimes are left untouched", () => {
  for (const metadata of [{ type: "group" }, { feuillets_plan_version: 1 }, { feuillets_block_id: "block" }, { feuillets_managed: "manuscript" }, { feuillets_internal: true }, { mindmapCollapsed: [] }]) {
    const canvas = fixture(); Object.assign(canvas.nodes.get("a").raw, metadata);
    assert.equal(applyNoteStyle(canvas, "a", "plain"), false);
    assert.equal(canvas.saves, 0);
  }
  const canvas = fixture(); canvas.readonly = true;
  assert.equal(applyNoteStyle(canvas, "a", "plain"), false);
  delete canvas.pushHistory;
  assert.equal(attachCarnetNoteStyles(canvas), null);
  assert.equal(applyNoteStyle(canvas, "a", "plain"), false);
  assert.equal(isFreeNote({ nodes: [], edges: [{ id: "structural", fromNode: "a", feuillets_block_id: "block" }] }, { id: "a", type: "text" }), false);
});


test("missing appearance means plain without migrating data, and classic is an explicit native-card choice", () => {
  const canvas = fixture(), before = canvas.getData();
  const binding = attachCarnetNoteStyles(canvas); binding.refresh();
  assert.equal(canvas.nodes.get("a").classes.has("feuillets-note-plain"), true);
  assert.deepEqual(canvas.getData(), before);
  assert.equal(canvas.saves, 0);
  assert.equal(applyNoteStyle(canvas, "a", "classic"), true); binding.refresh();
  assert.deepEqual([...canvas.nodes.get("a").classes], ["feuillets-note-classic"]);
  canvas.nodes.get("a").raw.feuillets_note_width = "manual";
  assert.equal(isFreeNote(canvas.getData(), canvas.nodes.get("a").raw), true);
  binding.cleanup();
});

test("native history imports notify appearance controls without waiting for a toolbar render", () => {
  const canvas = fixture(), updates = [];
  const binding = attachCarnetNoteStyles(canvas, () => updates.push(canvas.nodes.get("a").getData().feuillets_note_style));
  applyNoteStyle(canvas, "a", "rounded"); binding.refresh();
  assert.equal(updates.at(-1), "rounded");
  const count = updates.length;
  canvas.undo(); assert.equal(updates.length, count + 1); assert.equal(updates.at(-1), undefined);
  canvas.redo(); assert.equal(updates.length, count + 2); assert.equal(updates.at(-1), "rounded");
  binding.cleanup();
});

test("independent typography uses one native transaction, normalizes defaults and preserves content and card color", () => {
  const c = fixture(), before = c.getData();
  c.nodes.get("a").raw.color = "4";
  assert(applyNoteAppearance(c, "a", { textStyle: { size: 24, align: "center", color: "purple" } }));
  assert.equal(c.saves, 1); assert.equal(c.history.length, 2);
  assert.deepEqual(c.nodes.get("a").getData(), { ...before.nodes[0], color: "4", feuillets_text_style: { size: 24, align: "center", color: "purple" } });
  assert(isFreeNote(c.getData(), c.nodes.get("a").getData()));
  assert.deepEqual(c.nodes.get("b").getData(), before.nodes[1]);
  applyNoteAppearance(c, "a", { textStyle: { size: 24, align: "center", color: "purple" } }); assert.equal(c.saves, 1);
  const saved = c.getData(); c.undo(); assert.equal(c.nodes.get("a").getData().feuillets_text_style, undefined);
  c.redo(); assert.deepEqual(c.getData(), saved);
  const reopened = fixture(); reopened.importData(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reopened.nodes.get("a").getData().feuillets_text_style, { size: 24, align: "center", color: "purple" });
  applyNoteAppearance(c, "a", { textStyle: { align: "left" } }); assert.equal(c.nodes.get("a").getData().feuillets_text_style, undefined);
  applyNoteAppearance(c, "a", { textStyle: undefined }); assert.equal(c.saves, 2);
});

function menuFixture() {
  const canvas = fixture(), file = { path: "Carnet.canvas" }, events = new Map(), registered = [];
  canvas.view = { file };
  for (const node of canvas.nodes.values()) node.canvas = canvas;
  const binding = attachCarnetNoteStyles(canvas);
  registerCarnetNoteStyleMenu({ app: { workspace: { on(name, callback) { events.set(name, callback); return { name }; } } }, registerEvent(ref) { registered.push(ref); } }, (candidate) => candidate === file, () => binding.refresh());
  const open = (node = canvas.nodes.get("a"), menu = new Menu()) => { events.get("canvas:node-menu")(menu, node); return menu; };
  const options = () => open().items[0].submenu.items.filter((item) => !item.separator);
  const choice = (name) => options().find((item) => item.title === t(`carnet.noteStyle.menu.${name}`));
  return { canvas, file, events, registered, binding, open, options, choice };
}

test("native note menu preserves native actions, marks implicit plain and adds no data or duplicate entries", () => {
  const f = menuFixture(), before = f.canvas.getData(), menu = new Menu();
  menu.addItem((item) => item.setTitle("Native action").onClick(() => {}));
  const native = menu.items[0]; f.open(undefined, menu); f.open(undefined, menu);
  assert.equal(menu.items.length, 3); assert.equal(menu.items[0], native);
  assert.equal(menu.items[1].title, t("carnet.noteStyle.menu"));
  assert.deepEqual(f.options().map((item) => item.title), ["plain", "outline", "rounded", "filled", "defaultColor", "red", "orange", "yellow", "green", "cyan", "purple"].map((name) => t(`carnet.noteStyle.menu.${name}`)));
  assert.equal(f.choice("plain").checked, true); assert.equal(f.choice("defaultColor").checked, true);
  assert.deepEqual(f.canvas.getData(), before); assert.equal(f.canvas.saves, 0);
  for (let i = 0; i < 5; i++) f.binding.refresh();
  assert.equal(f.open().items.length, 2); assert.deepEqual([...f.events.keys()], ["canvas:node-menu"]); assert.equal(f.registered.length, 1);
  f.canvas.nodes.get("a").raw.feuillets_note_style = "classic";
  assert(f.options().slice(0, 4).every((item) => !item.checked));
  assert.equal(f.canvas.nodes.get("a").raw.feuillets_note_style, "classic");
  f.binding.cleanup();
});

test("native note appearance and palette choices preserve content, dimensions, typography and stack metadata with history and reopening", () => {
  const f = menuFixture(), c = f.canvas;
  Object.assign(c.nodes.get("a").raw, { feuillets_stack: { id: "stack", order: 0 }, feuillets_text_style: { align: "center", size: 20 }, color: "4" });
  const original = c.getData(); c.history[0] = clone(original);
  for (const [name, patch] of [
    ...["plain", "outline", "rounded", "filled"].map((style) => [style, { feuillets_note_style: style }]),
    ...["red", "orange", "yellow", "green", "cyan", "purple"].map((color, index) => [color, { color: String(index + 1) }]),
    ["defaultColor", { color: undefined }],
  ]) {
    const before = c.getData(), previous = before.nodes[0], index = c.index;
    f.choice(name).click(); const after = c.getData();
    const expected = { ...previous, ...patch }; if (expected.color === undefined) delete expected.color;
    assert.deepEqual(after, { ...before, nodes: [expected, ...before.nodes.slice(1)] });
    assert.equal(c.index, index + 1); assert.equal(f.choice(name).checked, true);
    assert.equal(f.options().slice(0, 4).filter((item) => item.checked).length, 1);
    assert.equal(f.options().slice(4).filter((item) => item.checked).length, 1);
    assert(c.nodes.get("a").classes.has(`feuillets-note-${expected.feuillets_note_style}`));
    c.undo(); assert.deepEqual(c.getData(), before); c.redo(); assert.deepEqual(c.getData(), after);
    const reopened = fixture(); reopened.importData(JSON.parse(JSON.stringify(after))); assert.deepEqual(reopened.getData(), after);
    f.choice(name).click(); assert.equal(c.index, index + 1);
  }
  f.binding.cleanup();
});

test("native note menus exclude structural nodes, ordinary Canvases, readonly views and stale targets", () => {
  const f = menuFixture(), c = f.canvas, node = c.nodes.get("a"), raw = node.getData();
  for (const metadata of [{ type: "group" }, { feuillets_plan_version: 2 }, { feuillets_block_id: "mindmap" }, { mindmapCollapsed: [] }, { feuillets_managed: "relations" }, { feuillets_block: "relations" }, { feuillets_relation: "parent-child" }, { feuillets_internal: true }]) {
    node.raw = { ...raw, ...metadata }; assert.equal(f.open().items.length, 0);
  }
  node.raw = raw;
  const staleChoice = f.choice("rounded"), before = c.getData();
  c.view.file = { path: "Ordinary.canvas" }; assert.equal(f.open().items.length, 0); staleChoice.click(); assert.deepEqual(c.getData(), before);
  c.view.file = f.file; c.readonly = true; assert.equal(f.open().items.length, 0); staleChoice.click(); assert.deepEqual(c.getData(), before);
  c.readonly = false; c.nodes.set("a", { ...node }); assert.equal(f.open(node).items.length, 0); staleChoice.click(); assert.deepEqual(c.getData(), before);
  c.nodes.set("a", node); node.raw = { ...raw, feuillets_block_id: "new-structural-owner" }; const structural = c.getData();
  staleChoice.click(); assert.deepEqual(c.getData(), structural);
  f.binding.cleanup();
});

function typographyFixture() {
  const f = menuFixture(); let themeSize = 18;
  f.canvas.nodes.get("a").contentEl = { ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: () => String(themeSize) }) } } };
  const typography = () => f.open().items.find((item) => item.title === t("carnet.typography.title"))?.submenu;
  const group = (index) => typography().items[index].submenu;
  const choice = (index, title) => group(index).items.find((item) => item.title === title);
  return { ...f, typography, group, choice, setThemeSize(size) { themeSize = size; } };
}

test("native typography size menu is compact, checks intermediate sizes and supports exact one-pixel steps and theme reset", () => {
  const f = typographyFixture(), c = f.canvas, node = c.nodes.get("a");
  const step = (direction) => f.choice(0, t(`carnet.typography.${direction}One`));
  assert.equal(f.typography().items[0].title, t("carnet.typography.menuSize", { size: "18" }));
  step("increase").click(); assert.deepEqual(node.raw.feuillets_text_style, { size: 19 });
  assert.equal(f.choice(0, "19 px").checked, true); assert(f.group(0).items.length < 16);
  step("decrease").click(); assert.equal(node.raw.feuillets_text_style, undefined);
  f.choice(0, "12 px").click(); assert.equal(step("decrease").disabled, true);
  for (let size = 13; size <= 40; size++) {
    step("increase").click(); assert.equal(node.raw.feuillets_text_style?.size ?? 18, size);
  }
  assert.equal(step("increase").disabled, true);
  const entries = c.history.length; step("increase").click(); assert.equal(c.history.length, entries);
  f.choice(0, t("carnet.typography.defaultSize")).click(); assert.equal(node.raw.feuillets_text_style, undefined);
  f.setThemeSize(20); assert.equal(f.typography().items[0].title, t("carnet.typography.menuSize", { size: "20" }));
  assert.equal(f.choice(0, t("carnet.typography.defaultSize")).checked, true);
  assert.deepEqual(f.typography().items.slice(1).map((item) => item.title), [t("carnet.typography.alignment"), t("carnet.typography.color")]);
  f.binding.cleanup();
});

test("native typography alignment and text colors preserve note background and appearance with independent Undo/Redo and reopening", () => {
  const f = typographyFixture(), c = f.canvas, node = c.nodes.get("a");
  Object.assign(node.raw, { color: "4", feuillets_note_style: "filled", feuillets_stack: { id: "stack", order: 0 } });
  c.history[0] = clone(c.getData());
  for (const [index, title, patch] of [
    [0, "24 px", { size: 24 }],
    ...["center", "right", "justify", "left"].map((align) => [1, t(`carnet.typography.${align}`), { align }]),
    ...["red", "orange", "green", "cyan", "purple"].map((color) => [2, t(`carnet.typography.${color}`), { color }]),
    [2, t("carnet.typography.defaultColor"), { color: undefined }],
    [0, t("carnet.typography.defaultSize"), { size: undefined }],
  ]) {
    const before = c.getData(), history = c.index, style = normalizeTextStyle({ ...node.raw.feuillets_text_style, ...patch });
    f.choice(index, title).click(); const after = c.getData();
    const expected = { ...before.nodes[0] }; if (style) expected.feuillets_text_style = style; else delete expected.feuillets_text_style;
    assert.deepEqual(after, { ...before, nodes: [expected, ...before.nodes.slice(1)] });
    assert.equal(c.index, history + 1); assert.equal(f.choice(index, title).checked, true);
    c.undo(); assert.deepEqual(c.getData(), before); c.redo(); assert.deepEqual(c.getData(), after);
    const reopened = fixture(); reopened.importData(JSON.parse(JSON.stringify(after))); assert.deepEqual(reopened.getData(), after);
    f.choice(index, title).click(); assert.equal(c.index, history + 1);
  }
  assert.equal(node.raw.feuillets_text_style, undefined); assert.equal(node.raw.color, "4");
  f.binding.cleanup();
});

test("native typography protects active editing, stale menus and structural ownership without adding formatting commands", () => {
  const f = typographyFixture(), node = f.canvas.nodes.get("a"), before = f.canvas.getData();
  const stale = f.choice(0, "24 px");
  node.isEditing = true; assert.equal(f.typography(), undefined); stale.click(); assert.deepEqual(f.canvas.getData(), before);
  node.isEditing = false; node.raw.feuillets_block_id = "mindmap";
  assert.equal(f.typography(), undefined); const structural = f.canvas.getData(); stale.click(); assert.deepEqual(f.canvas.getData(), structural);
  delete node.raw.feuillets_block_id;
  f.canvas.view.file = { path: "Ordinary.canvas" }; stale.click(); assert.deepEqual(f.canvas.getData(), before);
  f.canvas.view.file = f.file; f.canvas.nodes.set("a", { ...node }); stale.click(); assert.deepEqual(f.canvas.getData(), before);
  const menu = f.open(); f.open(undefined, menu);
  assert.equal(menu.items.filter((item) => item.title === t("carnet.typography.title")).length, 1);
  assert.equal(f.typography().items.length, 3); assert.equal(f.registered.length, 1);
  f.binding.cleanup();
});

for (const managed of [undefined, "manuscript", "research"]) test(`file card appearance shares existing classes and native history: ${managed ?? "ordinary"}`, () => {
  const f = menuFixture(), c = f.canvas, node = c.nodes.get("a");
  Object.assign(node.raw, { type: "file", file: "Document.md", ...(managed ? { feuillets_managed: managed } : {}), feuillets_text_style: { size: 24, align: "center", color: "green" }, externalPlugin: { retained: true } });
  delete node.raw.text;
  const before = c.getData(); c.history[0] = clone(before);
  assert.equal(isFreeNote(before, node.raw), false);
  for (const style of ["plain", "outline", "rounded", "filled", "classic"]) {
    const previous = c.getData(); if (style !== "classic") f.choice(style).click();
    assert(applyNoteStyle(c, "a", style)); f.binding.refresh();
    assert(node.classes.has(`feuillets-note-${style}`));
    const saved = c.getData();
    assert.deepEqual(saved.nodes[0], { ...previous.nodes[0], feuillets_note_style: style });
    assert.equal(saved.nodes[0].width, before.nodes[0].width); assert.equal(saved.nodes[0].height, before.nodes[0].height);
    c.undo(); c.redo(); assert.deepEqual(c.getData(), saved);
    c.importData(JSON.parse(JSON.stringify(saved)), true); assert(node.classes.has(`feuillets-note-${style}`));
  }
  const saved = c.getData(); f.binding.cleanup();
  const binding = attachCarnetNoteStyles(c); binding.refresh(); assert(node.classes.has("feuillets-note-classic"));
  assert.deepEqual(c.getData(), saved); binding.cleanup();
});
