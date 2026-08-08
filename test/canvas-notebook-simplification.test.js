import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { applySelectedIdeas } from "../src/services/canvas-bridge.js";
import { ensureNotebookResearchFolder } from "../src/services/research.js";
import {
  admissibleChapterNodes,
  makeManuscriptPathChecker,
  nodesContainedInGroup,
  buildChapterPlan,
  executeChapterPlan,
} from "../src/services/canvas-chapter.js";
import { splitTextNode, splitFeuilletFile, executeMerge, defaultSplitOf, mergeContents } from "../src/services/canvas-split-merge.js";

/* SIMPLIFICATION CARNET — une arête du Carnet n'a JAMAIS d'effet métier
 * automatique : elle exprime seulement une relation visuelle. Ces tests
 * couvrent la liste TEST 1-8 du cahier des charges de simplification. */

function makeProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Recherche");
  volume.children = [manuscript, research];
  manuscript.parent = volume;
  research.parent = volume;
  const { vault, fileManager } = createFakeVault([volume, manuscript, research]);
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
  return { app, settings, volume, manuscript, research };
}

// ---------------------------------------------------------------------------
// TEST 1 — TextNode → fiche Recherche : vrai FileNode, couleur automatique,
// chemin Recherche/Carnet, edges inchangées.
// ---------------------------------------------------------------------------

test("TEST 1 : TextNode → fiche Recherche — FileNode, couleur Recherche automatique, chemin Recherche/Carnet, edges inchangées", async () => {
  const { app, settings } = makeProject();
  const idea = { id: "ney", type: "text", text: "Ney", x: 0, y: 0, width: 100, height: 60 };
  const other = { id: "other", type: "text", text: "Autre idée", x: 400, y: 0, width: 100, height: 60 };
  const canvas = { nodes: [idea, other], edges: [{ id: "e1", fromNode: "ney", toNode: "other" }] };

  const destFolder = await ensureNotebookResearchFolder(app, settings);
  assert.ok(destFolder);
  assert.equal(destFolder.path, "Projet/Recherche/Carnet");

  const result = await applySelectedIdeas(app, canvas, ["ney"], destFolder, "research");
  assert.equal(result.created, 1);
  const effectiveId = result.convertedIds.get("ney");
  const neyNode = canvas.nodes.find((n) => n.id === effectiveId);

  assert.equal(neyNode.type, "file", "doit être un vrai FileNode, jamais rester un TextNode");
  assert.equal(neyNode.file, "Projet/Recherche/Carnet/Ney.md");
  assert.equal(neyNode.color, "6", "couleur Canvas Recherche posée automatiquement");
  assert.equal(neyNode.feuillets_managed, "research");

  // Edge conservée, redirigée vers le nouvel id — jamais supprimée.
  assert.equal(canvas.edges.length, 1);
  assert.equal(canvas.edges[0].fromNode, effectiveId);
  assert.equal(canvas.edges[0].toNode, "other");

  const created = app.vault.getAbstractFileByPath("Projet/Recherche/Carnet/Ney.md");
  assert.ok(created instanceof TFile);
});

test("TEST 1bis : une couleur déjà posée manuellement sur la note n'est jamais écrasée", async () => {
  const { app, settings } = makeProject();
  const idea = { id: "ney", type: "text", text: "Ney", color: "3", x: 0, y: 0, width: 100, height: 60 };
  const canvas = { nodes: [idea], edges: [] };
  const destFolder = await ensureNotebookResearchFolder(app, settings);

  const result = await applySelectedIdeas(app, canvas, ["ney"], destFolder, "research");
  const effectiveId = result.convertedIds.get("ney");
  const neyNode = canvas.nodes.find((n) => n.id === effectiveId);
  assert.equal(neyNode.color, "3", "la couleur choisie par l'autrice reste prioritaire");
});

// ---------------------------------------------------------------------------
// TEST 2 — Recherche A → edge → TextNode B ; B → Transformer en feuillet :
// B devient FileNode manuscrit, A ne bouge pas, aucun dossier Recherche
// contextuel créé, aucun researchFolderLinks, edge A→B conservée.
// ---------------------------------------------------------------------------

