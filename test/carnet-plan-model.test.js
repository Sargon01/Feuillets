import test from "node:test";
import assert from "node:assert/strict";
import {
  createDraft,
  canAcceptChildren,
  draftCreates,
  isPlanDraft,
  findPlanItem,
  findPlanParent,
  isPlanDescendant,
  flattenPlan,
  setPlanItemTitle,
  togglePlanItemCollapsed,
  removePlanDraft,
  insertPlanSiblingAfter,
  appendPlanChild,
  indentPlanItem,
  outdentPlanItem,
  movePlanItemWithinSiblings,
  canMovePlanBranch,
  movePlanBranch,
} from "../src/carnet/blocks/plan/model.js";

/* Modèle Plan (Prompt 3/5, §14 MODEL). Invariant vérifié partout :
   l'identité est l'UUID, jamais le path. */

const item = (id, kind, title, path, children = []) => ({ id, kind, title, path, collapsed: false, children });

function tree() {
  return [
    item("f1", "folder", "Partie 1", "M/Partie 1", [
      item("s1", "file", "Scène A", "M/Partie 1/a.md"),
      item("s2", "file", "Scène B", "M/Partie 1/b.md"),
    ]),
    item("f2", "folder", "Partie 2", "M/Partie 2"),
    item("s3", "file", "Isolée", "M/c.md"),
  ];
}

test("UUID ≠ path — deux items peuvent partager un titre sans confondre leur identité", () => {
  const items = [item("x", "file", "Même titre", "M/a.md"), item("y", "file", "Même titre", "M/b.md")];
  assert.equal(findPlanItem(items, "x").path, "M/a.md");
  assert.equal(findPlanItem(items, "y").path, "M/b.md");
  const renamed = setPlanItemTitle(items, "x", "Autre");
  assert.equal(findPlanItem(renamed, "x").title, "Autre");
  assert.equal(findPlanItem(renamed, "y").title, "Même titre", "l'autre item n'est jamais touché");
  assert.equal(findPlanItem(renamed, "x").id, "x", "l'UUID survit au changement de titre");
});

test("§2 — genres explicites : draft-folder accueille des enfants, draft-file jamais", () => {
  assert.equal(canAcceptChildren(item("a", "file", "F", "M/a.md")), false);
  assert.equal(canAcceptChildren(item("b", "folder", "D", "M/D")), true);
  assert.equal(canAcceptChildren(createDraft("draft-folder", "Nouveau")), true);
  assert.equal(canAcceptChildren(createDraft("draft-file", "Nouveau")), false);
  assert.equal(draftCreates(createDraft("draft-folder")), "folder");
  assert.equal(draftCreates(createDraft("draft-file")), "file");
  assert.equal(draftCreates(item("a", "file", "F", "M/a.md")), null);
  assert.equal(isPlanDraft(createDraft("draft-file")), true);
  assert.equal(isPlanDraft(item("a", "file", "F", "M/a.md")), false);
});

test("§2 — un draft-folder VIDE reste un dossier ; aucune conversion selon les enfants", () => {
  const empty = createDraft("draft-folder", "Vide", "df");
  assert.equal(empty.children.length, 0);
  assert.equal(draftCreates(empty), "folder", "il reste un dossier malgré l'absence d'enfants");
  assert.equal(canAcceptChildren(empty), true);
});

test("§2 — appendPlanChild refuse d'ajouter sous un draft-file", () => {
  const items = [createDraft("draft-file", "Feuille", "df")];
  assert.equal(appendPlanChild(items, "df", createDraft("draft-file", "x", "x")), items);
});

test("Entrée — insère un frère juste après la ligne courante, jamais ailleurs", () => {
  const draft = createDraft("draft-file", "Nouveau", "new");
  const next = insertPlanSiblingAfter(tree(), "s1", draft);
  assert.deepEqual(findPlanItem(next, "f1").children.map((c) => c.id), ["s1", "new", "s2"]);
  assert.equal(insertPlanSiblingAfter(tree(), "inconnu", draft).length, 3, "id inconnu : arbre inchangé");
});

test("Tab — indente sous le frère précédent, refuse en tête de fratrie et sous un fichier", () => {
  const indented = indentPlanItem(tree(), "f2");
  assert.deepEqual(findPlanItem(indented, "f1").children.map((c) => c.id), ["s1", "s2", "f2"]);

  const items = tree();
  assert.equal(indentPlanItem(items, "f1"), items, "premier de sa fratrie : refus, même référence");
  assert.equal(indentPlanItem(items, "s2") !== items, false, "sous un FICHIER (s1) : refus");
});

