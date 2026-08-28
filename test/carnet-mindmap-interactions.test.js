import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import {
  resolveEnterAction,
  resolveTabAction,
  resolveShiftTabAction,
  canReparentByDrop,
  toggleMindmapCollapse,
  computeMindmapVisibility,
} from "../src/carnet/blocks/mindmap/interactions.js";
import {
  createMindmapBlock,
  addMindmapChild,
  addMindmapSibling,
  outdentMindmapNode,
  reparentMindmapNodeByDrop,
  toggleMindmapNodeCollapsed,
  toggleMindmapOrientation,
  mindmapOrientationOf,
  applyMindmapLayout,
  convertIdeaTreeBranchToMindmap,
} from "../src/carnet/blocks/mindmap/mindmap.js";
import { findMindmapGroup, findMindmapParent, findMindmapChildren, isMindmapMemberNode } from "../src/carnet/blocks/mindmap/model.js";
import { convertTextNodeToFileNode } from "../src/services/canvas-bridge.js";
import { createIdeaChild, isIdeaTreeEdge } from "../src/services/canvas-idea-tree.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import FeuilletsPlugin from "../src/main.js";

function freshCanvas() {
  return { nodes: [], edges: [] };
}

test("Enter frère — crée un frère juste après le node courant, jamais sur la racine", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Idée centrale" });
  assert.equal(resolveEnterAction(canvas, "b1", root.id), null, "la racine n'a pas de parent, donc pas de frère");

  const child = addMindmapChild(canvas, "b1", root.id, { text: "Enfant" });
  const action = resolveEnterAction(canvas, "b1", child.id);
  assert.deepEqual(action, { kind: "create-sibling", afterId: child.id, parentId: root.id });

  const sibling = addMindmapSibling(canvas, "b1", child.id, { text: "Frère" });
  assert.ok(sibling);
  assert.equal(findMindmapParent(canvas, "b1", sibling.id).id, root.id);
});

test("Tab enfant — toujours valide, y compris sur un node qui a déjà des enfants", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const action = resolveTabAction(canvas, "b1", root.id);
  assert.deepEqual(action, { kind: "create-child", parentId: root.id });

  const child1 = addMindmapChild(canvas, "b1", root.id, { text: "1" });
  const child2 = addMindmapChild(canvas, "b1", root.id, { text: "2" });
  assert.deepEqual(findMindmapChildren(canvas, "b1", root.id).map((n) => n.id).sort(), [child1.id, child2.id].sort());
  const grandchild = addMindmapChild(canvas, "b1", child1.id, { text: "1.1" });
  assert.ok(grandchild);
  assert.equal(findMindmapParent(canvas, "b1", grandchild.id).id, child1.id);
});

test("Shift+Tab outdent — reparente sous le grand-parent, refuse si pas de grand-parent", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const child = addMindmapChild(canvas, "b1", root.id, { text: "Enfant" });
  const grandchild = addMindmapChild(canvas, "b1", child.id, { text: "Petit-enfant" });

  assert.equal(resolveShiftTabAction(canvas, "b1", child.id), null, "le parent de child EST la racine : pas de grand-parent");
  assert.equal(outdentMindmapNode(canvas, "b1", child.id), false);

  const action = resolveShiftTabAction(canvas, "b1", grandchild.id);
  assert.deepEqual(action, { kind: "outdent", nodeId: grandchild.id, newParentId: root.id });
  assert.equal(outdentMindmapNode(canvas, "b1", grandchild.id), true);
  assert.equal(findMindmapParent(canvas, "b1", grandchild.id).id, root.id);
});

test("reparentage — dépose valide reparente réellement la branche", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const a = addMindmapChild(canvas, "b1", root.id, { text: "A" });
  const b = addMindmapChild(canvas, "b1", root.id, { text: "B" });
  assert.equal(reparentMindmapNodeByDrop(canvas, "b1", a.id, b.id), true);
  assert.equal(findMindmapParent(canvas, "b1", a.id).id, b.id);
});

