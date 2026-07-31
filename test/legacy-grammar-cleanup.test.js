import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  stripLegacyGrammarSettings,
  removeLegacyEngines,
  LEGACY_GRAMMAR_SETTING_KEYS,
} from "../src/services/legacy-grammar-cleanup.js";

test("réglages hérités : les clés de correction sont retirées", () => {
  const settings = {
    grammarEngine: "grammalecte",
    languageToolUrl: "https://api.languagetool.org/v2/check",
    languageToolLanguage: "fr",
    grammalecteDetectRepetitions: true,
    grammalecteKnownWords: ["ezan"],
    grammalecteIgnoredRules: ["redon1"],
    projectFolder: "Roman",
    wordGoal: 500,
  };
  assert.equal(stripLegacyGrammarSettings(settings), true);
  for (const key of LEGACY_GRAMMAR_SETTING_KEYS) {
    assert.equal(key in settings, false, `${key} aurait dû être retiré`);
  }
  // Tout le reste est intact : on ne réinitialise pas la configuration.
  assert.deepEqual(settings, { projectFolder: "Roman", wordGoal: 500 });
});

test("réglages hérités : configuration propre laissée telle quelle", () => {
  const settings = { projectFolder: "Roman" };
  assert.equal(stripLegacyGrammarSettings(settings), false);
  assert.deepEqual(settings, { projectFolder: "Roman" });
});

test("réglages hérités : une clé inconnue de Feuillets est conservée", () => {
  const settings = { grammarEngine: "off", futureOption: 42 };
  assert.equal(stripLegacyGrammarSettings(settings), true);
  assert.deepEqual(settings, { futureOption: 42 });
});

test("moteurs hérités : suppression des dossiers téléchargés, idempotente", () => {
  const present = new Set(["/res/grammalecte", "/res/harper", "/res/.harper-version.json"]);
  const fs = {
    existsSync: (p) => present.has(p),
    rmSync: (p) => { present.delete(p); },
  };
  const join = (...parts) => parts.join("/");

  assert.deepEqual(
    removeLegacyEngines(fs, join, "/res").sort(),
    [".harper-version.json", "grammalecte", "harper"]
  );
  // Deuxième passage : plus rien à faire, aucune erreur.
  assert.deepEqual(removeLegacyEngines(fs, join, "/res"), []);
});

test("moteurs hérités : une erreur de suppression n'interrompt pas le démarrage", () => {
  const fs = {
    existsSync: () => true,
    rmSync: (p) => { if (p.endsWith("harper")) throw new Error("EPERM"); },
  };
  const removed = removeLegacyEngines(fs, (...p) => p.join("/"), "/res");
  // grammalecte passe, harper échoue silencieusement : pas d'exception.
  assert.ok(removed.includes("grammalecte"));
  assert.ok(!removed.includes("harper"));
});

/* Garde-fou : la correction grammaticale et l'analyse morphologique ont été
   retirées, aucun vestige ne doit subsister dans les sources. Feuillets ne
   télécharge plus rien, n'exécute plus de code tiers et ne dépend d'aucune
   langue en particulier. Les mentions historiques du changelog et de la
   documentation de migration sont légitimes et hors périmètre. */
test("aucun vestige de correcteur dans src/", () => {
  const FORBIDDEN = [
    "harper_wasm_slim_bg.wasm",
    "WebAssembly.instantiate",
    "HarperChecker",
    "GrammalecteChecker",
    "GrammarCheckerManager",
    "downloadEngine",
    "api.languagetool.org",
    "MorphologyEngine",
    "graphspell",
    "runInContext",
  ];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|js)$/.test(entry)) continue;
      if (full.includes(`${path.sep}generated${path.sep}`)) continue;
      const text = readFileSync(full, "utf8");
      for (const needle of FORBIDDEN) {
        if (text.includes(needle)) offenders.push(`${full} → ${needle}`);
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});
