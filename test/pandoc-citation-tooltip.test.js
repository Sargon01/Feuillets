import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPandocCitationElement,
  disposePandocCitationElement,
  PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS,
  TOOLTIP_CLOSE_GRACE_MS,
} from "../src/services/pandoc-citation-preview.js";

/**
 * Full fake DOM for buildPandocCitationElement()'s tooltip positioning and
 * lifecycle (attachCitationTooltipBehavior(), pandoc-citation-preview.ts) —
 * richer than the plain-attribute FakeWidgetElement other citation test
 * files use, because THIS module is the one that actually reparents nodes,
 * measures rects, dispatches/removes real event listeners, and schedules
 * timers. Kept in this one file rather than shared: no other test needs
 * getBoundingClientRect/classList/addEventListener/setTimeout support for a
 * citation element.
 *
 * Every test builds its OWN fake document/window pair via
 * installFakeEnvironment() — never a shared global — matching production's
 * own move away from the global `document`/`window`/`ResizeObserver` (see
 * attachCitationTooltipBehavior()'s doc comment): a citation built against
 * one environment must never see, or be seen by, another.
 */
/** `removeProperty("min-width")` must remove what was set via
 * `style.minWidth = "..."` — the real CSSOM guarantees this equivalence
 * (kebab-case method name, camelCase property accessor, same underlying
 * property); this fake mirrors it with a small kebab→camel conversion
 * rather than requiring every caller to use one casing consistently. */
