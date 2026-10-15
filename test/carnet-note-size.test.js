import test from "node:test";
import assert from "node:assert/strict";
import { attachNoteSizing, measureNoteSize } from "../src/carnet/canvas/note-size.js";

function fixture(onLiveChange) {
  let raw = { id: "a", type: "text", text: "**Rendered text**", x: -25, y: 40, width: 250, height: 60, custom: { retained: true } };
  const classes = new Set(), callbacks = [];
  const node = {
    id: "a", renderedWidth: 80, renderedHeight: 95, horizontalInset: 2, verticalInset: 2,
    getData: () => structuredClone(raw), setData: (data) => { raw = structuredClone(data); },
    moveAndResize: (rect) => { raw = { ...raw, ...rect }; },
    resize(size) { this.moveAndResize({ x: raw.x, y: raw.y, ...size }); },
    setIsEditing(active) { this.isEditing = active; },
    nodeEl: { getBoundingClientRect: () => ({ width: raw.width }), ownerDocument: { defaultView: { requestAnimationFrame: (fn) => callbacks.push(fn) } }, classList: {
      add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name),
    } },
    contentEl: { querySelector: () => ({ getClientRects: () => [{}], getBoundingClientRect: () => classes.has("feuillets-note-measuring") ? ({ width: raw.feuillets_note_width === "manual" ? raw.width - node.horizontalInset : node.renderedWidth, height: node.renderedHeight }) : ({ width: raw.width - node.horizontalInset, height: raw.height - node.verticalInset }) }) },
  };
  let pending;
  const canvas = { nodes: new Map([["a", node]]), history: { data: [{ nodes: [node.getData()], edges: [] }], current: 0 }, saves: 0, isDragging: false,
    getData: () => ({ nodes: [node.getData()], edges: [] }),
    requestSave() { pending = this.getData(); },
    overrideHistory() { this.requestPushHistory.run(); this.history.data[this.history.current] = this.getData(); this.saves++; },
  };
  canvas.requestPushHistory = Object.assign(() => {}, { run() { if (pending) { canvas.history.data.splice(++canvas.history.current); canvas.history.data.push(pending); pending = undefined; } } });
  const binding = attachNoteSizing(canvas, onLiveChange); binding.refresh(new Set(["a"]));
  return { node, canvas, binding, classes, callbacks };
}

test("rendered dimensions grow and shrink in the native edit checkpoint without changing position, Markdown or unknown data", () => {
  const f = fixture(), before = f.node.getData();
  f.binding.update(f.node);
  assert.deepEqual(f.node.getData(), { ...before, width: 82, height: 97 });
  assert.equal(f.canvas.history.data.length, 1);
  f.node.setData({ ...f.node.getData(), text: "A longer edit" });
  f.node.renderedWidth = 300; f.node.renderedHeight = 160;
  f.canvas.requestSave(); f.binding.update(f.node);
  assert.equal(f.canvas.history.data.length, 2);
  assert.equal(f.canvas.history.data[1].nodes[0].width, 302);
  f.node.setData({ ...f.node.getData(), text: "Short" });
  f.node.renderedWidth = 20; f.node.renderedHeight = 23;
  f.canvas.requestSave(); f.binding.update(f.node);
  assert.equal(f.canvas.history.data.length, 3);
  assert.equal(f.node.getData().width, 50); assert.equal(f.node.getData().height, 50);
  assert.equal(f.node.getData().x, before.x); assert.equal(f.node.getData().y, before.y);
  assert.deepEqual(f.node.getData().custom, before.custom);
  const saves = f.canvas.saves; f.binding.update(f.node); assert.equal(f.canvas.saves, saves);
  assert.equal(f.classes.size, 0);
  f.binding.cleanup();
});

function activeEditor(f) {
  const requests = [];
  const cm = {
    contentDOM: {}, dom: { isConnected: true }, contentHeight: 240,
    scrollDOM: { get clientHeight() { return f.node.getData().height - 2; }, scrollTop: 100,
      ownerDocument: { defaultView: { getComputedStyle: (element, pseudo) => pseudo ? { content: '" "', height: "16px" } : { paddingTop: "0px", paddingBottom: "0px" } } } },
    state: { doc: { toString: () => "Edited text" } },
    requestMeasure: (request) => requests.push(request),
  };
  let updates = 0;
  const original = () => { updates++; }, mode = { cm, onUpdate: original };
  f.node.child = { editMode: mode };
  f.node.setIsEditing(true);
  return { cm, mode, original, requests, updates: () => updates, flush() { const request = requests.pop(); requests.length = 0; request?.write(request.read()); } };
}

test("live editor height grows and shrinks without saving, changing width or leaving editing mode", () => {
  let invalidations = 0;
  const f = fixture(() => invalidations++), before = f.node.getData(), editor = activeEditor(f);
  editor.flush();
  assert.equal(f.node.getData().height, 274);
  editor.cm.contentHeight = 24;
  editor.mode.onUpdate({ docChanged: true, geometryChanged: false }, true); editor.flush();
  assert.equal(f.node.getData().height, 58);
  assert.equal(editor.updates(), 1);
  assert.equal(invalidations, 2);
  assert.equal(editor.cm.scrollDOM.scrollTop, 0);
  assert.equal(f.node.isEditing, true);
  assert.equal(f.node.getData().width, before.width);
  assert.equal(f.node.getData().x, before.x); assert.equal(f.node.getData().y, before.y);
  assert.equal(f.canvas.saves, 0); assert.equal(f.canvas.history.data.length, 1);
  f.node.setIsEditing(false);
  assert.equal(editor.mode.onUpdate, editor.original);
  f.binding.cleanup();
});

