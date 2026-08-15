import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { ScriveningsView, nextScrollAnchorAfterRecomposition } from "../src/views/scrivenings-view.js";
import { createSelectionScope } from "../src/services/compile-scope.js";

/* Lot 2B.2 — Continu dynamique : composition (§2, §4), sécurité anti-perte
 * (§3) et préservation de la position de lecture (§5). `ScriveningsView`
 * hérite du stub `ItemView` (test/obsidian-runtime-stub.mjs), qui ne
 * demande qu'un objet `{ app, contentEl }` en guise de leaf — `mountEditor`/
 * `destroyEditor` (privés à la compilation, simples champs à l'exécution)
 * sont remplacés par des espions : ce fichier teste la logique de
 * composition/sécurité/ancre, jamais un vrai CodeMirror (déjà couvert par
 * cm-scrivenings*.test.js et cm-scrivenings-scroll.test.js). */

let nextTimerId = 1;
globalThis.window = {
  // Un seul passage : suffit à vérifier que la restauration a bien lieu
  // sans dupliquer artificiellement les assertions sur une 2e frame.
  requestAnimationFrame: () => 0,
  // ScriveningsSession programme une sauvegarde différée (setTimeout) à
  // chaque handleChanges() — jamais déclenchée ici : ces tests appellent
  // flush()/openScope() directement, sans attendre le minuteur.
  setTimeout: () => nextTimerId++,
  clearTimeout: () => {},
};

function buildProject() {
  const root = new TFolder("Roman/Manuscrit");
  const a = new TFile("Roman/Manuscrit/A.md", "Corps A original.");
  const b = new TFile("Roman/Manuscrit/B.md", "Corps B.");
  const c = new TFile("Roman/Manuscrit/C.md", "Corps C.");
  root.children = [a, b, c];
  a.parent = root;
  b.parent = root;
  c.parent = root;

  const { vault } = createFakeVault([root, a, b, c]);
  // `workspace.setActiveLeaf` : requis par `openSingleMember`/`setMembers`
  // (LOT FINAL Binder ↔ Continu, §4/§6) — même patron que
  // `collapseToSingleMember`, déjà présent avant ce lot. Jamais utilisé par
  // les tests de composition/sécurité/ancre existants ci-dessous.
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    workspace: { setActiveLeaf: () => {} },
  };
  const settings = {
    projectFolder: root.path,
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
  };
  return { root, a, b, c, app, settings };
}

function buildView() {
  const project = buildProject();
  const statusBar = { count: 0 };
  const plugin = { app: project.app, settings: project.settings, updateStatusBar: () => { statusBar.count++; } };
  // `leaf.openFile` : requis par `openSingleMember`/`setMembers` à 1 chemin
  // (§4/§6) — enregistre les fichiers ouverts sur CETTE leaf, jamais une
  // autre (voir les tests dédiés plus bas).
  const openedOnLeaf = [];
  const leaf = { app: project.app, contentEl: null, openFile: async (file) => { openedOnLeaf.push(file.path); } };
  const view = new ScriveningsView(leaf, plugin);
  const mounts = { mount: 0, destroy: 0 };
  view.mountEditor = () => { mounts.mount++; };
  view.destroyEditor = () => { mounts.destroy++; };
  return { ...project, view, plugin, mounts, statusBar, openedOnLeaf };
}

/* ===================== Composition = fichiers concrets (§2) ===================== */

test("getMemberPaths/hasMember reflètent exactement les segments réels après openScope", async () => {
  const { view, a, b, root } = buildView();
  const ok = await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  assert.equal(ok, true);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path]);
  assert.equal(view.hasMember(a.path), true);
  assert.equal(view.hasMember("Roman/Manuscrit/Inconnu.md"), false);
});

test("toggleMember : ajoute un fichier extérieur au dossier initial, ordre Binder respecté", async () => {
  const { view, a, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path]));

  const applied = await view.toggleMember(c.path);

  assert.equal(applied, true);
  assert.deepEqual(view.getMemberPaths(), [a.path, c.path]);
  assert.equal(view.compileScope.type, "selection");
});

test("toggleMember : retrait du dernier fichier autorise une sélection vide, Continu reste ouvert", async () => {
  const { view, a, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path]));

  const applied = await view.toggleMember(a.path);

  assert.equal(applied, true);
  assert.deepEqual(view.getMemberPaths(), []);
  assert.equal(view.compileScope.type, "selection");
});

test("toggleMember : ajout depuis une sélection vide fonctionne", async () => {
  const { view, b, root } = buildView();
  await view.openScope(createSelectionScope(root.path, []));

  const applied = await view.toggleMember(b.path);

  assert.equal(applied, true);
  assert.deepEqual(view.getMemberPaths(), [b.path]);
});

