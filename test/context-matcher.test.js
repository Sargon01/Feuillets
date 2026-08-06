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

test("Priorité des sources (même titre : déduplication, la meilleure sourcePriority gagne)", () => {
  const candidates = [
    { id: "1", path: "a.md", title: "Lisbonne", sourcePriority: 20 },
    { id: "2", path: "b.md", title: "Lisbonne", sourcePriority: 0 }
  ];
  const text = "Voyage à Lisbonne";
  const results = matchContext(text, candidates);

  // Même titre logique ("Lisbonne") sur deux fichiers différents : une
  // seule entrée doit survivre à la déduplication par titre, celle à la
  // sourcePriority la plus faible (voir le bloc dédié plus bas).
  assert.equal(results.length, 1);
  assert.equal(results[0].candidate.path, "b.md");
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

test("Stabilité de l'ordre (score et sourcePriority égaux, titres RÉELLEMENT distincts)", () => {
  // Titres distincts à dessein : la déduplication par titre (voir plus bas)
  // collapserait trois candidats réellement homonymes en un seul, ce qui
  // n'est plus ce que ce test veut observer ici — la stabilité du tri à
  // score/priorité strictement égaux entre documents DIFFÉRENTS.
  const candidates = [
    { id: "1", path: "a.md", title: "Lisbonne Alpha" },
    { id: "2", path: "b.md", title: "Lisbonne Beta" },
    { id: "3", path: "c.md", title: "Lisbonne Gamma" }
  ];
  const text = "Lisbonne Alpha, Lisbonne Beta et Lisbonne Gamma se rencontrent.";

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

/* ===================== Aliases (frontmatter Obsidian) ===================
 * Facultatifs — aucune fiche n'est tenue d'en porter — mais un alias
 * existant doit produire une correspondance aussi fiable qu'un titre.
 * Classement : sous "exact-title", au-dessus de "exact-basename"/"tag". */

test("Alias : un alias simple (basename non correspondant) est retrouvé", () => {
  const candidates = [
    { id: "1", path: "personnage.md", title: "Le Marquis de Carabas", basename: "personnage", aliases: ["Chat Botté"] }
  ];
  const results = matchContext("Le Chat Botté traverse la forêt.", candidates);

  assert.equal(results.length, 1);
  assert.equal(results[0].candidate.path, "personnage.md");
  assert.equal(results[0].reason, "alias");
});

test("Alias : accentué et insensible à la casse", () => {
  const candidates = [
    { id: "1", path: "duc.md", title: "Fiche 42", aliases: ["Duc de Bragance"] }
  ];

  const results = matchContext("Le DUC DE BRAGANCE arrive.", candidates);
  assert.equal(results.length, 1);
  assert.equal(results[0].reason, "alias");

  const resultsAccent = matchContext("le duc de bragance arrive", candidates);
  assert.equal(resultsAccent.length, 1);
  assert.equal(resultsAccent[0].reason, "alias");
});

test("Alias : frontière de mots respectée (Léa ne correspond pas à Léana)", () => {
  const candidates = [
    { id: "1", path: "lea.md", title: "Fiche 7", aliases: ["Léa"] }
  ];
  const results = matchContext("Léana traverse la ville.", candidates);
  assert.equal(results.length, 0);
});

test("Alias : un alias PARTIEL (un seul mot d'un alias à plusieurs mots) n'est jamais retrouvé", () => {
  const candidates = [
    // "Bragance" seul apparaît dans le texte, mais l'alias complet est
    // "Duc de Bragance" : un mot isolé ne doit jamais suffire (bruit).
    { id: "1", path: "duc.md", title: "Fiche 42", aliases: ["Duc de Bragance"] }
  ];
  const results = matchContext("Bragance est un nom de famille répandu.", candidates);
  assert.equal(results.length, 0);
});

test("Alias : absents — comportement inchangé (aucune métadonnée exigée)", () => {
  const candidates = [
    { id: "1", path: "seisme.md", title: "Séisme de Lisbonne" }
  ];
  const results = matchContext("Un séisme frappe Lisbonne", candidates);
  assert.equal(results.length, 1);
  assert.equal(results[0].reason, "exact-title");
});

test("Alias : classé sous le titre complet et au-dessus du tag", () => {
  const candidates = [
    { id: "1", path: "titre.md", title: "Reconstruction de Lisbonne" },
    { id: "2", path: "alias.md", title: "Fiche 9", aliases: ["Reconstruction de Lisbonne"] },
    { id: "3", path: "tag.md", title: "Fiche 8", tags: ["Reconstruction de Lisbonne"] }
  ];
  const results = matchContext("La reconstruction de Lisbonne dura des années.", candidates);

  const reasons = results.map(r => r.reason);
  assert.deepEqual(reasons, ["exact-title", "alias", "tag"]);
  assert.ok(results[1].score >= 4500 && results[1].score < 5000, "alias dans [4500, 5000[, sous exact-title");
  assert.ok(results[1].score > results[2].score, "alias passe avant tag");
});

/* ================== Déduplication par TITRE normalisé ====================
 * Bug corrigé : plusieurs fichiers DIFFÉRENTS (chemins distincts) portant le
 * même titre logique (typiquement un même sujet lié séparément au feuillet,
 * au chapitre et présent aussi dans la Recherche générale) apparaissaient
 * chacun comme une entrée séparée dans le panneau Contexte — jusqu'à 3 fois
 * la même fiche visible, et suffisamment de doublons pour pousser une fiche
 * pertinente (ex. Ramazan, trouvée par alias) hors de la limite de 10.
 * Appliquée après le tri, avant la limite. Clé = candidate.title normalisé
 * (jamais basename). La déduplication par candidate.path reste distincte et
 * inchangée (voir "Déduplication par path" plus haut). */

test("Déduplication par titre : 3 fichiers de sources différentes, même titre → une seule entrée visible", () => {
  const candidates = [
    { id: "1", path: "feuillet/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 0 },
    { id: "2", path: "chapitre/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 10 },
    { id: "3", path: "projet/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 20 }
  ];
  const results = matchContext("Le commerce à Lisbonne prospère.", candidates);

  assert.equal(results.length, 1, "un même titre logique ne doit apparaître qu'une seule fois");
});

test("Déduplication par titre : l'entrée conservée est celle au meilleur score, puis à la meilleure sourcePriority", () => {
  const candidates = [
    { id: "1", path: "feuillet/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 0 },
    { id: "2", path: "chapitre/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 10 },
    { id: "3", path: "projet/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 20 }
  ];
  const results = matchContext("Le commerce à Lisbonne prospère.", candidates);

  // À score identique (même titre, même texte : la correspondance est
  // structurellement la même pour les trois), la sourcePriority la plus
  // faible (0, le feuillet) départage — exactement le tri déjà en place,
  // simplement observé maintenant à travers la déduplication.
  assert.equal(results[0].candidate.path, "feuillet/Commerce à Lisbonne.md");
  assert.equal(results[0].candidate.sourcePriority, 0);
});

test("Déduplication par titre : variantes de casse, accents et ponctuation reconnues comme identiques", () => {
  const candidates = [
    { id: "1", path: "a.md", title: "Commerce à Lisbonne", sourcePriority: 0 },
    { id: "2", path: "b.md", title: "commerce a lisbonne", sourcePriority: 10 },
    { id: "3", path: "c.md", title: "Commerce-à-Lisbonne", sourcePriority: 20 }
  ];
  const results = matchContext("Le commerce à Lisbonne prospère.", candidates);

  assert.equal(results.length, 1);
  assert.equal(results[0].candidate.path, "a.md");
});

test("Déduplication par titre : deux titres RÉELLEMENT différents restent tous deux présents", () => {
  const candidates = [
    { id: "1", path: "a.md", title: "Commerce à Lisbonne" },
    { id: "2", path: "b.md", title: "Commerce autour de Lisbonne" }
  ];
  const results = matchContext(
    "Le commerce à Lisbonne prospère. Le commerce autour de Lisbonne aussi.",
    candidates
  );

  assert.equal(results.length, 2, "des titres différents ne doivent jamais être fusionnés");
  assert.deepEqual(results.map(r => r.candidate.path).sort(), ["a.md", "b.md"]);
});

test("Déduplication par titre : appliquée AVANT la limite — Ramazan (trouvé par alias) survit malgré 3 doublons", () => {
  const duplicates = [
    { id: "dup1", path: "feuillet/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 0 },
    { id: "dup2", path: "chapitre/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 10 },
    { id: "dup3", path: "projet/Commerce à Lisbonne.md", title: "Commerce à Lisbonne", sourcePriority: 20 }
  ];
  // 8 autres fiches à titres distincts, qui matchent toutes aussi le texte
  // — de quoi remplir la limite de 10 SI les 3 doublons ne sont comptés
  // qu'une fois (9 titres distincts + Ramazan = 10, tous tiennent). Sans la
  // déduplication avant limite, les 3 doublons (tous en tête, score
  // "exact-title") auraient occupé 3 places sur 10 et repoussé Ramazan
  // (tier "alias", plus bas) hors de la liste.
  const others = Array.from({ length: 8 }, (_, i) => ({
    id: `autre-${i}`,
    path: `autre-${i}.md`,
    title: `Sujet Distinct ${i}`
  }));
  const ramazan = { id: "ramazan", path: "recherche/Personnage3.md", title: "Fiche 3", aliases: ["Ramazan"] };

  const candidates = [...duplicates, ...others, ramazan];
  const text = [
    "Le commerce à Lisbonne anime la ville.",
    ...others.map(o => o.title),
    "Ramazan traverse la place."
  ].join(" ");

  const results = matchContext(text, candidates, { limit: 10 });

  assert.ok(results.length <= 10);
  assert.ok(
    results.some(r => r.candidate.id === "ramazan"),
    "Ramazan doit rester dans les résultats malgré les doublons de titre"
  );
  const commerceMatches = results.filter(r => r.candidate.title === "Commerce à Lisbonne");
  assert.equal(commerceMatches.length, 1, "un seul « Commerce à Lisbonne » doit survivre à la déduplication");
});

test("Déduplication par titre : aucun changement de classement quand tous les titres sont distincts", () => {
  const candidates = [
    { id: "1", path: "lisbonne.md", title: "Lisbonne" },
    { id: "2", path: "seisme.md", title: "Séisme de Lisbonne" },
    { id: "3", path: "reconstruction.md", title: "Reconstruction de Lisbonne" }
  ];
  const text = "Candide arrive à Lisbonne";
  const results = matchContext(text, candidates);

  assert.equal(results.length, 3);
  assert.equal(results[0].candidate.path, "lisbonne.md");
  assert.equal(results[1].candidate.path, "seisme.md");
  assert.equal(results[2].candidate.path, "reconstruction.md");
});

