import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder, editorInfoField, editorLivePreviewField } from "obsidian";
import { Decoration } from "@codemirror/view";
import { createEditorImageCaptionExtension } from "../src/utils/cm-editor-image-caption.js";

/*
 * Normal-editor captioned-image widget — same small fake-DOM/fake-CM6
 * harness pattern as test/cm-pandoc-citation-live-preview.test.js (the
 * established precedent for this exact architecture: editorInfoField,
 * editorLivePreviewField, selection-overlap cursor-reveal).
 *
 * CRITICAL regression this file guards against: an earlier version of this
 * widget let pointer events fall through to CodeMirror's own click handling
 * (ignoreEvent() => false, copied from PandocCitationWidget), which handed
 * the click to Obsidian's native Live-Preview embed-click machinery. That
 * machinery misparses this exact bracket-escaped captioned syntax and opens
 * a blank tab with "Impossible d'ouvrir le fichier "" " instead of revealing
 * the raw Markdown. The tests below assert the fix directly: preventDefault
 * + stopPropagation on the widget's own mousedown, ignoreEvent() => true,
 * a selection-only dispatch (never a document change), and the complete
 * absence of any navigation call or `<a>`/href-bearing element in the DOM.
 */

function isEmpty(decorations) {
  return decorations === Decoration.none || (Array.isArray(decorations) && decorations.length === 0);
}

class FakeWidgetElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this._text = "";
    this._listeners = {};
    this.draggable = true;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  dispatch(type, event) { for (const fn of this._listeners[type] || []) fn(event); }
  appendChild(child) { this.children.push(child); return child; }
  createEl(tag, options = {}) {
    const child = new FakeWidgetElement(tag);
    if (options.cls) child.setAttribute("class", options.cls);
    return this.appendChild(child);
  }
  createSpan(options = {}) { return this.createEl("span", options); }
  setText(text) { this._text = text; return this; }
  get classes() { return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
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
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
}

function installFakeCreateEl() {
  globalThis.createEl = (tag, options = {}) => {
    const el = new FakeWidgetElement(tag);
    if (options.cls) el.setAttribute("class", options.cls);
    return el;
  };
  globalThis.createSpan = (options = {}) => globalThis.createEl("span", options);
}
installFakeCreateEl();

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

function makeFakeView({ text, file, app, selection, livePreview = true, noEditorInfo = false }) {
  const doc = makeFakeDoc(text);
  const resolvedSelection = selection ?? [{ from: text.length, to: text.length }];
  const dispatchCalls = [];
  const view = {
    state: {
      doc,
      selection: { ranges: resolvedSelection },
      field(f) {
        if (noEditorInfo) return undefined;
        if (f === editorInfoField) return { app, file };
        if (f === editorLivePreviewField) return livePreview;
        return undefined;
      },
    },
    visibleRanges: [{ from: 0, to: doc.length }],
    requestMeasure() {},
    dispatch(spec) { dispatchCalls.push(spec); },
    focus() { view.focused = true; },
  };
  view.dispatchCalls = dispatchCalls;
  return view;
}

