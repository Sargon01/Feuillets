import { t } from "../i18n/index.js";
import type { ComparisonChange } from "./comparison-model.js";

/**
 * Traduction d'une comparaison en décorations, sans jamais toucher au texte.
 *
 * Règle d'architecture : la comparaison ne rend jamais le texte. Les deux
 * côtés sont de vraies vues Markdown d'Obsidian ; ce module ne produit que la
 * description de ce qu'il faut poser PAR-DESSUS. Rien ici ne connaît le DOM
 * ni CodeMirror.
 *
 * Convention définitive, la même dans tous les modes :
 *
 *     GAUCHE = AVANT      DROITE = APRÈS
 *
 * Grammaire visuelle UNIVERSELLE — strictement la même en Snapshot et en
 * Relecture, seules les actions métier changent :
 *
 *     rouge barré + […] = parti          (suppression)
 *     [+] + vert         = arrivé        (ajout)
 *     rouge → vert        = remplacé     (remplacement)
 *     ligne pointillée + DÉPLACÉ ↑/↓ = couper/coller (jamais suppression+ajout)
 *
 * Une différence n'est jamais réduite à un vide : quand un côté n'a rien de
 * réel à montrer, un petit repère cliquable ([…] ou [+]) matérialise quand
 * même le changement à cet endroit — jamais dupliqué, jamais un fantôme du
 * texte de l'autre côté, jamais une cale.
 */

export type ComparisonMode = "native-review" | "snapshot";

/** Les deux colonnes, dans l'ordre de lecture. Cet ordre ne change jamais. */
export type ComparisonColumn = "before" | "after";

/**
 * Lequel des deux documents porte l'état AVANT.
 *
 * Le moteur de diff base toujours ses coordonnées sur le vrai fichier de
 * l'auteur (`leftStart/leftEnd`, `oldText`) et exprime la variante en face
 * (`rightStart/rightEnd`, `newText`). Mais selon le mode, ce vrai fichier
 * n'occupe pas la même place dans le temps :
 * - relecture : le texte de l'auteur est l'AVANT, la proposition est l'APRÈS ;
 * - snapshot : le snapshot est l'AVANT, le fichier actuel est l'APRÈS.
 *
 * C'est la seule bascule du module. Elle ne touche pas à la convention
 * d'affichage, qui reste gauche = avant, droite = après.
 */
export type ComparisonRole = "source" | "compared";
export function comparisonBeforeRole(mode: ComparisonMode): ComparisonRole {
  return mode === "snapshot" ? "compared" : "source";
}

/** Une note du relecteur, déjà résolue en positions du document comparé. */
export interface ComparisonNoteSpan { index: number; start: number; end: number; }

export type ComparisonActionName = "apply" | "ignore" | "restore";
export interface ComparisonActionButton { action: ComparisonActionName; text: string; cta: boolean; }

export type ComparisonDecoration =
  /** Passage marqué dans le texte réel — jamais un texte réécrit. */
  | { type: "mark"; from: number; to: number; class: string; role: "change" | "note"; index: number }
  /** Repère ponctuel cliquable : libellé de déplacement, ligne pointillée
   * d'origine, ou placeholder […] / [+] d'une suppression/ajout sans texte
   * de ce côté. Jamais une copie du texte réel — un simple point d'ancrage. */
  | { type: "label"; at: number; side: -1 | 1; class: string; text: string; index: number }
  /** Cartouche de décision du changement sélectionné. */
  | { type: "actions"; at: number; index: number; label: string; hint: string | null; buttons: ComparisonActionButton[] };

export interface ComparisonPlan { before: ComparisonDecoration[]; after: ComparisonDecoration[]; }

export interface ComparisonPlanInput {
  mode: ComparisonMode;
  changes: ComparisonChange[];
  notes: ComparisonNoteSpan[];
  activeIndex: number | null;
  /** Snapshot ouvert en lecture seule : on regarde, on ne restaure pas. */
  allowRestore?: boolean;
}

/**
 * Où vit un passage dans une colonne. `start`/`end` sont absents quand ce
 * document n'a pas de coordonnées connues — en relecture, quand l'auteur a
 * lui-même remanié ce passage de son côté.
 */
