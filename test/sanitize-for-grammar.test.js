import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeForGrammarCheck } from "../src/utils/sanitize-for-grammar.js";

test("sanitizeForGrammarCheck", async (t) => {
  await t.test("préserve toujours la longueur du texte (offsets identiques)", () => {
    const samples = [
      "Un [lien](https://example.com/chemin) dans une phrase.",
      "Une image ![alt texte](https://example.com/img.png) ici.",
      "Du `code inline` dans le texte.",
      "```\nbloc de code\nsur deux lignes\n```",
      "~~~\nautre bloc\n~~~",
      "Une formule $E = mc^2$ inline.",
      "Un bloc $$\\int_0^1 x dx$$ affiché.",
      "<!-- un commentaire\nsur deux lignes --> après.",
      "Texte normal sans rien de spécial.",
    ];
    for (const s of samples) {
      assert.equal(sanitizeForGrammarCheck(s).length, s.length, `longueur différente pour: ${s}`);
    }
  });

  await t.test("garde le texte visible d'un lien, masque le reste", () => {
    const out = sanitizeForGrammarCheck("Voir [ce lien](https://example.com/page) pour plus.");
    assert.ok(out.includes("ce lien"));
    assert.ok(!out.includes("https"));
    assert.equal(out.length, "Voir [ce lien](https://example.com/page) pour plus.".length);
  });

  await t.test("garde le texte alternatif d'une image, masque le reste", () => {
    const out = sanitizeForGrammarCheck("![un chat noir](img/chat.png)");
    assert.ok(out.includes("un chat noir"));
    assert.ok(!out.includes("chat.png"));
  });

  await t.test("masque le code inline sans casser le texte autour", () => {
    const out = sanitizeForGrammarCheck("Avant `du code bizarre` après.");
    assert.ok(out.startsWith("Avant "));
    assert.ok(out.endsWith(" après."));
    assert.ok(!out.includes("bizarre"));
  });

  await t.test("masque un bloc de code multi-lignes en gardant les sauts de ligne", () => {
    const input = "Avant.\n```\nligne un\nligne deux\n```\nAprès.";
    const out = sanitizeForGrammarCheck(input);
    assert.equal(out.split("\n").length, input.split("\n").length);
    assert.ok(!out.includes("ligne"));
    assert.ok(out.includes("Avant."));
    assert.ok(out.includes("Après."));
  });

  await t.test("masque LaTeX inline et bloc", () => {
    const out1 = sanitizeForGrammarCheck("La formule $x^2 + y^2 = z^2$ est connue.");
    assert.ok(!out1.includes("x^2"));
    const out2 = sanitizeForGrammarCheck("Résultat : $$\\sum_{i=0}^n i$$ voilà.");
    assert.ok(!out2.includes("sum"));
  });

  await t.test("masque les commentaires HTML", () => {
    const out = sanitizeForGrammarCheck("Texte <!-- secret --> visible.");
    assert.ok(!out.includes("secret"));
    assert.ok(out.includes("Texte"));
    assert.ok(out.includes("visible"));
  });

  await t.test("ne touche pas aux notes de bas de page [^1]", () => {
    const input = "Une phrase avec une note[^1].\n\n[^1]: Le texte de la note.";
    const out = sanitizeForGrammarCheck(input);
    assert.equal(out, input);
  });

  await t.test("laisse le texte normal totalement intact", () => {
    const input = "Une phrase tout à fait normale, sans rien de spécial.";
    assert.equal(sanitizeForGrammarCheck(input), input);
  });
});