test("reparent vers descendant interdit — refusé, aucune mutation", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const a = addMindmapChild(canvas, "b1", root.id, { text: "A" });
  const a1 = addMindmapChild(canvas, "b1", a.id, { text: "A1" });
  assert.equal(canReparentByDrop(canvas, "b1", a.id, a1.id), false);
  assert.equal(reparentMindmapNodeByDrop(canvas, "b1", a.id, a1.id), false);
  assert.equal(findMindmapParent(canvas, "b1", a.id).id, root.id, "aucune mutation après un refus");
});

test("autre Mindmap interdite — un node d'un AUTRE bloc n'est jamais une cible de reparentage", () => {
  const canvas = freshCanvas();
  const first = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine 1" });
  const second = createMindmapBlock(canvas, { blockId: "b2", centerX: 1000, centerY: 0, rootText: "Racine 2" });
  const child = addMindmapChild(canvas, "b1", first.root.id, { text: "Enfant" });
  assert.equal(canReparentByDrop(canvas, "b1", child.id, second.root.id), false);
  assert.equal(reparentMindmapNodeByDrop(canvas, "b1", child.id, second.root.id), false);
});

test("collapse persistant — bascule l'état sur le groupe, jamais de perte de données", () => {
  const canvas = freshCanvas();
  const { root, group } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const child = addMindmapChild(canvas, "b1", root.id, { text: "Enfant" });
  const grandchild = addMindmapChild(canvas, "b1", child.id, { text: "Petit-enfant" });

  assert.deepEqual(toggleMindmapCollapse(undefined, child.id), [child.id]);
  const after = toggleMindmapNodeCollapsed(canvas, "b1", child.id);
  assert.deepEqual(after, [child.id]);
  assert.deepEqual(findMindmapGroup(canvas, "b1").mindmapCollapsed, [child.id]);

  const visibility = computeMindmapVisibility(canvas, "b1", group.mindmapCollapsed);
  assert.ok(visibility.hiddenNodeIds.has(grandchild.id), "le petit-enfant est masqué");
  assert.equal(visibility.hiddenNodeIds.has(child.id), false, "le node replié lui-même reste visible (son contrôle de dépli)");
  assert.equal(canvas.nodes.some((n) => n.id === grandchild.id), true, "aucune suppression : le node existe toujours");
  assert.equal(canvas.edges.some((e) => e.toNode === grandchild.id), true, "aucune edge supprimée");

  // Re-bascule : redéplié.
  const restored = toggleMindmapNodeCollapsed(canvas, "b1", child.id);
  assert.deepEqual(restored, []);
});

test("cleanup idempotent — appliquer deux fois le même layout produit un résultat stable", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  addMindmapChild(canvas, "b1", root.id, { text: "A" });
  addMindmapChild(canvas, "b1", root.id, { text: "B" });
  assert.equal(applyMindmapLayout(canvas, "b1"), true);
  const snapshot = JSON.stringify(canvas);
  assert.equal(applyMindmapLayout(canvas, "b1"), true);
  assert.equal(JSON.stringify(canvas), snapshot, "un relayout répété sur un état inchangé ne bouge plus rien");
});

/* ================================================================
 * CONVERSION
 * ================================================================ */

test("conversion — TextNode → FileNode dans une Mindmap conserve feuillets_block_id et ses edges", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const child = addMindmapChild(canvas, "b1", root.id, { text: "Idée" });

  const converted = convertTextNodeToFileNode(child, "Projet/Manuscrit/Idée.md", "manuscript");
  const index = canvas.nodes.findIndex((n) => n.id === child.id);
  canvas.nodes[index] = converted;

  assert.equal(converted.feuillets_block_id, "b1", "le marqueur de bloc Mindmap survit à la conversion");
  assert.equal(isMindmapMemberNode(converted, "b1"), true);
  assert.equal(findMindmapParent(canvas, "b1", converted.id).id, root.id, "la relation structurelle est intacte après conversion");
  assert.equal(converted.x, child.x, "position conservée");
  assert.equal(converted.type, "file");
});

