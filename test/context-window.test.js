import test from "node:test";
import assert from "node:assert/strict";
import { extractContextWindow } from "../src/services/context-window.js";

/* Paragraphes COURTS (< 50 caractères) : sous SHORT_PARAGRAPH_THRESHOLD,
 * donc élargis au voisinage par défaut (radius 1) — c'est le seul cas où
 * l'ancien comportement "toujours précédent + courant + suivant" survit. */
const PARA_A = "Paragraphe A, première ligne.";
const PARA_B = "Paragraphe B, ligne un.\nParagraphe B, ligne deux.";
const PARA_C = "Paragraphe C, seule ligne.";

/* Paragraphes LONGS (>= 50 caractères) : comportement par défaut, JAMAIS
 * élargi au voisinage — le paragraphe courant seul est retourné. */
const LONG_A = "Ceci est un paragraphe A suffisamment long pour ne jamais être considéré comme un simple fragment très court.";
const LONG_B = "Ceci est un paragraphe B, également long, qui mentionne Lisbonne et son grand séisme historique de 1755.";
const LONG_C = "Ceci est un paragraphe C, tout aussi long, qui évoque cette fois l'Arabie et ses caravanes du désert.";

function buildText(...paragraphs) {
  return paragraphs.join("\n\n");
}

/* ===================== Comportement par défaut : paragraphe courant seul ===================
 * "Paragraphe courant seul par défaut" — le voisinage n'est jamais inclus
 * pour un paragraphe de longueur normale, quelle que soit sa position
 * (premier, milieu, dernier). C'est le correctif du faux positif rapporté :
 * une fiche mentionnée dans un paragraphe voisin ne devait plus rester
 * affichée simplement parce que le curseur était resté à proximité. */

test("paragraphe LONG, position quelconque : jamais de voisinage, même au milieu", () => {
  const text = buildText(LONG_A, LONG_B, LONG_C);

  const offsetFirst = text.indexOf(LONG_A) + 5;
  assert.equal(extractContextWindow(text, offsetFirst), LONG_A);

  const offsetMiddle = text.indexOf("Lisbonne");
  assert.equal(extractContextWindow(text, offsetMiddle), LONG_B);

  const offsetLast = text.indexOf(LONG_C) + 5;
  assert.equal(extractContextWindow(text, offsetLast), LONG_C);
});

test("déplacement du curseur d'un paragraphe LONG à un autre : aucune trace de l'ancien paragraphe", () => {
  const text = buildText(LONG_A, LONG_B, LONG_C);

  const windowOnB = extractContextWindow(text, text.indexOf("Lisbonne"));
  assert.match(windowOnB, /Lisbonne/);
  assert.doesNotMatch(windowOnB, /Arabie/);

  const windowOnC = extractContextWindow(text, text.indexOf("Arabie"));
  assert.match(windowOnC, /Arabie/);
  assert.doesNotMatch(windowOnC, /Lisbonne/, "le paragraphe précédent (Lisbonne) ne doit plus apparaître une fois le curseur ailleurs");
});

/* ===================== Élargissement : paragraphe très court seulement =====================
 * Les paragraphes PARA_A/B/C ci-dessous font moins de 50 caractères
 * (SHORT_PARAGRAPH_THRESHOLD) : ce sont des fragments (didascalie, réplique
 * isolée…) où le paragraphe seul ne fournit pas assez de matière au moteur
 * de contexte — le voisinage compense alors, jusqu'à `radius` de chaque
 * côté (par défaut 1). */

test("premier paragraphe COURT : pas de précédent, courant + suivant seulement", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf(PARA_A) + 3; // quelque part dans le premier paragraphe
  assert.equal(extractContextWindow(text, offset), [PARA_A, PARA_B].join("\n\n"));
});

test("paragraphe COURT du milieu : précédent + courant + suivant réunis", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf("ligne deux");
  assert.equal(extractContextWindow(text, offset), [PARA_A, PARA_B, PARA_C].join("\n\n"));
});

test("dernier paragraphe COURT : précédent + courant seulement, pas de suivant", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf(PARA_C) + 5;
  assert.equal(extractContextWindow(text, offset), [PARA_B, PARA_C].join("\n\n"));
});

