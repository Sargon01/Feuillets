import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  isAdmissibleChapterNode,
  admissibleChapterNodes,
  makeManuscriptPathChecker,
  nodesContainedInGroup,
  groupNodesOf,
  defaultChapterNameForGroup,
  defaultChapterOrder,
  makeBinderIndex,
  buildChapterPlan,
  isChapterPlanError,
  executeChapterPlan,
} from "../src/services/canvas-chapter.js";

function makeProject() {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const research = new TFolder("Projet/Recherche");
  const resources = new TFolder("Projet/Ressources");
  volume.children = [manuscript, research, resources];
  manuscript.parent = volume;
  research.parent = volume;
  resources.parent = volume;

  const ch19 = new TFile("Projet/Manuscrit/Chapitre 19.md", "Contenu 19");
  const ch20 = new TFile("Projet/Manuscrit/Chapitre 20.md", "Contenu 20");
  const ch21 = new TFile("Projet/Manuscrit/Chapitre 21.md", "Contenu 21");
  manuscript.children = [ch19, ch20, ch21];
  ch19.parent = manuscript;
  ch20.parent = manuscript;
  ch21.parent = manuscript;

  const neyFiche = new TFile("Projet/Recherche/Ney.md", "Fiche Ney");
  neyFiche.parent = research;
  research.children = [neyFiche];

  const photo = new TFile("Projet/Ressources/photo.png", "");
  photo.parent = resources;
  resources.children = [photo];

  const external = new TFile("Ailleurs/Externe.md", "Externe");

  const { vault, fileManager } = createFakeVault([
    volume, manuscript, research, resources, ch19, ch20, ch21, neyFiche, photo, external,
  ]);
  const app = {
    vault,
    fileManager,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: { [manuscript.path]: ["Chapitre 19.md", "Chapitre 20.md", "Chapitre 21.md"] },
    folderPositions: {},
    labels: [],
  };
  return { app, settings, volume, manuscript, research, resources, ch19, ch20, ch21, neyFiche, photo, external };
}

function n(overrides) {
  return { id: "id", type: "text", x: 0, y: 0, width: 100, height: 100, ...overrides };
}

// ---------------------------------------------------------------------------
// Admissibilité (section 5/6, tests 1-8 de la section 25)
// ---------------------------------------------------------------------------

test("isAdmissibleChapterNode : text node toujours admissible", () => {
  const isManuscript = () => false;
  assert.equal(isAdmissibleChapterNode(n({ type: "text", text: "Une idée" }), isManuscript), true);
});

test("isAdmissibleChapterNode : file node manuscrit admissible (2)", () => {
  const { ch19 } = makeProject();
  const isManuscript = () => true;
  assert.equal(isAdmissibleChapterNode(n({ id: "a", type: "file", file: ch19.path }), isManuscript), true);
});

test("isAdmissibleChapterNode : fiche Recherche exclue (3)", () => {
  const isManuscript = () => false; // hors manuscrit
  assert.equal(isAdmissibleChapterNode(n({ id: "a", type: "file", file: "Projet/Recherche/Ney.md" }), isManuscript), false);
});

test("isAdmissibleChapterNode : fichier de Ressources exclu (4)", () => {
  const isManuscript = () => false;
  assert.equal(isAdmissibleChapterNode(n({ id: "a", type: "file", file: "Projet/Ressources/photo.png" }), isManuscript), false);
});

test("isAdmissibleChapterNode : fichier externe exclu (5)", () => {
  const isManuscript = () => false;
  assert.equal(isAdmissibleChapterNode(n({ id: "a", type: "file", file: "Ailleurs/Externe.md" }), isManuscript), false);
});

test("isAdmissibleChapterNode : link node exclu (6)", () => {
  assert.equal(isAdmissibleChapterNode(n({ id: "a", type: "link", url: "https://x" }), () => true), false);
});

test("isAdmissibleChapterNode : group node exclu (jamais admissible en tant qu'élément)", () => {
  assert.equal(isAdmissibleChapterNode(n({ id: "a", type: "group", label: "G" }), () => true), false);
});

