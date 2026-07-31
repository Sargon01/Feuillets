import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renamespaceFootnotes,
  nextFootnoteNumber,
  renumberFootnotes,
  renumberFootnotesAcrossTexts,
  parseFootnotes,
  validateFootnotes,
  referenceIdAtOffset,
  definitionIdAtOffset,
  findDefinition,
  findReferences,
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

test("renumberFootnotesAcrossTexts", async (t) => {
  await t.test("numérotation continue à travers plusieurs segments (collision multi-fichiers)", () => {
    // Deux feuillets déjà renamespacés (chap1-1, chap2-1) pour éviter la
    // collision d'identifiants — la renumérotation du document compilé doit
    // les rendre continus : 1 puis 2, jamais 1 et 1 à nouveau.
    const segments = [
      "Fait notable[^chap1-1].\n\n[^chap1-1]: Source du chapitre 1.",
      "Autre fait[^chap2-1].\n\n[^chap2-1]: Source du chapitre 2.",
    ];
    const result = renumberFootnotesAcrossTexts(segments);
    assert.equal(result[0], "Fait notable[^1].\n\n[^1]: Source du chapitre 1.");
    assert.equal(result[1], "Autre fait[^2].\n\n[^2]: Source du chapitre 2.");
  });

  await t.test("un segment sans note reste inchangé", () => {
    const segments = ["# Partie 1", "Texte[^1].\n\n[^1]: Note.", "# Partie 2"];
    const result = renumberFootnotesAcrossTexts(segments);
    assert.equal(result[0], "# Partie 1");
    assert.equal(result[2], "# Partie 2");
  });

  await t.test("aucune note dans aucun segment -> tableau inchangé, mais une NOUVELLE référence", () => {
    // Piège d'aliasing : un appelant qui viderait ensuite le tableau reçu en
    // le mutant en place (compile-export.ts fait `parts.length = 0`) ne doit
    // jamais vider aussi le résultat par la même occasion.
    const segments = ["Texte simple.", "Encore du texte."];
    const result = renumberFootnotesAcrossTexts(segments);
    assert.deepEqual(result, segments);
    assert.notEqual(result, segments);
    segments.length = 0;
    assert.equal(result.length, 2);
  });

  await t.test("ne modifie aucun des textes d'entrée (nouveau tableau)", () => {
    const segments = ["A[^1].\n\n[^1]: Un.", "B[^1].\n\n[^1]: Deux."];
    const original = [...segments];
    renumberFootnotesAcrossTexts(segments);
    assert.deepEqual(segments, original);
  });
});

test("parseFootnotes", async (t) => {
  await t.test("un appel simple et sa définition", () => {
    const content = "Une phrase.[^1]\n\n[^1]: Contenu de la note.";
    const { references, definitions } = parseFootnotes(content);
    assert.equal(references.length, 1);
    assert.equal(references[0].id, "1");
    assert.equal(content.slice(references[0].start, references[0].end), "[^1]");
    assert.equal(definitions.length, 1);
    assert.equal(definitions[0].id, "1");
    assert.equal(definitions[0].content, "Contenu de la note.");
  });

  await t.test("identifiant nommé", () => {
    const content = "Une affirmation.[^source-principale]\n\n[^source-principale]: Voir l'ouvrage cité, page 42.";
    const { references, definitions } = parseFootnotes(content);
    assert.equal(references[0].id, "source-principale");
    assert.equal(definitions[0].id, "source-principale");
  });

  await t.test("plusieurs notes distinctes", () => {
    const content = "A[^1] et B[^2].\n\n[^1]: Un.\n[^2]: Deux.";
    const { references, definitions } = parseFootnotes(content);
    assert.deepEqual(references.map((r) => r.id), ["1", "2"]);
    assert.deepEqual(definitions.map((d) => d.id), ["1", "2"]);
  });

  await t.test("définition multiligne (paragraphe indenté)", () => {
    const content = "Texte[^n].\n\n[^n]: Premier paragraphe.\n\n    Second paragraphe indenté.";
    const { definitions } = parseFootnotes(content);
    assert.equal(definitions.length, 1);
    assert.equal(definitions[0].content, "Premier paragraphe.\n\nSecond paragraphe indenté.");
  });

  await t.test("appel sans définition — n'apparaît pas dans definitions", () => {
    const content = "Un appel orphelin[^1].";
    const { references, definitions } = parseFootnotes(content);
    assert.equal(references.length, 1);
    assert.equal(definitions.length, 0);
  });

  await t.test("définition sans appel — n'apparaît pas dans references", () => {
    const content = "Aucun appel ici.\n\n[^1]: Une note orpheline.";
    const { references, definitions } = parseFootnotes(content);
    assert.equal(references.length, 0);
    assert.equal(definitions.length, 1);
  });

  await t.test("définition vide", () => {
    const content = "Appel[^1].\n\n[^1]: ";
    const { definitions } = parseFootnotes(content);
    assert.equal(definitions[0].content, "");
  });

  await t.test("plusieurs appels vers la même définition", () => {
    const content = "A[^1] puis, plus loin, encore A[^1].\n\n[^1]: Une seule note, deux appels.";
    const { references, definitions } = parseFootnotes(content);
    assert.equal(references.length, 2);
    assert.equal(definitions.length, 1);
  });

  await t.test("note contenant du Markdown (gras, lien)", () => {
    const content = "Texte[^1].\n\n[^1]: Voir **ce livre** et [ce site](https://exemple.test).";
    const { definitions } = parseFootnotes(content);
    assert.equal(definitions[0].content, "Voir **ce livre** et [ce site](https://exemple.test).");
  });

  await t.test("note en fin de fichier", () => {
    const content = "Paragraphe.\n\nDernier paragraphe[^1].\n\n[^1]: Note finale.";
    const { definitions } = parseFootnotes(content);
    assert.equal(definitions[0].id, "1");
    assert.equal(definitions[0].end, content.length);
  });

  await t.test("note au milieu du fichier (une seule zone de définitions)", () => {
    const content = "Début[^1].\n\n[^1]: Note.\n\nSuite du texte après la note.";
    const { references, definitions } = parseFootnotes(content);
    assert.equal(references.length, 1);
    assert.equal(definitions.length, 1);
  });

  await t.test("un renvoi vers une autre note DANS une définition n'est pas un appel du texte principal", () => {
    const content = "Texte[^1].\n\n[^1]: Voir aussi[^2].\n[^2]: Note secondaire.";
    const { references } = parseFootnotes(content);
    assert.equal(references.length, 1);
    assert.equal(references[0].id, "1");
  });

  await t.test("manuscrit vide", () => {
    assert.deepEqual(parseFootnotes(""), { references: [], definitions: [] });
    assert.deepEqual(parseFootnotes(null), { references: [], definitions: [] });
  });
});

