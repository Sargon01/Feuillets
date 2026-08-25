import assert from "node:assert/strict";
import test from "node:test";
import { LayoutEditor } from "../src/ui/layout-editor.js";

const plugin = { settings: {}, saveSettings: async () => {} };

function editor(options = {}) {
  return new LayoutEditor({}, plugin, null, "classique", { mode: "workspace", workspaceNavigation: "summary", ...options });
}

test("LayoutEditor restaure une page summary initiale profonde", () => {
  assert.equal(editor({ initialSummaryPage: "page" }).summaryPage, "page");
  assert.equal(editor({ initialSummaryPage: "page-format" }).summaryPage, "page-format");
  assert.equal(editor().summaryPage, "home");
  assert.equal(editor({ initialSummaryPage: "slides" }).summaryPage, "slides");
});

test("LayoutEditor remonte chaque navigation explicite, y compris le retour", () => {
  const pages = [];
  const instance = editor({ onSummaryPageChange: (page) => pages.push(page) });
  instance.setSummaryPage("page");
  instance.setSummaryPage("home");
  assert.deepEqual(pages, ["page", "home"]);
});

test("une recréation reçoit la page conservée par le parent sans persistance", () => {
  let current = "home";
  const first = editor({ initialSummaryPage: current, onSummaryPageChange: (page) => { current = page; } });
  first.setSummaryPage("page");
  const recreated = editor({ initialSummaryPage: current });
  assert.equal(recreated.summaryPage, "page");
  assert.equal(Object.prototype.hasOwnProperty.call(plugin.settings, "layoutSummaryPage"), false);
});

test("Diapos revient au sommaire et conserve la page après recréation", () => {
  let current = "home";
  const first = editor({ initialSummaryPage: current, onSummaryPageChange: (page) => { current = page; } });
  first.setSummaryPage("slides");
  assert.equal(current, "slides");
  const recreated = editor({ initialSummaryPage: current });
  assert.equal(recreated.summaryPage, "slides");
  recreated.setSummaryPage("home");
  assert.equal(recreated.summaryPage, "home");
});
