/* Archive embarquée : encodage au build, reconstitution au premier usage, et
   isolation du moteur dans son contexte vm.

   Les tests de bout en bout (moteur réel, 9,3 Mo) ne s'exécutent que si les
   sources ont été restaurées par `npm run resources` — inutile d'imposer ce
   téléchargement pour lancer la suite. */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { brotliCompressSync } from "node:zlib";
import { decodeArchive, GrammalecteArchiveError } from "../src/grammalecte-assets.ts";
import { buildArchiveBase64 } from "../scripts/build-grammalecte-archive.mjs";
import { loadGrammalecteEngine, analyseWithEngine, GrammalecteEngineError } from "../src/grammalecte-adapter.ts";

const RESOURCES_DIR = path.resolve(import.meta.dirname, "..", "resources", "grammalecte");
const HAS_RESOURCES = existsSync(path.join(RESOURCES_DIR, "graphspell", "_dictionaries", "fr-classic.json"));

/** Fabrique une archive minuscule au même format que celle du build. */
function makeArchive(files: Array<[string, string]>): string {
  const buffers = files.map(([, content]) => Buffer.from(content, "utf8"));
  const index = Buffer.from(JSON.stringify(files.map(([name], i) => [name, buffers[i].length])), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(index.length, 0);
  return brotliCompressSync(Buffer.concat([header, index, ...buffers])).toString("base64");
}

/* ---------------------------- archive ------------------------------- */

test("archive : aller-retour d'un fichier texte, contenu et clés préservés", () => {
  const assets = decodeArchive(makeArchive([["fr/conj.js", "var conj = {};"], ["text.js", "var text = {};"]]));

  assert.deepEqual([...assets.keys()], ["fr/conj.js", "text.js"]);
  assert.equal(assets.get("fr/conj.js"), "var conj = {};");
  assert.equal(assets.get("text.js"), "var text = {};");
});

test("archive : l'utf-8 traverse la compression intact", () => {
  const content = "« Élodie mangea des œufs 😀 »";
  const assets = decodeArchive(makeArchive([["fr/x.js", content]]));
  assert.equal(assets.get("fr/x.js"), content);
});

test("archive : un build sans moteur embarqué le dit explicitement", () => {
  // C'est le cas hors build : src/grammalecte-archive.ts est un placeholder
  // vide, esbuild ne le remplit qu'au moment du bundling.
  assert.throws(() => decodeArchive(""), (error: unknown) => {
    assert.ok(error instanceof GrammalecteArchiveError);
    assert.match((error as Error).message, /n'a pas été embarqué/);
    return true;
  });
});

test("archive : données illisibles — erreur explicite, jamais un plantage nu", () => {
  assert.throws(() => decodeArchive("cGFzIGRlIGJyb3RsaQ=="), GrammalecteArchiveError);
  assert.throws(() => decodeArchive(brotliCompressSync(Buffer.from("ab")).toString("base64")), /tronquée/);

  // Index cohérent mais charge utile amputée.
  const index = Buffer.from(JSON.stringify([["fr/x.js", 999]]), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(index.length, 0);
  const truncated = brotliCompressSync(Buffer.concat([header, index, Buffer.from("court")])).toString("base64");
  assert.throws(() => decodeArchive(truncated), /tronquée au fichier « fr\/x\.js »/);
});

test("moteur : une ressource absente de l'archive est nommée dans l'erreur", () => {
  const assets = decodeArchive(makeArchive([["text.js", "var text = {};"]]));
  assert.throws(() => loadGrammalecteEngine(assets), (error: unknown) => {
    assert.ok(error instanceof GrammalecteEngineError);
    assert.match((error as Error).message, /graphspell\/helpers\.js/);
    return true;
  });
});

/* --------------------- moteur réel (si disponible) ------------------- */

test("build : l'archive réelle contient les 21 fichiers du moteur", { skip: !HAS_RESOURCES }, () => {
  const { base64, files } = buildArchiveBase64(RESOURCES_DIR);
  assert.equal(files, 21, "17 scripts + 3 fichiers de données + le dictionnaire");

  const assets = decodeArchive(base64);
  for (const required of [
    "graphspell/helpers.js",
    "graphspell/_dictionaries/fr-classic.json",
    "fr/gc_engine.js",
    "fr/conj_data.json",
    "text.js",
  ]) {
    assert.ok(assets.get(required), `${required} doit être dans l'archive`);
  }
  assert.equal(assets.has("README.txt"), false, "la documentation n'est pas embarquée");
});

test("moteur : analyse réelle depuis l'archive embarquée", { skip: !HAS_RESOURCES }, () => {
  const engine = loadGrammalecteEngine(decodeArchive(buildArchiveBase64(RESOURCES_DIR).base64));
  const text = "Le chat dorment sur le tapis.";

  const issues = analyseWithEngine(engine, text, {
    checkSpelling: true,
    detectRepetitions: false,
    maxSuggestions: 3,
  });

  const accord = issues.find((issue) => text.slice(issue.start, issue.end) === "dorment");
  assert.ok(accord, "l'accord sujet-verbe est détecté");
  assert.equal(accord.category, "Grammaire");
  assert.ok(accord.suggestions?.includes("dort"));
});

test("moteur : le contexte vm ne pollue ni String.prototype ni RegExp.prototype", { skip: !HAS_RESOURCES }, () => {
  // Grammalecte ajoute gl_count/gl_startsWith/gl_expand… à ces prototypes.
  // Ils doivent rester dans le realm du contexte vm, jamais dans le nôtre.
  const polluted = () =>
    Object.getOwnPropertyNames(String.prototype)
      .concat(Object.getOwnPropertyNames(RegExp.prototype))
      .filter((name) => name.startsWith("gl_") || name === "grammalecte");

  assert.deepEqual(polluted(), [], "prototypes propres avant chargement");
  loadGrammalecteEngine(decodeArchive(buildArchiveBase64(RESOURCES_DIR).base64));
  assert.deepEqual(polluted(), [], "prototypes toujours propres après chargement du moteur");
});

test("moteur : le faux XHR ne peut rien lire hors de l'archive", { skip: !HAS_RESOURCES }, () => {
  /* Le moteur construit lui-même l'URL du dictionnaire ; on vérifie qu'une
     ressource inconnue est refusée par nom plutôt que cherchée sur disque. */
  const assets = new Map(decodeArchive(buildArchiveBase64(RESOURCES_DIR).base64));
  assets.delete("graphspell/_dictionaries/fr-classic.json");

  assert.throws(() => loadGrammalecteEngine(assets), /fr-classic\.json|dictionnaire/);
});