test("makeManuscriptPathChecker : reconnaît un fichier du manuscrit actif, rejette Recherche/Ressources/externe", () => {
  const { app, settings, ch19, neyFiche, photo, external } = makeProject();
  const check = makeManuscriptPathChecker(app, settings);
  assert.equal(check(ch19.path), true);
  assert.equal(check(neyFiche.path), false);
  assert.equal(check(photo.path), false);
  assert.equal(check(external.path), false);
  assert.equal(check("Projet/Manuscrit/Inexistant.md"), false); // fichier disparu
});

// ---------------------------------------------------------------------------
// Détection géométrique d'un groupe (tests 1, 7, 8, 9, 10 de la section 25)
// ---------------------------------------------------------------------------

test("nodesContainedInGroup : détecte un text node et un file node contenus (1/2)", () => {
  const group = n({ id: "g", type: "group", x: 0, y: 0, width: 500, height: 500 });
  const text = n({ id: "t1", type: "text", text: "Idée", x: 50, y: 50, width: 100, height: 60 });
  const file = n({ id: "f1", type: "file", file: "X.md", x: 200, y: 50, width: 100, height: 60 });
  const canvas = { nodes: [group, text, file], edges: [] };
  const contained = nodesContainedInGroup(canvas, group);
  assert.deepEqual(contained.map((x) => x.id).sort(), ["f1", "t1"]);
});

test("nodesContainedInGroup : sous-groupe exclu de l'admissibilité, node hors groupe exclu (7/8)", () => {
  const group = n({ id: "g", type: "group", x: 0, y: 0, width: 500, height: 500 });
  const subGroup = n({ id: "sub", type: "group", label: "Sous-groupe", x: 50, y: 50, width: 100, height: 100 });
  const inside = n({ id: "t1", type: "text", text: "Dedans", x: 60, y: 60, width: 40, height: 40 });
  const outside = n({ id: "t2", type: "text", text: "Dehors", x: 900, y: 900, width: 40, height: 40 });
  const canvas = { nodes: [group, subGroup, inside, outside], edges: [] };

  const contained = nodesContainedInGroup(canvas, group);
  assert.ok(contained.some((x) => x.id === "t1"));
  assert.equal(contained.some((x) => x.id === "t2"), false); // hors groupe exclu

  const admissible = admissibleChapterNodes(contained, () => true);
  assert.equal(admissible.some((x) => x.id === "sub"), false); // le sous-groupe n'est jamais admissible
});

test("nodesContainedInGroup : groupe vide (9)", () => {
  const group = n({ id: "g", type: "group", x: 0, y: 0, width: 100, height: 100 });
  const outside = n({ id: "t1", type: "text", text: "Loin", x: 900, y: 900, width: 40, height: 40 });
  const canvas = { nodes: [group, outside], edges: [] };
  assert.deepEqual(nodesContainedInGroup(canvas, group), []);
});

test("defaultChapterNameForGroup : groupe sans label → chaîne vide (10)", () => {
  const group = n({ id: "g", type: "group", x: 0, y: 0, width: 100, height: 100 });
  assert.equal(defaultChapterNameForGroup(group), "");
});

test("defaultChapterNameForGroup : label → nom de chapitre (11)", () => {
  const group = n({ id: "g", type: "group", label: "Chapitre 3", x: 0, y: 0, width: 100, height: 100 });
  assert.equal(defaultChapterNameForGroup(group), "Chapitre 3");
});

test("groupNodesOf : seuls les group nodes", () => {
  const canvas = { nodes: [n({ id: "g1", type: "group" }), n({ id: "t1", type: "text" }), n({ id: "g2", type: "group" })], edges: [] };
  assert.deepEqual(groupNodesOf(canvas).map((x) => x.id), ["g1", "g2"]);
});

// ---------------------------------------------------------------------------
// Collision (12) et plan (pur)
// ---------------------------------------------------------------------------

test("buildChapterPlan : collision détectée AVANT toute mutation (12)", () => {
  const items = [n({ id: "t1", type: "text", text: "Idée" })];
  const plan = buildChapterPlan("Chapitre 3", "Projet/Manuscrit", items, (p) => p === "Projet/Manuscrit/Chapitre 3");
  assert.ok(isChapterPlanError(plan));
  assert.equal(plan.code, "collision");
  assert.equal(plan.path, "Projet/Manuscrit/Chapitre 3");
});