function fixture() {
  const project = new TFolder("Project");
  const chapter = new TFolder("Project/Chapter");
  const sheet = new TFile("Project/Chapter/scene.md");
  const image = new TFile("Project/Chapter/image.png");
  image.extension = "png";
  const spacedImage = new TFile("Project/Chapter/Pasted image 1.png");
  spacedImage.extension = "png";
  const unicodeImage = new TFile("Project/Chapter/Vue générale à l'aube.png");
  unicodeImage.extension = "png";
  const nonImage = new TFile("Project/Chapter/note.md");
  const aux = new TFolder("Project/_Feuillets");
  const auxNote = new TFile("Project/_Feuillets/note.md");

  project.children = [chapter, aux];
  chapter.parent = project;
  chapter.children = [sheet, image, spacedImage, unicodeImage, nonImage];
  for (const f of [sheet, image, spacedImage, unicodeImage, nonImage]) f.parent = chapter;
  aux.parent = project;
  aux.children = [auxNote];
  auxNote.parent = aux;

  const outsider = new TFile("Elsewhere/note.md");
  const outsiderFolder = new TFolder("Elsewhere");
  outsiderFolder.children = [outsider];
  outsider.parent = outsiderFolder;

  const all = new Map();
  const register = (n) => { all.set(n.path, n); (n.children || []).forEach(register); };
  register(project);
  register(outsiderFolder);

  let openLinkTextCalled = false;
  const app = {
    vault: {
      getResourcePath: (f) => `app://local/${f.path}`,
      getAbstractFileByPath: (p) => all.get(p) || null,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath) => {
        if (all.has(linkpath)) return all.get(linkpath);
        for (const node of all.values()) {
          if (node instanceof TFile && (node.name === linkpath || node.basename === linkpath)) return node;
        }
        return null;
      },
    },
    workspace: {
      // Never legitimately called by this widget — a spy that fails the
      // test the instant it is, rather than silently succeeding.
      openLinkText: () => { openLinkTextCalled = true; throw new Error("openLinkText must never be called by the image widget"); },
    },
  };
  return {
    app, settings: { projectFolder: project.path },
    sheet, image, spacedImage, unicodeImage, nonImage, outsider,
    wasOpenLinkTextCalled: () => openLinkTextCalled,
  };
}

function buildPlugin(getSettings) {
  const extension = createEditorImageCaptionExtension(getSettings);
  // `Prec.highest(...)` (the fix for Obsidian's own native image-embed
  // decoration winning the render over ours for an ORDINARY caption — see
  // this module's doc comment) wraps the plugin class in the stub's
  // inspectable `{ prec: "highest", extension }` marker; the real
  // `@codemirror/state` `Prec.highest` returns an opaque `Extension`
  // instead, but the plugin class itself is unaffected either way, so
  // unwrapping it here (rather than changing what `decorateOnce` does with
  // it) is the only thing that needs to know about the marker.
  return extension && typeof extension === "object" && extension.prec === "highest" ? extension.extension : extension;
}

function decorateOnce(imageLine, opts) {
  const PluginClass = buildPlugin(opts.getSettings || (() => opts.settings));
  // A trailing second line so the default "cursor away" selection (end of
  // document) never lands on the image line itself.
  const text = opts.selection || opts.multiline || opts.noEditorInfo ? imageLine : `${imageLine}\nAutre ligne.`;
  const view = makeFakeView({ text, ...opts });
  const instance = new PluginClass(view);
  return { instance, view };
}

const imgOf = (deco) => deco.widget.toDOM({ requestMeasure() {} }).querySelector("img");
const captionOf = (deco) => deco.widget.toDOM({ requestMeasure() {} }).querySelector(".cm-scrivenings-image-caption");

/* --- Basic rendering (unchanged from before the interaction fix) -------- */

test("1/6. a captioned image line becomes exactly one figure widget, caption decoded exactly", () => {
  const fx = fixture();
  const text = "![Vue générale](image.png)";
  const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(isEmpty(instance.decorations), false);
  assert.equal(instance.decorations.length, 1);
  const deco = instance.decorations[0];
  assert.equal(deco.from, 0);
  assert.equal(deco.to, text.length);
  // Never `block: true` — a block-level replace decoration from a
  // ViewPlugin is invalid CodeMirror 6 (`RangeError: Block decorations may
  // not be specified via plugins`), the real, reproduced root cause of the
  // "blank tab" regression: it crashed the MarkdownView before it could
  // even render. Visual block-ness comes from CSS (`display: block` on
  // .cm-scrivenings-image-embed), never from the decoration spec.
  assert.equal(deco.block, undefined);
  assert.equal(imgOf(deco).src, "app://local/Project/Chapter/image.png");
  assert.equal(captionOf(deco).textContent, "Vue générale");
});