export interface ComparisonPlacement { start?: number; end?: number; text: string }

/** Répartit un changement entre les deux colonnes, dans l'ordre de lecture. */
export function comparisonPlacements(change: ComparisonChange, mode: ComparisonMode): Record<ComparisonColumn, ComparisonPlacement> {
  const source: ComparisonPlacement = { start: change.leftStart, end: change.leftEnd, text: change.oldText };
  const compared: ComparisonPlacement = { start: change.rightStart, end: change.rightEnd, text: change.newText };
  return comparisonBeforeRole(mode) === "source" ? { before: source, after: compared } : { before: compared, after: source };
}

const occupied = (placement: ComparisonPlacement): boolean =>
  placement.start !== undefined && placement.end !== undefined && placement.end > placement.start;

/**
 * Union discriminée du TYPE VISUEL d'un changement : ce que le lecteur voit,
 * toujours dans le sens avant → après — jamais le mécanisme interne du
 * moteur. En snapshot, un passage qui n'existe que dans le snapshot a
 * DISPARU depuis : c'est visuellement une suppression, même si le moteur,
 * qui part du fichier actuel, l'a produit comme un ajout. Un déplacement
 * porte sa direction (`up`/`down`) — jamais confondu avec une suppression ou
 * un ajout, quel que soit le mode.
 */
export type ComparisonMoveDirection = "up" | "down";
export type ComparisonVisualKind =
  | { kind: "addition" }
  | { kind: "deletion" }
  | { kind: "replacement" }
  | { kind: "move"; direction: ComparisonMoveDirection };

/**
 * Direction d'un déplacement : compare la position d'origine (AVANT) à la
 * position d'arrivée (APRÈS), toutes deux déjà exprimées par le moteur dans
 * des repères directement comparables (`leftStart`/`rightStart`, où
 * `rightStart` est `baseStart` décalé du cumul des éditions précédentes —
 * donc une estimation de position dans le même document). Un résultat
 * « brut » se lit dans le sens du moteur (gauche→droite) ; il est retourné
 * tel quel en relecture (avant=source=gauche), et inversé en snapshot
 * (avant=comparé=droite) pour rester fidèle au sens de lecture affiché.
 */
function moveDirection(change: Pick<ComparisonChange, "leftStart" | "rightStart">, mode: ComparisonMode): ComparisonMoveDirection {
  const raw: ComparisonMoveDirection = change.rightStart >= (change.leftStart ?? change.rightStart) ? "down" : "up";
  if (comparisonBeforeRole(mode) !== "compared") return raw;
  return raw === "down" ? "up" : "down";
}

export function resolveComparisonVisualKind(change: Pick<ComparisonChange, "kind" | "leftStart" | "rightStart">, mode: ComparisonMode): ComparisonVisualKind {
  if (change.kind === "move") return { kind: "move", direction: moveDirection(change, mode) };
  if (change.kind === "replacement") return { kind: "replacement" };
  const flipped = comparisonBeforeRole(mode) === "compared";
  if (change.kind === "addition") return { kind: flipped ? "deletion" : "addition" };
  return { kind: flipped ? "addition" : "deletion" };
}

/**
 * Étiquette éditoriale d'une différence, jamais son mécanisme interne — et
 * toujours dans le sens avant → après. Reste générique pour un déplacement
 * (« Déplacement ») ; le cartouche, lui, affiche la variante directionnelle
 * (« Déplacé ↑/↓ », voir `actionsFor`) — jamais « Ajout » ni « Suppression »
 * pour un déplacement.
 */
export function comparisonChangeLabel(change: Pick<ComparisonChange, "kind">, mode: ComparisonMode = "native-review"): string {
  const flipped = comparisonBeforeRole(mode) === "compared";
  const kind = flipped && (change.kind === "addition" || change.kind === "deletion")
    ? (change.kind === "addition" ? "deletion" : "addition")
    : change.kind;
  return t(kind === "addition" ? "nativeReview.change.addition"
    : kind === "deletion" ? "nativeReview.change.deletion"
    : kind === "move" ? "nativeReview.change.move" : "nativeReview.change.replacement");
}