test("buildChapterPlan : nom vide / aucun élément → erreurs dédiées", () => {
  const items = [n({ id: "t1", type: "text", text: "Idée" })];
  assert.equal(buildChapterPlan("   ", "Projet/Manuscrit", items, () => false).code, "empty-name");
  assert.equal(buildChapterPlan("Chapitre 3", "Projet/Manuscrit", [], () => false).code, "no-items");
});

// ---------------------------------------------------------------------------
// Ordre par défaut (13-16 de la section 25)
// ---------------------------------------------------------------------------

test("defaultChapterOrder : fichiers existants → ordre spatial du Carnet, pas ordre Binder (13)", () => {
  const { app, settings, manuscript, ch19, ch20, ch21 } = makeProject();
  const binderIndex = makeBinderIndex(app, settings, manuscript);
  // Position Canvas inversée par rapport au Binder : 21 puis 20 puis 19.
  const items = [
    n({ id: "a", type: "file", file: ch21.path, x: 0, y: 0 }),
    n({ id: "b", type: "file", file: ch20.path, x: 300, y: 100 }),
    n({ id: "c", type: "file", file: ch19.path, x: 600, y: 200 }),
  ];
  const ordered = defaultChapterOrder(items, binderIndex);
  assert.deepEqual(ordered.map((x) => x.file), [ch21.path, ch20.path, ch19.path]);
});

test("defaultChapterOrder : text nodes uniquement → ordre spatial haut→bas puis gauche→droite (14)", () => {
  const a = n({ id: "a", type: "text", text: "A", x: 100, y: 0 });
  const b = n({ id: "b", type: "text", text: "B", x: 0, y: 0 });
  const c = n({ id: "c", type: "text", text: "C", x: 0, y: 100 });
  const ordered = defaultChapterOrder([a, b, c], () => 0);
  assert.deepEqual(ordered.map((x) => x.id), ["b", "a", "c"]);
});

test("defaultChapterOrder : ordre spatial déterministe à coordonnées égales (15)", () => {
  const a = n({ id: "b", type: "text", text: "B", x: 0, y: 0 });
  const b = n({ id: "a", type: "text", text: "A", x: 0, y: 0 });
  const ordered = defaultChapterOrder([a, b], () => 0);
  assert.deepEqual(ordered.map((x) => x.id), ["a", "b"]); // id départage
});

test("defaultChapterOrder : mélange fichiers existants + text nodes → même ordre spatial", () => {
  const { app, settings, manuscript, ch20, ch19 } = makeProject();
  const binderIndex = makeBinderIndex(app, settings, manuscript);
  const idea = n({ id: "idea", type: "text", text: "Nouvelle idée", x: 0, y: 0 });
  const items = [idea, n({ id: "f20", type: "file", file: ch20.path }), n({ id: "f19", type: "file", file: ch19.path })];
  const ordered = defaultChapterOrder(items, binderIndex);
  assert.deepEqual(ordered.map((x) => x.id), ["f19", "f20", "idea"]);
});

// ---------------------------------------------------------------------------
// Exécution — Binder / fichiers (section 26)
// ---------------------------------------------------------------------------

test("executeChapterPlan : crée le dossier chapitre et déplace 2 fichiers existants (1/2/17)", async () => {
  const { app, settings, manuscript, ch19, ch20 } = makeProject();
  const items = [
    { id: "f19", type: "file", file: ch19.path, x: 0, y: 0, width: 100, height: 60, color: "3", styleAttributes: { border: "invisible" }, zIndex: 5 },
    { id: "f20", type: "file", file: ch20.path, x: 200, y: 0, width: 100, height: 60 },
  ];
  const canvas = { nodes: [...items], edges: [{ id: "e1", fromNode: "f19", toNode: "f20" }] };
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, items, (p) => !!app.vault.getAbstractFileByPath(p));

  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, true);
  assert.equal(result.moved, 2);
  assert.equal(result.created, 0);

  const chapterFolder = app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 3");
  assert.ok(chapterFolder instanceof TFolder);
  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 3/Chapitre 19.md"));
  assert.ok(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 3/Chapitre 20.md"));
  // 3. aucun doublon : plus rien à l'ancien emplacement.
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 19.md"), null);
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 20.md"), null);
  // 4. contenu Markdown inchangé.
  assert.equal(ch19.content, "Contenu 19");
  assert.equal(ch20.content, "Contenu 20");

  // 17. carte Canvas : même id, position, style — seul `file` change.
  const nodeF19 = canvas.nodes.find((x) => x.id === "f19");
  assert.equal(nodeF19.file, "Projet/Manuscrit/Chapitre 3/Chapitre 19.md");
  assert.equal(nodeF19.x, 0);
  assert.equal(nodeF19.y, 0);
  assert.equal(nodeF19.color, "3");
  assert.deepEqual(nodeF19.styleAttributes, { border: "invisible" });
  assert.equal(nodeF19.zIndex, 5);
  // 21. edges strictement inchangées.
  assert.deepEqual(canvas.edges, [{ id: "e1", fromNode: "f19", toNode: "f20" }]);
});

