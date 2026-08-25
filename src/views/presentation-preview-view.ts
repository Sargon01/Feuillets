/* Aperçu présentation — APERÇU D'ÉDITION lié à un feuillet Markdown, ouvert
 * côte à côte avec l'éditeur (voir openPresentationPreview ci-dessous, même
 * mécanisme public que openScopeWithPreviewBesideLeaf/openWithPreview dans
 * views/preview-view.ts : `workspace.getLeaf("split")`, jamais une API
 * privée du Workspace).
 *
 * Cette vue N'EST PAS la Présentation réelle (PresentationView,
 * ../views/presentation-view.ts) : elle n'en remplace ni le rôle
 * (projection/lecture plein écran) ni la commande. Elle affiche UNE
 * diapositive à la fois, synchronisée avec la position du curseur dans
 * l'éditeur lié, en déléguant tout le rendu au MÊME renderer de production
 * partagé — aucune implémentation locale du planner, du scoring ou du
 * contain :
 *
 *   éditeur Markdown
 *           ↕ (curseur ↔ diapositive)
 *   PresentationPreviewView
 *           ↓
 *   renderPresentationSlide() (../services/presentation-slide-renderer.ts)
 *
 * Le canvas logique reste 1280×720 (PRESENTATION_SLIDE_WIDTH/HEIGHT) ; seul
 * un scale uniforme (presentationScale, ../services/presentation.ts) est
 * appliqué pour tenir dans le panneau — jamais de recomposition selon la
 * largeur.
 */
import { ItemView, TFile, setIcon, Notice, type App, type WorkspaceLeaf } from "obsidian";
import { VIEW_PRESENTATION_PREVIEW } from "../constants.js";
import {
  presentationScale,
  presentationSlideIndexForLine,
  splitPresentationMarkdownWithRanges,
  type PresentationSlideSource,
} from "../services/presentation.js";
import { loadLayoutStore, layoutOverridesForFile } from "../services/layout-store.js";
import { createPresentationSlideAnchor, resolvePresentationSlideLayouts, replacePresentationSlideLayout, type ResolvedPresentationSlideLayouts } from "../services/presentation-layout-overrides.js";
import { saveLayoutStore } from "../services/layout-store.js";
import { PresentationLayoutModal } from "../ui/presentation-layout-modal.js";
import { resolveSourceAnchor } from "../services/source-anchor.js";
import {
  renderPresentationSlide,
  PRESENTATION_SLIDE_WIDTH,
  PRESENTATION_SLIDE_HEIGHT,
  type RenderedPresentationSlide,
} from "../services/presentation-slide-renderer.js";
import { getPresentationTheme, getRoleEditorDisplay } from "../utils/presentation-helpers.js";
import { t } from "../i18n/index.js";

const BASE_WIDTH = PRESENTATION_SLIDE_WIDTH;
const BASE_HEIGHT = PRESENTATION_SLIDE_HEIGHT;

/** Débounce du live refresh (relecture + redécoupe) après une frappe. */
const REFRESH_DEBOUNCE_MS = 220;
/** Fréquence de scrutation du curseur — voir `findLinkedEditor` : Obsidian
 * n'expose aucun événement public de simple déplacement du curseur (seul
 * `editor-change`, sur une frappe, existe) ; interroger périodiquement
 * `editor.getCursor()` (API publique) est le mécanisme standard, jamais une
 * API CodeMirror privée. */
const CURSOR_POLL_MS = 200;

