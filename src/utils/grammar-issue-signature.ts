// Signature d'un signalement de grammaire pour la liste "fautes ignorées" :
// règle + mot concerné (insensible à la casse) — assez précis pour ne pas
// masquer la même règle sur un mot différent, assez large pour couvrir la
// même tournure répétée ailleurs dans le texte.
type GrammarIssueSignatureInput = {
  ruleId: string;
  underlined?: string;
};

export function grammarIssueSignature(issue: GrammarIssueSignatureInput) {
  return `${issue.ruleId}::${(issue.underlined || "").toLowerCase()}`;
}
