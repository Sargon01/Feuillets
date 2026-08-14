/* `import * as` et non un import par défaut : diff v9 est un paquet ESM pur
   qui n'expose que des exports nommés. */
import * as Diff from "diff";
import { groupNativeReviewChanges, significantMoveText, type NativeReviewChangeGroup } from "./native-review-change-groups.js";

/**
 * Moteur de comparaison partagé par Relecture et Snapshots. Une comparaison,
 * c'est toujours la même chose : un texte de gauche (le vrai fichier, seul
 * modifiable) et un texte de droite (version du relecteur ou snapshot), plus
 * une liste de différences localisées **des deux côtés** — c'est ce qui permet
 * de cliquer une différence à droite et d'agir sur le fichier de gauche.
 */
export interface ComparisonEdit { baseStart: number; baseEnd: number; oldText: string; newText: string; }

/** Produces base-coordinate replacements, without attempting any fuzzy matching. */
export function comparisonEdits(base: string, changed: string): ComparisonEdit[] {
  const edits: ComparisonEdit[] = [];
  let baseOffset = 0;
  let pending: ComparisonEdit | null = null;
  for (const part of Diff.diffWordsWithSpace(base, changed)) {
    if (!part.added && !part.removed) {
      if (pending) { edits.push(pending); pending = null; }
      baseOffset += part.value.length;
      continue;
    }
    if (!pending) pending = { baseStart: baseOffset, baseEnd: baseOffset, oldText: "", newText: "" };
    if (part.removed) {
      pending.oldText += part.value;
      pending.baseEnd += part.value.length;
      baseOffset += part.value.length;
    } else {
      pending.newText += part.value;
    }
  }
  if (pending) edits.push(pending);
  return isolateMovedFragments(edits, base, changed);
}

/* --- Normalisation : isoler un fragment déplacé -------------------------
 *
 * Le diff brut (`Diff.diffWordsWithSpace`) trouve le script d'édition le
 * plus court entre deux textes complets ; il ne "sait" rien des paragraphes
 * ni des déplacements. Le cas problématique, confirmé sur un vrai
 * couper/coller : un côté (l'origine, ou la destination) ressort déjà comme
 * une édition AUTONOME — une suppression, ou un ajout, isolée, portant
 * exactement le passage déplacé — tandis que l'autre côté atterrit CONTRE un
 * autre changement (typiquement un ajout indépendant tout proche, sans le
 * moindre texte inchangé entre les deux pour les séparer) : le diff les
 * FOND alors en une seule et même édition, plus large, qui contient le
 * passage déplacé sans jamais l'isoler. `groupNativeReviewChanges()` (et son
 * propre `isMoveCandidate`) ne reçoit alors plus jamais, de ce côté, une
 * édition à elle seule — condition nécessaire pour reconnaître un
 * déplacement.
 *
 * Cette normalisation répare exactement ce cas, juste après le diff brut,
 * avec des règles volontairement strictes (KISS, jamais de LCS ni de
 * correspondance floue) :
 *   - le fragment cherché doit être EXACTEMENT le texte d'une édition déjà
 *     autonome (une suppression pure, ou un ajout pur) — jamais deviné dans
 *     un texte plus large ;
 *   - il doit être significatif (mêmes seuils que `detectMoves`, importés
 *     de native-review-change-groups.ts — jamais un second seuil) ;
 *   - il doit apparaître, à des frontières de mots propres, EXACTEMENT une
 *     fois dans le texte COMPLET de chaque côté (origine ET destination) —
 *     sinon (absent, répété, ambigu), rien n'est isolé et les éditions
 *     brutes restent telles quelles : aucun faux déplacement n'est inventé.
 * Quand ces conditions tiennent, l'édition plus large qui contient le
 * fragment est scindée en (au plus) trois éditions contiguës — texte avant,
 * fragment isolé, texte après — qui, mises bout à bout, reconstruisent
 * exactement l'édition d'origine : la reconstruction base → changed reste
 * donc rigoureusement exacte, seule la découpe change.
 */