test("conversion — idea-tree existant → mindmap explicite, préserve nodes/positions/propriétés inconnues", () => {
  const canvas = freshCanvas();
  const root = { id: "root", type: "text", text: "Racine idea-tree", x: 10, y: 20, width: 260, height: 80, customProp: "conservé" };
  canvas.nodes.push(root);
  const child = createIdeaChild(canvas, "root", "Enfant idea-tree");
  assert.ok(child);

  const result = convertIdeaTreeBranchToMindmap(canvas, "root", "new-block-id");
  assert.deepEqual(result, { ok: true, blockId: "new-block-id" });

  const rootAfter = canvas.nodes.find((n) => n.id === "root");
  const childAfter = canvas.nodes.find((n) => n.id === child.id);
  assert.equal(rootAfter.feuillets_block_id, "new-block-id");
  assert.equal(childAfter.feuillets_block_id, "new-block-id");
  assert.equal(rootAfter.customProp, "conservé", "propriété inconnue préservée");
  assert.equal(findMindmapParent(canvas, "new-block-id", childAfter.id).id, "root");

  const convertedEdge = canvas.edges.find((e) => e.fromNode === "root" && e.toNode === childAfter.id);
  assert.equal(convertedEdge.feuillets_managed, "mindmap");
  assert.equal(isIdeaTreeEdge(convertedEdge), false, "l'edge convertie n'est plus reconnue comme idea-tree");
  assert.ok(findMindmapGroup_(canvas, "new-block-id"), "un groupe Mindmap a été créé autour de la branche");
});

function findMindmapGroup_(canvas, blockId) {
  return canvas.nodes.find((n) => n.type === "group" && n.feuillets_block_id === blockId);
}

test("conversion invalide — branche vide : aucune mutation", () => {
  const canvas = freshCanvas();
  const result = convertIdeaTreeBranchToMindmap(canvas, "does-not-exist", "block-x");
  assert.deepEqual(result, { ok: false, reason: "empty-branch" });
  assert.deepEqual(canvas.nodes, []);
  assert.deepEqual(canvas.edges, []);
});

/* ================================================================
 * NON-RÉGRESSION
 * ================================================================ */

test("non-régression — une edge Canvas libre proche du groupe reste intacte après collapse/layout", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const child = addMindmapChild(canvas, "b1", root.id, { text: "Enfant" });
  const outside = { id: "outside", type: "text", text: "Note libre", x: 5000, y: 5000, width: 200, height: 80 };
  canvas.nodes.push(outside);
  const freeEdge = { id: "free-edge", fromNode: root.id, toNode: outside.id };
  canvas.edges.push(freeEdge);

  toggleMindmapNodeCollapsed(canvas, "b1", root.id);
  applyMindmapLayout(canvas, "b1");

  assert.ok(canvas.edges.some((e) => e.id === "free-edge"), "l'edge libre n'est jamais supprimée");
  assert.ok(canvas.nodes.some((n) => n.id === "outside"), "le node libre n'est jamais touché");
  assert.equal(child.feuillets_block_id, "b1");
});

test("non-régression — un ancien idea-tree NON converti reste inchangé (edges idea-tree intactes)", () => {
  const canvas = freshCanvas();
  const root = { id: "root", type: "text", text: "Racine idea-tree", x: 0, y: 0, width: 260, height: 80 };
  canvas.nodes.push(root);
  const child = createIdeaChild(canvas, "root", "Enfant");
  const edgeBefore = JSON.stringify(canvas.edges.find((e) => e.toNode === child.id));

  // Une Mindmap complètement différente coexiste dans le même Canvas.
  createMindmapBlock(canvas, { blockId: "other-block", centerX: 2000, centerY: 0, rootText: "Autre Mindmap" });

  const edgeAfter = JSON.stringify(canvas.edges.find((e) => e.toNode === child.id));
  assert.equal(edgeAfter, edgeBefore, "l'arbre idea-tree existant n'est jamais touché par une Mindmap créée à côté");
});

/* ================================================================
 * ORIENTATION (Correctif Prompt 2 — mindmap.ts)
 * ================================================================ */

test("orientation — absence de champ = horizontal, toggle bascule vers vertical puis retour", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  addMindmapChild(canvas, "b1", root.id, { text: "A" });

  assert.equal(mindmapOrientationOf(canvas, "b1"), "horizontal", "aucun champ mindmapOrientation posé à la création : horizontal par défaut");

  const next = toggleMindmapOrientation(canvas, "b1");
  assert.equal(next, "vertical");
  assert.equal(mindmapOrientationOf(canvas, "b1"), "vertical");
  assert.equal(findMindmapGroup(canvas, "b1").mindmapOrientation, "vertical", "persisté sur le groupe");

  const back = toggleMindmapOrientation(canvas, "b1");
  assert.equal(back, "horizontal");
  assert.equal(mindmapOrientationOf(canvas, "b1"), "horizontal");
});

