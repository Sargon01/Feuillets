import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  IDEA_TREE_EDGE_STYLE,
  IDEA_TREE_LAYOUT,
  IDEA_TREE_MARKER,
  IDEA_TREE_NODE_STYLE,
  createIdeaBranches,
  createIdeaChild,
  createIdeaSibling,
  hasIdeaTreeParent,
  ideaTreeBranch,
  ideaTreeBranchToOutlineMarkdown,
  ideaTreeLines,
  reflowIdeaTree,
} from "../src/services/canvas-idea-tree.js";
import {
  admissibleChapterNodes,
  buildChapterPlan,
  executeChapterPlan,
  makeManuscriptPathChecker,
} from "../src/services/canvas-chapter.js";

function textNode(id, text, x = 0, y = 0) {
  return { id, type: "text", text, x, y, width: 240, height: 80 };
}

function managedEdge(id, fromNode, toNode) {
  return { id, fromNode, toNode, feuillets_managed: IDEA_TREE_MARKER };
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeProject(extraFiles = []) {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [...extraFiles];
  for (const file of extraFiles) file.parent = manuscript;
  const { vault, fileManager, files } = createFakeVault([volume, manuscript, ...extraFiles]);
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    folderPositions: {},
    projectMeta: {},
  };
  return { app, settings, manuscript, files };
}

