import type { ScriveningsSegment } from "../services/scrivenings-document.js";

/**
 * LOT 1.4 — Menu contextuel Continu : présente UN segment Scrivenings comme
 * une surface d'éditeur correspondant à son VRAI fichier (frontmatter compris)
 * aux fonctions Feuillets déjà partagées avec le MarkdownView natif (notes de
 * bas de page, annotations — voir main.ts). Jamais un second moteur : cette
 * classe ne fait QUE convertir des positions et border les écritures au
 * segment ; toute la logique métier (numérotation des notes, stockage des
 * annotations…) continue de vivre exactement où elle vivait déjà.
 *
 * `FeuilletsEditorSurface` est délibérément le sous-ensemble MINIMAL de
 * l'API `Editor` d'Obsidian réellement consommé par les fonctions
 * effectivement réutilisées (voir main.ts) — jamais un adaptateur géant :
 * `setSelection`/`scrollIntoView`/`focus` sont nécessaires à
 * `utils/dom.ts#selectRange` (gotoFootnoteDefinition/gotoFootnoteReference/
 * FootnoteCheckModal) ; `getLine`/`lastLine` à `insertFootnote` ; `setValue`
 * à `renumberFootnotesInEditor`. Un `Editor` Obsidian réel satisfait déjà
 * structurellement cette interface : aucun changement de comportement pour
 * le MarkdownView normal (§11 du contrat).
 */
export interface EditorPos {
  line: number;
  ch: number;
}

export interface FeuilletsEditorSurface {
  getValue(): string;
  somethingSelected(): boolean;
  getSelection(): string;
  getCursor(which?: "from" | "to"): EditorPos;
  posToOffset(pos: EditorPos): number;
  offsetToPos(offset: number): EditorPos;
  replaceRange(replacement: string, from: EditorPos, to?: EditorPos): void;
  replaceSelection(replacement: string): void;
  setCursor(pos: EditorPos): void;
  setSelection(from: EditorPos, to?: EditorPos): void;
  scrollIntoView(range: { from: EditorPos; to: EditorPos }, center?: boolean): void;
  focus(): void;
  getLine(line: number): string;
  lastLine(): number;
  setValue(content: string): void;
}

/* --- Conversion PURE {line, ch} <-> offset, sur une chaîne quelconque ----
 * Même algorithme que ScriveningsView#offsetForLineCol (lot « clic Preview →
 * Continu ») — dupliqué ici délibérément en deux fonctions PURES autonomes
 * (aucune dépendance à CodeMirror ni à ScriveningsView) plutôt que ré-
 * exporté : ce module doit rester testable en isolation totale. */
export function offsetToLineCol(text: string, offset: number): EditorPos {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped).split("\n");
  const line = before.length - 1;
  const ch = before[line].length;
  return { line, ch };
}

export function lineColToOffset(text: string, pos: EditorPos): number {
  const lines = text.split("\n");
  const clampedLine = Math.max(0, Math.min(pos.line, lines.length - 1));
  let offset = 0;
  for (let i = 0; i < clampedLine; i++) offset += lines[i].length + 1;
  const lineText = lines[clampedLine] ?? "";
  return offset + Math.max(0, Math.min(pos.ch, lineText.length));
}

/** Sous-ensemble PUBLIC de l'EditorView CodeMirror composite de Continu
 * réellement utilisé par cet adaptateur — même patron que les typages locaux
 * de cm-scrivenings.ts/scrivenings-view.ts, jamais un `any`. */
export interface ScriveningsAdapterEditorView {
  readonly state: {
    readonly doc: { readonly length: number; sliceString(from: number, to?: number): string };
    readonly selection: { readonly main: { readonly from: number; readonly to: number; readonly empty: boolean } };
  };
  dispatch(spec: {
    changes?: { from: number; to: number; insert: string };
    selection?: { anchor: number; head?: number };
  }): void;
  focus(): void;
}

