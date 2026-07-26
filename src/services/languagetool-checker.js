import { grammarIssueSignature } from "../utils/grammar-issue-signature.js";

/**
 * Interroge l'API LanguageTool (cloud ou serveur local) et formate
 * les résultats selon la structure d'erreurs unifiée de Feuillets.
 */
export async function checkTextLanguageTool(text, options = {}) {
  const {
    url = "https://api.languagetool.org/v2/check",
    language = "auto",
    knownWords = [],
    ignoredRules = [],
  } = options;

  if (!text || !text.trim()) return [];

  const knownSet = new Set((knownWords || []).map((w) => w.toLowerCase()));
  const ignoredSet = new Set(ignoredRules || []);

  const params = new URLSearchParams();
  params.append("text", text);
  params.append("language", language);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
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
