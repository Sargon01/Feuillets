import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));
if (typeof globalThis.HTMLElement === "undefined") globalThis.HTMLElement = class HTMLElement {};

const { EditorState } = await import("@codemirror/state");
const { EditorView } = await import("@codemirror/view");
const { Menu } = await import(isCompiledTest ? "obsidian" : compiledModule("node_modules/obsidian/index.js"));
const {
  ScriveningsGrammarChecker,
  SCRIVENINGS_GRAMMAR_VIEWPORT_DEBOUNCE_MS: VIEWPORT_DELAY,
  SCRIVENINGS_GRAMMAR_MAX_LIVE_SEGMENTS: WINDOW_LIMIT,
  SCRIVENINGS_GRAMMAR_MAX_BATCH_CHARACTERS: CHARACTER_LIMIT,
  SCRIVENINGS_GRAMMAR_CACHE_SEGMENTS: CACHE_LIMIT,
  SCRIVENINGS_LIVE_MAX_ISSUES_PER_SEGMENT: ISSUE_LIMIT,
  SCRIVENINGS_LIVE_MAX_ISSUES_TOTAL: TOTAL_ISSUE_LIMIT,
} = await import(modulePath("src/utils/cm-scrivenings-grammar.js"));
const {
  grammarIssuesField, GRAMMAR_CHECK_DEBOUNCE_MS: EDIT_DELAY, setGrammarWindowEffect,
} = await import(modulePath("src/utils/cm-grammar-highlighter.js"));

const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function makeDocument(bodies) {
  let from = 0;
  const segments = bodies.map((body, index) => {
    const path = `${index}.md`;
    const segment = { path, body, from, to: from + body.length, file: { path, basename: String(index), stat: { mtime: 1 } } };
    from = segment.to + 1;
    return segment;
  });
  return { segments, text: bodies.join("\n") };
}
const issueFor = (input) => ({ message: "Issue", start: 0, end: input.text.length, text: input.text, filePath: input.filePath });

function fixture(t, { count = 400, bodies = Array.from({ length: count }, (_, index) => `bad${index}`), analyze } = {}) {
  const originalWindow = globalThis.window;
  const timers = new Map();
  let timerId = 0;
  let now = 0;
  globalThis.window = {
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay, due: now + delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const calls = [];
  let activeCalls = 0;
  let maximumConcurrency = 0;
  const provider = {
    id: "provider", name: "Provider",
    async analyze(input) {
      calls.push(input);
      maximumConcurrency = Math.max(maximumConcurrency, ++activeCalls);
      try { return analyze ? await analyze(input) : [issueFor(input)]; }
      finally { activeCalls -= 1; }
    },
  };
  let active = provider;
  let document = makeDocument(bodies);
  let editor = null;
  const host = {
    app: { vault: { getAbstractFileByPath: () => null }, workspace: {} },
    getAnalysisProvider: (id) => (!id || id === active?.id ? active : null),
    titleFor: (file) => file.basename,
    analyzeActiveFile: async () => {}, activeEditorAnywhere: () => null,
  };
  const checker = new ScriveningsGrammarChecker({ host, getEditor: () => editor, getDocument: () => document });
  const extensions = checker.extensions();
  editor = new EditorView({ state: EditorState.create({ doc: document.text, extensions }) });
  let updates = 0;
  const dispatch = editor.dispatch;
  editor.dispatch = (spec) => {
    const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
    if (effects.some((effect) => effect?.is(setGrammarWindowEffect))) updates += 1;
    dispatch(spec);
  };
  const ranges = (next, notify = true) => {
    editor.visibleRanges = next;
    if (notify) for (const plugin of editor.plugins) plugin.update({ viewportChanged: true, docChanged: false });
  };
  const visible = (indices, notify = true) => ranges(indices.map((index) => ({ from: document.segments[index].from, to: document.segments[index].to })), notify);
  visible([0], false);
  t.after(() => { checker.destroy(); editor.destroy(); globalThis.window = originalWindow; });
  return {
    checker, editor, extensions, calls, provider, timers, visible, ranges,
    screen(from, to) {
      editor.scrollDOM = { clientHeight: 100, getBoundingClientRect: () => ({ top: 0 }) };
      editor.documentTop = 0;
      editor.elementAtHeight = (height) => height < 50 ? { from, to: from } : { from: to, to };
    },
    scroll() {
      extensions.find((extension) => extension.__viewPluginSpec)?.__viewPluginSpec.eventHandlers.scroll();
    },
    get document() { return document; },
    get updates() { return updates; },
    get maximumConcurrency() { return maximumConcurrency; },
    issues: () => [...editor.state.field(grammarIssuesField).issues.values()],
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
        await settle();
      }
      now = until;
      await settle();
    },
    mount() { checker.reset(); checker.request(); },
    replaceProvider(next) { active = next; checker.refreshLive(); },
    edit(index, body) {
      const visibleIndices = editor.visibleRanges.map((range) => document.segments.findIndex((segment) => segment.from === range.from));
      const segment = document.segments[index];
      const bodies = document.segments.map((entry, i) => i === index ? body : entry.body);
      document = makeDocument(bodies);
      editor.dispatch({ changes: { from: segment.from, to: segment.to, insert: body } });
      visible(visibleIndices, false);
      checker.requestTouched([segment.path]);
    },
  };
}

