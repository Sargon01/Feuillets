import test from "node:test";
import assert from "node:assert/strict";

const isCompiledTest = import.meta.url.includes("/.test-dist/");
const compiledPath = (path) => new URL(`../${path}`, import.meta.url).href;
const { default: FeuilletsPlugin } = await import(compiledPath(isCompiledTest ? "src/main.js" : ".test-dist/src/main.js"));
const { VIEW_SIDEBAR, VIEW_SIDEBAR_FEUILLETS } = await import(compiledPath(isCompiledTest ? "src/constants.js" : ".test-dist/src/constants.js"));

function createBinderLeaf(calls, id) {
  return {
    view: {
      _stale: true,
      renderAllSubViews(force) { calls.push({ id, force }); },
    },
  };
}

test("refreshBinderViews rafraîchit toutes les vues Binder et ignore le panneau droit", () => {
  const requestedTypes = [];
  const binderCalls = [];
  const sidebarCalls = { render: 0, renderAllSubViews: 0 };
  const binderLeaves = [createBinderLeaf(binderCalls, "left-1"), createBinderLeaf(binderCalls, "left-2")];
  const sidebarLeaf = {
    view: {
      render() { sidebarCalls.render += 1; },
      renderAllSubViews() { sidebarCalls.renderAllSubViews += 1; },
    },
  };
  const workspace = {
    getLeavesOfType(type) {
      requestedTypes.push(type);
      if (type === VIEW_SIDEBAR) return binderLeaves;
      if (type === VIEW_SIDEBAR_FEUILLETS) return [sidebarLeaf];
      return [];
    },
  };
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { workspace };
  plugin.leafVisible = () => true;

  plugin.refreshBinderViews();

  assert.deepEqual(requestedTypes, [VIEW_SIDEBAR]);
  assert.deepEqual(binderCalls, [
    { id: "left-1", force: false },
    { id: "left-2", force: false },
  ]);
  assert.equal(binderLeaves[0].view._stale, false);
  assert.equal(binderLeaves[1].view._stale, false);
  assert.equal(sidebarCalls.render, 0);
  assert.equal(sidebarCalls.renderAllSubViews, 0);
});