class FakeStyle {
  removeProperty(name) {
    const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    delete this[camel];
  }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this._text = "";
    this._listeners = new Map();
    this.style = new FakeStyle();
    this.rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    this._naturalWidth = 200;
    this._naturalHeight = 80;
  }
  /** Simulates enough of the real box model for tests: the element's
   * natural (content) size, clamped by whatever `style.min-width`/
   * `max-width`/`max-height` production code has set — exactly the
   * min/max-width/height reposition() (pandoc-citation-preview.ts) applies
   * before measuring, so a test can set a "natural" size larger than the
   * available space and assert the ACTUAL (clamped) measured size. */
  get offsetWidth() {
    let width = this._naturalWidth;
    if (this.style.maxWidth !== undefined) width = Math.min(width, parseFloat(this.style.maxWidth));
    if (this.style.minWidth !== undefined) width = Math.max(width, parseFloat(this.style.minWidth));
    return width;
  }
  set offsetWidth(value) {
    this._naturalWidth = value;
  }
  get offsetHeight() {
    let height = this._naturalHeight;
    if (this.style.maxHeight !== undefined) height = Math.min(height, parseFloat(this.style.maxHeight));
    return height;
  }
  set offsetHeight(value) {
    this._naturalHeight = value;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  get classes() {
    return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean);
  }
  get classList() {
    const self = this;
    return {
      add(cls) {
        const set = new Set(self.classes);
        set.add(cls);
        self.setAttribute("class", [...set].join(" "));
      },
      remove(cls) {
        self.setAttribute("class", self.classes.filter((c) => c !== cls).join(" "));
      },
      contains(cls) {
        return self.classes.includes(cls);
      },
    };
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentElement = null;
    return child;
  }
  /** Propagates `ownerDocument` to every element built FROM this one —
   * exactly like the real DOM (an element created via another element's
   * `.createSpan()`/`.createEl()` always belongs to that element's own
   * document) — so a whole citation subtree built from a single
   * `ownerDocument.createElement()` root stays in the SAME document
   * throughout, with no extra plumbing at each call site. */
  createEl(tag, options = {}) {
    const child = new FakeElement(tag);
    child.ownerDocument = this.ownerDocument;
    if (options.cls) child.setAttribute("class", options.cls);
    if (options.text) child._text = options.text;
    this.appendChild(child);
    return child;
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this._text = value;
    this.children = [];
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
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }
  listenerCount(type) {
    return this._listeners.get(type)?.size ?? 0;
  }
  dispatch(type, event = {}) {
    for (const handler of [...(this._listeners.get(type) || [])]) handler(event);
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

/**
 * A fake `Window`: `scroll`/`resize` listeners, and CONTROLLED timers —
 * `setTimeout`/`clearTimeout` never really wait, a test advances the clock
 * explicitly with `advanceTimers(ms)`, so the grace-period close
 * (TOOLTIP_CLOSE_GRACE_MS, pandoc-citation-preview.ts) is testable
 * deterministically, with no real delay and no flakiness. `ResizeObserver`
 * is undefined by default (matching `typeof ResizeObserver !== "undefined"`
 * production's own guard falls back on) — installFakeResizeObserver(win)
 * below installs one on a PER-WINDOW basis when a test needs it.
 */
class FakeWindow {
  constructor({ width = 1200, height = 800 } = {}) {
    this.innerWidth = width;
    this.innerHeight = height;
    this.ResizeObserver = undefined;
    // Set by FakeDocument's constructor below — `win.createSpan(...)`
    // (createPandocCitationSpan(), pandoc-citation-preview.ts) needs to
    // return an element whose `.ownerDocument` is THIS window's own
    // document, exactly like a real `Window.createEl` would.
    this.document = null;
    this._listeners = new Map();
    this._timers = new Map();
    this._nextTimerId = 1;
  }
  /** `Document.defaultView.createEl`/`.createSpan` — Obsidian's ambient
   * `createEl`/`createSpan` globals, scoped to THIS window, never a
   * different one (see createPandocCitationSpan()'s doc comment). */
  createEl(tag, options = {}) {
    const el = new FakeElement(tag);
    el.ownerDocument = this.document;
    if (options.cls) el.setAttribute("class", options.cls);
    if (options.text) el._text = options.text;
    return el;
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }
  listenerCount(type) {
    return this._listeners.get(type)?.size ?? 0;
  }
  dispatch(type) {
    for (const handler of [...(this._listeners.get(type) || [])]) handler({});
  }
  setTimeout(fn, delay) {
    const id = this._nextTimerId++;
    this._timers.set(id, { fn, delay, elapsed: 0 });
    return id;
  }
  clearTimeout(id) {
    this._timers.delete(id);
  }
  hasPendingTimers() {
    return this._timers.size > 0;
  }
  /** The test's entire stand-in for real waiting: advances every pending
   * timer by `ms`, firing (and removing) any whose full delay has now
   * elapsed. */
  advanceTimers(ms) {
    for (const [id, timer] of [...this._timers]) {
      timer.elapsed += ms;
      if (timer.elapsed >= timer.delay) {
        this._timers.delete(id);
        timer.fn();
      }
    }
  }
}

class FakeDocument {
  constructor(win) {
    this.defaultView = win;
    win.document = this;
    this.body = new FakeElement("body");
    this.body.ownerDocument = this;
  }
  createElement(tag) {
    const el = new FakeElement(tag);
    el.ownerDocument = this;
    return el;
  }
}

/** A fresh, independent document/window pair — the fake equivalent of one
 * Obsidian OS window (the main one, or a popped-out one). Two calls are two
 * entirely separate realms, exactly like two real BrowserWindows: nothing
 * built against one is ever visible to, or affects, the other. */
function installFakeEnvironment({ width = 1200, height = 800 } = {}) {
  const win = new FakeWindow({ width, height });
  const doc = new FakeDocument(win);
  return { doc, win, body: doc.body };
}

/** Installs a fake `ResizeObserver` CONSTRUCTOR on `win` (never a global) —
 * attachCitationTooltipBehavior() reads it as `win.ResizeObserver`, exactly
 * like a real window exposes its own realm's constructor. */
function installFakeResizeObserver(win) {
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      this.disconnected = false;
      FakeResizeObserver.instances.push(this);
    }
    observe(el) {
      this.observed.add(el);
    }
    unobserve(el) {
      this.observed.delete(el);
    }
    disconnect() {
      this.observed.clear();
      this.disconnected = true;
    }
    trigger() {
      this.callback([]);
    }
  }
  FakeResizeObserver.instances = [];
  win.ResizeObserver = FakeResizeObserver;
  return FakeResizeObserver;
}

/** A `.cm-scroller`-like (or `.markdown-preview-view`-like) host panel: a
 * real ancestor the citation is appended into, so findHostPanel() (pandoc-
 * citation-preview.ts) can walk up and find it — exactly like a citation
 * rendered inside a real CM6 editor or the Reading Mode content pane. Built
 * via `doc.createElement`, so it belongs to the SAME document as the
 * citation appended into it. */
function makeHostPanel(doc, cls, rect) {
  const panel = doc.createElement("div");
  panel.setAttribute("class", cls);
  panel.rect = rect;
  return panel;
}

function recordFor(overrides = {}) {
  return {
    key: "smith2024",
    type: "article",
    title: "A Study",
    authors: ["Smith"],
    year: "2024",
    author: "Smith, John",
    ...overrides,
  };
}

function buildCitation(doc, overrides = {}) {
  const records = new Map([["smith2024", recordFor(overrides)]]);
  return buildPandocCitationElement("(Smith, 2024)", ["smith2024"], records, doc);
}