class GrammarElement extends HTMLElement {
  constructor(key) { super(); this.key = key; }
  closest() { return this; }
  getAttribute(name) { return name === "data-grammar-key" ? this.key : null; }
}
function click(f, entry) {
  return f.extensions.find((extension) => typeof extension?.click === "function").click({
    button: 0, target: new GrammarElement(entry.key), clientX: 1, clientY: 1, preventDefault() {}, stopPropagation() {},
  }, f.editor);
}

// Semantic performance assertions, no CPU/wall-clock benchmark: the same
// bounded check/one replacement principle as the reference plugin, adapted
// to a composite with hundreds of independent files (no code copied).
test("reset with 400 sheets schedules nothing; mount checks only the initial live window", async (t) => {
  const f = fixture(t);
  f.visible([0, 1], false);
  f.checker.reset();
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls.length, 0);
  f.checker.request();
  assert.equal([...f.timers.values()][0].delay, VIEWPORT_DELAY);
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.map((call) => call.filePath), ["0.md", "1.md"]);
  assert.equal(f.updates, 1);
});

test("fast viewport traversal replaces pending work and never starts intermediate analyses", async (t) => {
  const f = fixture(t);
  f.mount();
  for (let index = 0; index < 400; index += 1) {
    f.visible([index]);
    await f.advance(2);
    assert.equal(f.calls.length, 0);
    assert.equal(f.updates, 0);
    assert.equal(f.timers.size, 1);
  }
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.map((call) => call.filePath), ["399.md"]);
  assert.equal(f.issues().length, 1);
});

test("viewportChanged alone does not immediately analyze or rebuild decorations", async (t) => {
  const f = fixture(t);
  f.visible([1]);
  await f.advance(VIEWPORT_DELAY - 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.updates, 0);
  await f.advance(1);
  assert.equal(f.calls.length, 1);
});

test("same stabilized viewport and unchanged provider/body cause no checks or decoration updates", async (t) => {
  const f = fixture(t);
  f.visible([2, 3]);
  await f.advance(VIEWPORT_DELAY);
  const state = f.editor.state.field(grammarIssuesField);
  f.visible([2, 3]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  assert.equal(f.updates, 1);
  assert.equal(f.editor.state.field(grammarIssuesField), state);
});

test("one edited sheet invalidates only its cache and uses the existing edit debounce", async (t) => {
  const f = fixture(t);
  f.visible([0, 1, 2]);
  await f.advance(VIEWPORT_DELAY);
  f.edit(0, "changed");
  assert.equal([...f.timers.values()][0].delay, EDIT_DELAY);
  await f.advance(EDIT_DELAY - 1);
  assert.equal(f.calls.length, 3);
  await f.advance(1);
  assert.deepEqual(f.calls.slice(3).map((call) => [call.filePath, call.text]), [["0.md", "changed"]]);
  f.visible([0, 1, 2]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 4);
  assert.equal(f.issues().length, 3);
});

test("typing rapidly replaces pending edits and checks the final body only", async (t) => {
  const f = fixture(t);
  f.edit(0, "change1");
  await f.advance(EDIT_DELAY - 1);
  f.edit(0, "change2");
  await f.advance(EDIT_DELAY - 1);
  assert.equal(f.calls.length, 0);
  await f.advance(1);
  assert.deepEqual(f.calls.map((call) => call.text), ["change2"]);
});

test("an edit while analysis is in flight discards stale issues and rechecks the current sheet", async (t) => {
  const first = deferred();
  const f = fixture(t, { analyze: (input) => input.text === "bad0" ? first.promise : [issueFor(input)] });
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 1);
  f.edit(0, "newbody");
  await f.advance(EDIT_DELAY);
  assert.equal(f.calls.length, 1);
  first.resolve([issueFor({ text: "bad0" })]);
  await settle();
  assert.deepEqual(f.calls.map((call) => call.text), ["bad0", "newbody"]);
  assert.equal(f.issues()[0].issue.text, "newbody");
  assert.equal(f.updates, 1);
  assert.equal(f.maximumConcurrency, 1);
});

test("an in-flight edit does not bypass the next edit debounce when the old call finishes", async (t) => {
  const first = deferred();
  const f = fixture(t, { analyze: (input) => input.text === "bad0" ? first.promise : [] });
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  f.edit(0, "newbody");
  first.resolve([]);
  await settle();
  assert.equal(f.calls.length, 1);
  await f.advance(EDIT_DELAY);
  assert.equal(f.calls.length, 2);
});

for (const action of ["destroy", "reset"]) {
  test(`${action} during a multi-path run permits only the first in-flight call to finish`, async (t) => {
    const first = deferred();
    const f = fixture(t, { analyze: () => first.promise });
    f.visible([0, 1, 2], false);
    f.mount();
    await f.advance(VIEWPORT_DELAY);
    assert.equal(f.calls.length, 1);
    f.checker[action]();
    first.resolve([issueFor({ text: "bad0" })]);
    await settle();
    await f.advance(10000);
    assert.equal(f.calls.length, 1);
    assert.equal(f.updates, 0);
    assert.equal(f.issues().length, 0);
    assert.equal(f.timers.size, 0);
  });
}

