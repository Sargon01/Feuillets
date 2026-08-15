/* eslint-disable import/no-extraneous-dependencies -- CodeMirror est fourni par Obsidian */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
/* eslint-enable import/no-extraneous-dependencies -- fin des imports fournis par Obsidian */
import { ItemView, Notice, type App, type WorkspaceLeaf } from "obsidian";
import { VIEW_SCRIVENINGS } from "../constants.js";
import { resolveCompileScopeFiles, type CompileScope } from "../services/compile-scope.js";
import {
  applyCompositeChanges,
  loadScriveningsDocument,
  resolveScriveningsWrite,
  type ScriveningsChange,
  type ScriveningsDocument,
  type ScriveningsEditResult,
  type ScriveningsSegment,
} from "../services/scrivenings-document.js";
import { shortTitleFor } from "../services/frontmatter.js";
import { scriveningsChangeListener, scriveningsExtensions, setScriveningsDecorations } from "../utils/cm-scrivenings.js";
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

export type ScriveningsViewPlugin = {
  app: App;
  settings: FeuilletsSettings;
};

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
  readonly doc: { length: number; toString(): string };
}
interface EditorStateStatic {
  create(config: { doc: string; extensions: unknown[] }): EditorStateInstance;
}
interface EditorViewInstance {
  readonly state: EditorStateInstance;
  dispatch(spec: { effects?: unknown; changes?: unknown }): void;
  destroy(): void;
  focus(): void;
}
type EditorViewCtor = new (config: { state: EditorStateInstance; parent: HTMLElement }) => EditorViewInstance;

const EditorStateTyped = EditorState as EditorStateStatic;
const EditorViewCtorTyped = EditorView as EditorViewCtor;

export class ScriveningsView extends ItemView {
  private readonly plugin: ScriveningsViewPlugin;
  private readonly session: ScriveningsSession;
  private _compileScope: CompileScope | null = null;
  private cm: EditorViewInstance | null = null;

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

  getViewType(): string {
    return VIEW_SCRIVENINGS;
  }

  getDisplayText(): string {
    if (!this._compileScope) return t("scrivenings.display.empty");
    return t("scrivenings.display.scope", { count: String(this.session.document?.segments.length ?? 0) });
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

  /* ============================ Chargement =========================== */

  /**
   * Ouvre un scope de compilation dans cette vue. Sauvegarde d'abord tout
   * ce qui restait en attente pour le scope précédemment affiché — jamais
   * de perte silencieuse en changeant de scope.
   */
  async openScope(scope: CompileScope): Promise<void> {
    await this.session.flush();
    this.destroyEditor();

    const files = resolveCompileScopeFiles(this.plugin.app, this.plugin.settings, scope);
    this._compileScope = scope;
    const document = await loadScriveningsDocument(this.plugin.app, files);
    this.session.load(document);

    this.mountEditor();
  }

  private mountEditor(): void {
    const document = this.session.document;
    if (!document) return;

    this.contentEl.empty();
    const host = this.contentEl.createDiv({ cls: "markdown-source-view mod-cm6 feuillets-scrivenings-view" });

    const extensions = [...scriveningsExtensions, scriveningsChangeListener((changes) => this.session.handleChanges(changes))];

    const state = EditorStateTyped.create({ doc: document.text, extensions });
    this.cm = new EditorViewCtorTyped({ state, parent: host });

    setScriveningsDecorations(this.cm, document, (file) => shortTitleFor(this.plugin.app, file) || file.basename);
  }

  private destroyEditor(): void {
    this.cm?.destroy();
    this.cm = null;
  }
}
