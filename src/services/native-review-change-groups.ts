/** Projection pure des micro-diffs vers une décision éditoriale lisible. */
export interface NativeReviewChangeLike {
  baseStart: number; baseEnd: number; currentStart?: number; currentEnd?: number;
  oldText: string; newText: string; confidence: "safe" | "review" | "ambiguous"; reason?: string;
}
export interface NativeReviewChangeGroup {
  documentId: string; changeIndexes: number[]; baseStart: number; baseEnd: number;
  currentStart?: number; currentEnd?: number; kind: "addition" | "deletion" | "replacement" | "move";
  oldText: string; newText: string; confidence: "safe" | "review" | "ambiguous";
  moveFrom?: { baseStart: number; baseEnd: number; currentStart?: number; currentEnd?: number; context: string };
  moveTo?: { baseStart: number; baseEnd: number; currentStart?: number; currentEnd?: number; context: string };
}

function kind(change: NativeReviewChangeLike): NativeReviewChangeGroup["kind"] { return !change.oldText ? "addition" : !change.newText ? "deletion" : "replacement"; }
function between(a: NativeReviewChangeLike, b: NativeReviewChangeLike, base: string, current?: string): string | null {
  if (a.baseEnd > b.baseStart || b.baseStart - a.baseEnd > 24) return null;
  const text = base.slice(a.baseEnd, b.baseStart);
  if (current !== undefined && a.currentEnd !== undefined && b.currentStart !== undefined && current.slice(a.currentEnd, b.currentStart) !== text) return null;
  return text.includes("\n") ? null : text;
}

const MOVE_MIN_CHARACTERS = 24;
const MOVE_MIN_WORDS = 4;
/** Seuil unique de signifiance d'un déplacement, partagé par `isMoveCandidate`
 * ici et par la normalisation du diff brut (`comparison-model.ts`) qui isole
 * un fragment déplacé AVANT ce regroupement — jamais un second seuil qui
 * pourrait diverger. */
export function significantMoveText(text: string): boolean {
  return text.length >= MOVE_MIN_CHARACTERS && (text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0) >= MOVE_MIN_WORDS;
}

/**
 * Clé de correspondance d'un déplacement : un simple `.trim()`, jamais une
 * tolérance plus large. Le diff brut attribue parfois un espace ou un saut de
 * ligne de bordure (frontière arbitraire entre deux découpages également
 * valides) à UN SEUL des deux côtés d'un couper/coller — la normalisation en
 * amont (`comparison-model.ts#isolateMovedFragments`) isole alors le
 * fragment déplacé exactement sans jamais retoucher ce bord-là. Comparer
 * après `.trim()` absorbe cet artefact de frontière sans jamais tolérer une
 * différence de CONTENU : deux textes qui diffèrent ailleurs qu'à leurs
 * extrémités blanches restent deux clés distinctes.
 */
function moveKey(text: string): string { return text.trim(); }

/**
 * Un changement brut qui, seul, formerait déjà un couper/coller reconnaissable
 * par `detectMoves` (texte significatif, une seule suppression ET un seul
 * ajout de ce texte exact — à l'espace de bordure près, voir `moveKey` — dans
 * tout le document ; le même critère, appliqué ici avant tout regroupement
 * plutôt qu'après). Sert uniquement à protéger son isolement : un ajout
 * indépendant tout proche ne doit jamais l'avaler dans un groupe à plusieurs
 * membres, ce qui le rendrait invisible à `detectMoves` (qui n'examine que
 * les groupes à un seul membre). Ne change rien d'autre : un changement
 * réellement ambigu (texte répété, trop court) ne passe pas ce test et
 * continue de se regrouper normalement.
 *
 * Toujours nécessaire même après la normalisation du diff brut
 * (`comparison-model.ts#isolateMovedFragments`, qui isole déjà un fragment
 * englouti dans une édition plus large) : cette normalisation ne fait
 * qu'ISOLER le fragment comme édition à lui seul dans la liste — sans cette
 * protection-ci, `groupNativeReviewChanges` le RE-fusionnerait aussitôt avec
 * son voisin adjacent (même `between()` qui l'aurait fusionné avant la
 * normalisation). Vérifié : retirer `isolateForMove` fait échouer la
 * reconnaissance du déplacement sur un vrai couper/coller malgré la
 * normalisation en amont — les deux étapes sont complémentaires, pas
 * redondantes.
 */
