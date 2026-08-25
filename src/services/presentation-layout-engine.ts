/* Moteur de layout Présentation v2 — service PUR, neutre, indépendant de
 * toute vue. Objectif : un solveur de candidats mesurés — génère quelques
 * dispositions plausibles pour une slide, les fait mesurer hors écran par
 * un appelant (typiquement une vue), puis choisit la meilleure par
 * comparaison de mesures réelles. Aucun seuil de ratio, aucune heuristique
 * de « fit ».
 *
 * Ce fichier est l'extraction, à comportement strictement identique, du
 * cœur générique précédemment situé dans presentation-prototype.ts : mêmes
 * candidats, mêmes ratios, même ordre, même scoring, même formule contain,
 * même détection d'overflow. Seuls les noms de symboles ont changé (retrait
 * de « Prototype »).
 *
 * La Présentation actuelle (src/services/presentation.ts) n'appelle PAS
 * encore ce moteur — cette extraction est un déplacement de comportement
 * déjà validé, pas une bascule de la vraie Présentation.
 */

/** Le moteur ne connaît que trois géométries. Pas de géométrie métier. */
export type PresentationGeometry = "flow" | "split" | "stack";

export type PresentationLayoutOverride = "flow" | "columns" | "image-left" | "image-right";

/** Nature d'un bloc direct de slide, telle que déterminée par classifyPresentationBlock. */
export type PresentationBlockKind = "heading" | "media" | "list" | "text" | "callout" | "other";

/** Descripteur PUR d'un bloc — jamais de HTMLElement conservé au-delà de l'appel. */
export type PresentationBlockDescriptor = {
  index: number;
  kind: PresentationBlockKind;
};

export const PRESENTATION_MEDIA_BLOCK_CLASS = "feuillets-presentation-prototype-media-block";
export const PRESENTATION_MEDIA_WRAPPER_CLASS = "feuillets-presentation-prototype-media-wrapper";

/** Un candidat SPLIT/STACK PUR — jamais de HTMLElement, uniquement des index et des ratios. */
export type PresentationCandidatePlan = {
  id: string;
  geometry: "split" | "stack";
  headingIndexes: number[];
  cellAIndexes: number[];
  cellBIndexes: number[];
  cellARatio: number;
  cellBRatio: number;
  mediaPosition: "a" | "b" | null;
};

/** Mesure PURE d'un candidat, produite hors écran par l'appelant puis comparée ici. */
export interface PresentationCandidateMeasurement {
  id: string;
  overflowPx: number;
  mediaArea: number;
  minTextWidth: number;
}

const SPLIT_RATIOS: ReadonlyArray<readonly [number, number]> = [
  [42, 58],
  [50, 50],
  [58, 42],
];
const TEXT_TEXT_SPLIT_RATIOS: ReadonlyArray<readonly [number, number]> = [
  [35, 65],
  [42, 58],
  [50, 50],
  [58, 42],
  [65, 35],
];
const STACK_RATIOS: ReadonlyArray<readonly [number, number]> = [
  [65, 35],
  [60, 40],
  [55, 45],
];

/** Type structurel minimal partagé par le vrai DOM et les FakeElement de test. */
type PresentationElementLike = {
  tagName: string;
  text?: string;
  childNodes?: ArrayLike<{ nodeType?: number; textContent?: string | null }>;
  querySelector(selector: string): PresentationElementLike | null;
  querySelectorAll(selector: string): ArrayLike<PresentationElementLike>;
  getAttribute?(name: string): string | null;
};

/** « Texte direct significatif » : couvre à la fois le DOM réel (nœuds texte) et la
 * convention FakeElement du dépôt (propriété .text portée par l'élément lui-même). */
function hasSignificantDirectText(el: PresentationElementLike): boolean {
  const own = typeof el.text === "string" ? el.text.trim() : "";
  if (own.length > 0) return true;
  const nodes = el.childNodes ? Array.from(el.childNodes) : [];
  return nodes.some((node) => node.nodeType === 3 && (node.textContent || "").trim().length > 0);
}

/**
 * Détection média autonome : enfant direct P/FIGURE/DIV contenant
 * exactement un img ou video, sans li/blockquote/table, sans texte direct
 * significatif. Aucune dépendance à une classe privée Obsidian.
 */
