import test from "node:test";
import assert from "node:assert/strict";
import { evaluateChronology, parseChronologyDate } from "../src/services/chronology-matcher.js";

function ref(overrides) {
  return { id: "1", path: "ref.md", title: "Référence", ...overrides };
}

test("avant une borne (validFrom) : scène antérieure → anachronistic-before", () => {
  const [result] = evaluateChronology("1850", [ref({ title: "Train électrique", validFrom: "1879" })]);
  assert.equal(result.status, "anachronistic-before");
});

test("après une borne (validTo) : scène postérieure → anachronistic-after", () => {
  const [result] = evaluateChronology("1950", [ref({ title: "Diligence", validTo: "1900" })]);
  assert.equal(result.status, "anachronistic-after");
});

test("période compatible : scène entre validFrom et validTo → compatible", () => {
  const [result] = evaluateChronology("1850", [ref({ validFrom: "1800", validTo: "1900" })]);
  assert.equal(result.status, "compatible");
});

test("bornes incluses : scène exactement sur validFrom ou validTo → compatible", () => {
  const [onFrom] = evaluateChronology("1800", [ref({ validFrom: "1800", validTo: "1900" })]);
  assert.equal(onFrom.status, "compatible");

  const [onTo] = evaluateChronology("1900", [ref({ validFrom: "1800", validTo: "1900" })]);
  assert.equal(onTo.status, "compatible");

  // Bornes incluses à la précision jour également.
  const [onFromDay] = evaluateChronology("1879-05-10", [ref({ validFrom: "1879-05-10" })]);
  assert.equal(onFromDay.status, "compatible");

  const [onToDay] = evaluateChronology("1900-12-31", [ref({ validTo: "1900-12-31" })]);
  assert.equal(onToDay.status, "compatible");
});

test("date de scène absente ou invalide → unknown, quelle que soit la référence", () => {
  const references = [ref({ validFrom: "1879" }), ref({ date: "1900" })];

  const withoutDate = evaluateChronology(undefined, references);
  assert.deepEqual(withoutDate.map(r => r.status), ["unknown", "unknown"]);

  const withInvalidDate = evaluateChronology("pas-une-date", references);
  assert.deepEqual(withInvalidDate.map(r => r.status), ["unknown", "unknown"]);

  const withMalformedDate = evaluateChronology("1900-13-40", references);
  assert.deepEqual(withMalformedDate.map(r => r.status), ["unknown", "unknown"]);
});

test("formats acceptés : année, année-mois, année-mois-jour", () => {
  assert.deepEqual(parseChronologyDate("1755"), { year: 1755, month: 1, day: 1, precision: "year" });
  assert.deepEqual(parseChronologyDate("1755-11"), { year: 1755, month: 11, day: 1, precision: "month" });
  assert.deepEqual(parseChronologyDate("1755-11-03"), { year: 1755, month: 11, day: 3, precision: "day" });

  // valid_from: 1879 == 1879-01-01 (borne inférieure) — même statut que le
  // format explicite complet.
  const yearOnly = evaluateChronology("1878-12-31", [ref({ validFrom: "1879" })])[0];
  const explicitFull = evaluateChronology("1878-12-31", [ref({ validFrom: "1879-01-01" })])[0];
  assert.equal(yearOnly.status, "anachronistic-before");
  assert.equal(yearOnly.status, explicitFull.status);

  // valid_to: 1879 == 1879-12-31 (borne supérieure).
  const yearOnlyTo = evaluateChronology("1880-01-01", [ref({ validTo: "1879" })])[0];
  const explicitFullTo = evaluateChronology("1880-01-01", [ref({ validTo: "1879-12-31" })])[0];
  assert.equal(yearOnlyTo.status, "anachronistic-after");
  assert.equal(yearOnlyTo.status, explicitFullTo.status);

  // Même logique pour YYYY-MM : valid_to: 1879-02 == 1879-02-28 (non
  // bissextile) ; valid_from: 1879-02 == 1879-02-01.
  const monthTo = evaluateChronology("1879-03-01", [ref({ validTo: "1879-02" })])[0];
  assert.equal(monthTo.status, "anachronistic-after");
  const monthToInclusive = evaluateChronology("1879-02-28", [ref({ validTo: "1879-02" })])[0];
  assert.equal(monthToInclusive.status, "compatible");
});

