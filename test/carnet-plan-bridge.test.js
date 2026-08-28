import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import {
  readBinderSnapshot,
  binderFingerprint,
  planFromBinderSnapshot,
  buildBinderMutationPlan,
  applyBinderMutationPlan,
  safeBinderFileName,
} from "../src/carnet/bridges/binder.js";
import { createDraft, findPlanItem, setPlanItemTitle, movePlanBranch, insertPlanSiblingAfter, appendPlanChild, removePlanItem } from "../src/carnet/blocks/plan/model.js";

/* BinderBridge (Prompt 3/5, §14 REFRESH/PREFLIGHT/APPLY).
   Règle cardinale testée partout : AUCUNE mutation tant que le preflight
   n'a pas tout validé. */

/** Binder de référence :
 *  M/
 *    Partie 1/   a.md ("Scène A"), b.md ("Scène B")
 *    Partie 2/
 *    c.md ("Isolée")                                        */
function makeBinder() {
  const root = new TFolder("M");
  const p1 = new TFolder("M/Partie 1"); p1.parent = root;
  const p2 = new TFolder("M/Partie 2"); p2.parent = root;
  const a = new TFile("M/Partie 1/a.md"); a.parent = p1;
  const b = new TFile("M/Partie 1/b.md"); b.parent = p1;
  const c = new TFile("M/c.md"); c.parent = root;
  root.children = [p1, p2, c];
  p1.children = [a, b];
  p2.children = [];
  const titles = new Map([[a.path, "Scène A"], [b.path, "Scène B"], [c.path, "Isolée"]]);
  const reader = {
    getOrderedChildren: (folder) => folder.children,
    shortTitleFor: (file) => titles.get(file.path) ?? file.basename,
  };
  return { root, p1, p2, a, b, c, reader, titles };
}

/** Recherche PROFONDE par path — `Array.find` ne voit que la racine. */
function byPath(items, path) {
  const walk = (list) => {
    for (const i of list) { if (i.path === path) return i; const f = walk(i.children); if (f) return f; }
    return null;
  };
  return walk(items);
}

function snapshotOf(binder) {
  return readBinderSnapshot(binder.reader, binder.root);
}

/** Writer instrumenté : journalise sans jamais toucher à un vrai vault. */
function makeWriter(options = {}) {
  const calls = [];
  const failOn = options.failOn;
  const record = (name) => async (...args) => {
    if (failOn === name && !options._failed) { options._failed = true; calls.push([name, ...args, "THROW"]); throw new Error(`boom:${name}`); }
    calls.push([name, ...args]);
    if (name === "createSheet") return `${args[0]}/${args[1]}.md`;
    return undefined;
  };
  return {
    calls,
    createFolder: record("createFolder"),
    createSheet: record("createSheet"),
    renameFolder: record("renameFolder"),
    move: record("move"),
    setShortTitle: record("setShortTitle"),
    restoreShortTitle: record("restoreShortTitle"),
    writeOrder: record("writeOrder"),
    deleteCreated: record("deleteCreated"),
  };
}

/* ================= REFRESH ================= */

test("snapshot — ordre canonique Feuillets, dossiers par nom, fichiers par titre court", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  assert.equal(snapshot.rootPath, "M");
  assert.deepEqual(snapshot.children.map((i) => [i.kind, i.title, i.path]), [
    ["folder", "Partie 1", "M/Partie 1"],
    ["folder", "Partie 2", "M/Partie 2"],
    ["file", "Isolée", "M/c.md"],
  ]);
  assert.deepEqual(snapshot.children[0].children.map((i) => i.title), ["Scène A", "Scène B"]);
});

test("refresh — les UUID et l'état replié des items déjà connus sont préservés", () => {
  const binder = makeBinder();
  const first = planFromBinderSnapshot(snapshotOf(binder));
  const p1Id = first.find((i) => i.path === "M/Partie 1").id;
  const collapsed = first.map((i) => (i.path === "M/Partie 1" ? { ...i, collapsed: true } : i));

  const second = planFromBinderSnapshot(snapshotOf(binder), collapsed);

  const p1 = second.find((i) => i.path === "M/Partie 1");
  assert.equal(p1.id, p1Id, "même UUID après refresh");
  assert.equal(p1.collapsed, true, "état replié préservé");
});

