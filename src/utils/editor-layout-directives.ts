/* ===== LOT 3D — moteur PUR de résolution/mutation des directives de mise en
 * page (3A `%% image: … %%` / 3B `%% colonnes: … %%` / `%% dessous %%`) =====
 * Ce module ne fait AUCUNE hypothèse sur Obsidian : il prend le Markdown
 * source (chaîne + ligne du curseur) et retourne un contexte immuable, ou
 * calcule l'édition texte à appliquer. L'écriture réelle dans l'éditeur
 * (Editor.replaceRange) reste entièrement du ressort de l'appelant
 * (src/ui/layout-directive-modal.ts, src/main.ts) — voir §24/§25 du lot.
 *
 * Les grammaires 3A/3B elles-mêmes (validité d'une valeur, sérialisation)
 * restent celles de utils/feuillets-directives.ts (gelé, §6 du lot) :
 * ce module ne fait que repérer les LIGNES candidates dans le texte source
 * et délègue toute décision de validité aux parseurs déjà exportés
 * (parseImageDirectiveLine / parseColumnsDirectiveLine). */

import {
  parseImageDirectiveLine,
  parseColumnsDirectiveLine,
  type ImagePlacement,
  type ImageWidth,
  type ColumnComposition,
  type ColumnRatio,
} from "./feuillets-directives.js";
import { SEMANTIC_ROLE_ALIASES, type SemanticRole } from "./semantic-roles.js";

export type LayoutSlotKind = "image" | "text";

export type ImagePlacementChoice = "auto" | ImagePlacement;

export interface LayoutLineRange {
  start: number;
  end: number;
}

export interface LayoutBlockInfo extends LayoutLineRange {
  kind: LayoutSlotKind | "other";
}

export interface LayoutImageState {
  placement: ImagePlacementChoice;
  width: ImageWidth | null;
}

export type PairingRelation = "auto" | "colonnes" | "dessous";

export interface LayoutPairingState {
  composition: ColumnComposition;
  relation: PairingRelation;
  ratio: ColumnRatio | null;
  dessousAvailable: boolean;
  firstBlock: LayoutLineRange;
  secondBlock: LayoutLineRange;
}

export interface LayoutDirectiveContext {
  block: LayoutBlockInfo;
  firstBlock: LayoutBlockInfo;
  image: LayoutImageState | null;
  pairing: LayoutPairingState | null;
}

export interface LayoutDirectiveChanges {
  image?: LayoutImageState;
  pairing?: { relation: PairingRelation; ratio?: ColumnRatio };
}

export interface LayoutDirectiveEdit {
  fromLine: number;
  toLine: number;
  text: string;
}

/* ===== Reconnaissance des lignes de directive (préambule) =====
 * Formes SYNTAXIQUES (pas de validation de valeur ici — parseImageDirectiveLine
 * / parseColumnsDirectiveLine restent la seule source de vérité pour la
 * validité, §22 du lot) : sert uniquement à décider qu'une ligne appartient
 * bien à la famille layout et doit donc être traversée (et jamais interprétée
 * comme du contenu réel) pendant le balayage du préambule. */
const IMAGE_LINE_SHAPE = /^\s*%%\s*image\s*:\s*.+?\s*%%\s*$/u;
const COLUMNS_LINE_SHAPE = /^\s*%%\s*colonnes\s*:\s*.+?\s*%%\s*$/u;
const DESSOUS_LINE_SHAPE = /^\s*%%\s*dessous\b.*%%\s*$/u;
const DESSOUS_LINE_EXACT = /^\s*%%\s*dessous\s*%%\s*$/u;
/* Autre famille Feuillets (`ligne`/`espace`) : jamais touchée, et fait
 * toujours obstacle au balayage du préambule (§21). */
const FOREIGN_DIRECTIVE_SHAPE = /^\s*%%\s*(?:ligne|espace)\b.*%%\s*$/u;

function isLayoutDirectiveShape(line: string): boolean {
  return IMAGE_LINE_SHAPE.test(line) || COLUMNS_LINE_SHAPE.test(line) || DESSOUS_LINE_SHAPE.test(line);
}

