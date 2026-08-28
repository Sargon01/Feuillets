import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import {
  PLAN_MARKER,
  PLAN_MODEL_VERSION,
  migrateLegacyPlanItems,
  findPlanNode,
  readPlanState,
  writePlanState,
  createPlanNode,
  planFallbackText,
  markPlanDirty,
  reconcilePlanAfterApply,
  countRealPlanItems,
} from "../src/carnet/blocks/plan/plan.js";
import { flattenPlan } from "../src/carnet/blocks/plan/model.js";
import { readBinderSnapshot, binderFingerprint, planFromBinderSnapshot } from "../src/carnet/bridges/binder.js";

/* Node Plan dans le Canvas (Prompt 3/5, §12/§13). */

/** Ancien Plan tel qu'écrit par le prototype : `id` = path, kinds
 * `new-folder`/`new-file`. */
const legacy = [
  { id: "M/Partie 1", kind: "folder", title: "Partie 1", path: "M/Partie 1", collapsed: true, children: [
    { id: "M/Partie 1/a.md", kind: "file", title: "Scène A", path: "M/Partie 1/a.md", collapsed: false, children: [] },
  ] },
  { id: "uuid-legacy", kind: "new-folder", title: "Brouillon dossier", collapsed: false, children: [
    { id: "uuid-legacy-2", kind: "new-file", title: "Brouillon feuille", collapsed: false, children: [] },
  ] },
];

test("§13 — migration : structure, repli et chemins préservés, UUID désormais indépendants du path", () => {
  const items = migrateLegacyPlanItems(legacy);

  assert.deepEqual(items.map((i) => [i.kind, i.title, i.path]), [
    ["folder", "Partie 1", "M/Partie 1"],
    ["draft-folder", "Brouillon dossier", undefined],
  ]);
  assert.equal(items[0].collapsed, true, "repli préservé");
  assert.equal(items[0].children[0].path, "M/Partie 1/a.md", "chemin préservé");
  assert.equal(items[1].kind, "draft-folder", "new-folder devient draft-folder");
  assert.equal(items[1].children[0].kind, "draft-file", "new-file devient draft-file");

  for (const item of flattenPlan(items)) {
    assert.notEqual(item.id, item.path, "l'UUID n'est JAMAIS le chemin");
    assert.match(item.id, /^[0-9a-f-]{36}$/i, "vrai UUID");
  }
});

test("§13 — migration : un item sans chemin redevient un draft quoi qu'en dise son ancien kind", () => {
  const items = migrateLegacyPlanItems([{ id: "x", kind: "folder", title: "Sans chemin", collapsed: false, children: [] }]);
  assert.equal(items[0].kind, "draft-file", "sans chemin ni enfant : brouillon de feuillet");
  const withKids = migrateLegacyPlanItems([{ id: "y", kind: "folder", title: "Sans chemin", collapsed: false, children: [{ id: "z", kind: "file", title: "K", collapsed: false, children: [] }] }]);
  assert.equal(withKids[0].kind, "draft-folder", "sans chemin mais avec enfants : brouillon de dossier");
});

test("§13 — migration : entrée absente ou invalide ne lève jamais", () => {
  assert.deepEqual(migrateLegacyPlanItems(undefined), []);
  assert.deepEqual(migrateLegacyPlanItems("pas un tableau"), []);
  assert.deepEqual(migrateLegacyPlanItems([null, 42]), []);
});

test("§13 — un node de l'ancien format est lu et migré sans être réécrit", () => {
  const node = {
    id: "plan", type: "text",
    feuillets_binder_plan: PLAN_MARKER,
    feuillets_binder_root: "M",
    feuillets_binder_items: legacy,
    feuillets_binder_fingerprint: "fp",
    feuillets_binder_dirty: false,
  };
  const state = readPlanState(node);

  assert.equal(state.rootPath, "M");
  assert.equal(state.baseFingerprint, "fp");
  assert.equal(state.items.length, 2);
  assert.equal(state.items[0].kind, "folder");
  assert.deepEqual(node.feuillets_binder_items, legacy, "l'ancienne clé n'est jamais modifiée à la lecture");
});

test("un node déjà au nouveau format est relu tel quel, sans re-migration", () => {
  const node = { id: "plan", type: "text", feuillets_binder_plan: PLAN_MARKER };
  const items = migrateLegacyPlanItems(legacy);
  writePlanState(node, { rootPath: "M", items, baseFingerprint: "fp", dirty: false });

  assert.equal(node.feuillets_plan_version, PLAN_MODEL_VERSION);
  const reread = readPlanState(node);
  assert.deepEqual(reread.items.map((i) => i.id), items.map((i) => i.id), "les UUID survivent à l'aller-retour");
});

