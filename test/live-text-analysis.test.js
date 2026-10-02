import assert from "node:assert/strict";
import test from "node:test";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledModule = (p) => new URL(`../.test-dist/${p}`, import.meta.url).href;
const modulePath = (p) => (isCompiledTest ? `../${p}` : compiledModule(p));

const { LiveTextAnalysis, LIVE_TEXT_ANALYSIS_DEBOUNCE_MS } = await import(modulePath("src/services/live-text-analysis.js"));
const { analyzeText } = await import(modulePath("src/services/text-analysis.js"));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function makeTimers() {
  let next = 0;
  const pending = new Map();
  return {
    setTimeout(callback) {
      next += 1;
      pending.set(next, callback);
      return next;
    },
    clearTimeout(timer) {
      pending.delete(timer);
    },
    runNext() {
      const entry = pending.entries().next().value;
      assert.ok(entry, "un délai est programmé");
      pending.delete(entry[0]);
      entry[1]();
    },
    count() { return pending.size; },
  };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function makeProvider(id = "provider") {
  return { id, name: id, analyze: async () => [] };
}

function snapshot(provider, text, filePath = "A.md", context = {}) {
  return { provider, text, filePath, fileTitle: filePath, context };
}

test("live analysis debounces edits and keeps only the newest buffer", async () => {
  const timers = makeTimers();
  const provider = makeProvider();
  const context = {};
  const calls = [];
  let current = snapshot(provider, "three", "A.md", context);
  const live = new LiveTextAnalysis({
    timers,
    isCurrent: (value) => value === current || (value.text === current.text && value.context === current.context),
    analyze: async (value) => { calls.push(value); return value.text; },
    publish: () => {},
  });

  live.schedule(snapshot(provider, "one", "A.md", context));
  live.schedule(snapshot(provider, "two", "A.md", context));
  live.schedule(current);
  assert.equal(timers.count(), 1);
  timers.runNext();
  await flush();
  assert.deepEqual(calls.map((value) => value.text), ["three"]);
  assert.equal(LIVE_TEXT_ANALYSIS_DEBOUNCE_MS, 1000);
});

test("live analysis discards stale completions and starts the newest pending snapshot", async () => {
  const timers = makeTimers();
  const provider = makeProvider();
  const context = {};
  const first = deferred();
  const second = deferred();
  const calls = [];
  const published = [];
  let current = snapshot(provider, "A", "A.md", context);
  const live = new LiveTextAnalysis({
    timers,
    isCurrent: (value) => value.filePath === current.filePath && value.text === current.text && value.provider === current.provider && value.context === current.context,
    analyze: (value) => { calls.push(value); return value.text === "A" ? first.promise : second.promise; },
    publish: (value) => published.push(value),
  });

  live.schedule(current);
  timers.runNext();
  await flush();
  current = snapshot(provider, "B", "A.md", context);
  live.schedule(current);
  timers.runNext();
  first.resolve("old");
  await flush();
  assert.deepEqual(published, []);
  assert.deepEqual(calls.map((value) => value.text), ["A", "B"]);
  second.resolve("new");
  await flush();
  assert.deepEqual(published, ["new"]);
});

test("live analysis rejects switched files and replaced providers", async () => {
  const timers = makeTimers();
  const oldProvider = makeProvider("old");
  const newProvider = makeProvider("new");
  const context = {};
  const result = deferred();
  const published = [];
  let current = snapshot(oldProvider, "A", "A.md", context);
  const live = new LiveTextAnalysis({
    timers,
    isCurrent: (value) => value.filePath === current.filePath && value.provider === current.provider && value.text === current.text,
    analyze: () => result.promise,
    publish: (value) => published.push(value),
  });

  live.schedule(current);
  timers.runNext();
  await flush();
  current = snapshot(newProvider, "B", "B.md", context);
  result.resolve("obsolete");
  await flush();
  assert.deepEqual(published, []);

  live.schedule(current);
  timers.runNext();
  await flush();
  live.invalidate();
  assert.equal(timers.count(), 0);
});

test("live analysis recovers from failures and ignores work after disposal", async () => {
  const timers = makeTimers();
  const provider = makeProvider();
  const context = {};
  let current = snapshot(provider, "A", "A.md", context);
  let attempts = 0;
  const published = [];
  const running = [];
  const live = new LiveTextAnalysis({
    timers,
    isCurrent: (value) => value.text === current.text,
    analyze: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("unavailable");
      return "ok";
    },
    publish: (value) => published.push(value),
    onRunningChange: (value) => running.push(value),
  });

  live.schedule(current);
  timers.runNext();
  await flush();
  current = snapshot(provider, "B", "A.md", context);
  live.schedule(current);
  timers.runNext();
  await flush();
  assert.deepEqual(published, ["ok"]);
  assert.deepEqual(running, [true, false, true, false]);

  const late = deferred();
  const disposable = new LiveTextAnalysis({
    timers,
    isCurrent: () => true,
    analyze: () => late.promise,
    publish: (value) => published.push(value),
  });
  disposable.schedule(snapshot(provider, "C", "A.md", {}));
  timers.runNext();
  await flush();
  disposable.dispose();
  late.resolve("late");
  await flush();
  assert.deepEqual(published, ["ok"]);
});

test("in-memory analysis preserves frontmatter exclusion, markdown masking, and offsets", async () => {
  const received = [];
  const provider = {
    id: "provider",
    name: "Provider",
    analyze: async (input) => {
      received.push(input);
      const start = input.text.indexOf("dorment");
      return [{ message: "Agreement", start, end: start + 7 }];
    },
  };
  const content = "---\ntitle: Test\n---\n# Heading\nLe [chat](https://example.test) dorment.";
  const run = await analyzeText(provider, content, {
    filePath: "A.md",
    fileTitle: "A",
    mtime: 1,
    source: "buffer",
  });
  assert.equal(received[0].text.length, content.length - content.indexOf("# Heading"));
  assert.equal(received[0].text.includes("https://example.test"), false);
  assert.equal(content.slice(run.issues[0].start, run.issues[0].end), "dorment");
  assert.equal(run.sourceText, content);
  assert.equal(run.source, "buffer");
});

test("live analysis stays inert when no current provider context is available", () => {
  const timers = makeTimers();
  const provider = makeProvider();
  const live = new LiveTextAnalysis({
    timers,
    isCurrent: () => false,
    analyze: async () => "never",
    publish: () => assert.fail("no result is published"),
  });
  live.schedule(snapshot(provider, "text"));
  assert.equal(timers.count(), 0);
});