test("TEST 2 : fiche Recherche reliée à une idée transformée en feuillet — jamais déplacée, jamais contextualisée", async () => {
  const { app, settings, manuscript } = makeProject();
  const neyFile = await app.vault.create("Projet/Recherche/Ney.md", "# Ney");

  const neyNode = { id: "A", type: "file", file: neyFile.path, x: 0, y: 0, width: 100, height: 60, feuillets_managed: "research" };
  const ideaB = { id: "B", type: "text", text: "Scène test", x: 400, y: 0, width: 100, height: 60 };
  const canvas = { nodes: [neyNode, ideaB], edges: [{ id: "e1", fromNode: "A", toNode: "B" }] };

  const result = await applySelectedIdeas(app, canvas, ["B"], manuscript, "manuscript");
  assert.equal(result.created, 1);
  const effectiveB = result.convertedIds.get("B");
  const sceneNode = canvas.nodes.find((n) => n.id === effectiveB);
  assert.equal(sceneNode.type, "file");
  assert.equal(sceneNode.file, "Projet/Manuscrit/Scène test.md");

  // A (Ney) n'a pas bougé.
  const aNode = canvas.nodes.find((n) => n.id === "A");
  assert.equal(aNode.file, "Projet/Recherche/Ney.md");
  assert.ok(app.vault.getAbstractFileByPath("Projet/Recherche/Ney.md") instanceof TFile);

  // Aucun dossier de contexte créé, aucun researchFolderLinks écrit.
  assert.equal(app.vault.getAbstractFileByPath("Projet/Recherche/Scène test"), null);
  assert.equal(settings.projectMeta[manuscript.path]?.researchFolderLinks, undefined);

  // Edge A→B conservée, redirigée vers le nouvel id de la scène.
  assert.equal(canvas.edges.length, 1);
  assert.equal(canvas.edges[0].fromNode, "A");
  assert.equal(canvas.edges[0].toNode, effectiveB);
});

// ---------------------------------------------------------------------------
// TEST 3 — Sélection [TextNode1, TextNode2, FileNode Recherche] → Créer
// chapitre : 2 scènes dans le chapitre, Recherche non incluse au Binder,
// non déplacée, Canvas conservé.
// ---------------------------------------------------------------------------

test("TEST 3 : sélection avec une fiche Recherche — seules les 2 idées structurent le chapitre, la Recherche reste libre", async () => {
  const { app, settings, manuscript } = makeProject();
  const neyFile = await app.vault.create("Projet/Recherche/Ney.md", "# Ney");

  const t1 = { id: "t1", type: "text", text: "Scène un", x: 0, y: 0, width: 100, height: 60 };
  const t2 = { id: "t2", type: "text", text: "Scène deux", x: 200, y: 0, width: 100, height: 60 };
  const r1 = { id: "r1", type: "file", file: neyFile.path, x: 400, y: 0, width: 100, height: 60, feuillets_managed: "research" };
  const canvas = { nodes: [t1, t2, r1], edges: [{ id: "e1", fromNode: "r1", toNode: "t1" }] };

  const isManuscriptPath = makeManuscriptPathChecker(app, settings);
  const selectionIds = ["t1", "t2", "r1"];
  const selectedFull = selectionIds.map((id) => canvas.nodes.find((n) => n.id === id));
  const admissible = admissibleChapterNodes(selectedFull, isManuscriptPath);
  assert.deepEqual(admissible.map((n) => n.id).sort(), ["t1", "t2"], "la fiche Recherche n'est jamais admissible");

  const plan = buildChapterPlan("Chapitre neuf", manuscript.path, admissible, (p) => !!app.vault.getAbstractFileByPath(p));
  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.ok(result.ok);

  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre neuf/Scène un.md") instanceof TFile);
  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre neuf/Scène deux.md") instanceof TFile);

  // La fiche Recherche n'a pas bougé, jamais entrée dans le chapitre.
  assert.ok(app.vault.getAbstractFileByPath("Projet/Recherche/Ney.md") instanceof TFile);
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre neuf/Ney.md"), null);
  const rNode = canvas.nodes.find((n) => n.id === "r1");
  assert.equal(rNode.file, "Projet/Recherche/Ney.md", "le node Canvas de la fiche Recherche reste inchangé");
  assert.equal(settings.projectMeta[manuscript.path]?.researchFolderLinks, undefined);
});

