import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { BoardView } from "../src/views/board-view.js";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { builtinStatusDefaults, builtinLabelDefaults } from "../src/services/project-taxonomy.js";
import { setLocale, getLocale } from "../src/i18n/index.js";

/* Live wiring proof — not just helper behavior: actually instantiates
   base-feuillets-view.ts's makeStatusSelect/makeLabelSelect (shared by
   board-view.ts and feuillets-view.ts) and confirms the <option> VALUE
   written to frontmatter is always the stable id ("draft"/"red"), while
   the <option> TEXT shown to the user is the translated display name in
   the active locale — never the reverse. */

class FakeElement {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set();
    this.value = options.value ?? "";
    this.text = options.text ?? "";
    this.attrs = new Map();
    this.style = {};
    this.events = new Map();
    if (options.cls) this.addClass(options.cls);
    if (options.text !== undefined) this.text = options.text;
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(tag, options);
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  addClass(name) { for (const part of String(name).split(/\s+/)) if (part) this.classes.add(part); }
  removeClass(name) { this.classes.delete(name); }
  hasClass(name) { return this.classes.has(name); }
  setText(text) { this.text = String(text); return this; }
  setAttr(name, value) { this.attrs.set(name, value); }
  getAttr(name) { return this.attrs.get(name); }
  addEventListener(type, callback) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(callback);
  }
  async dispatch(type) {
    for (const cb of this.events.get(type) ?? []) await cb();
  }
  blur() {}
}

/** No `settings.projectFolder` at all -> activeProjectMeta/getProjectFolder
 * short-circuit to null without ever touching a Vault -> workspaceStatuses/
 * workspaceLabels fall straight through to the plain global
 * `settings.statuses`/`settings.labels` arrays. No fake vault needed. */
function buildView({ statuses, labels }) {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.statuses = statuses;
  settings.labels = labels;
  const setFmCalls = [];
  const plugin = {
    settings,
    getProjectFolder: () => null,
    getWorkspaceFolder: () => null,
    saveSettings: async () => {},
    labelOf: () => "",
    labelColor: () => null,
    fmOf: () => ({}),
  };
  const app = { workspace: {}, vault: { getAbstractFileByPath: () => null } };
  const contentEl = new FakeElement();
  const view = new BoardView({ app, contentEl }, plugin);
  view.setFm = async (file, key, value) => { setFmCalls.push({ path: file.path, key, value }); };
  return { view, setFmCalls };
}

test("makeStatusSelect: a built-in status's <option> VALUE is its stable id, its TEXT the translated name, in French", () => {
  const previousLocale = getLocale();
  try {
    setLocale("fr");
    const { view } = buildView({ statuses: builtinStatusDefaults(), labels: [] });
    const file = new TFile("Scene.md");
    const parent = new FakeElement();
    const sel = view.makeStatusSelect(parent, file);

    const draftOption = sel.children.find((opt) => opt.value === "draft");
    assert.ok(draftOption, "an <option> with value \"draft\" (the stable id) must exist");
    assert.notEqual(draftOption.text, "draft", "the option's visible TEXT must be translated, not the raw id");
    assert.notEqual(draftOption.text, "Draft", "must not be the English display either, since the active locale is French");

    // Every option's value is a stable id or empty — never the display text.
    for (const opt of sel.children) {
      assert.notEqual(opt.value, "Idea");
      assert.notEqual(opt.value, "Draft");
      assert.notEqual(opt.value, "In progress");
      assert.notEqual(opt.value, "Revised");
      assert.notEqual(opt.value, "Complete");
    }
  } finally {
    setLocale(previousLocale);
  }
});

test("makeStatusSelect: selecting a built-in status writes the stable id \"draft\" through setFm — never \"Draft\" or a translated name", async () => {
  const { view, setFmCalls } = buildView({ statuses: builtinStatusDefaults(), labels: [] });
  const file = new TFile("Scene.md");
  const parent = new FakeElement();
  const sel = view.makeStatusSelect(parent, file);

  sel.value = "draft";
  await sel.dispatch("change");

  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].key, "status");
  assert.equal(setFmCalls[0].value, "draft", "must write the stable id, never its English or French translated display name");
});

test("makeLabelSelect: a built-in label's <option> VALUE is its stable id \"red\", its TEXT the translated name", () => {
  const previousLocale = getLocale();
  try {
    setLocale("fr");
    const { view } = buildView({ statuses: [], labels: builtinLabelDefaults() });
    const file = new TFile("Scene.md");
    const parent = new FakeElement();
    const sel = view.makeLabelSelect(parent, file);

    const redOption = sel.children.find((opt) => opt.value === "red");
    assert.ok(redOption, "an <option> with value \"red\" (the stable id) must exist");
    assert.notEqual(redOption.text, "red");
    assert.notEqual(redOption.text, "Red");
    for (const opt of sel.children) {
      assert.notEqual(opt.value, "Red");
      assert.notEqual(opt.value, "Orange");
      assert.notEqual(opt.value, "Yellow");
      assert.notEqual(opt.value, "Green");
      assert.notEqual(opt.value, "Blue");
      assert.notEqual(opt.value, "Purple");
    }
  } finally {
    setLocale(previousLocale);
  }
});

test("makeLabelSelect: selecting a built-in label writes the stable id \"red\" through setFm — never \"Red\" or a translated name", async () => {
  const { view, setFmCalls } = buildView({ statuses: [], labels: builtinLabelDefaults() });
  const file = new TFile("Scene.md");
  const parent = new FakeElement();
  const sel = view.makeLabelSelect(parent, file);

  sel.value = "red";
  await sel.dispatch("change");

  assert.equal(setFmCalls.length, 1);
  assert.equal(setFmCalls[0].key, "label");
  assert.equal(setFmCalls[0].value, "red", "must write the stable id, never its English or French translated display name");
});

/* ==================== legacy/custom entries: unaffected ==================== */

test("makeStatusSelect: a legacy/custom status (no recognized id) still stores and shows its own exact name, unchanged", async () => {
  const legacyStatuses = [{ name: "Legacy Status Name", color: "#e08f4f" }];
  const { view, setFmCalls } = buildView({ statuses: legacyStatuses, labels: [] });
  const file = new TFile("Scene.md");
  const parent = new FakeElement();
  const sel = view.makeStatusSelect(parent, file);

  const option = sel.children.find((opt) => opt.value === "Legacy Status Name");
  assert.ok(option, "the legacy entry's exact name must be the option's stored value");
  assert.equal(option.text, "Legacy Status Name", "and its exact name must be the option's displayed text too");

  sel.value = "Legacy Status Name";
  await sel.dispatch("change");
  assert.equal(setFmCalls[0].value, "Legacy Status Name");
});

test("makeLabelSelect: a legacy/custom label (no recognized id) still stores and shows its own exact name, unchanged", async () => {
  const legacyLabels = [{ name: "Custom Label Name", color: "#123456" }];
  const { view, setFmCalls } = buildView({ statuses: [], labels: legacyLabels });
  const file = new TFile("Scene.md");
  const parent = new FakeElement();
  const sel = view.makeLabelSelect(parent, file);

  const option = sel.children.find((opt) => opt.value === "Custom Label Name");
  assert.ok(option);
  assert.equal(option.text, "Custom Label Name");

  sel.value = "Custom Label Name";
  await sel.dispatch("change");
  assert.equal(setFmCalls[0].value, "Custom Label Name");
});
