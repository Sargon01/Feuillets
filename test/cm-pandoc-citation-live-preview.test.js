import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TFile, TFolder, editorInfoField, editorLivePreviewField } from "obsidian";
import { Decoration } from "@codemirror/view";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  createPandocCitationLivePreviewExtension,
  notifyPandocCitationBibliographyChanged,
  PandocCitationWidget,
} from "../src/utils/cm-pandoc-citation-live-preview.js";

/** `Decoration.none` (a sentinel object in the stub, see codemirror-view-stub.mjs)
 * has no `.length`; a real Decoration.set([], ...) result is a plain array with
 * length 0. Both mean "nothing folded here". */
function isEmpty(decorations) {
  return decorations === Decoration.none || (Array.isArray(decorations) && decorations.length === 0);
}

/**
 * `createEl`/`createSpan` (global Obsidian DOM helpers): the widget's `toDOM()`
 * and `buildCitationNoticeElement()` call them exactly as they would in the real
 * app (see PandocCitationWidget.toDOM()'s own comment for why), so this file
 * shims them once, for the whole file — every test here needs them, and Node's
 * test runner isolates each compiled test file into its own process, so this
 * never leaks into other test files.
 */
class FakeWidgetElement {
  constructor(tag, options = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this._text = options.text || "";
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  createEl(tag, options = {}) {
    const child = new FakeWidgetElement(tag, options);
    if (options.cls) child.setAttribute("class", options.cls);
    return this.appendChild(child);
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  get classes() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
  matches(selector) {
    if (selector.startsWith(".")) return this.classes.includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this._text = value;
    this.children = [];
  }
}
/* Assigned from inside a function, never at module top level: a top-level
 * `globalThis.createEl = ...` gets picked up by tsc -p tsconfig.test.json (one
 * program covering every .ts/.js file together) as a global augmentation,
 * which then leaks FakeWidgetElement's shape into createEl's return type for
 * every unrelated production file. Matches the existing withWidgetDom()
 * pattern in test/cm-comparison-decorations.test.js. */
function installFakeCreateEl() {
  globalThis.createEl = (tag, options = {}) => {
    const el = new FakeWidgetElement(tag, options);
    if (options.cls) el.setAttribute("class", options.cls);
    return el;
  };
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
}
installFakeCreateEl();

// The bibliography cache (both getCachedBibtexCatalog()'s and this module's own
// synchronous snapshot) is keyed by path + mtime/size and lives for the whole
// process, so each fixture needs its own path to observe a genuine cold -> warm
// transition instead of picking up another test's cached catalog.
let fixtureCount = 0;

async function flush() {
  // Two ticks: one for loadPandocCitationCatalog()'s internal await, one for
  // the .then() callback that stores the snapshot and dispatches.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Minimal CodeMirror document: a single string, split on "\n". */
function makeFakeDoc(text) {
  const lines = text.split("\n");
  const starts = [];
  let pos = 0;
  for (const line of lines) {
    starts.push(pos);
    pos += line.length + 1;
  }
  return {
    length: text.length,
    lineAt(at) {
      let idx = 0;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= at) idx = i;
        else break;
      }
      const from = starts[idx];
      return { from, to: from + lines[idx].length, text: lines[idx] };
    },
  };
}

function makeFakeView({ text, file, app, selection = [{ from: 0, to: 0 }], livePreview = true }) {
  const doc = makeFakeDoc(text);
  const dispatchCalls = [];
  const view = {
    state: {
      doc,
      selection: { ranges: selection },
      field(f) {
        if (f === editorInfoField) return { app, file };
        if (f === editorLivePreviewField) return livePreview;
        return undefined;
      },
    },
    visibleRanges: [{ from: 0, to: doc.length }],
    dispatch(spec) {
      dispatchCalls.push(spec);
    },
  };
  view.dispatchCalls = dispatchCalls;
  return view;
}

/** Two isolated workspaces (Work-A, Work-A-Extra), each with its own linked
 * research folder and .bib — the exact boundary the task requires never to
 * blur, despite one folder name being a prefix of the other's. */
function createLivePreviewFixture() {
  const suffix = ++fixtureCount;
  const project = new TFolder(`PROJECT-${suffix}`);
  const workA = new TFolder(`${project.path}/Work-A`);
  const workAExtra = new TFolder(`${project.path}/Work-A-Extra`);
  const docA = new TFile(`${project.path}/Work-A/DocA.md`);
  docA.content = "Voir [@smith2024].";
  const docAExtra = new TFile(`${project.path}/Work-A-Extra/DocAExtra.md`);
  docAExtra.content = "Voir [@doe2023].";
  project.children = [workA, workAExtra];
  workA.parent = project;
  workAExtra.parent = project;
  workA.children = [docA];
  workAExtra.children = [docAExtra];
  docA.parent = workA;
  docAExtra.parent = workAExtra;

  const researchA = new TFolder(`RESEARCH-${suffix}/Work-A-Research`);
  const bibA = new TFile(`RESEARCH-${suffix}/Work-A-Research/workA.bib`);
  bibA.content = "@article{smith2024, author = {Smith, John}, year = {2024}}";
  researchA.children = [bibA];
  bibA.parent = researchA;

  const researchAExtra = new TFolder(`RESEARCH-${suffix}/Work-A-Extra-Research`);
  const bibAExtra = new TFile(`RESEARCH-${suffix}/Work-A-Extra-Research/workAExtra.bib`);
  bibAExtra.content = "@article{doe2023, author = {Doe, Jane}, year = {2023}}";
  researchAExtra.children = [bibAExtra];
  bibAExtra.parent = researchAExtra;

  for (const f of [bibA, bibAExtra]) f.stat = { mtime: 1000, size: f.content.length };

  const { vault } = createFakeVault([
    project, workA, workAExtra, docA, docAExtra,
    researchA, bibA, researchAExtra, bibAExtra,
  ]);

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        pandocCitationPreviewStyle: "author-date",
        researchFolderLinks: {
          [workA.path]: researchA.path,
          [workAExtra.path]: researchAExtra.path,
        },
        folderWorkspaces: {
          "Work-A": { version: 1, citekeyBibliographyPath: "workA.bib" },
          "Work-A-Extra": { version: 1, citekeyBibliographyPath: "workAExtra.bib" },
        },
      },
    },
  };

  return { app: { vault }, settings, project, workA, workAExtra, docA, docAExtra, bibA, bibAExtra };
}

