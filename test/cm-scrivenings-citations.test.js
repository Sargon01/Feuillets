import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createScriveningsCitationExtension } from "../src/utils/cm-scrivenings-citations.js";
import { PandocCitationWidget } from "../src/utils/cm-pandoc-citation-live-preview.js";
import { notifyPandocCitationBibliographyChanged } from "../src/services/pandoc-citation-preview.js";
import { buildScriveningsDocument, boundaryOffsets } from "../src/services/scrivenings-document.js";

/**
 * `createEl`/`createSpan` (global Obsidian DOM helpers): PandocCitationWidget.toDOM()
 * calls them exactly as it would in the real app — same shim as
 * cm-pandoc-citation-live-preview.test.js, only what the one test below that
 * calls `.toDOM()` actually needs (attributes + querySelectorAll for the
 * tooltip class).
 */
class FakeWidgetElement {
  constructor(tag, options = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this._text = options.text || "";
    if (options.cls) this.setAttribute("class", options.cls);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  createEl(tag, options = {}) {
    const child = new FakeWidgetElement(tag, options);
    child.ownerDocument = this.ownerDocument;
    return this.appendChild(child);
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  get classes() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
  matches(selector) {
    return selector.startsWith(".") && this.classes.includes(selector.slice(1));
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
  /** Never dispatched by these tests — present so
   * buildPandocCitationElement()'s attachCitationTooltipBehavior() can
   * register its listeners without throwing at construction time (see the
   * identical comment in cm-pandoc-citation-live-preview.test.js). */
  addEventListener() {}
  removeEventListener() {}
}
/** buildPandocCitationElement() (pandoc-citation-preview.ts) now builds the
 * citation's root element via `view.dom.ownerDocument.createElement(...)` —
 * never the global `createSpan()` — so `view.dom` (set in makeFakeView(),
 * below) needs a real `.ownerDocument` supporting `createElement`. */
class FakeDocument {
  constructor() {
    // buildPandocCitationElement() (pandoc-citation-preview.ts) builds the
    // citation's root element via `ownerDocument.defaultView.createSpan(...)`
    // — never the global `createSpan()` — matching real Obsidian, where
    // `Document.defaultView` (typed `... & typeof globalThis`) is what
    // actually carries the `createEl`/`createSpan` globals for that
    // document's OWN window.
    const doc = this;
    this.defaultView = {
      createEl(tag, options = {}) {
        const el = new FakeWidgetElement(tag);
        el.ownerDocument = doc;
        if (options.cls) el.setAttribute("class", options.cls);
        return el;
      },
      createSpan(options = {}) {
        return this.createEl("span", options);
      },
    };
  }
  createElement(tag) {
    const el = new FakeWidgetElement(tag);
    el.ownerDocument = this;
    return el;
  }
}
/* Assigned from inside a function, never at module top level — same reason
 * as cm-pandoc-citation-live-preview.test.js's installFakeCreateEl(): a
 * top-level `globalThis.createEl = ...` gets picked up by
 * `tsc -p tsconfig.test.json` as a global augmentation that would leak
 * FakeWidgetElement's shape into createEl's return type for every
 * unrelated production file. */
function installFakeCreateEl() {
  globalThis.createEl = (tag, options = {}) => new FakeWidgetElement(tag, options);
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
}
installFakeCreateEl();

/** Fake field symbol — the REAL `scriveningsBoundariesField` (cm-scrivenings.ts)
 * is always passed as a parameter to cm-scrivenings-citations.ts, never
 * imported (see that module's "SENS DE DÉPENDANCE" doc comment) — any value
 * works here, the fake state below just returns the boundaries for it. */
const FAKE_BOUNDARIES_FIELD = Symbol("scrivenings-boundaries-field-test");

let fixtureCount = 0;

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Minimal CodeMirror document over the composite text — same shape as the
 * one used by cm-pandoc-citation-live-preview.test.js's makeFakeDoc(). */
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
    sliceString(from, to) {
      return text.slice(from, to === undefined ? text.length : to);
    },
  };
}

function makeFakeView({ text, boundaries, selection = [{ from: 0, to: 0 }], visibleRanges }) {
  const doc = makeFakeDoc(text);
  const dispatchCalls = [];
  const dom = new FakeWidgetElement("div");
  dom.ownerDocument = new FakeDocument();
  const view = {
    state: {
      doc,
      selection: { ranges: selection },
      field(f) {
        if (f === FAKE_BOUNDARIES_FIELD) return boundaries;
        return undefined;
      },
    },
    visibleRanges: visibleRanges ?? [{ from: 0, to: doc.length }],
    dispatch(spec) {
      dispatchCalls.push(spec);
    },
    dom,
  };
  view.dispatchCalls = dispatchCalls;
  return view;
}

/** Two isolated workspaces (Work-A, Work-A-Extra), each with its own linked
 * research folder and .bib — same fixture shape as
 * cm-pandoc-citation-live-preview.test.js's createLivePreviewFixture(), but
 * both files are loaded into ONE composite Continu document instead of two
 * separate single-file editors. */
function createScriveningsCitationFixture() {
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

/** Builds the composite document + fake view + plugin instance for a fixture,
 * with `files` (in segment order) driving cm-scrivenings-citations.ts'
 * per-segment scope resolution. */
function mountFixture(f, files, { selection, visibleRanges } = {}) {
  const doc = buildScriveningsDocument(files.map((file) => ({ file, content: file.content })));
  const boundaries = boundaryOffsets(doc);
  const PluginClass = createScriveningsCitationExtension(FAKE_BOUNDARIES_FIELD, f.app, () => f.settings, files);
  const view = makeFakeView({ text: doc.text, boundaries, selection, visibleRanges });
  const instance = new PluginClass(view);
  return { doc, instance, view, PluginClass };
}

test("Continu: a simple citation is folded into a widget", async () => {
  const f = createScriveningsCitationFixture();
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 1);
  const deco = instance.decorations[0];
  assert.ok(deco.widget instanceof PandocCitationWidget);
  assert.equal(deco.widget.text, "(Smith, 2024)");
  assert.deepEqual(deco.widget.citekeys, ["smith2024"]);
});

test("Continu: a citation with a page locator folds correctly", async () => {
  const f = createScriveningsCitationFixture();
  f.docA.content = "Voir [@smith2024, p. 42].";
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.text, "(Smith, 2024, p. 42)");
});

