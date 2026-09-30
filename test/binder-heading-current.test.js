import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownView, TFile } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

class FakeElement {
  constructor(classes = []) {
    this.classes = new Set(classes);
    this.attrs = {};
  }
  addClass(name) { this.classes.add(name); }
  removeClass(name) { this.classes.delete(name); }
  setAttr(name, value) { this.attrs[name] = value; }
  getAttr(name) { return this.attrs[name] ?? null; }
}

function createFixture(collapsed = null) {
  const file = new TFile("Roman/Manuscrit/Current.md");
  const headings = [
    { heading: "Grand", level: 1, position: { start: { offset: 0 }, end: { offset: 7 } } },
    { heading: "Sous", level: 2, position: { start: { offset: 10 }, end: { offset: 16 } } },
    { heading: "Petit", level: 3, position: { start: { offset: 20 }, end: { offset: 27 } } },
  ];
  const markdown = new MarkdownView();
  markdown.file = file;
  markdown.editor = { getCursor: () => ({ line: 0, ch: 0 }), posToOffset: () => 30 };
  const rootSplit = {};
  const rows = headings.map((heading) => {
    const row = new FakeElement(["feuillets-heading-outline-row"]);
    row.setAttr("data-heading-outline-key", `${file.path}\u0000${heading.level}\u0000${heading.heading}\u00000`);
    return row;
  });
  const visibleRows = collapsed === "Sous" ? rows.slice(0, 2) : collapsed === "Grand" ? rows.slice(0, 1) : rows;
  const contentEl = {
    querySelectorAll: () => visibleRows,
    findAll: () => visibleRows,
  };
  const app = {
    workspace: { rootSplit, getMostRecentLeaf: () => ({ getRoot: () => rootSplit, view: markdown }) },
    metadataCache: { getFileCache: () => ({ headings }) },
  };
  const plugin = { settings: {}, getProjectFolder: () => null };
  const view = new FeuilletsView({ app, contentEl }, plugin);
  view._visibleHeadingOutlinePaths.add(file.path);
  return { view, rows };
}

test("Binder marks the exact visible current heading without rendering", () => {
  const { view, rows } = createFixture();
  let renderCalls = 0;
  view.render = () => { renderCalls++; };
  view.refreshCurrentHeadingHighlight();
  assert.equal(rows[2].classes.has("feuillets-heading-outline-current"), true);
  assert.equal(rows[0].classes.has("feuillets-heading-outline-current"), false);
  assert.equal(rows[1].classes.has("feuillets-heading-outline-current-ancestor"), false);
  assert.equal(renderCalls, 0);
});

test("Binder marks the nearest visible collapsed ancestor", () => {
  const underSous = createFixture("Sous");
  underSous.view.refreshCurrentHeadingHighlight();
  assert.equal(underSous.rows[1].classes.has("feuillets-heading-outline-current-ancestor"), true);
  assert.equal(underSous.rows[0].classes.has("feuillets-heading-outline-current-ancestor"), false);

  const underGrand = createFixture("Grand");
  underGrand.view.refreshCurrentHeadingHighlight();
  assert.equal(underGrand.rows[0].classes.has("feuillets-heading-outline-current-ancestor"), true);
});

test("Binder clears the current heading before the first heading", () => {
  const { view, rows } = createFixture();
  rows[2].addClass("feuillets-heading-outline-current");
  view.refreshCurrentHeadingHighlight(0 - 1);
  assert.equal(rows[2].classes.has("feuillets-heading-outline-current"), false);
  assert.equal(rows.some((row) => row.classes.has("feuillets-heading-outline-current-ancestor")), false);
});