test("orientation verticale — la racine du bloc applique un layout où les enfants sont au-dessus/en-dessous (sides top/bottom)", () => {
  const canvas = freshCanvas();
  const { root, group } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const a = addMindmapChild(canvas, "b1", root.id, { text: "A" });
  addMindmapChild(canvas, "b1", root.id, { text: "B" });
  toggleMindmapOrientation(canvas, "b1");
  applyMindmapLayout(canvas, "b1");

  const rootAfter = canvas.nodes.find((n) => n.id === root.id);
  const aAfter = canvas.nodes.find((n) => n.id === a.id);
  assert.notEqual(aAfter.y, rootAfter.y, "les enfants sont décalés verticalement, pas seulement horizontalement");

  const edgeToA = canvas.edges.find((e) => e.toNode === a.id);
  assert.ok(["top", "bottom"].includes(edgeToA.fromSide), "orientation verticale : côtés top/bottom, jamais left/right");
  assert.ok(["top", "bottom"].includes(edgeToA.toSide));
  void group;
});

test("orientation verticale — parent centré sur ses enfants, aucun chevauchement", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const a = addMindmapChild(canvas, "b1", root.id, { text: "A" });
  const b = addMindmapChild(canvas, "b1", a.id, { text: "B" });
  const c = addMindmapChild(canvas, "b1", a.id, { text: "C" });
  toggleMindmapOrientation(canvas, "b1");
  applyMindmapLayout(canvas, "b1");

  const nodeA = canvas.nodes.find((n) => n.id === a.id);
  const nodeB = canvas.nodes.find((n) => n.id === b.id);
  const nodeC = canvas.nodes.find((n) => n.id === c.id);
  const centerB = nodeB.x + nodeB.width / 2;
  const centerC = nodeC.x + nodeC.width / 2;
  const centerA = nodeA.x + nodeA.width / 2;
  assert.ok(Math.abs(centerA - (centerB + centerC) / 2) < 1e-6, "A reste centré horizontalement sur B et C en orientation verticale");

  const rectsOverlap = (n1, n2) =>
    n1.x < n2.x + n2.width && n2.x < n1.x + n1.width && n1.y < n2.y + n2.height && n2.y < n1.y + n1.height;
  assert.equal(rectsOverlap(nodeB, nodeC), false, "B et C ne se chevauchent jamais");
});

test("orientation — changement bascule puis relayout persiste la géométrie ET le champ mindmapOrientation", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  addMindmapChild(canvas, "b1", root.id, { text: "A" });

  toggleMindmapOrientation(canvas, "b1");
  applyMindmapLayout(canvas, "b1");
  const persisted = JSON.parse(JSON.stringify(canvas));

  assert.equal(persisted.nodes.find((n) => n.type === "group").mindmapOrientation, "vertical");
});

test("orientation — drag et collapse restent valides en orientation verticale", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const a = addMindmapChild(canvas, "b1", root.id, { text: "A" });
  const b = addMindmapChild(canvas, "b1", root.id, { text: "B" });
  toggleMindmapOrientation(canvas, "b1");
  applyMindmapLayout(canvas, "b1");

  assert.equal(reparentMindmapNodeByDrop(canvas, "b1", b.id, a.id), true, "reparentage toujours fonctionnel en vertical");
  assert.equal(findMindmapParent(canvas, "b1", b.id).id, a.id);

  const collapsed = toggleMindmapNodeCollapsed(canvas, "b1", a.id);
  assert.deepEqual(collapsed, [a.id]);
  const visibility = computeMindmapVisibility(canvas, "b1", collapsed);
  assert.ok(visibility.hiddenNodeIds.has(b.id), "collapse fonctionne toujours en orientation verticale");
});

/* ================================================================
 * CONTRÔLE DOM REPLI/DÉPLI (Correctif Prompt 2 — decorateMindmapCanvasView, main.ts)
 * ================================================================ */

