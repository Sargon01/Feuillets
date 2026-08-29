import { EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { history, historyKeymap, redo, undo } from "@codemirror/commands";
import type { TFile } from "obsidian";
import { boundaryOffsets, type ScriveningsDocument } from "../services/scrivenings-document.js";
import { emptyLinesPlugin } from "./cm-empty-lines.js";
import { paragraphIndentPlugin } from "./cm-paragraph-indent.js";
import { createScriveningsMarkdownExtensions, createScriveningsToggleCommand, type ScriveningsImageResolver } from "./cm-scrivenings-markdown.js";
import { createParagraphReorderExtension } from "./cm-paragraph-reorder.js";

/**
 * Couche CodeMirror de Scrivenings (LOT 1 + micro-correctif 1.1) : le
 * retour à la ligne, les titres visuels de feuillet et le garde-fou de
 * frontière — seules choses que cette extension ajoute au texte composite.
 * Rien ici ne touche au Vault ni ne décide de la sauvegarde (voir
 * views/scrivenings-view.ts) ; ce module ne fait que rendre les feuillets
 * lisibles et leurs frontières infranchissables dans l'unique EditorView.
 *
 * Deux jeux d'offsets, volontairement séparés :
 * - `scriveningsBoundariesField` (nombres bruts) protège les JONCTIONS entre
 *   segments (`segment.to`, voir services/scrivenings-document.ts) — c'est
 *   ce que lit le garde-fou de transaction, inchangé depuis le lot 1 ;
 * - `scriveningsTitlesField` (specs {offset, title, divider}) porte les
 *   titres visuels, ancrés au DÉBUT de chaque segment (`segment.from`,
 *   premier segment compris) — une position différente, jamais protégée
 *   par le garde-fou (elle est éditable : c'est le tout début du corps).
 *
 * Même style que cm-comparison-decorations.ts : les types réels de
 * `@codemirror/*` sont fournis par Obsidian à l'exécution (voir
 * codemirror-runtime.d.ts, qui les déclare `unknown`) — on ne type ici que
 * le sous-ensemble effectivement utilisé, jamais un `any`.
 */

/* --- Typage local, réutilisé (jamais `any`) ----------------------------- */

type DecorationSet = { map(changes: unknown): DecorationSet };
type Range = { from: number; to?: number };
type EffectType<T> = { of(value: T): unknown };
type EffectInstance<T> = { value: T; is(type: unknown): boolean };
type FieldStatic = {
  define<T>(config: {
    create(): T;
    update(value: T, tr: TransactionLike): T;
    provide?: (field: unknown) => unknown;
  }): unknown;
};
type WidgetSpec = { widget: unknown; side?: number; block?: boolean };
type DecorationStatic = {
  none: DecorationSet;
  widget(spec: WidgetSpec): { range(from: number): Range };
  set(ranges: Range[], sort?: boolean): DecorationSet;
};
type FacetLike = { from(field: unknown, get?: (value: unknown) => unknown): unknown };
type ViewUpdateLike = { docChanged: boolean; changes: ChangesLike };
type KeymapBinding = {
  key?: string;
  mac?: string;
  win?: string;
  linux?: string;
  run: unknown;
  preventDefault?: boolean;
  stopPropagation?: boolean;
};
type KeymapFacet = { of(bindings: KeymapBinding[]): unknown };
type ViewStatic = {
  decorations: FacetLike;
  updateListener?: { of(fn: (update: ViewUpdateLike) => void): unknown };
  lineWrapping?: unknown;
  keymap?: KeymapFacet;
  domEventHandlers?: (handlers: { keydown(event: KeyboardEvent): boolean }) => unknown;
};
type PrecStatic = { highest(extension: unknown): unknown };
type ChangesLike = {
  mapPos(pos: number, assoc?: number): number;
  iterChanges(fn: (fromA: number, toA: number, fromB: number, toB: number, inserted: { toString(): string }) => void): void;
};
export type TransactionLike = {
  effects: EffectInstance<unknown>[];
  docChanged: boolean;
  changes: ChangesLike;
};
export type TransactionFilterInput = {
  startState: { field(field: unknown, required: false): unknown };
  changes: ChangesLike;
};
type StateStatic = { transactionFilter?: { of(fn: (tr: TransactionFilterInput) => unknown): unknown } };

const StateEffectTyped = StateEffect as { define<T>(): EffectType<T> };
const StateFieldTyped = StateField as FieldStatic;
const DecorationTyped = Decoration as DecorationStatic;
const EditorViewTyped = EditorView as ViewStatic;
const EditorStateTyped = EditorState as StateStatic;
const PrecTyped = Prec as PrecStatic;
const KeymapTyped = keymap as KeymapFacet;

interface WidgetTypeInstance {
  toDOM(): HTMLElement;
  eq(other: unknown): boolean;
  ignoreEvent(): boolean;
}
interface WidgetTypeStatic {
  new (): WidgetTypeInstance;
}
const WidgetTypeTyped = WidgetType as WidgetTypeStatic | undefined;
const BaseWidgetClass: WidgetTypeStatic =
  typeof WidgetTypeTyped === "function"
    ? WidgetTypeTyped
    : class implements WidgetTypeInstance {
        toDOM(): HTMLElement {
          return createDiv();
        }
        eq(): boolean {
          return true;
        }
        ignoreEvent(): boolean {
          return true;
        }
      };

/* --- Retour à la ligne ---------------------------------------------------- */

/** Extension publique CodeMirror : retour automatique à la ligne à la
 * largeur de l'éditeur — jamais de scroll horizontal pour du texte courant.
 * Un contenu réellement non cassable (URL très longue, bloc de code…) garde
 * son comportement natif : `lineWrapping` ne force rien, c'est le navigateur
 * qui décide où couper. `[]` en repli si le module CodeMirror n'expose pas
 * cette facette (cas des tests Node, jamais l'exécution réelle). */
export const scriveningsLineWrapping = EditorViewTyped.lineWrapping ?? [];

/* --- Undo/Redo (LOT 1.2) --------------------------------------------------- */

/** Historique CM6 PUBLIC (`@codemirror/commands`), jamais réimplémenté :
 * Scrivenings n'a aucun état d'annulation maison — cette seule extension
 * fournie par Obsidian à l'exécution pilote tout. Comme n'importe quelle
 * autre édition, une transaction d'annulation/rétablissement passe par
 * `scriveningsBoundaryGuard` (elle ne peut donc jamais fusionner deux
 * feuillets) puis par `scriveningsChangeListener` (elle marque donc le bon
 * segment dirty et suit le même pipeline de sauvegarde que n'importe quelle
 * frappe) — rien de spécifique à brancher ici. */
export const scriveningsHistory = history();

/** Raccourcis standards (`Cmd/Ctrl+Z`, `Cmd/Ctrl+Shift+Z`, et `Cmd/Ctrl+Y`
 * sous Windows/Linux) : le `historyKeymap` officiel de `@codemirror/commands`
 * tel quel, jamais des bindings maison — repli de PRÉCÉDENCE PAR DÉFAUT
 * (voir `scriveningsPriorityKeymap` ci-dessous pour le correctif Redo réel).
 * `[]` en repli si `EditorView.keymap` n'est pas exposé (cas des tests Node,
 * jamais l'exécution réelle — même garde que `scriveningsLineWrapping`
 * ci-dessus). */
export const scriveningsHistoryKeymap =
  typeof EditorViewTyped?.keymap?.of === "function" ? EditorViewTyped.keymap.of(historyKeymap as unknown as KeymapBinding[]) : [];

/* --- Titres visuels de feuillet -------------------------------------------- */

/** Rôle déjà connu de Feuillets pour un feuillet (`roleOfFile`,
 * services/folder-structure.ts) — jamais un second système de rôles inventé
 * ici. Seule la valeur EXACTE `"chapitre"` déclenche la respiration de
 * frontière élargie (voir `feuillets-scrivenings-title-role-chapitre`,
 * styles.css) ; toute autre valeur — `"scene"`, `null`/`undefined` (rôle
 * inconnu, ou callback non fourni), ou une chaîne quelconque — retombe sans
 * aucune exception sur le comportement compact existant (micro-chantier
 * finition Continu, §5/§11). */
export type ScriveningsSegmentRole = string | null | undefined;

export interface ScriveningsTitleSpec {
  /** Offset composite du DÉBUT du segment (`segment.from`) — jamais la
   * jonction elle-même : cette position reste pleinement éditable. */
  offset: number;
  /** Titre du feuillet qui COMMENCE à cet offset — jamais « A → B ». */
  title: string;
  /** Faux uniquement pour le tout premier segment du document : pas de
   * ligne de séparation au-dessus du tout premier titre. */
  divider: boolean;
  /** Rôle de CE feuillet (celui qui commence ici) — voir `ScriveningsSegmentRole`. */
  role: ScriveningsSegmentRole;
}

/** Widget non éditable portant le titre d'UN feuillet (et, sauf pour le
 * premier segment, une ligne de séparation au-dessus). Jamais du Markdown :
 * une simple décoration de bloc, jamais copiée avec le texte, jamais
 * atteinte par le curseur (`ignoreEvent`). `role` (§2-5 du micro-chantier
 * finition Continu) ne fait QUE choisir la classe CSS de respiration —
 * aucune règle de rôle, aucune donnée nouvelle : simple relais de
 * `ScriveningsTitleSpec.role`, déjà résolu ailleurs (roleOfFile). */
export class ScriveningsTitleWidget extends BaseWidgetClass {
  constructor(
    public readonly title: string,
    public readonly divider: boolean,
    public readonly role: ScriveningsSegmentRole = undefined
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const classes = ["feuillets-scrivenings-title"];
    if (this.divider) {
      classes.push("feuillets-scrivenings-title-divider");
      // Respiration élargie UNIQUEMENT pour un rôle "chapitre" confirmé —
      // jamais pour le tout premier segment (pas de `divider`), jamais pour
      // "scene"/inconnu/absent (repli compact, §5/§11 du micro-chantier).
      if (this.role === "chapitre") classes.push("feuillets-scrivenings-title-role-chapitre");
    }
    const el = createDiv({ cls: classes.join(" "), attr: { "aria-hidden": "true", contenteditable: "false" } });
    el.createSpan({ cls: "feuillets-scrivenings-title-text", text: this.title });
    return el;
  }

  eq(other: unknown): boolean {
    return (
      other instanceof ScriveningsTitleWidget &&
      other.title === this.title &&
      other.divider === this.divider &&
      other.role === this.role
    );
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Un titre par segment, PREMIER SEGMENT COMPRIS — jamais un libellé de
 * frontière combinant deux titres. `titleFor` doit déjà appliquer le repli
 * `shortTitleFor` puis `basename` (voir ScriveningsView) ; ce module ne
 * décide d'aucune logique de titre, il ne fait que la positionner. `roleFor`
 * (optionnel — repli `undefined`, donc compact, si omis : compatibilité des
 * appelants/tests antérieurs au micro-chantier finition Continu) suit le
 * même patron d'injection que `titleFor` : la RÉSOLUTION du rôle (roleOfFile)
 * reste entièrement hors de ce module, jamais un second système inventé
 * ici. */
export function scriveningsTitleSpecsFor(
  doc: ScriveningsDocument,
  titleFor: (file: TFile) => string,
  roleFor: (file: TFile) => ScriveningsSegmentRole = () => undefined
): ScriveningsTitleSpec[] {
  return doc.segments.map((segment, index) => ({
    offset: segment.from,
    title: titleFor(segment.file),
    divider: index > 0,
    role: roleFor(segment.file),
  }));
}

export const setScriveningsTitlesEffect = StateEffectTyped.define<ScriveningsTitleSpec[]>();

/** Champ des titres affichés : leurs offsets glissent avec les éditions,
 * comme n'importe quelle décoration, et sont remplacés d'un bloc par
 * `setScriveningsTitlesEffect` (voir `setScriveningsDecorations`). */
export const scriveningsTitlesField = StateFieldTyped.define<ScriveningsTitleSpec[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setScriveningsTitlesEffect)) return effect.value as ScriveningsTitleSpec[];
    }
    if (!tr.docChanged) return value;
    return value.map((spec) => ({ ...spec, offset: tr.changes.mapPos(spec.offset, -1) }));
  },
  provide: (field) =>
    EditorViewTyped.decorations.from(field, (specs) =>
      DecorationTyped.set(
        (specs as ScriveningsTitleSpec[]).map((spec) =>
          DecorationTyped.widget({ widget: new ScriveningsTitleWidget(spec.title, spec.divider, spec.role), side: -1, block: true }).range(spec.offset)
        ),
        true
      )
    ),
});