export function isAutonomousMediaBlock(el: PresentationElementLike): boolean {
  if (!["P", "FIGURE", "DIV"].includes(el.tagName)) return false;
  const media = Array.from(el.querySelectorAll("img, video"));
  if (media.length !== 1) return false;
  if (el.querySelector("li, blockquote, table")) return false;
  if (hasSignificantDirectText(el)) return false;
  return true;
}

/** Classe un bloc direct de slide rendue en l'un des cinq PresentationBlockKind. */
export function classifyPresentationBlock(el: PresentationElementLike): PresentationBlockKind {
  if (/^H[1-6]$/.test(el.tagName)) return "heading";
  if (el.getAttribute?.("data-callout") !== null && el.getAttribute?.("data-callout") !== undefined) return "callout";
  if (isAutonomousMediaBlock(el)) return "media";
  if (el.tagName === "UL" || el.tagName === "OL") return "list";
  if (el.tagName === "P" || el.tagName === "BLOCKQUOTE") return "text";
  return "other";
}

/** Construit les descripteurs PURS à partir des enfants directs d'une slide rendue. */
export function descriptorsForSlide(inner: { children: ArrayLike<PresentationElementLike> }): PresentationBlockDescriptor[] {
  return Array.from(inner.children).map((el, index) => ({ index, kind: classifyPresentationBlock(el) }));
}

/**
 * Première slide de titre : exactement un ou deux blocs significatifs, avec
 * un heading en premier et, au plus, un heading ou un texte en second.
 */
export function isPresentationTitleSlide(index: number, blocks: PresentationBlockDescriptor[]): boolean {
  if (index !== 0) return false;
  if (blocks.length < 1 || blocks.length > 2) return false;
  if (blocks[0].kind !== "heading") return false;
  return blocks.length === 1 || blocks[1].kind === "heading" || blocks[1].kind === "text";
}

/**
 * Génère les candidats SPLIT/STACK PURS. Règles exactes :
 *
 *  SANS MÉDIA (mediaCount === 0) :
 *    - si >= 2 blocs, TOUS text/list/callout => partitions CONTIGUËS en 2 colonnes
 *      * exactement 2 blocs => 5 ratios (IDs historiques split-35-65, etc.)
 *      * 3+ blocs => (N-1) frontières × 5 ratios (IDs split-text-{boundary}-{a}-{b})
 *    - sinon => FLOW forcé => []
 *
 *  AVEC 1 MÉDIA (mediaCount === 1) :
 *    - si du contenu non-média existe => TOUJOURS 12 candidats (indépendamment
 *      de la position Markdown du média) :
 *      * 3 SPLIT media-a, 3 STACK media-a (média en cellule A)
 *      * 3 SPLIT media-b, 3 STACK media-b (média en cellule B)
 *      * média seul dans sa cellule, contenu regroupé dans l'autre,
 *        ordre Markdown du contenu conservé
 *    - si seuls headings + 1 média (aucun autre contenu) => FLOW forcé => []
 *
 *  AUTREMENT (0 ou 2+ médias) => FLOW forcé => []
 *
 * Une liste (UL/OL) est un simple contenu : aucune règle spécifique « questions ».
 *
 * BUG 1 FIX: Headings contigus au début de la slide seulement — après le premier
 * bloc non-heading, tout heading reste dans le body à sa position Markdown.
 */