test("un seul Plan par Carnet — plusieurs cartes = conflit signalé, jamais un choix arbitraire", () => {
  const plan = { id: "a", feuillets_binder_plan: PLAN_MARKER };
  assert.equal(findPlanNode({ nodes: [], edges: [] }), null);
  assert.equal(findPlanNode({ nodes: [plan], edges: [] }), plan);
  assert.equal(findPlanNode({ nodes: [plan, { id: "b", feuillets_binder_plan: PLAN_MARKER }], edges: [] }), "conflict");
});

test("§12 — le repli texte reste lisible et signale l'état sale", () => {
  const items = migrateLegacyPlanItems(legacy);
  const clean = planFallbackText({ rootPath: "M", items, baseFingerprint: "", dirty: false });
  assert.match(clean, /Plan du manuscrit\n▾ Partie 1\n {2}• Scène A/);
  assert.doesNotMatch(clean, /Plan du manuscrit •/);
  const dirty = planFallbackText({ rootPath: "M", items, baseFingerprint: "", dirty: true });
  assert.match(dirty, /Plan du manuscrit •/);
});

test("createPlanNode — carte 520×620 à hauteur fixe, jamais d'edge", () => {
  const canvas = { nodes: [], edges: [] };
  const node = createPlanNode(canvas, "plan", { rootPath: "M", items: [], baseFingerprint: "fp", dirty: false });
  assert.equal(node.width, 520);
  assert.equal(node.height, 620);
  assert.equal(node.dynamicHeight, false);
  assert.equal(node.feuillets_binder_plan, PLAN_MARKER);
  assert.equal(canvas.edges.length, 0);
});

test("markPlanDirty — toute édition rend le Plan sale (§8)", () => {
  const state = { rootPath: "M", items: [], baseFingerprint: "fp", dirty: false };
  assert.equal(markPlanDirty(state, []).dirty, true);
  assert.equal(state.dirty, false, "l'état d'origine n'est jamais muté");
});

test("§10 — après Apply, les chemins sont réalignés, les UUID préservés, le Plan redevient propre", () => {
  const root = new TFolder("M");
  const folder = new TFolder("M/Partie Un"); folder.parent = root;
  const file = new TFile("M/Partie Un/a.md"); file.parent = folder;
  root.children = [folder]; folder.children = [file];
  const reader = { getOrderedChildren: (f) => f.children, shortTitleFor: () => "Scène A" };
  const snapshot = readBinderSnapshot(reader, root);

  // Plan d'avant l'Apply : mêmes items, mais chemins périmés (dossier
  // renommé « Partie 1 » → « Partie Un » par l'Apply).
  const before = planFromBinderSnapshot(snapshot).map((i) => ({ ...i, path: "M/Partie 1", children: i.children.map((c) => ({ ...c, path: "M/Partie 1/a.md" })) }));
  const ids = flattenPlan(before).map((i) => i.id);

  const state = reconcilePlanAfterApply(before, snapshot, binderFingerprint(snapshot), "M");

  assert.equal(state.dirty, false);
  assert.equal(state.baseFingerprint, binderFingerprint(snapshot));
  assert.deepEqual(flattenPlan(state.items).map((i) => i.path), ["M/Partie Un", "M/Partie Un/a.md"]);
  assert.deepEqual(flattenPlan(state.items).map((i) => i.id), ids, "les UUID survivent au changement de path");
  assert.equal(countRealPlanItems(state.items), 2);
});

test("ergonomie — la hauteur dynamique est réimposée à chaque écriture (la carte ne doit jamais se replier)", () => {
  const node = { id: "plan", type: "text", feuillets_binder_plan: PLAN_MARKER, dynamicHeight: true, width: 700, height: 400 };
  writePlanState(node, { rootPath: "M", items: [], baseFingerprint: "fp", dirty: false });
  assert.equal(node.dynamicHeight, false, "jamais de hauteur déduite du texte de repli");
  assert.equal(node.width, 700, "une taille choisie par l'autrice est respectée");
  assert.equal(node.height, 400);
});

test("ergonomie — une carte écrasée est ramenée à une taille utilisable", () => {
  const node = { id: "plan", type: "text", feuillets_binder_plan: PLAN_MARKER, width: 40, height: 20 };
  writePlanState(node, { rootPath: "M", items: [], baseFingerprint: "fp", dirty: false });
  assert.equal(node.width, 520);
  assert.equal(node.height, 620);
});
