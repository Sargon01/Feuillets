import test from "node:test";
import assert from "node:assert/strict";
import { TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  textNodesOf,
  sortNodesSpatially,
  firstMeaningfulLine,
  deriveTitle,
  bodyAfterTitle,
  safeFileName,
  uniqueFileName,
  convertTextNodeToFileNode,
  manuscriptSheetContent,
  researchNoteContent,
  applySelectedIdeas,
} from "../src/services/canvas-bridge.js";

function canvasWith(nodes, edges = []) {
  return { nodes, edges };
}

// 1/2. extraction des text nodes, exclusion file/group/link
test("textNodesOf : ne garde que les text nodes", () => {
  const canvas = canvasWith([
    { id: "t1", type: "text", text: "Idée" },
    { id: "f1", type: "file", file: "X.md" },
    { id: "g1", type: "group", label: "Groupe" },
    { id: "l1", type: "link", url: "https://x" },
  ]);
  const result = textNodesOf(canvas);
  assert.deepEqual(result.map((n) => n.id), ["t1"]);
});

// 3/4. tri spatial haut→bas puis gauche→droite, déterministe à égalité
test("sortNodesSpatially : haut→bas puis gauche→droite, id en dernier recours", () => {
  const nodes = [
    { id: "c", type: "text", text: "C", x: 0, y: 100 },
    { id: "a", type: "text", text: "A", x: 100, y: 0 },
    { id: "b", type: "text", text: "B", x: 0, y: 0 },
    { id: "d", type: "text", text: "D", x: 0, y: 0 }, // égalité stricte avec b : id départage
  ];
  const sorted = sortNodesSpatially(nodes);
  assert.deepEqual(sorted.map((n) => n.id), ["b", "d", "a", "c"]);
});

// 5. première ligne significative → titre / 6. nettoyage des marqueurs Markdown
test("deriveTitle : retire les marqueurs Markdown évidents en tête de ligne, jamais le contenu", () => {
  assert.equal(deriveTitle("# Le meurtre du muhtar"), "Le meurtre du muhtar");
  assert.equal(deriveTitle("- Une idée en liste"), "Une idée en liste");
  assert.equal(deriveTitle("* Une autre idée"), "Une autre idée");
  assert.equal(deriveTitle("1. Idée numérotée"), "Idée numérotée");
  assert.equal(deriveTitle("> Idée citée"), "Idée citée");
  assert.equal(deriveTitle("Un titre avec une * étoile au milieu"), "Un titre avec une * étoile au milieu");
});

test("firstMeaningfulLine : première ligne non vide", () => {
  assert.equal(firstMeaningfulLine("\n\n  \nPremière vraie ligne\nSuite"), "Première vraie ligne");
  assert.equal(firstMeaningfulLine(""), "");
});

// 21/22. idée multiligne → titre + corps ; idée une ligne → titre + corps vide
test("bodyAfterTitle : tout ce qui suit la première ligne significative, vide si une seule ligne", () => {
  assert.equal(bodyAfterTitle("Titre\n\nDeuxième paragraphe\nTroisième ligne"), "Deuxième paragraphe\nTroisième ligne");
  assert.equal(bodyAfterTitle("Une idée toute seule"), "");
});

// 7. nom de fichier sûr
test("safeFileName : retire les caractères interdits, jamais vide", () => {
  assert.equal(safeFileName('Titre "cité" / sous-titre'), "Titre -cité- - sous-titre");
  assert.equal(safeFileName("   "), "Idée");
});

// 8. collision Nom.md, Nom 2.md, Nom 3.md
test("uniqueFileName : gère les collisions successives", () => {
  const taken = new Set(["Projet/Idées/Titre.md", "Projet/Idées/Titre 2.md"]);
  const path = uniqueFileName((p) => taken.has(p), "Projet/Idées", "Titre");
  assert.equal(path, "Projet/Idées/Titre 3.md");

  const free = uniqueFileName(() => false, "Projet/Idées", "Autre titre");
  assert.equal(free, "Projet/Idées/Autre titre.md");
});