function buildPlugin(getSettings) {
  return createPandocCitationLivePreviewExtension(getSettings);
}

async function decorateOnce(text, { file, app, getSettings, selection, livePreview } = {}) {
  const PluginClass = buildPlugin(getSettings);
  const view = makeFakeView({ text, file, app, selection, livePreview });
  const instance = new PluginClass(view);
  await flush();
  instance.update({ view });
  return { instance, view };
}

test("Live Preview: a simple citation is folded into a widget", async () => {
  const f = createLivePreviewFixture();
  const { instance } = await decorateOnce("Voir [@smith2024].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });

  assert.equal(instance.decorations.length, 1, "exactly one decoration");
  const deco = instance.decorations[0];
  assert.ok(deco.widget instanceof PandocCitationWidget);
  assert.equal(deco.widget.text, "(Smith, 2024)");
  assert.deepEqual(deco.widget.citekeys, ["smith2024"]);
  assert.equal(deco.from, "Voir ".length, "decoration starts at the opening [");
  assert.equal(deco.to, "Voir [@smith2024]".length, "decoration ends right after the closing ]");
});

test("Live Preview: a citation with a page locator folds correctly", async () => {
  const f = createLivePreviewFixture();
  const { instance } = await decorateOnce("Voir [@smith2024, p. 42].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });

  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.text, "(Smith, 2024, p. 42)");
});

test("Live Preview: a grouped citation folds into one widget carrying every citekey", async () => {
  const f = createLivePreviewFixture();
  f.bibA.content += "\n@article{doe2023, author = {Doe, Jane}, year = {2023}}";
  f.bibA.stat = { mtime: 2000, size: f.bibA.content.length };
  const { instance } = await decorateOnce("Voir [@smith2024; @doe2023].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });

  assert.equal(instance.decorations.length, 1, "a group is a single decoration");
  assert.equal(instance.decorations[0].widget.text, "(Smith, 2024; Doe, 2023)");
  assert.deepEqual(instance.decorations[0].widget.citekeys, ["smith2024", "doe2023"]);
});

test("Live Preview: the widget's notice carries the bibliographic record with role=tooltip", async () => {
  const f = createLivePreviewFixture();
  f.bibA.content = '@article{smith2024, author = {Smith, John}, title = {A Study}, year = {2024}}';
  f.bibA.stat = { mtime: 3000, size: f.bibA.content.length };
  const { instance } = await decorateOnce("Voir [@smith2024].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });

  const dom = instance.decorations[0].widget.toDOM();
  assert.equal(dom.tagName, "SPAN");
  assert.equal(dom.getAttribute("data-citekeys"), "smith2024");
  assert.equal(dom.getAttribute("tabindex"), "0");
  const tooltip = dom.querySelector(".feuillets-pandoc-citation-tooltip");
  assert.ok(tooltip);
  assert.equal(tooltip.getAttribute("role"), "tooltip");
  assert.equal(dom.getAttribute("aria-describedby"), tooltip.getAttribute("id"));
  assert.match(tooltip.textContent, /Smith, John \(2024\)/);
  assert.match(tooltip.textContent, /A Study/);
});

test("Live Preview: the cursor inside a citation reveals the raw syntax", async () => {
  const f = createLivePreviewFixture();
  const text = "Voir [@smith2024].";
  const citeFrom = text.indexOf("[@");

  // Cursor right in the middle of the citekey.
  const { instance } = await decorateOnce(text, {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
    selection: [{ from: citeFrom + 3, to: citeFrom + 3 }],
  });

  assert.equal(instance.decorations.length, 0, "no widget covers the citation while the cursor is inside it");
});

test("Live Preview: leaving the citation restores the folded widget", async () => {
  const f = createLivePreviewFixture();
  const text = "Voir [@smith2024].";
  const PluginClass = buildPlugin(() => f.settings);
  const insideView = makeFakeView({
    text,
    file: f.docA,
    app: f.app,
    selection: [{ from: text.indexOf("smith"), to: text.indexOf("smith") }],
  });
  const instance = new PluginClass(insideView);
  await flush();
  instance.update({ view: insideView });
  assert.equal(instance.decorations.length, 0, "revealed while the cursor is inside");

  const outsideView = makeFakeView({
    text,
    file: f.docA,
    app: f.app,
    selection: [{ from: 0, to: 0 }],
  });
  instance.update({ view: outsideView });
  assert.equal(instance.decorations.length, 1, "refolded once the cursor leaves");
  assert.equal(instance.decorations[0].widget.text, "(Smith, 2024)");
});

test("Live Preview: Source mode never folds anything", async () => {
  const f = createLivePreviewFixture();
  const { instance } = await decorateOnce("Voir [@smith2024].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
    livePreview: false,
  });

  assert.equal(instance.decorations, Decoration.none, "Source mode keeps the raw citekey visible");
});

test("Live Preview: an unknown citekey is never folded", async () => {
  const f = createLivePreviewFixture();
  const { instance } = await decorateOnce("Voir [@unknownKey] et [@smith2024].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });

  assert.equal(instance.decorations.length, 1, "only the resolvable citation is folded");
  assert.deepEqual(instance.decorations[0].widget.citekeys, ["smith2024"]);
});

test("Live Preview: two editors on Work-A and Work-A-Extra resolve their own bibliography, never each other's", async () => {
  const f = createLivePreviewFixture();

  const { instance: instanceA } = await decorateOnce("Voir [@smith2024].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });
  assert.equal(instanceA.decorations.length, 1, "Work-A resolves its own citekey");

  const { instance: instanceAExtra } = await decorateOnce("Voir [@doe2023].", {
    file: f.docAExtra,
    app: f.app,
    getSettings: () => f.settings,
  });
  assert.equal(instanceAExtra.decorations.length, 1, "Work-A-Extra resolves its own citekey");

  // Cross-check: Work-A's citekey is unknown to Work-A-Extra, and vice versa.
  const { instance: crossA } = await decorateOnce("Voir [@doe2023].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });
  assert.equal(crossA.decorations.length, 0, "Work-A never resolves Work-A-Extra's citekey");

  const { instance: crossAExtra } = await decorateOnce("Voir [@smith2024].", {
    file: f.docAExtra,
    app: f.app,
    getSettings: () => f.settings,
  });
  assert.equal(crossAExtra.decorations.length, 0, "Work-A-Extra never resolves Work-A's citekey");
});

test("Live Preview: clicking a citation is never ignored, so the click reaches CodeMirror's own cursor placement", async () => {
  const f = createLivePreviewFixture();
  const { instance } = await decorateOnce("Voir [@smith2024].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });

  const widget = instance.decorations[0].widget;
  assert.equal(widget.ignoreEvent(), false, "no event is swallowed by the widget itself");
  const dom = widget.toDOM();
  assert.equal(dom.tagName, "SPAN", "a plain span, never a link or a button with its own navigation");
  assert.equal(dom.getAttribute("href"), null);
});

test("Live Preview: the shared BibTeX cache is read once, not on every keystroke", async () => {
  const f = createLivePreviewFixture();
  let reads = 0;
  const baseRead = f.app.vault.read.bind(f.app.vault);
  f.app.vault.read = async (file) => {
    reads += 1;
    return baseRead(file);
  };

  const PluginClass = buildPlugin(() => f.settings);
  const view = makeFakeView({ text: "Voir [@smith2024].", file: f.docA, app: f.app });
  const instance = new PluginClass(view);
  await flush();
  instance.update({ view });
  assert.equal(reads, 1, "the bibliography is read once for the first redraw");
  assert.equal(instance.decorations.length, 1);

  // Simulate many keystrokes: every one triggers update(), none should re-read.
  for (let i = 0; i < 10; i++) {
    instance.update({ view: makeFakeView({ text: "Voir [@smith2024].", file: f.docA, app: f.app }) });
  }
  assert.equal(reads, 1, "no further read across repeated redraws");
});

test("Live Preview: the Markdown source is never modified", async () => {
  const f = createLivePreviewFixture();
  const before = f.docA.content;
  await decorateOnce("Voir [@smith2024].", {
    file: f.docA,
    app: f.app,
    getSettings: () => f.settings,
  });
  assert.equal(f.docA.content, before);
});

/* ------------------------------------------------------------------ *
 * Shared load across multiple views, edit-triggered refresh, and the
 * eq() notice-signature fix.
 * ------------------------------------------------------------------ */

test("Live Preview: two cold editors sharing the same .bib both display their citations without further interaction", async () => {
  const f = createLivePreviewFixture();
  let reads = 0;
  const baseRead = f.app.vault.read.bind(f.app.vault);
  f.app.vault.read = async (file) => {
    reads += 1;
    return baseRead(file);
  };

  // A second file in the SAME workspace (Work-A), sharing bibA.
  const docA2 = new TFile(`${f.workA.path}/DocA2.md`);
  docA2.content = "Voir [@smith2024].";
  docA2.parent = f.workA;

  const PluginClass = buildPlugin(() => f.settings);
  const view1 = makeFakeView({ text: "Voir [@smith2024].", file: f.docA, app: f.app });
  const view2 = makeFakeView({ text: "Voir [@smith2024].", file: docA2, app: f.app });

  const instance1 = new PluginClass(view1);
  const instance2 = new PluginClass(view2);
  assert.ok(isEmpty(instance1.decorations), "cold: editor 1 has nothing loaded yet");
  assert.ok(isEmpty(instance2.decorations), "cold: editor 2 has nothing loaded yet");

  await flush();

  assert.equal(reads, 1, "a single physical read serves both cold editors");
  assert.equal(view1.dispatchCalls.length, 1, "editor 1 is woken once the shared load resolves");
  assert.equal(view2.dispatchCalls.length, 1, "editor 2 is woken too, from the very same load");

  instance1.update({ view: view1 });
  instance2.update({ view: view2 });

  assert.equal(instance1.decorations.length, 1, "editor 1 now shows its citation");
  assert.equal(instance1.decorations[0].widget.text, "(Smith, 2024)");
  assert.equal(instance2.decorations.length, 1, "editor 2 now shows its citation, with no interaction of its own");
  assert.equal(instance2.decorations[0].widget.text, "(Smith, 2024)");
});

test("Live Preview: editing the .bib wakes and refreshes every registered editor", async () => {
  const f = createLivePreviewFixture();
  let reads = 0;
  const baseRead = f.app.vault.read.bind(f.app.vault);
  f.app.vault.read = async (file) => {
    reads += 1;
    return baseRead(file);
  };

  const docA2 = new TFile(`${f.workA.path}/DocA2.md`);
  docA2.content = "Voir [@smith2024].";
  docA2.parent = f.workA;

  const PluginClass = buildPlugin(() => f.settings);
  const view1 = makeFakeView({ text: "Voir [@smith2024].", file: f.docA, app: f.app });
  const view2 = makeFakeView({ text: "Voir [@smith2024].", file: docA2, app: f.app });
  const instance1 = new PluginClass(view1);
  const instance2 = new PluginClass(view2);
  await flush();
  instance1.update({ view: view1 });
  instance2.update({ view: view2 });
  assert.equal(instance1.decorations[0].widget.text, "(Smith, 2024)");
  assert.equal(instance2.decorations[0].widget.text, "(Smith, 2024)");
  assert.equal(reads, 1);

  const dispatchesBefore1 = view1.dispatchCalls.length;
  const dispatchesBefore2 = view2.dispatchCalls.length;

  // Edit the .bib on disk: new author, mtime/size bumped (the same pair
  // getCachedBibtexCatalog() keys its own cache on).
  f.bibA.content = "@article{smith2024, author = {Smithers, John}, year = {2024}}";
  f.bibA.stat = { mtime: 2000, size: f.bibA.content.length };

  notifyPandocCitationBibliographyChanged(f.bibA);

  assert.equal(view1.dispatchCalls.length, dispatchesBefore1 + 1, "editor 1 is woken by the edit");
  assert.equal(view2.dispatchCalls.length, dispatchesBefore2 + 1, "editor 2 is woken by the edit too");

  // The wake-up rebuild finds the snapshot invalidated and kicks off one new
  // (deduplicated) load; not yet resolved on this pass.
  instance1.update({ view: view1 });
  instance2.update({ view: view2 });
  assert.equal(reads, 2, "exactly one new physical read for the edit, shared by both editors");

  await flush();
  instance1.update({ view: view1 });
  instance2.update({ view: view2 });

  assert.equal(instance1.decorations[0].widget.text, "(Smithers, 2024)", "editor 1 shows the updated author");
  assert.equal(instance2.decorations[0].widget.text, "(Smithers, 2024)", "editor 2 shows the updated author");
  assert.equal(reads, 2, "still no further read beyond the single edit-triggered one");
});

test("Live Preview: modifying one .bib never wakes an editor using a different one", async () => {
  const f = createLivePreviewFixture();
  const PluginClass = buildPlugin(() => f.settings);
  const viewA = makeFakeView({ text: "Voir [@smith2024].", file: f.docA, app: f.app });
  const viewAExtra = makeFakeView({ text: "Voir [@doe2023].", file: f.docAExtra, app: f.app });
  const instanceA = new PluginClass(viewA);
  const instanceAExtra = new PluginClass(viewAExtra);
  await flush();
  instanceA.update({ view: viewA });
  instanceAExtra.update({ view: viewAExtra });
  assert.equal(instanceA.decorations[0].widget.text, "(Smith, 2024)");
  assert.equal(instanceAExtra.decorations[0].widget.text, "(Doe, 2023)");

  const beforeA = viewA.dispatchCalls.length;
  const beforeAExtra = viewAExtra.dispatchCalls.length;

  f.bibA.content = "@article{smith2024, author = {Smithers, John}, year = {2024}}";
  f.bibA.stat = { mtime: 2000, size: f.bibA.content.length };
  notifyPandocCitationBibliographyChanged(f.bibA);

  assert.equal(viewA.dispatchCalls.length, beforeA + 1, "Work-A's editor is woken by its own .bib changing");
  assert.equal(
    viewAExtra.dispatchCalls.length,
    beforeAExtra,
    "Work-A-Extra's editor, using a different .bib, is never woken"
  );
});

test("Live Preview: destroy() unregisters the editor — a later .bib edit never wakes it again", async () => {
  const f = createLivePreviewFixture();
  const PluginClass = buildPlugin(() => f.settings);
  const view = makeFakeView({ text: "Voir [@smith2024].", file: f.docA, app: f.app });
  const instance = new PluginClass(view);
  await flush();
  instance.update({ view });
  assert.equal(instance.decorations[0].widget.text, "(Smith, 2024)", "warmed up correctly first");

  instance.destroy();

  const before = view.dispatchCalls.length;
  f.bibA.content = "@article{smith2024, author = {Smithers, John}, year = {2024}}";
  f.bibA.stat = { mtime: 2000, size: f.bibA.content.length };
  notifyPandocCitationBibliographyChanged(f.bibA);

  assert.equal(view.dispatchCalls.length, before, "a destroyed editor is never dispatched to again");

  // No residual entry blocking a fresh editor from registering under the same path.
  const view2 = makeFakeView({ text: "Voir [@smith2024].", file: f.docA, app: f.app });
  const instance2 = new PluginClass(view2);
  await flush();
  instance2.update({ view: view2 });
  assert.equal(instance2.decorations[0].widget.text, "(Smithers, 2024)", "a fresh editor registers and resolves cleanly");
});

test("PandocCitationWidget.eq(): a notice-only change (title, pages, DOI) is never treated as equal, even with the same visible text", () => {
  const base = {
    key: "smith2024",
    type: "article",
    title: "First Title",
    authors: ["Smith"],
    year: "2024",
    author: "Smith, John",
  };
  const recordsBefore = new Map([["smith2024", { ...base }]]);
  const recordsSame = new Map([["smith2024", { ...base }]]);
  const recordsAfterTitle = new Map([["smith2024", { ...base, title: "Second Title" }]]);
  const recordsAfterPages = new Map([["smith2024", { ...base, pages: "12-34" }]]);
  const recordsAfterDoi = new Map([["smith2024", { ...base, doi: "10.1234/xyz" }]]);

  const before = new PandocCitationWidget("(Smith, 2024)", ["smith2024"], recordsBefore);
  const same = new PandocCitationWidget("(Smith, 2024)", ["smith2024"], recordsSame);
  const afterTitle = new PandocCitationWidget("(Smith, 2024)", ["smith2024"], recordsAfterTitle);
  const afterPages = new PandocCitationWidget("(Smith, 2024)", ["smith2024"], recordsAfterPages);
  const afterDoi = new PandocCitationWidget("(Smith, 2024)", ["smith2024"], recordsAfterDoi);

  assert.equal(before.eq(same), true, "identical record: still equal, DOM reused");
  assert.equal(before.eq(afterTitle), false, "title changed alone must invalidate the notice");
  assert.equal(before.eq(afterPages), false, "pages changed alone must invalidate the notice");
  assert.equal(before.eq(afterDoi), false, "DOI changed alone must invalidate the notice");
});

test("styles.css: the citation tooltip meets the readability requirements, behavior and classes unchanged, no !important", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "styles.css"), "utf8");
  const start = css.indexOf(".feuillets-pandoc-citation {");
  assert.ok(start !== -1, "the citation section exists");
  const primaryIdx = css.indexOf(".feuillets-pandoc-citation-notice-line.is-primary {", start);
  const blockEnd = css.indexOf("}", primaryIdx) + 1;
  const block = css.slice(start, blockEnd);

  const tooltipRule = block.slice(block.indexOf(".feuillets-pandoc-citation-tooltip {"));
  assert.match(tooltipRule, /font-size:\s*14px/, "at least 14px");
  assert.match(tooltipRule, /line-height:\s*1\.5/);
  assert.match(tooltipRule, /color:\s*var\(--text-normal\)/);
  assert.match(
    tooltipRule,
    /min-width:\s*min\(280px,\s*calc\(100vw - 24px\)\)/,
    "never wider than the viewport minus margin on a narrow screen either"
  );
  assert.match(tooltipRule, /max-width:\s*min\(420px/, "capped at 420px and never overflowing a small screen");
  assert.match(
    tooltipRule,
    /padding:\s*var\(--size-4-3\)\s*var\(--size-4-4\)/,
    "padding increased from the previous var(--size-4-2) var(--size-4-3)"
  );
  assert.match(tooltipRule, /background:\s*var\(--background-secondary\)/, "opaque background, no alpha");
  assert.match(
    tooltipRule,
    /border:\s*1px solid var\(--background-modifier-border-hover/,
    "border slightly reinforced"
  );
  assert.match(tooltipRule, /box-shadow:\s*var\(--shadow-l/, "shadow slightly reinforced");

  assert.match(
    block,
    /\.feuillets-pandoc-citation-notice-line\.is-primary\s*\{[^}]*font-weight:\s*700/,
    "author/date clearly bold"
  );

  assert.ok(!/!important/.test(block), "no !important anywhere in the citation section");

  // Behavior preserved: hidden by default, revealed on hover/focus.
  assert.match(block, /\.feuillets-pandoc-citation-tooltip\s*\{[^}]*display:\s*none/);
  assert.match(block, /\.feuillets-pandoc-citation:hover\s*>\s*\.feuillets-pandoc-citation-tooltip/);
  assert.match(block, /\.feuillets-pandoc-citation:focus-within\s*>\s*\.feuillets-pandoc-citation-tooltip/);

  // Accessible classes untouched.
  assert.match(block, /\.feuillets-pandoc-citation-notice\b/);
  assert.match(block, /\.feuillets-pandoc-citation-notice-line\b/);
});

test("source file: cm-pandoc-citation-live-preview.ts contains 0 NUL byte", () => {
  const filePath = path.join(process.cwd(), "src/utils/cm-pandoc-citation-live-preview.ts");
  const data = fs.readFileSync(filePath);
  assert.ok(!data.includes(0), "the source file must be plain UTF-8 text, never a literal NUL byte");
});
