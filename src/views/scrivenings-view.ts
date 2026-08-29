import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ItemView, MarkdownView, Notice, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { VIEW_SCRIVENINGS } from "../constants.js";
import { resolveCompileScopeFiles, createSelectionScope, createFileScope, type CompileScope } from "../services/compile-scope.js";
import {
  applyCompositeChanges,
  compositeOffsetToLocation,
  loadScriveningsDocument,
  locationToCompositeOffset,
  resolveScriveningsWrite,
  segmentAt,
  type ScriveningsChange,
  type ScriveningsDocument,
  type ScriveningsEditResult,
  type ScriveningsSegment,
} from "../services/scrivenings-document.js";
import { shortTitleFor, splitFrontmatter } from "../services/frontmatter.js";
import { roleOfFile } from "../services/folder-structure.js";
import { createScriveningsEnterTypographyExtension, createScriveningsExtensions, scriveningsChangeListener, setScriveningsDecorations } from "../utils/cm-scrivenings.js";
import type { ScriveningsImageResolver } from "../utils/cm-scrivenings-markdown.js";
import {
  getScriveningsScrollAnchor,
  scrollScriveningsToAnchor,
  type ScriveningsBlockInfo,
  type ScriveningsScrollAnchor,
} from "../utils/cm-scrivenings-scroll.js";
import {
  computeScriveningsWordCounts,
  scriveningsStatsFromCounts,
  updateScriveningsWordCounts,
  type ScriveningsStats,
  type ScriveningsWordCounts,
} from "../utils/scrivenings-stats.js";
import {
  annotationHighlightField,
  annotationDoubleClickExtension,
  applyAnnotationHighlights,
  type AnnotationHighlightInput,
  type AnnotationDecorationTarget,
  type AnchorRect,
} from "../utils/cm-annotation-highlighter.js";
import { loadAnnotations, annotationsForFile, resolveAnnotation, toManuscriptRelativePath } from "../services/annotations.js";
import { t } from "../i18n/index.js";

/**
 * ScriveningsView — LOT 1 (cœur technique uniquement).
 *
 * Un seul `EditorView` CodeMirror pour tout un scope de compilation (voir
 * `CompileScope`, services/compile-scope.ts) : chaque vrai fichier Markdown
 * reste l'unique source de vérité, jamais un fichier composite sur disque.
 * Le texte affiché est construit par services/scrivenings-document.ts
 * (corps seuls, jamais le frontmatter) ; les frontières entre fichiers sont
 * des décorations CodeMirror non éditables (utils/cm-scrivenings.ts).
 *
 * La logique de sauvegarde différée par fichier (`ScriveningsSession`,
 * ci-dessous) est délibérément SÉPARÉE de la classe `ItemView`/CodeMirror :
 * aucune dépendance à un `EditorView` réel, donc testable directement (voir
 * test/scrivenings-session.test.js) sans le CodeMirror que seul Obsidian
 * fournit réellement à l'exécution.
 *
 * HORS PÉRIMÈTRE de ce lot, volontairement : intégration Binder, synchro
 * Preview, annotations, relecture, comparaison, recherche composite.
 */

/** Délai de sauvegarde différée après la dernière frappe dans un segment. */
const SAVE_DEBOUNCE_MS = 800;

/**
 * Cible de restauration de la position de lecture après une recomposition
 * (§5 du lot 2B.2) — fonction PURE, testable sans CodeMirror ni Vault :
 *
 * - aucune ancre précédente (aucun scope chargé avant) → `null` ;
 * - le feuillet précédemment visible existe toujours dans la nouvelle
 *   composition → RESTE dessus, à EXACTEMENT la même progression (couvre
 *   aussi bien un retrait d'un AUTRE feuillet qu'un ajout, où que ce soit
 *   dans l'ordre, y compris avant la position courante) ;
 * - retiré → cherche dans l'ANCIEN ordre, à partir de sa position, le
 *   prochain feuillet encore présent dans la nouvelle composition, sinon le
 *   précédent, sinon aucune cible (`null`) — restaurée avec `progress = 0`
 *   dans les deux premiers cas : ce n'est plus le même texte, y répéter
 *   l'ancienne progression n'aurait aucun sens.
 */
export function nextScrollAnchorAfterRecomposition(
  previousAnchor: ScriveningsScrollAnchor | null,
  previousOrder: readonly string[],
  newMemberPaths: readonly string[]
): ScriveningsScrollAnchor | null {
  if (!previousAnchor) return null;
  if (newMemberPaths.includes(previousAnchor.path)) return previousAnchor;

  const idx = previousOrder.indexOf(previousAnchor.path);
  if (idx === -1) return null;

  for (let i = idx + 1; i < previousOrder.length; i++) {
    if (newMemberPaths.includes(previousOrder[i])) return { path: previousOrder[i], progress: 0 };
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (newMemberPaths.includes(previousOrder[i])) return { path: previousOrder[i], progress: 0 };
  }
  return null;
}

export type ScriveningsViewPlugin = {
  app: App;
  settings: FeuilletsSettings;
  /** Rafraîchit la status bar de l'écriture (main.ts) — appelé après une
   * modification du document Continu ou une recomposition du groupe (§8 du
   * lot 2B.2). Optionnel : les tests peuvent passer un plugin minimal sans
   * cette méthode, `openScope`/`handleEditorChanges` l'appellent alors
   * simplement en no-op via l'accès optionnel ci-dessous. */
  updateStatusBar?: () => void | Promise<void>;
  /** Réapplique les classes body qui pilotent la typographie live
   * (justification, interligne, largeur de texte…) — main.ts#applyLiveTypoClasses.
   * Optionnel, même patron que `updateStatusBar` ci-dessus : appelé par
   * `ScriveningsView.refreshHostTypography()` (voir plus bas), jamais depuis
   * ce module directement. Aucune règle CSS ni valeur typographique ici,
   * seulement le point d'injection. */
  applyLiveTypoClasses?: () => void;
  /** Idem pour la classe `feuillets-indent` — main.ts#applyIndentClass. */
  applyIndentClass?: () => void;
  /** LOT 3 — pont Continu → Preview (main.ts#syncExistingPreviewScope) :
   * transmet un scope déjà résolu par Continu au SEUL Preview déjà ouvert
   * sur ce même projet, sans jamais en créer, activer ni déplacer un —
   * Continu ne doit JAMAIS ouvrir Preview automatiquement. Optionnel, même
   * patron que les hooks ci-dessus : les tests peuvent passer un plugin
   * minimal sans lui. */
  syncExistingPreviewScope?: (scope: CompileScope, anchor?: ScriveningsScrollAnchor | null) => Promise<void>;
  /** LOT 3 — pont Continu → Preview (main.ts#notifyContinuDocumentChanged) :
   * signale une frappe ACCEPTÉE (jamais rejetée par le boundary guard) à un
   * Preview déjà chargé du même projet, pour son rafraîchissement différé
   * (~850 ms, voir PreviewView.onContinuDocumentChanged). Ne sauvegarde
   * rien, ne compile rien ici. */
  notifyContinuDocumentChanged?: (paths: readonly string[]) => void;
  /** LOT 1.4 — menu contextuel Continu (main.ts#showScriveningsContextMenu) :
   * construit et affiche le `Menu` Obsidian propre à Continu (Couper/Copier/
   * Coller, Note de bas de page, Annotation, Noter une idée, Réorganiser le
   * texte) à la place du menu natif Electron/macOS. Optionnel, même patron
   * que les hooks ci-dessus : sans lui, le listener `contextmenu` de
   * ScriveningsView ne fait rien (voir installContextMenuListener). */
  showScriveningsContextMenu?: (view: ScriveningsView, event: MouseEvent) => void;
  /** LOT 1.4 — double-clic sur une annotation DANS Continu (main.ts#openScriveningsAnnotation) :
   * ouvre le MÊME AnnotationPopover que dans un MarkdownView (openAnnotationEditor),
   * jamais un second popover. Optionnel, même patron que les hooks ci-dessus. */
  openScriveningsAnnotation?: (
    view: ScriveningsView,
    id: string,
    anchor: AnchorRect | AnnotationDecorationTarget
  ) => void;
};

