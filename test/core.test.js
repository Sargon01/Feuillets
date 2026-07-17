import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countWords,
  foldAccents,
  escapeRegExp,
  embedHardBreaks,
  todayKey,
  parseStoryDate,
  compactLineBreaks,
  frenchTypography,
} from "../src/utils/core.js";

test("countWords", async (t) => {
  await t.test("compte les mots d'un texte simple", () => {
    assert.equal(countWords("Un jour, elle partit."), 4);
  });

  await t.test("retire le frontmatter YAML", () => {
    const text = "---\ntitre: Chapitre 1\nstatut: Brouillon\n---\nBonjour le monde";
    assert.equal(countWords(text), 3);
  });

  await t.test("ignore le contenu des blocs de code", () => {
    const text = "Avant.\n```js\nconst a = 1; const b = 2; const c = 3;\n```\nAprès.";
    assert.equal(countWords(text), 2);
  });

  await t.test("garde l'alias d'un wikilien [[cible|alias]]", () => {
    assert.equal(countWords("Elle vit [[Personnage Un|Marie]] au loin."), 5);
  });

  await t.test("garde le nom d'un wikilien simple [[cible]]", () => {
    assert.equal(countWords("Elle vit [[Marie]] au loin."), 5);
  });

  await t.test("garde le texte visible d'un lien Markdown", () => {
    assert.equal(countWords("Voir [ce lien](https://example.com) ici."), 4);
  });

  await t.test("ignore la ponctuation de structure Markdown pure", () => {
    assert.equal(countWords("# *** > ` ~ _"), 0);
  });

  await t.test("chaîne vide renvoie 0", () => {
    assert.equal(countWords(""), 0);
  });

  await t.test("compte les mots accentués comme des mots normaux", () => {
    assert.equal(countWords("Été à Paris, déjà présent."), 5);
  });
});

test("foldAccents", () => {
  assert.equal(foldAccents("Été"), "ete");
  assert.equal(foldAccents("À bientôt, château !"), "a bientot, chateau !");
  assert.equal(foldAccents("déjà"), "deja");
  assert.equal(foldAccents(""), "");
});

test("escapeRegExp", () => {
  assert.equal(escapeRegExp("a.b*c"), "a\\.b\\*c");
  assert.equal(escapeRegExp("[test](url)"), "\\[test\\]\\(url\\)");
  assert.equal(escapeRegExp("chapitre 1"), "chapitre 1");
  assert.match("prix: 3.14$", new RegExp(escapeRegExp("3.14$")));
});

test("embedHardBreaks", async (t) => {
  await t.test("ajoute un retour forcé sur une ligne simple suivie d'une autre ligne", () => {
    const input = "Première ligne\nDeuxième ligne";
    assert.equal(embedHardBreaks(input), "Première ligne\\\nDeuxième ligne");
  });

  await t.test("laisse intacte la dernière ligne d'un paragraphe", () => {
    const input = "Seule ligne du paragraphe";
    assert.equal(embedHardBreaks(input), "Seule ligne du paragraphe");
  });

  await t.test("ne touche pas aux lignes structurelles (titres, listes, citations)", () => {
    const input = "# Titre\nTexte normal\n- item 1\n- item 2";
    assert.equal(
      embedHardBreaks(input),
      "# Titre\nTexte normal\n- item 1\n- item 2"
    );
  });

  await t.test("ne touche pas à une ligne juste avant une ligne structurelle", () => {
    const input = "Texte avant\n> citation";
    assert.equal(embedHardBreaks(input), "Texte avant\n> citation");
  });

  await t.test("préserve les paragraphes séparés par une ligne vide", () => {
    const input = "Ligne A\nLigne B\n\nLigne C\nLigne D";
    assert.equal(
      embedHardBreaks(input),
      "Ligne A\\\nLigne B\n\nLigne C\\\nLigne D"
    );
  });
});

test("parseStoryDate", async (t) => {
  await t.test("année seule", () => {
    assert.deepEqual(parseStoryDate("1890"), {
      sort: 18900000,
      y: 1890,
      mo: 0,
      d: 0,
      display: "1890",
    });
  });

  await t.test("année-mois", () => {
    assert.deepEqual(parseStoryDate("1890-05"), {
      sort: 18900500,
      y: 1890,
      mo: 5,
      d: 0,
      display: "1890-05",
    });
  });

  await t.test("année-mois-jour", () => {
    assert.deepEqual(parseStoryDate("1890-05-12"), {
      sort: 18900512,
      y: 1890,
      mo: 5,
      d: 12,
      display: "1890-05-12",
    });
  });

  await t.test("année négative", () => {
    const result = parseStoryDate("-500");
    assert.equal(result.y, -500);
  });

  await t.test("aucune donnée et pas de fichier renvoie null", () => {
    assert.equal(parseStoryDate(null), null);
    assert.equal(parseStoryDate(undefined), null);
    assert.equal(parseStoryDate(""), null);
  });

  await t.test("repli sur le nom de fichier au format AAAA[-MM[-JJ]]", () => {
    const file = { basename: "1890-05-12 - Ouverture" };
    const result = parseStoryDate("", file);
    assert.equal(result.y, 1890);
    assert.equal(result.mo, 5);
    assert.equal(result.d, 12);
  });

  await t.test("un nom de fichier comme 10.md (numérotation de chapitre) n'est jamais pris pour une date", () => {
    const file = { basename: "10" };
    assert.equal(parseStoryDate("", file), null);
    const file2 = { basename: "4" };
    assert.equal(parseStoryDate(null, file2), null);
  });
});

test("todayKey", () => {
  const key = todayKey();
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);

  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  assert.equal(key, expected);
});

test("compactLineBreaks", async (t) => {
  await t.test("supprime une ligne vide isolée entre deux lignes de texte", () => {
    assert.equal(compactLineBreaks("Ligne A\n\nLigne B"), "Ligne A\nLigne B");
  });

  await t.test("préserve un vrai paragraphe (2 lignes vides consécutives)", () => {
    assert.equal(
      compactLineBreaks("Ligne A\n\n\nLigne B"),
      "Ligne A\n\n\nLigne B"
    );
  });

  await t.test("préserve une ligne vide adjacente à une ligne structurelle", () => {
    assert.equal(compactLineBreaks("Ligne A\n\n# Titre"), "Ligne A\n\n# Titre");
    assert.equal(compactLineBreaks("Ligne A\n\n- item"), "Ligne A\n\n- item");
  });

  await t.test("préserve une ligne vide en tout début de texte", () => {
    assert.equal(compactLineBreaks("\nLigne A\nLigne B"), "\nLigne A\nLigne B");
  });
});

test("frenchTypography", async (t) => {
  await t.test("guillemets, apostrophe et points de suspension", () => {
    assert.equal(
      frenchTypography('Il dit: "bonjour" puis partit...', false),
      "Il dit : « bonjour » puis partit…"
    );
  });

  await t.test("espace fine avant la ponctuation double sans espace initial", () => {
    assert.equal(
      frenchTypography("Quoi? Vraiment!", false),
      "Quoi ? Vraiment !"
    );
  });

  await t.test("préserve le frontmatter quand skipFrontmatter est vrai", () => {
    assert.equal(
      frenchTypography('---\ntitre: test\n---\n"citation"', true),
      '---\ntitre: test\n---\n« citation »'
    );
  });

  await t.test("ne modifie pas un texte sans motif à corriger", () => {
    assert.equal(frenchTypography("Un texte simple sans rien", false), "Un texte simple sans rien");
  });
});
