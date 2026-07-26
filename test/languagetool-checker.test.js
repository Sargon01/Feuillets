import test from "node:test";
import assert from "node:assert/strict";
import { checkTextLanguageTool } from "../src/services/languagetool-checker.js";
import { GrammarCheckerManager } from "../src/services/grammar-checker-manager.js";

test("checkTextLanguageTool : parse et formate les erreurs LanguageTool correctement", async () => {
  const mockMatches = [
    {
      message: "Possible spelling mistake found.",
      shortMessage: "Spelling mistake",
      offset: 0,
      length: 4,
      replacements: [{ value: "This" }],
      rule: { id: "MORFOLOGIK_RULE_EN_US", category: { id: "TYPOS" } },
    },
    {
      message: "Use a instead of an.",
      shortMessage: "Wrong article",
      offset: 8,
      length: 2,
      replacements: [{ value: "a" }],
      rule: { id: "EN_A_VS_AN", category: { id: "MISC" } },
    },
  ];

  /* Transport injecté : le code de production passe par requestUrl
     d'Obsidian, indisponible hors de l'application. On imite sa forme de
     réponse (status + json en PROPRIÉTÉ, pas en méthode comme fetch). */
  const request = () => Promise.resolve({ status: 200, json: { matches: mockMatches } });

  {
    const text = "Thsi is an test.";
    const issues = await checkTextLanguageTool(text, {
      url: "https://api.languagetool.org/v2/check",
      language: "en-US",
      request,
    });

    assert.equal(issues.length, 2);
    assert.equal(issues[0].type, "spelling");
    assert.equal(issues[0].underlined, "Thsi");
    assert.equal(issues[0].start, 0);
    assert.equal(issues[0].end, 4);
    assert.equal(issues[0].suggestions[0], "This");

    assert.equal(issues[1].type, "grammar");
    assert.equal(issues[1].underlined, "an");
    assert.equal(issues[1].start, 8);
    assert.equal(issues[1].end, 10);
    assert.equal(issues[1].suggestions[0], "a");
  }
});

test("checkTextLanguageTool : filtre les mots connus (knownWords) et règles ignorées", async () => {
  const mockMatches = [
    {
      message: "Spelling error",
      offset: 0,
      length: 6,
      replacements: [],
      rule: { id: "SPELL", category: { id: "TYPOS" } },
    },
  ];

  const request = () => Promise.resolve({ status: 200, json: { matches: mockMatches } });

  const text = "Sargon is testing.";
  const issuesIgnored = await checkTextLanguageTool(text, {
    knownWords: ["sargon"],
    request,
  });

  assert.equal(issuesIgnored.length, 0);
});

test("GrammarCheckerManager : renvoie un tableau vide si le moteur est désactivé (off)", async () => {
  const manager = new GrammarCheckerManager({}, {}, null);
  const issues = await manager.checkText("Texte avec des fautes.", { grammarEngine: "off" });
  assert.deepEqual(issues, []);
});
