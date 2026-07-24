import test from "node:test";
import assert from "node:assert/strict";
import {
  splitCsv,
  normalizeTags,
  shortText,
  splitFrontmatter,
  splitBody,
  ensureNumber,
  stripMdExtension,
  sanitizeFileBasename,
  moveItem,
  toValue,
  buildMergedSection,
} from "../src/utils/scene-fields.js";

/* --- nom de fichier ------------------------------------------------------ */

test("sanitizeFileBasename : aucun caractère interdit ne survit", () => {
  const interdits = '\\/:*?"<>|#^[]';
  for (const c of interdits) {
    const out = sanitizeFileBasename(`Titre${c}suite`);
    assert.ok(!out.includes(c), `« ${c} » a survécu dans « ${out} »`);
  }
});

test("sanitizeFileBasename : « Chapitre 3 : la fuite » donne un nom valide", () => {
  // régression : le « : » n'était pas filtré, produisant un fichier invalide
  // sous Windows — or la typographie française l'emploie couramment.
  const out = sanitizeFileBasename("Chapitre 3 : la fuite");
  assert.ok(!out.includes(":"), out);
  assert.ok(out.startsWith("Chapitre 3"), out);
});

test("sanitizeFileBasename : ne renvoie jamais de chaîne vide", () => {
  assert.equal(sanitizeFileBasename(""), "Nouvelle scène");
  assert.equal(sanitizeFileBasename("   "), "Nouvelle scène");
  assert.equal(sanitizeFileBasename(null), "Nouvelle scène");
  assert.equal(sanitizeFileBasename("///"), "Nouvelle scène", "titre entièrement interdit");
  assert.equal(sanitizeFileBasename("", "Repli"), "Repli");
});

test("sanitizeFileBasename : retire l'extension .md, quelle que soit sa casse", () => {
  assert.equal(sanitizeFileBasename("Scene 1.md"), "Scene 1");
  assert.equal(sanitizeFileBasename("Scene 1.MD"), "Scene 1");
  // « .markdown » n'est pas l'extension du plugin : on n'y touche pas
  assert.equal(sanitizeFileBasename("notes.markdown"), "notes.markdown");
});

test("sanitizeFileBasename : un point final est retiré", () => {
  // Windows ignore le point final : « Fin. » deviendrait « Fin » sur disque,
  // et le plugin ne retrouverait plus le fichier qu'il croit avoir créé.
  assert.equal(sanitizeFileBasename("Fin."), "Fin");
  assert.equal(sanitizeFileBasename("Suite..."), "Suite");
});

test("sanitizeFileBasename : les accents sont conservés", () => {
  assert.equal(sanitizeFileBasename("Été à Paris"), "Été à Paris");
});

/* --- tags et champs ------------------------------------------------------ */

test("normalizeTags : liste YAML, dédoublonnée dans l'ordre d'apparition", () => {
  assert.deepEqual(normalizeTags(["b", "a", "b", " a "]), ["b", "a"]);
});

test("normalizeTags : chaîne « a, b » découpée et dédoublonnée", () => {
  assert.deepEqual(normalizeTags("nuit, ville , nuit"), ["nuit", "ville"]);
});

test("normalizeTags : valeurs vides ou d'un autre type donnent []", () => {
  for (const v of [null, undefined, "", 0, false, 42, {}]) {
    assert.deepEqual(normalizeTags(v), [], `pour ${JSON.stringify(v)}`);
  }
});

test("splitCsv : ignore les entrées vides et les espaces", () => {
  assert.deepEqual(splitCsv(" a , ,b,, c "), ["a", "b", "c"]);
  assert.deepEqual(splitCsv(""), []);
  assert.deepEqual(splitCsv(null), []);
});

test("toValue : une liste devient « a, b », le reste une chaîne", () => {
  assert.equal(toValue(["a", "b"]), "a, b");
  assert.equal(toValue("déjà"), "déjà");
  assert.equal(toValue(null), "");
  assert.equal(toValue(undefined), "");
  assert.equal(toValue(0), "0");
});