test("année bissextile : 29 février valide en 1880, invalide en 1879", () => {
  assert.notEqual(parseChronologyDate("1880-02-29"), null);
  assert.equal(parseChronologyDate("1879-02-29"), null);

  // valid_to: 1880-02 doit couvrir jusqu'au 29 (bissextile), pas le 28.
  const compatible = evaluateChronology("1880-02-29", [ref({ validTo: "1880-02" })])[0];
  assert.equal(compatible.status, "compatible");
  const after = evaluateChronology("1880-03-01", [ref({ validTo: "1880-02" })])[0];
  assert.equal(after.status, "anachronistic-after");

  // Une date de scène invalide (29 février d'une année non bissextile) est
  // traitée comme absente → unknown.
  const invalidScene = evaluateChronology("1879-02-29", [ref({ validFrom: "1800" })])[0];
  assert.equal(invalidScene.status, "unknown");
});

test("événement ponctuel (date seule, sans validFrom/validTo) : même date → compatible, autre date → unknown", () => {
  const sameDate = evaluateChronology("1755-11-03", [ref({ title: "Séisme de Lisbonne", date: "1755-11-03" })])[0];
  assert.equal(sameDate.status, "compatible");

  const otherDate = evaluateChronology("1900-01-01", [ref({ title: "Séisme de Lisbonne", date: "1755-11-03" })])[0];
  assert.equal(otherDate.status, "unknown");

  // Recoupement par précision : un événement daté seulement "1755" et une
  // scène "1755-11-03" se recoupent (même année) → compatible.
  const overlapByYear = evaluateChronology("1755-11-03", [ref({ date: "1755" })])[0];
  assert.equal(overlapByYear.status, "compatible");

  // validFrom/validTo priment toujours sur date quand les deux sont
  // présents sur la même fiche.
  const rangeWins = evaluateChronology("1850", [ref({ date: "1755-11-03", validFrom: "1800" })])[0];
  assert.equal(rangeWins.status, "compatible");
});

test("aucune fiche exploitable (ni date, ni validFrom, ni validTo) → unknown", () => {
  const [result] = evaluateChronology("1900", [ref({ title: "Fiche sans date" })]);
  assert.equal(result.status, "unknown");
});

test("ordre stable : les résultats suivent EXACTEMENT l'ordre des références en entrée", () => {
  const references = [
    ref({ id: "a", title: "A", validFrom: "1950" }),   // anachronistic-before pour une scène 1800
    ref({ id: "b", title: "B", validTo: "1700" }),      // anachronistic-after
    ref({ id: "c", title: "C", validFrom: "1700", validTo: "1900" }), // compatible
    ref({ id: "d", title: "D" }),                        // unknown
  ];
  const results = evaluateChronology("1800", references);

  assert.deepEqual(results.map(r => r.reference.id), ["a", "b", "c", "d"]);
  assert.deepEqual(results.map(r => r.status), [
    "anachronistic-before",
    "anachronistic-after",
    "compatible",
    "unknown",
  ]);
});

test("aucune mutation : ni le tableau de références, ni les objets qu'il contient, ni la chaîne de date", () => {
  const references = [
    ref({ id: "a", validFrom: "1879" }),
    ref({ id: "b", date: "1755-11-03" }),
  ];
  const referencesSnapshot = JSON.parse(JSON.stringify(references));
  const sceneDate = "1755-11-03";

  const results = evaluateChronology(sceneDate, references);

  assert.deepEqual(references, referencesSnapshot, "le tableau et ses objets ne doivent pas être modifiés");
  assert.equal(sceneDate, "1755-11-03", "la chaîne de date de la scène reste inchangée");
  assert.equal(references.length, 2, "aucun élément ajouté/retiré du tableau original");
  // Chaque résultat référence bien l'objet ORIGINAL (identité), pas une copie.
  assert.equal(results[0].reference, references[0]);
  assert.equal(results[1].reference, references[1]);
});

test("cas réel : scène du 3 novembre 1755, trois inventions bien plus tardives sont toutes anachronistic-before", () => {
  const references = [
    ref({ id: "train", title: "Train électrique", validFrom: "1879" }),
    ref({ id: "photo", title: "Photographie", validFrom: "1826" }),
    ref({ id: "phone", title: "Téléphone portable", validFrom: "1973" }),
  ];

  const results = evaluateChronology("1755-11-03", references);

  assert.deepEqual(results.map(r => r.status), [
    "anachronistic-before",
    "anachronistic-before",
    "anachronistic-before",
  ]);
});
