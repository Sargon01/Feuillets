import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { readGenealogyFolder } from "../src/carnet/blocks/genealogy/index.js";

function fixture(entries, links = {}) {
  const files = new Map();
  const folders = new Map([["Carnet", new TFolder("Carnet")]]);
  const frontmatter = new Map();
  const ensureFolder = (path) => {
    if (!path || folders.has(path)) return folders.get(path);
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const folder = new TFolder(path);
    const parent = ensureFolder(parentPath);
    if (parent) {
      folder.parent = parent;
      parent.children.push(folder);
    }
    folders.set(path, folder);
    return folder;
  };

  for (const entry of entries) {
    const file = new TFile(entry.path);
    const parentPath = entry.path.slice(0, entry.path.lastIndexOf("/"));
    const parent = ensureFolder(parentPath);
    file.parent = parent;
    parent?.children.push(file);
    files.set(file.path, file);
    frontmatter.set(file.path, entry.frontmatter ?? {});
  }

  const resolvedLinks = new Map();
  for (const [sourcePath, sourceLinks] of Object.entries(links)) {
    for (const [linkpath, targetPath] of Object.entries(sourceLinks)) {
      resolvedLinks.set(`${sourcePath}\u0000${linkpath}`, files.get(targetPath));
    }
  }
  return {
    vault: {
      getAbstractFileByPath: (path) => folders.get(path) ?? files.get(path) ?? null,
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) ?? {} }),
      getFirstLinkpathDest: (linkpath, sourcePath) => resolvedLinks.get(`${sourcePath}\u0000${linkpath}`) ?? null,
    },
  };
}

function person(result, path) {
  return result.graph.persons.find((candidate) => candidate.id === path);
}

test("lit les personnes et construit leur nom d'affichage", () => {
  const app = fixture([
    { path: "Carnet/Derviş.md", frontmatter: { first_name: "Derviş", last_name: "Yalçın", birth: "1923", death: "1995" } },
    { path: "Carnet/Sans nom.md", frontmatter: {} },
  ]);
  const result = readGenealogyFolder(app, "Carnet");

  assert.equal(person(result, "Carnet/Derviş.md")?.displayName, "Derviş Yalçın");
  assert.equal(person(result, "Carnet/Derviş.md")?.birth, "1923");
  assert.equal(person(result, "Carnet/Derviş.md")?.death, "1995");
  assert.equal(person(result, "Carnet/Sans nom.md")?.displayName, "Sans nom");
});

test("résout parents, spouse singulier et spouses pluriel via le fichier source", () => {
  const app = fixture([
    { path: "Carnet/Enfant.md", frontmatter: { parents: "[[Famille/Parent A]]", spouse: "[[Parent B]]", spouses: ["[[Parent C|C]]"] } },
    { path: "Carnet/Famille/Parent A.md" },
    { path: "Carnet/Parent B.md" },
    { path: "Carnet/Parent C.md" },
  ], {
    "Carnet/Enfant.md": {
      "Famille/Parent A": "Carnet/Famille/Parent A.md",
      "Parent B": "Carnet/Parent B.md",
      "Parent C": "Carnet/Parent C.md",
    },
  });
  const result = readGenealogyFolder(app, "Carnet");

  assert.deepEqual(person(result, "Carnet/Enfant.md")?.parentIds, ["Carnet/Famille/Parent A.md"]);
  assert.deepEqual(person(result, "Carnet/Enfant.md")?.spouseIds, ["Carnet/Parent B.md", "Carnet/Parent C.md"]);
  assert.deepEqual(result.graph.unions.find((union) => union.childIds.includes("Carnet/Enfant.md")), {
    id: "union:Carnet%2FFamille%2FParent%20A.md",
    partnerIds: ["Carnet/Famille/Parent A.md"],
    childIds: ["Carnet/Enfant.md"],
    sources: ["parentage"],
  });
});

test("fusionne les doublons spouse/spouses avant résolution et diagnostic", () => {
  const app = fixture([
    { path: "Carnet/A.md", frontmatter: { spouse: "[[B]]", spouses: ["[[B]]", "[[C]]", "[[Inconnu]]"] } },
    { path: "Carnet/B.md" },
    { path: "Carnet/C.md" },
  ], {
    "Carnet/A.md": { B: "Carnet/B.md", C: "Carnet/C.md" },
  });
  const result = readGenealogyFolder(app, "Carnet");

  assert.deepEqual(person(result, "Carnet/A.md")?.spouseIds, ["Carnet/B.md", "Carnet/C.md"]);
  assert.equal(result.diagnostics.filter((entry) => entry.code === "unresolved-genealogy-link" && entry.relatedPersonId === "[[Inconnu]]").length, 1);
});

