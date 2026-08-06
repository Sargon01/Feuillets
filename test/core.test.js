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
  stripMarkdown,
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

  await t.test("n'ajoute pas d'antislash juste avant le marqueur de ligne blanche visible de Feuillets", () => {
    // le marqueur ("\n" + une ligne ne contenant QUE l'espace insécable +
    // "\n\n", voir liveDoubleEnter dans main.js) sépare une ligne d'un
    // simple "\n", pas "\n\n" — sans ce cas, le antislash de saut forcé
    // atterrissait juste avant, visible tel quel à l'export Word
    const input = "Premier paragraphe.\n \n\nSecond paragraphe.";
    assert.equal(embedHardBreaks(input), input);
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

  /* ================ Dates en français naturel (chronologie simplifiée) ================
   * parseStoryDate accepte désormais, en plus de l'ISO déjà compatible
   * ci-dessus, le français naturel — voir utils/natural-date.ts. */

  await t.test("« 765 » (année seule, 3 chiffres)", () => {
    const result = parseStoryDate("765");
    assert.equal(result.y, 765);
    assert.equal(result.display, "765");
  });

  await t.test("« 12 mars 765 » (jour + mois + année)", () => {
    const result = parseStoryDate("12 mars 765");
    assert.equal(result.y, 765);
    assert.equal(result.mo, 3);
    assert.equal(result.d, 12);
    assert.equal(result.display, "12 mars 765");
  });

  await t.test("« 15 mars 44 av. J.-C. » (avant J.-C.)", () => {
    const result = parseStoryDate("15 mars 44 av. J.-C.");
    assert.equal(result.y, -44);
    assert.equal(result.mo, 3);
    assert.equal(result.d, 15);
    assert.equal(result.display, "15 mars 44 av. J.-C.");
  });

  await t.test("« vers 450 av. J.-C. » (approximatif) ne lève pas et se formate proprement", () => {
    const result = parseStoryDate("vers 450 av. J.-C.");
    assert.equal(result.y, -450);
    assert.equal(result.display, "vers 450 av. J.-C.");
  });

  await t.test("ordre correct entre dates avant et après J.-C.", () => {
    const twoBC = parseStoryDate("2 av. J.-C.");
    const oneBC = parseStoryDate("1 av. J.-C.");
    const oneAD = parseStoryDate("1 apr. J.-C.");
    assert.ok(twoBC.sort < oneBC.sort);
    assert.ok(oneBC.sort < oneAD.sort);
  });

  await t.test("aucune valeur brute (0765, -0044) affichée : toujours un affichage français propre", () => {
    assert.equal(parseStoryDate("0765").display, "765");
    assert.equal(parseStoryDate("-0044").display, "44 av. J.-C.");
  });

  await t.test("compatibilité ascendante stricte : le format ISO canonique déjà testé plus haut garde son affichage brut inchangé", () => {
    assert.equal(parseStoryDate("1890").display, "1890");
    assert.equal(parseStoryDate("1890-05").display, "1890-05");
    assert.equal(parseStoryDate("1890-05-12").display, "1890-05-12");
  });

  /* ================ raw accepte directement number/Date (normalizeDateInput) ================ */

  await t.test("raw NOMBRE (YAML sans guillemets, ex. `date: 1879`) est accepté directement", () => {
    const result = parseStoryDate(1879);
    assert.equal(result.y, 1879);
    assert.equal(result.display, "1879");
  });

  await t.test("raw objet Date (YAML timestamp, ex. `date: 1755-11-03`) est accepté directement", () => {
    const result = parseStoryDate(new Date(Date.UTC(1755, 10, 3)));
    assert.equal(result.y, 1755);
    assert.equal(result.mo, 11);
    assert.equal(result.d, 3);
  });

  /* ================ heure ISO préservée, sans influence sur le tri ================ */

  await t.test("« 1755-11-01 09:30 » et « 1755-11-01T09:30 » sont acceptés, l'heure reste informative", () => {
    const withSpace = parseStoryDate("1755-11-01 09:30");
    const withT = parseStoryDate("1755-11-01T09:30");
    const withoutTime = parseStoryDate("1755-11-01");
    assert.equal(withSpace.sort, withoutTime.sort, "l'heure ne doit jamais modifier le sort historique");
    assert.equal(withT.sort, withoutTime.sort);
    assert.equal(withSpace.display, "1er novembre 1755 à 9 h 30");
  });

  /* ================ un seul jeu de règles ISO (délègue à parseIsoDate) ================ */

  await t.test("mois/jour/heure invalides sont rejetés (même règles que parseIsoDate, jamais deux parseurs différents)", () => {
    assert.equal(parseStoryDate("1900-13-01"), null);
    assert.equal(parseStoryDate("1900-02-31"), null);
    assert.equal(parseStoryDate("1755-11-01 24:00"), null);
  });

  await t.test("année zéro toujours rejetée, y compris via l'ancien format ISO", () => {
    assert.equal(parseStoryDate("0"), null);
    assert.equal(parseStoryDate("-0000"), null);
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

  const NB = " ";

  await t.test("préserve un bloc de code (guillemets/apostrophes syntaxiques)", () => {
    const input = 'Il dit "bonjour".\n\n```js\nconst x = "a\'b";\n```\n\nElle dit "salut".';
    const out = frenchTypography(input, false);
    assert.ok(out.includes('const x = "a\'b";'), "le contenu du bloc de code ne doit pas être converti");
    assert.ok(out.includes(`«${NB}bonjour${NB}»`), "le texte avant le bloc doit être converti");
    assert.ok(out.includes(`«${NB}salut${NB}»`), "le texte après le bloc doit être converti");
  });

  await t.test("préserve un span de code inline", () => {
    assert.equal(
      frenchTypography('Utilise `git commit -m "msg"` puis "valide".', false),
      `Utilise \`git commit -m "msg"\` puis «${NB}valide${NB}».`
    );
  });
});

test("stripMarkdown", async (t) => {
  await t.test("retire gras et italique en gardant le texte", () => {
    assert.equal(stripMarkdown("Le *ney* et **Ar-Rahman**"), "Le ney et Ar-Rahman");
    assert.equal(stripMarkdown("***les deux***"), "les deux");
  });

  await t.test("wikilien -> alias, ou dernier segment du chemin", () => {
    assert.equal(stripMarkdown("[[Personnages/Jean|Jean]]"), "Jean");
    assert.equal(stripMarkdown("[[Dossier/Kali]]"), "Kali");
  });

  await t.test("lien Markdown -> texte, appel de note retiré", () => {
    assert.equal(stripMarkdown("Voir [le site](https://x.com) ici[^1]."), "Voir le site ici.");
  });

  await t.test("une définition de note est retirée en entier, pas seulement son marqueur", () => {
    // Avant correction : le retrait du seul "[^1]" laissait fuiter
    // ": Contenu de la note." (avec un « : » orphelin) dans un aperçu.
    const result = stripMarkdown("Texte principal[^1].\n\n[^1]: Contenu de la note.");
    assert.equal(result, "Texte principal.");
    assert.ok(!result.includes(":"));
  });

  await t.test("titres, citations, puces et séparateurs de scène retirés", () => {
    assert.equal(stripMarkdown("## Titre\n> cite\n- item"), "Titre\ncite\nitem");
    assert.equal(stripMarkdown("***\n\nSuite."), "Suite.");
  });

  await t.test("préserve snake_case, retire l'italique par underscore délimité", () => {
    assert.equal(stripMarkdown("mon_fichier reste, mais _ceci_ non"), "mon_fichier reste, mais ceci non");
  });

  await t.test("image embed retirée, code/surlignage/barré nettoyés", () => {
    assert.equal(stripMarkdown("![[img.png]] `code` ==surb== ~~barré~~"), "code surb barré");
  });

  await t.test("chaîne vide ou nulle -> vide", () => {
    assert.equal(stripMarkdown(""), "");
    assert.equal(stripMarkdown(null), "");
  });
});
