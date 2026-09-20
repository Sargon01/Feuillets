import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyResearchOrder,
  reorderResearchKeys,
  RESEARCH_ORDER_DRAG_MIME,
} from "../src/services/research-order.js";

/* Pure logic only — no DOM, no Vault, no Obsidian API. The DOM-level
   wiring (drag-and-drop, Monter/Descendre menu items, visual indicators)
   is covered separately in test/research-reorder.test.js. */

test("applyResearchOrder: with no recorded order at all, items keep their given (already deterministic) order", () => {
  const items = ["Sources", "Personnages", "Lieux"];
  assert.deepEqual(applyResearchOrder("parent", items, (s) => s, {}), items);
});

test("applyResearchOrder: an empty recorded order behaves the same as no order", () => {
  const items = ["Sources", "Personnages", "Lieux"];
  assert.deepEqual(applyResearchOrder("parent", items, (s) => s, { parent: [] }), items);
});

test("applyResearchOrder: recorded order wins — example from the spec, \"Notes\" placed before \"Sources\"", () => {
  const items = ["Sources", "Notes"];
  const order = { parent: ["Notes", "Sources"] };
  assert.deepEqual(applyResearchOrder("parent", items, (s) => s, order), ["Notes", "Sources"]);
});

test("applyResearchOrder: a never-recorded item (a new folder) is appended at the end, deterministically", () => {
  const items = ["Sources", "Personnages", "Lieux"];
  const order = { parent: ["Lieux", "Sources"] };
  // "Personnages" was never recorded — created after the order was last saved.
  assert.deepEqual(applyResearchOrder("parent", items, (s) => s, order), ["Lieux", "Sources", "Personnages"]);
});

test("applyResearchOrder: several never-recorded items keep their original relative order among themselves", () => {
  const items = ["A", "B", "C", "D"];
  const order = { parent: ["C"] };
  assert.deepEqual(applyResearchOrder("parent", items, (s) => s, order), ["C", "A", "B", "D"]);
});

test("applyResearchOrder: a stale recorded key (renamed/deleted item) is silently ignored, never crashes", () => {
  const items = ["Sources", "Personnages"];
  const order = { parent: ["Ancien nom disparu", "Personnages", "Sources"] };
  assert.deepEqual(applyResearchOrder("parent", items, (s) => s, order), ["Personnages", "Sources"]);
});

test("applyResearchOrder: order recorded under a different parentKey never leaks across groups", () => {
  const items = ["Sources", "Personnages"];
  const order = { "other-parent": ["Personnages", "Sources"] };
  assert.deepEqual(applyResearchOrder("parent", items, (s) => s, order), items);
});

test("applyResearchOrder: never mutates the input items array or the order map", () => {
  const items = ["Sources", "Personnages"];
  const order = { parent: ["Personnages", "Sources"] };
  const itemsCopy = [...items];
  const orderCopy = JSON.parse(JSON.stringify(order));
  applyResearchOrder("parent", items, (s) => s, order);
  assert.deepEqual(items, itemsCopy);
  assert.deepEqual(order, orderCopy);
});

test("reorderResearchKeys: moves the source key just before the target key", () => {
  const result = reorderResearchKeys(["A", "B", "C"], "C", "A", "before");
  assert.deepEqual(result, ["C", "A", "B"]);
});

test("reorderResearchKeys: moves the source key just after the target key", () => {
  const result = reorderResearchKeys(["A", "B", "C"], "A", "C", "after");
  assert.deepEqual(result, ["B", "C", "A"]);
});

test("reorderResearchKeys: dropping an item on itself is a no-op", () => {
  const current = ["A", "B", "C"];
  assert.deepEqual(reorderResearchKeys(current, "B", "B", "before"), current);
});

test("reorderResearchKeys: an unknown source key is a no-op (stale drag payload)", () => {
  const current = ["A", "B", "C"];
  assert.deepEqual(reorderResearchKeys(current, "Z", "B", "before"), current);
});

test("reorderResearchKeys: an unknown target key is a no-op (stale drop target)", () => {
  const current = ["A", "B", "C"];
  assert.deepEqual(reorderResearchKeys(current, "A", "Z", "after"), current);
});