class FakeMindmapNodeEl {
  constructor() {
    this._classes = new Set();
    this._attrs = {};
    this._control = null;
    this.classList = {
      toggle: (cls, force) => {
        const has = this._classes.has(cls);
        const next = force === undefined ? !has : !!force;
        if (next) this._classes.add(cls); else this._classes.delete(cls);
      },
      contains: (cls) => this._classes.has(cls),
    };
  }
  createDiv({ cls } = {}) {
    const control = {
      _classes: new Set(cls ? cls.split(" ") : []),
      textContent: "",
      onclick: null,
      onpointerdown: null,
      setAttr(name, value) { this[`attr:${name}`] = value; },
      toggleClass(name, force) {
        const has = this._classes.has(name);
        const next = force === undefined ? !has : !!force;
        if (next) this._classes.add(name); else this._classes.delete(name);
      },
      remove: () => { this._control = null; },
    };
    this._control = control;
    return control;
  }
  querySelector(selector) {
    if (!this._control) return null;
    const cls = selector.replace(/^\./, "");
    return this._control._classes.has(cls) ? this._control : null;
  }
}

function buildMindmapPlugin() {
  const root = new TFolder("Projet");
  const manuscrit = new TFolder("Projet/Manuscrit"); manuscrit.parent = root;
  const { vault } = createFakeVault([root, manuscrit]);
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = { vault, workspace: { getLeavesOfType: () => [] } };
  plugin.settings = { projectFolder: manuscrit.path, projectMeta: {} };
  plugin.carnetLifecycle = { refresh() { plugin._refreshed = (plugin._refreshed || 0) + 1; } };
  return { plugin, vault };
}

function makeCanvasFixture(canvas) {
  const nodeEls = new Map();
  const nodes = new Map(canvas.nodes.map((node) => {
    const nodeEl = new FakeMindmapNodeEl();
    nodeEls.set(node.id, nodeEl);
    return [node.id, { id: node.id, nodeEl }];
  }));
  return {
    view: {
      canvas: {
        nodes,
        getData: () => canvas,
        setData: (updated) => { canvas.nodes = updated.nodes; canvas.edges = updated.edges; },
        requestSave: () => {},
      },
    },
    nodeEls,
  };
}

test("collapse DOM — un node avec enfants reçoit un contrôle, une feuille n'en reçoit pas", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const leaf = addMindmapChild(canvas, "b1", root.id, { text: "Feuille" });
  const { plugin } = buildMindmapPlugin();
  const { view, nodeEls } = makeCanvasFixture(canvas);

  plugin.decorateMindmapCanvasView(view);

  assert.ok(nodeEls.get(root.id).querySelector(".feuillets-mindmap-collapse-control"), "la racine (a un enfant) reçoit le contrôle");
  assert.equal(nodeEls.get(leaf.id).querySelector(".feuillets-mindmap-collapse-control"), null, "la feuille n'en reçoit aucun");
});

test("collapse DOM — refresh répété réutilise le MÊME contrôle (aucune duplication)", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  addMindmapChild(canvas, "b1", root.id, { text: "Enfant" });
  const { plugin } = buildMindmapPlugin();
  const { view, nodeEls } = makeCanvasFixture(canvas);

  plugin.decorateMindmapCanvasView(view);
  const first = nodeEls.get(root.id).querySelector(".feuillets-mindmap-collapse-control");
  plugin.decorateMindmapCanvasView(view);
  plugin.decorateMindmapCanvasView(view);
  const third = nodeEls.get(root.id).querySelector(".feuillets-mindmap-collapse-control");

  assert.equal(first, third, "le même élément DOM est réutilisé, jamais recréé");
});