test("executeChapterPlan : nouveau text node créé directement dans le chapitre, id neuf/style conservés (5/18/19/20)", async () => {
  const { app, settings, manuscript } = makeProject();
  const idea = {
    id: "idea1",
    type: "text",
    text: "Le meurtre du muhtar\n\nSuite du texte.",
    x: 10,
    y: 20,
    width: 300,
    height: 80,
    color: "5",
    styleAttributes: { border: "invisible" },
    dynamicHeight: true,
  };
  const canvas = { nodes: [idea], edges: [] };
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, [idea], (p) => !!app.vault.getAbstractFileByPath(p));

  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, true);
  assert.equal(result.created, 1);

  const created = app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 3/Le meurtre du muhtar.md");
  assert.ok(created);
  assert.match(created.content, /title: Le meurtre du muhtar/);
  assert.match(created.content, /Suite du texte\./);

  const convertedNode = canvas.nodes.find((x) => x.file === created.path);
  assert.ok(convertedNode);
  assert.notEqual(convertedNode.id, "idea1");
  assert.equal(canvas.nodes.some((x) => x.id === "idea1"), false);
  assert.equal(convertedNode.type, "file");
  assert.equal(convertedNode.file, created.path);
  assert.equal(convertedNode.x, 10);
  assert.equal(convertedNode.y, 20);
  assert.equal(convertedNode.color, "5");
  assert.deepEqual(convertedNode.styleAttributes, { border: "invisible" });
  assert.equal(convertedNode.dynamicHeight, true);
  assert.equal("text" in convertedNode, false);
});

test("executeChapterPlan : ordre des enfants écrit correctement, position = premier élément déplacé (6/9/13)", async () => {
  const { app, settings, manuscript, ch19, ch20 } = makeProject();
  const items = [
    { id: "f19", type: "file", file: ch19.path },
    { id: "f20", type: "file", file: ch20.path },
  ];
  const canvas = { nodes: items, edges: [] };
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, items, (p) => !!app.vault.getAbstractFileByPath(p));
  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, true);

  // 6. ordre des enfants du nouveau chapitre = ordre validé du plan.
  assert.deepEqual(settings.orders["Projet/Manuscrit/Chapitre 3"], ["Chapitre 19.md", "Chapitre 20.md"]);

  // 9. Chapitre 19/20 provenaient tous deux de Manuscrit = destination :
  //    Chapitre 3 doit prendre la position de Chapitre 19 (le 1er déplacé).
  const order = settings.orders[manuscript.path];
  assert.deepEqual(order, ["Chapitre 3", "Chapitre 21.md"]);
});

test("executeChapterPlan : ancien parent nettoyé, frères non concernés inchangés (7/8/22)", async () => {
  const { app, settings, manuscript, ch19 } = makeProject();
  // Chapitre 19 seul est déplacé — 20 et 21 restent en place et ne doivent
  // jamais être réordonnés entre eux.
  const items = [{ id: "f19", type: "file", file: ch19.path }];
  const untouchedGroup = { id: "g1", type: "group", label: "Réf" };
  const canvas = { nodes: [...items, untouchedGroup], edges: [] };
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, items, (p) => !!app.vault.getAbstractFileByPath(p));
  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, true);

  const order = settings.orders[manuscript.path];
  assert.equal(order.includes("Chapitre 19.md"), false); // 7. plus de nom fantôme
  assert.ok(order.includes("Chapitre 20.md"));
  assert.ok(order.includes("Chapitre 21.md"));
  assert.equal(order.indexOf("Chapitre 20.md") < order.indexOf("Chapitre 21.md"), true); // 8. frères non réordonnés entre eux
  // 22. élément non retenu strictement inchangé.
  assert.deepEqual(canvas.nodes.find((x) => x.id === "g1"), untouchedGroup);
});

