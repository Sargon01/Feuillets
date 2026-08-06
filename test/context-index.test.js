import test from "node:test";
import assert from "node:assert/strict";
import { buildContextIndex, normalizePath } from "../src/services/context-index.js";
import { matchContext } from "../src/services/context-matcher.js";

test("Normalisation des chemins", () => {
  assert.equal(normalizePath("\\Projet//Recherche\\Ali.md\\"), "Projet/Recherche/Ali.md");
  assert.equal(normalizePath("Projet/Recherche/"), "Projet/Recherche");
});

test("1. Inclut un document directement présent dans une source", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [{ path: "Projet/Recherche/Ali.md", basename: "Ali" }];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  assert.equal(index[0].path, "Projet/Recherche/Ali.md");
});

test("2. Inclut un document dans un sous-dossier avec includeNested: true", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [{ path: "Projet/Recherche/Personnages/Ali.md", basename: "Ali" }];

  const index = buildContextIndex(documents, sources, { includeNested: true });
  assert.equal(index.length, 1);
  assert.equal(index[0].path, "Projet/Recherche/Personnages/Ali.md");
});

test("3. Exclut les sous-dossiers avec includeNested: false", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [
    { path: "Projet/Recherche/Ali.md", basename: "Ali" },
    { path: "Projet/Recherche/Personnages/Bob.md", basename: "Bob" }
  ];

  const index = buildContextIndex(documents, sources, { includeNested: false });
  assert.equal(index.length, 1);
  assert.equal(index[0].path, "Projet/Recherche/Ali.md");
});

test("4. Respecte les frontières de dossiers (Recherche vs Recherches)", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [{ path: "Projet/Recherches/Ali.md", basename: "Ali" }];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 0);
});

test("5. Exclut un document extérieur à toutes les sources", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [{ path: "Autre/Note.md", basename: "Note" }];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 0);
});

test("6. Utilise title si non vide, sinon basename", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [
    { path: "Projet/Recherche/A.md", basename: "A", title: "Titre Explicite" },
    { path: "Projet/Recherche/B.md", basename: "B", title: "   " },
    { path: "Projet/Recherche/C.md", basename: "C" }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 3);
  assert.equal(index[0].title, "Titre Explicite");
  assert.equal(index[1].title, "B");
  assert.equal(index[2].title, "C");
});

test("7. Nettoie et déduplique les tags", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [
    {
      path: "Projet/Recherche/Note.md",
      basename: "Note",
      tags: [" #histoire ", " #HISTOIRE ", ""]
    }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  assert.deepEqual(index[0].tags, ["#histoire"]);
});

test("8. Applique les priorités par défaut (feuillet < chapitre < recherche projet < partagé < manuel)", () => {
  const sources = [
    { path: "Manual", kind: "manual" },
    { path: "Shared", kind: "shared" },
    { path: "Research", kind: "project-research" },
    { path: "Chapter", kind: "chapter" },
    { path: "Feuillet", kind: "feuillet" }
  ];
  const documents = [
    { path: "Manual/M.md", basename: "M" },
    { path: "Shared/S.md", basename: "S" },
    { path: "Research/R.md", basename: "R" },
    { path: "Chapter/C.md", basename: "C" },
    { path: "Feuillet/F.md", basename: "F" }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index[0].sourceKind, "feuillet");         // priority 0
  assert.equal(index[1].sourceKind, "chapter");          // priority 10
  assert.equal(index[2].sourceKind, "project-research"); // priority 20
  assert.equal(index[3].sourceKind, "shared");           // priority 30
  assert.equal(index[4].sourceKind, "manual");           // priority 40
});

test("9. Respecte une priorité explicite surchargée", () => {
  const sources = [
    { path: "Shared", kind: "shared", priority: 1 },
    { path: "Research", kind: "project-research", priority: 50 }
  ];
  const documents = [
    { path: "Research/R.md", basename: "R" },
    { path: "Shared/S.md", basename: "S" }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index[0].sourcePath, "Shared");
  assert.equal(index[0].sourcePriority, 1);
  assert.equal(index[1].sourcePath, "Research");
  assert.equal(index[1].sourcePriority, 50);
});