const FENCE_RE = /^\s*(```|~~~)/u;
const HEADING_RE = /^\s{0,3}#{1,6}(\s|$)/u;
const HR_RE = /^\s{0,3}(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/u;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+/u;
const EMBED_IMAGE_RE = /^!\[\[[^\]]+\]\]$/u;
const MARKDOWN_IMAGE_RE = /^!\[[^\]]*\]\([^)]+\)$/u;

type RawLineKind =
  | "blank"
  | "frontmatter"
  | "code"
  | "heading"
  | "hr"
  | "table"
  | "directive"
  | "image"
  | "list"
  | "blockquote"
  | "paragraph";

/** Classe chaque ligne indépendamment de son voisinage — le regroupement en
 * blocs (mergeIntoBlocks) applique ensuite les règles de fusion propres à
 * chaque catégorie. */
function classifyLines(lines: string[]): RawLineKind[] {
  const kinds: RawLineKind[] = lines.map(() => "paragraph");
  let inFrontmatter = lines[0]?.trim() === "---";
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && inFrontmatter) {
      kinds[i] = "frontmatter";
      continue;
    }
    if (inFrontmatter) {
      kinds[i] = "frontmatter";
      if (line.trim() === "---") inFrontmatter = false;
      continue;
    }
    if (FENCE_RE.test(line)) {
      kinds[i] = "code";
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      kinds[i] = "code";
      continue;
    }
    if (line.trim() === "") {
      kinds[i] = "blank";
    } else if (isLayoutDirectiveShape(line) || FOREIGN_DIRECTIVE_SHAPE.test(line)) {
      kinds[i] = "directive";
    } else if (HEADING_RE.test(line)) {
      kinds[i] = "heading";
    } else if (HR_RE.test(line)) {
      kinds[i] = "hr";
    } else if (LIST_RE.test(line)) {
      kinds[i] = "list";
    } else if (line.trim().startsWith(">")) {
      kinds[i] = "blockquote";
    } else if (EMBED_IMAGE_RE.test(line.trim()) || MARKDOWN_IMAGE_RE.test(line.trim())) {
      kinds[i] = "image";
    } else if (line.includes("|")) {
      kinds[i] = "table";
    } else {
      kinds[i] = "paragraph";
    }
  }
  return kinds;
}

/** Regroupe les lignes classées en blocs structurels (§8/§9 du lot) : seules
 * les lignes "paragraph"/"image" adjacentes (sans ligne vide ni directive
 * entre elles) fusionnent en un seul bloc — un bloc qui mélange une image et
 * du texte, ou plusieurs images, n'est ni un slot image ni un slot texte
 * (miroir exact de isImageSlotBlock/isTextSlotBlock, feuillets-directives.ts). */
function mergeIntoBlocks(lines: string[], kinds: RawLineKind[]): LayoutBlockInfo[] {
  const blocks: LayoutBlockInfo[] = [];
  let i = 0;
  while (i < lines.length) {
    const kind = kinds[i];
    if (kind === "blank" || kind === "directive") {
      i++;
      continue;
    }
    if (kind === "frontmatter" || kind === "code") {
      const start = i;
      while (i < lines.length && kinds[i] === kind) i++;
      blocks.push({ kind: "other", start, end: i - 1 });
      continue;
    }
    if (kind === "heading" || kind === "hr") {
      blocks.push({ kind: "other", start: i, end: i });
      i++;
      continue;
    }
    if (kind === "table") {
      const start = i;
      while (i < lines.length && kinds[i] === "table") i++;
      blocks.push({ kind: "other", start, end: i - 1 });
      continue;
    }
    if (kind === "list" || kind === "blockquote") {
      const start = i;
      while (i < lines.length && kinds[i] === kind) i++;
      blocks.push({ kind: "text", start, end: i - 1 });
      continue;
    }
    // "paragraph" / "image" : fusion mutuelle uniquement.
    const start = i;
    let sawImage = false;
    let sawParagraph = false;
    while (i < lines.length && (kinds[i] === "paragraph" || kinds[i] === "image")) {
      if (kinds[i] === "image") sawImage = true;
      else sawParagraph = true;
      i++;
    }
    const end = i - 1;
    const single = start === end;
    const resolvedKind: LayoutSlotKind | "other" = sawImage && !sawParagraph && single ? "image" : sawImage ? "other" : "text";
    blocks.push({ kind: resolvedKind, start, end });
  }
  return blocks;
}

function computeContentBlocks(lines: string[]): LayoutBlockInfo[] {
  return mergeIntoBlocks(lines, classifyLines(lines));
}

/** Trouve le bloc contenant `line`, ou — si le curseur est dans une zone de
 * transition (ligne vide, directive) — le bloc structurel qui suit
 * immédiatement (les directives précèdent toujours leur bloc, jamais l'inverse). */
function blockIndexAtLine(blocks: LayoutBlockInfo[], line: number): number | null {
  for (let i = 0; i < blocks.length; i++) {
    if (line >= blocks[i].start && line <= blocks[i].end) return i;
    if (line < blocks[i].start) return i;
  }
  return null;
}

/** Début du préambule (directives + lignes vides) immédiatement associé au
 * bloc `blocks[idx]` — s'arrête au bloc structurel précédent (§21 : contenu
 * réel, autre construction Markdown, ou directive d'une autre famille —
 * cette dernière étant déjà un bloc "other" via classifyLines/FOREIGN, donc
 * automatiquement hors de portée puisqu'un bloc "other" borne la recherche
 * exactement comme n'importe quel autre bloc). */
function boundaryBeforeBlock(blocks: LayoutBlockInfo[], idx: number): number {
  return idx > 0 ? blocks[idx - 1].end + 1 : 0;
}

function readRelation(lines: string[], boundary: number, blockStart: number): { type: "dessous" } | { type: "colonnes"; ratio: ColumnRatio } | null {
  for (let i = boundary; i < blockStart; i++) {
    const line = lines[i];
    if (DESSOUS_LINE_EXACT.test(line)) return { type: "dessous" };
    const parsed = parseColumnsDirectiveLine(line);
    if (parsed) return { type: "colonnes", ratio: parsed.ratio };
  }
  return null;
}

function findValidImageDirective(lines: string[], boundary: number, blockStart: number): { placement: "auto" } | { placement: ImagePlacement; width?: ImageWidth } | null {
  for (let i = boundary; i < blockStart; i++) {
    const parsed = parseImageDirectiveLine(lines[i]);
    if (parsed) return parsed;
  }
  return null;
}

function imageStateFromParsed(parsed: ReturnType<typeof findValidImageDirective>): LayoutImageState {
  if (!parsed || parsed.placement === "auto") return { placement: "auto", width: null };
  if (parsed.placement === "pleine-largeur") return { placement: "pleine-largeur", width: null };
  return { placement: parsed.placement, width: "width" in parsed && parsed.width ? parsed.width : null };
}

function compositionFor(first: LayoutSlotKind, second: LayoutSlotKind): ColumnComposition | null {
  if (first === "image" && second === "text") return "image-texte";
  if (first === "text" && second === "image") return "texte-image";
  if (first === "image" && second === "image") return "image-image";
  return null;
}

/** Rôle sémantique porté par un bloc "texte" qui est en réalité un callout
 * `> [!rôle] …` — réutilise le registre existant (SEMANTIC_ROLE_ALIASES,
 * semantic-roles.ts) : jamais de seconde liste des 18 rôles. */
function calloutRoleOf(lines: string[], block: LayoutBlockInfo): SemanticRole | null {
  if (block.kind !== "text") return null;
  const match = lines[block.start].match(/^\s*>\s*\[!([A-Za-z0-9_-]+)\]/u);
  if (!match) return null;
  return SEMANTIC_ROLE_ALIASES[match[1].trim().toLowerCase()] || null;
}

/** Tous les 18 rôles sémantiques sont éligibles pour le pairing automatique
 * SAUF `source` (remplaçant du rôle historique `document` qui était aussi
 * exclu du pairing Dessous automatique) — le rendu 3A/3B lui-même reste gelé,
 * hors périmètre. */
function isDessousEligibleRole(role: SemanticRole | null): boolean {
  return role !== null && role !== "source";
}

function toRange(block: LayoutBlockInfo): LayoutLineRange {
  return { start: block.start, end: block.end };
}

/** Résout le contexte de mise en page pour la ligne du curseur, ou `null` si
 * aucune action 3D n'est pertinente ici (§3/§26 : bloc non admissible, ou
 * admissible mais ni compatible 3A ni compatible 3B). */
export function resolveLayoutDirectiveContext(text: string, cursorLine: number): LayoutDirectiveContext | null {
  const lines = text.split("\n");
  const blocks = computeContentBlocks(lines);
  const idx = blockIndexAtLine(blocks, cursorLine);
  if (idx === null) return null;
  const cursorBlock = blocks[idx];
  if (cursorBlock.kind === "other") return null;

  let firstIdx = idx;
  const ownBoundary = boundaryBeforeBlock(blocks, idx);
  const ownRelation = readRelation(lines, ownBoundary, cursorBlock.start);
  if (!ownRelation && idx > 0) {
    const prevBoundary = boundaryBeforeBlock(blocks, idx - 1);
    const prevRelation = readRelation(lines, prevBoundary, blocks[idx - 1].start);
    if (prevRelation) firstIdx = idx - 1;
  }

  const firstBlock = blocks[firstIdx];
  const secondBlock: LayoutBlockInfo | null = firstIdx + 1 < blocks.length ? blocks[firstIdx + 1] : null;

  let image: LayoutImageState | null = null;
  if (firstBlock.kind === "image") {
    const boundary = boundaryBeforeBlock(blocks, firstIdx);
    image = imageStateFromParsed(findValidImageDirective(lines, boundary, firstBlock.start));
  }

  let pairing: LayoutPairingState | null = null;
  if (secondBlock && firstBlock.kind !== "other" && secondBlock.kind !== "other") {
    const composition = compositionFor(firstBlock.kind, secondBlock.kind);
    if (composition) {
      const boundary = boundaryBeforeBlock(blocks, firstIdx);
      const relation = readRelation(lines, boundary, firstBlock.start);
      const dessousAvailable = firstBlock.kind === "image" && isDessousEligibleRole(calloutRoleOf(lines, secondBlock));
      pairing = {
        composition,
        relation: relation ? relation.type : "auto",
        ratio: relation && relation.type === "colonnes" ? relation.ratio : null,
        dessousAvailable,
        firstBlock: toRange(firstBlock),
        secondBlock: toRange(secondBlock),
      };
    }
  }

  if (!image && !pairing) return null;

  return {
    block: { kind: cursorBlock.kind, start: cursorBlock.start, end: cursorBlock.end },
    firstBlock: { kind: firstBlock.kind, start: firstBlock.start, end: firstBlock.end },
    image,
    pairing,
  };
}

function imageDirectiveLine(state: LayoutImageState): string | null {
  if (state.placement === "auto") return null;
  if (state.placement === "pleine-largeur") return "%% image: pleine-largeur %%";
  return `%% image: ${state.placement}${state.width ? ` ${state.width}%` : ""} %%`;
}

function relationDirectiveLine(relation: PairingRelation, ratio: ColumnRatio | undefined, composition: ColumnComposition): string | null {
  if (relation === "dessous") return "%% dessous %%";
  if (relation === "colonnes" && ratio) return `%% colonnes: ${composition} ${ratio} %%`;
  return null;
}

/** Calcule l'édition texte (lignes [fromLine, toLine) remplacées par `text`)
 * à appliquer via Editor.replaceRange, ou `null` si rien ne change. Ne
 * touche jamais que le préambule du bloc `context.firstBlock` : les lignes
 * vides et les directives non gérées ici (invalides, ou d'une autre
 * famille — bien que ces dernières bornent déjà le préambule en amont)
 * sont préservées à l'identique et dans leur ordre d'origine (§22/§24/§43). */
export function computeLayoutDirectiveEdit(
  text: string,
  context: LayoutDirectiveContext,
  changes: LayoutDirectiveChanges,
): LayoutDirectiveEdit | null {
  const lines = text.split("\n");
  const blocks = computeContentBlocks(lines);
  const firstIdx = blocks.findIndex((b) => b.start === context.firstBlock.start);
  if (firstIdx === -1) return null;
  const blockStart = blocks[firstIdx].start;
  const boundary = boundaryBeforeBlock(blocks, firstIdx);

  const manageImage = changes.image !== undefined && context.image !== null;
  const manageRelation = changes.pairing !== undefined && context.pairing !== null;

  const kept: string[] = [];
  for (let i = boundary; i < blockStart; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      kept.push(line);
      continue;
    }
    if (manageImage && parseImageDirectiveLine(line) !== null) continue;
    if (manageRelation && (DESSOUS_LINE_EXACT.test(line) || parseColumnsDirectiveLine(line) !== null)) continue;
    kept.push(line);
  }

  const newDirectiveLines: string[] = [];
  if (manageRelation && changes.pairing && context.pairing) {
    const line = relationDirectiveLine(changes.pairing.relation, changes.pairing.ratio, context.pairing.composition);
    if (line) newDirectiveLines.push(line);
  }
  if (manageImage && changes.image) {
    const line = imageDirectiveLine(changes.image);
    if (line) newDirectiveLines.push(line);
  }

  let finalLines: string[];
  if (newDirectiveLines.length === 0) {
    finalLines = kept;
  } else if (kept.length === 0) {
    finalLines = [...newDirectiveLines, ""];
  } else {
    finalLines = [...newDirectiveLines, ...kept];
  }

  const originalRegion = lines.slice(boundary, blockStart).join("\n");
  const newRegion = finalLines.join("\n");
  if (originalRegion === newRegion) return null;

  return {
    fromLine: boundary,
    toLine: blockStart,
    text: finalLines.length ? `${finalLines.join("\n")}\n` : "",
  };
}