test("ensureNumber : repli sur les valeurs non numériques", () => {
  assert.equal(ensureNumber("12"), 12);
  assert.equal(ensureNumber(3.5), 3.5);
  assert.equal(ensureNumber("abc"), 0);
  assert.equal(ensureNumber(null, 7), 0, "null vaut 0 pour Number()");
  assert.equal(ensureNumber(undefined, 7), 7);
  assert.equal(ensureNumber(Infinity, 7), 7);
  assert.equal(ensureNumber(NaN, 7), 7);
});

test("stripMdExtension : retire l'extension et rogne", () => {
  // régression : le trim doit précéder le retrait de l'extension, sinon
  // « Scene 1.md » suivi d'une espace donnait le fichier « Scene 1.md.md »
  assert.equal(stripMdExtension("  Scene 1.md  "), "Scene 1");
  assert.equal(sanitizeFileBasename("Scene 1.md "), "Scene 1");
  assert.equal(stripMdExtension("Scene 1"), "Scene 1");
  assert.equal(stripMdExtension(null), "");
});

test("shortText : aplatit, tronque, et signale le vide", () => {
  assert.equal(shortText("un\n\n  texte   aéré"), "un texte aéré");
  assert.equal(shortText(""), "—");
  assert.equal(shortText(null), "—");
  assert.equal(shortText("abcdef", 3), "abc…");
  assert.equal(shortText("abc", 3), "abc", "pile à la limite : pas de troncature");
});

/* --- corps et frontmatter ------------------------------------------------ */

test("splitFrontmatter : sépare frontmatter et corps", () => {
  const { frontmatter, body } = splitFrontmatter("---\ntitre: A\n---\nLe corps.\n");
  assert.equal(frontmatter, "titre: A");
  assert.equal(body, "Le corps.\n");
});

test("splitFrontmatter : null quand il n'y a pas de frontmatter", () => {
  const { frontmatter, body } = splitFrontmatter("Juste du texte.");
  assert.equal(frontmatter, null, "null ≠ frontmatter vide");
  assert.equal(body, "Juste du texte.");
});

test("splitFrontmatter : un frontmatter vide donne une chaîne, pas null", () => {
  assert.equal(splitFrontmatter("---\n\n---\nx").frontmatter, "");
});

test("splitFrontmatter : un « --- » en cours de texte n'est pas confondu", () => {
  const md = "Du texte.\n\n---\n\nUne séparation.";
  const { frontmatter, body } = splitFrontmatter(md);
  assert.equal(frontmatter, null);
  assert.equal(body, md);
});

test("splitBody : corps seul, sans blancs de bord", () => {
  assert.equal(splitBody("---\ntitre: A\n---\n\n  Le corps.  \n\n"), "Le corps.");
});

/* --- fusion --------------------------------------------------------------- */

const source = { basename: "Scene 2" };

test("buildMergedSection : titre intermédiaire par défaut", () => {
  assert.equal(
    buildMergedSection(source, "Le texte.", "heading"),
    "## Fusion depuis Scene 2\n\nLe texte."
  );
  assert.equal(
    buildMergedSection(source, "Le texte.", "mode inconnu"),
    "## Fusion depuis Scene 2\n\nLe texte.",
    "un mode inconnu retombe sur le titre"
  );
});

test("buildMergedSection : mode commentaire", () => {
  assert.equal(
    buildMergedSection(source, "Le texte.", "comment"),
    "> Fusion depuis Scene 2\n\nLe texte."
  );
});

test("buildMergedSection : mode continu, texte nu", () => {
  assert.equal(buildMergedSection(source, "  Le texte.  ", "continuous"), "Le texte.");
});

test("buildMergedSection : un corps vide ne produit ni titre ni citation orpheline", () => {
  for (const mode of ["heading", "comment", "continuous"]) {
    assert.equal(buildMergedSection(source, "   ", mode), "", mode);
    assert.equal(buildMergedSection(source, null, mode), "", mode);
  }
});

/* --- réordonnancement ----------------------------------------------------- */

test("moveItem : déplace sans modifier le tableau d'origine", () => {
  const src = ["a", "b", "c"];
  assert.deepEqual(moveItem(src, 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveItem(src, 2, 0), ["c", "a", "b"]);
  assert.deepEqual(src, ["a", "b", "c"], "l'original doit rester intact");
});

test("moveItem : déplacer sur place ne change rien", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
});