test("2/17. caption starting with an escaped '[' still renders the image, caption text is '[Carte] ...'", () => {
  const fx = fixture();
  const text = "![\\[Carte\\] Vue générale](<Pasted image 1.png>)";
  const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(instance.decorations.length, 1);
  const deco = instance.decorations[0];
  assert.ok(imgOf(deco));
  assert.equal(captionOf(deco).textContent, "[Carte] Vue générale");
});

test("18. angle-bracket path with spaces resolves to the real file", () => {
  const fx = fixture();
  const text = "![Caption](<Pasted image 1.png>)";
  const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(instance.decorations.length, 1);
  assert.match(imgOf(instance.decorations[0]).src, /Pasted image 1\.png$/);
});

test("URI-encoded path resolves to the real file", () => {
  const fx = fixture();
  const text = "![Caption](Pasted%20image%201.png)";
  const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(instance.decorations.length, 1);
  assert.match(imgOf(instance.decorations[0]).src, /Pasted image 1\.png$/);
});

test("Unicode filename resolves to the real file", () => {
  const fx = fixture();
  const text = "![Caption](<Vue générale à l'aube.png>)";
  const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(instance.decorations.length, 1);
  assert.match(imgOf(instance.decorations[0]).src, /Vue générale à l'aube\.png$/);
});

test("cursor touching the image line hides the widget; leaving it restores it", () => {
  const fx = fixture();
  const text = "![Caption](image.png)";
  const touching = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings, selection: [{ from: 3, to: 3 }] });
  assert.equal(isEmpty(touching.instance.decorations), true);

  const away = decorateOnce(`${text}\nAutre ligne.`, { file: fx.sheet, app: fx.app, settings: fx.settings, selection: [{ from: text.length + 3, to: text.length + 3 }] });
  assert.equal(away.instance.decorations.length, 1);

  const instance = away.instance;
  instance.update({ view: makeFakeView({ text: `${text}\nAutre ligne.`, file: fx.sheet, app: fx.app, selection: [{ from: 3, to: 3 }] }) });
  assert.equal(isEmpty(instance.decorations), true);
  instance.update({ view: makeFakeView({ text: `${text}\nAutre ligne.`, file: fx.sheet, app: fx.app, selection: [{ from: text.length + 3, to: text.length + 3 }] }) });
  assert.equal(instance.decorations.length, 1);
});

test("16. a plain uncaptioned embed is left untouched (native Obsidian rendering)", () => {
  const fx = fixture();
  for (const text of ["![[image.png]]", "![](image.png)"]) {
    const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
    assert.equal(isEmpty(instance.decorations), true, `expected no widget for ${JSON.stringify(text)}`);
  }
});

test("a numeric size wikilink embed is left untouched", () => {
  const fx = fixture();
  for (const text of ["![[image.png|300]]", "![[image.png|300x200]]"]) {
    const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
    assert.equal(isEmpty(instance.decorations), true, `expected no widget for ${JSON.stringify(text)}`);
  }
});

test("a note outside the active project is left untouched", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](image.png)", { file: fx.outsider, app: fx.app, settings: fx.settings });
  assert.equal(isEmpty(instance.decorations), true);
});

test("a note under _Feuillets/ is left untouched even though it is technically inside the project folder", () => {
  const fx = fixture();
  const auxNote = fx.app.metadataCache.getFirstLinkpathDest("Project/_Feuillets/note.md");
  const { instance } = decorateOnce("![Caption](image.png)", { file: auxNote, app: fx.app, settings: fx.settings });
  assert.equal(isEmpty(instance.decorations), true);
});

test("11. an unresolved image target fails closed to the source Markdown, never a broken widget", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](ghost.png)", { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(isEmpty(instance.decorations), true);
});

test("10. Source mode never folds the image, even when eligible and captioned", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](image.png)", { file: fx.sheet, app: fx.app, settings: fx.settings, livePreview: false });
  assert.equal(isEmpty(instance.decorations), true);
});

test("10. an editor with no editorInfoField.file (new/empty tab) produces zero decorations", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](image.png)", { file: null, app: fx.app, settings: fx.settings });
  assert.equal(isEmpty(instance.decorations), true);
});

