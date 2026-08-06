import test from "node:test";
import assert from "node:assert/strict";
import { matchContext, normalizeString } from "../src/services/context-matcher.js";

test("Normalisation : casse, accents, tirets, ponctuation", () => {
  assert.equal(normalizeString("Lisbonne"), "lisbonne");
  assert.equal(normalizeString("LISBONNE"), "lisbonne");
  assert.equal(normalizeString("Séisme de Lisbonne"), "seisme de lisbonne");
  assert.equal(normalizeString("SÉISME-DE-LISBONNE"), "seisme de lisbonne");
});

test("Titre complet", () => {
  const candidates = [
    { id: "1", path: "seisme.md", title: "Séisme de Lisbonne" },
    { id: "2", path: "paris.md", title: "Histoire de Paris" }
  ];
  const text = "Le séisme de Lisbonne détruisit la ville";
  const results = matchContext(text, candidates);

  assert.equal(results.length, 1);
  assert.equal(results[0].candidate.path, "seisme.md");
  assert.equal(results[0].reason, "exact-title");
});

test("Plusieurs termes du titre", () => {
  const candidates = [
    { id: "1", path: "seisme.md", title: "Grand séisme de Lisbonne" },
    { id: "2", path: "rome.md", title: "Rome antique" }
  ];
  const text = "Un séisme frappe Lisbonne";
  const results = matchContext(text, candidates);

  assert.equal(results.length, 1);
  assert.equal(results[0].candidate.path, "seisme.md");
  assert.equal(results[0].reason, "title-terms");
  assert.deepEqual(results[0].matchedTerms.sort(), ["lisbonne", "seisme"]);
});

test("Terme distinctif et classement", () => {
  const candidates = [
    { id: "1", path: "lisbonne.md", title: "Lisbonne" },
    { id: "2", path: "seisme.md", title: "Séisme de Lisbonne" },
    { id: "3", path: "reconstruction.md", title: "Reconstruction de Lisbonne" }
  ];
  const text = "Candide arrive à Lisbonne";
  const results = matchContext(text, candidates);

  assert.equal(results.length, 3);
  assert.equal(results[0].candidate.path, "lisbonne.md");
  assert.equal(results[0].reason, "exact-title");
  assert.equal(results[1].candidate.path, "seisme.md");
  assert.equal(results[2].candidate.path, "reconstruction.md");
});

test("Classement comparatif : Lisbonne vs Séisme de Lisbonne", () => {
  const candidates = [
    { id: "1", path: "lisbonne.md", title: "Lisbonne" },
    { id: "2", path: "seisme.md", title: "Séisme de Lisbonne" }
  ];

  // Texte A : Candide arrive à Lisbonne -> Lisbonne en premier
  const resA = matchContext("Candide arrive à Lisbonne", candidates);
  assert.equal(resA[0].candidate.path, "lisbonne.md");

  // Texte B : Un séisme frappe Lisbonne -> Séisme de Lisbonne en premier
  const resB = matchContext("Un séisme frappe Lisbonne", candidates);
  assert.equal(resB[0].candidate.path, "seisme.md");
});

test("Frontières de mots : Rome ne correspond pas à romanesque", () => {
  const candidates = [
    { id: "1", path: "rome.md", title: "Rome" }
  ];
  const text = "C'est une histoire romanesque";
  const results = matchContext(text, candidates);

  assert.equal(results.length, 0);
});

test("Tags simples et tirets", () => {
  const candidates = [
    {
      id: "1",
      path: "commerce.md",
      title: "Commerce dans le Hedjaz",
      tags: ["caravansérail", "routes-caravanières"]
    }
  ];

  const text1 = "Il passe la nuit dans un caravansérail.";
  const res1 = matchContext(text1, candidates);
  assert.equal(res1.length, 1);
  assert.equal(res1[0].reason, "tag");

  const text2 = "Les routes caravanières traversent le désert.";
  const res2 = matchContext(text2, candidates);
  assert.equal(res2.length, 1);
  assert.equal(res2[0].reason, "tag");
});

test("Tags hiérarchiques : #Histoire/Arabie", () => {
  const candidates = [
    {
      id: "1",
      path: "arabie.md",
      title: "Péninsule",
      tags: ["#Histoire/Arabie"]
    }
  ];

  // 'Arabie' correspond au segment terminal
  const resArabie = matchContext("Il voyage en Arabie.", candidates);
  assert.equal(resArabie.length, 1);
  assert.equal(resArabie[0].reason, "tag");
  assert.deepEqual(resArabie[0].matchedTerms, ["arabie"]);

  // 'histoire' seul ne doit pas déclencher la fiche
  const resHistoire = matchContext("C'est une grande histoire.", candidates);
  assert.equal(resHistoire.length, 0);
});

