/**
 * Moteur PUR du déplacement d'une sélection textuelle (LOT 1.3 — voir le
 * contrat « Déplacement d'une sélection / phrase »).
 *
 * Même philosophie que `paragraph-reorder-core.ts` : une SEULE fenêtre
 * contiguë `[from, to)` du texte, reconstruite EXACTEMENT à partir de la
 * source et du texte intermédiaire réels — jamais un couple delete+insert,
 * jamais deux `ChangeSpec`. Aucune dépendance DOM, CodeMirror, Obsidian,
 * Vault ou settings : ce module reçoit du texte brut et des offsets, et
 * produit — ou non — un plan. Il ne dispatch jamais rien lui-même.
 *
 * La sélection exacte de l'utilisateur est la vérité : aucun trim, aucun
 * ajout/retrait d'espace, aucune normalisation de ponctuation ou de fin de
 * ligne, aucune analyse linguistique.
 */

/** Plan de déplacement STRICT : une plage contiguë `[from, to)` du texte à
 * remplacer par `insert`, plus la sélection finale `[selectionFrom,
 * selectionTo)` où doit se retrouver le fragment déplacé — dans la MÊME
 * transaction que `changes`. Jamais un tableau de changements. */
export interface TextFragmentMovePlan {
  from: number;
  to: number;
  insert: string;
  selectionFrom: number;
  selectionTo: number;
}

/**
 * Calcule le plan de déplacement du fragment `[sourceFrom, sourceTo)` vers
 * la position `target` (un offset texte exact, jamais une seam). Retourne
 * `null` si :
 *
 * - `sourceFrom >= sourceTo` (sélection vide ou invalide) ;
 * - `target < 0` ou `target > text.length` ;
 * - `target` tombe dans `[sourceFrom, sourceTo]` (no-op, y compris sur ses
 *   propres bornes).
 *
 * Sinon, une seule fenêtre contiguë est reconstruite :
 *
 * - `target < sourceFrom` : la fenêtre `[target, sourceTo)` devient
 *   `sourceText + middleText` (le fragment déplacé AVANT le texte qui le
 *   séparait de sa destination) ;
 * - `target > sourceTo` : la fenêtre `[sourceFrom, target)` devient
 *   `middleText + sourceText` (le fragment déplacé APRÈS ce texte).
 *
 * Aucune transformation du texte prélevé : `sourceText` vaut exactement
 * `text.slice(sourceFrom, sourceTo)`.
 */
export function planTextFragmentMove(text: string, sourceFrom: number, sourceTo: number, target: number): TextFragmentMovePlan | null {
  if (sourceFrom >= sourceTo) return null;
  if (target < 0 || target > text.length) return null;
  if (target >= sourceFrom && target <= sourceTo) return null;

  const sourceText = text.slice(sourceFrom, sourceTo);
  const length = sourceText.length;

  if (target < sourceFrom) {
    const middleText = text.slice(target, sourceFrom);
    return {
      from: target,
      to: sourceTo,
      insert: sourceText + middleText,
      selectionFrom: target,
      selectionTo: target + length,
    };
  }

  // target > sourceTo (les deux autres cas sont exclus par la garde no-op)
  const middleText = text.slice(sourceTo, target);
  return {
    from: sourceFrom,
    to: target,
    insert: middleText + sourceText,
    selectionFrom: target - length,
    selectionTo: target,
  };
}