// 9-15. text node → file node : id/x/y/width/height/color/styleAttributes inchangés,
// propriété Advanced Canvas inconnue conservée, champ text retiré
test("convertTextNodeToFileNode : conserve tout, ne change que type/file/feuillets_managed", () => {
  const node = {
    id: "abc",
    type: "text",
    text: "Le meurtre du muhtar",
    x: 100,
    y: 250,
    width: 300,
    height: 80,
    color: "4",
    styleAttributes: { border: "invisible" },
    dynamicHeight: true,
  };
  const converted = convertTextNodeToFileNode(node, "Manuscrit/Chapitre 4/Le meurtre du muhtar.md", "manuscript");

  assert.equal(converted.id, "abc");
  assert.equal(converted.type, "file");
  assert.equal(converted.file, "Manuscrit/Chapitre 4/Le meurtre du muhtar.md");
  assert.equal(converted.feuillets_managed, "manuscript");
  assert.equal(converted.x, 100);
  assert.equal(converted.y, 250);
  assert.equal(converted.width, 300);
  assert.equal(converted.height, 80);
  assert.equal(converted.color, "4");
  assert.deepEqual(converted.styleAttributes, { border: "invisible" });
  assert.equal(converted.dynamicHeight, true);
  assert.equal("text" in converted, false);
});

// 23/24. note de recherche / feuillet créés sans YAML métier, avec le minimum indispensable
test("manuscriptSheetContent / researchNoteContent : seul `title` est écrit, aucun champ métier", () => {
  const content = manuscriptSheetContent("Le meurtre du muhtar", "Il pleuvait sur la place.");
  assert.match(content, /^---\ntitle: Le meurtre du muhtar\n---\n\n/);
  assert.match(content, /Il pleuvait sur la place\./);
  for (const forbidden of ["status:", "label:", "characters:", "pov:", "thread:", "date:", "arc:"]) {
    assert.equal(content.includes(forbidden), false, `${forbidden} ne doit pas apparaître`);
  }

  const research = researchNoteContent("Une piste", "Notes libres.");
  assert.match(research, /^---\ntitle: Une piste\n---\n\n/);
  assert.equal(research.includes("tags:"), false);
});

function makeCanvasFixture() {
  const root = new TFolder("Projet/Manuscrit");
  const idees = new TFolder("Projet/Manuscrit/Chapitre 1");
  root.children = [idees];
  idees.parent = root;
  const { vault } = createFakeVault([root, idees]);
  const app = { vault };
  return { app, destFolder: idees };
}

// applySelectedIdeas : orchestration App-aware (18-20)
test("applySelectedIdeas : convertit uniquement les ids sélectionnés, dans l'ordre donné, ignore le reste", async () => {
  const { app, destFolder } = makeCanvasFixture();
  const untouchedFile = { id: "file-1", type: "file", file: "Ailleurs.md" };
  const untouchedGroup = { id: "group-1", type: "group" };
  const canvas = canvasWith(
    [
      { id: "idea-b", type: "text", text: "Idée B\n\nCorps B" },
      { id: "idea-a", type: "text", text: "Idée A\n\nCorps A" },
      untouchedFile,
      untouchedGroup,
    ],
    [{ id: "e1", fromNode: "idea-a", toNode: "idea-b" }]
  );

  // Ordre manuel demandé : B avant A, malgré leur ordre dans le tableau.
  const result = await applySelectedIdeas(app, canvas, ["idea-b", "idea-a"], destFolder, "manuscript");

  assert.equal(result.created, 2);
  assert.equal(result.skippedIds.length, 0);

  const nodeB = canvas.nodes.find((n) => n.id === "idea-b");
  const nodeA = canvas.nodes.find((n) => n.id === "idea-a");
  assert.equal(nodeB.type, "file");
  assert.equal(nodeA.type, "file");
  assert.equal(nodeB.file, "Projet/Manuscrit/Chapitre 1/Idée B.md");
  assert.equal(nodeA.file, "Projet/Manuscrit/Chapitre 1/Idée A.md");
  assert.equal(nodeB.feuillets_managed, "manuscript");

  // 17. edges strictement inchangées.
  assert.deepEqual(canvas.edges, [{ id: "e1", fromNode: "idea-a", toNode: "idea-b" }]);
  // 18. node non sélectionné strictement inchangé.
  assert.deepEqual(canvas.nodes.find((n) => n.id === "file-1"), untouchedFile);
  assert.deepEqual(canvas.nodes.find((n) => n.id === "group-1"), untouchedGroup);

  const bContent = await app.vault.read(await app.vault.getAbstractFileByPath(nodeB.file));
  assert.match(bContent, /title: Idée B/);
  assert.match(bContent, /Corps B/);
});

// 19. un file node n'est jamais reconverti
test("applySelectedIdeas : ignore un id déjà file node ou introuvable", async () => {
  const { app, destFolder } = makeCanvasFixture();
  const alreadyFile = { id: "already", type: "file", file: "Existe.md" };
  const canvas = canvasWith([alreadyFile]);

  const result = await applySelectedIdeas(app, canvas, ["already", "inconnu"], destFolder, "research");

  assert.equal(result.created, 0);
  assert.deepEqual(result.skippedIds, ["already", "inconnu"]);
  assert.deepEqual(canvas.nodes[0], alreadyFile);
});