/* ------------------------------------------------------------------ *
 * Structure / accessibility — unaffected by positioning.
 * ------------------------------------------------------------------ */

test("buildPandocCitationElement: role=tooltip, aria-describedby and keyboard access are present", () => {
  const { doc } = installFakeEnvironment();
  const citation = buildCitation(doc);
  assert.equal(citation.getAttribute("tabindex"), "0");
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  assert.ok(tooltip);
  assert.equal(tooltip.getAttribute("role"), "tooltip");
  assert.equal(citation.getAttribute("aria-describedby"), tooltip.getAttribute("id"));
});

test("buildPandocCitationElement: hidden by default, the tooltip stays nested inside the citation until shown", () => {
  const { doc } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  assert.equal(tooltip.parentElement, citation);
  assert.equal(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false);
});

/* ------------------------------------------------------------------ *
 * Show/hide and the citation → tooltip hover transition. A short GRACE
 * PERIOD (TOOLTIP_CLOSE_GRACE_MS) follows leaving the citation, so the
 * pointer has time to actually reach the (portaled, gapped) tooltip —
 * closing must never happen synchronously on the citation's mouseleave.
 * Timers are the FakeWindow's own controlled ones (advanceTimers()), never
 * a real wait — deterministic, no artificial mouseenter on an
 * already-hidden tooltip anywhere below.
 * ------------------------------------------------------------------ */

test("buildPandocCitationElement: hovering the citation shows the tooltip, reparented to <body>", () => {
  const { doc, body } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");

  assert.equal(tooltip.parentElement, body, "reparented to <body> — escapes any ancestor's overflow clipping");
  assert.ok(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS));
});

test("buildPandocCitationElement: mouseleave alone eventually closes the tooltip, after the grace period elapses", () => {
  const { doc, win } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  citation.dispatch("mouseleave");

  assert.ok(
    tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS),
    "never closes synchronously on the citation's own mouseleave"
  );
  assert.ok(win.hasPendingTimers(), "a close is scheduled, not executed yet");

  win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS);

  assert.equal(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false, "closed once the grace period elapses");
  assert.equal(tooltip.parentElement, citation, "restored as a child of the citation once hidden");
});

test("buildPandocCitationElement: entering the tooltip before the grace period elapses cancels the close and keeps it open", () => {
  const { doc, win } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  citation.dispatch("mouseleave"); // schedules a close
  tooltip.dispatch("mouseenter"); // pointer reaches the tooltip in time — cancels it

  assert.equal(win.hasPendingTimers(), false, "the scheduled close was cancelled outright, not just postponed");

  win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS * 10);

  assert.ok(
    tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS),
    "stays open well past when the original close would have fired"
  );
});

test("buildPandocCitationElement: leaving the tooltip itself closes immediately, with no grace period", () => {
  const { doc, win } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  citation.dispatch("mouseleave");
  tooltip.dispatch("mouseenter");
  tooltip.dispatch("mouseleave");

  assert.equal(
    tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS),
    false,
    "closes right away — there is no gap to cross leaving the tooltip itself"
  );
  assert.equal(win.hasPendingTimers(), false);
});

test("buildPandocCitationElement: a tall (multi-reference) tooltip stays accessible and scrollable throughout the hover transition", () => {
  const { doc, win } = installFakeEnvironment();
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 300, left: 0, right: 1200, width: 1200, height: 300 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 150, bottom: 170, left: 500, right: 540, width: 40, height: 20 };
  tooltip.offsetHeight = 900; // far taller than the 300px-high panel

  citation.dispatch("mouseenter");
  assert.equal(tooltip.style.overflowY, "auto");
  assert.ok(tooltip.offsetHeight < 900, "clamped to the available height");

  citation.dispatch("mouseleave");
  tooltip.dispatch("mouseenter"); // pointer reaches it during the grace period
  win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS);

  assert.ok(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), "still open and reachable");
  assert.equal(tooltip.style.overflowY, "auto", "still internally scrollable");
});

test("buildPandocCitationElement: keyboard focus opens the tooltip; focusout closes it immediately, no grace period", () => {
  const { doc, win } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("focusin");
  assert.ok(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS));

  citation.dispatch("focusout");
  assert.equal(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false);
  assert.equal(win.hasPendingTimers(), false, "focus never goes through the grace-period path");
});

test("buildPandocCitationElement: hover AND focus together only close once BOTH end", () => {
  const { doc, win } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  citation.dispatch("focusin");
  citation.dispatch("mouseleave"); // schedules a close, but focus still holds it open
  win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS * 10);
  assert.ok(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), "still open: focus is still active");

  citation.dispatch("focusout");
  assert.equal(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false);
});

