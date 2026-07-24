import { test } from "node:test";
import assert from "node:assert/strict";
import { bookmarkIdFor, markedMarkdownFor, bookmarkMarkerInfoOf } from "../src/utils/docx-bookmarks.js";

test("bookmarkIdFor", async (t) => {
  await t.test("est stable pour un même chemin", () => {
    const path = "Essai/Histoire de France/Manuscrit/Partie I/Chapitre 3.md";
    assert.equal(bookmarkIdFor(path), bookmarkIdFor(path));
  });

  await t.test("des chemins différents donnent des identifiants différents", () => {
    assert.notEqual(
      bookmarkIdFor("Manuscrit/Chapitre 1.md"),
      bookmarkIdFor("Manuscrit/Chapitre 2.md")
    );
  });

  await t.test("respecte les contraintes d'un nom de signet Word", () => {
    const id = bookmarkIdFor("Essai/Histoire de France/Manuscrit/Partie I/Chapitre 3 — la Régence.md");
    assert.ok(/^[a-zA-Z][a-zA-Z0-9_]*$/.test(id), `"${id}" doit être alphanumérique, commencer par une lettre`);
    assert.ok(id.length <= 40, `"${id}" doit faire 40 caractères max`);
  });

  await t.test("un chemin très long reste sous la limite de 40 caractères", () => {
    const longPath = "Essai/" + "Sous-dossier très long et répété/".repeat(10) + "Chapitre.md";
    const id = bookmarkIdFor(longPath);
    assert.ok(id.length <= 40);
  });

  await t.test("gère une entrée vide sans planter", () => {
    assert.ok(/^[a-zA-Z][a-zA-Z0-9_]*$/.test(bookmarkIdFor("")));
    assert.ok(/^[a-zA-Z][a-zA-Z0-9_]*$/.test(bookmarkIdFor(undefined)));
  });
});

test("markedMarkdownFor : un marqueur par segment, avec l'identifiant du chemin", () => {
  const out = markedMarkdownFor([
    { path: "Manuscrit/Ch1/S1.md", text: "Texte un." },
    { path: "Manuscrit/Ch1/S2.md", text: "Texte deux." },
  ]);
  assert.match(out, new RegExp(`^FEUILLETS-SCENE:${bookmarkIdFor("Manuscrit/Ch1/S1.md")}\\n\\nTexte un\\.`));
  assert.ok(out.includes(`FEUILLETS-SCENE:${bookmarkIdFor("Manuscrit/Ch1/S2.md")}`));
});

test("markedMarkdownFor : un segment sans chemin pose le marqueur de remise à zéro", () => {
  const out = markedMarkdownFor([{ text: "Deuxième partie" }]);
  assert.equal(out, "FEUILLETS-SCENE:reset\n\nDeuxième partie");
});

test("markedMarkdownFor : le type de page Front est suffixé au marqueur", () => {
  const out = markedMarkdownFor([{ path: "a.md", text: "T", frontType: "dedicace" }]);
  assert.ok(out.startsWith(`FEUILLETS-SCENE:${bookmarkIdFor("a.md")}:dedicace\n\n`));
});

test("bookmarkMarkerInfoOf : relit ce que markedMarkdownFor a écrit", () => {
  const id = bookmarkIdFor("Manuscrit/Ch1/S1.md");
  assert.deepEqual(bookmarkMarkerInfoOf({ textContent: `FEUILLETS-SCENE:${id}` }), {
    id, frontType: null,
  });
  assert.deepEqual(bookmarkMarkerInfoOf({ textContent: `FEUILLETS-SCENE:${id}:titre` }), {
    id, frontType: "titre",
  });
});

test("bookmarkMarkerInfoOf : le marqueur de remise à zéro donne id null", () => {
  const info = bookmarkMarkerInfoOf({ textContent: "FEUILLETS-SCENE:reset" });
  assert.notEqual(info, null, "doit rester reconnu comme marqueur");
  assert.equal(info.id, null);
});

test("bookmarkMarkerInfoOf : null sur du contenu ordinaire", () => {
  assert.equal(bookmarkMarkerInfoOf({ textContent: "Il faisait nuit." }), null);
  assert.equal(bookmarkMarkerInfoOf({ textContent: "" }), null);
  assert.equal(bookmarkMarkerInfoOf(null), null);
  // type Front inconnu : le marqueur entier est rejeté
  assert.equal(bookmarkMarkerInfoOf({ textContent: "FEUILLETS-SCENE:fsabc:inconnu" }), null);
});

test("aller-retour : chaque segment est retrouvable par son identifiant", () => {
  const segments = [
    { path: "Manuscrit/Ch1/S1.md", text: "un" },
    { path: "Manuscrit/Ch2/S2.md", text: "deux" },
    { text: "titre de partie" },
  ];
  const lignes = markedMarkdownFor(segments)
    .split("\n")
    .filter((l) => l.startsWith("FEUILLETS-SCENE:"));

  const relus = lignes.map((l) => bookmarkMarkerInfoOf({ textContent: l }));
  assert.deepEqual(relus.map((r) => r.id), [
    bookmarkIdFor("Manuscrit/Ch1/S1.md"),
    bookmarkIdFor("Manuscrit/Ch2/S2.md"),
    null,
  ]);
});