// ---------------------------------------------------------------------------
// TEST 4 — Groupe [2 scènes + 1 Recherche] → Créer chapitre : uniquement
// les 2 scènes structurent le chapitre, la Recherche reste libre.
// ---------------------------------------------------------------------------

test("TEST 4 : groupe contenant une fiche Recherche — seules les scènes structurent le chapitre, la Recherche reste libre", async () => {
  const { app, settings, manuscript } = makeProject();
  const neyFile = await app.vault.create("Projet/Recherche/Ney.md", "# Ney");

  const group = { id: "g1", type: "group", label: "Groupe", x: 0, y: 0, width: 600, height: 300 };
  const t1 = { id: "t1", type: "text", text: "Scène un", x: 10, y: 10, width: 100, height: 60 };
  const t2 = { id: "t2", type: "text", text: "Scène deux", x: 200, y: 10, width: 100, height: 60 };
  const r1 = { id: "r1", type: "file", file: neyFile.path, x: 400, y: 10, width: 100, height: 60, feuillets_managed: "research" };
  const canvas = { nodes: [group, t1, t2, r1], edges: [{ id: "e1", fromNode: "g1", toNode: "r1" }] };

  const isManuscriptPath = makeManuscriptPathChecker(app, settings);
  const contained = nodesContainedInGroup(canvas, group);
  assert.equal(contained.length, 3, "les 3 éléments sont bien géométriquement dans le groupe");
  const admissible = admissibleChapterNodes(contained, isManuscriptPath);
  assert.deepEqual(admissible.map((n) => n.id).sort(), ["t1", "t2"]);

  const plan = buildChapterPlan("Groupe", manuscript.path, admissible, (p) => !!app.vault.getAbstractFileByPath(p));
  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.ok(result.ok);

  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/Groupe/Scène un.md") instanceof TFile);
  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/Groupe/Scène deux.md") instanceof TFile);
  assert.ok(app.vault.getAbstractFileByPath("Projet/Recherche/Ney.md") instanceof TFile, "Ney reste dans Recherche");
  assert.equal(settings.projectMeta[manuscript.path]?.researchFolderLinks, undefined);
});

// ---------------------------------------------------------------------------
// TEST 5 — Scinder un TextNode → deux TextNodes, contenu correctement réparti.
// ---------------------------------------------------------------------------

test("TEST 5 : scinder un TextNode — deux TextNodes, contenu réparti", () => {
  const original = { id: "n1", type: "text", text: "Première partie.\n\nDeuxième partie.", x: 0, y: 0, width: 200, height: 100 };
  const canvas = { nodes: [original], edges: [] };
  const { first, second } = defaultSplitOf(original.text);
  assert.equal(first, "Première partie.");
  assert.equal(second, "Deuxième partie.");

  const result = splitTextNode(canvas, "n1", first, second);
  assert.ok(result);
  assert.equal(canvas.nodes.length, 2);
  const kept = canvas.nodes.find((n) => n.id === "n1");
  assert.equal(kept.text, "Première partie.");
  assert.equal(kept.x, 0, "position d'origine inchangée");
  const created = canvas.nodes.find((n) => n.id !== "n1");
  assert.equal(created.type, "text");
  assert.equal(created.text, "Deuxième partie.");
  assert.equal(created.x, 240, "positionnée juste à côté (x + width + GAP)");
});