test("buildPandocCitationElement: re-entering the citation before the grace period elapses also cancels the close", () => {
  const { doc, win } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  citation.dispatch("mouseleave");
  citation.dispatch("mouseenter"); // pointer comes back before the timer fires

  assert.equal(win.hasPendingTimers(), false);
  win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS * 10);
  assert.ok(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS));
});

/* ------------------------------------------------------------------ *
 * Collision-aware positioning — resolveFloatingPosition() driven by the
 * citation's OWN measured rect, never a static CSS value.
 * ------------------------------------------------------------------ */

test("buildPandocCitationElement: near the right edge, the tooltip shifts left and stays within the 12px margin", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 1150, right: 1190, width: 40, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");

  const left = parseFloat(tooltip.style.left);
  assert.ok(left + tooltip.offsetWidth <= 1200 - 12 + 0.01, "never crosses the right margin");
  assert.equal(left, 1200 - 300 - 12);
});

test("buildPandocCitationElement: near the left edge, the tooltip clamps to the 12px margin, never negative", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: -50, right: 0, width: 40, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");

  assert.equal(parseFloat(tooltip.style.left), 12);
});

test("buildPandocCitationElement: by default the tooltip appears above the citation", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 100, right: 140, width: 40, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");

  assert.equal(parseFloat(tooltip.style.top), 400 - 6 - 100);
});

test("buildPandocCitationElement: with no room above, the tooltip flips below the citation", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 20, bottom: 40, left: 100, right: 140, width: 40, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");

  assert.equal(parseFloat(tooltip.style.top), 40 + 6, "placed just below the citation instead");
});

test("buildPandocCitationElement: repositions on scroll and resize while open, never while closed", () => {
  const { doc, win } = installFakeEnvironment({ width: 1200, height: 800 });
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 100, right: 140, width: 40, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");
  const firstLeft = tooltip.style.left;

  // The page scrolls, moving the citation to a new viewport position.
  citation.rect = { top: 400, bottom: 420, left: 1150, right: 1190, width: 40, height: 20 };
  win.dispatch("scroll");
  assert.notEqual(tooltip.style.left, firstLeft, "recomputed after scroll, from the citation's NEW rect");

  const afterScrollTop = tooltip.style.top;
  citation.rect = { top: 20, bottom: 40, left: 1150, right: 1190, width: 40, height: 20 };
  win.dispatch("resize");
  assert.notEqual(tooltip.style.top, afterScrollTop, "recomputed after resize too");

  citation.dispatch("mouseleave");
  win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS);
  const closedLeft = tooltip.style.left; // "" once hidden — see attachCitationTooltipBehavior()'s hide()
  citation.rect = { top: 400, bottom: 420, left: 5, right: 45, width: 40, height: 20 };
  win.dispatch("scroll");
  assert.equal(tooltip.style.left, closedLeft, "never repositioned while closed");
});

/* ------------------------------------------------------------------ *
 * Cleanup — no residual node, listener or timer after disposal.
 * ------------------------------------------------------------------ */

test("buildPandocCitationElement: disposePandocCitationElement() while open removes the temporary window listeners and restores the DOM", () => {
  const { doc, win, body } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  assert.equal(tooltip.parentElement, body);
  assert.ok(win.listenerCount("scroll") > 0);
  assert.ok(win.listenerCount("resize") > 0);

  disposePandocCitationElement(citation);

  assert.equal(win.listenerCount("scroll"), 0, "no residual scroll listener");
  assert.equal(win.listenerCount("resize"), 0, "no residual resize listener");
  assert.equal(tooltip.parentElement, citation, "the tooltip is put back rather than left orphaned in <body>");
  assert.equal(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false);
});

test("buildPandocCitationElement: disposePandocCitationElement() while a close is pending cancels the timer too", () => {
  const { doc, win } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  citation.dispatch("mouseleave"); // schedules a close
  assert.ok(win.hasPendingTimers());

  disposePandocCitationElement(citation);

  assert.equal(win.hasPendingTimers(), false, "no residual timer");
  assert.equal(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false);

  // Firing whatever the (now-stale) timer id would have been must be
  // harmless — dispose() already cleared it via win.clearTimeout(), so
  // there is nothing left in win._timers to advance into a callback.
  assert.doesNotThrow(() => win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS * 10));
});

