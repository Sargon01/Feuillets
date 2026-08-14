import { DropdownComponent, MarkdownView, Menu, Notice, TFile, TFolder, setIcon, type App, type EventRef, type Events, type WorkspaceLeaf } from "obsidian";
import { adjacentComparisonChange, comparisonChanges, nextPendingComparisonChange, type ComparisonChange } from "../services/comparison-model.js";
import { comparisonBeforeRole, comparisonPlacements, comparisonPlan, shiftComparisonDecorations, type ComparisonMode, type ComparisonNoteSpan, type ComparisonPlacement } from "../services/comparison-plan.js";
import { stripFrontmatter } from "../services/frontmatter.js";
import { listSnapshotFiles, snapshotFile } from "../services/project-files.js";
import { decideNativeReviewAuthorGroup } from "../services/native-review-author-decisions.js";
import { completeNativeReviewSession } from "../services/native-review-exchange.js";
import { setNativeReviewThreadResolved } from "../services/native-review-threads.js";
import { loadNativeReviewWork, type NativeReviewWorkNote } from "../services/native-review-work.js";
import { ensureFolderPath } from "../services/native-review-session.js";
import { nativeReviewLocationFromRoot, reviewSessionPaths } from "../services/native-review-storage.js";
import { resolveNativeReviewThreadAnchor } from "../utils/cm-native-review-highlighter.js";
import {
  applyComparisonDecorations, clearComparisonDecorations, comparisonEditorCmView, onComparisonClick,
  setComparisonReadOnly, type ComparisonClickDetail, type ComparisonEditorView,
} from "../utils/cm-comparison-decorations.js";
import { findSourceScroller, scrollProgress, scrollTopForProgress, SCROLL_SYNC_SUSPEND_MS, type ScrollLike } from "./preview-scroll-sync.js";
import { formatNaturalDate, parseIsoDate } from "../utils/natural-date.js";
import { ConfirmModal } from "../ui/basic-modals.js";
import { t } from "../i18n/index.js";

/**
 * « 2026-01-01 10h00m00s » (nom de fichier d'un snapshot, voir
 * project-files.ts#snapshotFile) → « 1er janvier 2026 à 10 h » — jamais un
 * renommage du fichier, seulement ce qui s'affiche (bandeau ET titre
 * d'onglet, qui partagent tous les deux `data.title`). Réutilise l'analyseur
 * et le formateur de date déjà partagés par tout le plugin (natural-date.ts) :
 * jamais un second calcul de mois. `null` si le nom ne correspond pas
 * exactement à ce format — l'appelant garde alors le nom de fichier tel quel,
 * jamais une valeur inventée.
 */
function humanizeSnapshotStamp(stamp: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2})h(\d{2})m\d{2}s$/.exec(stamp);
  return match ? formatNaturalDate(parseIsoDate(`${match[1]} ${match[2]}:${match[3]}`)) : null;
}

/**
 * Comparaison = DEUX vraies vues Markdown d'Obsidian, côte à côte.
 *
 * Convention définitive, la même dans tous les modes :
 *
 *     GAUCHE = AVANT      DROITE = APRÈS
 *
 * Ce n'est donc PAS « le vrai fichier est toujours à gauche » : en relecture
 * le texte de l'auteur est l'avant (gauche) et la proposition l'après
 * (droite), tandis qu'en snapshot le snapshot est l'avant (gauche) et le
 * fichier actuel l'après (droite). Le sens de lecture prime sur la place du
 * fichier — c'est lui qui rend le diff immédiat.
 *
 * Deux invariants tiennent quel que soit le côté :
 * - le vrai fichier de l'utilisateur (`sourcePath`) reste éditable et reste
 *   le SEUL que la comparaison écrive, sur action explicite ;
 * - le document comparé (`comparedPath`) est verrouillé en lecture seule.
 *
 * Feuillets ne rend jamais le texte : Obsidian rend les deux côtés, avec le
 * même thème, la même police, la même largeur, les mêmes alinéas et les
 * mêmes extensions. Cette classe n'ajoute que le diff et les actions —
 * uniquement sous forme de décorations temporaires, jamais de Markdown. À la
 * fermeture, les deux éditeurs redeviennent exactement ce qu'ils étaient.
 *
 * Deux modes de consultation, non destructifs l'un envers l'autre :
 * - CHANGEMENTS (par défaut) — comprendre ce qui a changé. Décorations
 *   posées, navigation par changement. Simple clic : sélectionne, ouvre le
 *   cartouche — jamais de recentrage forcé. Double-clic (ou Précédent/
 *   Suivant) : recentre les DEUX vues, INDÉPENDAMMENT, sur le hunk actif —
 *   jamais sur la position globale de l'autre document, c'est ce qui rend un
 *   gros couper/coller compréhensible malgré la distance.
 * - VERSIONS — lire l'avant et l'après. Aucune décoration : deux documents
 *   normaux, chacun libre.
 * Basculer entre les deux ne modifie jamais le Markdown ni ne referme la
 * comparaison ; le changement actif du mode Changements est conservé et
 * recentré au retour.
 *
 * DÉFILEMENT LIÉ — une option indépendante des deux modes (pas un troisième
 * mode), avec sa propre valeur par défaut et sa propre mémoire par mode pour
 * la durée de la session (voir `linkedScrollByMode`) : désactivé par défaut
 * en Changements (le recentrage par hunk suffit), activé par défaut en
 * Versions (pour suivre une lecture continue). Réutilise le même mécanisme
 * de synchronisation proportionnelle que l'aperçu manuscrit
 * (preview-scroll-sync.ts), jamais une seconde logique. Le recentrage par
 * hunk reste toujours prioritaire : il suspend brièvement le lien plutôt que
 * de le laisser interférer.
 *
 * CARTOUCHE — se ferme sans jamais décider ni écrire : bouton `×`, Échap, ou
 * un clic qui ne touche aucune décoration. Toujours ancré à l'APRÈS, jamais
 * dans le document en lecture seule — voir `comparisonPlan()`.
 */