test("Continu: a grouped citation folds into one widget carrying every citekey", async () => {
  const f = createScriveningsCitationFixture();
  f.bibA.content += "\n@article{doe2023, author = {Doe, Jane}, year = {2023}}";
  f.bibA.stat = { mtime: 2000, size: f.bibA.content.length };
  f.docA.content = "Voir [@smith2024; @doe2023].";
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 1, "a group is a single decoration");
  assert.equal(instance.decorations[0].widget.text, "(Smith, 2024; Doe, 2023)");
  assert.deepEqual(instance.decorations[0].widget.citekeys, ["smith2024", "doe2023"]);
});

test("Continu: an unknown citekey is never folded, raw syntax stays visible", async () => {
  const f = createScriveningsCitationFixture();
  f.docA.content = "Voir [@unknownKey] et [@smith2024].";
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 1, "only the resolvable citation is folded");
  assert.deepEqual(instance.decorations[0].widget.citekeys, ["smith2024"]);
});

/* ------------------------------------------------------------------ *
 * Narrative citations: @who2021 → "World Health Organization (2021)".
 * ------------------------------------------------------------------ */

test("Continu: a narrative citation folds as Author (Year), never (Author, Year)", async () => {
  const f = createScriveningsCitationFixture();
  f.bibA.content = "@report{who2021, author = {{World Health Organization}}, year = {2021}}";
  f.bibA.stat = { mtime: 2000, size: f.bibA.content.length };
  f.docA.content = "Selon @who2021, ce point est établi.";
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.text, "World Health Organization (2021)");
  assert.deepEqual(instance.decorations[0].widget.citekeys, ["who2021"]);
});

