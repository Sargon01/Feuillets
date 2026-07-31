import assert from "node:assert/strict";
import { test } from "node:test";
import { GrammalecteProvider } from "../src/grammalecte-provider.ts";
import { DEFAULT_SETTINGS, type GrammalecteSettings } from "../src/settings.ts";

test("user-data : apprentissage d'un mot et persistance via saveSettings()", async () => {
  const settings: GrammalecteSettings = { ...DEFAULT_SETTINGS, learnedWords: [] };
  let saved = false;
  const saveSettings = async () => {
    saved = true;
  };

  const provider = new GrammalecteProvider(() => settings, saveSettings);

  await provider.learnWord("ezan");
  assert.equal(saved, true);
  assert.deepEqual(settings.learnedWords, ["ezan"]);

  // Ré-apprendre le même mot (insensible à la casse) ne crée pas de doublon
  saved = false;
  await provider.learnWord("EZAN");
  assert.equal(saved, false);
  assert.deepEqual(settings.learnedWords, ["ezan"]);
});

test("user-data : filtrage des erreurs d'orthographe pour un mot appris, conservation de la grammaire", async () => {
  const settings: GrammalecteSettings = { ...DEFAULT_SETTINGS, learnedWords: ["ezan"] };

  const fakeEngine = {
    paragraphs: function* (text: string) {
      yield text;
    },
    setOption: () => {},
    parse: function* () {
      yield {
        nStart: 0,
        nEnd: 4,
        sRuleId: "accord_v",
        sMessage: "Accord incorrect",
        aSuggestions: [],
        sUnderlined: "ezan",
      };
    },
    spell: function* () {
      yield {
        nStart: 0,
        nEnd: 4,
        sValue: "ezan",
      };
      yield {
        nStart: 10,
        nEnd: 15,
        sValue: "inconnu",
      };
    },
    suggest: () => [],
  };

  const provider = new GrammalecteProvider(() => settings, undefined, () => fakeEngine as any);

  const issues = await provider.analyze({ text: "ezan teste inconnu" });

  // Doit contenir la faute de grammaire sur "ezan" ET la faute d'orthographe sur "inconnu",
  // mais la faute d'orthographe sur "ezan" doit être filtrée.
  const spellingIssues = issues.filter((i) => i.category === "Orthographe");
  const grammarIssues = issues.filter((i) => i.category === "Grammaire");

  assert.equal(spellingIssues.length, 1);
  assert.equal(spellingIssues[0].text, "inconnu");

  assert.equal(grammarIssues.length, 1);
  assert.equal(grammarIssues[0].ruleId, "accord_v");
});

test("user-data : ignorance d'une occurrence en mémoire (session seule, pas dans data.json)", async () => {
  const settings: GrammalecteSettings = { ...DEFAULT_SETTINGS };

  const fakeEngine = {
    paragraphs: function* (text: string) {
      yield text;
    },
    setOption: () => {},
    parse: function* () {
      yield {
        nStart: 0,
        nEnd: 5,
        sRuleId: "accord_pluriel",
        sMessage: "Pluriel attendu",
        aSuggestions: [],
        sUnderlined: "pomme",
      };
    },
    spell: function* () {
      yield { nStart: 10, nEnd: 15, sValue: "fotee" };
    },
    suggest: () => [],
  };

  const provider = new GrammalecteProvider(() => settings, undefined, () => fakeEngine as any);

  const initialIssues = await provider.analyze({ text: "pomme fotee" });
  assert.equal(initialIssues.length, 2);

  // Ignorer l'occurrence de grammaire
  const targetIssue = initialIssues.find((i) => i.category === "Grammaire")!;
  await provider.ignoreOccurrence(targetIssue);

  const filteredIssues = await provider.analyze({ text: "pomme fotee" });
  assert.equal(filteredIssues.length, 1);
  assert.equal(filteredIssues[0].category, "Orthographe");

  // Vérifier que ignoredSignatures n'est pas dans settings (data.json)
  assert.equal("ignoredSignatures" in settings, false);
});

test("analyse linguistique : richesse lexicale, lemmes, adverbes -ment, voix passive", async () => {
  const settings: GrammalecteSettings = { ...DEFAULT_SETTINGS };

  const fakeEngine = {
    paragraphs: function* (text: string) {
      yield text;
    },
    setOption: () => {},
    parse: function* () {},
    spell: function* () {},
    suggest: () => [],
    getMorph: (word: string) => {
      const w = word.toLowerCase();
      if (w === "grandement") return [">grandement :W"];
      if (w === "marcher") return [">marcher :V1"];
      if (w === "marchait") return [">marcher :V1"];
      if (w === "était") return [">être :V"];
      if (w === "frappé") return [">frapper :V:Q"];
      if (w === "beau") return [">beau :A"];
      return [];
    },
  };

  const provider = new GrammalecteProvider(() => settings, undefined, () => fakeEngine as any);

  const res = await provider.analyzeLinguistics({ text: "Il était frappé grandement en marchant. C'était beau." });
  assert.ok(res);
  assert.equal(res.passiveCount, 1);
  assert.equal(res.mentTotal, 1);
  assert.ok(res.favoriteAdvs?.some(([w]) => w === "grandement"));
});