/** LOT 1.4 (§7) : contexte résolu d'un clic droit dans Continu — le segment
 * concerné et les trois systèmes de coordonnées équivalents (composite,
 * body local, fichier réel frontmatter compris). Jamais un second calcul de
 * segment ailleurs : `ScriveningsView.resolveEditorContext` est l'unique
 * point de résolution. */
export interface ScriveningsEditorContext {
  file: TFile;
  segment: ScriveningsSegment;
  compositeOffset: number;
  bodyOffset: number;
  fileOffset: number;
}

export interface ScriveningsSessionDeps {
  app: App;
  debounceMs?: number;
  /** Points d'injection pour les tests — par défaut `window.set/clearTimeout`. */
  scheduleTimeout?: (cb: () => void, ms: number) => number;
  cancelTimeout?: (id: number) => void;
  /** Par défaut : `new Notice(message)`. */
  notify?: (message: string) => void;
}

/**
 * Gère, pour UN scope ouvert, le document composite en mémoire et la
 * redistribution des éditions vers les vrais fichiers — sans jamais toucher
 * CodeMirror. Instanciée et pilotée par `ScriveningsView`, qui lui
 * transmet les changements convertis par `scriveningsChangeListener`
 * (utils/cm-scrivenings.ts).
 */
export class ScriveningsSession {
  document: ScriveningsDocument | null = null;

  private readonly app: App;
  private readonly debounceMs: number;
  private readonly scheduleTimeout: (cb: () => void, ms: number) => number;
  private readonly cancelTimeout: (id: number) => void;
  private readonly notify: (message: string) => void;

  /** Dernier corps connu ACTUELLEMENT sur disque pour chaque chemin — la
   * référence contre laquelle `resolveScriveningsWrite` détecte une
   * modification externe. Mise à jour au chargement et après chaque
   * écriture réussie ; JAMAIS après une simple frappe locale. */
  private readonly savedBodies = new Map<string, string>();
  private readonly dirtyPaths = new Set<string>();
  private saveTimer: number | null = null;

  constructor(deps: ScriveningsSessionDeps) {
    this.app = deps.app;
    this.debounceMs = deps.debounceMs ?? SAVE_DEBOUNCE_MS;
    this.scheduleTimeout = deps.scheduleTimeout ?? ((cb, ms) => window.setTimeout(cb, ms));
    this.cancelTimeout = deps.cancelTimeout ?? ((id) => window.clearTimeout(id));
    this.notify = deps.notify ?? ((message) => new Notice(message));
  }

  get dirtyCount(): number {
    return this.dirtyPaths.size;
  }

  isDirty(path: string): boolean {
    return this.dirtyPaths.has(path);
  }

  /** Charge un nouveau document composite — remet la référence de
   * sauvegarde à zéro sur le corps tel que lu à l'instant. N'écrit jamais :
   * c'est à l'appelant d'avoir flush() la session précédente avant. */
  load(document: ScriveningsDocument): void {
    this.cancelScheduledSave();
    this.document = document;
    this.savedBodies.clear();
    for (const segment of document.segments) this.savedBodies.set(segment.path, segment.body);
    this.dirtyPaths.clear();
  }

  /**
   * Applique un lot de changements composites (coordonnées avant édition,
   * voir `scriveningsChangesFromTransaction`) au document en mémoire, marque
   * les fichiers réellement touchés comme modifiés, et programme leur
   * sauvegarde différée. Retourne `null` si le lot a été rejeté (frontière
   * franchie) — ne devrait normalement jamais arriver : `scriveningsBoundaryGuard`
   * a déjà dû bloquer la transaction CodeMirror correspondante.
   */
  handleChanges(changes: readonly ScriveningsChange[]): ScriveningsEditResult | null {
    if (!this.document) return null;
    const result = applyCompositeChanges(this.document, changes);
    if (!result) return null;

    this.document = result.document;
    if (result.touchedPaths.length > 0) {
      for (const path of result.touchedPaths) this.dirtyPaths.add(path);
      this.scheduleSave();
    }
    return result;
  }