test("10b. an editor with no editorInfoField at all (fully bare CM6 instance) produces zero decorations", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](image.png)", { file: fx.sheet, app: fx.app, settings: fx.settings, noEditorInfo: true });
  assert.equal(isEmpty(instance.decorations), true);
});

test("non-Markdown file (extension mismatch) is left untouched", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](image.png)", { file: fx.image, app: fx.app, settings: fx.settings });
  assert.equal(isEmpty(instance.decorations), true);
});

test("a captioned reference to a non-image extension is left untouched (not an image at all)", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](note.md)", { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(isEmpty(instance.decorations), true);
});

/* --- Decoration range precision (§7) ------------------------------------ */

test("2. the widget stores/knows the exact trimmed source range, excluding surrounding whitespace", () => {
  const fx = fixture();
  const text = "  ![Caption](image.png)  ";
  const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(instance.decorations.length, 1);
  const deco = instance.decorations[0];
  assert.equal(deco.from, 2, "decoration starts after leading whitespace");
  assert.equal(deco.to, 2 + "![Caption](image.png)".length, "decoration ends before trailing whitespace");
});

/* --- Interaction safety (the actual regression fix) ---------------------- */

function clickDeco(deco) {
  const view = { requestMeasure() {}, dispatch(spec) { view.dispatchCalls.push(spec); }, focus() { view.focused = true; }, dispatchCalls: [] };
  const dom = deco.widget.toDOM(view);
  const event = { defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
  dom.dispatch("mousedown", event);
  return { view, dom, event };
}

test("4. ignoreEvent() is true: CodeMirror never translates a pointer event on this widget into its own click handling", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](image.png)", { file: fx.sheet, app: fx.app, settings: fx.settings });
  assert.equal(instance.decorations[0].widget.ignoreEvent(), true);
});

test("3/4. mousedown on the widget calls preventDefault() and stopPropagation()", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](image.png)", { file: fx.sheet, app: fx.app, settings: fx.settings });
  const { event } = clickDeco(instance.decorations[0]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("5/6/7. mousedown dispatches ONLY a selection change, anchored inside the source range, no document change", () => {
  const fx = fixture();
  const text = "![Caption](image.png)";
  const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
  const deco = instance.decorations[0];
  const { view } = clickDeco(deco);
  assert.equal(view.dispatchCalls.length, 1);
  const spec = view.dispatchCalls[0];
  assert.ok(!("changes" in spec), "no document change is ever dispatched");
  assert.ok(spec.selection, "a selection change is dispatched");
  assert.equal(spec.selection.anchor, deco.from);
  assert.ok(spec.selection.anchor >= deco.from && spec.selection.anchor < deco.to, "anchor falls inside the source range");
  assert.equal(view.focused, true, "the editor is refocused");
});

test("9. after the click, a rebuild with the selection inside the source range removes the widget", () => {
  const fx = fixture();
  const text = "![Caption](image.png)";
  const full = `${text}\nAutre ligne.`;
  const { instance } = decorateOnce(full, { file: fx.sheet, app: fx.app, settings: fx.settings, multiline: true, selection: [{ from: full.length, to: full.length }] });
  assert.equal(instance.decorations.length, 1);
  const deco = instance.decorations[0];
  const { view } = clickDeco(deco);
  const dispatchedAnchor = view.dispatchCalls[0].selection.anchor;

  instance.update({ view: makeFakeView({ text: full, file: fx.sheet, app: fx.app, selection: [{ from: dispatchedAnchor, to: dispatchedAnchor }] }) });
  assert.equal(isEmpty(instance.decorations), true, "the widget disappears once the selection lands where the click placed it");
});

test("8. no navigation function is ever called by resolving, decorating, or clicking the widget", () => {
  const fx = fixture();
  const text = "![Caption](image.png)";
  const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
  clickDeco(instance.decorations[0]);
  assert.equal(fx.wasOpenLinkTextCalled(), false);
});

test("12/13/14. widget DOM contains no <a>, no href, and no data-href anywhere", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![\\[Carte\\] Vue générale](<Pasted image 1.png>)", { file: fx.sheet, app: fx.app, settings: fx.settings });
  const dom = instance.decorations[0].widget.toDOM({ requestMeasure() {} });
  assert.equal(dom.querySelectorAll("a").length, 0);
  const allNodes = [dom, ...dom.querySelectorAll("*")].filter(Boolean);
  for (const node of allNodes) {
    if (!node.attrs) continue;
    assert.equal(node.getAttribute("href"), null, `unexpected href on ${node.tagName}`);
    assert.equal(node.getAttribute("data-href"), null, `unexpected data-href on ${node.tagName}`);
  }
});