test("executeChapterPlan : collision → aucune mutation (10)", async () => {
  const { app, manuscript, ch19 } = makeProject();
  await app.vault.createFolder("Projet/Manuscrit/Chapitre 3");
  const items = [{ id: "f19", type: "file", file: ch19.path }];
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, items, (p) => !!app.vault.getAbstractFileByPath(p));
  assert.ok(isChapterPlanError(plan));
  assert.equal(plan.code, "collision");
  // Rien n'a été déplacé : le fichier est toujours à sa place.
  assert.ok(app.vault.getAbstractFileByPath(ch19.path));
});

test("executeChapterPlan : échec de déplacement → rollback complet (11)", async () => {
  const { app, settings, manuscript, ch19, ch20 } = makeProject();
  const originalRename = app.fileManager.renameFile;
  let calls = 0;
  app.fileManager.renameFile = async (file, path) => {
    calls++;
    if (calls === 2) throw new Error("échec simulé");
    return originalRename(file, path);
  };
  const items = [
    { id: "f19", type: "file", file: ch19.path },
    { id: "f20", type: "file", file: ch20.path },
  ];
  const canvas = { nodes: items, edges: [] };
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, items, (p) => !!app.vault.getAbstractFileByPath(p));

  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, false);

  // Rollback : Chapitre 19 replacé, dossier vide supprimé, aucune trace.
  assert.ok(app.vault.getAbstractFileByPath(ch19.path));
  assert.ok(app.vault.getAbstractFileByPath(ch20.path));
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 3"), null);
  // Le node Canvas n'a jamais été touché.
  assert.equal(canvas.nodes.find((x) => x.id === "f19").file, ch19.path);
});

test("executeChapterPlan : échec de création d'un nouveau feuillet → rollback, contenu jamais perdu (12/14)", async () => {
  const { app, settings, manuscript, ch19 } = makeProject();
  const originalCreate = app.vault.create;
  app.vault.create = async (path, content) => {
    if (path.includes("Nouvelle idée")) throw new Error("échec simulé");
    return originalCreate(path, content);
  };
  const idea = { id: "idea1", type: "text", text: "Nouvelle idée à tester" };
  const items = [{ id: "f19", type: "file", file: ch19.path }, idea];
  const canvas = { nodes: items, edges: [] };
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, items, (p) => !!app.vault.getAbstractFileByPath(p));

  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, false);

  // Chapitre 19 replacé, dossier supprimé.
  assert.ok(app.vault.getAbstractFileByPath(ch19.path));
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 3"), null);
  // 14. le text node original n'a jamais été touché — le texte n'est jamais perdu.
  const untouchedIdea = canvas.nodes.find((x) => x.id === "idea1");
  assert.equal(untouchedIdea.type, "text");
  assert.equal(untouchedIdea.text, "Nouvelle idée à tester");
});

test("executeChapterPlan : échec Canvas avant validation finale (node disparu) → aucune mutation (13)", async () => {
  const { app, settings, manuscript, ch19 } = makeProject();
  const items = [{ id: "f19", type: "file", file: ch19.path }];
  // Le node référencé dans le plan n'existe plus dans le canvas courant.
  const canvas = { nodes: [], edges: [] };
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, items, (p) => !!app.vault.getAbstractFileByPath(p));

  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, false);
  assert.equal(app.vault.getAbstractFileByPath("Projet/Manuscrit/Chapitre 3"), null);
  assert.ok(app.vault.getAbstractFileByPath(ch19.path)); // jamais déplacé
});

// ---------------------------------------------------------------------------
// Non-admissibles jamais déplacés (23/24) + un seul élément (25/26/27)
// ---------------------------------------------------------------------------