async function crystallize(app, settings, manuscript, canvas, ids, name) {
  const checker = makeManuscriptPathChecker(app, settings);
  const byId = new Map(canvas.nodes.map((node) => [node.id, node]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  const admissible = admissibleChapterNodes(ordered, checker);
  const plan = buildChapterPlan(name, manuscript.path, admissible, (path) => !!app.vault.getAbstractFileByPath(path));
  assert.equal("code" in plan, false);
  return executeChapterPlan(app, settings, canvas, plan);
}

test("Arbre d'idées visuel TEST 1/3/4/5 — nodes et edges reprennent le modèle JSON manuel", () => {
  const parent = textNode("A", "Kemal arrive", 10, 100);
  const canvas = { nodes: [parent], edges: [] };
  const result = createIdeaBranches(canvas, parent.id, "café silencieux\nmuhtar hostile\nArif l'observe");

  assert.equal(result.nodes.length, 3);
  assert.equal(result.edges.length, 3);
  assert.deepEqual(result.nodes.map((node) => node.text), ["café silencieux", "muhtar hostile", "Arif l'observe"]);
  assert.ok(result.nodes.every((node) => node.type === "text"));
  assert.ok(result.nodes.every((node) => node.x === parent.x + IDEA_TREE_LAYOUT.horizontalIndent));
  assert.deepEqual(result.nodes.map((node) => node.y), [160, 220, 280]);
  assert.ok(result.nodes.every((node) => node.width === 260 && node.height === 80));
  assert.ok(result.nodes.every((node) => JSON.stringify(node.styleAttributes) === JSON.stringify(IDEA_TREE_NODE_STYLE)));
  assert.ok(result.edges.every((edge) => edge.feuillets_managed === "idea-tree" && edge.fromNode === "A"));
  assert.ok(result.edges.every((edge) => JSON.stringify(edge.styleAttributes) === JSON.stringify(IDEA_TREE_EDGE_STYLE)));
  assert.ok(result.edges.every((edge) => edge.fromSide === "bottom" && edge.toSide === "left"));
  assert.ok(result.edges.every((edge) => edge.toEnd === "none" && edge.fromEnd === undefined));
  assert.ok(result.edges.every((edge) => edge.toFloating === false));
  assert.ok(result.nodes.every((node) => !("file" in node)), "aucun fichier Markdown ne doit être référencé");
});

test("Arbre d'idées visuel TEST 2 — aucun caractère d'arbre n'est injecté dans le texte", () => {
  const canvas = { nodes: [textNode("A", "A")], edges: [] };
  const result = createIdeaBranches(canvas, "A", "Sous-idée 1\nSous-idée 2");
  assert.deepEqual(result.nodes.map((node) => node.text), ["Sous-idée 1", "Sous-idée 2"]);
  assert.ok(result.nodes.every((node) => !/[├└│]/.test(node.text)));
});

test("Arbre d'idées TEST 2 — les lignes vides sont ignorées", () => {
  assert.deepEqual(ideaTreeLines("  A  \n\n   \r\n B interne  "), ["A", "B interne"]);
  const canvas = { nodes: [textNode("A", "A")], edges: [] };
  const result = createIdeaBranches(canvas, "A", "\nune\n \n deux \n");
  assert.deepEqual(result.nodes.map((node) => node.text), ["une", "deux"]);
});

test("Arbre d'idées — reflow global DFS : développer B repousse C et conserve l'ordre métier", () => {
  const canvas = { nodes: [textNode("A", "A")], edges: [] };
  const first = createIdeaBranches(canvas, "A", "B\nC\nD");
  const [, c, d] = first.nodes;
  const cBefore = c.y;
  const dBefore = d.y;
  const second = createIdeaBranches(canvas, first.nodes[0].id, "X\nY");
  assert.equal(second.nodes.length, 2);
  assert.deepEqual(ideaTreeBranch(canvas, "A").map((node) => node.text), ["A", "B", "X", "Y", "C", "D"]);
  assert.deepEqual(
    ideaTreeBranch(canvas, "A").map((node) => [node.x, node.y]),
    [[0, 0], [170, 60], [340, 120], [340, 180], [170, 240], [170, 300]]
  );
  assert.ok(c.y > cBefore);
  assert.ok(d.y > dBefore);
});

test("Arbre d'idées — développer le dernier frère place ses descendants immédiatement après lui", () => {
  const canvas = { nodes: [textNode("A", "A", 25, 40)], edges: [] };
  const first = createIdeaBranches(canvas, "A", "B\nC\nD");
  createIdeaBranches(canvas, first.nodes[2].id, "X\nY");
  assert.deepEqual(ideaTreeBranch(canvas, "A").map((node) => node.text), ["A", "B", "C", "D", "X", "Y"]);
  assert.deepEqual(
    ideaTreeBranch(canvas, "A").map((node) => node.y),
    [40, 100, 160, 220, 280, 340]
  );
});

test("Arbre d'idées — profondeur 3 : X dépend uniquement de la profondeur et la racine reste ancrée", () => {
  const root = textNode("A", "A", 35, 75);
  const canvas = { nodes: [root], edges: [] };
  const [b] = createIdeaBranches(canvas, "A", "B").nodes;
  const [c] = createIdeaBranches(canvas, b.id, "C").nodes;
  const [d] = createIdeaBranches(canvas, c.id, "D").nodes;
  assert.deepEqual([root.x, root.y], [35, 75]);
  assert.deepEqual([b.x, c.x, d.x], [205, 375, 545]);
  assert.deepEqual([b.y, c.y, d.y], [135, 195, 255]);
});

test("Arbre d'idées — le reflow ignore les nodes libres et les edges ordinaires", () => {
  const root = textNode("A", "A", 10, 20);
  const child = textNode("B", "B", 900, 900);
  const free = { ...textNode("LIBRE", "Libre", 180, 80), custom: "intact" };
  const canvas = {
    nodes: [root, child, free],
    edges: [managedEdge("ab", "A", "B"), { id: "ordinary", fromNode: "B", toNode: "LIBRE" }],
  };
  const freeBefore = deepCopy(free);
  const ordinaryBefore = deepCopy(canvas.edges[1]);
  assert.deepEqual(reflowIdeaTree(canvas, "B").map((node) => node.id), ["A", "B"]);
  assert.deepEqual([root.x, root.y], [10, 20]);
  assert.deepEqual([child.x, child.y], [180, 80]);
  assert.deepEqual(free, freeBefore);
  assert.deepEqual(canvas.edges[1], ordinaryBefore);
});

test("Arbre d'idées visuel TEST 8 — les edges Canvas ordinaires ne sont jamais parcourues", () => {
  const canvas = {
    nodes: [textNode("A", "A"), textNode("B", "B"), textNode("LIBRE", "Libre")],
    edges: [managedEdge("tree", "A", "B"), { id: "ordinary", fromNode: "B", toNode: "LIBRE", color: "4" }],
  };
  assert.deepEqual(ideaTreeBranch(canvas, "A").map((node) => node.id), ["A", "B"]);
});

test("Arbre d'idées TEST 5 — une branche ne contient que la racine et ses descendants idea-tree", () => {
  const canvas = {
    nodes: [textNode("A", "A"), textNode("B", "B"), textNode("C", "C"), textNode("X", "X")],
    edges: [managedEdge("ab", "A", "B"), managedEdge("bc", "B", "C"), { id: "ax", fromNode: "A", toNode: "X" }],
  };
  assert.deepEqual(ideaTreeBranch(canvas, "B").map((node) => node.id), ["B", "C"]);
});

test("Arbre d'idées TEST 6 — le parcours est A B D E C (DFS pré-ordre, frères par Y)", () => {
  const canvas = {
    nodes: [
      textNode("A", "A", 0, 50),
      textNode("C", "C", 500, 200),
      textNode("E", "E", 800, 180),
      textNode("B", "B", 500, 20),
      textNode("D", "D", 800, 90),
    ],
    edges: [managedEdge("ac", "A", "C"), managedEdge("be", "B", "E"), managedEdge("ab", "A", "B"), managedEdge("bd", "B", "D")],
  };
  assert.deepEqual(ideaTreeBranch(canvas, "A").map((node) => node.id), ["A", "B", "D", "E", "C"]);
});

test("Arbre d'idées visuel TEST 9 — la cristallisation existante reste inchangée", async () => {
  const { app, settings, manuscript } = makeProject();
  const canvas = {
    nodes: [textNode("A", "A"), textNode("B", "B")],
    edges: [managedEdge("ab", "A", "B")],
  };
  const branch = ideaTreeBranch(canvas, "A");
  const result = await crystallize(app, settings, manuscript, canvas, branch.map((node) => node.id), "Chapitre idées");
  assert.equal(result.ok, true);
  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre idées/A.md") instanceof TFile);
  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre idées/B.md") instanceof TFile);
});

test("Arbre d'idées TEST 8 — un FileNode manuscrit est déplacé, jamais copié", async () => {
  const source = new TFile("Projet/Manuscrit/Scène.md", "Texte intact");
  const { app, settings, manuscript } = makeProject([source]);
  const canvas = { nodes: [{ id: "F", type: "file", file: source.path, x: 0, y: 0, width: 240, height: 80 }], edges: [] };
  const result = await crystallize(app, settings, manuscript, canvas, ["F"], "Chapitre fichier");
  assert.equal(result.ok, true);
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/Scène.md"), null);
  const moved = app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre fichier/Scène.md");
  assert.ok(moved instanceof TFile);
  assert.equal(await app.vault.read(moved), "Texte intact");
});

test("Arbre d'idées TEST 9 — une fiche Recherche est ignorée et reste intacte", async () => {
  const researchFolder = new TFolder("Projet/Recherche");
  const researchFile = new TFile("Projet/Recherche/Ney.md", "Recherche intacte");
  researchFolder.children = [researchFile];
  researchFile.parent = researchFolder;
  const { app, settings, manuscript, files } = makeProject();
  files.set(researchFolder.path, researchFolder);
  files.set(researchFile.path, researchFile);
  const canvas = {
    nodes: [textNode("A", "A"), { id: "R", type: "file", file: researchFile.path, x: 500, y: 0, width: 240, height: 80 }],
    edges: [managedEdge("ar", "A", "R")],
  };
  const branch = ideaTreeBranch(canvas, "A");
  const result = await crystallize(app, settings, manuscript, canvas, branch.map((node) => node.id), "Chapitre sans recherche");
  assert.equal(result.ok, true);
  assert.equal(app.vault.getAbstractFileByPath(researchFile.path), researchFile);
  assert.equal(await app.vault.read(researchFile), "Recherche intacte");
  assert.ok(canvas.nodes.some((node) => node.id === "R" && node.file === researchFile.path));
});

test("Arbre d'idées TEST 10 — ajouter ou déplacer une branche après cristallisation ne resynchronise pas le Binder", async () => {
  const source = new TFile("Projet/Manuscrit/Racine.md", "Racine");
  const { app, settings, manuscript, files } = makeProject([source]);
  const canvas = { nodes: [{ id: "F", type: "file", file: source.path, x: 0, y: 0, width: 240, height: 80 }], edges: [] };
  const result = await crystallize(app, settings, manuscript, canvas, ["F"], "Cristallisé");
  assert.equal(result.ok, true);
  const binderBefore = JSON.stringify(settings);
  const filesBefore = [...files.keys()].filter((path) => path.endsWith(".md")).sort();
  const created = createIdeaBranches(canvas, "F", "nouvelle pensée");
  created.nodes[0].x += 400;
  created.nodes[0].y += 250;
  assert.equal(JSON.stringify(settings), binderBefore);
  assert.deepEqual([...files.keys()].filter((path) => path.endsWith(".md")).sort(), filesBefore);
});

test("Arbre d'idées TEST 11 — supprimer une edge idea-tree exclut le descendant suivant", () => {
  const canvas = {
    nodes: [textNode("A", "A"), textNode("B", "B"), textNode("C", "C")],
    edges: [managedEdge("ab", "A", "B"), managedEdge("bc", "B", "C")],
  };
  canvas.edges = canvas.edges.filter((edge) => edge.id !== "bc");
  assert.deepEqual(ideaTreeBranch(canvas, "A").map((node) => node.id), ["A", "B"]);
});

test("Arbre d'idées visuel TEST 10 — les attributs inconnus des éléments existants sont préservés", () => {
  const parent = { ...textNode("A", "A"), styleAttributes: { shape: "pill" }, customPluginField: { nested: true } };
  const ordinary = { id: "ordinary", fromNode: "A", toNode: "X", label: "libre", unknown: 42 };
  const other = { ...textNode("X", "X", 900, 900), color: "5" };
  const canvas = { nodes: [parent, other], edges: [ordinary] };
  const beforeParent = deepCopy(parent);
  const beforeOther = deepCopy(other);
  const beforeEdge = deepCopy(ordinary);
  createIdeaBranches(canvas, "A", "B");
  assert.deepEqual(canvas.nodes.find((node) => node.id === "A"), beforeParent);
  assert.deepEqual(canvas.nodes.find((node) => node.id === "X"), beforeOther);
  assert.deepEqual(canvas.edges.find((edge) => edge.id === "ordinary"), beforeEdge);
});

// ---------------------------------------------------------------------------
// Lot 5 — createIdeaChild / createIdeaSibling / hasIdeaTreeParent
// ---------------------------------------------------------------------------

test("Lot 5 — createIdeaChild crée un unique enfant, texte vide, géométrie historique inchangée", () => {
  const parent = textNode("A", "A", 10, 100);
  const canvas = { nodes: [parent], edges: [] };
  const child = createIdeaChild(canvas, "A");

  assert.equal(canvas.nodes.length, 2);
  assert.equal(canvas.edges.length, 1);
  assert.equal(child.text, "");
  assert.equal(child.type, "text");
  assert.equal(child.width, IDEA_TREE_LAYOUT.childWidth);
  assert.equal(child.height, IDEA_TREE_LAYOUT.childHeight);
  assert.equal(child.x, parent.x + IDEA_TREE_LAYOUT.horizontalIndent);
  assert.equal(child.y, parent.y + IDEA_TREE_LAYOUT.verticalSpacing);
  assert.equal(canvas.edges[0].fromNode, "A");
  assert.equal(canvas.edges[0].toNode, child.id);
  assert.equal(canvas.edges[0].feuillets_managed, IDEA_TREE_MARKER);
});

test("Lot 5 — createIdeaChild renvoie null si le parent n'existe plus", () => {
  const canvas = { nodes: [], edges: [] };
  assert.equal(createIdeaChild(canvas, "introuvable"), null);
});

test("Lot 5 — createIdeaSibling insère le frère immédiatement après celui cliqué", () => {
  const canvas = { nodes: [textNode("A", "A")], edges: [] };
  const created = createIdeaBranches(canvas, "A", "B\nC");
  const [bNode] = created.nodes;
  const sibling = createIdeaSibling(canvas, bNode.id, "B-bis");
  assert.ok(sibling);
  assert.deepEqual(ideaTreeBranch(canvas, "A").map((node) => node.text), ["A", "B", "B-bis", "C"]);
});

test("Lot 5 — createIdeaSibling inséré après un frère du MILIEU (pas le dernier) reste bien positionné", () => {
  const canvas = { nodes: [textNode("A", "A")], edges: [] };
  const created = createIdeaBranches(canvas, "A", "B\nC\nD");
  const [, cNode] = created.nodes;
  createIdeaSibling(canvas, cNode.id, "C-bis");
  assert.deepEqual(ideaTreeBranch(canvas, "A").map((node) => node.text), ["A", "B", "C", "C-bis", "D"]);
});

test("Lot 5 — createIdeaSibling renvoie null pour une racine sans parent idea-tree", () => {
  const canvas = { nodes: [textNode("A", "A")], edges: [] };
  assert.equal(createIdeaSibling(canvas, "A"), null);
});

test("Lot 5 — createIdeaSibling renvoie null si le node cliqué a disparu", () => {
  const canvas = { nodes: [textNode("A", "A")], edges: [] };
  assert.equal(createIdeaSibling(canvas, "fantome"), null);
});

test("Lot 5 — hasIdeaTreeParent distingue une racine (faux) d'un descendant (vrai)", () => {
  const canvas = { nodes: [textNode("A", "A"), textNode("B", "B")], edges: [managedEdge("ab", "A", "B")] };
  assert.equal(hasIdeaTreeParent(canvas, "A"), false);
  assert.equal(hasIdeaTreeParent(canvas, "B"), true);
});

// ---------------------------------------------------------------------------
// Lot 9 — ideaTreeBranchToOutlineMarkdown (Arbre d'idées → plan Markdown)
// ---------------------------------------------------------------------------

test("Lot 9 A — A avec deux enfants sans petits-enfants → un titre, deux puces", () => {
  const canvas = {
    nodes: [textNode("A", "A", 0, 0), textNode("B", "B", 170, 60), textNode("C", "C", 170, 120)],
    edges: [managedEdge("ab", "A", "B"), managedEdge("ac", "A", "C")],
  };
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.deepEqual(result, { ok: true, markdown: "# A\n- B\n- C" });
});

test("Lot 9 B — A → B → C, D : profondeur relative, B reste un dossier, C/D des puces", () => {
  const canvas = {
    nodes: [textNode("A", "A", 0, 0), textNode("B", "B", 170, 60), textNode("C", "C", 340, 120), textNode("D", "D", 340, 180)],
    edges: [managedEdge("ab", "A", "B"), managedEdge("bc", "B", "C"), managedEdge("bd", "B", "D")],
  };
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.deepEqual(result, { ok: true, markdown: "# A\n## B\n- C\n- D" });
});

test("Lot 9 C — l'ordre des frères suit exactement l'ordre déterministe de ideaTreeBranch", () => {
  const canvas = {
    nodes: [textNode("A", "A", 0, 50), textNode("C", "C", 500, 200), textNode("B", "B", 500, 20)],
    edges: [managedEdge("ac", "A", "C"), managedEdge("ab", "A", "B")],
  };
  const branchOrder = ideaTreeBranch(canvas, "A").map((node) => node.id);
  assert.deepEqual(branchOrder, ["A", "B", "C"]);
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.deepEqual(result, { ok: true, markdown: "# A\n- B\n- C" });
});

test("Lot 9 D — sous-arbre : l'action sur B ignore A et E, ne produit que B/C/D", () => {
  const canvas = {
    nodes: [
      textNode("A", "A", 0, 0),
      textNode("B", "B", 170, 60),
      textNode("C", "C", 340, 120),
      textNode("D", "D", 340, 180),
      textNode("E", "E", 170, 240),
    ],
    edges: [
      managedEdge("ab", "A", "B"),
      managedEdge("bc", "B", "C"),
      managedEdge("bd", "B", "D"),
      managedEdge("ae", "A", "E"),
    ],
  };
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "B");
  assert.deepEqual(result, { ok: true, markdown: "# B\n- C\n- D" });
});

test("Lot 9 E — une edge Canvas ordinaire vers X n'apparaît jamais dans le plan", () => {
  const canvas = {
    nodes: [textNode("A", "A", 0, 0), textNode("B", "B", 170, 60), textNode("X", "X", 900, 900)],
    edges: [managedEdge("ab", "A", "B"), { id: "ordinary", fromNode: "B", toNode: "X" }],
  };
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.equal(result.ok, true);
  assert.ok(!result.markdown.includes("X"));
});

test("Lot 9 F — seule la première ligne significative devient le titre", () => {
  const canvas = {
    nodes: [textNode("A", "A", 0, 0), textNode("B", "  Kemal arrive  \ntexte secondaire", 170, 60)],
    edges: [managedEdge("ab", "A", "B")],
  };
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.deepEqual(result, { ok: true, markdown: "# A\n- Kemal arrive" });
});

test("Lot 9 G — un TextNode vide dans la branche refuse toute génération (empty-title)", () => {
  const canvas = {
    nodes: [textNode("A", "A", 0, 0), textNode("B", "   \n  ", 170, 60)],
    edges: [managedEdge("ab", "A", "B")],
  };
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.deepEqual(result, { ok: false, code: "empty-title" });
});

test("Lot 9 H — un FileNode dans la branche refuse toute génération (non-text-node)", () => {
  const canvas = {
    nodes: [textNode("A", "A", 0, 0), { id: "F", type: "file", file: "Manuscrit/Scène.md", x: 170, y: 60 }],
    edges: [managedEdge("af", "A", "F")],
  };
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.deepEqual(result, { ok: false, code: "non-text-node" });
});

test("Lot 9 I — un node AVEC ENFANTS qui nécessiterait plus de 6 # refuse toute génération (too-deep)", () => {
  const ids = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const nodes = ids.map((id, index) => textNode(id, id, index * 170, index * 60));
  const edges = [];
  for (let i = 0; i < ids.length - 1; i += 1) edges.push(managedEdge(`${ids[i]}${ids[i + 1]}`, ids[i], ids[i + 1]));
  const canvas = { nodes, edges };
  // A..G : 7 niveaux de dossiers (profondeur 0 à 6, donc # à #######) → refusé.
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.deepEqual(result, { ok: false, code: "too-deep" });
});

test("Lot 9 I bis — exactement 6 niveaux de dossiers reste accepté (limite incluse)", () => {
  // A..F : 6 dossiers imbriqués (profondeur 0 à 5) + G en feuille.
  const ids = ["A", "B", "C", "D", "E", "F", "G"];
  const nodes = ids.map((id, index) => textNode(id, id, index * 170, index * 60));
  const edges = [];
  for (let i = 0; i < ids.length - 1; i += 1) edges.push(managedEdge(`${ids[i]}${ids[i + 1]}`, ids[i], ids[i + 1]));
  const canvas = { nodes, edges };
  const result = ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.equal(result.ok, true);
  assert.equal(result.markdown, "# A\n## B\n### C\n#### D\n##### E\n###### F\n- G");
});

test("Lot 9 J — fonction pure : le Canvas original reste identique (deepEqual) avant/après", () => {
  const canvas = {
    nodes: [textNode("A", "A", 0, 0), textNode("B", "B", 170, 60)],
    edges: [managedEdge("ab", "A", "B")],
  };
  const before = deepCopy(canvas);
  ideaTreeBranchToOutlineMarkdown(canvas, "A");
  assert.deepEqual(canvas, before);
});

test("Lot 5 — Tab puis Entrée (A → enfant B → frère C) reproduit exactement le scénario attendu", () => {
  const canvas = { nodes: [textNode("A", "A")], edges: [] };
  const b = createIdeaChild(canvas, "A", "B");
  const c = createIdeaSibling(canvas, b.id, "C");
  assert.ok(c);
  assert.deepEqual(ideaTreeBranch(canvas, "A").map((node) => node.text), ["A", "B", "C"]);
  // A a un seul enfant direct (B) ; C est le frère de B, pas un second enfant de A.
  const parentOfC = canvas.edges.find((edge) => edge.toNode === c.id).fromNode;
  const parentOfB = canvas.edges.find((edge) => edge.toNode === b.id).fromNode;
  assert.equal(parentOfC, parentOfB);
});