test("recomposition schedules the new viewport without consuming the old batch", async (t) => {
  const first = deferred();
  const f = fixture(t, { analyze: (input) => input.filePath === "0.md" ? first.promise : [issueFor(input)] });
  f.visible([0, 1, 2], false);
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  f.checker.reset();
  f.visible([200]);
  await f.advance(VIEWPORT_DELAY);
  first.resolve([]);
  await settle();
  assert.deepEqual(f.calls.map((call) => call.filePath), ["0.md", "200.md"]);
  assert.deepEqual(f.issues().map((entry) => entry.filePath), ["200.md"]);
});

test("scroll during an in-flight batch stops remaining paths and waits for the final viewport", async (t) => {
  const first = deferred();
  const f = fixture(t, { analyze: (input) => input.filePath === "0.md" ? first.promise : [issueFor(input)] });
  f.visible([0, 1, 2], false);
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  for (let index = 3; index < 400; index += 1) f.visible([index]);
  first.resolve([]);
  await settle();
  assert.equal(f.calls.length, 1);
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.map((call) => call.filePath), ["0.md", "399.md"]);
  assert.equal(f.updates, 1);
});

test("provider removal clears live issues in one update and stops a running batch", async (t) => {
  const blocked = deferred();
  let block = false;
  const f = fixture(t, { analyze: (input) => block ? blocked.promise : [issueFor(input)] });
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.issues().length, 1);
  block = true;
  f.visible([1, 2, 3]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  const before = f.updates;
  f.replaceProvider(null);
  assert.equal(f.issues().length, 0);
  assert.equal(f.updates, before + 1);
  blocked.resolve([issueFor({ text: "bad1" })]);
  await settle();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  assert.equal(f.updates, before + 1);
});

test("provider re-registration/replacement (including identical id) checks only the live window", async (t) => {
  const f = fixture(t);
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  f.replaceProvider(null);
  f.visible([198, 199, 200]);
  const replacementCalls = [];
  const replacement = { id: f.provider.id, name: "New", analyze: async (input) => { replacementCalls.push(input); return [issueFor(input)]; } };
  f.replaceProvider(replacement);
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(replacementCalls.map((call) => call.filePath), ["198.md", "199.md", "200.md"]);
  assert.equal(f.calls.length, 1);
  assert.ok(f.issues().every((entry) => entry.provider === replacement));
  f.replaceProvider(f.provider);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 4);
});

test("visiting 400 sheets keeps CodeMirror decorations bounded and raw cache limited", async (t) => {
  const f = fixture(t);
  for (let index = 0; index < 400; index += 1) {
    f.visible([index]);
    await f.advance(VIEWPORT_DELAY);
    const state = f.editor.state.field(grammarIssuesField);
    assert.equal(state.issues.size, 1);
    assert.equal(state.decorations.length, 1);
    assert.deepEqual(f.issues().map((entry) => entry.filePath), [`${index}.md`]);
  }
  f.visible([398]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 400, "recent cached issues are reapplied without analyzing");
  f.visible([400 - CACHE_LIMIT - 1]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 401, "old raw cache entries are evicted");
  assert.equal(f.issues().length, 1);
});

test("three visible sheets are analyzed as one batch with one whole-window replacement and correct offsets", async (t) => {
  const f = fixture(t);
  f.visible([197, 198, 199]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.updates, 1);
  assert.equal(f.maximumConcurrency, 1);
  assert.deepEqual(f.issues().map((entry) => [entry.filePath, entry.from, entry.to]), [197, 198, 199].map((index) => {
    const segment = f.document.segments[index];
    return [segment.path, segment.from, segment.to];
  }));
  assert.equal(new Set(f.issues().map((entry) => entry.key)).size, 3);
});

test("automatic windows and explicit path refreshes have a hard sheet bound", async (t) => {
  const f = fixture(t);
  f.visible(Array.from({ length: 400 }, (_, index) => index));
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, WINDOW_LIMIT);
  f.checker.request(f.document.segments.map((entry) => entry.path));
  await f.advance(EDIT_DELAY);
  assert.equal(f.calls.length, WINDOW_LIMIT * 2);
  assert.ok(f.issues().length <= WINDOW_LIMIT);
});

test("automatic batch character limit skips oversized sheets without truncating normal sheets", async (t) => {
  const f = fixture(t, { bodies: ["x".repeat(CHARACTER_LIMIT + 1), "x".repeat(35000), "y".repeat(30000)] });
  f.visible([0, 1, 2]);
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.map((call) => [call.filePath, call.text.length]), [["1.md", 35000]]);
  assert.equal(f.issues().length, 1);
});

test("failed provider analysis is not cached and a later live request can retry", async (t) => {
  let fail = true;
  const f = fixture(t, { analyze: (input) => { if (fail) throw new Error("offline"); return [issueFor(input)]; } });
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.issues().length, 0);
  fail = false;
  f.visible([0]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  assert.equal(f.issues().length, 1);
});

test("Continu grammar/spelling suggestions and replacement target the originating sheet", async (t) => {
  const f = fixture(t, { bodies: ["bad", "wrong"], analyze: (input) => [{ ...issueFor(input), canLearn: true }] });
  const suggested = [];
  f.provider.suggest = async (word, issue) => { suggested.push([word, issue.filePath]); return ["correct"]; };
  f.visible([0, 1]);
  await f.advance(VIEWPORT_DELAY);
  const originalShow = Menu.prototype.showAtPosition;
  let shown;
  Menu.prototype.showAtPosition = function() { shown = this; };
  t.after(() => { Menu.prototype.showAtPosition = originalShow; });
  assert.equal(click(f, f.issues()[1]), true);
  await settle();
  assert.deepEqual(suggested, [["wrong", "1.md"]]);
  await shown.items[1].callback();
  assert.equal(f.editor.state.doc.toString(), "bad\ncorrect");
  assert.ok(f.issues().every((entry) => entry.filePath === "0.md"));
});