/**
 * Adaptateur d'UN segment Continu (`path`) vers `FeuilletsEditorSurface`.
 * `getSegment` relit le document Scrivenings à jour à CHAQUE appel — jamais
 * une copie figée à la construction : après un dispatch produit par CETTE
 * instance, `scriveningsChangeListener` (cm-scrivenings.ts) a déjà mis à
 * jour `ScriveningsSession.document` de façon SYNCHRONE (CodeMirror notifie
 * ses `updateListener` pendant `dispatch()` lui-même) — l'appel suivant voit
 * donc immédiatement l'état réel, sans jamais relire le disque.
 *
 * SÉCURITÉ (§14 du contrat) : toute conversion de position ou d'écriture qui
 * tomberait dans le frontmatter, hors du segment, ou avec `from > to`, ne
 * dispatch RIEN — dernière garde locale, en plus de
 * `scriveningsBoundaryGuard` (cm-scrivenings.ts), qui reste la seconde
 * sécurité au niveau de la transaction CodeMirror elle-même.
 */
export class ScriveningsSegmentEditorAdapter implements FeuilletsEditorSurface {
  constructor(
    private readonly editorView: ScriveningsAdapterEditorView,
    private readonly path: string,
    private readonly getSegment: (path: string) => ScriveningsSegment | null
  ) {}

  private segment(): ScriveningsSegment | null {
    return this.getSegment(this.path);
  }

  private fullText(segment: ScriveningsSegment): string {
    return segment.frontmatter + segment.body;
  }

  /** Sélection composite courante, bornée à CE segment — `null` sans
   * segment chargé. Ne décide jamais elle-même si elle doit être traitée
   * comme "vide" : voir `somethingSelected`. */
  private clampedSelection(segment: ScriveningsSegment): { from: number; to: number } {
    const main = this.editorView.state.selection.main;
    const from = Math.max(segment.from, Math.min(main.from, segment.to));
    const to = Math.max(segment.from, Math.min(main.to, segment.to));
    return { from, to };
  }

  getValue(): string {
    const segment = this.segment();
    if (!segment) return "";
    return segment.frontmatter + this.editorView.state.doc.sliceString(segment.from, segment.to);
  }

  /** Vrai seulement si la sélection composite courante est non vide ET
   * ENTIÈREMENT contenue dans CE segment — une sélection qui déborde sur un
   * autre feuillet n'est jamais "sélectionnée" du point de vue de cet
   * adaptateur (§15 : c'est ce qui désactive naturellement Couper/Annotation
   * pour une sélection cross-segment, sans logique dupliquée ici). */
  somethingSelected(): boolean {
    const segment = this.segment();
    if (!segment) return false;
    const main = this.editorView.state.selection.main;
    if (main.empty) return false;
    return main.from >= segment.from && main.to <= segment.to;
  }

  getSelection(): string {
    const segment = this.segment();
    if (!segment || !this.somethingSelected()) return "";
    const range = this.clampedSelection(segment);
    return this.editorView.state.doc.sliceString(range.from, range.to);
  }

  private compositeToFilePos(segment: ScriveningsSegment, compositeOffset: number): EditorPos {
    const bodyOffset = Math.max(0, Math.min(compositeOffset - segment.from, segment.body.length));
    return offsetToLineCol(this.fullText(segment), segment.frontmatter.length + bodyOffset);
  }

  getCursor(which: "from" | "to" = "to"): EditorPos {
    const segment = this.segment();
    if (!segment) return { line: 0, ch: 0 };
    const main = this.editorView.state.selection.main;
    const compositeOffset = which === "from" ? Math.min(main.from, main.to) : Math.max(main.from, main.to);
    const clamped = Math.max(segment.from, Math.min(compositeOffset, segment.to));
    return this.compositeToFilePos(segment, clamped);
  }

  posToOffset(pos: EditorPos): number {
    const segment = this.segment();
    return lineColToOffset(segment ? this.fullText(segment) : "", pos);
  }

  offsetToPos(offset: number): EditorPos {
    const segment = this.segment();
    return offsetToLineCol(segment ? this.fullText(segment) : "", offset);
  }

