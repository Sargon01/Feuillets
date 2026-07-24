import test from "node:test";
import assert from "node:assert/strict";
import { latestStateBefore } from "../src/utils/entity-states.js";

const fiche = [
  "Quelques notes libres en tête de fiche.",
  "",
  "- **1789** : jeune avocat à Arras.",
  "- 1792 : député à la Convention.",
  "* 1794 — exécuté.",
  "",
  "Une ligne sans année qui ne doit rien déclencher.",
].join("\n");

test("latestStateBefore : retient le dernier état antérieur ou égal à l'année", () => {
  assert.deepEqual(latestStateBefore(fiche, 1793), { y: 1792, text: "député à la Convention." });
});

test("latestStateBefore : l'année exacte d'un état est incluse", () => {
  assert.deepEqual(latestStateBefore(fiche, 1789), { y: 1789, text: "jeune avocat à Arras." });
});

test("latestStateBefore : null si aucun état n'est antérieur à l'année", () => {
  assert.equal(latestStateBefore(fiche, 1788), null);
});

test("latestStateBefore : null sur une fiche sans ligne d'état", () => {
  assert.equal(latestStateBefore("Juste du texte.\n\nEt un paragraphe.", 1900), null);
});

test("latestStateBefore : accepte puce, gras et les différents séparateurs", () => {
  assert.deepEqual(latestStateBefore("**1815** : Waterloo.", 1900), { y: 1815, text: "Waterloo." });
  assert.deepEqual(latestStateBefore("- 1815 – Waterloo.", 1900), { y: 1815, text: "Waterloo." });
  assert.deepEqual(latestStateBefore("+ 1815 — Waterloo.", 1900), { y: 1815, text: "Waterloo." });
  assert.deepEqual(latestStateBefore("1815 - Waterloo.", 1900), { y: 1815, text: "Waterloo." });
  // deux-points pleine chasse, fréquent après un copier-coller
  assert.deepEqual(latestStateBefore("1815 ： Waterloo.", 1900), { y: 1815, text: "Waterloo." });
});

test("latestStateBefore : gère les années négatives (avant notre ère)", () => {
  const antiquite = ["-753 : fondation de Rome.", "-509 : chute de la royauté."].join("\n");
  assert.deepEqual(latestStateBefore(antiquite, -600), { y: -753, text: "fondation de Rome." });
  assert.deepEqual(latestStateBefore(antiquite, -100), { y: -509, text: "chute de la royauté." });
});

test("latestStateBefore : ignore les nombres à moins de 3 chiffres (listes numérotées)", () => {
  assert.equal(latestStateBefore("12 : ceci est un item de liste, pas une année.", 2000), null);
});

test("latestStateBefore : à année égale, la première ligne rencontrée gagne", () => {
  const doublon = ["1800 : premier état.", "1800 : second état."].join("\n");
  assert.deepEqual(latestStateBefore(doublon, 1900), { y: 1800, text: "premier état." });
});

test("latestStateBefore : l'ordre des lignes n'a pas à être chronologique", () => {
  const desordre = ["1900 : tardif.", "1700 : ancien.", "1800 : médian."].join("\n");
  assert.deepEqual(latestStateBefore(desordre, 1850), { y: 1800, text: "médian." });
});