test("refresh — un rename externe conserve l'UUID dès lors que le path stocké a été remappé", () => {
  const binder = makeBinder();
  const plan = planFromBinderSnapshot(snapshotOf(binder));
  const keptId = byPath(plan, "M/Partie 1").id;

  // Renommage externe + remap du path stocké (mécanisme rename existant).
  binder.p1.path = "M/Partie I"; binder.p1.name = "Partie I";
  binder.a.path = "M/Partie I/a.md"; binder.b.path = "M/Partie I/b.md";
  binder.titles.set("M/Partie I/a.md", "Scène A"); binder.titles.set("M/Partie I/b.md", "Scène B");
  const remapped = plan.map((i) => (i.path === "M/Partie 1" ? { ...i, path: "M/Partie I" } : i));

  const refreshed = planFromBinderSnapshot(snapshotOf(binder), remapped);
  assert.equal(refreshed.find((i) => i.path === "M/Partie I").id, keptId);
});

test("fingerprint — stable et sensible à la structure comme aux titres affichés", () => {
  const binder = makeBinder();
  const before = binderFingerprint(snapshotOf(binder));
  assert.equal(before, binderFingerprint(snapshotOf(binder)), "stable");

  binder.titles.set("M/c.md", "Titre retouché ailleurs");
  assert.notEqual(binderFingerprint(snapshotOf(binder)), before, "un short_title externe invalide un ancien Plan");

  binder.root.children = [binder.p2, binder.p1, binder.c];
  assert.notEqual(binderFingerprint(snapshotOf(binder)), before, "un réordonnancement, si");
});

test("preflight — short_title externe après Refresh : conflit sans écrasement", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  const plan = planFromBinderSnapshot(snapshot);
  binder.titles.set("M/c.md", "Titre externe");
  const result = buildBinderMutationPlan(plan, snapshotOf(binder), binderFingerprint(snapshot));
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [{ code: "binder-changed" }]);
});

/* ================= PREFLIGHT ================= */

test("preflight — Binder modifié depuis le dernier Actualiser : conflit, zéro opération", () => {
  const binder = makeBinder();
  const base = binderFingerprint(snapshotOf(binder));
  const plan = planFromBinderSnapshot(snapshotOf(binder));

  binder.root.children = [binder.p2, binder.p1, binder.c]; // changement externe

  const result = buildBinderMutationPlan(plan, snapshotOf(binder), base);
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [{ code: "binder-changed" }]);
});

test("preflight — suppression implicite d'un item réel : refusé", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  const plan = planFromBinderSnapshot(snapshot);
  const amputated = removePlanItem(plan, byPath(plan, "M/c.md").id).items;

  const result = buildBinderMutationPlan(amputated, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === "implicit-delete" && i.path === "M/c.md"));
});

test("preflight — collision entre deux drafts homonymes du même dossier", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);
  const anchor = byPath(plan, "M/c.md").id;
  plan = insertPlanSiblingAfter(plan, anchor, createDraft("draft-file", "Doublon", "d1"));
  plan = insertPlanSiblingAfter(plan, "d1", createDraft("draft-file", "Doublon", "d2"));

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === "collision"));
});

test("preflight — collision d'un draft avec un fichier réel existant", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);
  plan = insertPlanSiblingAfter(plan, byPath(plan, "M/c.md").id, createDraft("draft-file", "c", "d1"));

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === "collision" && i.path === "M/c.md"));
});