test("reorderResearchKeys: adjacent \"before\" swap is a simple two-item flip", () => {
  assert.deepEqual(reorderResearchKeys(["A", "B"], "B", "A", "before"), ["B", "A"]);
});

test("reorderResearchKeys: never mutates the input array", () => {
  const current = ["A", "B", "C"];
  const currentCopy = [...current];
  reorderResearchKeys(current, "C", "A", "before");
  assert.deepEqual(current, currentCopy);
});

test("Monter/Descendre as reorder: moving \"up\" is reorderResearchKeys(..., previousSibling, \"before\")", () => {
  const siblings = ["Personnages", "Lieux", "Sources"];
  const index = siblings.indexOf("Sources");
  const moved = reorderResearchKeys(siblings, "Sources", siblings[index - 1], "before");
  assert.deepEqual(moved, ["Personnages", "Sources", "Lieux"]);
});

test("Monter/Descendre as reorder: moving \"down\" is reorderResearchKeys(..., nextSibling, \"after\")", () => {
  const siblings = ["Personnages", "Lieux", "Sources"];
  const index = siblings.indexOf("Personnages");
  const moved = reorderResearchKeys(siblings, "Personnages", siblings[index + 1], "after");
  assert.deepEqual(moved, ["Lieux", "Personnages", "Sources"]);
});

/* ==================== settings round-trip (persistence) ==================== */

test("researchOrder survives a save/reload round-trip through plain JSON (settings persistence)", () => {
  const settings = { researchOrder: {} };
  settings.researchOrder["research-sections:Projet/_Recherche"] = reorderResearchKeys(
    ["Projet/_Recherche/Sources", "Projet/_Recherche/Notes"],
    "Projet/_Recherche/Notes",
    "Projet/_Recherche/Sources",
    "before"
  );

  // Simulates Obsidian's own save/reload of data.json.
  const reloaded = JSON.parse(JSON.stringify(settings));

  assert.deepEqual(reloaded.researchOrder["research-sections:Projet/_Recherche"], [
    "Projet/_Recherche/Notes",
    "Projet/_Recherche/Sources",
  ]);
  // The reloaded order still drives the same deterministic result.
  const items = ["Projet/_Recherche/Sources", "Projet/_Recherche/Notes"];
  assert.deepEqual(
    applyResearchOrder("research-sections:Projet/_Recherche", items, (s) => s, reloaded.researchOrder),
    ["Projet/_Recherche/Notes", "Projet/_Recherche/Sources"]
  );
});

/* ==================== no forbidden platform APIs ==================== */

test("research-order.ts uses only plain data structures — no Node fs, Electron, FileSystemAdapter, DOM, or Vault API", () => {
  const raw = readFileSync(join(process.cwd(), "src/services/research-order.ts"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  assert.doesNotMatch(code, /require\(\s*["']fs["']\s*\)/);
  assert.doesNotMatch(code, /from\s+["']fs["']/);
  assert.doesNotMatch(code, /from\s+["']node:fs["']/);
  assert.doesNotMatch(code, /from\s+["']electron["']/);
  assert.doesNotMatch(code, /require\(\s*["']electron["']\s*\)/);
  assert.doesNotMatch(code, /FileSystemAdapter/);
  assert.doesNotMatch(code, /from\s+["']obsidian["']/, "must stay Obsidian-API-free — pure data logic only");
  assert.doesNotMatch(code, /:\s*any\b/, "no `: any` type annotation");
  assert.doesNotMatch(code, /as\s+any\b/);
  assert.doesNotMatch(code, /@ts-ignore/);
  assert.doesNotMatch(code, /@ts-expect-error/);
  assert.doesNotMatch(code, /eslint-disable/);
});

test("RESEARCH_ORDER_DRAG_MIME is a distinct MIME string, never the file-move MIME", () => {
  assert.equal(typeof RESEARCH_ORDER_DRAG_MIME, "string");
  assert.notEqual(RESEARCH_ORDER_DRAG_MIME, "application/x-feuillets-file");
  assert.notEqual(RESEARCH_ORDER_DRAG_MIME, "text/plain");
});
