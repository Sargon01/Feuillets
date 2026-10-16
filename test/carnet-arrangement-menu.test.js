import test from "node:test";
import assert from "node:assert/strict";
import { Menu } from "obsidian";
import { getCarnetArrangementActions, registerCarnetArrangementMenu } from "../src/carnet/canvas/arrangement-menu.js";
import { stackNotes } from "../src/carnet/canvas/stack-notes.js";
import { stackDynamically, unstackDynamically } from "../src/carnet/canvas/dynamic-stack.js";
import { t } from "../src/i18n/index.js";

const clone = (value) => structuredClone(value);
const nativeActions = [
  ...["start", "center", "end"].map((value) => ({ section: "align-h", icon: `lucide-align-${value}-vertical` })),
  ...["start", "center", "end"].map((value) => ({ section: "align-v", icon: `lucide-align-${value}-horizontal` })),
  ...["stack-horizontal", "stack-vertical", "lucide-layout-grid"].map((icon) => ({ section: "arrange", icon })),
  ...["horizontal", "vertical"].map((value) => ({ section: "distribute", icon: `distribute-space-${value}` })),
  ...["horizontal", "vertical"].map((value) => ({ section: "justify", icon: `stretch-${value}`, title: "Justify horizontally" })),
];

function nativeItem(menu, action, run) {
  menu.addItem((item) => {
    item.setTitle(action.title ?? action.icon).setIcon(action.icon).onClick(run);
    item.titleEl = { textContent: item.title };
    item.iconEl = { querySelector: () => ({ classList: ["svg-icon", action.icon] }) };
    item.section = action.section;
  });
}

function fixture() {
  const file = { path: "Carnet.canvas" }, events = new Map(), refs = [], calls = [];
  const c = { nodes: new Map(), selection: new Set(), view: { file }, wrapperEl: { isConnected: true }, history: { data: [], current: -1 }, saves: 0,
    getData() { return { nodes: [...this.nodes.values()].map((node) => node.getData()), edges: [{ id: "ab", fromNode: "a", toNode: "b", color: "4", feuillets_edge_style: { geometry: "map" } }] }; },
    requestSave() { this.saves++; }, pushHistory(data) { this.history.data.splice(++this.history.current); this.history.data.push(clone(data)); },
    importData(data) { for (const raw of data.nodes) this.nodes.get(raw.id).setData(clone(raw)); },
    undo() { this.importData(this.history.data[--this.history.current]); }, redo() { this.importData(this.history.data[++this.history.current]); },
  };
  c.requestPushHistory = Object.assign(() => {}, { run() {}, cancel() {} });
  for (const [index, id] of ["a", "b", "c"].entries()) c.nodes.set(id, { id, canvas: c,
    raw: { id, type: "text", text: "**Keep Markdown**", color: "3", feuillets_note_style: "rounded", x: index * 200, y: index * 100, width: 100 + index * 20, height: 60 + index * 10 },
    getData() { return clone(this.raw); }, setData(data) { this.raw = clone(data); }, moveTo(pos) { this.raw = { ...this.raw, ...pos }; },
    getBBox() { return { minX: this.raw.x, minY: this.raw.y, maxX: this.raw.x + this.raw.width, maxY: this.raw.y + this.raw.height }; },
    nodeEl: { classList: { contains: () => false } },
  });
  c.selection = new Set(c.nodes.values()); c.pushHistory(c.getData());
  const next = {}, parent = { insertBefore(target, anchor) { assert.equal(anchor, next); target.parentNode = this; } };
  const button = { parentNode: parent, nextSibling: next, remove() { this.parentNode = null; }, click() {
    if (c.suppressClicks && this.parentNode === parent) return;
    if (c.failCapture) throw new Error("Builder failure");
    const menu = new Menu(); menu.parentEl = button;
    for (const action of c.actions ?? nativeActions) nativeItem(menu, action, () => { calls.push(action.icon); c.requestSave(); c.pushHistory(c.getData()); });
    menu.showAtPosition({ x: 0, y: 0 });
  } };
  c.menu = { render() {}, menuEl: { appendChild() {}, querySelector: () => c.missingToolbar ? null : button } };
  let activeView = c.view;
  const plugin = { app: { workspace: { getMostRecentLeaf: () => ({ view: activeView }), on(name, callback) { const ref = { name, callback }; events.set(name, callback); return ref; } } }, registerEvent(ref) { refs.push(ref); } };
  registerCarnetArrangementMenu(plugin, (candidate) => candidate === file);
  const open = (menu = new Menu()) => { events.get("canvas:selection-menu")?.(menu, c); return menu; };
  const group = (name, menu = open()) => menu.items.find((item) => item.title === t(`carnet.arrangement.${name}`))?.submenu;
  return { c, events, refs, calls, open, group, button, parent, setActive(view) { activeView = view; }, unload() { for (const ref of refs) if (events.get(ref.name) === ref.callback) events.delete(ref.name); } };
}

