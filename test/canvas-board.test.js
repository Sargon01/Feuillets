import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { generateCanvasBoard } from "../src/services/canvas-board.js";

function makeProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "Première scène");
  const second = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", "Seconde scène");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [first, second];
  first.parent = chapter;
  second.parent = chapter;

  const { vault } = createFakeVault([volume, manuscript, chapter, first, second]);
  const frontmatter = new Map([
    [first.path, { label: "Rouge", thread: "Intrigue" }],
    [second.path, { label: "Rouge", thread: "Intrigue" }],
  ]);
  const app = {
    vault,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatter.get(file.path) || {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    labels: [{ name: "Rouge", color: "#ff0000" }],
  };
  return { app, settings, manuscript, chapter, first, second, vault };
}

test("generateCanvasBoard : crée les cartes de scènes et préserve leur position", async () => {
  const { app, settings } = makeProject();

  const firstRun = await generateCanvasBoard(app, settings);
  assert.equal(firstRun.added, 2);
  assert.equal(firstRun.edgesAdded, 1);

  const before = JSON.parse(await app.vault.read(firstRun.file));
  before.nodes[0].x = 777;
  await app.vault.modify(firstRun.file, JSON.stringify(before));

  const secondRun = await generateCanvasBoard(app, settings);
  const after = JSON.parse(await app.vault.read(secondRun.file));
  assert.equal(secondRun.added, 0);
  assert.equal(secondRun.edgesAdded, 1);
  assert.equal(after.nodes[0].x, 777);
});

test("generateCanvasBoard : n'ajoute une nouvelle scène qu'une seule fois (pas de doublon)", async () => {
  const { app, settings, chapter } = makeProject();
  await generateCanvasBoard(app, settings);

  const third = new TFile("Projet/Manuscrit/Chapitre 1/Scène 3.md", "Troisième scène");
  third.parent = chapter;
  chapter.children.push(third);

  const run = await generateCanvasBoard(app, settings);
  assert.equal(run.added, 1);
  const data = JSON.parse(await app.vault.read(run.file));
  const sceneNodes = data.nodes.filter((n) => n.type === "file" && n.file?.includes("Scène"));
  assert.equal(sceneNodes.length, 3);

  const again = await generateCanvasBoard(app, settings);
  assert.equal(again.added, 0);
});

test("generateCanvasBoard : additif — ne supprime, ne déplace, ne redimensionne jamais un élément de l'autrice", async () => {
  const { app, settings } = makeProject();

  const firstRun = await generateCanvasBoard(app, settings);
  const seeded = JSON.parse(await app.vault.read(firstRun.file));
  const [sceneNodeA, sceneNodeB] = seeded.nodes.filter((n) => n.type === "file");

  // 3. text node manuel
  const manualText = { id: "manual-text-1", type: "text", text: "Une idée libre", x: 1000, y: 1000, width: 250, height: 60 };
  // 4. file node externe au manuscrit
  const externalFile = { id: "ext-file-1", type: "file", file: "Ailleurs/Externe.md", x: 1300, y: 1000, width: 200, height: 80 };
  // 5. file node Recherche
  const researchFile = { id: "research-file-1", type: "file", file: "Projet/Recherche/Personnage.md", x: 1600, y: 1000, width: 200, height: 80 };
  // 6. link node
  const linkNode = { id: "link-1", type: "link", url: "https://example.com", x: 1000, y: 1300, width: 400, height: 200 };
  // 7. group node
  const groupNode = { id: "group-1", type: "group", label: "Idées vagues", x: 1000, y: 1600, width: 600, height: 300 };
  seeded.nodes.push(manualText, externalFile, researchFile, linkNode, groupNode);

  // 9/10. styleAttributes et zIndex inconnus (ex. Advanced Canvas) sur une carte de scène gérée
  sceneNodeA.styleAttributes = { border: "invisible" };
  sceneNodeA.zIndex = 5;

  // 8. edge manuelle (aucun marqueur Feuillets)
  const manualEdge = { id: "manual-edge-1", fromNode: manualText.id, toNode: externalFile.id };
  // 15. edge manuelle dont le label correspond au nom d'un fil — ne doit jamais être confondue avec une arête générée
  const manualEdgeSameLabel = { id: "manual-edge-label-collision", fromNode: manualText.id, toNode: groupNode.id, label: "Intrigue" };
  // 13. ancienne arête de fil (marqueur hérité "fil"), à la place de celle que generateCanvasBoard vient de poser
  seeded.edges = seeded.edges.filter((e) => e.feuillets_managed !== "thread");
  const legacyThreadEdge = { id: "legacy-thread-edge", fromNode: sceneNodeA.id, toNode: sceneNodeB.id, fil: "Intrigue", label: "Intrigue" };
  seeded.edges.push(manualEdge, manualEdgeSameLabel, legacyThreadEdge);

  await app.vault.modify(firstRun.file, JSON.stringify(seeded));

  const run = await generateCanvasBoard(app, settings);
  const data = JSON.parse(await app.vault.read(run.file));
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(data.edges.map((e) => [e.id, e]));

  assert.equal(run.added, 0);

  // Rien n'a été supprimé.
  for (const kept of [manualText, externalFile, researchFile, linkNode, groupNode]) {
    assert.deepEqual(byId.get(kept.id), kept, `${kept.id} doit rester strictement inchangé`);
  }

  // 9/10. styleAttributes/zIndex inconnus toujours là après resynchronisation de la carte.
  const refreshedSceneA = byId.get(sceneNodeA.id);
  assert.equal(refreshedSceneA.styleAttributes.border, "invisible");
  assert.equal(refreshedSceneA.zIndex, 5);

  // 12. nodes manuscrit marqués.
  assert.equal(refreshedSceneA.feuillets_managed, "manuscript");
  assert.equal(byId.get(sceneNodeB.id).feuillets_managed, "manuscript");

  // 8. edge manuelle conservée telle quelle.
  assert.deepEqual(edgeById.get(manualEdge.id), manualEdge);
  // 15. edge manuelle au label coïncident conservée telle quelle.
  assert.deepEqual(edgeById.get(manualEdgeSameLabel.id), manualEdgeSameLabel);

  // 13/14. l'ancienne arête "fil" a été reconnue comme gérée par Feuillets et reconstruite —
  // elle disparaît, une seule arête feuillets_managed:"thread" équivalente la remplace.
  assert.equal(edgeById.has(legacyThreadEdge.id), false);
  const rebuiltThreadEdges = data.edges.filter((e) => e.feuillets_managed === "thread");
  assert.equal(rebuiltThreadEdges.length, 1);
  assert.equal(rebuiltThreadEdges[0].fromNode, sceneNodeA.id);
  assert.equal(rebuiltThreadEdges[0].toNode, sceneNodeB.id);
  assert.equal(rebuiltThreadEdges[0].label, "Intrigue");

  // Aucun doublon de carte de scène.
  const sceneNodes = data.nodes.filter((n) => n.type === "file" && n.file?.includes("Scène"));
  assert.equal(sceneNodes.length, 2);
});
