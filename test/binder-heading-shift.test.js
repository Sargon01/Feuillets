import test from "node:test";
import assert from "node:assert/strict";
import { Menu, TFile } from "obsidian";
import { FeuilletsView } from "../src/views/feuillets-view.js";

function buildDoc(entries) {
  let text = "";
  const headings = [];
  for (const entry of entries) {
    const startOffset = text.length;
    text += `${"#".repeat(entry.level)} ${entry.text}\n`;
    headings.push({ text: entry.text, level: entry.level, startOffset, endOffset: text.length - 1 });
  }
  return { text, headings };
}

function buildView(entries, { fresh = null, rejectProcess = false } = {}) {
  const file = new TFile("Roman/Manuscrit/Shift.md");
  const other = new TFile("Roman/Manuscrit/Other.md");
  let stored = buildDoc(entries);
  let cache = fresh ?? stored.headings;
  const listeners = new Set();
  let processCalls = 0;
  let offrefCalls = 0;
  let renderCalls = 0;
  const app = {
    vault: {
      getAbstractFileByPath: (path) => path === file.path ? file : null,
      process: async (_file, callback) => {
        processCalls++;
        if (rejectProcess) throw new Error("disk failure");
        const next = callback(stored.text);
        if (next !== stored.text) {
          stored = { text: next, headings: cache.map((heading) => ({ ...heading, level: heading.level + 1 })) };
          cache = stored.headings;
          for (const listener of listeners) listener(file);
        }
        return stored.text;
      },
    },
    metadataCache: {
      getFileCache: () => ({ headings: cache.map((heading) => ({ heading: heading.text, level: heading.level, position: { start: { offset: heading.startOffset }, end: { offset: heading.endOffset } } })) }),
      on: (_event, listener) => { listeners.add(listener); return listener; },
      offref: (listener) => { offrefCalls++; listeners.delete(listener); },
    },
  };
  const view = new FeuilletsView({ app, contentEl: { querySelectorAll: () => [] } }, { settings: {}, getProjectFolder: () => null });
  view.render = async () => { renderCalls++; };
  return { view, file, other, get stored() { return stored; }, get processCalls() { return processCalls; }, get offrefCalls() { return offrefCalls; }, get renderCalls() { return renderCalls; } };
}

function menuEvent() {
  return { target: null, preventDefault() {}, stopPropagation() {} };
}

test("heading text menu exposes Promote and Demote with correct disabled states", () => {
  const fixture = buildView([{ level: 2, text: "A" }, { level: 3, text: "A1" }]);
  fixture.view.showHeadingShiftMenu(menuEvent(), fixture.file, { ...fixture.stored.headings[0], children: [{ ...fixture.stored.headings[1], children: [] }] });
  assert.deepEqual(Menu.lastShown.items.map((item) => [item.title, item.disabled]), [["Promouvoir", false], ["Rétrograder", false]]);

  fixture.view.showHeadingShiftMenu(menuEvent(), fixture.file, { ...fixture.stored.headings[0], level: 1, children: [{ ...fixture.stored.headings[1], level: 6, children: [] }] });
  assert.deepEqual(Menu.lastShown.items.map((item) => item.disabled), [true, true]);
});

test("shift writes through Vault.process, refreshes cache, and renders once", async () => {
  const fixture = buildView([{ level: 1, text: "Parent" }, { level: 2, text: "A" }, { level: 3, text: "A1" }, { level: 2, text: "B" }]);
  const source = fixture.stored.headings[1];
  await fixture.view.shiftHeadingSubtreeInFile(fixture.file, source.startOffset, source.level, source.text, "promote");
  assert.equal(fixture.stored.text, "# Parent\n# A\n## A1\n## B\n");
  assert.equal(fixture.processCalls, 1);
  assert.equal(fixture.renderCalls, 1);
  assert.equal(fixture.offrefCalls, 1);
});

test("stale offset, level, or text causes no write result and no render", async () => {
  for (const expected of [[999, 2, "A"], [0, 3, "A"], [0, 2, "Renamed"]]) {
    const fixture = buildView([{ level: 2, text: "A" }]);
    await fixture.view.shiftHeadingSubtreeInFile(fixture.file, expected[0], expected[1], expected[2], "promote");
    assert.equal(fixture.renderCalls, 0);
    assert.equal(fixture.offrefCalls, 1);
  }
});

test("a process rejection is absorbed and cleans its metadata listener", async () => {
  const fixture = buildView([{ level: 2, text: "A" }], { rejectProcess: true });
  await fixture.view.shiftHeadingSubtreeInFile(fixture.file, 0, 2, "A", "promote");
  assert.equal(fixture.renderCalls, 0);
  assert.equal(fixture.offrefCalls, 1);
});