test("fusionne et dédoublonne spouse et spouses, et dérive les enfants legacy", () => {
  const app = fixture([
    { path: "Carnet/A.md", frontmatter: { spouses: ["[[B]]"], children: ["[[C]]"] } },
    { path: "Carnet/B.md", frontmatter: { spouse: "[[A]]", children: "[[C]]" } },
    { path: "Carnet/C.md" },
  ], {
    "Carnet/A.md": { A: "Carnet/A.md", B: "Carnet/B.md", C: "Carnet/C.md" },
    "Carnet/B.md": { A: "Carnet/A.md", C: "Carnet/C.md" },
  });
  const result = readGenealogyFolder(app, "Carnet");

  assert.deepEqual(person(result, "Carnet/A.md")?.spouseIds, ["Carnet/B.md"]);
  assert.deepEqual(person(result, "Carnet/C.md")?.parentIds, ["Carnet/A.md", "Carnet/B.md"]);
  assert.deepEqual(person(result, "Carnet/C.md")?.childIds, []);
  assert.deepEqual(person(result, "Carnet/A.md")?.childIds, ["Carnet/C.md"]);
});

test("signale les liens non résolus et les cibles hors scope", () => {
  const outside = new TFile("Autre/Extérieur.md");
  const app = fixture([
    { path: "Carnet/A.md", frontmatter: { parents: ["[[Inconnu]]", "[[Extérieur]]"] } },
  ], { "Carnet/A.md": { Extérieur: "Autre/Extérieur.md" } });
  const original = app.metadataCache.getFirstLinkpathDest;
  app.metadataCache.getFirstLinkpathDest = (linkpath, sourcePath) => linkpath === "Extérieur" ? outside : original(linkpath, sourcePath);
  const result = readGenealogyFolder(app, "Carnet");

  assert.deepEqual(person(result, "Carnet/A.md")?.parentIds, []);
  assert.equal(result.diagnostics.filter((entry) => entry.code === "unresolved-genealogy-link").length, 2);
});

test("signale les types relationnels invalides sans empêcher la lecture", () => {
  const app = fixture([
    { path: "Carnet/A.md", frontmatter: { parents: { invalid: true }, spouses: 12, children: false } },
  ]);
  const result = readGenealogyFolder(app, "Carnet");

  assert.deepEqual(result.graph.persons[0]?.parentIds, []);
  assert.deepEqual(result.diagnostics
    .filter((entry) => entry.code === "invalid-genealogy-field")
    .map((entry) => entry.field), ["children", "parents", "spouses"]);
});

test("inclut les sous-dossiers mais exclut les fichiers hors scope", () => {
  const app = fixture([
    { path: "Carnet/Sous-dossier/Enfant.md" },
    { path: "Ailleurs/Exclu.md" },
  ]);
  const result = readGenealogyFolder(app, "Carnet");

  assert.deepEqual(result.graph.persons.map((candidate) => candidate.id), ["Carnet/Sous-dossier/Enfant.md"]);
});

test("produit le graphe normalisé avec filiation, enfants inverses et union", () => {
  const app = fixture([
    { path: "Carnet/Enfant.md", frontmatter: { parents: ["[[A]]", "[[B]]"] } },
    { path: "Carnet/A.md" },
    { path: "Carnet/B.md" },
  ], {
    "Carnet/Enfant.md": { A: "Carnet/A.md", B: "Carnet/B.md" },
  });
  const result = readGenealogyFolder(app, "Carnet");

  assert.deepEqual(person(result, "Carnet/A.md")?.childIds, ["Carnet/Enfant.md"]);
  assert.deepEqual(person(result, "Carnet/B.md")?.childIds, ["Carnet/Enfant.md"]);
  assert.deepEqual(result.graph.unions, [{
    id: "union:Carnet%2FA.md|Carnet%2FB.md",
    partnerIds: ["Carnet/A.md", "Carnet/B.md"],
    childIds: ["Carnet/Enfant.md"],
    sources: ["parentage"],
  }]);
});
