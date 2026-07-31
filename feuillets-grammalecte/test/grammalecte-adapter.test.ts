/* Conversion des résultats Grammalecte vers le format générique de
   Feuillets. Aucun test ne charge le vrai moteur : ces fonctions sont pures,
   et un faux moteur suffit à vérifier les offsets et les options. */

import assert from "node:assert/strict";
import test from "node:test";
import {
  analyseWithEngine,
  grammarErrorToIssue,
  spellTokenToIssue,
  CATEGORY_GRAMMAR,
  CATEGORY_SPELLING,
  type GrammalecteEngine,
  type GrammalecteError,
  type GrammalecteSpellToken,
} from "../src/grammalecte-adapter.ts";

function grammarError(overrides: Partial<GrammalecteError> = {}): GrammalecteError {
  return {
    nStart: 3,
    nEnd: 15,
    sRuleId: "conf_dorment",
    sMessage: "Le verbe ne s'accorde pas avec son sujet.",
    aSuggestions: ["dort"],
    sUnderlined: "chat dorment",
    ...overrides,
  };
}

test("conversion : une erreur de grammaire devient un signalement générique complet", () => {
  const issue = grammarErrorToIssue(grammarError(), 0, 5);

  assert.equal(issue.message, "Le verbe ne s'accorde pas avec son sujet.");
  assert.equal(issue.start, 3);
  assert.equal(issue.end, 15);
  assert.equal(issue.ruleId, "conf_dorment");
  assert.equal(issue.category, CATEGORY_GRAMMAR);
  assert.equal(issue.severity, "warning");
  assert.deepEqual(issue.suggestions, ["dort"]);
  assert.equal(issue.id, "conf_dorment::chat dorment", "signature stable règle + mot");
});

test("conversion : plusieurs suggestions, tronquées au maximum réglé", () => {
  const error = grammarError({ aSuggestions: ["dort", "dormait", "dormira", "dormirait", "a dormi", "dormant"] });

  assert.deepEqual(grammarErrorToIssue(error, 0, 3).suggestions, ["dort", "dormait", "dormira"]);
  assert.deepEqual(grammarErrorToIssue(error, 0, 10).suggestions, error.aSuggestions);
  assert.equal(grammarErrorToIssue(error, 0, 0).suggestions, undefined, "0 = aucune suggestion");
  assert.equal(
    grammarErrorToIssue(grammarError({ aSuggestions: [] }), 0, 5).suggestions,
    undefined,
    "liste vide plutôt qu'un tableau vide dans le résultat"
  );
});

test("conversion : le décalage de paragraphe est ajouté aux deux bornes", () => {
  const issue = grammarErrorToIssue(grammarError({ nStart: 4, nEnd: 9 }), 100, 5);
  assert.equal(issue.start, 104);
  assert.equal(issue.end, 109);
});

test("conversion : un mot inconnu devient un signalement d'orthographe", () => {
  const token: GrammalecteSpellToken = { nStart: 0, nEnd: 4, sValue: "Ezan" };
  const issue = spellTokenToIssue(token, ["Ezra", "Ezéchiel"], 20, 5);

  assert.match(issue.message, /« Ezan »/);
  assert.equal(issue.category, CATEGORY_SPELLING);
  assert.equal(issue.severity, "error");
  assert.equal(issue.ruleId, "orthographe");
  assert.equal(issue.start, 20);
  assert.equal(issue.end, 24);
  assert.deepEqual(issue.suggestions, ["Ezra", "Ezéchiel"]);
});

/* --------------------------- moteur simulé --------------------------- */

type FakeEngineLog = { options: Array<[string, boolean]>; parsed: string[]; spelled: string[] };

function fakeEngine(
  grammarByParagraph: Record<string, GrammalecteError[]> = {},
  spellByParagraph: Record<string, GrammalecteSpellToken[]> = {}
): { engine: GrammalecteEngine; log: FakeEngineLog } {
  const log: FakeEngineLog = { options: [], parsed: [], spelled: [] };
  const engine: GrammalecteEngine = {
    paragraphs: (text) => text.split("\n"),
    setOption: (name, value) => log.options.push([name, value]),
    parse: (paragraph) => {
      log.parsed.push(paragraph);
      return grammarByParagraph[paragraph] ?? [];
    },
    spell: (paragraph) => {
      log.spelled.push(paragraph);
      return spellByParagraph[paragraph] ?? [];
    },
    suggest: (word) => [`${word}-corrigé`],
  };
  return { engine, log };
}