test("buildPandocCitationElement: disposePandocCitationElement() while closed is a harmless no-op", () => {
  const { doc } = installFakeEnvironment();
  const citation = buildCitation(doc);
  assert.doesNotThrow(() => disposePandocCitationElement(citation));
});

test("buildPandocCitationElement: disposePandocCitationElement() is idempotent — calling it twice never throws", () => {
  const { doc } = installFakeEnvironment();
  const citation = buildCitation(doc);
  citation.dispatch("mouseenter");
  disposePandocCitationElement(citation);
  assert.doesNotThrow(() => disposePandocCitationElement(citation));
});

test("buildPandocCitationElement: after disposal, hovering again never reopens the tooltip or re-adds listeners", () => {
  const { doc, win } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  disposePandocCitationElement(citation);
  citation.dispatch("mouseenter"); // listeners were removed by disposal — this reaches no handler

  assert.equal(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false);
  assert.equal(win.listenerCount("scroll"), 0);
});

test("buildPandocCitationElement: several show/hide cycles never accumulate window listeners, timers or stray DOM nodes", () => {
  const { doc, win, body } = installFakeEnvironment();
  const citation = buildCitation(doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  for (let i = 0; i < 5; i++) {
    citation.dispatch("mouseenter");
    citation.dispatch("mouseleave");
    win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS);
  }

  assert.equal(win.listenerCount("scroll"), 0, "closed each time: no leaked scroll listener");
  assert.equal(win.listenerCount("resize"), 0);
  assert.equal(win.hasPendingTimers(), false, "no leaked timer");
  assert.equal(body.children.length, 0, "never left behind in <body>");
  assert.equal(citation.children.filter((c) => c === tooltip).length, 1, "exactly one tooltip node, never duplicated");
});

test("buildPandocCitationElement: two independent citations never interfere with each other's tooltip, listeners or timers", () => {
  const { doc, win } = installFakeEnvironment();
  const first = buildCitation(doc);
  const secondRecords = new Map([["doe2023", recordFor({ key: "doe2023", author: "Doe, Jane", authors: ["Doe"], year: "2023" })]]);
  const secondCitation = buildPandocCitationElement("(Doe, 2023)", ["doe2023"], secondRecords, doc);
  const firstTooltip = first.querySelector(".feuillets-pandoc-citation-tooltip");
  const secondTooltip = secondCitation.querySelector(".feuillets-pandoc-citation-tooltip");

  first.dispatch("mouseenter");
  assert.ok(firstTooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS));
  assert.equal(secondTooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false);

  first.dispatch("mouseleave"); // schedules a close for `first` only
  disposePandocCitationElement(first);
  assert.equal(win.hasPendingTimers(), false, "first's pending close was cancelled by its own disposal");

  secondCitation.dispatch("mouseenter");
  assert.ok(secondTooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS));
});

/* ------------------------------------------------------------------ *
 * Bounding to the host panel (.cm-scroller / .markdown-preview-view),
 * never the browser viewport alone.
 * ------------------------------------------------------------------ */

test("buildPandocCitationElement: near the right edge of a narrow host panel, the tooltip never overlaps the neighboring panel", () => {
  // A wide window (1600px) with the citation's own panel occupying only its
  // left 800px — the rest is whatever sits next to it (a sidebar, another
  // split pane). The window alone would allow the tooltip up to x=1288
  // (1600 - 300 - 12); it must never go anywhere near that here.
  const { doc } = installFakeEnvironment({ width: 1600, height: 800 });
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 760, right: 795, width: 35, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");

  const left = parseFloat(tooltip.style.left);
  assert.equal(left, 800 - 300 - 12, "clamped to the PANEL's right edge (800), not the window's (1600)");
  assert.ok(left + tooltip.offsetWidth <= 800 - 12 + 0.01, "never crosses into the neighboring panel");
});

test("buildPandocCitationElement: a Reading Mode citation is bounded by its .markdown-preview-view panel the same way", () => {
  const { doc } = installFakeEnvironment({ width: 1600, height: 800 });
  const previewView = makeHostPanel(doc, "markdown-preview-view", { top: 0, bottom: 800, left: 0, right: 700, width: 700, height: 800 });
  const citation = buildCitation(doc);
  previewView.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 660, right: 695, width: 35, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");

  const left = parseFloat(tooltip.style.left);
  assert.equal(left, 700 - 300 - 12);
});

test("buildPandocCitationElement: with no host panel ancestor, the browser viewport alone bounds the tooltip", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const citation = buildCitation(doc); // never appended under a panel
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 1150, right: 1190, width: 40, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");

  assert.equal(parseFloat(tooltip.style.left), 1200 - 300 - 12);
});