export type ComparisonSpec =
  /** `sourcePath` : le vrai feuillet de l'utilisateur. Son CÔTÉ dépend du
   * mode (voir la convention ci-dessus) ; son rôle, lui, ne change jamais. */
  | { kind: "native-review"; sourcePath: string; reviewId: string; sessionsRootPath: string; documentId: string }
  | { kind: "snapshot"; sourcePath: string; snapshotPath?: string; allowRestore?: boolean };

export type ComparisonPlugin = {
  app: App;
  settings: FeuilletsSettings;
  /** Optionnel : une relecture n'en a pas besoin — un relecteur pur peut
   * n'avoir aucun projet ouvert. Seuls les snapshots s'appuient dessus. */
  getProjectFolder?: () => TFolder | null;
  refreshNativeReviewDecorations?: () => Promise<void>;
  applyLiveTypoClasses?: () => void;
  applyIndentClass?: () => void;
  /** Titre d'onglet affiché à la place du nom de fichier technique du
   * document comparé (identifiant de paquet, horodatage de snapshot) — voir
   * `patchTabTitles()` dans main.ts, déjà utilisé pour les working files de
   * relecture. `title: null` efface l'entrée. Optionnel : sans lui, l'onglet
   * garde simplement son titre Obsidian par défaut. */
  setComparisonDisplayTitle?: (path: string, title: string | null) => void;
};

interface ComparisonData {
  /** Titre du document comparé (« Snapshot — … », « Version de Paul »). */
  title: string;
  /** Texte du document comparé, sans frontmatter. */
  comparedText: string;
  changes: ComparisonChange[];
  notes: NativeReviewWorkNote[];
  pendingChanges: number;
  pendingNotes: number;
  snapshots: TFile[];
  snapshotPath?: string;
}

/** Pluriels simples : « 1 note », « 2 notes ». */
export function comparisonSummaryLabel(changes: number, notes: number): string {
  const part = (count: number, one: string, other: string) => t(count > 1 ? other : one, { count: String(count) });
  return `${part(changes, "nativeReview.count.change", "nativeReview.count.changes")} · ${part(notes, "nativeReview.count.note", "nativeReview.count.notes")}`;
}

export { comparisonChangeLabel } from "../services/comparison-plan.js";

/** Les deux modes de consultation du bandeau — voir la classe ci-dessous. */
export type ComparisonViewMode = "changes" | "versions";

/** Le contexte d'une comparaison ouverte, lu par isActiveFileInProject
 * (main.ts) : le document comparé doit recevoir la même grammaire
 * typographique que le vrai feuillet, sinon les deux colonnes ne se composent
 * pas pareil. C'est le seul état exposé — jamais le contenu ni la liste des
 * différences. */
export interface ComparisonContext { sourcePath: string; comparedPath: string }
export function activeComparisonContext(): ComparisonContext | null {
  const session = ComparisonSession.current;
  return session ? { sourcePath: session.sourcePath, comparedPath: session.comparedPath } : null;
}

export class ComparisonSession {
  static current: ComparisonSession | null = null;

  private data: ComparisonData | null = null;
  private activeIndex: number | null = null;
  private snapshotTaken = false;
  private beforeLeaf: WorkspaceLeaf | null = null;
  private afterLeaf: WorkspaceLeaf | null = null;
  private barEl: HTMLElement | null = null;
  private hostEl: HTMLElement | null = null;
  /** Vues CM6 réellement décorées — jamais redéduites du seul `spec` : elles
   * doivent rester joignables pour un nettoyage même après qu'Obsidian y a
   * substitué une autre feuille. */
  private decoratedBefore: ComparisonEditorView | null = null;
  private decoratedAfter: ComparisonEditorView | null = null;
  /** Vue actuellement verrouillée en lecture seule — celle du document
   * comparé, quel que soit son côté. */
  private lockedCm: ComparisonEditorView | null = null;
  private eventRefs: Array<{ owner: Events; ref: EventRef }> = [];
  private unsubscribeClicks: (() => void) | null = null;
  private writing = false;
  private closing = false;
  /** Mode Changements par défaut — voir la doc de classe. Bascule non
   * destructive : jamais de réécriture, jamais de réouverture. */
  private _viewMode: ComparisonViewMode = "changes";
  /** Défilement lié : une option indépendante des modes, pas un troisième
   * mode. Valeurs initiales distinctes (Changements verrouillé sur le hunk
   * actif, Versions pensé pour lire les deux versions en parallèle) puis
   * mémorisées SÉPARÉMENT par mode, pour la durée de cette comparaison
   * seulement — jamais un réglage Feuillets global. */
  private linkedScrollByMode: Record<ComparisonViewMode, boolean> = { changes: false, versions: true };
  private scrollLinkCleanup: (() => void) | null = null;
  /** Après un recentrage programmatique (double-clic, Précédent/Suivant), le
   * lien de défilement se tait le temps que les deux vues atteignent leur
   * propre position — sinon il rejouerait un défilement proportionnel
   * pendant le geste et le contrarierait. Repris de la même fenêtre que la
   * synchronisation aperçu/éditeur (`SCROLL_SYNC_SUSPEND_MS`), jamais une
   * seconde logique parallèle. */
  private scrollLinkSuspendUntil = 0;

  /** `spec` est public en LECTURE : plusieurs entrées (Snapshots, DOCX,
   * Relecture) ont besoin de savoir ce qui est comparé, jamais de le changer
   * en cours de route — un autre choix ferme la comparaison et en rouvre une. */
  private constructor(private readonly app: App, private readonly plugin: ComparisonPlugin, readonly spec: ComparisonSpec, public comparedPath: string) {}

