import assert from "node:assert/strict";
import test from "node:test";
import { t } from "../src/i18n/index.js";
import { VIEW_PROJECT } from "../src/constants.js";
import { ProjectView } from "../src/views/project-view.js";

function createView() {
  const calls = { pages: [], detach: 0 };
  const leaf = {
    app: {},
    contentEl: {},
    detach() { calls.detach += 1; },
  };
  const plugin = {
    async activateEditionPage(page) { calls.pages.push(page); },
  };
  return { view: new ProjectView(leaf, plugin), calls };
}

test("ProjectView : le type historique reste enregistré pour restaurer les workspaces existants", () => {
  const { view } = createView();
  assert.equal(view.getViewType(), VIEW_PROJECT);
  assert.equal(view.getDisplayText(), t("sidebar.tab.edition"));
  assert.equal(view.getIcon(), "book-open");
});

test("ProjectView : à l'ouverture, redirige vers Édition puis retire la leaf héritée", async () => {
  const { view, calls } = createView();
  await view.onOpen();
  assert.deepEqual(calls.pages, ["home"]);
  assert.equal(calls.detach, 1);
});