  private scheduleSave(): void {
    this.cancelScheduledSave();
    this.saveTimer = this.scheduleTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private cancelScheduledSave(): void {
    if (this.saveTimer !== null) {
      this.cancelTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Écrit immédiatement tous les segments actuellement marqués comme
   * modifiés — jamais un fichier non touché. À appeler à la fermeture de la
   * vue et avant tout changement de scope, en plus du minuteur différé.
   *
   * Un chemin n'est retiré de `dirtyPaths` QUE si son écriture a réellement
   * réussi (voir `saveSegment`) : un conflit externe ou une erreur de
   * `Vault.process()` le laisse dirty, pour qu'un flush ultérieur (minuteur,
   * fermeture, changement de scope) retente — jamais de modification locale
   * non sauvegardée qui deviendrait silencieusement « clean ».
   */
  async flush(): Promise<void> {
    this.cancelScheduledSave();
    if (!this.document || this.dirtyPaths.size === 0) return;

    // Copie du lot à traiter : un segment ré-édité PENDANT ce flush (donc
    // remis dirty après coup, ex. par un handleChanges() concurrent) ne doit
    // pas être retiré par erreur si sa propre écriture réussit ici — voir
    // saveSegment(), qui ne supprime que le chemin qu'il vient d'écrire.
    const paths = [...this.dirtyPaths];

    for (const path of paths) {
      const segment = this.document.segments.find((s) => s.path === path);
      if (!segment) {
        this.dirtyPaths.delete(path);
        continue;
      }
      await this.saveSegment(segment);
    }
  }

  /** Écrit UN segment. Ne retire `segment.path` de `dirtyPaths` qu'en cas de
   * succès effectif — jamais avant, jamais en cas de conflit ou d'erreur
   * d'écriture (voir la note de flush() ci-dessus). */
  private async saveSegment(segment: ScriveningsSegment): Promise<void> {
    const knownBody = this.savedBodies.get(segment.path) ?? "";
    let conflict = false;

    try {
      await this.app.vault.process(segment.file, (current) => {
        const result = resolveScriveningsWrite(current, knownBody, segment.body);
        if (result.conflict) {
          conflict = true;
          return current;
        }
        return result.content;
      });
    } catch (error) {
      console.error("Feuillets : échec d'écriture Scrivenings", error);
      this.notify(t("scrivenings.saveError", { name: segment.file.basename }));
      return;
    }

    if (conflict) {
      this.notify(t("scrivenings.saveConflict", { name: segment.file.basename }));
      return;
    }

    this.savedBodies.set(segment.path, segment.body);
    this.dirtyPaths.delete(segment.path);
  }

  /** Annule tout minuteur en attente, sans écrire — utilisé quand la vue se
   * ferme APRÈS avoir déjà flush() explicitement. */
  destroy(): void {
    this.cancelScheduledSave();
  }
}

/* --- Typage local de la surface CodeMirror réellement utilisée ---------- */

interface EditorStateInstance {
  readonly doc: { length: number; toString(): string; sliceString(from: number, to?: number): string };
  /* Surface PUBLIQUE CodeMirror utilisée par le contexte de clic (LOT 1.4,
     §9) et par ScriveningsSegmentEditorAdapter — jamais un second système de
     sélection : `main` est le SEUL curseur/plage réellement pertinent, une
     multi-sélection composite n'existe pas dans Continu. */
  readonly selection: { readonly main: { readonly from: number; readonly to: number; readonly empty: boolean } };
  /* API PUBLIQUE CodeMirror — lit un StateField, ici uniquement
     `paragraphReorderModeField` (main.ts#showScriveningsContextMenu, pour
     cocher l'entrée « Réorganiser le texte » selon l'état déjà actif). */
  field(field: unknown, required: false): unknown;
}
interface EditorStateStatic {
  create(config: { doc: string; extensions: unknown[] }): EditorStateInstance;
}
interface EditorViewInstance {
  readonly state: EditorStateInstance;
  /* `selection` : LOT « clic Preview → Continu » (focusSourcePosition) —
     un simple `{ anchor, head? }` reste une `TransactionSpec.selection`
     valide en CodeMirror 6 réel, sans jamais construire d'`EditorSelection`
     ici (surface locale minimale, même patron que le reste de ce typage). */
  dispatch(spec: { effects?: unknown; changes?: unknown; selection?: { anchor: number; head?: number } }): void;
  destroy(): void;
  focus(): void;
  /* Surface de géométrie PUBLIQUE CodeMirror utilisée par
     utils/cm-scrivenings-scroll.ts (LOT 2B.1) — voir ce module pour le
     détail des quatre membres autorisés. Ajoutée ici seulement, jamais
     dans codemirror-runtime.d.ts : ce ne sont pas de nouveaux membres du
     module `@codemirror/view` (déjà déclaré `unknown` là-bas), seulement
     la forme locale, manuelle, qu'on prête à CE cast. */
  readonly scrollDOM: HTMLElement;
  readonly documentTop: number;
  readonly contentHeight: number;
  elementAtHeight(height: number): ScriveningsBlockInfo;
  lineBlockAt(pos: number): ScriveningsBlockInfo;
  /* LOT 1.4 (§6, §9) : DOM racine de l'EditorView — c'est SUR CET ÉLÉMENT
     qu'est installé l'UNIQUE listener `contextmenu` de Continu (jamais sur
     `contentEl`/`scrollDOM` : `dom` couvre toute la zone d'édition réelle,
     y compris les marges internes de CodeMirror). API PUBLIQUE CodeMirror,
     même patron que `scrollDOM` ci-dessus. */
  readonly dom: HTMLElement;
  /* API PUBLIQUE CodeMirror — résout la position composite sous un point
     écran (clic droit), utilisée UNIQUEMENT par `resolveEditorContext`. */
  posAtCoords(coords: { x: number; y: number }): number | null;
}
interface EditorViewCtor {
  new (config: { state: EditorStateInstance; parent: HTMLElement }): EditorViewInstance;
  /* API STATIQUE (LOT « clic Preview → Continu », focusSourcePosition) :
     centre le passage cliqué dans le viewport Continu. Même principe que
     le reste de ce typage manuel — pas un nouveau membre du module
     `@codemirror/view` (déjà `unknown` dans codemirror-runtime.d.ts),
     seulement la forme locale prêtée à ce cast. */
  scrollIntoView(pos: number, options?: { y?: "center" }): unknown;
}

const EditorStateTyped = EditorState as EditorStateStatic;
const EditorViewCtorTyped = EditorView as EditorViewCtor;

/** Position `{ line, ch }` (0-based, coordonnées du FICHIER MARKDOWN
 * ORIGINAL — même contrat que `SourceBlockPosition`, preview-source-map.ts)
 * → offset dans `text`. Pure, jamais liée à CodeMirror : `text` n'est ici
 * qu'une chaîne JS ordinaire (voir `ScriveningsView.focusSourcePosition`,
 * qui l'appelle sur une source virtuelle jamais écrite). Borne toute
 * position hors limites plutôt que de lever — un repère de source
 * légèrement périmé (édition externe entre-temps) ne doit jamais faire
 * échouer la navigation, seulement l'approcher au plus près. CRLF : `\r`
 * éventuel reste porté par la ligne qui le précède, exactement comme le
 * compte Obsidian lui-même (`SectionCache.position`) — aucun traitement
 * spécial requis au-delà du simple découpage sur `\n`. */
function offsetForLineCol(text: string, line: number, ch: number): number {
  const lines = text.split("\n");
  const clampedLine = Math.max(0, Math.min(line, lines.length - 1));
  let offset = 0;
  for (let i = 0; i < clampedLine; i++) offset += lines[i].length + 1;
  const lineText = lines[clampedLine] ?? "";
  const clampedCh = Math.max(0, Math.min(ch, lineText.length));
  return offset + clampedCh;
}

export class ScriveningsView extends ItemView {
  private readonly plugin: ScriveningsViewPlugin;
  private readonly session: ScriveningsSession;
  private _compileScope: CompileScope | null = null;
  private cm: EditorViewInstance | null = null;
  /** Comptes de mots par fichier — recalcul complet au chargement/à la
   * recomposition (`computeScriveningsWordCounts`), incrémental à chaque
   * édition (`updateScriveningsWordCounts`, voir handleEditorChanges) : voir
   * utils/scrivenings-stats.ts, §6 du lot 2B.2. */
  private wordCounts: ScriveningsWordCounts = new Map();
  /** Sérialise les mutations de composition (toggleMember) : deux clics
   * rapides doivent produire l'état correspondant aux DEUX opérations, dans
   * leur ordre d'arrivée — jamais de course entre plusieurs openScope()
   * concurrents (§4 du lot 2B.2). */
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(leaf: WorkspaceLeaf, plugin: ScriveningsViewPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.session = new ScriveningsSession({ app: plugin.app });
  }

  /** Scope de compilation actuellement affiché, ou `null` avant tout
   * `openScope()`. Lu par `FeuilletsPlugin.isActiveFileInProject()` : une
   * vue Scrivenings avec un scope valide EST un contexte projet, quel que
   * soit le dernier vrai fichier Markdown actif — voir main.ts. */
  get compileScope(): CompileScope | null {
    return this._compileScope;
  }

  /** L'unique EditorView CodeMirror de ce Continu, ou `null` avant tout
   * `openScope()` (ou après `onClose()`) — accès public réservé aux
   * commandes qui doivent piloter directement CodeMirror (ex. le mode
   * « Réorganiser le texte », voir main.ts `toggleParagraphReorderMode`) :
   * `ScriveningsView` n'est pas un `MarkdownView` Obsidian, elle n'a donc
   * pas d'`Editor` — jamais de second accès non typé à `cm` en dehors de ce
   * module. */
  get editorView(): EditorViewInstance | null {
    return this.cm;
  }

  getViewType(): string {
    return VIEW_SCRIVENINGS;
  }

  getDisplayText(): string {
    return t("scrivenings.display.title");
  }

  getIcon(): string {
    return "layers";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("feuillets-scrivenings-container");
  }

  async onClose(): Promise<void> {
    await this.session.flush();
    this.session.destroy();
    this.destroyEditor();
  }

  /**
   * Vide les écritures en attente de CETTE vue Continu : appelle le
   * `flush()` EXISTANT de `ScriveningsSession` — jamais une seconde logique
   * de sauvegarde — puis retourne `true` si plus aucun fichier n'est dirty,
   * `false` s'il en reste (conflit externe ou erreur `Vault.process()`, la
   * notice a déjà été émise par `saveSegment()` pendant `flush()`). Ne ferme
   * JAMAIS la vue, ne change JAMAIS le scope affiché : un simple vidage.
   * Utilisé par `FeuilletsPlugin.flushContinuWritesForProject()` avant
   * l'export (services/export-workflow.ts).
   */
  async flushPendingWrites(): Promise<boolean> {
    await this.session.flush();
    return this.session.dirtyCount === 0;
  }

  /* ============================ Chargement =========================== */

  /**
   * Ouvre un scope de compilation dans cette vue. Sauvegarde d'abord tout
   * ce qui restait en attente pour le scope précédemment affiché — jamais
   * de perte silencieuse en changeant de scope.
   *
   * SÉCURITÉ (§3 du lot 2B.2) : après `flush()`, si des fichiers restent
   * dirty (conflit externe pendant l'écriture, erreur `Vault.process()`),
   * la reconstruction est ABANDONNÉE — l'`EditorView` vivant, la session, le
   * document en mémoire et `_compileScope` restent strictement inchangés,
   * jamais de texte local perdu. Retourne `false` dans ce cas, `true` sinon.
   * S'applique à TOUT changement de scope (menu Binder, `toggleMember`…),
   * pas seulement à une recomposition manuelle — un seul chemin de code.
   *
   * POSITION DE LECTURE (§5) : l'ancre de défilement et l'ordre des anciens
   * membres sont capturés AVANT flush()/destruction, puis restaurés après
   * montage — voir `nextScrollAnchorAfterRecomposition` ci-dessous. Aucune
   * transaction document n'est jamais produite pour cette restauration
   * (`scrollToAnchor`, utils/cm-scrivenings-scroll.ts).
   */
  async openScope(scope: CompileScope): Promise<boolean> {
    const previousAnchor = this.getScrollAnchor();
    const previousOrder = this.session.document ? this.session.document.segments.map((s) => s.path) : [];

    await this.session.flush();
    if (this.session.dirtyCount > 0) {
      // Conflit ou erreur d'écriture pendant le flush : ne JAMAIS détruire
      // l'éditeur vivant ni charger le nouveau scope — voir le commentaire
      // ci-dessus. La notice de conflit/erreur a déjà été émise par
      // ScriveningsSession.saveSegment() pendant flush().
      return false;
    }

    this.destroyEditor();

    const files = resolveCompileScopeFiles(this.plugin.app, this.plugin.settings, scope);
    const document = await loadScriveningsDocument(this.plugin.app, files);
    this._compileScope = scope;
    this.session.load(document);
    this.wordCounts = computeScriveningsWordCounts(document);

    this.mountEditor();

    const restoreTarget = nextScrollAnchorAfterRecomposition(previousAnchor, previousOrder, this.getMemberPaths());
    if (restoreTarget) {
      const apply = () => this.scrollToAnchor(restoreTarget.path, restoreTarget.progress);
      apply();
      window.requestAnimationFrame(apply);
    }

    void this.plugin.updateStatusBar?.();
    // LOT 3 — pont Continu → Preview : transmet ce MÊME scope, avec la MÊME
    // ancre de restauration que celle que Continu vient d'appliquer — jamais
    // une seconde logique next/previous côté Preview (voir
    // nextScrollAnchorAfterRecomposition ci-dessus, seule source). Ne jamais
    // attendre que Preview ait fini son rendu avant de rendre Continu
    // utilisable : ni `await`, ni blocage du retour de cette méthode.
    void this.plugin.syncExistingPreviewScope?.(scope, restoreTarget);
    // LOT 1.4 (§36) : annotations déjà existantes du nouveau scope, visibles
    // immédiatement — jamais après la première frappe seulement.
    void this.refreshAnnotationHighlights();
    return true;
  }

  private mountEditor(): void {
    const document = this.session.document;
    if (!document) return;

    this.contentEl.empty();
    const host = this.contentEl.createDiv({ cls: "markdown-source-view mod-cm6 feuillets-scrivenings-view" });

    const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"]);
    const imageResolver: ScriveningsImageResolver = (target, _kind, compositeOffset) => {
      if (target.length === 0 || /^https?:\/\//i.test(target)) return /^https?:\/\//i.test(target) ? target : null;
      const segment = segmentAt(document, compositeOffset);
      if (!segment) return null;
      const candidates = [target];
      try {
        const decoded = decodeURIComponent(target);
        if (decoded !== target) candidates.push(decoded);
      } catch {
        return null;
      }
      for (const candidate of candidates) {
        const imageFile = this.plugin.app.metadataCache.getFirstLinkpathDest(candidate, segment.file.path);
        if (!(imageFile instanceof TFile) || !imageExtensions.has(imageFile.extension.toLowerCase())) continue;
        return this.plugin.app.vault.getResourcePath(imageFile);
      }
      return null;
    };

    const extensions = [
      ...createScriveningsExtensions(imageResolver),
      ...createScriveningsEnterTypographyExtension(this.plugin.settings),
      scriveningsChangeListener((changes) => this.handleEditorChanges(changes)),
      // LOT 1.4 (§33) : Continu possède son propre EditorState — jamais
      // `registerEditorExtension()` — ces deux extensions sont donc montées
      // ICI, pas dans `scriveningsExtensions` (cm-scrivenings.ts), qui reste
      // partagée sans callback propre à une instance. Même moteur de
      // décoration/double-clic que le MarkdownView natif (cm-annotation-
      // highlighter.ts) : jamais un second système d'annotation.
      annotationHighlightField,
      annotationDoubleClickExtension((id, target) => this.plugin.openScriveningsAnnotation?.(this, id, target)),
    ];

    const state = EditorStateTyped.create({ doc: document.text, extensions });
    this.cm = new EditorViewCtorTyped({ state, parent: host });
    this.installContextMenuListener();

    setScriveningsDecorations(
      this.cm,
      document,
      (file) => shortTitleFor(this.plugin.app, file) || file.basename,
      // §11 du micro-chantier finition Continu : rôle déjà connu de
      // Feuillets (`roleOfFile`, services/folder-structure.ts) — jamais un
      // second système de rôles, jamais déduit du nom de fichier ici.
      (file) => roleOfFile(this.plugin.app, this.plugin.settings, file)
    );
  }

  /** Référence STABLE du listener effectivement enregistré — jamais
   * `.bind(this)` inline (une nouvelle fonction à chaque appel empêcherait
   * `removeEventListener` de jamais retrouver le même listener). `null`
   * tant qu'aucun listener n'est installé. */
  private boundContextMenuHandler: ((event: MouseEvent) => void) | null = null;

  /** LOT 1.4 (§3, §6) : le clic droit dans Continu doit ouvrir le Menu
   * Obsidian construit par Feuillets — jamais le menu natif Electron/macOS,
   * jamais une tentative de modifier ce dernier. Sans hook plugin
   * (`showScriveningsContextMenu` absent, ex. tests avec un plugin minimal),
   * ce listener ne fait STRICTEMENT rien : le comportement natif Electron
   * reste intercepté nulle part, exactement comme avant ce lot. */
  private handleContextMenuEvent(event: MouseEvent): void {
    if (!this.plugin.showScriveningsContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    this.plugin.showScriveningsContextMenu(this, event);
  }

  private installContextMenuListener(): void {
    this.boundContextMenuHandler = (event: MouseEvent) => this.handleContextMenuEvent(event);
    this.cm?.dom.addEventListener("contextmenu", this.boundContextMenuHandler);
  }

  private destroyEditor(): void {
    // Un seul listener à la fois (§6) : toujours retiré AVANT destroy(),
    // qu'il ait ou non été effectivement appelé depuis le montage — jamais
    // deux instances vivantes en même temps lors d'une recomposition
    // (destroyEditor()/mountEditor() s'enchaînent dans openScope()).
    if (this.boundContextMenuHandler) {
      this.cm?.dom.removeEventListener("contextmenu", this.boundContextMenuHandler);
      this.boundContextMenuHandler = null;
    }
    this.cm?.destroy();
    this.cm = null;
  }

  /** Reçoit les changements composites convertis par `scriveningsChangeListener`
   * (frappe, Undo/Redo — même extension `history()` — voir cm-scrivenings.ts) :
   * les redistribue à la session (sauvegarde différée par fichier), puis ne
   * recalcule que le compte des segments RÉELLEMENT touchés (§6/§7 du lot
   * 2B.2, PERFORMANCE) avant de rafraîchir la barre d'état Feuillets — les
   * statistiques du groupe n'ont plus AUCUN affichage local sous l'éditeur
   * (§8, décision produit définitive) : `getGroupStats()` reste la seule
   * source, lue par main.ts#updateStatusBar(). Jamais `workspace.editor-change`
   * ici : ce custom EditorView n'est pas un Editor Obsidian, cet événement
   * ne se déclenche jamais pour lui — seul ce callback direct informe la
   * status bar (§7 du lot). */
  private handleEditorChanges(changes: readonly ScriveningsChange[]): void {
    const result = this.session.handleChanges(changes);
    if (!result || result.touchedPaths.length === 0) return;

    this.wordCounts = updateScriveningsWordCounts(result.document, result.touchedPaths, this.wordCounts);
    void this.plugin.updateStatusBar?.();
    // LOT 3 — pont Continu → Preview : uniquement pour une modification
    // ACCEPTÉE (le boundary guard a déjà rejeté toute frappe illégitime en
    // amont, avant même d'atteindre ce callback — voir handleChanges() et
    // scriveningsBoundaryGuard, utils/cm-scrivenings.ts). N'attend ni le
    // disque, ni la sauvegarde différée, ne déclenche aucun rendu ici.
    this.plugin.notifyContinuDocumentChanged?.(result.touchedPaths);
  }

  /* ========================= Composition (§2 et §4) ===================
   * La composition affichée par Continu N'EST RIEN d'autre que les segments
   * réellement chargés dans `session.document` — jamais un modèle « dossier
   * moins fichier X » mémorisé à part. Toute modification manuelle
   * reconstruit un scope `selection` de fichiers concrets à partir des
   * chemins ACTUELLEMENT affichés, puis laisse `resolveCompileScopeFiles()`
   * (via `openScope`) remettre les fichiers dans l'ordre canonique du
   * Binder — jamais de duplication d'ordre ici. */

  /** Chemins réels actuellement chargés, dans l'ordre du document composite
   * — vide tant qu'aucun scope n'est chargé (Continu peut rester ouvert
   * avec 0 feuillet, voir toggleMember). */
  getMemberPaths(): readonly string[] {
    return this.session.document ? this.session.document.segments.map((s) => s.path) : [];
  }

  hasMember(path: string): boolean {
    return this.getMemberPaths().includes(path);
  }

  /** LOT 3 — pont Continu → Preview : le corps VIVANT actuellement affiché
   * pour `path` dans Continu (voir PreviewView.readFileForPreview, qui
   * recompose `frontmatter disque + ce corps`). Jamais le frontmatter,
   * jamais une mutation, jamais un flush, jamais de changement de dirty
   * state — une simple lecture de `session.document.segments`. `null` si
   * aucun scope n'est chargé ou si `path` n'appartient pas à la composition
   * actuelle. */
  getLiveBody(path: string): string | null {
    const segment = this.session.document?.segments.find((s) => s.path === path);
    return segment ? segment.body : null;
  }

  /**
   * Ajoute/retire `path` de la composition affichée. Sérialisé via
   * `mutationQueue` (§4) : deux appels rapides s'exécutent STRICTEMENT dans
   * leur ordre d'arrivée, jamais en course — chacun part de la composition
   * REVUE APRÈS résolution du précédent, jamais d'un instantané capturé
   * avant. Retourne `false` sans rien changer si aucun scope n'est encore
   * ouvert, ou si `openScope()` a été bloqué par la sécurité anti-perte du
   * §3 (dirty restant après flush) — dans ce dernier cas, une notice a déjà
   * été émise par la session ; on complète avec un message dédié à la
   * composition.
   */
  async toggleMember(path: string): Promise<boolean> {
    const run = this.mutationQueue.then(() => this.performToggleMember(path));
    // Toujours enchaîné même en cas d'échec d'une opération précédente :
    // une notice affichée ne doit jamais casser la file d'attente pour les
    // suivantes.
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async performToggleMember(path: string): Promise<boolean> {
    if (!this._compileScope) return false;

    const current = this.getMemberPaths();
    const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
    // Aucun doublon possible : `current` vient de segments déjà uniques
    // (un fichier composite par chemin), et `path` n'est ajouté que s'il
    // n'y figurait pas déjà.
    const scope = createSelectionScope(this._compileScope.projectRoot, next);

    const applied = await this.openScope(scope);
    if (!applied) new Notice(t("scrivenings.compositionBlocked"));
    return applied;
  }

  /**
   * Ajoute EN LOT une plage de chemins à la composition affichée, sans
   * jamais retirer un membre déjà présent — micro-correctif "typographie
   * après toggle + Maj+clic en Continu" (§5) : Maj+clic dans un Continu
   * existant doit ajouter toute une plage Binder en UNE SEULE recomposition,
   * jamais un `toggleMember()` par fichier (qui retirerait à tort les
   * chemins déjà membres croisés par la plage). Sérialisé via la MÊME
   * `mutationQueue` que `toggleMember`/`collapseToSingleMember` : jamais de
   * course entre ces trois opérations.
   */
  async addMembers(paths: readonly string[]): Promise<boolean> {
    const run = this.mutationQueue.then(() => this.performAddMembers(paths));
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async performAddMembers(paths: readonly string[]): Promise<boolean> {
    if (!this._compileScope) return false;

    const current = this.getMemberPaths();
    const currentSet = new Set(current);
    // Dédoublonne ET ignore les chemins déjà membres — `next` ne retire
    // jamais rien : seuls des chemins ABSENTS de `current` peuvent y
    // apparaître en plus.
    const additions: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      if (currentSet.has(path) || seen.has(path)) continue;
      seen.add(path);
      additions.push(path);
    }
    if (additions.length === 0) return true;

    const next = [...current, ...additions];
    const scope = createSelectionScope(this._compileScope.projectRoot, next);

    const applied = await this.openScope(scope);
    if (!applied) new Notice(t("scrivenings.compositionBlocked"));
    return applied;
  }

  /**
   * Cas spécial "2 membres → 1" (§9-10 du micro-lot delta "bascule Markdown
   * ↔ Continu") : retirer `removingPath` d'un Continu qui n'en contient que
   * DEUX ferait tomber la composition à un seul segment — un Continu à un
   * seul feuillet n'a plus de sens, la MÊME leaf redevient alors le
   * MarkdownView de l'unique fichier restant. Jamais un `toggleMember()`
   * suivi d'un Continu reconstruit à 1 segment intermédiaire, jamais une
   * autre leaf. Sérialisé via `mutationQueue`, la même file que
   * `toggleMember` : jamais de course entre les deux.
   *
   * Retourne `false` sans RIEN changer (leaf, session, document, scope
   * conservés à l'identique, aucune frappe locale perdue) si :
   * - le document n'a pas exactement ces deux membres ;
   * - `session.flush()` laisse un fichier dirty (conflit externe ou erreur
   *   d'écriture — même sécurité anti-perte que `openScope`, §3 du lot 2B.2).
   */
  async collapseToSingleMember(removingPath: string): Promise<boolean> {
    const run = this.mutationQueue.then(() => this.performCollapseToSingleMember(removingPath));
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async performCollapseToSingleMember(removingPath: string): Promise<boolean> {
    const document = this.session.document;
    if (!document) return false;

    const members = this.getMemberPaths();
    if (members.length !== 2 || !members.includes(removingPath)) return false;

    const remainingPath = members.find((p) => p !== removingPath);
    const remainingSegment = remainingPath ? document.segments.find((s) => s.path === remainingPath) : undefined;
    if (!remainingSegment) return false;

    await this.session.flush();
    if (this.session.dirtyCount > 0) return false;

    // L'ouverture d'un vrai fichier sur CETTE leaf fait basculer Obsidian
    // vers le MarkdownView correspondant (setViewState interne) — cette
    // instance de ScriveningsView devient obsolète, son onClose() (déjà
    // défini plus haut : flush + destroy session/éditeur) est appelé par
    // Obsidian lui-même pendant ce changement de vue, jamais besoin de le
    // dupliquer ici.
    await this.leaf.openFile(remainingSegment.file, { active: true });
    this.plugin.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    return true;
  }

  /**
   * LOT FINAL Binder ↔ Continu, §4 : ouvre `path` SEUL, dans CETTE MÊME
   * leaf — jamais une nouvelle leaf, jamais un Continu reconstruit à 1
   * segment. Contrairement à `collapseToSingleMember` (réservée au cas
   * précis "2 membres → 1"), `openSingleMember` ne regarde PAS la
   * composition actuelle : c'est l'unique chemin du clic simple sur une
   * ligne fichier du Binder pendant que Continu est actif (§3 du lot),
   * quelle que soit la taille du groupe (2 comme 20) et que `path` en soit
   * membre ou non — l'invariant du lot est "1 fichier sélectionné →
   * MarkdownView", jamais conditionné à l'appartenance préalable.
   * Sérialisée via `mutationQueue`, la même file que les autres mutations
   * de composition : jamais de course avec un Maj+clic ou un Cmd/Ctrl+clic
   * concurrent.
   */
  async openSingleMember(path: string): Promise<boolean> {
    const run = this.mutationQueue.then(() => this.performOpenSingleMember(path));
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** Cœur PRIVÉ, appelé aussi bien par `openSingleMember` (public, mis en
   * file) que par `performSetMembers` ci-dessous quand une résolution à un
   * seul chemin doit rouvrir ce même fichier — jamais depuis
   * `performSetMembers` via la méthode PUBLIQUE `openSingleMember`, ce qui
   * chaînerait une seconde entrée sur `mutationQueue` en attente de la
   * première déjà en cours d'exécution (interblocage). */
  private async performOpenSingleMember(path: string): Promise<boolean> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;

    await this.session.flush();
    if (this.session.dirtyCount > 0) {
      // Conflit/erreur d'écriture : la notice a déjà été émise par
      // ScriveningsSession.saveSegment() pendant flush() — même sécurité
      // anti-perte que openScope/collapseToSingleMember, aucune notice
      // supplémentaire ici.
      return false;
    }

    // Capturé AVANT la transition : cette instance de ScriveningsView
    // devient obsolète dès `leaf.openFile()` (voir plus bas), mais ses
    // champs restent lisibles — capturer explicitement évite toute
    // dépendance à cet artefact.
    const projectRoot = this._compileScope?.projectRoot;

    // Même mécanisme que collapseToSingleMember : ouvrir un vrai fichier
    // sur CETTE leaf fait basculer Obsidian vers le MarkdownView
    // correspondant, cette instance devient obsolète (onClose() déjà géré
    // par Obsidian lui-même), jamais besoin de le dupliquer ici.
    await this.leaf.openFile(file, { active: true });
    this.plugin.app.workspace.setActiveLeaf(this.leaf, { focus: true });

    // LOT 3 — pont Continu → Preview : 2+ fichiers → 1 fichier donne le
    // MÊME Preview, reposé sur un fileScope mono-fichier — createFileScope,
    // jamais un second résolveur de scope ici.
    if (projectRoot) {
      void this.plugin.syncExistingPreviewScope?.(createFileScope(projectRoot, path), null);
    }
    return true;
  }

  /**
   * LOT FINAL, §6 : remplace la composition affichée par EXACTEMENT les
   * chemins fournis — jamais un ajout (`addMembers`) ni un toggle unitaire
   * (`toggleMember`) répétés : Maj+clic (plage pouvant s'agrandir ET se
   * réduire, §5/§7) et Cmd/Ctrl+clic (toggle individuel, §8) passent tous
   * les deux par cette seule méthode désormais, en UNE seule recomposition.
   * Sérialisée via `mutationQueue`, la même file que les autres mutations.
   *
   * Résolution (§6) :
   * - dédoublonnée, l'ordre final vient de `resolveCompileScopeFiles` (via
   *   `openScope`), jamais de l'ordre reçu ici ;
   * - 0 chemin résolu → refuse, conserve la composition actuelle
   *   (jamais de Continu vide construit depuis cette méthode) ;
   * - 1 chemin → ouvre CE fichier seul dans la même leaf, chemin sécurisé
   *   partagé avec `openSingleMember` (jamais un Continu à 1 segment) ;
   * - 2+ chemins → `openScope()` d'un scope `selection`, avec la même
   *   protection anti-perte dirty/conflit que toutes les autres mutations.
   */
  async setMembers(paths: readonly string[]): Promise<boolean> {
    const run = this.mutationQueue.then(() => this.performSetMembers(paths));
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async performSetMembers(paths: readonly string[]): Promise<boolean> {
    if (!this._compileScope) return false;

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      deduped.push(path);
    }
    if (deduped.length === 0) return false;

    if (deduped.length === 1) {
      return this.performOpenSingleMember(deduped[0]);
    }

    const scope = createSelectionScope(this._compileScope.projectRoot, deduped);
    const applied = await this.openScope(scope);
    if (!applied) new Notice(t("scrivenings.compositionBlocked"));
    return applied;
  }

  /* ============================ Statistiques (§6) ===================== */

  getGroupStats(): ScriveningsStats {
    if (!this.session.document) return { fileCount: 0, wordCount: 0 };
    return scriveningsStatsFromCounts(this.session.document, this.wordCounts);
  }

  /* ====================== Ancre de défilement (LOT 2B.1) ==================
   * Simples adaptateurs autour de utils/cm-scrivenings-scroll.ts : toute la
   * géométrie (position document, segment visible, progression, position
   * cible) vit dans ce module pur et testable — rien n'est recalculé ici.
   * Aucun listener de scroll pour l'instant : voir le lot 2B.2. */

  /** Élément DOM réellement défilé de Continu, ou `null` si aucun scope
   * n'est chargé (CodeMirror pas encore monté). */
  getScrollElement(): HTMLElement | null {
    return this.cm?.scrollDOM ?? null;
  }

  /** Feuillet actuellement visible et progression verticale dans ce
   * feuillet — `null` si aucun scope n'est chargé. */
  getScrollAnchor(): ScriveningsScrollAnchor | null {
    if (!this.cm || !this.session.document) return null;
    return getScriveningsScrollAnchor(this.cm, this.session.document);
  }

  /** Replace le viewport de Continu sur `path` à `progress` (borné) — jamais
   * de curseur déplacé, jamais de transaction document, jamais de dirty
   * state. Sans effet si `path` n'appartient pas au scope actuellement
   * chargé, ou si aucun scope n'est chargé. */
  scrollToAnchor(path: string, progress: number): void {
    if (!this.cm || !this.session.document) return;
    scrollScriveningsToAnchor(this.cm, this.session.document, path, progress);
  }

  /* ================ LOT « clic Preview → Continu » (§10-16) ==============
   * Navigation SEULEMENT : ne modifie jamais le texte, ne change jamais le
   * scope, ne sauvegarde rien, ne marque rien dirty, ne crée aucune leaf,
   * ne déplace aucun fichier. */

  /**
   * Place le curseur Continu à la position SOURCE Markdown `position`
   * (`{line, ch}`, 0-based — mêmes coordonnées que `SourceBlockPosition`,
   * preview-source-map.ts : celles du FICHIER MARKDOWN ORIGINAL, jamais
   * recalculées depuis un rendu), recentre le viewport et donne le focus.
   * `false` si `path` n'appartient pas à la composition actuellement
   * chargée, ou si aucun scope n'est chargé (CodeMirror pas encore monté).
   *
   * Seul le FRONTMATTER est relu sur disque (il n'est jamais éditable dans
   * Continu) : le corps utilisé pour la conversion est le corps VIVANT du
   * segment composite actuellement affiché — même principe que
   * `PreviewView.readFileForPreview`/`getLiveBody` ci-dessus — pour que le
   * clic vise la VRAIE position même si Continu a été modifié depuis le
   * chargement du scope, sans jamais relire le corps sur disque.
   */
  async focusSourcePosition(path: string, position: { line: number; ch: number }): Promise<boolean> {
    const document = this.session.document;
    if (!document || !this.cm) return false;

    const segment = document.segments.find((s) => s.path === path);
    if (!segment) return false;

    const raw = await this.app.vault.cachedRead(segment.file);
    const { frontmatter } = splitFrontmatter(raw);
    // Source virtuelle JAMAIS écrite : sert uniquement à convertir une
    // position exprimée dans les coordonnées du FICHIER COMPLET (frontmatter
    // inclus, voir realSectionsFor/preview-view.ts) vers un offset dans le
    // corps composite.
    const virtualSource = frontmatter + segment.body;
    const fullOffset = offsetForLineCol(virtualSource, position.line, position.ch);
    const bodyOffset = Math.max(0, Math.min(fullOffset - frontmatter.length, segment.body.length));

    // Réutilise les offsets déjà stockés dans ScriveningsSegment (via
    // locationToCompositeOffset, services/scrivenings-document.ts) — jamais
    // une recomposition manuelle en concaténant les fichiers.
    const compositeOffset = locationToCompositeOffset(document, path, bodyOffset);
    if (compositeOffset === null) return false;

    // Le curseur SEUL : jamais de sélection du paragraphe entier — même
    // grammaire que le clic historique Preview → Markdown
    // (openPreviewBlockInEditor, preview-view.ts).
    this.cm.dispatch({
      selection: { anchor: compositeOffset, head: compositeOffset },
      effects: EditorViewCtorTyped.scrollIntoView(compositeOffset, { y: "center" }),
    });
    this.cm.focus();
    return true;
  }

  /* ===================== Typographie de l'hôte (§7) ===================
   * Réapplique explicitement les classes body pilotées par main.ts, APRÈS
   * qu'une transition Markdown → Continu ait activé cette leaf — sans
   * dépendre du fait que `active-leaf-change` se soit déclenché avec un
   * contexte déjà reconnu (voir openScopeInContinuOnLeaf ci-dessous : le
   * scope existe désormais AVANT l'activation, mais un rappel explicite
   * reste le moyen le plus direct de garantir la réapplication). Aucune
   * règle CSS ni valeur typographique ici — seulement un relais vers les
   * hooks optionnels du plugin hôte. */
  refreshHostTypography(): void {
    this.plugin.applyLiveTypoClasses?.();
    this.plugin.applyIndentClass?.();
  }

  /* ==================== Menu contextuel Continu (LOT 1.4) ================= */

  /** Segment ACTUELLEMENT chargé pour `path`, ou `null` — lecture fraîche à
   * chaque appel (jamais une copie figée) : c'est exactement la fonction
   * attendue par `ScriveningsSegmentEditorAdapter` (voir main.ts
   * #showScriveningsContextMenu) pour rester à jour après ses propres
   * dispatches. */
  getSegmentByPath(path: string): ScriveningsSegment | null {
    return this.session.document?.segments.find((s) => s.path === path) ?? null;
  }

  /**
   * Résout le contexte d'un clic droit (§7-9 du contrat) : le segment visé,
   * les trois systèmes de coordonnées équivalents, et — AVANT tout —
   * applique la règle de curseur/sélection attendue : une sélection non vide
   * qui CONTIENT le point cliqué est conservée telle quelle ; sinon le caret
   * est placé à la position du clic AVANT de construire les actions du menu
   * (§9 — jamais de sélection effondrée simplement parce que le menu s'ouvre
   * dessus). Réutilise `compositeOffsetToLocation` (services/scrivenings-
   * document.ts) : aucun calcul DOM de segment ici.
   *
   * `null` si CodeMirror n'est pas monté, si aucun document n'est chargé, ou
   * si le clic ne résout à aucune position valide.
   */
  resolveEditorContext(clientX: number, clientY: number): ScriveningsEditorContext | null {
    const document = this.session.document;
    if (!this.cm || !document) return null;

    const pos = this.cm.posAtCoords({ x: clientX, y: clientY });
    if (pos === null) return null;

    const main = this.cm.state.selection.main;
    const from = Math.min(main.from, main.to);
    const to = Math.max(main.from, main.to);
    const withinSelection = !main.empty && pos >= from && pos <= to;
    if (!withinSelection) {
      this.cm.dispatch({ selection: { anchor: pos, head: pos } });
    }

    const location = compositeOffsetToLocation(document, pos);
    if (!location) return null;

    return {
      file: location.segment.file,
      segment: location.segment,
      compositeOffset: pos,
      bodyOffset: location.offset,
      fileOffset: location.segment.frontmatter.length + location.offset,
    };
  }

  /* ==================== Annotations dans Continu (LOT 1.4) ================= */

  /**
   * Recharge et projette les décorations d'annotation sur le composite
   * (§32-36 du contrat) — même moteur que le MarkdownView natif
   * (`applyAnnotationHighlights`, cm-annotation-highlighter.ts), jamais un
   * second système. Pour CHAQUE segment du scope actuel : ses annotations
   * sont résolues (`resolveAnnotation`) contre son contenu ACTUEL
   * (frontmatter + body VIVANT de CodeMirror, jamais relu depuis le disque —
   * §35), puis converties en offsets composites :
   *
   *   bodyStart/bodyEnd = resolved.start/end - segment.frontmatter.length
   *   compositeStart/compositeEnd = segment.from + bodyStart/bodyEnd
   *
   * Une annotation non résolue, ou dont la plage résolue tombe dans le
   * frontmatter ou dépasse le body, n'est JAMAIS dessinée (§34).
   */
  async refreshAnnotationHighlights(): Promise<void> {
    const document = this.session.document;
    if (!this.cm || !document) return;

    let store: Awaited<ReturnType<typeof loadAnnotations>>;
    try {
      store = await loadAnnotations(this.plugin.app, this.plugin.settings);
    } catch {
      applyAnnotationHighlights(this.cm, []);
      return;
    }

    const inputs: AnnotationHighlightInput[] = [];
    for (const segment of document.segments) {
      const relPath = toManuscriptRelativePath(this.plugin.app, this.plugin.settings, segment.file);
      if (relPath === null) continue;
      const list = annotationsForFile(store, relPath);
      if (list.length === 0) continue;

      const fullContent = segment.frontmatter + segment.body;
      for (const annotation of list) {
        const resolved = resolveAnnotation(annotation, fullContent);
        if (!resolved) continue; // non résolue : jamais devinée (§34)

        const bodyStart = resolved.start - segment.frontmatter.length;
        const bodyEnd = resolved.end - segment.frontmatter.length;
        if (bodyStart < 0 || bodyEnd > segment.body.length || bodyEnd <= bodyStart) continue; // jamais le YAML, jamais hors segment

        inputs.push({
          id: annotation.id,
          color: annotation.color,
          style: annotation.style ?? "highlight",
          range: { start: segment.from + bodyStart, end: segment.from + bodyEnd },
        });
      }
    }

    applyAnnotationHighlights(this.cm, inputs);
  }
}

/**
 * Ouvre ou révèle l'onglet Continu. Une ScriveningsView déjà ouverte est
 * réutilisée plutôt que dupliquée — même patron que `activatePreviewView`
 * (preview-view.ts). Une leaf révélée peut rester DIFFÉRÉE (Obsidian ≥ 1.7) :
 * son `.view` est alors un simple placeholder tant que `loadIfDeferred()`
 * n'a pas été appelé.
 */
export async function activateScriveningsView(app: App): Promise<WorkspaceLeaf | null> {
  const { workspace } = app;
  let leaf: WorkspaceLeaf | null = null;
  const leaves = workspace.getLeavesOfType(VIEW_SCRIVENINGS);

  if (leaves.length > 0) {
    leaf = leaves[0];
  } else {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_SCRIVENINGS, active: true });
  }

  if (leaf?.isDeferred) await leaf.loadIfDeferred();
  if (leaf) void workspace.revealLeaf(leaf);
  return leaf;
}

interface OpenScopeView {
  openScope(scope: CompileScope): Promise<boolean>;
  /** Voir ScriveningsView.refreshHostTypography — optionnel : les tests
   * peuvent passer une fausse vue sans cette méthode. */
  refreshHostTypography?: () => void;
}

/** Garde de type sans `instanceof` — même patron que `isScopeableView`
 * (preview-view.ts) : reconnaît la vraie vue par sa surface publique plutôt
 * que par sa classe, ce qui la rend testable avec un faux `WorkspaceLeaf`
 * sans monter un vrai CodeMirror. */
function isOpenScopeView(view: unknown): view is OpenScopeView {
  return (
    typeof view === "object" &&
    view !== null &&
    "openScope" in view &&
    typeof view.openScope === "function"
  );
}

/**
 * Helper unique pour récupérer ou créer Continu, lui transmettre une portée
 * CompileScope explicite, révéler sa leaf et lui rendre le focus. N'écrit et
 * ne crée jamais de fichier composite : `openScope()` ne fait que recharger
 * le document en mémoire (voir ScriveningsView.openScope ci-dessus).
 */
export async function openScopeInContinu(app: App, scope: CompileScope): Promise<WorkspaceLeaf | null> {
  const leaf = await activateScriveningsView(app);
  const view = leaf?.view;
  if (isOpenScopeView(view)) {
    await view.openScope(scope);
  }
  if (leaf) app.workspace.setActiveLeaf(leaf, { focus: true });
  // §7-8 du micro-correctif "focus binder + 2→1 + typographie same-leaf" :
  // même réapplication explicite des classes body typographiques que le
  // chemin same-leaf ci-dessous, après activation — jamais avant qu'elle
  // ait eu lieu.
  if (isOpenScopeView(view)) view.refreshHostTypography?.();
  return leaf;
}

/**
 * Transforme UNE leaf Markdown précise en Continu, EN PLACE — jamais une
 * nouvelle leaf (jamais `getLeaf("tab")`/`getLeaf("split")`). Distinct de
 * `openScopeInContinu` ci-dessus (onglet Continu UNIQUE du plugin, révélé ou
 * créé) : utilisé par la promotion automatique Maj+clic du micro-lot delta
 * "bascule Markdown ↔ Continu", qui cible la MÊME leaf de travail choisie
 * par l'appelant (voir feuillets-view.ts). Revérifie strictement que
 * `leaf.view` est bien un `MarkdownView` avant toute transformation —
 * l'appelant l'a déjà vérifié, mais ce helper ne fait jamais confiance à
 * distance : rien n'est modifié si ce n'est pas le cas.
 *
 * `setViewState` reste le SEUL mécanisme employé pour changer la vue —
 * jamais de copie manuelle du texte du MarkdownView vers le Vault : le
 * fichier reste sur disque tel quel (déjà sauvegardé par Obsidian comme
 * n'importe quel MarkdownView), `openScope()` reconstruit le texte affiché
 * à partir des vrais fichiers (voir ScriveningsView.openScope), jamais
 * depuis l'éditeur qui disparaît.
 */
export async function openScopeInContinuOnLeaf(app: App, leaf: WorkspaceLeaf, scope: CompileScope): Promise<boolean> {
  if (!(leaf.view instanceof MarkdownView)) return false;

  // §6 du micro-correctif "focus binder + 2→1 + typographie same-leaf" :
  // `active: false` ici, et non `true` — monter la vue comme active AVANT
  // que son scope existe peut déclencher "active-leaf-change" pendant que
  // `compileScope` vaut encore `null` (isActiveFileInProject() ne reconnaît
  // pas encore ce contexte), ce qui retire à tort les classes body
  // typographiques (feuillets-justify-live, feuillets-line-height,
  // feuillets-text-width, feuillets-indent). L'activation finale n'a lieu
  // qu'après un scope RÉELLEMENT chargé, voir setActiveLeaf plus bas.
  await leaf.setViewState({ type: VIEW_SCRIVENINGS, active: false });
  if (leaf.isDeferred) await leaf.loadIfDeferred();

  const view = leaf.view;
  if (!isOpenScopeView(view)) return false;
  const applied = await view.openScope(scope);
  if (!applied) return false;

  app.workspace.setActiveLeaf(leaf, { focus: true });
  // §7-8 : même réapplication explicite des classes body typographiques que
  // le chemin historique `openScopeInContinu` ci-dessus — après activation,
  // jamais avant.
  view.refreshHostTypography?.();
  void app.workspace.revealLeaf(leaf);
  return true;
}