test("validateFootnotes", async (t) => {
  await t.test("aucune anomalie sur un fichier propre", () => {
    const content = "A[^1] et B[^2].\n\n[^1]: Un.\n[^2]: Deux.";
    assert.deepEqual(validateFootnotes(content), {
      missingDefinitions: [],
      unusedDefinitions: [],
      duplicateDefinitions: [],
      emptyDefinitions: [],
      malformedReferences: [],
    });
  });

  await t.test("appel sans définition", () => {
    const result = validateFootnotes("Un appel orphelin[^1].");
    assert.deepEqual(result.missingDefinitions, ["1"]);
  });

  await t.test("définition sans appel", () => {
    const result = validateFootnotes("Texte.\n\n[^1]: Orpheline.");
    assert.deepEqual(result.unusedDefinitions, ["1"]);
  });

  await t.test("identifiants dupliqués (plusieurs définitions au même id)", () => {
    const content = "A[^1].\n\n[^1]: Première.\n[^1]: Seconde définition en doublon.";
    const result = validateFootnotes(content);
    assert.deepEqual(result.duplicateDefinitions, ["1"]);
  });

  await t.test("définition vide", () => {
    const result = validateFootnotes("A[^1].\n\n[^1]: ");
    assert.deepEqual(result.emptyDefinitions, ["1"]);
  });

  await t.test("référence mal formée (identifiant vide)", () => {
    const result = validateFootnotes("Un appel cassé[^].");
    assert.equal(result.malformedReferences.length, 1);
    assert.equal(result.malformedReferences[0].id, "");
  });

  await t.test("plusieurs appels vers la même définition : pas un faux positif", () => {
    const content = "A[^1] puis B[^1] encore.\n\n[^1]: Une seule note.";
    const result = validateFootnotes(content);
    assert.deepEqual(result.missingDefinitions, []);
    assert.deepEqual(result.unusedDefinitions, []);
  });
});

test("referenceIdAtOffset / definitionIdAtOffset", async (t) => {
  const content = "Une phrase.[^1]\n\n[^1]: Contenu de la note.";
  const refOffset = content.indexOf("[^1]");
  const defOffset = content.lastIndexOf("[^1]:");

  await t.test("offset exactement sur l'appel", () => {
    assert.equal(referenceIdAtOffset(content, refOffset + 1), "1");
  });

  await t.test("offset juste après l'appel (curseur qui vient de le taper)", () => {
    assert.equal(referenceIdAtOffset(content, refOffset + 4), "1");
  });

  await t.test("offset loin de tout appel -> null", () => {
    assert.equal(referenceIdAtOffset("Une phrase sans aucune note.", 5), null);
  });

  await t.test("offset dans la définition", () => {
    assert.equal(definitionIdAtOffset(content, defOffset + 6), "1");
  });

  await t.test("offset dans le texte principal, hors définition -> null", () => {
    assert.equal(definitionIdAtOffset(content, 3), null);
  });
});

test("findDefinition / findReferences", async (t) => {
  const content = "A[^1] puis B[^1] encore, et C[^2].\n\n[^1]: Note un.\n[^2]: Note deux.";

  await t.test("findDefinition retrouve la bonne note", () => {
    assert.equal(findDefinition(content, "1").content, "Note un.");
    assert.equal(findDefinition(content, "absent"), null);
  });

  await t.test("findReferences retrouve tous les appels d'un identifiant", () => {
    assert.equal(findReferences(content, "1").length, 2);
    assert.equal(findReferences(content, "2").length, 1);
    assert.deepEqual(findReferences(content, "absent"), []);
  });
});