test("Continu: a narrative citation in two segments using two distinct .bib files both resolve, from their own scope", async () => {
  const f = createScriveningsCitationFixture();
  f.bibA.content = "@report{who2021, author = {{World Health Organization}}, year = {2021}}";
  f.bibA.stat = { mtime: 2000, size: f.bibA.content.length };
  f.docA.content = "Selon @who2021, ce point est établi.";
  // docAExtra/bibAExtra keep the fixture's own default (doe2023 → Doe, Jane, 2023).
  f.docAExtra.content = "Selon @doe2023, un autre point se dégage.";

  const { instance, view } = mountFixture(f, [f.docA, f.docAExtra]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 2, "both narrative citations resolve, each from its own segment's scope");
  const texts = instance.decorations.map((d) => d.widget.text).sort();
  assert.deepEqual(texts, ["Doe (2023)", "World Health Organization (2021)"]);
});

test("Continu: an unknown narrative citekey is never folded", async () => {
  const f = createScriveningsCitationFixture();
  f.docA.content = "Selon @unknownAuthor2021, ce point est établi.";
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 0);
});

test("Continu: an email address is never mistaken for a narrative citation", async () => {
  const f = createScriveningsCitationFixture();
  f.docA.content = "Contactez smith2024@example.com pour plus d'informations.";
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 0);
});

test("Continu: a citation inside inline code is never folded, in any segment, bracket or narrative", async () => {
  const f = createScriveningsCitationFixture();
  f.docA.content = "Code : `[@smith2024]` puis prose Selon @smith2024, établi.";
  const codeStart = f.docA.content.indexOf("`[@smith2024]`");
  const codeEnd = codeStart + "`[@smith2024]`".length;
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 1, "only the prose narrative citation folds, never the one inside code");
  assert.equal(instance.decorations[0].widget.text, "Smith (2024)");
  assert.ok(instance.decorations[0].from >= codeEnd, "the surviving decoration is the one AFTER the code span");
});

test("Continu: a citation inside a fenced code block is never folded", async () => {
  const f = createScriveningsCitationFixture();
  f.docA.content = "Avant.\n```\n[@smith2024]\n```\nSelon @smith2024, établi.";
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 1, "only the prose citation after the fenced block folds");
  assert.equal(instance.decorations[0].widget.text, "Smith (2024)");
});

test("Continu: two feuillets from two different .bib in the SAME view resolve their own scope, no leakage", async () => {
  const f = createScriveningsCitationFixture();
  const { instance, view } = mountFixture(f, [f.docA, f.docAExtra]);
  await flush();
  instance.update({ view });

  assert.equal(instance.decorations.length, 2, "both citations resolve, each from its own scope");
  const texts = instance.decorations.map((d) => d.widget.text).sort();
  assert.deepEqual(texts, ["(Doe, 2023)", "(Smith, 2024)"]);
});

test("Continu: a citekey from one scope is never resolved against the other scope's segment", async () => {
  const f = createScriveningsCitationFixture();
  // Work-A's segment cites Work-A-Extra's key: must stay raw.
  f.docA.content = "Voir [@doe2023].";
  const { instance, view } = mountFixture(f, [f.docA, f.docAExtra]);
  await flush();
  instance.update({ view });

  // Only docAExtra's own citation (doe2023, resolved against ITS bib) folds;
  // docA's [@doe2023] never resolves against Work-A's bibA.
  assert.equal(instance.decorations.length, 1);
  assert.equal(instance.decorations[0].widget.text, "(Doe, 2023)");
  const doc = buildScriveningsDocument([
    { file: f.docA, content: f.docA.content },
    { file: f.docAExtra, content: f.docAExtra.content },
  ]);
  const docAExtraSegment = doc.segments[1];
  assert.ok(
    instance.decorations[0].from >= docAExtraSegment.from,
    "the single folded citation belongs to docAExtra's own segment, not docA's"
  );
});

test("Continu: the shared BibTeX cache is read once, not on every keystroke", async () => {
  const f = createScriveningsCitationFixture();
  let reads = 0;
  const baseRead = f.app.vault.read.bind(f.app.vault);
  f.app.vault.read = async (file) => {
    reads += 1;
    return baseRead(file);
  };

  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  instance.update({ view });
  assert.equal(reads, 1, "the bibliography is read once for the first redraw");
  assert.equal(instance.decorations.length, 1);

  for (let i = 0; i < 10; i++) {
    instance.update({ view: mountFixture(f, [f.docA]).view });
  }
  assert.equal(reads, 1, "no further read across repeated redraws");
});