  replaceRange(replacement: string, from: EditorPos, to: EditorPos = from): void {
    const segment = this.segment();
    if (!segment) return;
    const full = this.fullText(segment);
    const fileFrom = lineColToOffset(full, from);
    const fileTo = lineColToOffset(full, to);
    if (fileFrom > fileTo) return;
    // Jamais le YAML, jamais hors segment (§14) :
    if (fileFrom < segment.frontmatter.length || fileTo > full.length) return;
    const compositeFrom = segment.from + (fileFrom - segment.frontmatter.length);
    const compositeTo = segment.from + (fileTo - segment.frontmatter.length);
    if (compositeFrom < segment.from || compositeTo > segment.to || compositeFrom > compositeTo) return;
    this.editorView.dispatch({ changes: { from: compositeFrom, to: compositeTo, insert: replacement } });
  }

  replaceSelection(replacement: string): void {
    const segment = this.segment();
    if (!segment || !this.somethingSelected()) return;
    const range = this.clampedSelection(segment);
    this.editorView.dispatch({ changes: { from: range.from, to: range.to, insert: replacement } });
  }

  private toCompositeOffset(segment: ScriveningsSegment, pos: EditorPos): number {
    const fileOffset = lineColToOffset(this.fullText(segment), pos);
    const bodyOffset = Math.max(0, Math.min(fileOffset - segment.frontmatter.length, segment.body.length));
    return segment.from + bodyOffset;
  }

  setCursor(pos: EditorPos): void {
    const segment = this.segment();
    if (!segment) return;
    const offset = this.toCompositeOffset(segment, pos);
    this.editorView.dispatch({ selection: { anchor: offset, head: offset } });
  }

  setSelection(from: EditorPos, to: EditorPos = from): void {
    const segment = this.segment();
    if (!segment) return;
    this.editorView.dispatch({
      selection: { anchor: this.toCompositeOffset(segment, from), head: this.toCompositeOffset(segment, to) },
    });
  }

  /** Continu affiche déjà le segment visé (toute action de ce menu part d'un
   * clic droit dedans) : contrairement à un MarkdownView isolé — seul
   * véritable appelant historique de `dom.ts#selectRange`, où la cible peut
   * être hors écran — aucun scroll programmatique supplémentaire n'est
   * nécessaire ici. `setSelection` a déjà positionné le curseur/la sélection
   * réels dans l'EditorView composite. */
  scrollIntoView(): void {
    // no-op délibéré, voir commentaire ci-dessus.
  }

  focus(): void {
    this.editorView.focus();
  }

  getLine(line: number): string {
    const segment = this.segment();
    return (segment ? this.fullText(segment) : "").split("\n")[Math.max(0, line)] ?? "";
  }

  lastLine(): number {
    const segment = this.segment();
    return (segment ? this.fullText(segment) : "").split("\n").length - 1;
  }

  /** Réécriture pleine du fichier (`renumberFootnotesInEditor`) — jamais un
   * remplacement brut du composite : calcule le plus petit préfixe/suffixe
   * commun avec le contenu actuel puis passe par `replaceRange`, qui refuse
   * déjà (§14) toute portion touchant le frontmatter ou débordant du
   * segment. Ne dispatch rien si `content` est déjà identique au contenu
   * actuel. */
  setValue(content: string): void {
    const segment = this.segment();
    if (!segment) return;
    const current = this.fullText(segment);
    if (content === current) return;

    const maxCommon = Math.min(current.length, content.length);
    let prefixLen = 0;
    while (prefixLen < maxCommon && current[prefixLen] === content[prefixLen]) prefixLen++;

    let suffixLen = 0;
    const maxSuffix = maxCommon - prefixLen;
    while (suffixLen < maxSuffix && current[current.length - 1 - suffixLen] === content[content.length - 1 - suffixLen]) {
      suffixLen++;
    }

    const fileFrom = prefixLen;
    const fileTo = current.length - suffixLen;
    const insert = content.slice(prefixLen, content.length - suffixLen);
    this.replaceRange(insert, offsetToLineCol(current, fileFrom), offsetToLineCol(current, fileTo));
  }
}