/* ------------------------------------------------------------------ *
 * ResizeObserver on the host panel — repositions when an Obsidian pane
 * split is dragged (no window "resize" event fires in that case).
 * ------------------------------------------------------------------ */

test("buildPandocCitationElement: a ResizeObserver on the host panel repositions the tooltip immediately when the panel is resized", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const win = doc.defaultView;
  const FakeResizeObserver = installFakeResizeObserver(win);
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 0, right: 1200, width: 1200, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 1100, right: 1140, width: 40, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");
  const firstLeft = parseFloat(tooltip.style.left);

  // The pane split is dragged narrower — the panel shrinks, but nothing
  // fires a window "resize" event for that.
  scroller.rect = { top: 0, bottom: 800, left: 0, right: 600, width: 600, height: 800 };
  const observer = FakeResizeObserver.instances.find((o) => o.observed.has(scroller));
  assert.ok(observer, "the panel is observed while the tooltip is open");
  observer.trigger();

  const secondLeft = parseFloat(tooltip.style.left);
  assert.notEqual(secondLeft, firstLeft, "repositioned immediately from the panel's NEW rect");
  assert.ok(secondLeft + tooltip.offsetWidth <= 600 - 12 + 0.01, "clamped to the panel's new, narrower bounds");
});

test("buildPandocCitationElement: the ResizeObserver is disconnected on hide, and never fires again while closed", () => {
  const { doc } = installFakeEnvironment();
  const win = doc.defaultView;
  const FakeResizeObserver = installFakeResizeObserver(win);
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 0, right: 1200, width: 1200, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);

  citation.dispatch("mouseenter");
  const observer = FakeResizeObserver.instances.find((o) => o.observed.has(scroller));
  assert.ok(observer);
  assert.equal(observer.disconnected, false);

  citation.dispatch("mouseleave");
  win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS);
  assert.ok(observer.disconnected, "disconnected the moment the tooltip closes");
  assert.equal(observer.observed.size, 0);
});

test("buildPandocCitationElement: disposePandocCitationElement() while open also disconnects the ResizeObserver", () => {
  const { doc } = installFakeEnvironment();
  const win = doc.defaultView;
  const FakeResizeObserver = installFakeResizeObserver(win);
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 0, right: 1200, width: 1200, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);

  citation.dispatch("mouseenter");
  const observer = FakeResizeObserver.instances.find((o) => o.observed.has(scroller));
  assert.ok(observer);

  disposePandocCitationElement(citation);

  assert.ok(observer.disconnected);
});

test("buildPandocCitationElement: repeated open/close cycles never accumulate ResizeObserver instances left connected", () => {
  const { doc } = installFakeEnvironment();
  const win = doc.defaultView;
  const FakeResizeObserver = installFakeResizeObserver(win);
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 0, right: 1200, width: 1200, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);

  for (let i = 0; i < 4; i++) {
    citation.dispatch("mouseenter");
    citation.dispatch("mouseleave");
    win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS);
  }

  const stillConnected = FakeResizeObserver.instances.filter((o) => !o.disconnected);
  assert.equal(stillConnected.length, 0, "every observer created across the 4 cycles was disconnected on close");
});

/* ------------------------------------------------------------------ *
 * Sizing: the tooltip's OWN width/height are constrained to the real
 * available space before it is ever measured/positioned — position alone
 * cannot fix an element whose natural size exceeds its bounds.
 * ------------------------------------------------------------------ */

test("buildPandocCitationElement: a 240px panel clamps a naturally-300px tooltip to the available width", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 100, right: 340, width: 240, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 150, right: 190, width: 40, height: 20 };
  tooltip.offsetWidth = 300; // natural width, wider than the 240px panel

  citation.dispatch("mouseenter");

  assert.equal(tooltip.style.maxWidth, "216px", "available width = panel width (240) minus 12px margin on each side");
  assert.equal(tooltip.offsetWidth, 216, "the MEASURED (clamped) width used for positioning, never the natural 300");
  const left = parseFloat(tooltip.style.left);
  assert.ok(left >= 100 + 12 - 0.01 && left + 216 <= 340 - 12 + 0.01, "the clamped tooltip stays entirely within the panel");
});