test("all native arrangement callbacks are grouped without opening a popup or replacing native commands", () => {
  const f = fixture(), menu = new Menu(), before = f.c.getData(), original = Menu.prototype.showAtPosition;
  nativeItem(menu, { title: "Native action", icon: "trash-2" }, () => {}); const native = menu.items[0];
  Menu.lastShown = null; f.open(menu); f.open(menu);
  assert.equal(Menu.lastShown, null); assert.equal(Menu.prototype.showAtPosition, original); assert.equal(menu.items[0], native);
  assert.deepEqual(menu.items.slice(1).map((item) => item.title), ["align", "arrange", "distribute", "stack"].map((key) => t(`carnet.arrangement.${key}`)));
  assert.deepEqual(["align", "arrange", "distribute", "stack"].map((name) => f.group(name, menu).items.length), [6, 5, 2, 2]);
  assert.equal(f.group("arrange", menu).items.at(-1).title, t("carnet.arrangement.justifyVertical"));
  const selection = [...f.c.selection];
  for (const name of ["align", "arrange", "distribute"]) for (const item of f.group(name, menu).items) item.click();
  assert.equal(f.calls.length, 13); assert.deepEqual([...f.c.selection], selection); assert.deepEqual(f.c.getData(), before);
  assert.equal(f.c.saves, 13); assert.equal(f.c.history.data.length, 14);
});

test("existing menu entries are deduplicated and extra native arrangement actions remain accessible", () => {
  const f = fixture(), menu = new Menu();
  nativeItem(menu, nativeActions[0], () => {});
  f.c.actions = [...nativeActions, { section: "future-arrangement", icon: "future-layout" }]; f.open(menu);
  assert.equal(f.group("align", menu).items.length, 5);
  const extra = f.group("arrange", menu).items.find((item) => item.icon === "future-layout"); extra.click(); assert.equal(f.calls.at(-1), "future-layout");
});

const normalizeStacks = (data) => ({ ...data, nodes: data.nodes.map((node) => node.feuillets_stack ? { ...node, feuillets_stack: { ...node.feuillets_stack, id: "stack" } } : node) });
for (const [key, apply] of [["carnet.stackNotes.title", stackNotes], ["carnet.dynamicStack.title", stackDynamically]]) test(`${key} retains original transactions, geometry, history and persistence`, () => {
  const f = fixture(), direct = fixture(), before = f.c.getData();
  f.group("stack").items.find((item) => item.title === t(key)).click(); assert(apply(direct.c));
  const after = f.c.getData(); assert.deepEqual(normalizeStacks(after), normalizeStacks(direct.c.getData()));
  assert.equal(f.c.history.data.length, 2); assert.deepEqual(after.edges, before.edges);
  f.c.undo(); assert.deepEqual(f.c.getData(), before); f.c.redo(); assert.deepEqual(f.c.getData(), after);
  const reopened = fixture(); reopened.c.importData(JSON.parse(JSON.stringify(after))); assert.deepEqual(reopened.c.getData(), after);
});

test("detachment is available for a single stack member through its native node menu", () => {
  const f = fixture(); assert(stackDynamically(f.c)); const before = f.c.getData(), node = f.c.nodes.get("b"); f.c.selection = new Set([node]);
  const menu = new Menu(); f.events.get("canvas:node-menu")(menu, node);
  assert.deepEqual(menu.items.map((item) => item.title), [t("carnet.arrangement.stack")]);
  f.group("stack", menu).items[0].click(); assert(f.c.getData().nodes.every((raw) => raw.feuillets_stack === undefined));
  const direct = fixture(); direct.c.importData(before); direct.c.pushHistory(before); direct.c.selection = new Set([direct.c.nodes.get("b")]); assert(unstackDynamically(direct.c)); assert.deepEqual(f.c.getData(), direct.c.getData());
  f.c.undo(); assert.deepEqual(f.c.getData(), before); f.c.redo(); assert.deepEqual(f.c.getData(), direct.c.getData());
});