function stateClasses(change: ComparisonChange, active: boolean): string {
  return `${change.handled ? " is-handled" : ""}${active ? " is-active" : ""}`;
}

/** Dix tirets espacés : la « ligne pointillée discrète » de l'ancien
 * emplacement d'un déplacement — jamais un vrai widget de règle, une simple
 * chaîne, pour rester un `label` ordinaire (cliquable, double-cliquable,
 * comme tout le reste). Purement symbolique : aucune traduction nécessaire. */
const DASH_LINE = "- - - - - - - - - -";
function moveDashesText(direction: ComparisonMoveDirection): string {
  return direction === "down" ? `${DASH_LINE} ↓` : `↑ ${DASH_LINE}`;
}
function movedLabelText(direction: ComparisonMoveDirection, count: number): string {
  return t(direction === "down" ? "comparison.movedDown" : "comparison.movedUp", { count: String(count) });
}

/**
 * Décorations d'un changement — une seule grammaire, universelle :
 * - remplacement : ancien rouge barré à l'AVANT, nouveau vert à l'APRÈS ;
 * - suppression (visuelle) : rouge barré à l'AVANT, `[…]` rouge à l'APRÈS —
 *   jamais un vide ;
 * - ajout (visuel) : `[+]` vert à l'AVANT, vert à l'APRÈS — jamais un vide ;
 * - déplacement : le texte reste normal des deux côtés (accent discret,
 *   jamais rouge ni vert — un couper/coller n'est ni une suppression ni un
 *   ajout) ; une ligne pointillée `↑/↓` matérialise l'origine, un libellé
 *   « Déplacé N ↑/↓ » matérialise la destination, le même numéro des deux
 *   côtés.
 *
 * Aucun fantôme, aucune cale, aucune duplication du texte réel.
 */
function decorate(change: ComparisonChange, active: boolean, mode: ComparisonMode, visual: ComparisonVisualKind, moveNumber: number | null): ComparisonPlan {
  const plan: ComparisonPlan = { before: [], after: [] };
  const placement = comparisonPlacements(change, mode);
  const suffix = stateClasses(change, active);
  const index = change.index;

  if (visual.kind === "move") {
    if (occupied(placement.before)) plan.before.push({ type: "mark", from: placement.before.start!, to: placement.before.end!, class: `cm-comparison-move-origin${suffix}`, role: "change", index });
    if (occupied(placement.after)) plan.after.push({ type: "mark", from: placement.after.start!, to: placement.after.end!, class: `cm-comparison-move-destination${suffix}`, role: "change", index });
    if (moveNumber !== null) {
      if (placement.before.end !== undefined) plan.before.push({ type: "label", at: placement.before.end, side: 1, class: `cm-comparison-move-dashes${suffix}`, text: moveDashesText(visual.direction), index });
      if (placement.after.start !== undefined) plan.after.push({ type: "label", at: placement.after.start, side: -1, class: `cm-comparison-move-label${suffix}`, text: movedLabelText(visual.direction, moveNumber), index });
    }
    return plan;
  }

  const beforeOccupied = occupied(placement.before);
  const afterOccupied = occupied(placement.after);
  if (beforeOccupied) plan.before.push({ type: "mark", from: placement.before.start!, to: placement.before.end!, class: `cm-comparison-gone${suffix}`, role: "change", index });
  else if (placement.before.start !== undefined) plan.before.push({ type: "label", at: placement.before.start, side: 1, class: `cm-comparison-placeholder cm-comparison-tone-arrived${suffix}`, text: "[+]", index });
  if (afterOccupied) plan.after.push({ type: "mark", from: placement.after.start!, to: placement.after.end!, class: `cm-comparison-arrived${suffix}`, role: "change", index });
  else if (placement.after.start !== undefined) plan.after.push({ type: "label", at: placement.after.start, side: 1, class: `cm-comparison-placeholder cm-comparison-tone-gone${suffix}`, text: "[…]", index });
  return plan;
}