test("buildPandocCitationElement: a short panel with a multi-reference tooltip taller than available space clamps height and scrolls internally", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 200, bottom: 300, left: 0, right: 1200, width: 1200, height: 100 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 250, bottom: 270, left: 500, right: 540, width: 40, height: 20 };
  tooltip.offsetHeight = 400; // e.g. a grouped citation's stacked multi-reference notice

  citation.dispatch("mouseenter");

  assert.equal(tooltip.style.maxHeight, "76px", "available height = panel height (100) minus 12px margin on each side");
  assert.equal(tooltip.offsetHeight, 76, "the MEASURED (clamped) height, never the natural 400");
  assert.equal(tooltip.style.overflowY, "auto", "scrolls internally instead of ever exceeding the panel");
});

test("buildPandocCitationElement: the tooltip never crosses any of the four panel edges, even when both dimensions overflow", () => {
  const { doc } = installFakeEnvironment({ width: 1200, height: 800 });
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 100, bottom: 500, left: 100, right: 500, width: 400, height: 400 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 480, bottom: 495, left: 480, right: 495, width: 15, height: 15 }; // panel's own bottom-right corner
  tooltip.offsetWidth = 600; // wider than the whole panel
  tooltip.offsetHeight = 600; // taller than the whole panel

  citation.dispatch("mouseenter");

  const left = parseFloat(tooltip.style.left);
  const top = parseFloat(tooltip.style.top);
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;

  assert.ok(left >= 100 + 12 - 0.01, "never crosses the LEFT edge");
  assert.ok(left + width <= 500 - 12 + 0.01, "never crosses the RIGHT edge");
  assert.ok(top >= 100 + 12 - 0.01, "never crosses the TOP edge");
  assert.ok(top + height <= 500 - 12 + 0.01, "never crosses the BOTTOM edge");
});

test("buildPandocCitationElement: an oversized tooltip still never bleeds into the neighboring panel", () => {
  const { doc } = installFakeEnvironment({ width: 1600, height: 800 }); // wide window; the panel occupies only its left part
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 0, right: 300, width: 300, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 400, bottom: 420, left: 260, right: 290, width: 30, height: 20 };
  tooltip.offsetWidth = 420; // naturally wider than the 300px panel

  citation.dispatch("mouseenter");

  const left = parseFloat(tooltip.style.left);
  assert.ok(
    left + tooltip.offsetWidth <= 300 - 12 + 0.01,
    "clamped width keeps it inside the panel, never spilling past x=300 into the neighboring panel"
  );
});

test("buildPandocCitationElement: hide() clears every temporary sizing style, not just left/top", () => {
  const { doc } = installFakeEnvironment();
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 0, right: 240, width: 240, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  tooltip.offsetWidth = 300;

  citation.dispatch("mouseenter");
  assert.notEqual(tooltip.style.maxWidth, undefined, "sizing styles are set while open");

  citation.dispatch("mouseleave");
  doc.defaultView.advanceTimers(TOOLTIP_CLOSE_GRACE_MS);

  assert.equal(tooltip.style.minWidth, undefined, "min-width cleared");
  assert.equal(tooltip.style.maxWidth, undefined, "max-width cleared");
  assert.equal(tooltip.style.maxHeight, undefined, "max-height cleared");
  assert.equal(tooltip.style.overflowY, undefined, "overflow-y cleared");
});

test("buildPandocCitationElement: disposePandocCitationElement() while open also clears every temporary sizing style", () => {
  const { doc } = installFakeEnvironment();
  const scroller = makeHostPanel(doc, "cm-scroller", { top: 0, bottom: 800, left: 0, right: 240, width: 240, height: 800 });
  const citation = buildCitation(doc);
  scroller.appendChild(citation);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  tooltip.offsetWidth = 300;

  citation.dispatch("mouseenter");
  disposePandocCitationElement(citation);

  assert.equal(tooltip.style.minWidth, undefined);
  assert.equal(tooltip.style.maxWidth, undefined);
  assert.equal(tooltip.style.maxHeight, undefined);
  assert.equal(tooltip.style.overflowY, undefined);
});

/* ------------------------------------------------------------------ *
 * Detached Obsidian windows: the citation's OWN document/window realm —
 * never a global `document`/`window`/`ResizeObserver` — see
 * attachCitationTooltipBehavior()'s doc comment (pandoc-citation-preview.ts).
 * Every test below builds TWO independent fake environments and asserts the
 * "main" one is never touched by a citation that belongs to the "secondary"
 * one.
 * ------------------------------------------------------------------ */