  /** Le vrai feuillet de l'utilisateur : éditable, et le seul jamais écrit. */
  get sourcePath(): string { return this.spec.sourcePath; }
  get viewMode(): ComparisonViewMode { return this._viewMode; }
  /** État du défilement lié pour le mode ACTUEL — voir `linkedScrollByMode`. */
  get linkedScroll(): boolean { return this.linkedScrollByMode[this._viewMode]; }
  private get mode(): ComparisonMode { return this.spec.kind; }
  /** Le document comparé occupe-t-il la colonne de gauche (l'AVANT) ? */
  private get comparedIsBefore(): boolean { return comparisonBeforeRole(this.mode) === "compared"; }
  private get beforePath(): string { return this.comparedIsBefore ? this.comparedPath : this.sourcePath; }
  private get afterPath(): string { return this.comparedIsBefore ? this.sourcePath : this.comparedPath; }

  /* --- Ouverture / fermeture ------------------------------------------ */

  static async open(app: App, plugin: ComparisonPlugin, spec: ComparisonSpec): Promise<ComparisonSession | null> {
    await ComparisonSession.current?.close();
    const source = app.vault.getAbstractFileByPath(spec.sourcePath);
    if (!(source instanceof TFile)) { new Notice(t("nativeReview.notice.sourceMissing")); return null; }
    const session = new ComparisonSession(app, plugin, spec, "");
    try { await session.start(source); }
    catch (error) { await session.close(); new Notice(error instanceof Error ? error.message : String(error)); return null; }
    ComparisonSession.current = session;
    return session;
  }

