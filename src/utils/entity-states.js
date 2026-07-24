// @ts-check
/** Fiches d'entité datées : une fiche personnage/lieu/événement peut décrire
 * ses états successifs sous forme de lignes « année : état », et le panneau
 * Notes affiche l'état pertinent au moment de la scène ouverte plutôt que le
 * synopsis générique (voir renderEntityRow, views/notes-view.js).
 *
 * Pur (aucune dépendance à Obsidian) : testable directement sous Node. */

/* Une ligne d'état. Tolérant à la mise en forme réelle des fiches :
   - puce Markdown optionnelle (« - », « * », « + ») ;
   - gras optionnel autour de l'année (« **1815** : … ») ;
   - année négative pour les dates avant notre ère (« -300 : … ») ;
   - séparateur « : », « ： » (deux-points pleine chasse), « – », « — » ou « - ».
   3 à 4 chiffres : en dessous, trop de faux positifs (un « 12 : » d'une liste
   numérotée), au-dessus ce n'est plus une année.

   `[-*+]\s+` et non `[-*+]\s*` : l'espace après la puce est obligatoire, sinon
   le tiret d'une année négative en début de ligne (« -753 : … ») est consommé
   comme une puce et l'année est lue positive — donc jamais retenue, puisque
   753 est postérieur à toute année négative demandée. Markdown exige de toute
   façon cette espace, donc rien de légitime n'est perdu. */
const STATE_LINE = /^\s*(?:[-*+]\s+)?\**\s*(-?\d{3,4})\s*\**\s*[:：–—-]\s*(.+)$/;

/**
 * Dernier état renseigné à une année donnée (incluse).
 *
 * @param {string} content corps de la fiche d'entité.
 * @param {number} year année de la scène.
 * @returns {{ y: number, text: string }|null} `null` si la fiche ne contient
 *   aucune ligne d'état, ou aucune qui soit antérieure ou égale à `year`.
 */
export function latestStateBefore(content, year) {
  /** @type {{ y: number, text: string }|null} */
  let best = null;
  for (const line of content.split("\n")) {
    const m = line.match(STATE_LINE);
    if (!m) continue;
    const y = parseInt(m[1], 10);
    if (y > year) continue;
    /* `>` et non `>=` : à année égale, la PREMIÈRE ligne rencontrée gagne,
       pour que l'ordre de lecture de la fiche reste ce qui départage. */
    if (!best || y > best.y) best = { y, text: m[2].trim() };
  }
  return best;
}