function styleEl(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

/** Sous-ensemble PUBLIC d'Editor réellement utilisé ici — jamais `editor.cm`. */
export type PresentationPreviewEditorLike = {
  getCursor(): { line: number; ch: number };
  setCursor(pos: { line: number; ch: number }): void;
  scrollIntoView(range: { from: { line: number; ch: number }; to: { line: number; ch: number } }, center?: boolean): void;
};

type MarkdownLeafView = { file?: unknown; editor?: PresentationPreviewEditorLike };

type PresentationPreviewSlideRecord = RenderedPresentationSlide;
type PresentationPluginLike = { app: App; settings: FeuilletsSettings; getProjectFolder(): import("obsidian").TFolder | null };

export class PresentationPreviewView extends ItemView {
  private readonly plugin?: PresentationPluginLike;
  file: TFile | null = null;
  slides: PresentationSlideSource[] = [];
  activeIndex = 0;
  deckGeneration = 0;
  currentRecord: PresentationPreviewSlideRecord | null = null;
  private lastRenderedMarkdown: string | null = null;
  private fullMarkdown = "";
  resolvedSlideLayouts: ResolvedPresentationSlideLayouts = new Map();
  private linkedWorkLeaf: WorkspaceLeaf | null = null;

  rootEl: HTMLElement | null = null;
  stageEl: HTMLElement | null = null;
  scaledWrapperEl: HTMLElement | null = null;
  frameEl: HTMLElement | null = null;
  deckEl: HTMLElement | null = null;
  counterEl: HTMLElement | null = null;
  emptyEl: HTMLElement | null = null;
  previousButton: HTMLButtonElement | null = null;
  nextButton: HTMLButtonElement | null = null;
  layoutButton: HTMLButtonElement | null = null;
  measurementHostEl: HTMLElement | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private refreshTimer: number | null = null;
  private cursorPollTimer: number | null = null;
  private lastCursorLine: number | null = null;
  private closed = false;

  constructor(leaf: WorkspaceLeaf, plugin?: PresentationPluginLike) { super(leaf); this.plugin = plugin; }

  getViewType(): string { return VIEW_PRESENTATION_PREVIEW; }
  getDisplayText(): string {
    const name = this.file?.basename || this.file?.name;
    return name ? `${t("presentation.preview.display")} — ${name}` : t("presentation.preview.display");
  }
  getIcon(): string { return "presentation"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    // Même classe racine que la vraie Présentation : réutilise TEL QUEL le
    // chrome déjà défini dans styles.css (toolbar/bouton/compteur/stage/
    // frame/état vide) — aucune règle ajoutée, aucune dupliquée.
    this.rootEl = this.contentEl.createDiv({ cls: "feuillets-presentation-view feuillets-presentation-preview-view" });
    const toolbar = this.rootEl.createDiv({ cls: "feuillets-presentation-toolbar" });
    this.previousButton = this.navButton(toolbar, "‹", t("presentation.previous"), () => void this.previous());
    this.counterEl = toolbar.createSpan({ cls: "feuillets-presentation-counter" });
    this.nextButton = this.navButton(toolbar, "›", t("presentation.next"), () => void this.next());
    this.layoutButton = toolbar.createEl("button", { cls: "feuillets-presentation-button", attr: { "aria-label": t("presentation.layout") } });
    setIcon(this.layoutButton, "layout-template");
    this.registerDomEvent(this.layoutButton, "click", () => void this.openLayoutModal());

    this.stageEl = this.rootEl.createDiv({ cls: "feuillets-presentation-stage" });
    // Wrapper pour le scaling : représente la vraie taille visuelle après réduction.
    // Le stage centre ce wrapper (pas le frame logique de 1280×720).
    this.scaledWrapperEl = this.stageEl.createDiv({ cls: "feuillets-presentation-scaled-wrapper" });
    styleEl(this.scaledWrapperEl, { position: "relative", overflow: "hidden" });
    this.frameEl = this.scaledWrapperEl.createDiv({ cls: "feuillets-presentation-frame" });
    styleEl(this.frameEl, { position: "relative", width: `${BASE_WIDTH}px`, height: `${BASE_HEIGHT}px`, transformOrigin: "top left" });
    this.deckEl = this.frameEl.createDiv({ cls: "feuillets-presentation-deck" });
    styleEl(this.deckEl, { position: "relative", width: `${BASE_WIDTH}px`, height: `${BASE_HEIGHT}px` });

    // measurementHost propre à cet aperçu — même contrat que PresentationView :
    // attaché au DOM réel, jamais display:none.
    this.measurementHostEl = this.rootEl.createDiv({ cls: "feuillets-presentation-measurement-host" });
    styleEl(this.measurementHostEl, { position: "absolute", left: "-100000px", top: "0", width: `${BASE_WIDTH}px`, height: `${BASE_HEIGHT}px`, visibility: "hidden", pointerEvents: "none" });

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.updateScale());
      this.resizeObserver.observe(this.stageEl);
    }
    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultModify(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onVaultDelete(file)));

    this.startCursorPolling();
    this.updateUi();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.cursorPollTimer !== null) window.clearInterval(this.cursorPollTimer);
    this.cursorPollTimer = null;
    this.currentRecord?.controller.abort();
    this.currentRecord = null;
    this.linkedWorkLeaf = null;
    this.measurementHostEl = null;
  }

  /**
   * Lie (ou relie) cet aperçu à `file` : reconstruit les diapositives et
   * affiche celle correspondant au curseur de l'éditeur lié s'il existe,
   * sinon conserve/borne l'index courant. Idempotent — un second appel sur
   * le même fichier ne fait que rafraîchir le contenu (voir openPresentationPreview).
   */
  async linkFile(file: TFile, workLeaf?: WorkspaceLeaf): Promise<void> {
    if (workLeaf) this.linkedWorkLeaf = workLeaf;
    const changed = this.file?.path !== file.path;
    this.file = file;
    if (changed) { this.activeIndex = 0; this.lastCursorLine = null; }
    const markdown = await this.app.vault.read(file);
    await this.applyMarkdown(markdown, { preferCursor: true });
  }

  async refreshRoleDisplay(): Promise<void> {
    if (!this.slides.length || !this.currentRecord) return;
    await this.setActiveIndex(this.activeIndex, { moveCursor: false, force: true });
  }

  private async applyMarkdown(markdown: string, options: { preferCursor: boolean }): Promise<void> {
    this.slides = splitPresentationMarkdownWithRanges(markdown);
    this.fullMarkdown = markdown;
    const root = this.plugin?.getProjectFolder();
    if (this.plugin && root && this.file && this.file.path.startsWith(`${root.path}/`)) {
      const relative = this.file.path.slice(root.path.length + 1);
      const store = await loadLayoutStore(this.app, this.plugin.settings);
      this.resolvedSlideLayouts = resolvePresentationSlideLayouts(markdown, this.slides, layoutOverridesForFile(store, relative));
    } else {
      this.resolvedSlideLayouts = new Map();
    }
    let desiredIndex = Math.max(0, Math.min(this.activeIndex, Math.max(0, this.slides.length - 1)));
    if (options.preferCursor) {
      const editor = this.findLinkedEditor();
      if (editor) {
        const line = editor.getCursor().line;
        this.lastCursorLine = line;
        const fromCursor = presentationSlideIndexForLine(this.slides, line);
        if (fromCursor >= 0) desiredIndex = fromCursor;
      }
    }
    await this.setActiveIndex(desiredIndex, { moveCursor: false, force: true });
  }

  /* ============================ Navigation ============================ */

  async next(): Promise<void> { await this.setActiveIndex(this.activeIndex + 1, { moveCursor: true }); }
  async previous(): Promise<void> { await this.setActiveIndex(this.activeIndex - 1, { moveCursor: true }); }

  /**
   * Change (au besoin) la diapositive affichée. Ne rerend JAMAIS si l'index
   * ne change pas et que le contenu de la diapositive courante n'a pas
   * changé (sauf `force`, utilisé après un live refresh dont le contenu a
   * pu changer sans que l'index change).
   */
  private async setActiveIndex(index: number, options: { moveCursor: boolean; force?: boolean }): Promise<void> {
    if (!this.slides.length) {
      this.activeIndex = 0;
      if (this.currentRecord) { this.currentRecord.controller.abort(); this.currentRecord.section.remove(); this.currentRecord = null; }
      this.updateUi();
      return;
    }
    const bounded = Math.max(0, Math.min(index, this.slides.length - 1));
    const source = this.slides[bounded];
    const contentChanged = this.currentRecord === null || this.lastRenderedMarkdown !== source.markdown;
    const indexChanged = bounded !== this.activeIndex;
    this.activeIndex = bounded;
    if (!indexChanged && !contentChanged && !options.force) {
      this.updateUi();
      return;
    }
    await this.renderActive();
    if (options.moveCursor) this.moveEditorCursorTo(source.startLine);
    this.updateUi();
  }

  /* ============================ Rendu ============================ */

  private async renderActive(): Promise<void> {
    const generation = ++this.deckGeneration;
    const previous = this.currentRecord;
    if (!this.deckEl || !this.measurementHostEl || !this.slides.length) return;
    const source = this.slides[this.activeIndex];
    const controller = new AbortController();
    const roleEditorDisplay = getRoleEditorDisplay(this.app);
    const theme = getPresentationTheme(this.app, this.file?.path ?? "");
    const record = await renderPresentationSlide({
      app: this.app,
      component: this,
      sourcePath: this.file?.path ?? "",
      markdown: source.markdown,
      index: this.activeIndex,
      generation,
      measurementHost: this.measurementHostEl,
      deckContainer: this.deckEl,
      controller,
      isGenerationStale: () => generation !== this.deckGeneration,
      onMediaResolved: () => this.handleImageResolved(generation),
      roleEditorDisplay,
      theme,
      layoutOverride: this.resolvedSlideLayouts.get(this.activeIndex)?.layout ?? null,
    });
    if (generation !== this.deckGeneration) {
      // Une nouvelle génération a démarré pendant l'attente async : abandonnée.
      record.controller.abort();
      record.section.remove();
      return;
    }
    previous?.controller.abort();
    previous?.section.remove();
    // Contrat d'activation IDENTIQUE à PresentationView.updateActiveVisibility
    // (../views/presentation-view.ts) : le renderer partagé construit `section`
    // masquée (measurementHost) — sans ceci, la section adoptée reste
    // invisible/non cliquable pour toujours, même une fois insérée dans le deck.
    // Cet aperçu n'affiche jamais qu'une seule diapositive à la fois : toujours active.
    record.section.classList.toggle("is-active", true);
    styleEl(record.section, { visibility: "visible", pointerEvents: "auto" });
    this.currentRecord = record;
    this.lastRenderedMarkdown = source.markdown;
  }

  private handleImageResolved(generation: number): void {
    if (generation !== this.deckGeneration) return; // génération périmée : aucun effet
    if (!this.currentRecord || this.currentRecord.generation !== generation) return;
    void this.renderActive();
  }

  /* ============================ Curseur ↔ diapositive ============================ */

  /** Éditeur Markdown ouvert sur le fichier LIÉ à cet aperçu, s'il en existe
   * un — même patron que PreviewView.editorForFile (API publique uniquement :
   * `workspace.getLeavesOfType`, `view.file`, `view.editor`). */
  private findLinkedEditor(): PresentationPreviewEditorLike | null {
    if (!this.file) return null;
    if (this.linkedWorkLeaf) {
      const view = this.linkedWorkLeaf.view as unknown as MarkdownLeafView;
      if (view?.file instanceof TFile && view.file.path === this.file.path && typeof view.editor?.getCursor === "function") {
        return view.editor;
      }
      return null;
    }
    const workspace = this.app.workspace as unknown as {
      getLeavesOfType?(type: string): Array<{ view?: MarkdownLeafView }>;
    };
    for (const leaf of workspace.getLeavesOfType?.("markdown") || []) {
      const view = leaf?.view;
      if (view?.file instanceof TFile && view.file.path === this.file.path && typeof view.editor?.getCursor === "function") {
        return view.editor;
      }
    }
    return null;
  }

  private startCursorPolling(): void {
    if (typeof window === "undefined") return;
    this.cursorPollTimer = window.setInterval(() => this.pollCursor(), CURSOR_POLL_MS);
  }

  private pollCursor(): void {
    if (this.closed || !this.file || !this.slides.length) return;
    const editor = this.findLinkedEditor();
    if (!editor) return;
    const line = editor.getCursor().line;
    if (line === this.lastCursorLine) return;
    this.lastCursorLine = line;
    const index = presentationSlideIndexForLine(this.slides, line);
    if (index < 0 || index === this.activeIndex) return;
    void this.setActiveIndex(index, { moveCursor: false });
  }

  private moveEditorCursorTo(line: number): void {
    const editor = this.findLinkedEditor();
    if (!editor) return;
    const pos = { line, ch: 0 };
    editor.setCursor(pos);
    editor.scrollIntoView({ from: pos, to: pos }, true);
    this.lastCursorLine = line;
  }

  /* ============================ Live refresh ============================ */

  private onVaultModify(file: import("obsidian").TAbstractFile): void {
    if (!(file instanceof TFile) || !this.file || file.path !== this.file.path) return;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      if (!this.file) return;
      void this.app.vault.read(this.file).then((markdown) => this.applyMarkdown(markdown, { preferCursor: true }));
    }, REFRESH_DEBOUNCE_MS);
  }

  private onVaultDelete(file: import("obsidian").TAbstractFile): void {
    if (!(file instanceof TFile) || !this.file || file.path !== this.file.path) return;
    this.file = null;
    this.slides = [];
    void this.setActiveIndex(0, { moveCursor: false, force: true });
  }

  /* ============================ Chrome / scale ============================ */

  private updateScale(): void {
    if (!this.stageEl || !this.scaledWrapperEl || !this.frameEl) return;
    const scale = presentationScale(this.stageEl.clientWidth, this.stageEl.clientHeight, BASE_WIDTH, BASE_HEIGHT);
    // Le wrapper représente la vraie taille visuelle après réduction.
    styleEl(this.scaledWrapperEl, { width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` });
    // Le frame reste 1280×720 et est transformé par scale(), origin top-left.
    this.frameEl.style.transform = `scale(${scale})`;
  }

  private updateUi(): void {
    const total = this.slides.length;
    if (this.counterEl) this.counterEl.setText(`${total ? this.activeIndex + 1 : 0} / ${total}`);
    if (this.previousButton) this.previousButton.disabled = this.activeIndex <= 0 || !total;
    if (this.nextButton) this.nextButton.disabled = !total || this.activeIndex >= total - 1;
    if (this.layoutButton) this.layoutButton.disabled = !this.file || !total || !this.plugin || !this.plugin.getProjectFolder() || !createPresentationSlideAnchor(this.fullMarkdown, this.slides[this.activeIndex]);
    if (!total) {
      if (!this.emptyEl && this.rootEl) {
        this.emptyEl = this.rootEl.createDiv({ cls: "feuillets-presentation-empty" });
      }
      this.emptyEl?.setText(t("presentation.preview.empty"));
      this.emptyEl?.show?.();
      this.stageEl?.hide?.();
    } else {
      this.emptyEl?.hide?.();
      this.stageEl?.show?.();
    }
    this.updateScale();
  }

  private navButton(parent: HTMLElement, label: string, tooltip: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "feuillets-presentation-button", attr: { "aria-label": tooltip }, text: label });
    this.registerDomEvent(button, "click", action);
    return button;
  }

  async refreshPresentationLayout(filePath: string): Promise<void> {
    if (!this.file || this.file.path !== filePath) return;
    const markdown = await this.app.vault.read(this.file);
    await this.applyMarkdown(markdown, { preferCursor: false });
  }

  private async openLayoutModal(): Promise<void> {
    if (!this.file || !this.slides[this.activeIndex]) return;
    const anchor = createPresentationSlideAnchor(this.fullMarkdown, this.slides[this.activeIndex]);
    const root = this.plugin?.getProjectFolder();
    if (!anchor || !root || !this.file.path.startsWith(`${root.path}/`)) {
      new Notice(t("presentation.layoutChanged"));
      return;
    }
    const current = this.resolvedSlideLayouts.get(this.activeIndex)?.layout ?? null;
    new PresentationLayoutModal(this.app, current, async (layout) => {
      if (!this.file) return;
      const plugin = this.plugin;
      if (!plugin) return;
      const freshMarkdown = await this.app.vault.read(this.file);
      const freshSlides = splitPresentationMarkdownWithRanges(freshMarkdown);
      const freshRange = resolveSourceAnchor(anchor, freshMarkdown);
      if (!freshRange) { new Notice(t("presentation.layoutChanged")); return; }
      const targetIndex = freshSlides.findIndex((slide) => {
        const candidate = createPresentationSlideAnchor(freshMarkdown, slide);
        return !!candidate && candidate.start <= freshRange.start && candidate.end >= freshRange.end;
      });
      if (targetIndex < 0) { new Notice(t("presentation.layoutChanged")); return; }
      const relative = this.file.path.slice(root.path.length + 1);
      const store = await loadLayoutStore(this.app, plugin.settings);
      const next = replacePresentationSlideLayout(store, relative, freshMarkdown, freshSlides, targetIndex, layout);
      await saveLayoutStore(this.app, plugin.settings, next);
      await this.applyMarkdown(freshMarkdown, { preferCursor: false });
    }).open();
  }
}

type PresentationPreviewLeafView = { linkFile(file: TFile, workLeaf?: WorkspaceLeaf): Promise<void> };

function isPresentationPreviewLeafView(view: unknown): view is PresentationPreviewLeafView {
  return typeof view === "object" && view !== null && "linkFile" in view && typeof (view as { linkFile?: unknown }).linkFile === "function";
}

/**
 * Ouvre (ou réutilise) l'aperçu présentation lié, CÔTÉ À CÔTÉ de `workLeaf`
 * (l'éditeur Markdown actif) — même mécanisme public que
 * `openScopeWithPreviewBesideLeaf`/`openWithPreview` (views/preview-view.ts,
 * main.ts) : `workspace.getLeaf("split")` sur la leaf active, jamais
 * `getLeaf("tab")`, jamais d'API privée du Workspace. Un aperçu déjà ouvert
 * n'est jamais dupliqué — il est révélé et relié à `file` (relink explicite,
 * même patron que la réutilisation de PreviewView). Le focus reste sur
 * `workLeaf`.
 */
export async function openPresentationPreview(app: App, workLeaf: WorkspaceLeaf, file: TFile): Promise<void> {
  const { workspace } = app;
  const existing = workspace.getLeavesOfType(VIEW_PRESENTATION_PREVIEW);

  let leaf: WorkspaceLeaf;
  if (existing.length > 0) {
    leaf = existing[0];
  } else {
    workspace.setActiveLeaf(workLeaf, { focus: true });
    leaf = workspace.getLeaf("split");
    await leaf.setViewState({ type: VIEW_PRESENTATION_PREVIEW, active: false });
  }

  if (leaf.isDeferred) await leaf.loadIfDeferred();

  const view = leaf.view;
  if (isPresentationPreviewLeafView(view)) await view.linkFile(file, workLeaf);

  void workspace.revealLeaf(leaf);
  workspace.setActiveLeaf(workLeaf, { focus: true });
}