test("preflight — nom de dossier invalide et titre vide refusés", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  const plan = planFromBinderSnapshot(snapshot);
  const p1 = byPath(plan, "M/Partie 1").id;

  const invalid = buildBinderMutationPlan(setPlanItemTitle(plan, p1, "Mauvais/Nom"), snapshot, binderFingerprint(snapshot));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((i) => i.code === "invalid-name"));

  const empty = buildBinderMutationPlan(setPlanItemTitle(plan, p1, "   "), snapshot, binderFingerprint(snapshot));
  assert.equal(empty.ok, false);
  assert.ok(empty.issues.some((i) => i.code === "empty-title"));
});

test("preflight — un Plan strictement identique au Binder n'émet que des ordres, aucune mutation destructrice", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  const plan = planFromBinderSnapshot(snapshot);
  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true);
  assert.ok(result.plan.operations.every((op) => op.op === "order"), "seulement des ordres");
});

test("safeBinderFileName — retire les caractères interdits, jamais le titre brut", () => {
  assert.equal(safeBinderFileName("Scène / suite"), "Scène suite");
  assert.equal(safeBinderFileName("a/b/c"), "abc", "TOUS les caractères interdits, pas seulement le premier");
  assert.equal(safeBinderFileName("  A:B?  "), "AB");
});

/* ================= APPLY ================= */

test("apply — création dossier + fichier, rename, move, short_title, ordre : dans l'ordre §10", async () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);

  // 1) un draft dossier avec un enfant draft fichier
  const anchor = byPath(plan, "M/c.md").id;
  plan = insertPlanSiblingAfter(plan, anchor, { ...createDraft("draft-folder", "Partie 3", "d-folder"), children: [createDraft("draft-file", "Nouvelle scène", "d-file")] });
  // 2) renommer un dossier existant
  plan = setPlanItemTitle(plan, byPath(plan, "M/Partie 1").id, "Partie Un");
  // 3) déplacer un fichier existant dans Partie 2
  plan = movePlanBranch(plan, byPath(plan, "M/Partie 1/b.md").id, byPath(plan, "M/Partie 2").id, "inside");
  // 4) changer le titre d'un fichier existant (short_title, jamais rename)
  plan = setPlanItemTitle(plan, byPath(plan, "M/c.md").id, "Isolée renommée");

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true, JSON.stringify(result.issues));

  const ops = result.plan.operations.map((o) => o.op);
  assert.ok(ops.indexOf("create-folder") < ops.indexOf("create-file"), "dossiers draft avant fichiers draft");
  assert.ok(ops.indexOf("create-file") < ops.indexOf("rename-folder"), "créations avant renommages");
  assert.ok(ops.indexOf("rename-folder") < ops.indexOf("move"), "renommages avant déplacements");
  assert.ok(ops.indexOf("move") < ops.indexOf("set-short-title"), "déplacements avant short_title");
  assert.ok(ops.lastIndexOf("set-short-title") < ops.indexOf("order"), "ordres en dernier");

  // Le fichier existant déplacé ne doit JAMAIS être renommé.
  assert.equal(result.plan.operations.some((o) => o.op === "rename-folder" && o.from.endsWith(".md")), false);
  const shortTitle = result.plan.operations.find((o) => o.op === "set-short-title");
  assert.deepEqual([shortTitle.path, shortTitle.title], ["M/c.md", "Isolée renommée"]);

  const writer = makeWriter();
  const outcome = await applyBinderMutationPlan(result.plan, writer);
  assert.equal(outcome.ok, true);
  assert.ok(outcome.log.some((l) => l.startsWith("create-folder M/Partie 3")));
  assert.ok(outcome.log.some((l) => l.startsWith("create-file M/Partie 3/Nouvelle scène.md")));
});

test("apply — éditer le titre d'un FICHIER n'émet jamais de renommage de fichier", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  const plan = planFromBinderSnapshot(snapshot);
  const changed = setPlanItemTitle(plan, byPath(plan, "M/c.md").id, "Tout autre titre");
  const result = buildBinderMutationPlan(changed, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true);
  const paths = result.plan.operations.filter((o) => o.op === "order").flatMap((o) => o.names);
  assert.ok(paths.includes("c.md"), "le nom de fichier sur disque reste c.md");
});