const EDGE_WHITESPACE = { lead: /^\s+/, trail: /\s+$/ };
/** Sépare les espaces/retours à la ligne en bordure — un artefact de
 * frontière du diff brut, jamais une différence de contenu — du texte utile
 * qu'ils encadrent. */
function splitEdgeWhitespace(text: string): { lead: string; core: string; trail: string } {
  const lead = EDGE_WHITESPACE.lead.exec(text)?.[0] ?? "";
  const rest = text.slice(lead.length);
  const trail = EDGE_WHITESPACE.trail.exec(rest)?.[0] ?? "";
  return { lead, core: rest.slice(0, rest.length - trail.length), trail };
}

const MOVE_WORD_CHAR = /[\p{L}\p{N}]/u;
/** Occurrences de `needle` dans `haystack`, exclusivement à des frontières de
 * mots propres (jamais une correspondance à l'intérieur d'un mot plus long) —
 * aucune correspondance floue, une simple recherche exacte répétée. */
function findWordBoundaryOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    const before = at > 0 ? haystack[at - 1] : undefined;
    const after = haystack[at + needle.length];
    if (!(before && MOVE_WORD_CHAR.test(before)) && !(after && MOVE_WORD_CHAR.test(after))) positions.push(at);
    from = at + 1;
  }
  return positions;
}

function replaceEditAt(edits: ComparisonEdit[], index: number, replacement: ComparisonEdit[]): ComparisonEdit[] {
  return [...edits.slice(0, index), ...replacement, ...edits.slice(index + 1)];
}

/**
 * Scinde une édition PURE (suppression seule, ou ajout seul) en (au plus)
 * trois éditions contiguës autour de `core`, trouvé à `offset` en son sein —
 * la reconstruction (`lead + core + trail === texte d'origine`) est
 * immédiate, donc toujours exacte. `atBase` distingue une suppression (les
 * trois morceaux se partagent `baseStart/baseEnd` réels du texte de base) —
 * `false` pour un ajout (les trois morceaux restent à la même position,
 * ponctuelle, dans le texte de base : ce sont des insertions).
 *
 * Seul l'HÔTE (l'édition plus large qui a englouti le fragment) est jamais
 * scindé ici — jamais le candidat déjà autonome dont `core` est extrait : le
 * découper à son tour pour ne garder qu'un `core` strictement identique ne
 * ferait que fabriquer un second petit changement (un espace ou un saut de
 * ligne en bordure) là où le diff brut n'en avait produit aucun. La
 * correspondance EXACTE malgré ces espaces de bordure incidents reste
 * possible : `isMoveCandidate`/`detectMoves` (native-review-change-groups.ts)
 * comparent les deux côtés après un simple `.trim()`, jamais une tolérance
 * plus large.
 */
function splitPureEdit(edit: ComparisonEdit, offset: number, core: string, atBase: boolean): ComparisonEdit[] {
  const whole = atBase ? edit.oldText : edit.newText;
  const lead = whole.slice(0, offset);
  const trail = whole.slice(offset + core.length);
  const piece = (text: string, pieceOffset: number): ComparisonEdit => atBase
    ? { baseStart: edit.baseStart + pieceOffset, baseEnd: edit.baseStart + pieceOffset + text.length, oldText: text, newText: "" }
    : { baseStart: edit.baseStart, baseEnd: edit.baseEnd, oldText: "", newText: text };
  const pieces: ComparisonEdit[] = [];
  if (lead) pieces.push(piece(lead, 0));
  pieces.push(piece(core, lead.length));
  if (trail) pieces.push(piece(trail, lead.length + core.length));
  return pieces;
}

/**
 * Isole, pour chaque suppression pure et significative de `edits`, son texte
 * exact s'il est englouti dans un ajout pur plus large ailleurs dans la
 * liste — jamais l'inverse ici (voir `isolateAdditionsAgainstDeletions` pour
 * le sens symétrique).
 */