test("toggleMember : aucun doublon — retirer un chemin déjà membre plutôt que de l'ajouter deux fois", async () => {
  const { view, a, b, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  await view.toggleMember(a.path);

  assert.deepEqual(view.getMemberPaths(), [b.path]);
});

/* ===================== setMembers (LOT FINAL Binder ↔ Continu, §6) ===== */

test("setMembers : 2+ chemins — remplace toute la composition en une recomposition, ordre Binder, dédoublonné", async () => {
  const { view, a, b, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path]));

  const applied = await view.setMembers([c.path, a.path, b.path, c.path]);

  assert.equal(applied, true);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path, c.path], "ordre Binder, jamais l'ordre reçu, jamais de doublon");
});

test("setMembers : peut RÉDUIRE la composition (Maj+clic qui rétrécit une plage, §5/§7)", async () => {
  const { view, a, b, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path, c.path]));

  const applied = await view.setMembers([a.path, b.path]);

  assert.equal(applied, true);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path]);
});

test("setMembers : 1 chemin résolu — ouvre CE fichier seul sur la MÊME leaf, jamais un Continu à 1 segment", async () => {
  const { view, a, b, root, openedOnLeaf } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  const applied = await view.setMembers([b.path]);

  assert.equal(applied, true);
  assert.deepEqual(openedOnLeaf, [b.path], "ouvert sur la leaf de CETTE ScriveningsView, jamais ailleurs");
});

test("setMembers : 0 chemin résolu — refuse, conserve la composition actuelle telle quelle", async () => {
  const { view, a, b, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  const applied = await view.setMembers([]);

  assert.equal(applied, false);
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path], "composition précédente intacte");
});

test("setMembers : sérialisée via mutationQueue — pas d'interblocage même en résolvant à 1 chemin (openSingleMember interne)", async () => {
  const { view, a, b, root, openedOnLeaf } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  // Deux appels rapides, le second résolvant à 1 seul chemin : ne doit
  // jamais rester bloqué (voir performOpenSingleMember, appelé en interne
  // par performSetMembers, jamais via le wrapper public openSingleMember).
  const p1 = view.setMembers([a.path, b.path]);
  const p2 = view.setMembers([b.path]);
  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(r1, true);
  assert.equal(r2, true);
  assert.deepEqual(openedOnLeaf, [b.path]);
});

/* ===================== openSingleMember (LOT FINAL, §4) ===================== */

test("openSingleMember : ouvre le fichier demandé sur la MÊME leaf, indépendamment de la composition actuelle", async () => {
  const { view, a, b, c, root, openedOnLeaf } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path, c.path]));

  // `c` fait partie du groupe ET on ouvre un fichier non-membre du tout :
  // openSingleMember ne consulte jamais l'appartenance préalable (§3-4).
  const appliedMember = await view.openSingleMember(c.path);
  assert.equal(appliedMember, true);
  assert.deepEqual(openedOnLeaf, [c.path]);
});

test("openSingleMember : chemin invalide (fichier inexistant) — refuse, aucune ouverture", async () => {
  const { view, a, root, openedOnLeaf } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path]));

  const applied = await view.openSingleMember("Roman/Manuscrit/Fantome.md");

  assert.equal(applied, false);
  assert.deepEqual(openedOnLeaf, []);
});

/* ===================== Sécurité anti-perte (§3) ===================== */

test("sécurité : un conflit externe pendant le flush bloque le changement de composition et conserve le texte local", async () => {
  const { view, a, b, mounts } = buildView();
  await view.openScope(createSelectionScope(a.parent.path, [a.path, b.path]));
  assert.equal(mounts.mount, 1);
  const destroyCountAfterFirstOpen = mounts.destroy;

  // Édition locale non sauvegardée dans Continu.
  const doc = view.session.document;
  view.session.handleChanges([{ from: 0, to: doc.segments[0].to, insert: "Édition locale jamais perdue" }]);

  // Conflit externe : le fichier change ailleurs avant que le flush ne parte.
  a.content = "Modifié ailleurs entretemps";

  const applied = await view.toggleMember(b.path);

  assert.equal(applied, false, "le changement de composition doit être bloqué");
  assert.equal(view.session.dirtyCount > 0, true, "le chemin en conflit doit rester dirty");
  assert.equal(
    view.session.document.segments[0].body,
    "Édition locale jamais perdue",
    "le texte local ne doit jamais être perdu"
  );
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path], "la composition affichée reste inchangée");
  assert.equal(mounts.destroy, destroyCountAfterFirstOpen, "l'éditeur vivant ne doit jamais être détruit sur un conflit");
  assert.equal(mounts.mount, 1, "aucun nouveau scope ne doit être monté");
});

