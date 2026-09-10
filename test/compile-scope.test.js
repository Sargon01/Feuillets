import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { resolveCompileScopeFiles, compileScopesEqual } from "../src/services/compile-scope.js";

function createFixture(orders = {}) {
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène A.md");
  const second = new TFile("Projet/Manuscrit/Chapitre 1/Scène B.md");

  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [first, second];
  first.parent = chapter;
  second.parent = chapter;

  const { vault } = createFakeVault([manuscript, chapter, first, second]);
  return {
    app: { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } },
    chapter,
    first,
    second,
    settings: {
      projectFolder: manuscript.path,
      orders,
      folderPositions: {},
      compileFileName: "Manuscrit.md",
    },
  };
}

test("sélectionner un dossier retourne tous ses fichiers Markdown", () => {
  const { app, chapter, first, second, settings } = createFixture();

  const files = resolveCompileScopeFiles(app, settings, {
    type: "selection",
    projectRoot: "Projet/Manuscrit",
    paths: [chapter.path],
  });

  assert.deepEqual(files.map((file) => file.path), [first.path, second.path]);
});

test("les brouillons techniques sont exclus du projet mais exportables par portée fichier", async () => {
  const root = new TFolder("WARPI");
  const auxiliary = new TFolder("WARPI/_Feuillets");
  const drafts = new TFolder("WARPI/_Feuillets/Drafts");
  const textes = new TFolder("WARPI/TEXTES");
  const draft = new TFile("WARPI/_Feuillets/Drafts/Sans titre.md", "---\nstatus: Brouillon\n---\n\n");
  root.children = [auxiliary, textes];
  auxiliary.parent = root;
  auxiliary.children = [drafts];
  drafts.parent = auxiliary;
  drafts.children = [draft];
  draft.parent = drafts;
  textes.parent = root;
  textes.children = [];
  const { vault, fileManager } = createFakeVault([root, auxiliary, drafts, draft, textes]);
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: root.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };

  assert.deepEqual(
    resolveCompileScopeFiles(app, settings, { type: "project", projectRoot: root.path }),
    []
  );
  assert.deepEqual(
    resolveCompileScopeFiles(app, settings, { type: "file", projectRoot: root.path, path: draft.path }),
    [draft]
  );

  await fileManager.renameFile(draft, "WARPI/TEXTES/Sans titre.md");
  assert.deepEqual(
    resolveCompileScopeFiles(app, settings, { type: "project", projectRoot: root.path }),
    [draft]
  );
});

test("une portée project sur un ouvrage imbriqué ne retient que les fichiers de l'ouvrage", () => {
  const root = new TFolder("WARPI");
  const rootNote = new TFile("WARPI/WARPI.md");
  const sibling = new TFolder("WARPI/Autre");
  const siblingScene = new TFile("WARPI/Autre/Scène A.md");
  const nefes = new TFolder("WARPI/NEFES");
  const nefesFront = new TFolder("WARPI/NEFES/Front");
  const nefesTitle = new TFile("WARPI/NEFES/Front/Page de titre.md");
  const chapter = new TFolder("WARPI/NEFES/Chapitre 1");
  const scene = new TFile("WARPI/NEFES/Chapitre 1/Scene 1.md");
  root.children = [sibling, nefes, rootNote];
  for (const child of root.children) child.parent = root;
  sibling.children = [siblingScene];
  siblingScene.parent = sibling;
  nefes.children = [nefesFront, chapter];
  nefesFront.parent = nefes;
  chapter.parent = nefes;
  nefesFront.children = [nefesTitle];
  nefesTitle.parent = nefesFront;
  chapter.children = [scene];
  scene.parent = chapter;
  const { vault } = createFakeVault([root, rootNote, sibling, siblingScene, nefes, nefesFront, nefesTitle, chapter, scene]);
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: root.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" };

  assert.deepEqual(
    resolveCompileScopeFiles(app, settings, { type: "project", projectRoot: "WARPI/NEFES" }).map((file) => file.path).sort(),
    [nefesTitle.path, scene.path].sort()
  );
});