test("TEST 5 : scinder un TextNode — le second conserve son style sans données métier résiduelles", () => {
  const original = {
    id: "n1",
    type: "text",
    text: "Avant\n\nAprès",
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    color: "4",
    styleAttributes: { border: "invisible", shape: null },
    dynamicHeight: true,
    zIndex: 7,
    extensionField: { keep: true },
    file: "Projet/Manuscrit/résidu.md",
    feuillets_managed: "manuscript",
  };
  const canvas = { nodes: [original], edges: [] };
  const result = splitTextNode(canvas, "n1", "Avant", "Après");
  assert.ok(result);
  const created = result.newNode;
  assert.equal(created.type, "text");
  assert.equal(created.color, "4");
  assert.deepEqual(created.styleAttributes, { border: "invisible", shape: null });
  assert.equal(created.dynamicHeight, true);
  assert.equal(created.zIndex, 7);
  assert.deepEqual(created.extensionField, { keep: true });
  assert.equal("file" in created, false);
  assert.equal("feuillets_managed" in created, false);
  assert.notEqual(created.id, original.id);
});

// ---------------------------------------------------------------------------
// TEST 6 — Scinder un feuillet → deux fichiers Markdown, aucun doublon.
// ---------------------------------------------------------------------------

test("TEST 6 : scinder un feuillet du manuscrit — deux fichiers Markdown, aucun doublon", async () => {
  const { app, manuscript } = makeProject();
  const original = new TFile("Projet/Manuscrit/Scène.md", "---\ntitle: Scène\nstatus: brouillon\n---\nPremière moitié.\n\nDeuxième moitié.");
  original.parent = manuscript;
  manuscript.children.push(original);

  const result = await splitFeuilletFile(app, original, "Première moitié.", "Deuxième moitié.");
  assert.ok(result);

  const originalContent = await app.vault.read(original);
  assert.match(originalContent, /^---\ntitle: Scène\nstatus: brouillon\n---\n/);
  assert.match(originalContent, /Première moitié\./);
  assert.doesNotMatch(originalContent, /Deuxième moitié/);

  const newFile = app.vault.getAbstractFileByPath("Projet/Manuscrit/Scène - 2.md");
  assert.ok(newFile instanceof TFile, "un seul nouveau fichier créé, jamais de doublon");
  const newContent = await app.vault.read(newFile);
  assert.match(newContent, /Deuxième moitié\./);

  // Aucun doublon : un seul fichier "Scène*.md" en plus de l'original.
  const count = manuscript.children.filter((c) => c.name.startsWith("Scène")).length;
  assert.equal(count, 2);
});

// ---------------------------------------------------------------------------
// TEST 7 — Fusionner plusieurs notes/feuillets : contenu final correct,
// suppression uniquement après succès, rollback propre en cas d'échec.
// ---------------------------------------------------------------------------

test("TEST 7 : fusionner deux TextNodes dans un TextNode cible — contenu concaténé", async () => {
  const { app } = makeProject();
  const a = { id: "a", type: "text", text: "Idée A", x: 0, y: 0 };
  const b = { id: "b", type: "text", text: "Idée B", x: 100, y: 0 };
  const canvas = { nodes: [a, b], edges: [] };

  const result = await executeMerge(app, canvas, ["a", "b"], "a");
  assert.ok(result.ok);
  const merged = canvas.nodes.find((n) => n.id === "a");
  assert.equal(merged.text, mergeContents(["Idée A", "Idée B"]));
  assert.equal(canvas.nodes.length, 1, "la source non-cible a été retirée du Canvas");
});

test("TEST 7bis : fusionner des feuillets — contenu écrit dans la cible, sources supprimées seulement après succès", async () => {
  const { app } = makeProject();
  const fileA = await app.vault.create("Projet/Manuscrit/A.md", "---\ntitle: A\n---\nContenu A.");
  const fileB = await app.vault.create("Projet/Manuscrit/B.md", "---\ntitle: B\n---\nContenu B.");

  const nodeA = { id: "a", type: "file", file: fileA.path, x: 0, y: 0 };
  const nodeB = { id: "b", type: "file", file: fileB.path, x: 100, y: 0 };
  const canvas = { nodes: [nodeA, nodeB], edges: [] };

  const result = await executeMerge(app, canvas, ["a", "b"], "a");
  assert.ok(result.ok);

  const finalContent = await app.vault.read(fileA);
  assert.match(finalContent, /^---\ntitle: A\n---\n/);
  assert.match(finalContent, /Contenu A\./);
  assert.match(finalContent, /Contenu B\./);
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/B.md"), null, "la source est supprimée après succès");
  assert.equal(canvas.nodes.length, 1);
});