test("un paragraphe COURT entre deux paragraphes LONGS : élargi ; eux, non", () => {
  const text = buildText(LONG_A, PARA_B, LONG_C);

  // Le fragment court est élargi à ses deux voisins longs.
  const onShort = extractContextWindow(text, text.indexOf("ligne deux"));
  assert.equal(onShort, [LONG_A, PARA_B, LONG_C].join("\n\n"));

  // Mais un LONG voisin d'un COURT reste lui-même non élargi.
  const onLongA = extractContextWindow(text, text.indexOf(LONG_A) + 5);
  assert.equal(onLongA, LONG_A);
});

test("radius explicite (paragraphe COURT) : élargit au-delà de 1 si demandé", () => {
  const text = buildText(LONG_A, PARA_B, LONG_C);
  const offset = text.indexOf("ligne deux");
  assert.equal(extractContextWindow(text, offset, 1), [LONG_A, PARA_B, LONG_C].join("\n\n"));
});

test("radius 0 explicite : jamais élargi, même sur un paragraphe très court", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf("ligne deux");
  assert.equal(extractContextWindow(text, offset, 0), PARA_B);
});

/* ===================== Frontmatter, offsets hors bornes, cas limites ===================== */

test("frontmatter YAML exclu du résultat et de la position du curseur", () => {
  const fm = "---\ntitle: Test\ntags: [a, b]\n---\n";
  const text = fm + buildText(PARA_A, PARA_B, PARA_C);
  const offset = text.indexOf("ligne deux");

  const result = extractContextWindow(text, offset);
  assert.equal(result, [PARA_A, PARA_B, PARA_C].join("\n\n"));
  assert.equal(result.includes("title: Test"), false);
  assert.equal(result.includes("---"), false);
});

test("un offset tombant DANS le frontmatter est ramené au tout début du corps", () => {
  const fm = "---\ntitle: Test\n---\n";
  const text = fm + buildText(PARA_A, PARA_B, PARA_C);
  const offset = 2; // en plein dans le bloc frontmatter
  assert.equal(extractContextWindow(text, offset), [PARA_A, PARA_B].join("\n\n"));
});

test("offset hors limites : négatif borné à 0", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  assert.equal(extractContextWindow(text, -500), [PARA_A, PARA_B].join("\n\n"));
});

test("offset hors limites : trop grand borné à la fin du texte", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  assert.equal(extractContextWindow(text, text.length + 999), [PARA_B, PARA_C].join("\n\n"));
});

test("offset non fini (NaN) traité comme 0, sans lever d'erreur", () => {
  const text = buildText(PARA_A, PARA_B, PARA_C);
  assert.equal(extractContextWindow(text, Number.NaN), [PARA_A, PARA_B].join("\n\n"));
});

test("texte vide : chaîne vide, sans erreur", () => {
  assert.equal(extractContextWindow("", 0), "");
  assert.equal(extractContextWindow("", 50), "");
});

test("plusieurs lignes vides consécutives comptent comme un seul séparateur", () => {
  const text = `${PARA_A}\n\n\n\n${PARA_B}`;
  const offset = text.indexOf(PARA_B) + 2;
  assert.equal(extractContextWindow(text, offset), [PARA_A, PARA_B].join("\n\n"));
});

test("un seul paragraphe dans tout le texte : fenêtre réduite à lui-même", () => {
  const text = PARA_A;
  assert.equal(extractContextWindow(text, 3), PARA_A);
});

test("fonction pure : aucun état mémorisé entre deux appels successifs sur des offsets différents", () => {
  const text = buildText(LONG_A, LONG_B, LONG_C);
  const first = extractContextWindow(text, text.indexOf("Lisbonne"));
  const second = extractContextWindow(text, text.indexOf("Arabie"));
  const again = extractContextWindow(text, text.indexOf("Lisbonne"));
  assert.equal(first, LONG_B);
  assert.equal(second, LONG_C);
  assert.equal(again, LONG_B, "un appel identique redonne exactement le même résultat, jamais influencé par l'appel intermédiaire");
});