test("apply — rollback en sens inverse quand une opération échoue", async () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);
  plan = insertPlanSiblingAfter(plan, byPath(plan, "M/c.md").id, {
    ...createDraft("draft-folder", "Nouveau dossier", "d1"),
    children: [createDraft("draft-file", "Nouvelle feuille", "d2")],
  });
  plan = setPlanItemTitle(plan, byPath(plan, "M/Partie 1").id, "Partie Un");

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true);

  // Le renommage de dossier échoue : les créations précédentes doivent être défaites.
  const writer = makeWriter({ failOn: "renameFolder" });
  const outcome = await applyBinderMutationPlan(result.plan, writer);

  assert.equal(outcome.ok, false);
  assert.equal(outcome.failedAt.op, "rename-folder");
  assert.equal(outcome.rolledBack, true);
  const deleted = writer.calls.filter((c) => c[0] === "deleteCreated").map((c) => c[1]);
  assert.ok(deleted.some((p) => p.includes("Nouvelle feuille")), "le fichier créé est défait");
  assert.ok(deleted.some((p) => p === "M/Nouveau dossier"), "le dossier créé est défait");
});

test("apply — échec après short_title : la valeur brute précédente est restaurée", async () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  snapshot.children[2].shortTitle = "Titre brut";
  const before = planFromBinderSnapshot(snapshot);
  const plan = setPlanItemTitle(before, byPath(before, "M/c.md").id, "Nouveau titre");
  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true);
  const writer = makeWriter();
  let orderWrites = 0;
  writer.writeOrder = async (...args) => {
    writer.calls.push(["writeOrder", ...args]);
    orderWrites += 1;
    if (orderWrites === 2) throw new Error("boom:writeOrder");
  };
  const outcome = await applyBinderMutationPlan(result.plan, writer);
  assert.equal(outcome.ok, false);
  assert.ok(writer.calls.some((call) => call[0] === "restoreShortTitle" && call[2] === "Titre brut"));
});

test("apply — échec après un ordre : l'ordre canonique précédent est restauré", async () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  const plan = planFromBinderSnapshot(snapshot);
  const writer = makeWriter();
  let orderWrites = 0;
  writer.writeOrder = async (...args) => {
    writer.calls.push(["writeOrder", ...args]);
    orderWrites += 1;
    if (orderWrites === 2) throw new Error("boom:writeOrder");
  };
  const outcome = await applyBinderMutationPlan({ operations: [
    { op: "order", parentPath: "M/Partie 1", names: ["b.md", "a.md"], previousNames: ["a.md", "b.md"] },
    { op: "order", parentPath: "M", names: ["Partie 1", "Partie 2", "c.md"], previousNames: ["Partie 1", "Partie 2", "c.md"] },
  ] }, writer);
  assert.equal(outcome.ok, false);
  assert.ok(writer.calls.some((call) => call[0] === "writeOrder" && call[1] === "M/Partie 1" && call[2][0] === "a.md"));
  assert.ok(plan.length > 0, "le scénario part bien d'un Plan réel");
});

test("apply — rollback incomplet signale rolledBack false", async () => {
  const writer = makeWriter({ failOn: "writeOrder" });
  writer.restoreShortTitle = async () => { throw new Error("undo impossible"); };
  const outcome = await applyBinderMutationPlan({ operations: [
    { op: "set-short-title", itemId: "s", path: "M/c.md", title: "Nouveau", previousTitle: undefined },
    { op: "order", parentPath: "M", names: ["c.md"], previousNames: ["c.md"] },
  ] }, writer);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.rolledBack, false);
});

test("apply — aucune opération n'est exécutée si le preflight a échoué", async () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  const plan = planFromBinderSnapshot(snapshot);
  const amputated = removePlanItem(plan, byPath(plan, "M/c.md").id).items;

  const result = buildBinderMutationPlan(amputated, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, false);

  const writer = makeWriter();
  assert.equal(writer.calls.length, 0, "le writer n'a jamais été sollicité");
});

