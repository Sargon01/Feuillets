import test from "node:test";
import assert from "node:assert/strict";
import { Menu } from "obsidian";
import { buildLayoutDirectiveMenu } from "../src/ui/layout-directive-menu.js";
import { t } from "../src/i18n/index.js";

test("layout submenu: page break has an active check and acts immediately", async () => {
  const menu = new Menu();
  let calls = 0;
  const update = buildLayoutDirectiveMenu(menu, false, { pageBreak: async () => { calls++; }, answer: () => {} });
  const action = menu.items[0].submenu.items[0];
  assert.equal(action.disabled, true);
  update({ pagination: true });
  assert.equal(action.checked, true);
  assert.equal(action.disabled, false);
  await action.click();
  assert.equal(calls, 1);
});

test("layout submenu: compatible questions retain the existing answer modal action", () => {
  const menu = new Menu();
  let calls = 0;
  const update = buildLayoutDirectiveMenu(menu, true, { pageBreak: async () => {}, answer: () => { calls++; } });
  update({ pagination: false });
  menu.items[0].submenu.items.find((item) => item.title === t("editorMenu.layout.answerArea")).click();
  assert.equal(calls, 1);
});

test("layout submenu: optional native API has a functional labelled fallback", async () => {
  class FlatMenu extends Menu {
    addItem(callback) { return super.addItem((item) => { delete item.setSubmenu; callback(item); }); }
  }
  const menu = new FlatMenu();
  let calls = 0;
  const update = buildLayoutDirectiveMenu(menu, true, { pageBreak: async () => { calls++; }, answer: () => {} });
  update({ pagination: true });
  const action = menu.items.find((item) => item.title.endsWith(t("modal.layoutDirective.pageBreakBefore")));
  assert.equal(action.checked, true);
  await action.click();
  assert.equal(calls, 1);
  assert.ok(menu.items.find((item) => item.title.endsWith(t("editorMenu.layout.answerArea"))));
});

test("layout submenu: all paragraph choices are checked independently and apply exact patches", async () => {
  const menu = new Menu();
  const patches = [];
  const update = buildLayoutDirectiveMenu(menu, false, { pageBreak: async () => {}, answer: () => {}, property: async (patch) => { patches.push(patch); } }, true);
  update({ pagination: true, paragraph: { alignment: "center", firstLineIndentPt: 0, spacingBeforePt: 6, spacingAfterPt: 12 } });
  const entries = menu.items[0].submenu.items;
  const groups = entries.slice(0, 3);
  assert.deepEqual(groups.map((entry) => entry.title), ["alignment", "indent", "spacing"].map((key) => t(`editorMenu.layout.${key}`)));
  const alignment = groups[0].submenu.items;
  assert.deepEqual(alignment.map((item) => item.checked), [false, false, true, false, false]);
  assert.deepEqual(groups[1].submenu.items.map((item) => item.checked), [false, true, false, false]);
  const [before, after] = groups[2].submenu.items.map((entry) => entry.submenu.items);
  assert.deepEqual(before.map((item) => item.checked), [false, false, true, false]);
  assert.deepEqual(after.map((item) => item.checked), [false, false, false, true]);
  await alignment[0].click(); await groups[1].submenu.items[3].click(); await before[1].click(); await after[2].click();
  assert.deepEqual(patches, [{ alignment: undefined }, { firstLineIndentPt: 18 }, { spacingBeforePt: 0 }, { spacingAfterPt: 6 }]);
  update({ pagination: false, paragraph: {} });
  for (const choices of [alignment, groups[1].submenu.items, before, after]) assert.deepEqual(choices.map((item) => item.checked), choices.map((_, index) => index === 0));
});

test("layout submenu: all typography options survive the flat fallback", async () => {
  class FlatMenu extends Menu { addItem(callback) { return super.addItem((item) => { delete item.setSubmenu; callback(item); }); } }
  const patches = [];
  const menu = new FlatMenu();
  const update = buildLayoutDirectiveMenu(menu, false, { pageBreak: async () => {}, answer: () => {}, property: async (patch) => { patches.push(patch); } }, true);
  update({ pagination: false, paragraph: {} });
  assert.equal(menu.items.filter((item) => item.callback).length, 18);
  const after = menu.items.find((item) => item.title.includes(t("editorMenu.layout.after")) && item.title.endsWith(t("editorMenu.layout.points", { value: "6" })));
  await after.click();
  assert.deepEqual(patches, [{ spacingAfterPt: 6 }]);
});