test("collapse DOM — clic sur le contrôle persiste l'état et déclenche le refresh du lifecycle", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  addMindmapChild(canvas, "b1", root.id, { text: "Enfant" });
  const { plugin } = buildMindmapPlugin();
  const { view, nodeEls } = makeCanvasFixture(canvas);

  plugin.decorateMindmapCanvasView(view);
  const control = nodeEls.get(root.id).querySelector(".feuillets-mindmap-collapse-control");
  assert.equal(control.textContent, "⊖", "développé par défaut");

  control.onclick({ preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(findMindmapGroup(canvas, "b1").mindmapCollapsed, [root.id], "l'état replié est persisté sur le groupe");
  assert.equal(plugin._refreshed, 1, "le lifecycle est rafraîchi après le clic");
});

test("collapse DOM — un node qui perd tous ses enfants perd son contrôle au refresh suivant", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const child = addMindmapChild(canvas, "b1", root.id, { text: "Enfant" });
  const { plugin } = buildMindmapPlugin();
  const { view, nodeEls } = makeCanvasFixture(canvas);
  plugin.decorateMindmapCanvasView(view);
  assert.ok(nodeEls.get(root.id).querySelector(".feuillets-mindmap-collapse-control"));

  // L'unique relation structurelle root→child disparaît (branche détachée
  // via le modèle, déjà testé ailleurs) : root n'a plus aucun enfant.
  const edgeIndex = canvas.edges.findIndex((e) => e.toNode === child.id);
  canvas.edges.splice(edgeIndex, 1);

  plugin.decorateMindmapCanvasView(view);
  assert.equal(nodeEls.get(root.id).querySelector(".feuillets-mindmap-collapse-control"), null, "le contrôle disparaît quand il n'y a plus d'enfant");
});

/* ================================================================
 * RESTAURATION À LA RÉOUVERTURE (correctif « persistance »)
 * ================================================================ */

test("réouverture — runtime Canvas pas encore chargé : la décoration est replanifiée, pas abandonnée", () => {
  const canvas = freshCanvas();
  const { root } = createMindmapBlock(canvas, { blockId: "b1", centerX: 0, centerY: 0, rootText: "Racine" });
  const child = addMindmapChild(canvas, "b1", root.id, { text: "Enfant" });
  const grandchild = addMindmapChild(canvas, "b1", child.id, { text: "Petit-enfant" });
  toggleMindmapNodeCollapsed(canvas, "b1", child.id);

  const { plugin } = buildMindmapPlugin();
  let frameCb = null;
  const originalRAF = globalThis.window?.requestAnimationFrame;
  globalThis.window = globalThis.window || {};
  globalThis.window.requestAnimationFrame = (cb) => { frameCb = cb; return 1; };
  try {
    // Le vrai cas : getData() renvoie déjà le JSON, mais canvas.nodes est
    // encore vide (chargement asynchrone de la vue).
    const nodeEls = new Map();
    const nodesMap = new Map();
    const view = {
      canvas: {
        nodes: nodesMap,
        getData: () => canvas,
        setData: () => {},
        requestSave: () => {},
      },
    };
    let refreshed = 0;
    plugin.carnetLifecycle = { refresh() { refreshed += 1; } };

    plugin.decorateMindmapCanvasView(view);
    assert.ok(frameCb, "une frame de rattrapage est planifiée quand le runtime est vide");

    // La vue finit de charger : les instances runtime apparaissent.
    for (const n of canvas.nodes.filter((x) => x.type !== "group")) {
      const el = new FakeMindmapNodeEl();
      nodeEls.set(n.id, el);
      nodesMap.set(n.id, { id: n.id, nodeEl: el });
    }
    frameCb();
    assert.equal(refreshed, 1, "le refresh du lifecycle est bien rejoué après la frame");

    plugin.decorateMindmapCanvasView(view);
    assert.equal(
      nodeEls.get(grandchild.id).classList.contains("feuillets-mindmap-hidden"),
      true,
      "l'état replié persisté est enfin restauré visuellement"
    );
  } finally {
    if (originalRAF) globalThis.window.requestAnimationFrame = originalRAF;
  }
});

test("réouverture — un Canvas réellement vide ne boucle jamais indéfiniment", () => {
  const { plugin } = buildMindmapPlugin();
  let frames = 0;
  const originalRAF = globalThis.window?.requestAnimationFrame;
  globalThis.window = globalThis.window || {};
  globalThis.window.requestAnimationFrame = () => { frames += 1; return frames; };
  try {
    const view = { canvas: { nodes: new Map(), getData: () => ({ nodes: [], edges: [] }), setData: () => {}, requestSave: () => {} } };
    plugin.decorateMindmapCanvasView(view);
    assert.equal(frames, 0, "aucune replanification pour un Canvas sans node");
  } finally {
    if (originalRAF) globalThis.window.requestAnimationFrame = originalRAF;
  }
});