  private async start(source: TFile): Promise<void> {
    this.data = await this.resolve();
    const compared = await this.materializeCompared();
    this.comparedPath = compared.path;
    // « Snapshot — 14 août 11:01 », « Version de Pierre » — jamais le nom de
    // fichier technique du document comparé (horodatage de snapshot,
    // identifiant de paquet). Ce même titre sert déjà de `data.title`.
    this.plugin.setComparisonDisplayTitle?.(this.comparedPath, this.data.title);

    // La vraie feuille du feuillet, réutilisée si elle est déjà ouverte —
    // aucune copie, aucun modal, aucun rendu maison.
    const opened = this.markdownLeaves().find((leaf) => (leaf.view as MarkdownView).file?.path === source.path);
    const sourceLeaf = opened ?? this.app.workspace.getLeaf(false);
    if (!opened) await sourceLeaf.openFile(source);

    // Le document comparé s'ouvre DU CÔTÉ que lui donne le sens de lecture :
    // à gauche pour un snapshot (c'est l'avant), à droite pour une relecture
    // (c'est la proposition). `before` du split place la nouvelle feuille
    // avant la feuille de référence plutôt qu'après.
    const comparedLeaf = this.app.workspace.createLeafBySplit(sourceLeaf, "vertical", this.comparedIsBefore);
    await comparedLeaf.openFile(compared, { state: { mode: "source", source: false }, active: false });
    this.beforeLeaf = this.comparedIsBefore ? comparedLeaf : sourceLeaf;
    this.afterLeaf = this.comparedIsBefore ? sourceLeaf : comparedLeaf;
    void this.app.workspace.revealLeaf(sourceLeaf);

    this.unsubscribeClicks = onComparisonClick((detail) => this.onClick(detail));
    this.listen(this.app.vault, this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) return;
      if (file.path === this.sourcePath || (file.path === this.comparedPath && !this.writing)) void this.reload();
    }));
    this.listen(this.app.workspace, this.app.workspace.on("active-leaf-change", () => { this.plugin.applyLiveTypoClasses?.(); this.plugin.applyIndentClass?.(); this.paint(); }));
    this.listen(this.app.workspace, this.app.workspace.on("layout-change", () => { if (!this.stillOpen()) void this.close(); }));

    // L'éditeur du document comparé vient d'être créé : sa vue CM6 n'existe
    // qu'au tour de boucle suivant. On peint dès maintenant (l'autre côté est
    // déjà prêt) et à nouveau ensuite, sans jamais supposer l'un ni l'autre.
    this.paint();
    window.setTimeout(() => { if (!this.closing) this.paint(); }, 0);
  }

  /** Fermeture : plus une seule décoration, plus une seule classe, plus aucun
   * verrou. Le Markdown n'a jamais été touché — sauf par une action explicite
   * Appliquer ou Restaurer. */
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.scrollLinkCleanup?.(); this.scrollLinkCleanup = null;
    clearComparisonDecorations(this.decoratedBefore);
    clearComparisonDecorations(this.decoratedAfter);
    setComparisonReadOnly(this.lockedCm, false);
    this.decoratedBefore = null; this.decoratedAfter = null; this.lockedCm = null;
    this.barEl?.remove(); this.barEl = null;
    this.hostEl?.removeClass("feuillets-comparison-host"); this.hostEl = null;
    this.unsubscribeClicks?.(); this.unsubscribeClicks = null;
    for (const { owner, ref } of this.eventRefs) owner.offref(ref);
    this.eventRefs = [];
    this.plugin.setComparisonDisplayTitle?.(this.comparedPath, null);
    // Seule la feuille du document comparé est refermée : celle du vrai
    // feuillet appartient à l'utilisateur et reste où elle était.
    const compared = this.comparedLeaf();
    this.beforeLeaf = null; this.afterLeaf = null;
    compared?.detach();
    if (ComparisonSession.current === this) ComparisonSession.current = null;
    this.plugin.applyLiveTypoClasses?.();
    this.plugin.applyIndentClass?.();
  }

  /** Chaque abonnement est rendu à l'émetteur qui l'a délivré : un EventRef
   * du coffre ne se désabonne pas sur le workspace. */
  private listen(owner: Events, ref: EventRef): void { this.eventRefs.push({ owner, ref }); }

  /** Les deux feuilles montrent-elles encore ce qu'elles doivent montrer ?
   * Dès que l'une part ailleurs, la comparaison n'a plus de sens et se
   * referme d'elle-même plutôt que de décorer un texte étranger. */
  private stillOpen(): boolean {
    return this.beforeView() !== null && this.afterView() !== null;
  }

  /** Feuille du document comparé — celle que la fermeture referme. */
  private comparedLeaf(): WorkspaceLeaf | null {
    const leaf = this.comparedIsBefore ? this.beforeLeaf : this.afterLeaf;
    return this.viewOf(leaf, this.comparedPath) ? leaf : null;
  }

  private markdownLeaves(): WorkspaceLeaf[] {
    return this.app.workspace.getLeavesOfType("markdown").filter((leaf) => leaf.view instanceof MarkdownView);
  }
  private viewOf(leaf: WorkspaceLeaf | null, path: string): MarkdownView | null {
    const view = leaf?.view;
    return view instanceof MarkdownView && view.file?.path === path ? view : null;
  }
  private beforeView(): MarkdownView | null { return this.viewOf(this.beforeLeaf, this.beforePath); }
  private afterView(): MarkdownView | null { return this.viewOf(this.afterLeaf, this.afterPath); }
  private sourceView(): MarkdownView | null { return this.comparedIsBefore ? this.afterView() : this.beforeView(); }
  private comparedView(): MarkdownView | null { return this.comparedIsBefore ? this.beforeView() : this.afterView(); }

  /* --- Chargement ------------------------------------------------------ */

  private async reload(): Promise<void> {
    if (this.closing) return;
    try { this.data = await this.resolve(); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); await this.close(); return; }
    if (this.activeIndex !== null && !this.data.changes.some((change) => change.index === this.activeIndex)) this.activeIndex = null;
    this.paint();
  }

  private async resolve(): Promise<ComparisonData> {
    return this.spec.kind === "native-review" ? this.loadNativeReview(this.spec) : this.loadSnapshot(this.spec);
  }

  private async loadNativeReview(spec: Extract<ComparisonSpec, { kind: "native-review" }>): Promise<ComparisonData> {
    const work = await loadNativeReviewWork(this.app, spec.reviewId, nativeReviewLocationFromRoot(spec.sessionsRootPath));
    const document = work.documents.find((item) => item.documentId === spec.documentId) ?? work.documents[0];
    if (!document) throw new Error(t("nativeReview.notice.sessionMissing"));
    const reviewer = work.session.participants.find((person) => person.role === "reviewer")?.name ?? t("nativeReview.role.reviewer");
    return {
      title: t("nativeReview.compare.reviewerText", { name: reviewer }),
      comparedText: document.reviewerMarkdown, changes: document.changes, notes: document.notes,
      pendingChanges: work.pendingChanges, pendingNotes: work.pendingNotes, snapshots: [],
    };
  }

  private async loadSnapshot(spec: Extract<ComparisonSpec, { kind: "snapshot" }>): Promise<ComparisonData> {
    const file = this.sourceFile(); if (!file) throw new Error(t("nativeReview.notice.sourceMissing"));
    const snapshots = listSnapshotFiles(this.app, file, this.plugin.getProjectFolder?.() ?? null);
    if (!snapshots.length) throw new Error(t("modal.diff.noSnapshotAvailable"));
    const chosen = snapshots.find((item) => item.path === spec.snapshotPath) ?? snapshots[0];
    // Le moteur reste basé sur le vrai fichier — c'est lui qui porte les
    // coordonnées d'écriture. Le sens de LECTURE, lui, est rétabli à
    // l'affichage (voir comparisonPlacements) : le snapshot est l'avant.
    const comparedText = stripFrontmatter(await this.app.vault.read(chosen));
    const changes = comparisonChanges(await this.sourceText(), comparedText);
    return {
      title: t("comparison.snapshotPane", { name: humanizeSnapshotStamp(chosen.basename) ?? chosen.basename }),
      comparedText, changes, notes: [], pendingChanges: changes.length, pendingNotes: 0,
      snapshots, snapshotPath: chosen.path,
    };
  }

  /**
   * Fichier réel du document comparé. Un snapshot EST déjà un vrai fichier :
   * on l'ouvre tel quel, sans la moindre copie. Le retour d'un relecteur, lui,
   * n'existe que dans le paquet reçu : il est matérialisé sous
   * `…/Relectures/<id>/comparison/<documentId>.md`, strictement pour
   * qu'Obsidian ait quelque chose à afficher avec son vrai éditeur. Ce
   * document n'appartient pas au Manuscrit, ne porte aucun frontmatter ni
   * marqueur technique, et disparaît avec la session.
   */
  private async materializeCompared(): Promise<TFile> {
    if (this.spec.kind === "snapshot") {
      const path = this.data?.snapshotPath;
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      if (!(file instanceof TFile)) throw new Error(t("modal.diff.noSnapshotAvailable"));
      return file;
    }
    const paths = reviewSessionPaths(nativeReviewLocationFromRoot(this.spec.sessionsRootPath), this.spec.reviewId);
    const path = `${paths.comparisonRoot}/${this.spec.documentId}.md`;
    const text = this.data?.comparedText ?? "";
    const existing = this.app.vault.getAbstractFileByPath(path);
    this.writing = true;
    try {
      if (existing instanceof TFile) { if (await this.app.vault.read(existing) !== text) await this.app.vault.modify(existing, text); return existing; }
      await ensureFolderPath(this.app, paths.comparisonRoot);
      return await this.app.vault.create(path, text);
    } finally { this.writing = false; }
  }

  private sourceFile(): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    return file instanceof TFile ? file : null;
  }
  private async sourceText(): Promise<string> {
    const file = this.sourceFile(); return file ? stripFrontmatter(await this.app.vault.read(file)) : "";
  }

  /* --- Décorations ----------------------------------------------------- */

  /** Les positions du diff sont exprimées sans frontmatter ; l'éditeur, lui,
   * l'affiche. Même correction des deux côtés. */
  private shiftOf(view: MarkdownView | null): number {
    if (!view) return 0;
    const raw = view.editor.getValue();
    return raw.length - stripFrontmatter(raw).length;
  }

  private noteSpans(): ComparisonNoteSpan[] {
    const data = this.data; if (!data) return [];
    const spans: ComparisonNoteSpan[] = [];
    data.notes.forEach((note, index) => {
      if (note.resolved) return;
      const range = resolveNativeReviewThreadAnchor(note.anchor, data.comparedText);
      if (range) spans.push({ index, start: range.start, end: range.end });
    });
    return spans;
  }

  /**
   * Pose le diff sur les deux éditeurs. Aucun texte n'est écrit : ce sont des
   * décorations de vue, remplacées à chaque peinture et effacées à la
   * fermeture. Aucune cale n'est posée : les deux textes se déroulent
   * naturellement, et c'est la couleur — rouge barré / vert — qui porte
   * l'information, jamais un espace blanc.
   *
   * En mode Versions, le plan reste VIDE des deux côtés : aucune décoration,
   * jamais un texte modifié pour autant — seule la pose est court-circuitée.
   */
  private paint(): void {
    const data = this.data; if (!data || this.closing) return;
    const before = this.beforeView(); const after = this.afterView();
    const beforeCm = before ? comparisonEditorCmView(before.editor) : null;
    const afterCm = after ? comparisonEditorCmView(after.editor) : null;
    if (beforeCm !== this.decoratedBefore) { clearComparisonDecorations(this.decoratedBefore); this.decoratedBefore = beforeCm; }
    if (afterCm !== this.decoratedAfter) { clearComparisonDecorations(this.decoratedAfter); this.decoratedAfter = afterCm; }
    // Le verrou de lecture seule suit le document COMPARÉ, quel que soit son
    // côté, et suit son éditeur : Obsidian en recrée un quand la feuille
    // change de mode, et le verrou repartirait sans cela. Il tient dans les
    // DEUX modes de consultation — Versions ne retire que les décorations.
    const comparedCm = this.comparedIsBefore ? beforeCm : afterCm;
    if (comparedCm !== this.lockedCm) {
      setComparisonReadOnly(this.lockedCm, false);
      this.lockedCm = comparedCm;
      setComparisonReadOnly(comparedCm, true);
    }

    const plan = this._viewMode === "changes"
      ? comparisonPlan({
          mode: this.mode, changes: data.changes, notes: this.noteSpans(), activeIndex: this.activeIndex,
          allowRestore: this.spec.kind === "snapshot" ? this.spec.allowRestore !== false : true,
        })
      : { before: [], after: [] };
    applyComparisonDecorations(beforeCm, shiftComparisonDecorations(plan.before, this.shiftOf(before), this.docLength(beforeCm)));
    applyComparisonDecorations(afterCm, shiftComparisonDecorations(plan.after, this.shiftOf(after), this.docLength(afterCm)));
    this.renderBar();
    this.updateScrollLink();
  }

  /**
   * Bascule non destructive entre les deux modes : aucune réouverture,
   * aucun texte modifié, seules les décorations vont et viennent. Au retour
   * en Changements, le changement actif — jamais réinitialisé par le passage
   * en Versions — est recentré des deux côtés, indépendamment.
   */
  setViewMode(mode: ComparisonViewMode): void {
    if (this._viewMode === mode) return;
    this._viewMode = mode;
    this.paint();
    if (mode === "changes") this.recenterOnActive();
  }

  /** Bascule discrète, indépendante des deux modes : ni Changements ni
   * Versions n'imposent son état, chacun garde seulement le sien pour cette
   * comparaison. Jamais un réglage Feuillets. */
  setLinkedScroll(linked: boolean): void {
    if (this.linkedScroll === linked) return;
    this.linkedScrollByMode[this._viewMode] = linked;
    this.updateScrollLink();
    this.renderBar();
  }

  private docLength(view: ComparisonEditorView | null): number { return view?.state?.doc?.length ?? 0; }

  /**
   * Pose ou retire le lien de défilement proportionnel — en réutilisant
   * exactement la mécanique déjà connue du projet pour l'aperçu manuscrit
   * (`scrollProgress`/`scrollTopForProgress`/`findSourceScroller`, voir
   * preview-scroll-sync.ts), jamais une seconde logique parallèle. Repose à
   * chaque peinture : les deux `.cm-scroller` peuvent avoir été recréés.
   * Le recentrage par hunk reste prioritaire — voir `reveal()`, qui suspend
   * ce lien le temps qu'une vue atteigne sa position exacte.
   */
  private updateScrollLink(): void {
    this.scrollLinkCleanup?.(); this.scrollLinkCleanup = null;
    if (!this.linkedScroll) return;
    const before = this.beforeView(); const after = this.afterView();
    // `findSourceScroller` reste générique (testable sans DOM réel) ; appelé
    // ici avec un vrai `contentEl` d'Obsidian, son retour EST un vrai
    // HTMLElement — seul point frontière où ce module quitte le type
    // générique `ScrollLike` pour les événements DOM réels (`addEventListener`),
    // absents de ce type volontairement minimal.
    const first = before ? findSourceScroller(before.contentEl) as HTMLElement | null : null;
    const second = after ? findSourceScroller(after.contentEl) as HTMLElement | null : null;
    if (!first || !second) return;
    let syncing = false;
    const link = (source: HTMLElement & ScrollLike, target: HTMLElement & ScrollLike): (() => void) => {
      const handler = (): void => {
        if (Date.now() < this.scrollLinkSuspendUntil) return;
        if (syncing) { syncing = false; return; }
        syncing = true;
        target.scrollTop = scrollTopForProgress(target, scrollProgress(source));
      };
      source.addEventListener("scroll", handler);
      return () => source.removeEventListener("scroll", handler);
    };
    const releases = [link(first, second), link(second, first)];
    this.scrollLinkCleanup = () => releases.forEach((release) => release());
  }

  /* --- Barre ------------------------------------------------------------ */

  private button(parent: HTMLElement, label: string, onClick: () => void | Promise<void>, cta = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `feuillets-comparison-button${cta ? " mod-cta" : ""}`, text: label });
    button.addEventListener("click", (event) => { event.stopPropagation(); void onClick(); });
    return button;
  }

  /**
   * Bandeau posé en surimpression de la feuille du document COMPARÉ (jamais
   * celle que l'utilisateur édite), en bas et hors du flux : les deux vues
   * Markdown démarrent ainsi exactement à la même hauteur, sous leur en-tête
   * d'onglet natif. Il énonce le sens unique de lecture — AVANT → APRÈS — et
   * ne sert qu'à naviguer : on agit en cliquant la différence, pas ici.
   */
  private renderBar(): void {
    const view = this.comparedView(); const data = this.data;
    if (!view || !data) return;
    const host = view.containerEl;
    if (this.hostEl !== host) { this.hostEl?.removeClass("feuillets-comparison-host"); this.barEl?.remove(); this.barEl = null; this.hostEl = host; host.addClass("feuillets-comparison-host"); }
    if (this.barEl) this.barEl.empty(); else this.barEl = host.createDiv({ cls: "feuillets-comparison-toolbar" });
    const bar = this.barEl;

    // Toujours « AVANT → APRÈS », jamais « ↔ », jamais de flèche inversée :
    // c'est le bandeau qui nomme la convention que le diff applique.
    const titles = bar.createDiv({ cls: "feuillets-comparison-toolbar-group" });
    const snapshotPicker = this.spec.kind === "snapshot" && data.snapshots.length > 1;
    const title = (parent: HTMLElement, text: string): void => { parent.createSpan({ cls: "feuillets-comparison-title", text }); };
    const picker = (parent: HTMLElement): void => {
      const dropdown = new DropdownComponent(parent);
      data.snapshots.forEach((snapshot, index) => { dropdown.addOption(snapshot.path, index === 0 ? `${snapshot.basename} ${t("modal.diff.mostRecent")}` : snapshot.basename); });
      dropdown.setValue(data.snapshotPath ?? data.snapshots[0].path);
      dropdown.onChange((value) => { void this.chooseSnapshot(value); });
    };
    if (this.comparedIsBefore) {
      if (snapshotPicker) picker(titles); else title(titles, data.title);
      titles.createSpan({ cls: "feuillets-comparison-readonly", text: t("comparison.readOnly") });
      titles.createSpan({ cls: "feuillets-comparison-arrow", text: "→" });
      title(titles, t("comparison.currentLabel"));
    } else {
      title(titles, t("comparison.yourText"));
      titles.createSpan({ cls: "feuillets-comparison-arrow", text: "→" });
      title(titles, data.title);
      titles.createSpan({ cls: "feuillets-comparison-readonly", text: t("comparison.readOnly") });
    }
    if (this.spec.kind === "native-review") titles.createSpan({ cls: "feuillets-comparison-summary", text: comparisonSummaryLabel(data.pendingChanges, data.pendingNotes) });

    const right = bar.createDiv({ cls: "feuillets-comparison-toolbar-group" });
    this.renderModeToggle(right);
    // Précédent/Suivant n'a de sens que là où il y a quelque chose à
    // parcourir : aucune décoration en mode Versions, donc aucun bouton.
    if (this.viewMode === "changes" && data.changes.some((change) => !change.handled)) {
      for (const [icon, direction] of [["chevron-up", -1], ["chevron-down", 1]] as Array<[string, -1 | 1]>) {
        const step = right.createEl("button", { cls: "feuillets-comparison-icon-button", attr: { "aria-label": t(direction === 1 ? "nativeReview.action.next" : "nativeReview.action.previous") } });
        setIcon(step, icon);
        const target = adjacentComparisonChange(data.changes, this.activeIndex, direction);
        step.disabled = target === null;
        step.addEventListener("click", () => { this.selectAndRecenter(target); });
      }
    }
    // « Terminer la relecture » et le menu (restaurer tout, fermer) restent
    // dans les deux modes : ce sont des actions GLOBALES à la comparaison,
    // jamais liées à un changement précis.
    if (this.spec.kind === "native-review") this.button(right, t("nativeReview.action.finishReview"), () => this.finish(), true);
    this.renderLinkedScrollToggle(right);
    const more = right.createEl("button", { cls: "feuillets-comparison-icon-button", attr: { "aria-label": t("comparison.more") } });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (event) => this.showMenu(event));
  }

  /** Contrôle discret Changements | Versions — pas de toolbar flottante,
   * juste deux boutons dans le bandeau existant. */
  private renderModeToggle(parent: HTMLElement): void {
    const group = parent.createDiv({ cls: "feuillets-comparison-mode-toggle" });
    for (const mode of ["changes", "versions"] as const) {
      const active = this.viewMode === mode;
      const label = t(mode === "changes" ? "comparison.modeChanges" : "comparison.modeVersions");
      const button = group.createEl("button", { cls: `feuillets-comparison-mode-button${active ? " is-active" : ""}`, text: label, attr: { "aria-pressed": String(active) } });
      button.addEventListener("click", (event) => { event.stopPropagation(); this.setViewMode(mode); });
    }
  }

  /** ⛓ Défilement lié — une option, jamais un troisième mode : disponible
   * aussi bien en Changements qu'en Versions, avec son propre état par mode
   * (voir `linkedScrollByMode`). */
  private renderLinkedScrollToggle(parent: HTMLElement): void {
    const active = this.linkedScroll;
    const button = parent.createEl("button", { cls: `feuillets-comparison-icon-button feuillets-comparison-scroll-link${active ? " is-active" : ""}`, attr: { "aria-label": t("comparison.linkedScroll"), "aria-pressed": String(active) } });
    setIcon(button, "link");
    button.addEventListener("click", (event) => { event.stopPropagation(); this.setLinkedScroll(!this.linkedScroll); });
  }

  private async chooseSnapshot(path: string): Promise<void> {
    if (this.spec.kind !== "snapshot" || path === this.data?.snapshotPath) return;
    const spec: ComparisonSpec = { ...this.spec, snapshotPath: path };
    await this.close();
    await ComparisonSession.open(this.app, this.plugin, spec);
  }

  /* --- Navigation ------------------------------------------------------- */

  /**
   * Sélectionner un changement ouvre son cartouche — jamais plus. Le
   * recentrage est un geste EXPLICITE et séparé (double-clic, Précédent/
   * Suivant — voir `recenterOnActive`) : un simple clic n'a plus besoin de
   * faire sauter les deux vues quand elles sont déjà sous les yeux.
   */
  private select(index: number | null): void {
    this.activeIndex = index;
    this.paint();
  }

  /**
   * Recentre les deux vues sur le changement actif, chacune INDÉPENDAMMENT :
   * on ne synchronise jamais les documents entiers, seulement le hunk en
   * cours. Pour une suppression, la vue où le passage n'existe plus se
   * recentre quand même sur le point où il a disparu (curseur, sans
   * sélection) — les deux moitiés du changement restent face à face. C'est
   * ce qui rend un couper/coller compréhensible même séparé de plusieurs
   * milliers de caractères. N'agit qu'en mode Changements : Versions n'a pas
   * de changement actif à montrer.
   */
  private recenterOnActive(): void {
    if (this._viewMode !== "changes") return;
    const change = this.activeIndex === null ? null : this.data?.changes.find((item) => item.index === this.activeIndex);
    if (!change) return;
    // Le défilement lié se tait pendant que les deux vues rejoignent leur
    // position exacte, indépendamment l'une de l'autre — il reprend ensuite,
    // sans avoir interféré avec le recentrage lui-même.
    this.scrollLinkSuspendUntil = Date.now() + SCROLL_SYNC_SUSPEND_MS;
    const placement = comparisonPlacements(change, this.mode);
    const source = this.sourceView();
    this.reveal(this.beforeView(), placement.before, source === this.beforeView());
    this.reveal(this.afterView(), placement.after, source === this.afterView());
  }

  /** Sélectionne (si besoin) ET recentre — le chemin du double-clic et de
   * Précédent/Suivant. Toujours équivalent à `select` suivi de
   * `recenterOnActive`, jamais dupliqué ailleurs. */
  private selectAndRecenter(index: number | null): void {
    this.select(index);
    this.recenterOnActive();
  }

  /** Amène le passage sous les yeux, centré dans SON propre viewport
   * (`scrollIntoView(range, true)`) — jamais une position calquée sur
   * l'autre colonne. La sélection native n'est posée que dans le vrai
   * feuillet — le document comparé n'est pas modifiable, et une sélection y
   * ferait croire le contraire. */
  private reveal(view: MarkdownView | null, placement: ComparisonPlacement, selectIt: boolean): void {
    if (!view || placement.start === undefined || placement.end === undefined) return;
    const shift = this.shiftOf(view);
    const from = view.editor.offsetToPos(placement.start + shift);
    const to = view.editor.offsetToPos(Math.max(placement.start, placement.end) + shift);
    if (selectIt) view.editor.setSelection(from, to);
    view.editor.scrollIntoView({ from, to }, true);
  }

  /* --- Actions ---------------------------------------------------------- */

  private onClick(detail: ComparisonClickDetail): void {
    if (detail.path !== this.sourcePath && detail.path !== this.comparedPath) return;
    if (detail.action === "note") { this.openNote(detail); return; }
    // Simple clic : sélectionne, ouvre le cartouche — jamais de recentrage
    // forcé. Un second clic sur le même changement le referme (bascule).
    if (detail.action === "select") { this.select(detail.index === this.activeIndex ? null : detail.index); return; }
    // Double-clic : recentre explicitement — jamais une décision.
    if (detail.action === "recenter") { this.selectAndRecenter(detail.index); return; }
    // Fermer le cartouche (×, Escape, clic hors de toute décoration) ne
    // décide jamais rien, n'écrit jamais rien : juste refermer, s'il y a
    // quelque chose à refermer.
    if (detail.action === "dismiss") { if (this.activeIndex !== null) this.select(null); return; }
    const change = this.data?.changes.find((item) => item.index === detail.index);
    if (!change) return;
    if (detail.action === "restore") void this.restore(change);
    else void this.decide(change, detail.action === "apply" ? "accepted" : "rejected");
  }

  private async decide(change: ComparisonChange, decision: "accepted" | "rejected"): Promise<void> {
    if (this.spec.kind !== "native-review") return;
    try { await decideNativeReviewAuthorGroup(this.app, this.plugin.settings, this.spec.reviewId, this.spec.documentId, change.changeIndexes, decision, nativeReviewLocationFromRoot(this.spec.sessionsRootPath)); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return; }
    await this.plugin.refreshNativeReviewDecorations?.();
    await this.advance(change.index);
  }

  /** Écrit un passage du snapshot dans le vrai fichier — le SEUL fichier que
   * la comparaison modifie jamais — après un instantané de sécurité pris une
   * seule fois par comparaison. */
  private async restore(change: ComparisonChange): Promise<void> {
    if (this.spec.kind !== "snapshot" || this.spec.allowRestore === false) return;
    const file = this.sourceFile(); const root = this.plugin.getProjectFolder?.() ?? null;
    if (!file || change.leftStart === undefined || change.leftEnd === undefined) return;
    const raw = await this.app.vault.read(file); const body = stripFrontmatter(raw);
    if (body.slice(change.leftStart, change.leftEnd) !== change.oldText) { new Notice(t("comparison.passageChanged")); await this.reload(); return; }
    const nextBody = this.restoredBody(body, change);
    try {
      if (root instanceof TFolder && !this.snapshotTaken) { await snapshotFile(this.app, file, root); this.snapshotTaken = true; }
      await this.app.vault.modify(file, raw.slice(0, raw.length - body.length) + nextBody);
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return; }
    await this.advance(change.index);
  }

  /** Un déplacement se restaure comme un déplacement : le passage part de son
   * origine ET revient à sa destination — jamais une réécriture sur place
   * (`oldText === newText` pour un déplacement, une simple substitution à
   * `leftStart` laisserait donc le texte inchangé). Même technique que
   * `decideNativeReviewAuthorGroup` : les positions sont traitées de la plus
   * tardive à la plus précoce pour ne jamais invalider les suivantes. */
  private restoredBody(body: string, change: ComparisonChange): string {
    const edits = change.kind === "move" && change.moveTo
      ? [{ start: change.leftStart!, end: change.leftEnd!, text: "" }, { start: change.moveTo.start, end: change.moveTo.end, text: change.newText }]
      : [{ start: change.leftStart!, end: change.leftEnd!, text: change.newText }];
    let next = body;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    return next;
  }

  private async advance(from: number): Promise<void> {
    await this.reload();
    if (this.closing) return;
    this.selectAndRecenter(this.data ? nextPendingComparisonChange(this.data.changes, from) : null);
  }

  private openNote(detail: ComparisonClickDetail): void {
    const note = this.data?.notes[detail.index]; if (!note) return;
    const menu = new Menu();
    for (const message of note.messages) menu.addItem((item) => item.setTitle(`${message.author} : ${message.text.replace(/\s+/g, " ").trim().slice(0, 120)}`).setDisabled(true));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("nativeReview.action.handled")).setIcon("check").onClick(() => void this.handleNote(note.threadId)));
    menu.showAtPosition({ x: detail.x ?? 0, y: detail.y ?? 0 });
  }

  private async handleNote(threadId: string): Promise<void> {
    if (this.spec.kind !== "native-review") return;
    try { await setNativeReviewThreadResolved(this.app, this.spec.reviewId, threadId, true, nativeReviewLocationFromRoot(this.spec.sessionsRootPath)); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return; }
    await this.plugin.refreshNativeReviewDecorations?.();
    await this.reload();
  }

  private showMenu(event: MouseEvent): void {
    const menu = new Menu();
    if (this.spec.kind === "snapshot" && this.spec.allowRestore !== false && this.data) {
      menu.addItem((item) => item.setTitle(t("modal.diff.restoreSnapshot")).setIcon("history").onClick(() => this.confirmRestoreAll()));
    }
    menu.addItem((item) => item.setTitle(t("modal.close")).setIcon("x").onClick(() => void this.close()));
    menu.showAtMouseEvent(event);
  }

  private confirmRestoreAll(): void {
    const file = this.sourceFile(); const data = this.data; const root = this.plugin.getProjectFolder?.() ?? null;
    const snapshot = data?.snapshotPath ? this.app.vault.getAbstractFileByPath(data.snapshotPath) : null;
    if (!file || !(snapshot instanceof TFile)) return;
    new ConfirmModal(this.app, t("modal.diff.restoreSnapshot"), t("modal.diff.restoreConfirm", { snapshot: snapshot.basename, current: file.basename }), t("modal.diff.restoreSnapshot"), async () => {
      if (root instanceof TFolder) await snapshotFile(this.app, file, root);
      await this.app.vault.modify(file, await this.app.vault.read(snapshot));
      new Notice(t("modal.diff.restoredNotice", { name: snapshot.basename }));
      await this.reload();
    }).open();
  }

  private async finish(force = false): Promise<void> {
    if (this.spec.kind !== "native-review") return;
    try { await completeNativeReviewSession(this.app, this.spec.reviewId, { force, location: nativeReviewLocationFromRoot(this.spec.sessionsRootPath) }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!force && /non trait/.test(message)) new ConfirmModal(this.app, t("nativeReview.complete.title"), t("nativeReview.complete.leftovers", { detail: message }), t("nativeReview.complete.force"), () => this.finish(true)).open();
      else new Notice(message);
      return;
    }
    await this.plugin.refreshNativeReviewDecorations?.();
    await this.close();
  }
}