test("TEST 7ter : échec pendant la fusion — rollback complet (cible restaurée, source recréée)", async () => {
  const { app } = makeProject();
  const fileA = await app.vault.create("Projet/Manuscrit/A.md", "---\ntitle: A\n---\nContenu A.");
  const fileB = await app.vault.create("Projet/Manuscrit/B.md", "---\ntitle: B\n---\nContenu B.");

  const nodeA = { id: "a", type: "file", file: fileA.path, x: 0, y: 0 };
  const nodeB = { id: "b", type: "file", file: fileB.path, x: 100, y: 0 };
  const canvas = { nodes: [nodeA, nodeB], edges: [] };

  const originalDelete = app.vault.delete.bind(app.vault);
  app.vault.delete = async () => { throw new Error("échec simulé"); };
  try {
    const result = await executeMerge(app, canvas, ["a", "b"], "a");
    assert.equal(result.ok, false);
  } finally {
    app.vault.delete = originalDelete;
  }

  const restored = await app.vault.read(fileA);
  assert.match(restored, /^---\ntitle: A\n---\nContenu A\./, "la cible doit être restaurée à son contenu d'origine");
  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/B.md") instanceof TFile, "B.md ne doit jamais avoir disparu après rollback");
  assert.equal(canvas.nodes.length, 2, "le Canvas en mémoire n'est muté qu'après succès complet, jamais touché ici");
});

// ---------------------------------------------------------------------------
// TEST 8 — Aucune edge ne déclenche jamais : déplacement Recherche,
// researchFolderLinks, création de dossier Recherche, mutation Binder.
// ---------------------------------------------------------------------------

test("TEST 8 : un graphe d'edges dense entre scènes, idées et fiches Recherche ne déclenche jamais d'effet métier", async () => {
  const { app, settings, manuscript } = makeProject();
  const neyFile = await app.vault.create("Projet/Recherche/Ney.md", "# Ney");
  const tanburFile = await app.vault.create("Projet/Recherche/Tanbur.md", "# Tanbur");

  const group = { id: "g1", type: "group", label: "Groupe", x: 0, y: 0, width: 800, height: 300 };
  const t1 = { id: "t1", type: "text", text: "Scène un", x: 10, y: 10, width: 100, height: 60 };
  const t2 = { id: "t2", type: "text", text: "Scène deux", x: 200, y: 10, width: 100, height: 60 };
  const rNey = { id: "rNey", type: "file", file: neyFile.path, x: 400, y: 10, width: 100, height: 60, feuillets_managed: "research" };
  const rTanbur = { id: "rTanbur", type: "file", file: tanburFile.path, x: 600, y: 10, width: 100, height: 60, feuillets_managed: "research" };
  const canvas = {
    nodes: [group, t1, t2, rNey, rTanbur],
    edges: [
      { id: "e1", fromNode: "g1", toNode: "rNey" },
      { id: "e2", fromNode: "rNey", toNode: "t1" },
      { id: "e3", fromNode: "rTanbur", toNode: "t1" },
      { id: "e4", fromNode: "rTanbur", toNode: "t2" },
      { id: "e5", fromNode: "t1", toNode: "t2" },
    ],
  };

  const isManuscriptPath = makeManuscriptPathChecker(app, settings);
  const admissible = admissibleChapterNodes(nodesContainedInGroup(canvas, group), isManuscriptPath);
  const plan = buildChapterPlan("Chapitre", manuscript.path, admissible, (p) => !!app.vault.getAbstractFileByPath(p));
  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.ok(result.ok);

  // Aucune fiche Recherche déplacée, aucun dossier de contexte créé, aucun
  // researchFolderLinks écrit, quel que soit le nombre/la densité des edges.
  assert.ok(app.vault.getAbstractFileByPath("Projet/Recherche/Ney.md") instanceof TFile);
  assert.ok(app.vault.getAbstractFileByPath("Projet/Recherche/Tanbur.md") instanceof TFile);
  assert.equal(app.vault.getAbstractFileByPath("Projet/Recherche/Chapitre"), null);
  assert.deepEqual(settings.projectMeta, {});
});