test("live measurements defer during native gestures and are cancelled when editing ends or bindings unload", () => {
  const f = fixture(), editor = activeEditor(f);
  f.node.setData({ ...f.node.getData(), width: 310, feuillets_note_width: "manual" });
  f.canvas.isDragging = true; editor.flush(); assert.equal(f.node.getData().height, 60);
  f.canvas.isDragging = false;
  editor.mode.onUpdate({ docChanged: false, geometryChanged: true }, false); editor.flush();
  assert.equal(f.node.getData().width, 310); assert.equal(f.node.getData().height, 274);
  editor.mode.onUpdate({ docChanged: true, geometryChanged: false }, true);
  f.node.setIsEditing(false); editor.flush();
  assert.equal(editor.mode.onUpdate, editor.original);
  assert.equal(f.node.getData().height, 274);
  const second = activeEditor(f);
  f.binding.cleanup(); second.flush();
  assert.equal(second.mode.onUpdate, second.original);
  assert.equal(f.canvas.saves, 0);
});

test("an unchanged editing session restores its starting dimensions without saving", () => {
  const f = fixture(), before = f.node.getData(), editor = activeEditor(f);
  editor.cm.state.doc.toString = () => before.text;
  editor.flush(); assert.equal(f.node.getData().height, 274);
  f.node.setIsEditing(false);
  assert.deepEqual(f.node.getData(), before);
  assert.equal(f.canvas.saves, 0);
  f.binding.cleanup();
});

test("manual width is persisted by the native resize save and remains fixed while height follows later edits", () => {
  const f = fixture(); f.classes.add("is-dragging");
  f.node.moveAndResize({ x: -25, y: 40, width: 330, height: 120 });
  f.canvas.requestSave(); f.classes.delete("is-dragging"); f.binding.update(f.node);
  assert.equal(f.node.getData().feuillets_note_width, "manual");
  assert.equal(f.node.getData().width, 330); assert.equal(f.node.getData().height, 97);
  assert.equal(f.canvas.history.data.length, 2);
  f.node.renderedWidth = 90; f.node.renderedHeight = 240;
  f.node.setData({ ...f.node.getData(), text: "More rendered lines" }); f.canvas.requestSave(); f.binding.update(f.node);
  assert.equal(f.node.getData().width, 330); assert.equal(f.node.getData().height, 242);
  f.binding.cleanup();
});

test("cancelled resizing, active editing, dragging, readonly and unfinished native changes are not absorbed", () => {
  const f = fixture(); f.classes.add("is-dragging");
  f.node.moveAndResize({ x: -25, y: 40, width: 330, height: 60 });
  f.node.moveAndResize({ x: -25, y: 40, width: 250, height: 60 }); f.canvas.requestSave();
  assert.equal(f.node.getData().feuillets_note_width, undefined); f.classes.delete("is-dragging");
  for (const flag of ["isEditing", "isDragging", "readonly"]) {
    const target = flag === "isEditing" ? f.node : f.canvas; target[flag] = true;
    f.binding.update(f.node); assert.equal(f.node.getData().width, 250); target[flag] = false;
  }
  f.canvas.requestPushHistory.run();
  f.node.setData({ ...f.node.getData(), text: "Uncommitted" }); f.binding.update(f.node);
  assert.equal(f.node.getData().width, 250);
  assert.equal(f.classes.size, 0);
  f.binding.cleanup();
});

test("measurement leaves no temporary classes and unsupported runtimes remain untouched", () => {
  assert.equal(attachNoteSizing({ nodes: new Map() }), null);
  const f = fixture();
  assert.deepEqual(measureNoteSize(f.node), { width: 82, height: 97 });
  assert.equal(f.classes.size, 0);
  f.binding.refresh(new Set());
  f.binding.update(f.node); assert.equal(f.node.getData().width, 250);
  f.binding.cleanup();
});


test("native snapshot ordering does not prevent fitting newly created notes", () => {
  const f = fixture(), other = { id: "z", type: "text", text: "Other", x: 500, y: 0, width: 200, height: 100 };
  f.canvas.history.data[0].nodes.push(other);
  f.canvas.getData = () => ({ nodes: [other, f.node.getData()], edges: [] });
  f.binding.update(f.node);
  assert.equal(f.node.getData().width, 82);
  assert.equal(f.canvas.history.data.length, 1);
  f.binding.cleanup();
});


test("rendered width includes the actual Canvas frame instead of assuming a two-pixel border", () => {
  const f = fixture();
  f.node.horizontalInset = 6; f.node.verticalInset = 6;
  f.node.renderedWidth = 78.8515625;
  f.node.renderedHeight = 27;
  assert.deepEqual(measureNoteSize(f.node), { width: 85, height: 50 });
  assert.equal(f.classes.size, 0);
  f.binding.cleanup();
});

test("theme padding is preserved in both dimensions and manual width is never enlarged", () => {
  const f = fixture();
  f.node.horizontalInset = 18; f.node.verticalInset = 14;
  assert.deepEqual(measureNoteSize(f.node), { width: 98, height: 109 });
  f.node.setData({ ...f.node.getData(), feuillets_note_width: "manual", width: 190 });
  assert.deepEqual(measureNoteSize(f.node), { width: 190, height: 109 });
  assert.equal(f.classes.size, 0);
  f.binding.cleanup();
});