test("structural, mixed edge, editing, readonly, stale and ordinary selections stay protected", () => {
  for (const patch of [{ feuillets_plan_version: 2 }, { feuillets_block_id: "mindmap" }, { feuillets_managed: "relations" }, { feuillets_managed: "manuscript" }]) {
    const f = fixture(); Object.assign(f.c.nodes.get("a").raw, patch); assert.equal(f.open().items.length, 0);
  }
  for (const flag of ["readonly", "isDragging", "isHoldingSpace"]) { const f = fixture(); f.c[flag] = true; assert.equal(f.open().items.length, 0); }
  const f = fixture(), node = f.c.nodes.get("a"); node.isEditing = true; assert.equal(f.open().items.length, 0); node.isEditing = false;
  const choice = f.group("align").items[0]; f.c.view.file = { path: "Ordinary.canvas" }; assert.equal(f.open().items.length, 0); choice.click(); assert.equal(f.calls.length, 0);
  f.c.view.file = { path: "Carnet.canvas" }; choice.click(); assert.equal(f.calls.length, 0);
  const stale = fixture(), action = stale.group("align").items[0]; stale.c.nodes.set("a", { ...stale.c.nodes.get("a") }); action.click(); assert.equal(stale.calls.length, 0);
  const mixed = fixture(); mixed.c.selection.add({ id: "ab" }); assert.equal(mixed.open().items.length, 0);
  const inactive = fixture(), deferred = inactive.group("align").items[0]; inactive.setActive({}); deferred.click(); assert.equal(inactive.calls.length, 0);
});

test("ordinary cards remain eligible while a group containing structural content is excluded", () => {
  for (const type of ["file", "link", "group"]) {
    const f = fixture(), node = f.c.nodes.get("a"); node.raw.type = type; f.c.getContainingNodes = () => [];
    assert(f.group("align")); assert.equal(f.group("stack"), undefined);
    if (type === "group") { const child = f.c.nodes.get("b"); child.raw.feuillets_plan_version = 2; f.c.getContainingNodes = () => [child]; assert.equal(f.open().items.length, 0); }
  }
});

test("capture always restores Menu.showAtPosition, and unloading removes both registered handlers", () => {
  const f = fixture(), original = Menu.prototype.showAtPosition; f.c.failCapture = true;
  assert.throws(() => f.open(), /Builder failure/); assert.equal(Menu.prototype.showAtPosition, original);
  assert.equal(f.refs.length, 2); f.unload(); assert.equal(f.events.size, 0); assert.equal(f.open().items.length, 0);
});


test("alignment and arrangement stay available before stack history exists and after detachment", () => {
  const f = fixture();
  f.c.history = { data: [], current: -1 };
  const actions = getCarnetArrangementActions(f.c, () => true);
  assert.equal(actions.filter((action) => action.section.startsWith("align")).length, 6);
  assert.equal(actions.filter((action) => action.section === "arrange").length, 3);
  assert.equal(actions.filter((action) => action.section === "distribute").length, 2);
  assert.equal(actions.filter((action) => action.section === "stack").length, 0);
  actions[0].run({});
  assert.equal(f.calls.length, 1);
  const stacked = fixture();
  assert(stackDynamically(stacked.c));
  assert.equal(getCarnetArrangementActions(stacked.c, () => true).filter((action) => action.section.startsWith("align")).length, 6);
  assert(unstackDynamically(stacked.c));
  assert.equal(getCarnetArrangementActions(stacked.c, () => true).filter((action) => action.section.startsWith("align")).length, 6);
});

test("node alignment needs two compatible nodes and distribution needs at least three", () => {
  const f = fixture();
  for (const count of [1, 2, 3]) {
    f.c.selection = new Set([...f.c.nodes.values()].slice(0, count));
    const actions = getCarnetArrangementActions(f.c, () => true);
    assert.equal(actions.filter((action) => action.section.startsWith("align")).length, count >= 2 ? 6 : 0);
    assert.equal(actions.filter((action) => action.section === "distribute").length, count >= 3 ? 2 : 0);
  }
  f.c.nodes.get("a").raw.feuillets_block_id = "relations";
  assert.deepEqual(getCarnetArrangementActions(f.c, () => true), []);
});

test("native action discovery bypasses trailing-click suppression and restores the same toolbar button on success or failure", () => {
  const f = fixture(), before = f.c.getData(), original = Menu.prototype.showAtPosition;
  f.c.suppressClicks = true;
  const actions = getCarnetArrangementActions(f.c, () => true);
  assert.equal(actions.filter((action) => action.section.startsWith("align")).length, 6);
  assert.equal(actions.filter((action) => action.section === "distribute").length, 2);
  assert.equal(f.button.parentNode, f.parent); assert.equal(Menu.prototype.showAtPosition, original);
  assert.deepEqual(f.c.getData(), before); assert.equal(f.calls.length, 0);
  f.c.failCapture = true;
  assert.throws(() => getCarnetArrangementActions(f.c, () => true), /Builder failure/);
  assert.equal(f.button.parentNode, f.parent); assert.equal(Menu.prototype.showAtPosition, original);
});
