import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { RewriteHistory } from "../src/services/rewrite-history.js";
import { RewriteHistoryStore } from "../src/services/rewrite-history-store.js";

test("rewrite history: real CodeMirror transactions retain pre-edit source through undo, redo, view changes and destruction", async (t) => {
  const bundle = await build({ stdin: { contents: `
    export { EditorState, StateField } from "@codemirror/state";
    export { EditorView } from "@codemirror/view";
    export { history, undo, redo } from "@codemirror/commands";
    export { editorInfoField } from "obsidian";
    export { createRewriteHistoryExtension } from "./src/utils/cm-rewrite-history.ts";
  `, resolveDir: resolve(".") }, bundle: true, write: false, format: "iife", globalName: "HistoryTest",
    alias: { "@codemirror/state": resolve("node_modules/@codemirror/state/dist/index.js") },
    plugins: [{ name: "history-obsidian", setup(builder) {
      builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "history-obsidian", namespace: "history-test" }));
      builder.onLoad({ filter: /.*/, namespace: "history-test" }, () => ({ contents: `
        import { StateField } from "@codemirror/state";
        export const editorInfoField = StateField.define({ create: () => ({ file: window.historyFile }), update: (value) => value });
      `, resolveDir: resolve(".") }));
    } }],
  });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => {
    const api = window.HistoryTest;
    const changes = []; const closed = [];
    window.historyFile = { path: "Projet/A.md" };
    const make = (doc) => new api.EditorView({ parent: document.body, state: api.EditorState.create({ doc,
      extensions: [api.editorInfoField, api.history(), api.createRewriteHistoryExtension((file, before, after, origin) => changes.push({ path: file.path, before, after, origin }), (file) => closed.push(file.path))],
    }) });
    const view = make("---\ntitle: A\n---\nLe chat");
    const openingCount = changes.length;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const selectionCount = changes.length;
    view.dispatch({ changes: { from: view.state.doc.length - 4, to: view.state.doc.length, insert: "chien" } });
    api.undo(view); api.redo(view);
    view.destroy();
    window.historyFile = { path: "Projet/B.md" }; const next = make("Autre feuillet");
    next.dispatch({ changes: { from: 0, to: 5, insert: "Second" } }); next.destroy();
    return { changes, closed, openingCount, selectionCount };
  });
  assert.equal(result.openingCount, 0); assert.equal(result.selectionCount, 0);
  assert.deepEqual(result.closed, ["Projet/A.md", "Projet/B.md"]);
  assert.equal(result.changes.length, 4);
  assert.equal(result.changes[0].before, "---\ntitle: A\n---\nLe chat");
  assert.equal(result.changes[0].after, "---\ntitle: A\n---\nLe chien");
  assert.equal(result.changes[1].after, result.changes[0].before);
  assert.equal(result.changes[2].before, result.changes[0].before);
  const root = new TFolder("Projet"); const files = [new TFile("Projet/A.md"), new TFile("Projet/B.md")];
  files.forEach((file, i) => { file.stat = { ctime: i + 1 }; });
  const { vault } = createFakeVault([root, ...files]);
  const history = new RewriteHistory(new RewriteHistoryStore({ vault }, root), { inactivityMs: () => 600000, onError: (error) => { throw error; } });
  for (const change of result.changes) history.observe(files.find((file) => file.path === change.path), change.before, change.after, change.origin);
  await history.close(); assert.equal((await history.list()).length, 2);
  const [entry] = await history.list(files[0]); assert.equal(entry.delta, 0);
  assert.equal(await vault.read(await history.store.state(entry.before)), result.changes[0].before);
  assert.deepEqual(errors, []);
});

test("history actions adapt to a narrow sidebar and preserve keyboard focus during refresh", async (t) => {
  const bundle = await build({ stdin: { contents: `
    export { mountRewriteHistoryEntries } from "./src/ui/rewrite-history-section.ts";
    export { setLocale } from "./src/i18n/index.ts";
  `, resolveDir: resolve(".") }, bundle: true, write: false, format: "iife", globalName: "HistoryActions",
    alias: { obsidian: resolve("test/obsidian-runtime-stub.mjs") },
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div class="feuillets-sidebar-container"><div class="feuillets-sidebar-content" style="width: 260px; padding: 16px; box-sizing: border-box; height: 250px; overflow: auto; overflow-anchor: none"><button id="back">Retour</button><div id="history"></div></div></div>');
  await page.addStyleTag({ path: resolve("styles.css") });
  await page.addStyleTag({ content: ":root { --background-modifier-hover: #eee; --interactive-accent: #669; --size-4-2: 8px; --size-4-1: 4px; --size-2-1: 2px; }" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    HTMLElement.prototype.createEl = function (tag, options = {}) {
      const child = this.ownerDocument.createElement(tag);
      child.className = options.cls ?? "";
      child.textContent = options.text ?? "";
      for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
      return this.appendChild(child);
    };
    HTMLElement.prototype.createDiv = function (options) { return this.createEl("div", options); };
    HTMLElement.prototype.createSpan = function (options) { return this.createEl("span", options); };
    HTMLElement.prototype.setAttr = function (name, value) { this.setAttribute(name, value); };
    const entry = { startedAt: 1795342320000, endedAt: 1795342330000, initialWords: 1796, finalWords: 1791, delta: -5, origins: [], after: "after" };
    window.HistoryActions.setLocale("fr");
    const host = document.querySelector("#history");
    window.activations = [];
    host.addEventListener("click", (event) => window.activations.push(event.target.closest("button").className));
    const history = { store: { state: () => new Promise(() => {}) } };
    const entries = Array.from({ length: 40 }, (_, i) => ({ ...entry, id: String(i) }));
    const render = window.HistoryActions.mountRewriteHistoryEntries(host, history, { app: {} });
    render(entries);
    window.refreshHistory = () => render([{ ...entry, id: "new" }, ...entries]);
  });
  const row = page.locator('[data-entry-id="0"]');
  const primary = row.getByRole("button", { name: /avant\/après/ });
  const current = row.getByRole("button", { name: "Comparer à l’actuel", exact: true });
  assert.equal(await current.locator(".feuillets-rewrite-current-short").isVisible(), true);
  assert.equal(await current.locator(".feuillets-rewrite-current-full").isVisible(), false);
  assert.equal(await row.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
  await primary.hover();
  assert.equal(await primary.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(238, 238, 238)");
  await page.locator("#back").focus();
  await page.keyboard.press("Tab");
  assert.equal(await primary.evaluate((el) => el === document.activeElement && el.matches(":focus-visible")), true);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  assert.equal(await current.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.activations), ["feuillets-rewrite-primary", "feuillets-rewrite-current"]);
  await page.evaluate(() => window.refreshHistory());
  assert.equal(await current.evaluate((el) => el === document.activeElement), true);
  await page.locator(".feuillets-sidebar-content").evaluate((el) => { el.style.width = "390px"; });
  assert.equal(await current.locator(".feuillets-rewrite-current-full").isVisible(), true);
  assert.equal(await current.locator(".feuillets-rewrite-current-short").isVisible(), false);
});