test("sécurité : openSingleMember bloqué par un conflit externe — texte local conservé, aucune ouverture de leaf (LOT FINAL §3-4)", async () => {
  const { view, a, b, mounts, openedOnLeaf } = buildView();
  await view.openScope(createSelectionScope(a.parent.path, [a.path, b.path]));
  const destroyCountAfterFirstOpen = mounts.destroy;

  const doc = view.session.document;
  view.session.handleChanges([{ from: 0, to: doc.segments[0].to, insert: "Édition locale jamais perdue" }]);
  a.content = "Modifié ailleurs entretemps";

  const applied = await view.openSingleMember(b.path);

  assert.equal(applied, false, "clic simple bloqué par le conflit, exactement comme les autres mutations");
  assert.equal(view.session.dirtyCount > 0, true);
  assert.equal(view.session.document.segments[0].body, "Édition locale jamais perdue");
  assert.deepEqual(view.getMemberPaths(), [a.path, b.path], "Continu reste ouvert, composition inchangée");
  assert.deepEqual(openedOnLeaf, [], "aucun fichier ouvert sur la leaf tant que le conflit persiste");
  assert.equal(mounts.destroy, destroyCountAfterFirstOpen, "l'éditeur vivant n'est jamais détruit sur un conflit");
});

/* ===================== Clics rapides sérialisés (§4) ===================== */

test("concurrence : deux toggles rapides sont sérialisés, l'état final contient les DEUX opérations dans l'ordre d'arrivée", async () => {
  const { view, a, b, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path]));

  const p1 = view.toggleMember(a.path); // retiré
  const p2 = view.toggleMember(c.path); // puis ajouté
  const [r1, r2] = await Promise.all([p1, p2]);

  assert.equal(r1, true);
  assert.equal(r2, true);
  assert.deepEqual(view.getMemberPaths(), [b.path, c.path]);
});

/* ===================== Position de lecture (§5) ===================== */

test("ancre : retrait d'un AUTRE feuillet conserve path + progress à l'identique", async () => {
  const { view, a, b, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path, c.path]));

  view.getScrollAnchor = () => ({ path: b.path, progress: 0.42 });
  const calls = [];
  view.scrollToAnchor = (path, progress) => calls.push({ path, progress });

  await view.toggleMember(a.path);

  assert.deepEqual(calls, [{ path: b.path, progress: 0.42 }]);
});

test("ancre : ajout d'un feuillet avant la position courante conserve path + progress", async () => {
  const { view, a, b, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [b.path, c.path]));

  view.getScrollAnchor = () => ({ path: c.path, progress: 0.9 });
  const calls = [];
  view.scrollToAnchor = (path, progress) => calls.push({ path, progress });

  await view.toggleMember(a.path); // ajouté AVANT b et c dans l'ordre Binder

  assert.deepEqual(view.getMemberPaths(), [a.path, b.path, c.path]);
  assert.deepEqual(calls, [{ path: c.path, progress: 0.9 }]);
});

test("ancre : retrait du feuillet courant restaure sur le SUIVANT encore présent, progress = 0", async () => {
  const { view, a, b, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path, c.path]));

  view.getScrollAnchor = () => ({ path: b.path, progress: 0.7 });
  const calls = [];
  view.scrollToAnchor = (path, progress) => calls.push({ path, progress });

  await view.toggleMember(b.path); // retire le feuillet courant lui-même

  assert.deepEqual(view.getMemberPaths(), [a.path, c.path]);
  assert.deepEqual(calls, [{ path: c.path, progress: 0 }]);
});

test("ancre : retrait du feuillet courant SANS suivant restaure sur le PRÉCÉDENT, progress = 0", async () => {
  const { view, a, b, c, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path, b.path, c.path]));

  view.getScrollAnchor = () => ({ path: c.path, progress: 0.2 });
  const calls = [];
  view.scrollToAnchor = (path, progress) => calls.push({ path, progress });

  await view.toggleMember(c.path); // retire le dernier feuillet, aucun suivant

  assert.deepEqual(view.getMemberPaths(), [a.path, b.path]);
  assert.deepEqual(calls, [{ path: b.path, progress: 0 }]);
});

test("ancre : plus aucun feuillet restant -> aucun scroll appelé", async () => {
  const { view, a, root } = buildView();
  await view.openScope(createSelectionScope(root.path, [a.path]));

  view.getScrollAnchor = () => ({ path: a.path, progress: 0.5 });
  const calls = [];
  view.scrollToAnchor = (path, progress) => calls.push({ path, progress });

  await view.toggleMember(a.path); // sélection vide

  assert.deepEqual(view.getMemberPaths(), []);
  assert.deepEqual(calls, []);
});

/* ===================== nextScrollAnchorAfterRecomposition (pur) ===================== */

test("nextScrollAnchorAfterRecomposition : aucune ancre précédente -> null", () => {
  assert.equal(nextScrollAnchorAfterRecomposition(null, [], ["A.md"]), null);
});

test("nextScrollAnchorAfterRecomposition : chemin absent de l'ancien ordre -> null (jamais de cible inventée)", () => {
  const result = nextScrollAnchorAfterRecomposition({ path: "Fantome.md", progress: 0.3 }, ["A.md", "B.md"], ["A.md"]);
  assert.equal(result, null);
});