export function generatePresentationCandidates(blocks: PresentationBlockDescriptor[]): PresentationCandidatePlan[] {
  // BUG 1 FIX: Seulement headings contigus au début — tous autres blocs (y compris headings non-contigus) vont dans le body
  const headingIndexes: number[] = [];
  let firstNonHeaderIndex = blocks.length;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].kind === "heading") {
      headingIndexes.push(blocks[i].index);
    } else {
      firstNonHeaderIndex = i;
      break;
    }
  }

  const nonHeaderBlocks = blocks.slice(firstNonHeaderIndex);
  const mediaCount = nonHeaderBlocks.filter((b) => b.kind === "media").length;

  // SANS MÉDIA : partitions contiguës ou FLOW
  if (mediaCount === 0) {
    if (nonHeaderBlocks.length < 2) return [];
    if (nonHeaderBlocks.some((b) => !["text", "list", "callout"].includes(b.kind))) return [];

    // Tous les blocs sont text/list/callout et >= 2
    const candidates: PresentationCandidatePlan[] = [];

    if (nonHeaderBlocks.length === 2) {
      // Cas exact de 2 blocs : IDs historiques pour compatibilité
      const [first, second] = nonHeaderBlocks;
      for (const [a, b] of TEXT_TEXT_SPLIT_RATIOS) {
        candidates.push({
          id: `split-${a}-${b}`,
          geometry: "split",
          headingIndexes,
          cellAIndexes: [first.index],
          cellBIndexes: [second.index],
          cellARatio: a,
          cellBRatio: b,
          mediaPosition: null,
        });
      }
    } else {
      // Cas 3+ blocs : partitions contiguës avec nouveaux IDs
      for (let boundary = 1; boundary < nonHeaderBlocks.length; boundary++) {
        for (const [a, b] of TEXT_TEXT_SPLIT_RATIOS) {
          candidates.push({
            id: `split-text-${boundary}-${a}-${b}`,
            geometry: "split",
            headingIndexes,
            cellAIndexes: nonHeaderBlocks.slice(0, boundary).map((b) => b.index),
            cellBIndexes: nonHeaderBlocks.slice(boundary).map((b) => b.index),
            cellARatio: a,
            cellBRatio: b,
            mediaPosition: null,
          });
        }
      }
    }
    return candidates;
  }

  if (mediaCount !== 1) return [];

  const mediaPos = nonHeaderBlocks.findIndex((b) => b.kind === "media");
  const before = nonHeaderBlocks.slice(0, mediaPos);
  const after = nonHeaderBlocks.slice(mediaPos + 1);
  const mediaIndex = nonHeaderBlocks[mediaPos].index;

  // BUG 2 FIX: Forcer FLOW pour headings + image seule (pas d'autre contenu)
  if (before.length === 0 && after.length === 0) return [];

  // AVEC 1 MÉDIA + CONTENU : TOUJOURS 12 candidats, indépendamment de l'ordre
  const contentIndexes = nonHeaderBlocks.filter((b) => b.kind !== "media").map((b) => b.index);
  const grouped: PresentationCandidatePlan[] = [];

  // Orientation A : média en cellule A
  for (const [a, b] of SPLIT_RATIOS) {
    grouped.push({
      id: `split-media-a-${a}-${b}`,
      geometry: "split",
      headingIndexes,
      cellAIndexes: [mediaIndex],
      cellBIndexes: contentIndexes,
      cellARatio: a,
      cellBRatio: b,
      mediaPosition: "a",
    });
  }
  for (const [a, b] of STACK_RATIOS) {
    grouped.push({
      id: `stack-media-a-${a}-${b}`,
      geometry: "stack",
      headingIndexes,
      cellAIndexes: [mediaIndex],
      cellBIndexes: contentIndexes,
      cellARatio: a,
      cellBRatio: b,
      mediaPosition: "a",
    });
  }

  // Orientation B : média en cellule B
  for (const [a, b] of SPLIT_RATIOS) {
    grouped.push({
      id: `split-media-b-${a}-${b}`,
      geometry: "split",
      headingIndexes,
      cellAIndexes: contentIndexes,
      cellBIndexes: [mediaIndex],
      cellARatio: a,
      cellBRatio: b,
      mediaPosition: "b",
    });
  }
  for (const [a, b] of STACK_RATIOS) {
    grouped.push({
      id: `stack-media-b-${a}-${b}`,
      geometry: "stack",
      headingIndexes,
      cellAIndexes: contentIndexes,
      cellBIndexes: [mediaIndex],
      cellARatio: a,
      cellBRatio: b,
      mediaPosition: "b",
    });
  }

  return grouped;
}

/** Deux surfaces considérées égales si leur écart relatif est inférieur à 1%. */
function withinOnePercent(a: number, b: number): boolean {
  const ref = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / ref < 0.01;
}

/**
 * Classement PUR des candidats (règle exacte) :
 *  1. candidats valides := overflowPx <= 1 ;
 *  2. s'il en existe : le plus grand mediaArea gagne ;
 *  3. égalité à moins de 1% : le plus grand minTextWidth gagne ;
 *  4. nouvelle égalité : ordre original conservé ;
 *  5. aucun candidat valide : le plus petit overflowPx gagne ;
 *  6. égalité d'overflow : le plus grand mediaArea gagne.
 * Aucune autre heuristique. Aucun seuil d'aspect ratio.
 */
