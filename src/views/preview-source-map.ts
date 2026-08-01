/* Repères de source pour l'aperçu (PreviewView) — et pour lui SEUL.
 *
 * Objectif : savoir, dans le DOM rendu, quel feuillet source a produit quel
 * bloc, pour pouvoir faire défiler l'aperçu jusqu'à la scène où se trouve le
 * curseur (synchronisation éditeur → aperçu), sans jamais recompiler.
 *
 * Pourquoi ce module existe plutôt qu'un ajout dans export-render.ts :
 *
 * 1. `compile()` produit bien des `segments` portant chacun son `path`
 *    (voir CompileSegment, services/compile-export.ts), mais le rendu
 *    concatène tous les segments et appelle `MarkdownRenderer` UNE fois :
 *    le DOM résultant ne conserve aucune frontière de segment.
 * 2. `stripObsidianCruft()` (export-render.ts) supprime tous les attributs
 *    `data-*` sauf `data-footnote-id`. Un attribut posé pendant le rendu
 *    serait donc effacé.
 * 3. export-render.ts est partagé par les QUATRE exporteurs : y ajouter un
 *    mode « annoté » ferait porter à l'export un besoin propre à l'aperçu.
 *
 * D'où la même technique que les pages Front (marqueurs textuels injectés
 * avant rendu, puis retirés du DOM après coup — voir FEUILLETS-FRONT dans
 * export-render.ts), mais appliquée en AVAL du pipeline commun : le
 * marquage est injecté dans le markdown que l'aperçu passe au rendu, et
 * converti en attributs APRÈS le retour de `renderManuscriptHtml*` — donc
 * après `stripObsidianCruft`, hors de sa portée.
 */

export type SourceSegment = {
  path: string | null;
  text: string;
  frontType?: string | null;
};

/** Préfixe volontairement improbable dans un manuscrit, et sur une ligne
 * seule pour que Markdown en fasse un paragraphe distinct — donc un élément
 * DOM identifiable, jamais fondu dans le texte voisin. */
export const SOURCE_MARKER_PREFIX = "FEUILLETS-SRC:";

/** Attribut posé sur le premier bloc rendu de chaque feuillet source. */
export const SOURCE_PATH_ATTR = "data-source-path";

/** Injecte un marqueur de source devant chaque segment ayant un chemin.
 * Les segments sans chemin (titres de partie/chapitre générés, qui n'ont
 * pas de fiche propre) sont laissés tels quels : ils appartiennent
 * visuellement à la scène qui suit. */
export function markSegments(segments: SourceSegment[]): SourceSegment[] {
  return segments.map((seg) =>
    seg.path ? { ...seg, text: `${SOURCE_MARKER_PREFIX}${seg.path}\n\n${seg.text}` } : seg
  );
}

/** Même marquage, appliqué au markdown concaténé — nécessaire car
 * `renderManuscriptHtmlWithFrontPages` n'utilise les segments que lorsqu'au
 * moins l'un d'eux est une page Front ; sinon il rend le markdown reçu. Le
 * séparateur doit être celui utilisé par `compile()` pour joindre les
 * segments, faute de quoi les deux chemins de rendu divergeraient. */
export function markManuscript(segments: SourceSegment[], separator: string): string {
  return markSegments(segments)
    .map((seg) => seg.text)
    .join(separator);
}

type MarkerHost = {
  querySelectorAll(selector: string): ArrayLike<Element>;
};

/** Convertit les paragraphes-marqueurs du DOM rendu en attributs
 * `data-source-path` posés sur le bloc SUIVANT, puis retire les marqueurs.
 * À appeler après `renderManuscriptHtml*`, jamais avant.
 *
 * @returns la liste ordonnée des chemins effectivement repérés.
 */
export function applySourceMarkers(containerEl: MarkerHost): string[] {
  const found: string[] = [];
  const candidates = Array.from(containerEl.querySelectorAll("p"));

  for (const marker of candidates) {
    const text = (marker.textContent || "").trim();
    if (!text.startsWith(SOURCE_MARKER_PREFIX)) continue;

    const path = text.slice(SOURCE_MARKER_PREFIX.length).trim();
    if (!path) {
      marker.remove();
      continue;
    }

    /* Le repère reste sur le VRAI premier bloc exporté. Aucun titre ni
       conteneur propre à PreviewView ne doit entrer dans le flux paginé :
       l'aperçu doit reproduire strictement le modèle d'export. */
    const target = nextElement(marker) || marker.parentElement;
    if (target && typeof target.setAttribute === "function") {
      target.setAttribute(SOURCE_PATH_ATTR, path);
      found.push(path);
    }
    marker.remove();
  }
  return found;
}

function nextElement(el: Element): Element | null {
  const next = el.nextElementSibling;
  return next && next !== el ? next : null;
}
