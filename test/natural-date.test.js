import test from "node:test";
import assert from "node:assert/strict";
import {
  parseIsoDate,
  parseNaturalDate,
  parseFlexibleDate,
  formatNaturalDate,
} from "../src/utils/natural-date.js";

test("parseNaturalDate : année seule (« 765 »)", () => {
  const d = parseNaturalDate("765");
  assert.equal(d.year, 765);
  assert.equal(d.month, 1);
  assert.equal(d.day, 1);
  assert.equal(d.precision, "year");
  assert.equal(d.era, null);
  assert.equal(formatNaturalDate(d), "765");
});

test("parseNaturalDate : jour + mois + année (« 12 mars 765 »)", () => {
  const d = parseNaturalDate("12 mars 765");
  assert.equal(d.year, 765);
  assert.equal(d.month, 3);
  assert.equal(d.day, 12);
  assert.equal(d.precision, "day");
  assert.equal(formatNaturalDate(d), "12 mars 765");
});

test("parseNaturalDate : mois + année (« mars 765 »)", () => {
  const d = parseNaturalDate("mars 765");
  assert.equal(d.month, 3);
  assert.equal(d.year, 765);
  assert.equal(d.precision, "month");
  assert.equal(formatNaturalDate(d), "mars 765");
});

test("parseNaturalDate : jour ordinal « 1er » + heure (« 1er novembre 1755 à 9 h 30 »)", () => {
  const d = parseNaturalDate("1er novembre 1755 à 9 h 30");
  assert.equal(d.day, 1);
  assert.equal(d.month, 11);
  assert.equal(d.year, 1755);
  assert.equal(d.hour, 9);
  assert.equal(d.minute, 30);
  assert.equal(formatNaturalDate(d), "1er novembre 1755 à 9 h 30");
});

test("parseNaturalDate : « 1er novembre 1755 » sans heure", () => {
  const d = parseNaturalDate("1er novembre 1755");
  assert.equal(d.day, 1);
  assert.equal(d.month, 11);
  assert.equal(d.year, 1755);
  assert.equal(d.hour, undefined);
  assert.equal(formatNaturalDate(d), "1er novembre 1755");
});

test("parseNaturalDate : avant J.-C. (« 44 av. J.-C. » et « 15 mars 44 av. J.-C. »)", () => {
  const yearOnly = parseNaturalDate("44 av. J.-C.");
  assert.equal(yearOnly.year, -44);
  assert.equal(yearOnly.era, "BC");
  assert.equal(formatNaturalDate(yearOnly), "44 av. J.-C.");

  const full = parseNaturalDate("15 mars 44 av. J.-C.");
  assert.equal(full.year, -44);
  assert.equal(full.month, 3);
  assert.equal(full.day, 15);
  assert.equal(formatNaturalDate(full), "15 mars 44 av. J.-C.");
});

test("parseNaturalDate : après J.-C. explicite (« 1 apr. J.-C. »)", () => {
  const d = parseNaturalDate("1 apr. J.-C.");
  assert.equal(d.year, 1);
  assert.equal(d.era, "AD");
  assert.equal(formatNaturalDate(d), "1 apr. J.-C.");
});

test("parseNaturalDate : approximatif (« vers 450 av. J.-C. »)", () => {
  const d = parseNaturalDate("vers 450 av. J.-C.");
  assert.equal(d.year, -450);
  assert.equal(d.approx, true);
  assert.equal(formatNaturalDate(d), "vers 450 av. J.-C.");
});

test("« vers » n'implique jamais un statut anachronique strict côté appelant : le flag approx est disponible", () => {
  // Le moteur d'évaluation (chronology-matcher) ne regarde que year/month/day
  // pour la comparaison — approx reste un simple indicateur d'affichage,
  // jamais utilisé pour durcir une comparaison ; on vérifie juste qu'il est
  // bien porté par le résultat, pour un futur appelant qui voudrait
  // assouplir son propre seuil d'alerte.
  const d = parseNaturalDate("vers 100");
  assert.equal(d.approx, true);
});

test("ordre correct entre dates avant et après J.-C.", () => {
  const twoBC = parseFlexibleDate("2 av. J.-C.");
  const oneBC = parseFlexibleDate("1 av. J.-C.");
  const oneAD = parseFlexibleDate("1 apr. J.-C.");
  const twoAD = parseFlexibleDate("2 apr. J.-C.");

  const ordinal = (d) => d.year * 10000 + d.month * 100 + d.day;
  assert.ok(ordinal(twoBC) < ordinal(oneBC));
  assert.ok(ordinal(oneBC) < ordinal(oneAD));
  assert.ok(ordinal(oneAD) < ordinal(twoAD));
});