export function choosePresentationCandidate(measurements: readonly PresentationCandidateMeasurement[]): string | null {
  if (measurements.length === 0) return null;
  const valid = measurements.filter((m) => m.overflowPx <= 1);

  if (valid.length > 0) {
    let best = valid[0];
    for (let i = 1; i < valid.length; i++) {
      const m = valid[i];
      if (withinOnePercent(m.mediaArea, best.mediaArea)) {
        if (m.minTextWidth > best.minTextWidth) best = m;
      } else if (m.mediaArea > best.mediaArea) {
        best = m;
      }
    }
    return best.id;
  }

  let best = measurements[0];
  for (let i = 1; i < measurements.length; i++) {
    const m = measurements[i];
    if (m.overflowPx < best.overflowPx) best = m;
    else if (m.overflowPx === best.overflowPx && m.mediaArea > best.mediaArea) best = m;
  }
  return best.id;
}

/** Type structurel d'une cellule/bloc média réels, pour la normalisation ci-dessous. */
type PresentationMediaHost = {
  classList: { add(...names: string[]): void };
  querySelectorAll(selector: string): ArrayLike<PresentationMediaEl>;
};
type PresentationMediaEl = {
  classList: { add(...names: string[]): void };
  removeAttribute(name: string): void;
  style: { removeProperty(name: string): void };
  parentElement: (PresentationMediaEl & PresentationMediaHost) | null;
};

/**
 * Normalisation MediaCell : la cellule est l'autorité de géométrie. Marque
 * le bloc média et chaque wrapper intermédiaire jusqu'à la cellule (exclue),
 * retire toute taille explicite (attribut ou inline) posée sur le média et
 * ses wrappers. Ne sort jamais de la cellule. Idempotent. Ne modifie jamais
 * le Markdown ni le DOM de l'éditeur.
 */
export function normalizePresentationMediaCell(cell: PresentationMediaHost, mediaBlock: PresentationMediaHost & PresentationMediaEl): void {
  mediaBlock.classList.add(PRESENTATION_MEDIA_BLOCK_CLASS);
  const mediaEls = Array.from(mediaBlock.querySelectorAll("img, video"));
  for (const mediaEl of mediaEls) {
    mediaEl.removeAttribute("width");
    mediaEl.removeAttribute("height");
    mediaEl.style.removeProperty("width");
    mediaEl.style.removeProperty("height");
    let parent = mediaEl.parentElement;
    while (parent && parent !== (cell as unknown as PresentationMediaEl)) {
      parent.classList.add(PRESENTATION_MEDIA_WRAPPER_CLASS);
      parent.style.removeProperty("width");
      parent.style.removeProperty("height");
      parent = parent.parentElement;
    }
  }
}

/** Détection d'overflow — implémentation locale au moteur (aucun autre code de la Présentation actuelle réutilisé). */
export function presentationLayoutOverflows(element: Pick<HTMLElement, "scrollWidth" | "clientWidth" | "scrollHeight" | "clientHeight">): boolean {
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
}

/** Taille PURE d'un média en `contain` dans une cellule, calculée mathématiquement — jamais lue dans le navigateur. */
export interface PresentationContainedSize {
  width: number;
  height: number;
  area: number;
}

/**
 * Taille exacte d'un média en `object-fit: contain` dans une cellule de
 * `cellWidth`×`cellHeight`, à partir de ses dimensions naturelles. Aucun
 * crop, aucune déformation, aucun upscale arbitraire au-delà de la cellule —
 * c'est la même formule mathématique que `object-fit: contain`, calculée en
 * amont pour que la taille appliquée au média et la taille utilisée pour le
 * score (`mediaArea`) soient rigoureusement identiques, plutôt que de faire
 * confiance à un rectangle éventuellement coupé par les wrappers du rendu.
 */
export function presentationContainedMediaSize(
  cellWidth: number,
  cellHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): PresentationContainedSize | null {
  for (const value of [cellWidth, cellHeight, mediaWidth, mediaHeight]) {
    if (!Number.isFinite(value) || value <= 0) return null;
  }
  const scale = Math.min(cellWidth / mediaWidth, cellHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  return { width, height, area: width * height };
}