test("Continu: editing a .bib refreshes only the Continu view(s) that actually depend on it", async () => {
  const f = createScriveningsCitationFixture();
  const { instance, view } = mountFixture(f, [f.docA, f.docAExtra]);
  await flush();
  instance.update({ view });
  assert.deepEqual(
    instance.decorations.map((d) => d.widget.text).sort(),
    ["(Doe, 2023)", "(Smith, 2024)"]
  );

  // A second, unrelated Continu view (its own fixture, its own .bib files)
  // open at the same time — the requirement under test is that it is NEVER
  // woken by a .bib it has nothing to do with.
  const other = createScriveningsCitationFixture();
  const { instance: otherInstance, view: otherView } = mountFixture(other, [other.docA]);
  await flush();
  otherInstance.update({ view: otherView });
  assert.equal(otherInstance.decorations.length, 1);

  const before = view.dispatchCalls.length;
  const otherBefore = otherView.dispatchCalls.length;
  f.bibA.content = "@article{smith2024, author = {Smithers, John}, year = {2024}}";
  f.bibA.stat = { mtime: 2000, size: f.bibA.content.length };
  notifyPandocCitationBibliographyChanged(f.bibA);
  assert.equal(view.dispatchCalls.length, before + 1, "this Continu view is woken: it depends on bibA");
  assert.equal(otherView.dispatchCalls.length, otherBefore, "the unrelated Continu view is never woken");

  instance.update({ view });
  await flush();
  instance.update({ view });
  assert.deepEqual(
    instance.decorations.map((d) => d.widget.text).sort(),
    ["(Doe, 2023)", "(Smithers, 2024)"]
  );

  const beforeSecondSegment = view.dispatchCalls.length;
  f.bibAExtra.content = "@article{doe2023, author = {Does, Jane}, year = {2023}}";
  f.bibAExtra.stat = { mtime: 3000, size: f.bibAExtra.content.length };
  // Changing Work-A-Extra's bib ALSO wakes this same view, since it has a
  // second segment (docAExtra) that depends on it — never "only one .bib per
  // Continu view".
  notifyPandocCitationBibliographyChanged(f.bibAExtra);
  assert.equal(view.dispatchCalls.length, beforeSecondSegment + 1, "the same view is woken for a .bib its OTHER segment depends on");
});

test("Continu: no residual decoration or notice duplicates after several re-renders", async () => {
  const f = createScriveningsCitationFixture();
  const { instance, view } = mountFixture(f, [f.docA]);
  await flush();
  for (let i = 0; i < 5; i++) instance.update({ view });

  assert.equal(instance.decorations.length, 1, "still exactly one decoration, never accumulated");
  const dom = instance.decorations[0].widget.toDOM(view);
  assert.equal(dom.querySelectorAll(".feuillets-pandoc-citation-tooltip").length, 1);
});

test("Continu: the Vault is never written to", async () => {
  const f = createScriveningsCitationFixture();
  let wrote = false;
  f.app.vault.modify = async () => { wrote = true; };
  f.app.vault.process = async () => { wrote = true; };
  const { instance, view } = mountFixture(f, [f.docA, f.docAExtra]);
  await flush();
  instance.update({ view });
  assert.equal(wrote, false);
});

test("Continu: destroy() unregisters every path this view depended on", async () => {
  const f = createScriveningsCitationFixture();
  const { instance, view } = mountFixture(f, [f.docA, f.docAExtra]);
  await flush();
  instance.update({ view });
  assert.equal(instance.decorations.length, 2);

  instance.destroy();

  const before = view.dispatchCalls.length;
  f.bibA.content = "@article{smith2024, author = {Smithers, John}, year = {2024}}";
  f.bibA.stat = { mtime: 4000, size: f.bibA.content.length };
  notifyPandocCitationBibliographyChanged(f.bibA);
  f.bibAExtra.content = "@article{doe2023, author = {Does, Jane}, year = {2023}}";
  f.bibAExtra.stat = { mtime: 4000, size: f.bibAExtra.content.length };
  notifyPandocCitationBibliographyChanged(f.bibAExtra);

  assert.equal(view.dispatchCalls.length, before, "a destroyed Continu view is never dispatched to again");
});