test("learn-word refreshAll invalidates cached dictionary results and checks only the live window", async (t) => {
  const learned = [];
  const f = fixture(t, { analyze: (input) => [{ ...issueFor(input), canLearn: true }] });
  f.provider.learnWord = async (word, issue) => learned.push([word, issue.filePath]);
  f.visible([0]);
  await f.advance(VIEWPORT_DELAY);
  f.visible([198, 199, 200]);
  await f.advance(VIEWPORT_DELAY);
  const originalShow = Menu.prototype.showAtPosition;
  let shown;
  Menu.prototype.showAtPosition = function() { shown = this; };
  t.after(() => { Menu.prototype.showAtPosition = originalShow; });
  assert.equal(click(f, f.issues()[1]), true);
  await shown.items[1].callback();
  await settle();
  assert.deepEqual(learned, [["bad199", "199.md"]]);
  assert.equal(f.issues().length, 0);
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.slice(4).map((call) => call.filePath), ["198.md", "199.md", "200.md"]);
  f.visible([0]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.at(-1).filePath, "0.md");
  assert.equal(f.calls.length, 8, "unvisited dictionary cache was invalidated too");
});

// Distinct, valid word ranges: this must not pass merely because the shared
// analysis sanitizer drops malformed or out-of-bounds provider results.
function denseIssues(input, count, category) {
  return Array.from({ length: count }, (_, index) => ({
    message: `Issue ${index}`, start: index * 5, end: index * 5 + 4,
    text: input.text.slice(index * 5, index * 5 + 4), category,
  }));
}

for (const category of [undefined, "Orthographe", "Grammaire", "Other"]) {
  test(`live overload discards 5000 valid issues regardless of category (${category ?? "none"})`, async (t) => {
    let returned = 0;
    const f = fixture(t, { bodies: ["word ".repeat(5000)], analyze: (input) => {
      const issues = denseIssues(input, 5000, category);
      returned += issues.length;
      return issues;
    } });
    f.mount();
    await f.advance(VIEWPORT_DELAY);
    assert.equal(returned, 5000);
    assert.equal(f.calls.length, 1);
    assert.equal(f.issues().length, 0);
    assert.equal(f.editor.state.field(grammarIssuesField).decorations.none, true);
    assert.equal(f.updates, 1, "one bounded window update, never one dispatch per issue");
  });
}

test("an overloaded sheet reuses its sentinel when unchanged or revisited", async (t) => {
  const f = fixture(t, { bodies: ["word ".repeat(5000), "other"],
    analyze: (input) => input.filePath === "0.md" ? denseIssues(input, 5000) : [issueFor(input)],
  });
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  const state = f.editor.state.field(grammarIssuesField);
  for (let pass = 0; pass < 5; pass += 1) {
    f.visible([0]);
    await f.advance(VIEWPORT_DELAY);
    assert.equal(f.editor.state.field(grammarIssuesField), state);
  }
  assert.equal(f.calls.length, 1);
  assert.equal(f.updates, 1);
  f.visible([1]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.issues().length, 1);
  f.visible([0]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2, "returning to the overloaded sheet does not analyze it again");
  assert.equal(f.issues().length, 0);
  const before = f.updates;
  f.visible([0]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.updates, before);
  assert.equal(f.timers.size, 0, "no retry loop after overload");
});

for (const count of [10, 50, 300, 301]) {
  test(`live issue boundary: ${count} valid issues`, async (t) => {
    const f = fixture(t, { bodies: ["word ".repeat(count)], analyze: (input) => denseIssues(input, count) });
    f.mount();
    await f.advance(VIEWPORT_DELAY);
    const expected = count <= ISSUE_LIMIT ? count : 0;
    assert.equal(f.issues().length, expected);
    if (expected > 0) {
      assert.equal(f.editor.state.field(grammarIssuesField).decorations.length, expected);
      assert.deepEqual(f.issues().map((entry) => [entry.from, entry.to, entry.issue.message]),
        Array.from({ length: count }, (_, index) => [index * 5, index * 5 + 4, `Issue ${index}`]));
    }
    assert.equal(f.updates, 1);
  });
}

test("three fully populated live sheets respect the explicit total issue bound in one update", async (t) => {
  const f = fixture(t, { bodies: Array(3).fill("word ".repeat(ISSUE_LIMIT)),
    analyze: (input) => denseIssues(input, ISSUE_LIMIT),
  });
  f.visible([0, 1, 2]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 3);
  assert.equal(f.issues().length, TOTAL_ISSUE_LIMIT);
  assert.equal(f.editor.state.field(grammarIssuesField).decorations.length, TOTAL_ISSUE_LIMIT);
  for (const path of ["0.md", "1.md", "2.md"]) {
    assert.equal(f.issues().filter((entry) => entry.filePath === path).length, ISSUE_LIMIT);
  }
  assert.equal(f.updates, 1);
});