test("absence d'année zéro dans l'affichage, y compris à la frontière av./apr. J.-C.", () => {
  for (const raw of ["2 av. J.-C.", "1 av. J.-C.", "1 apr. J.-C.", "2 apr. J.-C.", "vers 450 av. J.-C.", "765"]) {
    const display = formatNaturalDate(parseFlexibleDate(raw));
    assert.ok(display, `${raw} devrait se formater`);
    assert.ok(!/(^|\D)0+(\D|$)/.test(display), `"${display}" ne doit jamais contenir une année 0`);
  }
});

test("parseIsoDate : compatibilité ascendante avec l'ancien format ISO", () => {
  assert.deepEqual(parseIsoDate("1755"), { year: 1755, month: 1, day: 1, precision: "year", era: null, approx: false });
  assert.deepEqual(parseIsoDate("1755-11"), { year: 1755, month: 11, day: 1, precision: "month", era: null, approx: false });
  assert.deepEqual(parseIsoDate("1755-11-03"), { year: 1755, month: 11, day: 3, precision: "day", era: null, approx: false });
});

test("parseFlexibleDate : ISO et français naturel sont tous deux acceptés", () => {
  assert.ok(parseFlexibleDate("1755-11-03"));
  assert.ok(parseFlexibleDate("12 mars 765"));
  assert.equal(parseFlexibleDate("n'importe quoi"), null);
});

test("aucune valeur brute 0765 / -0044 / 11-01 ne fuite dans l'affichage", () => {
  assert.equal(formatNaturalDate(parseFlexibleDate("0765")), "765");
  assert.equal(formatNaturalDate(parseFlexibleDate("-0044")), "44 av. J.-C.");
  // "11-01" (année 11, mois 01) reste un format ISO année-mois valide —
  // jamais affiché en tiret brut, toujours reformaté en français naturel.
  const display = formatNaturalDate(parseFlexibleDate("11-01"));
  assert.equal(display, "janvier 11");
  assert.ok(!display.includes("-"), `"${display}" ne doit jamais contenir de tiret ISO`);
});

/* ================== Heure ISO (ancien usage préservé) ================== */

test("parseIsoDate : ancien usage avec heure, séparateur espace ou « T »", () => {
  const space = parseIsoDate("1755-11-01 09:30");
  assert.equal(space.year, 1755);
  assert.equal(space.month, 11);
  assert.equal(space.day, 1);
  assert.equal(space.hour, 9);
  assert.equal(space.minute, 30);
  assert.equal(formatNaturalDate(space), "1er novembre 1755 à 9 h 30");

  const iso = parseIsoDate("1755-11-01T09:30");
  assert.deepEqual(iso, space, "les deux séparateurs produisent le même résultat");
});

test("l'heure reste PUREMENT informative : elle ne modifie jamais l'ordre/tri (year*10000+month*100+day)", () => {
  const withTime = parseIsoDate("1755-11-01 23:59");
  const withoutTime = parseIsoDate("1755-11-01");
  const ordinal = (d) => d.year * 10000 + d.month * 100 + d.day;
  assert.equal(ordinal(withTime), ordinal(withoutTime), "l'heure ne doit jamais influencer l'ordinal comparable");
});

test("heure invalide (hors 0-23) ou minute invalide (hors 0-59) : date ENTIÈRE rejetée", () => {
  assert.equal(parseIsoDate("1755-11-01 24:00"), null);
  assert.equal(parseIsoDate("1755-11-01 12:60"), null);
  assert.equal(parseNaturalDate("1er novembre 1755 à 24 h"), null);
  assert.equal(parseNaturalDate("1er novembre 1755 à 9 h 60"), null);
});

/* ================== Année zéro : toujours rejetée ================== */

test("année zéro toujours rejetée : « 0 », « 0 av. J.-C. », « 0 apr. J.-C. », « -0000 »", () => {
  assert.equal(parseFlexibleDate("0"), null);
  assert.equal(parseFlexibleDate("0 av. J.-C."), null);
  assert.equal(parseFlexibleDate("0 apr. J.-C."), null);
  assert.equal(parseFlexibleDate("-0000"), null);
});

/* ================== ISO invalide : un seul jeu de règles ================== */

test("ISO invalide rejeté de façon cohérente : mois 13, 31 février, jour 0", () => {
  assert.equal(parseIsoDate("1900-13-01"), null);
  assert.equal(parseIsoDate("1900-02-31"), null);
  assert.equal(parseIsoDate("1900-01-00"), null);
});