test("Shift+Tab — remonte d'un niveau juste après l'ancien parent ; refus à la racine", () => {
  const out = outdentPlanItem(tree(), "s1");
  assert.deepEqual(out.map((c) => c.id), ["f1", "s1", "f2", "s3"]);
  assert.deepEqual(findPlanItem(out, "f1").children.map((c) => c.id), ["s2"]);
  const items = tree();
  assert.equal(outdentPlanItem(items, "f1"), items, "déjà à la racine : refus");
});

test("Alt+↑/↓ — déplace la ligne ET sa branche dans sa propre fratrie uniquement", () => {
  const down = movePlanItemWithinSiblings(tree(), "f1", 1);
  assert.deepEqual(down.map((c) => c.id), ["f2", "f1", "s3"]);
  assert.deepEqual(findPlanItem(down, "f1").children.map((c) => c.id), ["s1", "s2"], "la branche suit");
  const items = tree();
  assert.equal(movePlanItemWithinSiblings(items, "f1", -1), items, "en tête : refus");
  assert.equal(movePlanItemWithinSiblings(items, "s3", 1), items, "en queue : refus");
});

test("déplacement de branche — before/after/inside, la branche entière suit", () => {
  const inside = movePlanBranch(tree(), "s3", "f2", "inside");
  assert.deepEqual(findPlanItem(inside, "f2").children.map((c) => c.id), ["s3"]);
  const before = movePlanBranch(tree(), "s3", "f1", "before");
  assert.deepEqual(before.map((c) => c.id), ["s3", "f1", "f2"]);
  const moved = movePlanBranch(tree(), "f1", "f2", "inside");
  assert.deepEqual(findPlanItem(moved, "f1").children.map((c) => c.id), ["s1", "s2"], "descendants conservés");
});

test("déplacement — cycle interdit, dépôt dans un fichier interdit, sur soi-même interdit", () => {
  const items = tree();
  assert.equal(canMovePlanBranch(items, "f1", "s1", "inside"), false, "cible descendante = cycle");
  assert.equal(movePlanBranch(items, "f1", "s1", "inside"), items, "aucune mutation");
  assert.equal(canMovePlanBranch(items, "f2", "s1", "inside"), false, "inside un FICHIER");
  assert.equal(canMovePlanBranch(items, "f1", "f1", "before"), false, "sur soi-même");
});

test("collapse — bascule sans jamais toucher aux enfants", () => {
  const collapsed = togglePlanItemCollapsed(tree(), "f1");
  assert.equal(findPlanItem(collapsed, "f1").collapsed, true);
  assert.equal(findPlanItem(collapsed, "f1").children.length, 2, "les enfants restent");
  assert.equal(findPlanItem(togglePlanItemCollapsed(collapsed, "f1"), "f1").collapsed, false);
});

test("suppression — un draft oui, un item réel jamais", () => {
  const withDraft = insertPlanSiblingAfter(tree(), "s3", createDraft("draft-file", "Brouillon", "d1"));
  assert.equal(removePlanDraft(withDraft, "d1").length, 3, "le draft est retiré");
  assert.equal(removePlanDraft(withDraft, "s3"), withDraft, "un FICHIER réel n'est jamais supprimé");
  assert.equal(removePlanDraft(withDraft, "f1"), withDraft, "un DOSSIER réel n'est jamais supprimé");
});

test("suppression — un draft qui abrite des items réels n'est jamais retiré (suppression implicite)", () => {
  const items = [item("d", "draft-folder", "Brouillon", undefined, [item("s", "file", "Réelle", "M/a.md")])];
  assert.equal(removePlanDraft(items, "d"), items);
});

test("helpers d'arbre — parent, descendance, aplatissement", () => {
  const items = tree();
  assert.equal(findPlanParent(items, "s1").id, "f1");
  assert.equal(findPlanParent(items, "f1"), null, "racine : pas de parent");
  assert.equal(isPlanDescendant(items, "f1", "s2"), true);
  assert.equal(isPlanDescendant(items, "f2", "s2"), false);
  assert.deepEqual(flattenPlan(items).map((i) => i.id), ["f1", "s1", "s2", "f2", "s3"]);
});

test("appendPlanChild — refuse d'ajouter sous un fichier existant", () => {
  const items = tree();
  assert.equal(appendPlanChild(items, "s1", createDraft("draft-file", "x", "d")), items);
  const ok = appendPlanChild(items, "f2", createDraft("draft-file", "x", "d"));
  assert.deepEqual(findPlanItem(ok, "f2").children.map((c) => c.id), ["d"]);
});
