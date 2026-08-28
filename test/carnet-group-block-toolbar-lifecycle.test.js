import test from "node:test";
import assert from "node:assert/strict";
import {
  renderGroupBlockToolbar,
  removeGroupBlockToolbar,
  isGroupBlockNode,
  findGroupBlockNode,
  groupBlockMemberNodes,
} from "../src/carnet/blocks/shared/native-group-block.js";

/* Prompt 4, §9 — LIFECYCLE de la toolbar de groupe (Relations/Généalogie) :
 * un seul renderer par groupe, refresh sans duplication, cleanup complet,
 * bloc invalide/inconnu → fail closed sans jamais muter le JSON. */

class FakeEl {
  constructor(tag = "div", options = {}) {
    this.tag = tag;
    this.children = [];
    this.classes = new Set(String(options.cls || "").split(" ").filter(Boolean));
    this.attrs = { ...(options.attr || {}) };
    this.dataset = {};
    this.events = new Map();
    this.disabled = false;
    this.removed = false;
  }
  createEl(tag, options = {}) { const c = new FakeEl(tag, options); this.children.push(c); return c; }
  createDiv(options = {}) { return this.createEl("div", options); }
  addClass(c) { this.classes.add(c); }
  removeClass(c) { this.classes.delete(c); }
  empty() { this.children = []; }
  remove() { this.removed = true; }
  querySelector(selector) {
    const cls = selector.replace(/^\./, "");
    const walk = (el) => {
      for (const child of el.children) {
        if (child.classes.has(cls) && !child.removed) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
  addEventListener(type, cb) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(cb);
  }
}

function sampleButtons(onAdd) {
  return [
    { id: "add", icon: "file-plus", label: "Ajouter des fiches", onClick: onAdd || (() => {}) },
    { id: "reorganize", icon: "layout-grid", label: "Réorganiser", onClick: () => {} },
  ];
}

test("refresh sans duplication — plusieurs rendus successifs retrouvent la MÊME barre, jamais empilée", () => {
  const host = new FakeEl();
  renderGroupBlockToolbar(host, sampleButtons());
  renderGroupBlockToolbar(host, sampleButtons());
  renderGroupBlockToolbar(host, sampleButtons());
  const bars = host.children.filter((c) => c.classes.has("feuillets-group-block-toolbar"));
  assert.equal(bars.length, 1, "une seule barre, jamais empilée");
  assert.equal(bars[0].children.length, 2, "toujours exactement les boutons demandés, jamais dupliqués");
});

test("refresh — les écouteurs de LA BARRE elle-même ne sont posés qu'UNE fois (jamais réempilés à chaque refresh)", () => {
  const host = new FakeEl();
  renderGroupBlockToolbar(host, sampleButtons());
  renderGroupBlockToolbar(host, sampleButtons());
  const bar = host.querySelector(".feuillets-group-block-toolbar");
  assert.equal(bar.events.get("pointerdown")?.length, 1, "un seul stopPropagation posé sur la barre, pas un par refresh");
});

test("refresh — les boutons sont reconstruits à chaque appel (le SET peut changer : sélection différente, etc.)", () => {
  const host = new FakeEl();
  renderGroupBlockToolbar(host, sampleButtons());
  renderGroupBlockToolbar(host, [sampleButtons()[0]]); // un seul bouton cette fois
  const bar = host.querySelector(".feuillets-group-block-toolbar");
  assert.equal(bar.children.length, 1, "le contenu suit le dernier appel, aucun résidu de l'ancien set");
});

test("cleanup — removeGroupBlockToolbar retire la barre entièrement, idempotent", () => {
  const host = new FakeEl();
  renderGroupBlockToolbar(host, sampleButtons());
  removeGroupBlockToolbar(host);
  assert.equal(host.querySelector(".feuillets-group-block-toolbar"), null);
  // Un second cleanup ne doit jamais planter (fichier Canvas fermé →
  // aucun listener résiduel, aucune erreur si déjà propre).
  assert.doesNotThrow(() => removeGroupBlockToolbar(host));
});

test("un clic déclenche exactement l'action du bouton cliqué, jamais les autres", () => {
  const host = new FakeEl();
  let addCalls = 0;
  let reorganizeCalls = 0;
  renderGroupBlockToolbar(host, [
    { id: "add", icon: "file-plus", label: "Ajouter", onClick: () => { addCalls += 1; } },
    { id: "reorganize", icon: "layout-grid", label: "Réorganiser", onClick: () => { reorganizeCalls += 1; } },
  ]);
  const bar = host.querySelector(".feuillets-group-block-toolbar");
  const addButton = bar.children.find((c) => c.dataset.toolbarId === "add");
  for (const cb of addButton.events.get("click") || []) cb({ stopPropagation() {} });
  assert.equal(addCalls, 1);
  assert.equal(reorganizeCalls, 0);
});

test("un bouton désactivé n'appelle jamais son action", () => {
  const host = new FakeEl();
  let calls = 0;
  renderGroupBlockToolbar(host, [{ id: "reorganize", icon: "layout-grid", label: "Réorganiser", disabled: true, onClick: () => { calls += 1; } }]);
  const button = host.querySelector(".feuillets-group-block-toolbar").children[0];
  assert.equal(button.disabled, true);
  for (const cb of button.events.get("click") || []) cb({ stopPropagation() {} });
  assert.equal(calls, 0);
});

/* ---- Bloc invalide/inconnu → fail closed, JSON préservé (§9) ---- */

test("un feuillets_block de type INCONNU n'est jamais reconnu comme un groupe géré", () => {
  const canvas = {
    nodes: [
      { id: "grp", type: "group", feuillets_block: "some-future-block-type", feuillets_block_version: 1, feuillets_block_id: "b1" },
      { id: "m1", type: "file", file: "F/A.md", feuillets_block_id: "b1" },
    ],
    edges: [],
  };
  const before = JSON.stringify(canvas);
  assert.equal(isGroupBlockNode(canvas.nodes[0], "relations"), false);
  assert.equal(isGroupBlockNode(canvas.nodes[0], "genealogy"), false);
  assert.equal(findGroupBlockNode(canvas, "relations", "b1"), null);
  assert.equal(findGroupBlockNode(canvas, "genealogy", "b1"), null);
  // Les membres restent lisibles par block_id (indépendant du type précis
  // du groupe), mais AUCUNE fonction ci-dessus n'a muté quoi que ce soit.
  assert.deepEqual(groupBlockMemberNodes(canvas, "b1").map((n) => n.id), ["m1"]);
  assert.equal(JSON.stringify(canvas), before, "JSON strictement préservé");
});

test("un groupe SANS feuillets_block_id (bloc corrompu/partiel) est ignoré, jamais planté", () => {
  const canvas = { nodes: [{ id: "grp", type: "group", feuillets_block: "relations", feuillets_block_version: 1 }], edges: [] };
  assert.equal(isGroupBlockNode(canvas.nodes[0], "relations"), false, "block_id manquant : jamais reconnu");
  assert.doesNotThrow(() => findGroupBlockNode(canvas, "relations", "anything"));
});