test("an overloaded sheet does not hide the normal results of other visible sheets", async (t) => {
  const f = fixture(t, { bodies: ["word ".repeat(5000), "word ".repeat(50), "word ".repeat(50)],
    analyze: (input) => denseIssues(input, input.filePath === "0.md" ? 5000 : 50),
  });
  f.visible([0, 1, 2]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 3);
  assert.equal(f.issues().length, 100);
  assert.ok(f.issues().every((entry) => entry.filePath !== "0.md"));
  assert.equal(f.editor.state.field(grammarIssuesField).decorations.length, 100);
  assert.equal(f.updates, 1);
});

test("editing an overloaded sheet invalidates its sentinel and can restore normal underlines", async (t) => {
  const f = fixture(t, { bodies: ["word ".repeat(5000)], analyze: (input) => denseIssues(input, input.text.includes("edited") ? 50 : 5000) });
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  f.edit(0, "word ".repeat(5000) + "edited");
  await f.advance(EDIT_DELAY - 1);
  assert.equal(f.calls.length, 1);
  await f.advance(1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.issues().length, 50);
  f.visible([0]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  const before = f.updates;
  f.edit(0, "word ".repeat(5000));
  await f.advance(EDIT_DELAY);
  assert.equal(f.calls.length, 3);
  assert.equal(f.issues().length, 0);
  assert.equal(f.updates, before + 1, "overload removes previous normal underlines in one update");
});

test("reconnecting or replacing a provider invalidates overload exactly once", async (t) => {
  const f = fixture(t, { bodies: ["word ".repeat(5000)], analyze: (input) => denseIssues(input, 5000) });
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  f.replaceProvider(f.provider);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2, "same-instance reconnection invalidates its old sentinel");
  f.visible([0]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  let replacementCalls = 0;
  const replacement = { id: f.provider.id, name: "Replacement", analyze: async (input) => {
    replacementCalls += 1;
    return denseIssues(input, 50);
  } };
  f.replaceProvider(replacement);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(replacementCalls, 1);
  assert.equal(f.issues().length, 50);
  assert.ok(f.issues().every((entry) => entry.provider === replacement));
  f.visible([0]);
  await f.advance(VIEWPORT_DELAY);
  assert.equal(replacementCalls, 1);
  assert.equal(f.timers.size, 0);
});

test("explicit Relecture analysis retains all 5000 issues after live Continu suppresses overload", async (t) => {
  const f = fixture(t, { bodies: ["word ".repeat(5000)], analyze: (input) => denseIssues(input, 5000) });
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.issues().length, 0);
  const { runAnalysis } = await import(modulePath("src/services/text-analysis.js"));
  const result = await runAnalysis(
    { vault: { cachedRead: async () => f.document.text } },
    { get: () => f.provider }, f.document.segments[0].file,
  );
  assert.equal(result.issues.length, 5000);
  assert.equal(result.issues.at(-1).start, 4999 * 5);
  assert.equal(f.issues().length, 0, "the explicit analysis does not install an unbounded live result");
});

