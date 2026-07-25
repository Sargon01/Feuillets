/** Construit le texte d'une citation à partir des champs d'une fiche
 * Source (auteur, titre, date, editeur, url — voir services/research-
 * templates.js) et d'une page ponctuelle propre à CETTE citation (jamais
 * stockée sur la fiche : la même source est citée à des pages
 * différentes selon l'endroit). Deux formats, réglés par projet
 * (S.projectMeta[path].citationStyle, voir main.js) :
 * - "footnote" (par défaut) : note de bas de page, style notes-
 *   bibliographie (histoire, sciences humaines françaises) — insérée via
 *   la commande "Insérer une citation" dans le mécanisme de notes déjà
 *   en place ([^N] / [^N]: texte, voir utils/footnotes.js).
 * - "parenthetical" : auteur-date entre parenthèses dans le texte, style
 *   sciences sociales — insérée directement, pas de note.
 * `isRepeat` (voir main.js, suivi en mémoire de la dernière source citée
 * par fichier durant la session — PAS un marqueur caché dans le texte,
 * voir la correction plus bas) : la citation immédiatement précédente
 * porte sur la MÊME source — "Ibid." plutôt que de répéter toute la
 * référence, convention normale des deux styles.
 * "Op. cit." (la source a déjà été citée, mais pas immédiatement avant —
 * autre chose s'est glissé entre les deux) N'EST PAS géré : il faudrait
 * suivre TOUTES les citations précédentes du fichier, pas seulement la
 * dernière, et une forme courte par source (nom + titre abrégé) — hors
 * périmètre pour l'instant. */
export function formatCitation({ auteur, titre, date, editeur, url } = {}, page, style, isRepeat) {
  const p = (page || "").trim();

  if (isRepeat) {
    if (style === "parenthetical") {
      return p ? `(Ibid., p. ${p})` : "(Ibid.)";
    }
    return p ? `Ibid., p. ${p}.` : "Ibid.";
  }

  if (style === "parenthetical") {
    const base = [auteur, date].filter(Boolean).join(", ");
    const withPage = p ? [base, `p. ${p}`].filter(Boolean).join(", ") : base;
    return withPage ? `(${withPage})` : "";
  }

  const parts = [];
  if (auteur) parts.push(auteur);
  if (titre) parts.push(`*${titre}*`);
  if (editeur) parts.push(editeur);
  if (date) parts.push(String(date));
  if (p) parts.push(`p. ${p}`);
  /* URL en dernier, hors de la liste virgule — une adresse ne se lit pas
     comme un élément bibliographique de plus, et une source web n'a
     souvent ni éditeur ni page. */
  const u = (url || "").trim();
  const text = parts.join(", ");
  if (u) return text ? `${text}. ${u}` : u;
  return text ? `${text}.` : "";
}
