import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renamespaceFootnotes,
  nextFootnoteNumber,
  renumberFootnotes,
} from "../src/utils/footnotes.js";

test("renamespaceFootnotes", async (t) => {
  await t.test("préfixe la référence et la définition de façon cohérente", () => {
    const content = "Un fait notable[^1].\n\n[^1]: La source de ce fait.";
    const result = renamespaceFootnotes(content, "chap1");
    assert.equal(
      result,
      "Un fait notable[^chap1-1].\n\n[^chap1-1]: La source de ce fait."
    );
  });

  await t.test("gère plusieurs notes distinctes sans les confondre", () => {
    const content = "A[^1] puis B[^2].\n\n[^1]: Note un.\n[^2]: Note deux.";
    const result = renamespaceFootnotes(content, "f");
    assert.equal(
      result,
      "A[^f-1] puis B[^f-2].\n\n[^f-1]: Note un.\n[^f-2]: Note deux."
    );
  });

  await t.test("préserve le corps d'une définition multi-lignes", () => {
    const content = "Texte[^n].\n\n[^n]: Premier paragraphe.\n\n    Second paragraphe indenté.";
    const result = renamespaceFootnotes(content, "s2");
    assert.equal(
      result,
      "Texte[^s2-n].\n\n[^s2-n]: Premier paragraphe.\n\n    Second paragraphe indenté."
    );
  });

  await t.test("tolère des identifiants alphanumériques", () => {
    const content = "Texte[^note-importante].\n\n[^note-importante]: Contenu.";
    const result = renamespaceFootnotes(content, "x");
    assert.equal(
      result,
      "Texte[^x-note-importante].\n\n[^x-note-importante]: Contenu."
    );
  });

  await t.test("ne modifie rien sans note de bas de page", () => {
    const content = "Un texte tout à fait ordinaire, sans note.";
    assert.equal(renamespaceFootnotes(content, "f"), content);
  });

  await t.test("deux fichiers avec le même id '1' ne collisionnent plus", () => {
    const a = renamespaceFootnotes("A[^1].\n\n[^1]: Note A.", "fileA");
    const b = renamespaceFootnotes("B[^1].\n\n[^1]: Note B.", "fileB");
    assert.ok(a.includes("[^fileA-1]"));
    assert.ok(b.includes("[^fileB-1]"));
    assert.notEqual(a, b);
  });

  await t.test("retourne le contenu tel quel sans préfixe ou sans contenu", () => {
    assert.equal(renamespaceFootnotes("texte[^1]", ""), "texte[^1]");
    assert.equal(renamespaceFootnotes("", "f"), "");
    assert.equal(renamespaceFootnotes(null, "f"), null);
  });
});

test("nextFootnoteNumber", async (t) => {
  await t.test("1 si aucune note", () => {
    assert.equal(nextFootnoteNumber("Un texte sans note."), 1);
    assert.equal(nextFootnoteNumber(""), 1);
  });

  await t.test("le max + 1", () => {
    assert.equal(nextFootnoteNumber("A[^1] B[^2] C[^5]."), 6);
  });

  await t.test("ignore les identifiants nommés non numériques", () => {
    assert.equal(nextFootnoteNumber("A[^1] B[^remarque]."), 2);
    assert.equal(nextFootnoteNumber("Seulement[^remarque]."), 1);
  });
});

test("renumberFootnotes", async (t) => {
  await t.test("remet une suite à trous en 1, 2, 3…", () => {
    const content = "A[^1] B[^3] C[^4].\n\n[^1]: Un.\n[^3]: Trois.\n[^4]: Quatre.";
    const result = renumberFootnotes(content);
    assert.equal(
      result,
      "A[^1] B[^2] C[^3].\n\n[^1]: Un.\n[^2]: Trois.\n[^3]: Quatre."
    );
  });

  await t.test("respecte l'ordre de première apparition, pas la valeur numérique", () => {
    const content = "A[^9] B[^2].\n\n[^9]: Neuf d'abord.\n[^2]: Deux ensuite.";
    const result = renumberFootnotes(content);
    assert.equal(
      result,
      "A[^1] B[^2].\n\n[^1]: Neuf d'abord.\n[^2]: Deux ensuite."
    );
  });

  await t.test("est idempotent sur un fichier déjà propre", () => {
    const clean = "A[^1] B[^2].\n\n[^1]: Un.\n[^2]: Deux.";
    assert.equal(renumberFootnotes(clean), clean);
  });

  await t.test("ne change rien sans note de bas de page", () => {
    const content = "Un texte tout à fait ordinaire.";
    assert.equal(renumberFootnotes(content), content);
  });

  await t.test("gère les identifiants nommés au même titre que les numériques", () => {
    const content = "A[^intro] B[^1].\n\n[^intro]: Note d'intro.\n[^1]: Note un.";
    const result = renumberFootnotes(content);
    assert.equal(
      result,
      "A[^1] B[^2].\n\n[^1]: Note d'intro.\n[^2]: Note un."
    );
  });
});
