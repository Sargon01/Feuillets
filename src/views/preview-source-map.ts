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

/* ================= Repères de BLOC (clic Aperçu → éditeur) =================
 *
 * Ce qui précède (SOURCE_PATH_ATTR) situe un FEUILLET ; ce qui suit situe un
 * BLOC Markdown à l'intérieur de ce feuillet (paragraphe, titre, liste,
 * citation, code, tableau…), pour que PreviewView puisse, au clic, placer le
 * curseur au bon endroit dans l'éditeur — sans jamais comparer de texte.
 *
 * La seule source de position acceptée est `MetadataCache.getFileCache(file)
 * .sections` : les couples ligne/colonne du FICHIER MARKDOWN ORIGINAL,
 * jamais recalculés depuis le rendu. Reste alors à savoir QUEL bloc rendu
 * correspond à QUELLE SectionCache, dans l'ordre — sans marqueur par bloc
 * (voir preview-scroll-sync.ts, même audit : un marqueur par bloc casserait
 * les listes et les blocs de code qu'il traverse).
 *
 * La solution retenue s'appuie sur le marqueur EXISTANT (un seul par
 * feuillet, déjà posé par `markSegments`) : les blocs qui suivent ce
 * marqueur, dans l'ordre, sont soit un ou deux titres ARTIFICIELS insérés
 * par Feuillets (titre de scène, éventuel sous-titre — jamais plus, jamais
 * fondés sur une SectionCache), soit le corps réel du feuillet, un bloc par
 * SectionCache, dans le même ordre. Le nombre de titres artificiels
 * (`leadingSkip`, 0/1/2) est fourni par l'appelant : PreviewView le connaît
 * exactement (c'est lui qui les a générés), il n'est jamais deviné ici.
 *
 * `applyBlockSourceMarkers` avance donc, pour chaque marqueur reconnu,
 * EXACTEMENT `leadingSkip + sections.length` éléments à partir du marqueur —
 * jamais « jusqu'au marqueur suivant », qui engloberait à tort un titre de
 * dossier/chapitre généré (segment SANS chemin, donc sans marqueur) placé
 * juste après ce feuillet dans le flux. Si le conteneur ne fournit pas assez
 * d'éléments réels pour ce quota, CE feuillet n'est pas repéré au niveau
 * bloc : mieux vaut renoncer que repérer au mauvais endroit.
 *
 * Doit être appelée AVANT `applySourceMarkers` (qui retire les marqueurs) —
 * cette fonction-ci ne les retire jamais elle-même, elle ne fait que lire
 * leur position dans le DOM. */

export type SourceLineCol = { line: number; col: number };

/** Position d'un bloc dans le fichier Markdown ORIGINAL — copie directe de
 * `SectionCache.position`, jamais une position recalculée. */
export type SourceBlockPosition = { start: SourceLineCol; end: SourceLineCol };

/** Repères d'un feuillet : ses sections réelles, dans l'ordre du fichier
 * (frontmatter déjà exclu), et le nombre de blocs de titre ARTIFICIELS que
 * PreviewView a insérés devant elles dans le rendu. */
export type SourceBlockMap = { leadingSkip: number; sections: SourceBlockPosition[] };

/** Chemin du feuillet porté par un BLOC repéré ligne à ligne.
 *
 * Volontairement DISTINCT de `SOURCE_PATH_ATTR`. Ce dernier a une sémantique
 * que toute la synchronisation de défilement tient pour acquise : « posé sur
 * le PREMIER bloc rendu de chaque feuillet », donc exactement une occurrence
 * par feuillet. `sectionForPath` (preview-view.ts) borne la section d'un
 * feuillet par le repère SUIVANT dans le document ; réutiliser le même
 * attribut ici ferait de chaque paragraphe un repère, et la « section » d'un
 * feuillet se réduirait à la hauteur d'un seul paragraphe — plus courte que
 * le cadre, donc d'amplitude nulle, ce qui fige les DEUX sens de la
 * synchronisation (régression constatée et mesurée en conditions réelles :
 * cible constante à 10⁻¹³ près pendant que la source défilait). */
export const SOURCE_BLOCK_PATH_ATTR = "data-source-block-path";

export const SOURCE_START_LINE_ATTR = "data-source-start-line";
export const SOURCE_START_COL_ATTR = "data-source-start-col";
export const SOURCE_END_LINE_ATTR = "data-source-end-line";
export const SOURCE_END_COL_ATTR = "data-source-end-col";

export function applyBlockSourceMarkers(
  containerEl: MarkerHost,
  blocksByPath: ReadonlyMap<string, SourceBlockMap>
): void {
  const markers = Array.from(containerEl.querySelectorAll("p")).filter((el) =>
    (el.textContent || "").trim().startsWith(SOURCE_MARKER_PREFIX)
  );

  for (const marker of markers) {
    const path = (marker.textContent || "").trim().slice(SOURCE_MARKER_PREFIX.length).trim();
    if (!path) continue;
    const info = blocksByPath.get(path);
    if (!info || !info.sections.length) continue;

    const need = info.leadingSkip + info.sections.length;
    const collected: Element[] = [];
    let node: Element | null = marker.nextElementSibling;
    while (node && collected.length < need) {
      collected.push(node);
      node = node.nextElementSibling;
    }
    if (collected.length < need) continue; // pas assez de blocs réels : abandon

    const bodyBlocks = collected.slice(info.leadingSkip);
    bodyBlocks.forEach((el, i) => {
      if (typeof el.setAttribute !== "function") return;
      const pos = info.sections[i];
      el.setAttribute(SOURCE_BLOCK_PATH_ATTR, path);
      el.setAttribute(SOURCE_START_LINE_ATTR, String(pos.start.line));
      el.setAttribute(SOURCE_START_COL_ATTR, String(pos.start.col));
      el.setAttribute(SOURCE_END_LINE_ATTR, String(pos.end.line));
      el.setAttribute(SOURCE_END_COL_ATTR, String(pos.end.col));
    });
  }
}