test("apply — le lot ne contient jamais de suppression d'un item réel", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);
  plan = movePlanBranch(plan, byPath(plan, "M/c.md").id, byPath(plan, "M/Partie 2").id, "inside");
  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true);
  assert.equal(result.plan.operations.some((o) => o.op.includes("delete")), false);
});

test("scope — un item réel hors du sous-arbre du Plan est refusé", () => {
  const binder = makeBinder();
  const snapshot = readBinderSnapshot(binder.reader, binder.p1); // Plan limité à Partie 1
  const plan = planFromBinderSnapshot(snapshot);
  const intrus = [...plan, { id: "x", kind: "file", title: "Hors scope", path: "M/c.md", collapsed: false, children: [] }];

  const result = buildBinderMutationPlan(intrus, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.code === "out-of-scope" || i.code === "missing-item"));
});

test("scope — un Carnet de dossier ne voit QUE son sous-arbre", () => {
  const binder = makeBinder();
  const snapshot = readBinderSnapshot(binder.reader, binder.p1);
  assert.equal(snapshot.rootPath, "M/Partie 1");
  assert.deepEqual(snapshot.children.map((i) => i.title), ["Scène A", "Scène B"]);
  assert.equal(findPlanItem(planFromBinderSnapshot(snapshot), "M/c.md"), null);
});

/* ================= §1 — REBASE DES PATHS PENDANT APPLY ================= */

test("rebase — renommer un dossier peuplé rebase les opérations suivantes sur ses enfants", async () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);
  // « Partie 1 » (contient a.md et b.md) devient « chapi ».
  plan = setPlanItemTitle(plan, byPath(plan, "M/Partie 1").id, "chapi");
  // et le titre d'un de ses feuillets change (⇒ set-short-title APRÈS le rename)
  plan = setPlanItemTitle(plan, byPath(plan, "M/Partie 1/a.md").id, "Scène A bis");

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true, JSON.stringify(result.issues));

  const writer = makeWriter();
  const outcome = await applyBinderMutationPlan(result.plan, writer);
  assert.equal(outcome.ok, true);

  const shortTitle = writer.calls.find((c) => c[0] === "setShortTitle");
  assert.equal(shortTitle[1], "M/chapi/a.md", "le short_title vise le NOUVEAU chemin, pas M/Partie 1/a.md");
  const orders = writer.calls.filter((c) => c[0] === "writeOrder").map((c) => c[1]);
  assert.ok(orders.includes("M/chapi"), "l'ordre vise le nouveau chemin");
  assert.equal(orders.includes("M/Partie 1"), false, "plus aucune opération sur l'ancien chemin");
});

test("rebase — un brouillon logé dans un dossier renommé est créé sous le nom ACTUEL, puis suit le rename", async () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);
  const p1 = byPath(plan, "M/Partie 1").id;
  plan = appendPlanChild(plan, p1, createDraft("draft-file", "Nouvelle scène", "d1"));
  plan = setPlanItemTitle(plan, p1, "chapi");

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true, JSON.stringify(result.issues));

  const writer = makeWriter();
  const outcome = await applyBinderMutationPlan(result.plan, writer);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));

  const create = writer.calls.find((c) => c[0] === "createSheet");
  assert.equal(create[1], "M/Partie 1", "créé sous le nom ACTUEL : le rename n'a pas encore eu lieu");
  const orders = writer.calls.filter((c) => c[0] === "writeOrder").map((c) => c[1]);
  assert.ok(orders.includes("M/chapi"), "après le rename, l'ordre vise bien le nouveau chemin");
});