test("real CodeMirror: a 200000-word Continu checks its stable viewport and keeps decorations bounded", async (t) => {
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { build } = await import("esbuild");
  const { chromium } = await import("playwright");
  if (!existsSync(chromium.executablePath())) { t.skip("Chromium is not installed"); return; }
  const bundle = await build({
    stdin: { contents: `export { ScriveningsGrammarChecker } from "./utils/cm-scrivenings-grammar.ts";
      export { grammarIssuesField, setGrammarWindowEffect } from "./utils/cm-grammar-highlighter.ts";
      export { scriveningsChangeListener } from "./utils/cm-scrivenings.ts";
      export { applyCompositeChanges } from "./services/scrivenings-document.ts";
      export { EditorView } from "@codemirror/view";
      export { EditorState } from "@codemirror/state";`, resolveDir: resolve("src") },
    bundle: true, write: false, format: "iife", globalName: "GrammarTest",
    plugins: [{ name: "obsidian-test-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<style>.cm-editor{height:180px}.cm-scroller{overflow:auto}</style><div id="editor"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const api = window.GrammarTest;
    const body = Array.from({ length: 50 }, () => "word ".repeat(10).trim()).join("\n");
    let from = 0;
    let document = { text: Array(400).fill(body).join("\n"), segments: Array.from({ length: 400 }, (_, index) => {
      const path = `${index}.md`;
      const segment = { path, body, from, to: from + body.length, file: { path, basename: String(index), stat: { mtime: 1 } } };
      from = segment.to + 1;
      return segment;
    }) };
    const calls = [];
    const returnedCounts = [];
    let issueCount = 1;
    let windowUpdates = 0;
    const provider = { id: "provider", name: "Provider", analyze: async (input) => {
      calls.push(input.filePath);
      returnedCounts.push(issueCount);
      // 5000 valid results, some overlapping, for the existing long sheet.
      return Array.from({ length: issueCount }, (_, index) => {
        const start = (index % Math.floor(input.text.length / 5)) * 5;
        return { message: "Issue", start, end: start + 4, text: input.text.slice(start, start + 4) };
      });
    } };
    let editor;
    const checker = new api.ScriveningsGrammarChecker({
      host: { app: {}, getAnalysisProvider: () => provider }, getEditor: () => editor, getDocument: () => document,
    });
    const extensions = [...checker.extensions(), api.scriveningsChangeListener((changes) => {
      const result = api.applyCompositeChanges(document, changes);
      document = result.document;
      checker.requestTouched(result.touchedPaths);
    })];
    editor = new api.EditorView({
      parent: window.document.getElementById("editor"), state: api.EditorState.create({ doc: document.text, extensions }),
      dispatchTransactions(transactions, view) {
        windowUpdates += transactions.filter((transaction) => transaction.effects.some((effect) => effect.is(api.setGrammarWindowEffect))).length;
        view.update(transactions);
      },
    });
    checker.reset();
    checker.request();
    window.grammarFixture = {
      editor, checker, calls,
      setIssueCount(count) { issueCount = count; },
      snapshot() {
        const issues = [...editor.state.field(api.grammarIssuesField).issues.values()];
        const visible = document.segments.filter((segment) => editor.visibleRanges.some((range) => segment.to >= range.from && segment.from < range.to));
        return { calls: [...calls], returnedCounts: [...returnedCounts], windowUpdates, decorationCount: editor.state.field(api.grammarIssuesField).decorations.size, issuePaths: issues.map((issue) => issue.filePath), visiblePaths: visible.map((segment) => segment.path),
          issues: issues.map((issue) => ({ from: issue.from, to: issue.to, text: editor.state.sliceDoc(issue.from, issue.to) })) };
      },
    };
  });
  await page.waitForFunction(() => window.grammarFixture.calls.length > 0);
  const initial = await page.evaluate(() => window.grammarFixture.snapshot());
  assert.ok(initial.calls.length > 0 && initial.calls.length <= WINDOW_LIMIT);
  assert.deepEqual(initial.issuePaths, initial.calls);
  assert.ok(initial.calls.every((path) => initial.visiblePaths.includes(path)));
  await page.evaluate(async () => {
    const editor = window.grammarFixture.editor;
    for (let step = 1; step <= 20; step += 1) {
      editor.scrollDOM.scrollTop = editor.scrollDOM.scrollHeight * step / 21;
      await new Promise((done) => requestAnimationFrame(done));
    }
  });
  const scrolling = await page.evaluate(() => window.grammarFixture.snapshot());
  assert.deepEqual(scrolling.calls, initial.calls, "scrolling causes no immediate analysis");
  await page.waitForTimeout(VIEWPORT_DELAY + 200);
  const stopped = await page.evaluate(() => window.grammarFixture.snapshot());
  const newCalls = stopped.calls.slice(initial.calls.length);
  assert.ok(newCalls.length > 0 && newCalls.length <= WINDOW_LIMIT);
  assert.ok(newCalls.every((path) => stopped.visiblePaths.includes(path)));
  assert.deepEqual(stopped.issuePaths, newCalls);
  assert.ok(stopped.issues.every((issue) => issue.text === "word"));
  await page.evaluate(() => {
    const f = window.grammarFixture;
    const offset = Number(f.calls.at(-1).replace(".md", "")) * 2500;
    f.editor.dispatch({ changes: { from: offset, to: offset + 4, insert: "ward" } });
  });
  await page.waitForTimeout(EDIT_DELAY + 200);
  const edited = await page.evaluate(() => window.grammarFixture.snapshot());
  assert.equal(edited.calls.length, stopped.calls.length + 1);
  assert.equal(edited.calls.at(-1), stopped.calls.at(-1));
  assert.ok(edited.issues.some((issue) => issue.text === "ward"));
  assert.ok(edited.issuePaths.length <= WINDOW_LIMIT);
  const cleared = await page.evaluate(() => {
    const f = window.grammarFixture;
    f.setIssueCount(5000);
    f.checker.refreshLive();
    return f.snapshot();
  });
  await page.waitForTimeout(VIEWPORT_DELAY + 200);
  const overloaded = await page.evaluate(() => window.grammarFixture.snapshot());
  assert.ok(overloaded.returnedCounts.slice(edited.calls.length).every((count) => count === 5000));
  assert.ok(overloaded.calls.length > edited.calls.length);
  assert.equal(overloaded.issuePaths.length, 0);
  assert.equal(overloaded.decorationCount, 0);
  assert.equal(overloaded.windowUpdates, cleared.windowUpdates + 1, "5000 results per sheet produce one bounded result update");
  await page.evaluate(() => window.grammarFixture.checker.viewportChanged());
  await page.waitForTimeout(VIEWPORT_DELAY + 200);
  const reused = await page.evaluate(() => window.grammarFixture.snapshot());
  assert.deepEqual(reused.calls, overloaded.calls);
  assert.equal(reused.windowUpdates, overloaded.windowUpdates);
  assert.equal(reused.decorationCount, 0);
  await page.evaluate(() => window.grammarFixture.editor.destroy());
});

const BOTTOM_SHEET = "Il ne faut pas manger le pomme.\nTu crois que tu as raison mais elles est contente.";
function proseIssues(input) {
  return ["le pomme", "elles est"].flatMap((text) => {
    const start = input.text.indexOf(text);
    return start < 0 ? [] : [{ start, end: start + text.length, text, message: "Accord" }];
  });
}

test("two actual visible sheets: a short bottom sheet is checked despite earlier sheets in the CM render margin", async (t) => {
  const f = fixture(t, { bodies: ["Margin one", "Margin two", "Une longue phrase.\n".repeat(50), BOTTOM_SHEET, "Offscreen"], analyze: proseIssues });
  const [,, a, b] = f.document.segments;
  f.ranges([{ from: 0, to: f.document.text.length }], false);
  f.screen(a.to - 30, b.to);
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.map((call) => call.filePath), [a.path, b.path]);
  assert.deepEqual(f.issues().map((issue) => [issue.filePath, issue.from, issue.to]), ["le pomme", "elles est"].map((text) => [b.path, b.from + b.body.indexOf(text), b.from + b.body.indexOf(text) + text.length]));
  assert.equal(f.updates, 1);
  // The drawn ranges do not change on these small scrolls. The DOM scroll
  // handler must still replace the timer; cache reuse must avoid new work.
  const state = f.editor.state.field(grammarIssuesField);
  f.screen(b.from, b.to);
  f.scroll();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  assert.equal(f.issues().length, 2);
  f.screen(a.to - 30, b.to);
  f.scroll();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.issues(), [...state.issues.values()]);
});