/**
 * Cartouche du changement sélectionné : le type et l'unique décision.
 * Toujours ancré à l'APRÈS — jamais à l'AVANT, verrouillé en lecture seule
 * pour Snapshot depuis que le vrai fichier y est affiché à droite. C'est ce
 * qui garantit que le contrôle d'écriture vit toujours à côté du document
 * réellement modifiable, quel que soit le mode. Rien n'est proposé tant
 * qu'aucun changement n'est choisi : jamais de bandeau d'actions permanent.
 */
function actionsFor(input: ComparisonPlanInput, change: ComparisonChange, visual: ComparisonVisualKind, moveNumber: number | null): { column: "after"; decoration: ComparisonDecoration } | null {
  const placement = comparisonPlacements(change, input.mode);
  const at = placement.after.end ?? placement.after.start;
  if (at === undefined) return null;
  const label = visual.kind === "move" ? movedLabelText(visual.direction, moveNumber ?? 1) : comparisonChangeLabel(change, input.mode);
  const base = { type: "actions" as const, at, index: change.index, label };
  if (change.handled) return { column: "after", decoration: { ...base, hint: t("comparison.alreadyHandled"), buttons: [] } };
  if (input.mode === "native-review") {
    const buttons: ComparisonActionButton[] = [];
    if (change.applicable) buttons.push({ action: "apply", text: t(change.alreadyApplied ? "nativeReview.action.markApplied" : "nativeReview.action.apply"), cta: true });
    if (!change.alreadyApplied) buttons.push({ action: "ignore", text: t("nativeReview.action.ignore"), cta: false });
    return { column: "after", decoration: { ...base, hint: change.applicable ? null : t("nativeReview.compare.manualOnly"), buttons } };
  }
  const buttons: ComparisonActionButton[] = input.allowRestore === false ? [] : [{ action: "restore", text: t("comparison.restorePassage"), cta: true }];
  return { column: "after", decoration: { ...base, hint: null, buttons } };
}

export function comparisonPlan(input: ComparisonPlanInput): ComparisonPlan {
  const plan: ComparisonPlan = { before: [], after: [] };
  // Numérotation stable des déplacements, dans l'ordre du document : c'est
  // l'identifiant partagé qu'on lit des deux côtés (« Déplacé 2 ↓ » à la
  // destination, la même ligne pointillée numérotée implicitement à l'origine
  // via data-comparison-change).
  let moves = 0;
  for (const change of input.changes) {
    const active = change.index === input.activeIndex;
    const visual = resolveComparisonVisualKind(change, input.mode);
    const number = visual.kind === "move" ? (moves += 1) : null;
    const decorations = decorate(change, active, input.mode, visual, number);
    plan.before.push(...decorations.before);
    plan.after.push(...decorations.after);
    if (!active) continue;
    const actions = actionsFor(input, change, visual, number);
    if (actions) plan[actions.column].push(actions.decoration);
  }
  // Les notes sont ancrées dans le document comparé : elles suivent la
  // colonne où celui-ci est affiché, jamais une position fixe.
  const notesColumn: ComparisonColumn = comparisonBeforeRole(input.mode) === "compared" ? "before" : "after";
  for (const note of input.notes) {
    if (note.end <= note.start) continue;
    plan[notesColumn].push({ type: "mark", from: note.start, to: note.end, class: "cm-comparison-note", role: "note", index: note.index });
  }
  return plan;
}

/**
 * Les changements sont exprimés sans frontmatter ; l'éditeur, lui, l'affiche.
 * Décale toutes les positions et écarte celles qui ne tiennent pas dans le
 * document réel : une décoration hors texte n'est jamais inventée.
 */
export function shiftComparisonDecorations(decorations: ComparisonDecoration[], shift: number, docLength: number): ComparisonDecoration[] {
  const inside = (position: number): boolean => Number.isSafeInteger(position) && position >= 0 && position <= docLength;
  const out: ComparisonDecoration[] = [];
  for (const decoration of decorations) {
    if (decoration.type === "mark") {
      const from = decoration.from + shift; const to = decoration.to + shift;
      if (to > from && inside(from) && inside(to)) out.push({ ...decoration, from, to });
      continue;
    }
    const at = decoration.at + shift;
    if (inside(at)) out.push({ ...decoration, at });
  }
  return out;
}