test("15. the <img> is not draggable — its resolved src can never leak through native drag handling", () => {
  const fx = fixture();
  const { instance } = decorateOnce("![Caption](image.png)", { file: fx.sheet, app: fx.app, settings: fx.settings });
  const img = imgOf(instance.decorations[0]);
  assert.equal(img.draggable, false);
});

/* --- Regression: the CONFIRMED root cause (reproduced live in Obsidian) --
 * `Decoration.replace({ …, block: true })` from a ViewPlugin's own
 * `decorations` accessor is invalid CodeMirror 6 and throws
 * `RangeError: Block decorations may not be specified via plugins`, which
 * aborted the MarkdownView's setup and left the leaf permanently empty — the
 * actual mechanism behind the reported "blank tab" bug, confirmed by a real
 * traced session (open crashes with this error; removing `block: true`
 * makes the file open normally and the widget render). This is unrelated to
 * event bubbling: no decoration produced by this module may ever specify
 * `block`. */
test("no decoration ever specifies block:true, for any recognized captioned-image case", () => {
  const fx = fixture();
  const cases = [
    "![Caption](image.png)",
    "![\\[Carte\\] Vue générale](<Pasted image 1.png>)",
    "![Caption](Pasted%20image%201.png)",
    "![Caption](<Vue générale à l'aube.png>)",
  ];
  for (const text of cases) {
    const { instance } = decorateOnce(text, { file: fx.sheet, app: fx.app, settings: fx.settings });
    assert.equal(instance.decorations.length, 1, `expected a widget for ${JSON.stringify(text)}`);
    assert.equal("block" in instance.decorations[0], false, `decoration for ${JSON.stringify(text)} must not carry a "block" key at all`);
  }
});

/* --- Continu regression (§12) -------------------------------------------- */

test("19/20. Continu's own widget is unaffected: still image + caption exactly once, ignoreEvent stays true (own EditorView, own semantics)", async () => {
  const { createScriveningsMarkdownPlugin } = await import("../src/utils/cm-scrivenings-markdown.js");
  const FAKE_BOUNDARIES_FIELD = {};
  const text = "![Carte](https://exemple.com/image.png)";
  const fakeDoc = { text, get length() { return this.text.length; }, sliceString(from, to) { return this.text.slice(from, to); } };
  const fakeState = { doc: fakeDoc, selection: { main: { from: 0, to: 0 }, ranges: [] }, field: () => [] };
  const PluginClass = createScriveningsMarkdownPlugin(FAKE_BOUNDARIES_FIELD);
  const instance = new PluginClass({ state: fakeState, visibleRanges: [{ from: 0, to: text.length }] });
  const imageDecoration = instance.decorations.find((decoration) => decoration.widget !== undefined);
  assert.ok(imageDecoration);
  const dom = imageDecoration.widget.toDOM({});
  assert.equal(dom.querySelectorAll(".cm-scrivenings-image-caption").length, 1);
  assert.equal(dom.children.filter((c) => c.tagName === "IMG").length, 1);
  // Continu's own contract: unchanged, ignoreEvent() stays true (never the
  // normal-editor widget's mousedown-interception logic — different
  // environment, see cm-editor-image-caption.ts's doc comment).
  assert.equal(imageDecoration.widget.ignoreEvent(), true);
});