test("Réduction du bruit : mots faibles et termes génériques seuls", () => {
  const candidates = [
    { id: "1", path: "histoire.md", title: "Histoire" },
    { id: "2", path: "ville.md", title: "Ville" },
    { id: "3", path: "source.md", title: "Source", tags: ["brouillon"] }
  ];

  for (const text of ["de", "la", "histoire", "ville", "source", "brouillon"]) {
    const results = matchContext(text, candidates);
    assert.equal(results.length, 0, `Le texte "${text}" ne devrait produire aucun résultat`);
  }
});

test("Déduplication par path", () => {
  const candidates = [
    { id: "1", path: "fiche.md", title: "Séisme", sourcePriority: 50 },
    { id: "2", path: "fiche.md", title: "Séisme de Lisbonne", sourcePriority: 10 }
  ];
  const text = "Un grand séisme frappe Lisbonne";
  const results = matchContext(text, candidates);

  assert.equal(results.length, 1);
  assert.equal(results[0].candidate.id, "2");
  assert.equal(results[0].candidate.sourcePriority, 10);
});

test("Priorité des sources", () => {
  const candidates = [
    { id: "1", path: "a.md", title: "Lisbonne", sourcePriority: 20 },
    { id: "2", path: "b.md", title: "Lisbonne", sourcePriority: 0 }
  ];
  const text = "Voyage à Lisbonne";
  const results = matchContext(text, candidates);

  assert.equal(results.length, 2);
  assert.equal(results[0].candidate.path, "b.md");
  assert.equal(results[1].candidate.path, "a.md");
});

test("Limite des résultats", () => {
  const candidates = Array.from({ length: 15 }, (_, i) => ({
    id: String(i),
    path: `note-${i}.md`,
    title: `Lisbonne note ${i}`
  }));

  const text = "Lisbonne";
  const defaultRes = matchContext(text, candidates);
  assert.equal(defaultRes.length, 10);

  const customRes = matchContext(text, candidates, { limit: 3 });
  assert.equal(customRes.length, 3);
});

test("Stabilité de l'ordre", () => {
  const candidates = [
    { id: "1", path: "a.md", title: "Lisbonne" },
    { id: "2", path: "b.md", title: "Lisbonne" },
    { id: "3", path: "c.md", title: "Lisbonne" }
  ];
  const text = "Lisbonne";

  const run1 = matchContext(text, candidates);
  const run2 = matchContext(text, candidates);

  assert.deepEqual(
    run1.map(r => r.candidate.path),
    run2.map(r => r.candidate.path)
  );
  assert.deepEqual(
    run1.map(r => r.candidate.path),
    ["a.md", "b.md", "c.md"]
  );
});

test("Anti-régression : hiérarchie stricte des raisons sans chevauchement", () => {
  const candidates = [
    { id: "1", path: "distinctive.md", title: "MotA MotB MotC MotD Lisbonne" },
    { id: "2", path: "tag.md", title: "Note", tags: ["#TagAlpha"] },
    { id: "3", path: "title-terms.md", title: "Grand Séisme Majeur de Lisbonne" },
    { id: "4", path: "exact-title.md", title: "Lisbonne" }
  ];

  // Texte contenant 'Lisbonne', 'TagAlpha', 'Séisme', 'Majeur'
  const text = "Lisbonne TagAlpha Séisme Majeur";
  const results = matchContext(text, candidates);

  const reasons = results.map(r => r.reason);
  assert.deepEqual(reasons, ["exact-title", "title-terms", "tag", "distinctive-term"]);

  // Vérification que les scores respectent des plages strictement disjointes
  assert.ok(results[0].score >= 5000 && results[0].score < 6000, "exact-title dans [5000, 6000[");
  assert.ok(results[1].score >= 3000 && results[1].score < 4000, "title-terms dans [3000, 4000[");
  assert.ok(results[2].score >= 2000 && results[2].score < 3000, "tag dans [2000, 3000[");
  assert.ok(results[3].score >= 1000 && results[3].score < 2000, "distinctive-term dans [1000, 2000[");
});