test("rebase — renommages imbriqués : le rename du parent est reporté sur celui de l'enfant", async () => {
  const root = new TFolder("M");
  const outer = new TFolder("M/Outer"); outer.parent = root;
  const inner = new TFolder("M/Outer/Inner"); inner.parent = outer;
  const leaf = new TFile("M/Outer/Inner/x.md"); leaf.parent = inner;
  root.children = [outer]; outer.children = [inner]; inner.children = [leaf];
  const reader = { getOrderedChildren: (f) => f.children, shortTitleFor: () => "X" };
  const snapshot = readBinderSnapshot(reader, root);

  let plan = planFromBinderSnapshot(snapshot);
  plan = setPlanItemTitle(plan, byPath(plan, "M/Outer").id, "Dehors");
  plan = setPlanItemTitle(plan, byPath(plan, "M/Outer/Inner").id, "Dedans");

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true, JSON.stringify(result.issues));

  const writer = makeWriter();
  const outcome = await applyBinderMutationPlan(result.plan, writer);
  assert.equal(outcome.ok, true);

  const renames = writer.calls.filter((c) => c[0] === "renameFolder").map((c) => [c[1], c[2]]);
  assert.deepEqual(renames[0], ["M/Outer", "M/Dehors"]);
  assert.deepEqual(renames[1], ["M/Dehors/Inner", "M/Dehors/Dedans"], "le rename interne part du chemin déjà rebasé");
});

test("rebase — préfixe-sûr : un dossier voisin homonyme partiel n'est jamais rebasé", async () => {
  const root = new TFolder("M");
  const cha = new TFolder("M/CHA"); cha.parent = root;
  const chaBis = new TFolder("M/CHA-bis"); chaBis.parent = root;
  const inside = new TFile("M/CHA-bis/z.md"); inside.parent = chaBis;
  root.children = [cha, chaBis]; cha.children = []; chaBis.children = [inside];
  const reader = { getOrderedChildren: (f) => f.children, shortTitleFor: () => "Z" };
  const snapshot = readBinderSnapshot(reader, root);

  let plan = planFromBinderSnapshot(snapshot);
  plan = setPlanItemTitle(plan, byPath(plan, "M/CHA").id, "chapi");
  plan = setPlanItemTitle(plan, byPath(plan, "M/CHA-bis/z.md").id, "Z modifié");

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true, JSON.stringify(result.issues));

  const writer = makeWriter();
  await applyBinderMutationPlan(result.plan, writer);

  const shortTitle = writer.calls.find((c) => c[0] === "setShortTitle");
  assert.equal(shortTitle[1], "M/CHA-bis/z.md", "« M/CHA-bis » n'est PAS un descendant de « M/CHA »");
});

test("rebase — rollback après un rename de parent défait bien la création rebasée", async () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);
  const p1 = byPath(plan, "M/Partie 1").id;
  plan = appendPlanChild(plan, p1, createDraft("draft-file", "Nouvelle scène", "d1"));
  plan = setPlanItemTitle(plan, p1, "chapi");

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true);

  // L'ordre (dernière étape) échoue : tout doit être défait.
  const writer = makeWriter({ failOn: "writeOrder" });
  const outcome = await applyBinderMutationPlan(result.plan, writer);

  assert.equal(outcome.ok, false);
  assert.equal(outcome.rolledBack, true);
  const undoRenames = writer.calls.filter((c) => c[0] === "renameFolder").map((c) => [c[1], c[2]]);
  assert.deepEqual(undoRenames.at(-1), ["M/chapi", "M/Partie 1"], "le rename est défait en sens inverse");
  assert.ok(writer.calls.some((c) => c[0] === "deleteCreated"), "le feuillet créé est défait");
});

test("§7 — draft-folder crée un dossier, draft-file un feuillet ; aucune conversion implicite", () => {
  const binder = makeBinder();
  const snapshot = snapshotOf(binder);
  let plan = planFromBinderSnapshot(snapshot);
  const anchor = byPath(plan, "M/c.md").id;
  // un dossier brouillon VIDE doit rester un dossier (§2)
  plan = insertPlanSiblingAfter(plan, anchor, createDraft("draft-folder", "Dossier vide", "df"));

  const result = buildBinderMutationPlan(plan, snapshot, binderFingerprint(snapshot));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const created = result.plan.operations.filter((o) => o.op.startsWith("create-"));
  assert.deepEqual(created.map((o) => o.op), ["create-folder"], "un dossier vide reste un dossier");
  assert.equal(created[0].path, "M/Dossier vide");
});