test("scroll inside unchanged rendered ranges schedules only the final actual visible window", async (t) => {
  const f = fixture(t);
  f.ranges([{ from: 0, to: f.document.text.length }], false);
  f.screen(0, f.document.segments[0].to);
  f.mount();
  for (let index = 1; index < 400; index += 1) {
    const segment = f.document.segments[index];
    f.screen(segment.from, segment.to);
    f.scroll();
    await f.advance(1);
    assert.equal(f.calls.length, 0);
    assert.equal(f.timers.size, 1);
  }
  await f.advance(VIEWPORT_DELAY - 2);
  assert.equal(f.calls.length, 0);
  await f.advance(1);
  assert.deepEqual(f.calls.map((call) => call.filePath), ["399.md"]);
});

test("visible body/range boundaries are half-open, including bottom intersections and disjoint ranges", async (t) => {
  const f = fixture(t, { bodies: ["Avant", "Contenu du feuillet", "Après"] });
  const a = f.document.segments[1];
  for (const [from, to, eligible] of [
    [a.from, a.to, true], [a.from, a.from + 2, true], [a.to - 2, a.to, true],
    [a.from + 2, a.to - 2, true], [a.from - 1, a.to + 1, true],
    [a.from - 1, a.from, false], [a.to, a.to + 1, false], [a.from, a.from, false],
  ]) {
    f.checker.reset();
    f.ranges([{ from, to }]);
    await f.advance(VIEWPORT_DELAY);
    assert.equal(f.issues().some((entry) => entry.filePath === a.path), eligible, `${from}..${to}`);
  }
  f.checker.reset();
  f.ranges([{ from: 0, to: 2 }, { from: a.to - 2, to: a.to }]);
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.issues().map((entry) => entry.filePath), ["0.md", "1.md"]);
});

test("four on-screen sheets retain the first three in screen order, with no offscreen render-margin neighbour", async (t) => {
  const f = fixture(t, { count: 8 });
  f.ranges([{ from: 0, to: f.document.text.length }], false);
  f.screen(f.document.segments[3].from, f.document.segments[6].to);
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.map((call) => call.filePath), ["3.md", "4.md", "5.md"]);
  f.scroll();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, WINDOW_LIMIT);
  assert.equal(f.updates, 1);
});

test("actual-screen clipping preserves the 60000-character batch budget and can include a short bottom sheet", async (t) => {
  const f = fixture(t, { bodies: ["margin", "a".repeat(CHARACTER_LIMIT + 1), BOTTOM_SHEET, "offscreen"], analyze: proseIssues });
  const [,a,b] = f.document.segments;
  f.ranges([{ from: 0, to: f.document.text.length }], false);
  f.screen(a.to - 20, b.to);
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.map((call) => call.filePath), [b.path]);
  assert.equal(f.issues().length, 2);
  assert.ok(f.calls.reduce((sum, call) => sum + call.text.length, 0) <= CHARACTER_LIMIT);
});

test("editing a visible bottom sheet invalidates only its cache and reinstalls its issues after 600ms", async (t) => {
  const f = fixture(t, { bodies: ["Un autre feuillet", BOTTOM_SHEET], analyze: proseIssues });
  f.visible([0, 1]);
  await f.advance(VIEWPORT_DELAY);
  f.edit(1, `${BOTTOM_SHEET}\nUne phrase ajoutée.`);
  await f.advance(EDIT_DELAY - 1);
  assert.equal(f.calls.length, 2);
  await f.advance(1);
  assert.deepEqual(f.calls.map((call) => call.filePath), ["0.md", "1.md", "1.md"]);
  assert.equal(f.issues().length, 2);
});

test("an overloaded visible bottom sheet retains its sentinel while moving between top and bottom", async (t) => {
  const f = fixture(t, { bodies: ["margin", "margin", "normal", "word ".repeat(5000)], analyze: (input) => input.filePath === "3.md" ? denseIssues(input, 5000) : [issueFor(input)] });
  const [,,a,b] = f.document.segments;
  f.ranges([{ from: 0, to: f.document.text.length }], false);
  f.screen(a.from, b.to);
  f.mount();
  await f.advance(VIEWPORT_DELAY);
  assert.deepEqual(f.calls.map((call) => call.filePath), [a.path, b.path]);
  assert.deepEqual(f.issues().map((entry) => entry.filePath), [a.path]);
  f.screen(b.from, b.to); f.scroll();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.issues().length, 0);
  f.screen(a.from, b.to); f.scroll();
  await f.advance(VIEWPORT_DELAY);
  assert.equal(f.calls.length, 2);
  assert.equal(f.issues().length, 1);
});