function isolateDeletionsAgainstAdditions(edits: ComparisonEdit[], base: string, changed: string): ComparisonEdit[] {
  let working = edits;
  for (const candidate of edits) {
    if (candidate.newText !== "") continue;
    const { core } = splitEdgeWhitespace(candidate.oldText);
    if (!significantMoveText(core)) continue;
    if (findWordBoundaryOccurrences(base, core).length !== 1) continue;
    const hits = findWordBoundaryOccurrences(changed, core);
    if (hits.length !== 1) continue;
    const at = hits[0];
    const starts = comparisonRightOffsets(working);
    // `.trim() !== core`, jamais `!== core` : un hôte qui EST déjà `core` à
    // un espace de bordure près (voir moveKey) n'a rien à isoler — le
    // scinder fabriquerait ce même résidu de bordure que la comparaison en
    // aval sait déjà tolérer. Seul un hôte portant un contenu supplémentaire
    // RÉEL (pas seulement une bordure blanche) doit être scindé.
    const hostIndex = working.findIndex((edit, i) => edit.oldText === "" && edit.newText.trim() !== core && at >= starts[i] && at + core.length <= starts[i] + edit.newText.length);
    if (hostIndex === -1) continue;
    const host = working[hostIndex];
    const offset = at - starts[hostIndex];
    if (host.newText.slice(offset, offset + core.length) !== core) continue;
    working = replaceEditAt(working, hostIndex, splitPureEdit(host, offset, core, false));
  }
  return working;
}

/** Symétrique de `isolateDeletionsAgainstAdditions` : isole un ajout pur et
 * significatif englouti dans une suppression plus large ailleurs. */
function isolateAdditionsAgainstDeletions(edits: ComparisonEdit[], base: string, changed: string): ComparisonEdit[] {
  let working = edits;
  for (const candidate of edits) {
    if (candidate.oldText !== "") continue;
    const { core } = splitEdgeWhitespace(candidate.newText);
    if (!significantMoveText(core)) continue;
    if (findWordBoundaryOccurrences(changed, core).length !== 1) continue;
    const hits = findWordBoundaryOccurrences(base, core);
    if (hits.length !== 1) continue;
    const at = hits[0];
    const hostIndex = working.findIndex((edit) => edit.newText === "" && edit.oldText.trim() !== core && at >= edit.baseStart && at + core.length <= edit.baseEnd);
    if (hostIndex === -1) continue;
    const host = working[hostIndex];
    const offset = at - host.baseStart;
    if (host.oldText.slice(offset, offset + core.length) !== core) continue;
    working = replaceEditAt(working, hostIndex, splitPureEdit(host, offset, core, true));
  }
  return working;
}

/** Les deux sens sont indépendants (ils ciblent des natures d'édition
 * disjointes — pure suppression vs pur ajout) : les enchaîner suffit,
 * chacun voit le résultat de l'autre pour les cas doublement englobés. */
function isolateMovedFragments(edits: ComparisonEdit[], base: string, changed: string): ComparisonEdit[] {
  return isolateAdditionsAgainstDeletions(isolateDeletionsAgainstAdditions(edits, base, changed), base, changed);
}

/** Position de chaque édition dans le texte de droite. Les éditions sont
 * ordonnées et disjointes en coordonnées de base : le décalage cumulé suffit,
 * aucune recherche floue n'est tentée. */
export function comparisonRightOffsets(edits: Array<Pick<ComparisonEdit, "baseStart" | "oldText" | "newText">>): number[] {
  const offsets: number[] = []; let delta = 0;
  for (const edit of edits) { offsets.push(edit.baseStart + delta); delta += edit.newText.length - edit.oldText.length; }
  return offsets;
}

/** Un déplacement se lit à sa destination dans le texte de droite : à son
 * origine, il n'y a précisément plus rien à montrer. */