/* --- Garde-fou de frontière (inchangé depuis le lot 1) --------------------- */

export const setScriveningsBoundaryOffsetsEffect = StateEffectTyped.define<number[]>();

/** Champ unique portant les offsets de jonction courants — c'est la seule
 * chose que lit le garde-fou de transaction. Pure donnée : ne fournit
 * aucune décoration (les titres, eux, viennent de `scriveningsTitlesField`
 * ci-dessus, à des offsets différents). */
export const scriveningsBoundariesField = StateFieldTyped.define<number[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setScriveningsBoundaryOffsetsEffect)) return effect.value as number[];
    }
    if (!tr.docChanged) return value;
    return value.map((offset) => tr.changes.mapPos(offset, -1));
  },
});

/* --- Keymap Continu PRIORITAIRE (micro-lot 1.3.1) --------------------------
 *
 * CAUSE EXACTE du bug manuel (Cmd+I/Cmd+B inactifs, Cmd+Maj+Z inactif malgré
 * le correctif du lot 1.3) : ces trois bindings n'étaient montés qu'à la
 * précédence PAR DÉFAUT de CodeMirror (un `keymap.of([...])` ordinaire, comme
 * `scriveningsHistoryKeymap` ci-dessus). Or CodeMirror résout les conflits de
 * touches par PRÉCÉDENCE D'ABORD, ordre d'ajout ensuite — et Obsidian monte
 * ses propres commandes d'édition natives (dont Basculer gras / Basculer
 * italique, et son propre traitement de Cmd+Maj+Z) à une précédence qui
 * l'emporte sur un simple `keymap.of([...])` par défaut. Résultat : nos
 * bindings existaient bel et bien, mais n'étaient jamais consultés en
 * premier — Obsidian répondait avant nous (ou pas du tout, pour Cmd+Maj+Z).
 *
 * CORRECTIF : un keymap dédié, enveloppé dans `Prec.highest(...)` — l'API
 * PUBLIQUE de précédence de `@codemirror/state` — placé dans
 * `scriveningsExtensions` AVANT `scriveningsHistoryKeymap`. `Prec.highest`
 * garantit que ces trois bindings sont examinés avant absolument toute
 * autre source de keymap, y compris celles montées par Obsidian. Aucun
 * listener global (`window`/`document`), aucune API Hotkeys d'Obsidian :
 * uniquement `Prec` (état) + `keymap` (vue), les deux API publiques
 * demandées. `stopPropagation: true` s'ajoute à `preventDefault: true` sur
 * chacun de ces trois bindings pour qu'un ancêtre DOM ne voie plus jamais
 * l'événement une fois pris en charge ici.
 *
 * Les commandes Mod-i/Mod-b restent celles de cm-scrivenings-markdown.ts
 * (`createScriveningsToggleCommand`, contrat `Command` inchangé : elles
 * retournent toujours `true`) ; seul leur BRANCHEMENT change. `redo`/`undo`
 * restent les commandes PUBLIQUES de `@codemirror/commands`, jamais
 * réimplémentées ; `historyKeymap` (Mod-z, Mod-y…) reste monté intégralement
 * juste après, en repli — jamais retiré ni dupliqué.
 *
 * LOT 1.4 (§42-44) : `Mod-z` (Undo) souffrait EXACTEMENT de la même cause
 * que Mod-Shift-z avant ce lot — jamais monté à précédence prioritaire, donc
 * consultée après (voire jamais atteinte par) le traitement natif
 * d'Obsidian. Même correctif : `undo` PUBLIC rejoint ce même keymap
 * prioritaire, avec les mêmes protections `preventDefault`/`stopPropagation`.
 */