test("executeChapterPlan : note Recherche et fichier externe ne sont jamais candidats (23/24)", () => {
  const { neyFiche, external } = makeProject();
  const isManuscript = () => false;
  const nodes = [
    n({ id: "r", type: "file", file: neyFiche.path }),
    n({ id: "e", type: "file", file: external.path }),
  ];
  assert.deepEqual(admissibleChapterNodes(nodes, isManuscript), []);
});

test("un chapitre peut être créé avec un seul élément depuis un groupe (25)", async () => {
  const { app, settings, manuscript, ch19 } = makeProject();
  const items = [{ id: "f19", type: "file", file: ch19.path }];
  const canvas = { nodes: items, edges: [] };
  const plan = buildChapterPlan("Chapitre 3", manuscript.path, items, (p) => !!app.vault.getAbstractFileByPath(p));
  assert.equal(isChapterPlanError(plan), false);
  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, true);
  assert.equal(result.moved, 1);
});

test("sélection libre d'un seul élément admissible ne doit pas proposer l'action chapitre (26)", () => {
  const nodes = [n({ id: "t1", type: "text", text: "Seule idée" })];
  const admissible = admissibleChapterNodes(nodes, () => true);
  assert.equal(admissible.length < 2, true); // c'est à l'appelant (adaptateur) de ne pas proposer l'action
});

test("sélection libre de 2 éléments admissibles permet l'action chapitre (27)", () => {
  const nodes = [n({ id: "t1", type: "text", text: "Idée 1" }), n({ id: "t2", type: "text", text: "Idée 2" })];
  const admissible = admissibleChapterNodes(nodes, () => true);
  assert.equal(admissible.length >= 2, true);
});

// ---------------------------------------------------------------------------
// Section 28 : absence de synchronisation après création
// ---------------------------------------------------------------------------

test("après création, aucune synchronisation groupe ↔ Binder (section 28, invariant central du Lot 2)", async () => {
  const { app, settings, manuscript, ch19, ch20, ch21 } = makeProject();
  const group = { id: "g", type: "group", label: "Chapitre test", x: 0, y: 0, width: 400, height: 200 };
  const nodeA = { id: "a", type: "file", file: ch19.path, x: 10, y: 10, width: 100, height: 60 };
  const nodeB = { id: "b", type: "file", file: ch20.path, x: 200, y: 10, width: 100, height: 60 };
  const nodeC = { id: "c", type: "file", file: ch21.path, x: 900, y: 900, width: 100, height: 60 }; // hors groupe
  const canvas = { nodes: [group, nodeA, nodeB, nodeC], edges: [] };

  const contained = nodesContainedInGroup(canvas, group);
  const admissible = admissibleChapterNodes(contained, makeManuscriptPathChecker(app, settings));
  const plan = buildChapterPlan("Chapitre test", manuscript.path, admissible, (p) => !!app.vault.getAbstractFileByPath(p));
  const result = await executeChapterPlan(app, settings, canvas, plan);
  assert.equal(result.ok, true);

  const binderOf = () => [...(settings.orders["Projet/Manuscrit/Chapitre test"] || [])];
  assert.deepEqual(binderOf(), ["Chapitre 19.md", "Chapitre 20.md"]);

  // Le Carnet évolue librement : B sort géométriquement du groupe (déplacé
  // très loin), C entre dans le groupe. Aucun "service de synchronisation"
  // n'existe dans Feuillets — relancer generateCanvasBoard (Lot 1) ne
  // touche jamais à settings.orders/aux dossiers, donc rien à observer ici
  // d'autre que : le Binder reste rigoureusement identique.
  nodeB.x = 900;
  nodeB.y = 900;
  const cNodeOnCanvas = canvas.nodes.find((x) => x.id === "c");
  cNodeOnCanvas.x = 10;
  cNodeOnCanvas.y = 10;

  assert.deepEqual(binderOf(), ["Chapitre 19.md", "Chapitre 20.md"]);

  // Aucun champ de liaison n'a jamais été posé sur le groupe ou les nodes.
  for (const forbidden of ["feuillets_chapter_path", "chapter_id", "linked_chapter", "managed_group", "sync_group"]) {
    assert.equal(forbidden in group, false);
    assert.equal(forbidden in nodeA, false);
  }
});