function isMoveCandidate(change: NativeReviewChangeLike, changes: NativeReviewChangeLike[]): boolean {
  const text = kind(change) === "deletion" ? change.oldText : kind(change) === "addition" ? change.newText : "";
  const key = moveKey(text);
  if (!key || !significantMoveText(key)) return false;
  const rawDeletionCount = changes.filter((candidate) => candidate.newText === "" && moveKey(candidate.oldText) === key).length;
  const rawAdditionCount = changes.filter((candidate) => candidate.oldText === "" && moveKey(candidate.newText) === key).length;
  return rawDeletionCount === 1 && rawAdditionCount === 1;
}
function contextAt(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - 48), start).replace(/\s+/g, " ").trim();
  const after = text.slice(end, Math.min(text.length, end + 48)).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${before}${before && after ? " […] " : ""}${after}${end < text.length ? "…" : ""}`;
}

/** Pairs only an exact, significant and unique deletion/addition pair. */
function detectMoves(groups: NativeReviewChangeGroup[], changes: NativeReviewChangeLike[], base: string, current?: string): NativeReviewChangeGroup[] {
  const deletions = new Map<string, NativeReviewChangeGroup[]>(); const additions = new Map<string, NativeReviewChangeGroup[]>();
  for (const group of groups) {
    const text = group.kind === "deletion" ? group.oldText : group.kind === "addition" ? group.newText : "";
    const key = moveKey(text);
    if (!key || group.changeIndexes.length !== 1 || !significantMoveText(key)) continue;
    const rawDeletionCount = changes.filter((change) => change.newText === "" && moveKey(change.oldText) === key).length; const rawAdditionCount = changes.filter((change) => change.oldText === "" && moveKey(change.newText) === key).length;
    if (rawDeletionCount !== 1 || rawAdditionCount !== 1) continue;
    const target = group.kind === "deletion" ? deletions : additions; target.set(key, [...(target.get(key) ?? []), group]);
  }
  const pairs = new Map<NativeReviewChangeGroup, NativeReviewChangeGroup>();
  for (const [key, removed] of deletions) { const inserted = additions.get(key) ?? []; if (removed.length === 1 && inserted.length === 1) { pairs.set(removed[0], inserted[0]); pairs.set(inserted[0], removed[0]); } }
  const emitted = new Set<NativeReviewChangeGroup>(); const result: NativeReviewChangeGroup[] = [];
  for (const group of groups) {
    const peer = pairs.get(group); if (!peer) { result.push(group); continue; }
    if (emitted.has(group) || emitted.has(peer)) continue;
    const deletion = group.kind === "deletion" ? group : peer; const addition = group.kind === "addition" ? group : peer;
    const fromText = current ?? base; const fromStart = deletion.currentStart ?? deletion.baseStart; const fromEnd = deletion.currentEnd ?? deletion.baseEnd;
    const toText = current ?? base; const toStart = addition.currentStart ?? addition.baseStart; const toEnd = addition.currentEnd ?? addition.baseEnd;
    result.push({
      documentId: group.documentId, changeIndexes: [...deletion.changeIndexes, ...addition.changeIndexes].sort((a, b) => a - b),
      baseStart: Math.min(deletion.baseStart, addition.baseStart), baseEnd: Math.max(deletion.baseEnd, addition.baseEnd),
      ...(deletion.currentStart !== undefined && deletion.currentEnd !== undefined ? { currentStart: deletion.currentStart, currentEnd: deletion.currentEnd } : {}),
      // Chaque côté garde SON texte réel (peut différer d'un espace de bordure
      // incident — voir moveKey) : jamais le texte de l'un imposé à l'autre.
      kind: "move", oldText: deletion.oldText, newText: addition.newText,
      confidence: deletion.confidence === "ambiguous" || addition.confidence === "ambiguous" ? "ambiguous" : deletion.confidence === "review" || addition.confidence === "review" ? "review" : "safe",
      moveFrom: { baseStart: deletion.baseStart, baseEnd: deletion.baseEnd, ...(deletion.currentStart !== undefined ? { currentStart: deletion.currentStart } : {}), ...(deletion.currentEnd !== undefined ? { currentEnd: deletion.currentEnd } : {}), context: contextAt(fromText, fromStart, fromEnd) },
      moveTo: { baseStart: addition.baseStart, baseEnd: addition.baseEnd, ...(addition.currentStart !== undefined ? { currentStart: addition.currentStart } : {}), ...(addition.currentEnd !== undefined ? { currentEnd: addition.currentEnd } : {}), context: contextAt(toText, toStart, toEnd) },
    });
    emitted.add(group); emitted.add(peer);
  }
  return result;
}

export function groupNativeReviewChanges(documentId: string, changes: NativeReviewChangeLike[], baseMarkdown: string, currentMarkdown?: string): NativeReviewChangeGroup[] {
  const groups: NativeReviewChangeGroup[] = [];
  let indexes: number[] = []; let members: NativeReviewChangeLike[] = []; let gaps: string[] = [];
  const flush = (): void => {
    if (!members.length) return;
    const first = members[0]; const last = members[members.length - 1];
    groups.push({ documentId, changeIndexes: indexes, baseStart: first.baseStart, baseEnd: last.baseEnd,
      ...(first.currentStart !== undefined && last.currentEnd !== undefined ? { currentStart: first.currentStart, currentEnd: last.currentEnd } : {}),
      kind: members.some((x) => kind(x) !== kind(first)) ? "replacement" : kind(first),
      oldText: members.map((x, i) => `${i ? gaps[i - 1] : ""}${x.oldText}`).join(""),
      newText: members.map((x, i) => `${i ? gaps[i - 1] : ""}${x.newText}`).join(""),
      confidence: members.some((x) => x.confidence === "ambiguous") ? "ambiguous" : members.some((x) => x.confidence === "review") ? "review" : "safe" });
    indexes = []; members = []; gaps = [];
  };
  changes.forEach((change, index) => {
    const previous = members[members.length - 1]; const gap = previous ? between(previous, change, baseMarkdown, currentMarkdown) : null;
    // Un couper/coller reconnaissable (voir isMoveCandidate) ne fusionne
    // jamais avec son voisin, même adjacent : sinon un ajout indépendant tout
    // proche l'avale dans un groupe à plusieurs membres et detectMoves, plus
    // bas, ne le voit plus jamais (il n'examine que les groupes isolés).
    const isolateForMove = previous !== undefined && (isMoveCandidate(previous, changes) || isMoveCandidate(change, changes));
    if (previous && (gap === null || isolateForMove || previous.reason === "already-applied" || change.reason === "already-applied")) flush();
    if (members.length) gaps.push(gap!);
    members.push(change); indexes.push(index);
  });
  flush(); return detectMoves(groups, changes, baseMarkdown, currentMarkdown);
}