export function comparisonRightAnchor(group: Pick<NativeReviewChangeGroup, "kind" | "changeIndexes">, edits: Array<Pick<ComparisonEdit, "oldText">>, offsets: number[]): number {
  const anchor = group.kind === "move" ? group.changeIndexes.find((index) => !edits[index]?.oldText) ?? group.changeIndexes[0] : group.changeIndexes[0];
  return offsets[anchor];
}

export type ComparisonChangeKind = NativeReviewChangeGroup["kind"];

export interface ComparisonChange {
  index: number;
  kind: ComparisonChangeKind;
  /** Coordonnées dans le fichier de gauche, absentes si le passage a bougé de son côté. */
  leftStart?: number;
  leftEnd?: number;
  rightStart: number;
  rightEnd: number;
  oldText: string;
  newText: string;
  /** Vrai quand l'action peut écrire seule dans le fichier de gauche. */
  applicable: boolean;
  /** Déjà décidé : le changement reste visible, mais n'attend plus rien. */
  handled: boolean;
  /** Le texte de gauche porte déjà cette proposition (relecture uniquement). */
  alreadyApplied?: boolean;
  /** Clés de décision côté relecture ; vide pour un snapshot. */
  changeIndexes: number[];
  /** Point d'insertion de la destination, en coordonnées du texte de GAUCHE
   * (jamais celles, déjà décalées, de `rightStart`) — présent uniquement
   * pour un déplacement. Nécessaire pour restaurer un couper/coller comme
   * un déplacement : `leftStart/leftEnd` seuls ne décrivent que l'origine à
   * supprimer, jamais où réinsérer le passage. */
  moveTo?: { start: number; end: number };
}

/**
 * Comparaison à deux textes (Snapshots) : le texte de gauche EST la base, ses
 * coordonnées sont donc exactes et chaque différence est toujours applicable.
 * La relecture, elle, part d'une analyse à trois textes et fournit ses propres
 * ComparisonChange (voir native-review-work.ts).
 */
export function comparisonChanges(left: string, right: string): ComparisonChange[] {
  const edits = comparisonEdits(left, right);
  const groups = groupNativeReviewChanges("comparison", edits.map((edit) => ({ ...edit, currentStart: edit.baseStart, currentEnd: edit.baseEnd, confidence: "safe" as const })), left, left);
  const offsets = comparisonRightOffsets(edits);
  return groups.map((group, index) => {
    const rightStart = comparisonRightAnchor(group, edits, offsets);
    return {
      index, kind: group.kind,
      leftStart: group.currentStart ?? group.baseStart, leftEnd: group.currentEnd ?? group.baseEnd,
      rightStart, rightEnd: rightStart + group.newText.length,
      oldText: group.oldText, newText: group.newText,
      applicable: true, handled: false, changeIndexes: group.changeIndexes,
      ...(group.moveTo ? { moveTo: { start: group.moveTo.baseStart, end: group.moveTo.baseEnd } } : {}),
    };
  });
}

/* Il n'y a plus de découpage du texte en segments : la comparaison ne rend
   jamais le texte. Les deux côtés sont de vraies vues Markdown d'Obsidian, et
   les positions ci-dessus servent uniquement à poser des décorations
   par-dessus (voir comparison-plan.ts). */

/** Changement suivant qui attend encore une décision, en repartant du début. */
export function nextPendingComparisonChange(changes: ComparisonChange[], from: number | null): number | null {
  const pending = changes.filter((change) => !change.handled);
  if (!pending.length) return null;
  const after = pending.find((change) => from === null || change.index > from);
  return (after ?? pending[0]).index;
}

export function adjacentComparisonChange(changes: ComparisonChange[], from: number | null, direction: -1 | 1): number | null {
  const pending = changes.filter((change) => !change.handled);
  if (!pending.length) return null;
  if (from === null) return direction === 1 ? pending[0].index : pending[pending.length - 1].index;
  const position = pending.findIndex((change) => change.index === from);
  if (position === -1) return direction === 1 ? pending.find((change) => change.index > from)?.index ?? null : [...pending].reverse().find((change) => change.index < from)?.index ?? null;
  return pending[position + direction]?.index ?? null;
}