test("real CodeMirror: a short bottom sheet is decorated before/after scrolling to the top, despite offscreen rendered sheets", async (t) => {
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { build } = await import("esbuild");
  const { chromium } = await import("playwright");
  if (!existsSync(chromium.executablePath())) { t.skip("Chromium is not installed"); return; }
  const bundle = await build({
    stdin: { contents: `export { ScriveningsGrammarChecker } from "./utils/cm-scrivenings-grammar.ts";
      export { grammarIssuesField } from "./utils/cm-grammar-highlighter.ts";
      export { EditorView } from "@codemirror/view";
      export { EditorState } from "@codemirror/state";`, resolveDir: resolve("src") },
    bundle: true, write: false, format: "iife", globalName: "BottomGrammarTest",
    plugins: [{ name: "obsidian-test-runtime", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve("test/obsidian-runtime-stub.mjs") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<style>.cm-editor{height:600px}.cm-scroller{overflow:auto}.cm-content{font-size:14px;line-height:20px}</style><div id="editor"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate((shortBody) => {
    const api = window.BottomGrammarTest;
    const bodies = [Array(5).fill("Premier feuillet.").join("\n"), Array(5).fill("Autre feuillet.").join("\n"),
      Array(30).fill("Un long feuillet.").join("\n"), shortBody, Array(100).fill("Suite du document.").join("\n")];
    let from = 0;
    const segments = bodies.map((body, index) => {
      const path = `${index}.md`;
      const segment = { path, body, from, to: from + body.length, file: { path, basename: String(index), stat: { mtime: 1 } } };
      from = segment.to + 1;
      return segment;
    });
    const document = { text: bodies.join("\n"), segments };
    const calls = [];
    const provider = { id: "provider", name: "Provider", analyze: async (input) => {
      calls.push(input.filePath);
      return ["le pomme", "elles est"].flatMap((text) => {
        const start = input.text.indexOf(text);
        return start < 0 ? [] : [{ start, end: start + text.length, text, message: "Accord" }];
      });
    } };
    let editor;
    const checker = new api.ScriveningsGrammarChecker({ host: { app: {}, getAnalysisProvider: () => provider }, getEditor: () => editor, getDocument: () => document });
    editor = new api.EditorView({ parent: window.document.getElementById("editor"), state: api.EditorState.create({ doc: document.text, extensions: checker.extensions() }) });
    checker.reset(); checker.request();
    window.bottomFixture = {
      editor, document, calls,
      move(bottom) { editor.scrollDOM.scrollTop = editor.lineBlockAt(segments[3].from).top - (bottom ? 556 : 0); },
      snapshot() {
        const scroller = editor.scrollDOM.getBoundingClientRect();
        const actual = segments.filter((segment) => editor.lineBlockAt(segment.from).top + editor.documentTop < scroller.bottom
          && editor.lineBlockAt(segment.to - 1).bottom + editor.documentTop > scroller.top);
        const rendered = segments.filter((segment) => editor.visibleRanges.some((range) => segment.from < range.to && segment.to > range.from));
        const issues = [...editor.state.field(api.grammarIssuesField).issues.values()];
        return { calls: [...calls], actual: actual.map((s) => s.path), rendered: rendered.map((s) => s.path),
          issues: issues.map((issue) => ({ path: issue.filePath, from: issue.from, to: issue.to, text: editor.state.sliceDoc(issue.from, issue.to) })),
          decorations: [...editor.dom.querySelectorAll(".feuillets-grammar-underline")].map((span) => span.textContent) };
      },
    };
  }, BOTTOM_SHEET);
  await page.waitForFunction(() => window.bottomFixture.calls.length === 3);
  await page.evaluate(() => window.bottomFixture.move(true));
  await page.waitForFunction(() => window.bottomFixture.snapshot().issues.length === 2);
  const bottom = await page.evaluate(() => window.bottomFixture.snapshot());
  assert.deepEqual(bottom.actual, ["2.md", "3.md"], "only A and B are on screen, not the extra render-margin sheets");
  assert.deepEqual(bottom.rendered, ["0.md", "1.md", "2.md", "3.md", "4.md"]);
  assert.deepEqual(bottom.calls, ["0.md", "1.md", "2.md", "3.md"]);
  assert.deepEqual(bottom.decorations, ["le pomme", "elles est"]);
  assert.deepEqual(bottom.issues.map((entry) => entry.text), ["le pomme", "elles est"]);
  await page.evaluate(() => window.bottomFixture.move(false));
  await page.waitForTimeout(VIEWPORT_DELAY + 200);
  const top = await page.evaluate(() => window.bottomFixture.snapshot());
  assert.deepEqual(top.issues, bottom.issues);
  assert.deepEqual(top.decorations, bottom.decorations);
  assert.equal(top.calls.filter((path) => path === "3.md").length, 1, "B is reused from cache");
  await page.evaluate(() => window.bottomFixture.move(true));
  await page.waitForTimeout(VIEWPORT_DELAY + 200);
  const returned = await page.evaluate(() => window.bottomFixture.snapshot());
  assert.deepEqual(returned.issues, bottom.issues);
  assert.deepEqual(returned.decorations, bottom.decorations);
  assert.equal(returned.calls.filter((path) => path === "3.md").length, 1);
  await page.evaluate(() => window.bottomFixture.editor.destroy());
});