const OPTIONS = { checkSpelling: true, detectRepetitions: false, maxSuggestions: 5 };

test("analyse : offsets corrects sur un document de plusieurs paragraphes", () => {
  const text = "Premier paragraphe.\nLe chat dorment.";
  const second = "Le chat dorment.";
  const { engine } = fakeEngine({ [second]: [grammarError({ nStart: 3, nEnd: 16 })] });

  const issues = analyseWithEngine(engine, text, OPTIONS);

  assert.equal(issues.length, 1);
  // L'offset est relatif au texte COMPLET, séparateur "\n" compris.
  assert.equal(text.slice(issues[0].start, issues[0].end), "chat dorment.");
});

test("analyse : les signalements sont triés par position croissante", () => {
  const text = "Un deux trois";
  const { engine } = fakeEngine({
    [text]: [
      grammarError({ nStart: 8, nEnd: 13, sUnderlined: "trois" }),
      grammarError({ nStart: 0, nEnd: 2, sUnderlined: "Un" }),
      grammarError({ nStart: 3, nEnd: 7, sUnderlined: "deux" }),
    ],
  });

  const issues = analyseWithEngine(engine, text, OPTIONS);
  assert.deepEqual(issues.map((i) => i.start), [0, 3, 8]);
});

test("analyse : grammaire et orthographe sont fusionnées dans un même flux", () => {
  const text = "Ezan dorment.";
  const { engine } = fakeEngine(
    { [text]: [grammarError({ nStart: 5, nEnd: 13, sUnderlined: "dorment." })] },
    { [text]: [{ nStart: 0, nEnd: 4, sValue: "Ezan" }] }
  );

  const issues = analyseWithEngine(engine, text, OPTIONS);
  assert.deepEqual(issues.map((i) => i.category), [CATEGORY_SPELLING, CATEGORY_GRAMMAR]);
  assert.deepEqual(issues[0].suggestions, ["Ezan-corrigé"]);
});

test("analyse : orthographe désactivée — le correcteur n'est même pas interrogé", () => {
  const text = "Ezan dorment.";
  const { engine, log } = fakeEngine({}, { [text]: [{ nStart: 0, nEnd: 4, sValue: "Ezan" }] });

  const issues = analyseWithEngine(engine, text, { ...OPTIONS, checkSpelling: false });
  assert.deepEqual(issues, []);
  assert.deepEqual(log.spelled, []);
});

test("analyse : l'option « répétitions » pilote redon1/redon2", () => {
  const { engine, log } = fakeEngine();
  analyseWithEngine(engine, "Texte.", { ...OPTIONS, detectRepetitions: true });
  assert.deepEqual(log.options, [["redon1", true], ["redon2", true]]);

  const second = fakeEngine();
  analyseWithEngine(second.engine, "Texte.", OPTIONS);
  assert.deepEqual(second.log.options, [["redon1", false], ["redon2", false]]);
});

test("analyse : les paragraphes vides ne sont pas soumis au moteur", () => {
  const { engine, log } = fakeEngine();
  analyseWithEngine(engine, "Un.\n\n   \nDeux.", OPTIONS);
  assert.deepEqual(log.parsed, ["Un.", "Deux."]);
});

test("analyse : le texte analysé n'est jamais modifié", () => {
  const text = "Le chat dorment.\n\nEt il pleut.";
  const copy = String(text);
  const { engine } = fakeEngine({ "Le chat dorment.": [grammarError()] });

  analyseWithEngine(engine, text, OPTIONS);
  assert.equal(text, copy, "aucune normalisation, aucune réécriture en place");
});

test("analyse : offsets exacts même avec des caractères accentués et hors BMP", () => {
  // Une normalisation NFC ou un retrait de traits d'union conditionnels
  // décalerait les offsets : l'adaptateur n'en fait aucun, ce test le fige.
  const text = "Élodie 😀 mangea des œufs.";
  const target = "œufs";
  const start = text.indexOf(target);
  const { engine } = fakeEngine({ [text]: [grammarError({ nStart: start, nEnd: start + target.length })] });

  const issues = analyseWithEngine(engine, text, OPTIONS);
  assert.equal(text.slice(issues[0].start, issues[0].end), target);
});
