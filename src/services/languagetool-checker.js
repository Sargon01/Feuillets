/* eslint-disable @typescript-eslint/no-require-imports -- require paresseux volontaire : le paquet obsidian est types-only, un import statique rendrait ce module intestable */
import { grammarIssueSignature } from "../utils/grammar-issue-signature.js";

/* requestUrl (API Obsidian) plutôt que fetch() global : fetch() se heurte à
   la politique CORS du renderer, requestUrl la contourne — même raison qu'en
   tête de grammar-assets-manager.js. C'est ce qui permet de joindre un
   serveur LanguageTool local (http://localhost:8081) qui ne renvoie pas
   d'en-tête Access-Control-Allow-Origin pour l'origine du vault.

   `require` paresseux, DANS la fonction : le paquet "obsidian" est
   types-only, il n'a aucun fichier JS. Un import statique rendrait ce module
   impossible à charger hors d'Obsidian, donc intestable. */
function obsidianRequestUrl(params) {
  const { requestUrl } = require("obsidian");
  return requestUrl(params);
}

/**
 * Interroge l'API LanguageTool (cloud ou serveur local) et formate
 * les résultats selon la structure d'erreurs unifiée de Feuillets.
 *
 * `request` : transport HTTP, injectable pour les tests unitaires. En
 * production on prend toujours celui d'Obsidian (voir ci-dessus).
 */
export async function checkTextLanguageTool(text, options = {}) {
  const {
    url = "https://api.languagetool.org/v2/check",
    language = "auto",
    knownWords = [],
    ignoredRules = [],
    request = obsidianRequestUrl,
  } = options;

  if (!text || !text.trim()) return [];

  const knownSet = new Set((knownWords || []).map((w) => w.toLowerCase()));
  const ignoredSet = new Set(ignoredRules || []);

  const params = new URLSearchParams();
  params.append("text", text);
  params.append("language", language);

  /* `throw: false` : on garde notre propre message d'erreur sur les statuts
     non-2xx plutôt que l'exception générique de requestUrl. */
  const response = await request({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: params.toString(),
    throw: false,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = response.json;
  const matches = data.matches || [];

  const issues = [];
  for (const match of matches) {
    const offset = match.offset;
    const length = match.length;
    const underlined = text.slice(offset, offset + length);
    const ruleId = match.rule ? match.rule.id : "LT_RULE";
    const categoryId = match.rule && match.rule.category ? match.rule.category.id : "";
    const isSpelling = categoryId === "TYPOS" || ruleId.toLowerCase().includes("spell") || ruleId.toLowerCase().includes("typo");

    // Filtrer les mots ignorés / appris
    if (isSpelling && knownSet.has(underlined.toLowerCase())) {
      continue;
    }

    const issue = {
      type: isSpelling ? "spelling" : "grammar",
      ruleId,
      message: match.message || match.shortMessage || "Erreur détectée par LanguageTool",
      start: offset,
      end: offset + length,
      offset,
      length,
      underlined,
      suggestions: (match.replacements || []).map((r) => r.value),
    };

    const sig = grammarIssueSignature(issue);
    if (ignoredSet.has(sig)) {
      continue;
    }

    issues.push(issue);
  }

  return issues;
}

/* eslint-enable @typescript-eslint/no-require-imports -- fin du bloc require paresseux */