const scriveningsToggleEmphasisCommand = createScriveningsToggleCommand(scriveningsBoundariesField, "emphasis");
const scriveningsToggleStrongCommand = createScriveningsToggleCommand(scriveningsBoundariesField, "strong");

export const scriveningsPriorityKeymap =
  typeof KeymapTyped?.of === "function" && typeof PrecTyped?.highest === "function"
    ? PrecTyped.highest(
        KeymapTyped.of([
          { key: "Mod-i", run: scriveningsToggleEmphasisCommand, preventDefault: true, stopPropagation: true },
          { key: "Mod-b", run: scriveningsToggleStrongCommand, preventDefault: true, stopPropagation: true },
          { key: "Mod-z", run: undo, preventDefault: true, stopPropagation: true },
          { key: "Mod-Shift-z", run: redo, preventDefault: true, stopPropagation: true },
        ])
      )
    : [];

type ScriveningsEnterView = {
  state: {
    doc: { toString(): string };
    selection: { main: { empty: boolean; head: number } };
  };
  dispatch(spec: { changes: { from: number; to?: number; insert: string }; selection: { anchor: number } }): void;
};

type PendingParagraphBreak = {
  view: ScriveningsEnterView;
  position: number;
  document: { toString(): string };
};

function isExcludedFromScriveningsParagraphBreak(text: string, position: number): boolean {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  const lineEnd = text.indexOf("\n", position);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const structuralLine = /^(\s*([-*+]|\d+\.)\s|#{1,6}\s|>|```|---)/;
  const tableLine = /^\s*\|.*\|\s*$|^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+$|.*\|.*/;
  if (structuralLine.test(line) || tableLine.test(line)) return true;

  const frontmatter = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text);
  if (frontmatter && position < frontmatter[0].length) return true;

  const precedingLines = text.slice(0, lineStart).match(/^\s*```/gm) ?? [];
  return precedingLines.length % 2 === 1;
}

/** Typographie Entrée propre au seul EditorView de Continu. Les transactions
 * passent donc par le listener Scrivenings normal, sans modifier directement
 * un MarkdownView ni un fichier source. */
export function createScriveningsEnterTypographyExtension(
  settings: Pick<FeuilletsSettings, "liveTwoEnters" | "liveDoubleEnter">
): unknown[] {
  let pending: PendingParagraphBreak | undefined;

  const runEnter = (view: ScriveningsEnterView): boolean => {
    const selection = view.state.selection.main;
    if (!selection.empty) {
      pending = undefined;
      return false;
    }

    const cursor = selection.head;
    const currentPending = pending;
    pending = undefined;
    if (
      currentPending &&
      settings.liveDoubleEnter &&
      currentPending.view === view &&
      currentPending.position === cursor &&
      currentPending.document === view.state.doc
    ) {
      view.dispatch({
        changes: { from: cursor - 1, to: cursor, insert: "\u00A0\n\n" },
        selection: { anchor: cursor + 2 },
      });
      return true;
    }

    if (!settings.liveTwoEnters || isExcludedFromScriveningsParagraphBreak(view.state.doc.toString(), cursor)) return false;

    view.dispatch({
      changes: { from: cursor, insert: "\n\n" },
      selection: { anchor: cursor + 2 },
    });
    if (settings.liveDoubleEnter) {
      pending = { view, position: cursor + 2, document: view.state.doc };
    }
    return true;
  };

  const enterKeymap =
    typeof KeymapTyped?.of === "function" && typeof PrecTyped?.highest === "function"
      ? PrecTyped.highest(KeymapTyped.of([{ key: "Enter", run: runEnter }]))
      : [];
  const pendingReset = typeof EditorViewTyped.domEventHandlers === "function"
    ? EditorViewTyped.domEventHandlers({
        keydown(event) {
          if (event.key !== "Enter") pending = undefined;
          return false;
        },
      })
    : [];
  return [enterKeymap, pendingReset];
}

/** Pose (ou remplace intégralement) les titres ET les frontières affichées
 * par cette vue, en une seule transaction — jamais un ajout incrémental :
 * Scrivenings reconstruit toujours l'ensemble depuis le document composite
 * à jour (typiquement au chargement d'un scope). */
export function setScriveningsDecorations(
  view: { dispatch?: (spec: { effects: unknown }) => void } | null | undefined,
  doc: ScriveningsDocument,
  titleFor: (file: TFile) => string,
  roleFor: (file: TFile) => ScriveningsSegmentRole = () => undefined
): void {
  view?.dispatch?.({
    effects: [
      setScriveningsBoundaryOffsetsEffect.of(boundaryOffsets(doc)),
      setScriveningsTitlesEffect.of(scriveningsTitleSpecsFor(doc, titleFor, roleFor)),
    ],
  });
}

/** Vrai si `[fromA, toA)` (coordonnées AVANT édition) recouvre au moins une
 * jonction. Même règle que `changeCrossesBoundary` (services/scrivenings-
 * document.ts), reformulée ici sans dépendre d'un `ScriveningsDocument`
 * complet : le filtre de transaction ne dispose que de la liste plate
 * d'offsets portée par `scriveningsBoundariesField`. */
export function crossesScriveningsBoundary(boundaries: readonly number[], fromA: number, toA: number): boolean {
  return boundaries.some((offset) => fromA <= offset && offset < toA);
}

/**
 * Filtre de transaction : rejette PROPREMENT (transaction annulée en bloc,
 * jamais appliquée partiellement) toute édition qui franchirait une
 * frontière entre deux fichiers — donc jamais de fusion implicite. Une
 * édition entièrement contenue dans un seul segment traverse ce filtre sans
 * y être même remarquée.
 */
export function scriveningsTransactionFilter(tr: TransactionFilterInput): TransactionFilterInput | readonly TransactionFilterInput[] {
  const boundaries = (tr.startState.field(scriveningsBoundariesField, false) as number[] | undefined) || [];
  if (boundaries.length === 0) return tr;

  let crosses = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (!crosses && crossesScriveningsBoundary(boundaries, fromA, toA)) crosses = true;
  });

  return crosses ? [] : tr;
}

export const scriveningsBoundaryGuard =
  typeof EditorStateTyped?.transactionFilter?.of === "function" ? EditorStateTyped.transactionFilter.of(scriveningsTransactionFilter) : [];

/* --- Pont transaction CodeMirror → modèle composite pur -------------------- */

/** Extrait, dans les coordonnées AVANT édition, la liste des changements
 * portés par une transaction CodeMirror — exactement la forme attendue par
 * `applyCompositeChanges()` (services/scrivenings-document.ts). Le pont entre
 * l'éditeur et le modèle : ScriveningsView n'a besoin de rien connaître de
 * `ChangeSet` au-delà de cette conversion. */
export function scriveningsChangesFromTransaction(tr: { changes: ChangesLike }): { from: number; to: number; insert: string }[] {
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return changes;
}

/** Extension d'écoute : convertit chaque transaction qui modifie le document
 * en changements composites (voir `scriveningsChangesFromTransaction`) et les
 * transmet à `onChanges` — c'est par ce seul canal que ScriveningsView fait
 * évoluer son `ScriveningsDocument` et déclenche la sauvegarde différée.
 * Ne fait jamais elle-même d'I/O : uniquement la conversion. */
export function scriveningsChangeListener(onChanges: (changes: { from: number; to: number; insert: string }[]) => void): unknown {
  if (typeof EditorViewTyped?.updateListener?.of !== "function") return [];
  return EditorViewTyped.updateListener.of((update) => {
    if (!update.docChanged) return;
    onChanges(scriveningsChangesFromTransaction(update));
  });
}

/** Extensions Scrivenings composées : frontières (donnée + décorations de
 * titre), retour à la ligne, historique CM6 public (Undo/Redo, voir
 * ci-dessus), le keymap Continu PRIORITAIRE (`Mod-i`/`Mod-b`/`Mod-Shift-z`,
 * micro-lot 1.3.1 — voir `scriveningsPriorityKeymap` ci-dessus, monté AVANT
 * `scriveningsHistoryKeymap`), le rendu Markdown inline italique/gras
 * (LOT 1.3, voir cm-scrivenings-markdown.ts — parse chaque segment
 * indépendamment, jamais le composite entier), et la grammaire visuelle
 * Feuillets déjà partagée par l'éditeur natif (`feuillets-empty-line` /
 * `feuillets-paragraph-indent`, réutilisées telles quelles, jamais
 * réimplémentées). `scriveningsChangeListener(...)` reste ajoutée à part par
 * ScriveningsView : elle a besoin d'un callback propre à l'instance. */
export function createScriveningsExtensions(imageResolver?: ScriveningsImageResolver): unknown[] {
  return [
  scriveningsBoundariesField,
  scriveningsBoundaryGuard,
  scriveningsTitlesField,
  scriveningsLineWrapping,
  scriveningsHistory,
  scriveningsPriorityKeymap,
  scriveningsHistoryKeymap,
  ...createScriveningsMarkdownExtensions(scriveningsBoundariesField, imageResolver),
  emptyLinesPlugin,
  paragraphIndentPlugin,
  ...createParagraphReorderExtension(scriveningsBoundariesField),
  ];
}

export const scriveningsExtensions = createScriveningsExtensions();