test("sélectionner un dossier et l'un de ses fichiers ne crée pas de doublon", () => {
  const { app, chapter, first, second, settings } = createFixture();

  const files = resolveCompileScopeFiles(app, settings, {
    type: "selection",
    projectRoot: "Projet/Manuscrit",
    paths: [chapter.path, first.path],
  });

  assert.deepEqual(files.map((file) => file.path), [first.path, second.path]);
});

test("la sélection développée respecte l'ordre du Binder", () => {
  const { app, chapter, first, second, settings } = createFixture({
    "Projet/Manuscrit/Chapitre 1": ["Scène B.md", "Scène A.md"],
  });

  const files = resolveCompileScopeFiles(app, settings, {
    type: "selection",
    projectRoot: "Projet/Manuscrit",
    paths: [chapter.path],
  });

  assert.deepEqual(files.map((file) => file.path), [second.path, first.path]);
});

/* ===================== compileScopesEqual (Lot 2A §1) ===================== */

test("compileScopesEqual : deux scopes project sur la même racine sont égaux", () => {
  const a = { type: "project", projectRoot: "Projet/Manuscrit" };
  const b = { type: "project", projectRoot: "Projet/Manuscrit" };
  assert.equal(compileScopesEqual(a, b), true);
});

test("compileScopesEqual : deux scopes project sur des racines différentes sont différents", () => {
  const a = { type: "project", projectRoot: "Projet/Manuscrit" };
  const b = { type: "project", projectRoot: "Autre/Manuscrit" };
  assert.equal(compileScopesEqual(a, b), false);
});

test("compileScopesEqual : deux scopes file avec le même path sont égaux", () => {
  const a = { type: "file", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Scène A.md" };
  const b = { type: "file", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Scène A.md" };
  assert.equal(compileScopesEqual(a, b), true);
});

test("compileScopesEqual : deux scopes file avec un path différent sont différents", () => {
  const a = { type: "file", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Scène A.md" };
  const b = { type: "file", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Scène B.md" };
  assert.equal(compileScopesEqual(a, b), false);
});

test("compileScopesEqual : deux scopes folder avec le même path sont égaux", () => {
  const a = { type: "folder", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Chapitre 1" };
  const b = { type: "folder", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Chapitre 1" };
  assert.equal(compileScopesEqual(a, b), true);
});

test("compileScopesEqual : deux scopes folder avec un path différent sont différents", () => {
  const a = { type: "folder", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Chapitre 1" };
  const b = { type: "folder", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Chapitre 2" };
  assert.equal(compileScopesEqual(a, b), false);
});

test("compileScopesEqual : deux scopes selection avec les mêmes chemins dans un ordre différent sont égaux", () => {
  const a = { type: "selection", projectRoot: "Projet/Manuscrit", paths: ["A.md", "B.md", "C.md"] };
  const b = { type: "selection", projectRoot: "Projet/Manuscrit", paths: ["C.md", "A.md", "B.md"] };
  assert.equal(compileScopesEqual(a, b), true);
});

test("compileScopesEqual : deux scopes selection avec un contenu différent sont différents", () => {
  const a = { type: "selection", projectRoot: "Projet/Manuscrit", paths: ["A.md", "B.md"] };
  const b = { type: "selection", projectRoot: "Projet/Manuscrit", paths: ["A.md", "C.md"] };
  assert.equal(compileScopesEqual(a, b), false);
});

test("compileScopesEqual : deux scopes selection de tailles différentes sont différents", () => {
  const a = { type: "selection", projectRoot: "Projet/Manuscrit", paths: ["A.md", "B.md"] };
  const b = { type: "selection", projectRoot: "Projet/Manuscrit", paths: ["A.md", "B.md", "C.md"] };
  assert.equal(compileScopesEqual(a, b), false);
});

test("compileScopesEqual : deux types de scope différents ne sont jamais égaux", () => {
  const a = { type: "folder", projectRoot: "Projet/Manuscrit", path: "Projet/Manuscrit/Chapitre 1" };
  const b = { type: "project", projectRoot: "Projet/Manuscrit" };
  assert.equal(compileScopesEqual(a, b), false);
});

test("compileScopesEqual : même type mais projectRoot différent → jamais égal", () => {
  const a = { type: "project", projectRoot: "Projet/Manuscrit" };
  const b = { type: "project", projectRoot: "Projet/Manuscrit2" };
  assert.equal(compileScopesEqual(a, b), false);
});