test("10 & 11. Document dans plusieurs sources : 1 seul candidat avec la source la plus prioritaire (la plus précise)", () => {
  const sources = [
    { path: "Projet/Recherche/Chapitre1", kind: "chapter" },          // priority 10
    { path: "Projet/Recherche", kind: "project-research" }            // priority 20
  ];
  const documents = [
    { path: "Projet/Recherche/Chapitre1/Fiche.md", basename: "Fiche" }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  // Le chapitre est plus PRÉCIS que la recherche générale du projet : il
  // gagne désormais, alors même que "Chapitre1" est aussi sous "Recherche".
  assert.equal(index[0].sourceKind, "chapter");
  assert.equal(index[0].sourcePriority, 10);
});

test("12. À priorité égale, la première source gagne", () => {
  const sources = [
    { path: "DossierA", kind: "manual", priority: 10 },
    { path: "DossierA/Sub", kind: "chapter", priority: 10 }
  ];
  const documents = [
    { path: "DossierA/Sub/Fiche.md", basename: "Fiche" }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  assert.equal(index[0].sourcePath, "DossierA");
});

test("13. Normalisation des antislashs et slashs multiples", () => {
  const sources = [{ path: "\\Projet//Recherche\\", kind: "project-research" }];
  const documents = [{ path: "Projet\\Recherche//Fiche.md", basename: "Fiche" }];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  assert.equal(index[0].path, "Projet/Recherche/Fiche.md");
});

test("14. Résultat stable sur deux exécutions", () => {
  const sources = [
    { path: "A", kind: "chapter" },
    { path: "B", kind: "shared" }
  ];
  const documents = [
    { path: "A/1.md", basename: "1" },
    { path: "B/2.md", basename: "2" }
  ];

  const index1 = buildContextIndex(documents, sources);
  const index2 = buildContextIndex(documents, sources);
  assert.deepEqual(index1, index2);
});

test("15. Test d'intégration pur avec matchContext()", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [
    {
      path: "Projet/Recherche/seisme.md",
      basename: "seisme",
      title: "Séisme de Lisbonne"
    },
    {
      path: "Projet/Recherche/paris.md",
      basename: "paris",
      title: "Histoire de Paris"
    }
  ];

  const index = buildContextIndex(documents, sources);
  const matches = matchContext("Un séisme frappe Lisbonne", index);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].candidate.path, "Projet/Recherche/seisme.md");
  assert.equal(matches[0].candidate.title, "Séisme de Lisbonne");
});

test("Test utilisateur 1 : un fichier dont le chemin est égal au chemin source n'est pas inclus", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [
    { path: "Projet/Recherche", basename: "Recherche" },
    { path: "Projet/Recherche/Fiche.md", basename: "Fiche" }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  assert.equal(index[0].path, "Projet/Recherche/Fiche.md");
});

test("Test utilisateur 2 : déduplication des tags insensible à la casse avec conservation de la première graphie", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [
    {
      path: "Projet/Recherche/Note.md",
      basename: "Note",
      tags: ["#Arabie", " #arabie ", "#Commerce"]
    }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  assert.deepEqual(index[0].tags, ["#Arabie", "#Commerce"]);
});

test("Test utilisateur 3 : déduplication des aliases insensible à la casse avec conservation de la première graphie", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [
    {
      path: "Projet/Recherche/Duc.md",
      basename: "Duc",
      aliases: ["Duc de Bragance", " duc de bragance ", "DUC DE BRAGANCE", "Le Chat Botté", ""]
    }
  ];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  assert.deepEqual(index[0].aliases, ["Duc de Bragance", "Le Chat Botté"]);
});

test("Aliases absents : champ vide, jamais undefined ni erreur", () => {
  const sources = [{ path: "Projet/Recherche", kind: "project-research" }];
  const documents = [{ path: "Projet/Recherche/Sans.md", basename: "Sans" }];

  const index = buildContextIndex(documents, sources);
  assert.equal(index.length, 1);
  assert.deepEqual(index[0].aliases, []);
});