/**
 * Ouvre la comparaison : la vraie feuille Markdown du feuillet à gauche, une
 * autre vraie feuille Markdown à droite. Obsidian rend les deux textes ;
 * Feuillets n'ajoute que le diff et les actions.
 */
export async function openFeuilletsComparison(app: App, plugin: ComparisonPlugin, spec: ComparisonSpec): Promise<ComparisonSession | null> {
  return ComparisonSession.open(app, plugin, spec);
}

export async function closeFeuilletsComparison(): Promise<void> {
  await ComparisonSession.current?.close();
}

/** Entrée Snapshots : remplace l'ancien DiffModal, mêmes arguments d'appel. */
export async function openSnapshotComparison(app: App, plugin: ComparisonPlugin, file: TFile, initialSnapshot?: TFile, allowRestore = true): Promise<void> {
  // Appelée en « fire and forget » depuis plusieurs menus : un échec doit se
  // voir, jamais devenir un rejet de promesse silencieux.
  try {
    const snapshots = listSnapshotFiles(app, file, plugin.getProjectFolder?.() ?? null);
    if (!snapshots.length) { new Notice(t("modal.diff.noSnapshotAvailable")); return; }
    await openFeuilletsComparison(app, plugin, { kind: "snapshot", sourcePath: file.path, snapshotPath: (initialSnapshot ?? snapshots[0]).path, allowRestore });
  } catch (error) {
    console.error("Feuillets: comparison could not be opened", error);
    new Notice(t("comparison.openFailed"));
  }
}