test("buildPandocCitationElement: the citation, its tooltip and aria-describedby all live in the SAME (secondary) document", () => {
  const secondary = installFakeEnvironment();
  const citation = buildCitation(secondary.doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  assert.equal(citation.ownerDocument, secondary.doc);
  assert.equal(tooltip.ownerDocument, secondary.doc);
  assert.equal(citation.getAttribute("aria-describedby"), tooltip.getAttribute("id"));
});

test("buildPandocCitationElement: a citation in a secondary window portals into THAT window's body, never the main window's", () => {
  const main = installFakeEnvironment({ width: 1200, height: 800 });
  const secondary = installFakeEnvironment({ width: 900, height: 500 });
  const citation = buildCitation(secondary.doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 100, bottom: 120, left: 100, right: 140, width: 40, height: 20 };

  citation.dispatch("mouseenter");

  assert.equal(tooltip.parentElement, secondary.body, "portaled into the secondary window's <body>");
  assert.equal(main.body.children.length, 0, "the main window's <body> is never touched");
});

test("buildPandocCitationElement: a secondary-window citation never adds scroll/resize listeners to the main window", () => {
  const main = installFakeEnvironment();
  const secondary = installFakeEnvironment();
  const citation = buildCitation(secondary.doc);

  citation.dispatch("mouseenter");

  assert.equal(main.win.listenerCount("scroll"), 0, "the main window is never listened on");
  assert.equal(main.win.listenerCount("resize"), 0);
  assert.ok(secondary.win.listenerCount("scroll") > 0, "listens on its OWN window instead");
  assert.ok(secondary.win.listenerCount("resize") > 0);
});

test("buildPandocCitationElement: a secondary-window citation positions using THAT window's own dimensions, never the main window's", () => {
  const main = installFakeEnvironment({ width: 1200, height: 800 });
  const secondary = installFakeEnvironment({ width: 500, height: 400 });
  const citation = buildCitation(secondary.doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");
  citation.rect = { top: 300, bottom: 320, left: 470, right: 495, width: 25, height: 20 };
  tooltip.offsetWidth = 300;
  tooltip.offsetHeight = 100;

  citation.dispatch("mouseenter");

  const left = parseFloat(tooltip.style.left);
  assert.equal(left, 500 - 300 - 12, "clamped to the SECONDARY window's own 500px width");
  assert.notEqual(left, main.win.innerWidth - 300 - 12, "never computed against the main window's 1200px width");
});

test("buildPandocCitationElement: a secondary-window citation's ResizeObserver comes from that SAME realm, never the main window's", () => {
  const main = installFakeEnvironment();
  const secondary = installFakeEnvironment();
  const MainResizeObserver = installFakeResizeObserver(main.win);
  const SecondaryResizeObserver = installFakeResizeObserver(secondary.win);

  const scroller = makeHostPanel(secondary.doc, "cm-scroller", { top: 0, bottom: 400, left: 0, right: 500, width: 500, height: 400 });
  const citation = buildCitation(secondary.doc);
  scroller.appendChild(citation);

  citation.dispatch("mouseenter");

  assert.equal(MainResizeObserver.instances.length, 0, "never observed from the main window's ResizeObserver");
  assert.equal(SecondaryResizeObserver.instances.length, 1);
  assert.ok(SecondaryResizeObserver.instances[0].observed.has(scroller));
});

test("buildPandocCitationElement: disposing a secondary-window citation cleans up completely, leaving the main window untouched", () => {
  const main = installFakeEnvironment();
  const secondary = installFakeEnvironment();
  const citation = buildCitation(secondary.doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  assert.equal(tooltip.parentElement, secondary.body);

  disposePandocCitationElement(citation);

  assert.equal(secondary.win.listenerCount("scroll"), 0);
  assert.equal(secondary.win.listenerCount("resize"), 0);
  assert.equal(secondary.win.hasPendingTimers(), false);
  assert.equal(tooltip.parentElement, citation, "restored, never left behind in the secondary <body>");
  assert.equal(main.body.children.length, 0);
  assert.equal(main.win.listenerCount("scroll"), 0);
  assert.equal(main.win.listenerCount("resize"), 0);
});

test("buildPandocCitationElement: a secondary-window citation's grace-period close timer runs on its OWN window, never the main one", () => {
  const main = installFakeEnvironment();
  const secondary = installFakeEnvironment();
  const citation = buildCitation(secondary.doc);
  const tooltip = citation.querySelector(".feuillets-pandoc-citation-tooltip");

  citation.dispatch("mouseenter");
  citation.dispatch("mouseleave");

  assert.equal(main.win.hasPendingTimers(), false, "the main window's clock is never used");
  assert.ok(secondary.win.hasPendingTimers());

  secondary.win.advanceTimers(TOOLTIP_CLOSE_GRACE_MS);
  assert.equal(tooltip.classList.contains(PANDOC_CITATION_TOOLTIP_VISIBLE_CLASS), false);
});
