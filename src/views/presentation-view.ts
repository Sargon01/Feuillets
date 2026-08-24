/* Présentation — vue réelle, branchée sur le moteur de production partagé
 * (voir ../services/presentation-slide-renderer.ts et
 * ../services/presentation-layout-engine.ts). Cette vue ne gère
 * plus que le chrome : toolbar, navigation, compteur, plein écran, live
 * refresh, scaling du cadre 1280×720. Toute la composition d'une slide
 * (candidats FLOW/SPLIT/STACK, mesure, contain, overflow, adoption du DOM
 * gagnant) est déléguée à renderPresentationSlide — aucune implémentation
 * locale du planner, du scoring ou du contain.
 *
 * Invariant conservé : DOM mesuré === DOM affiché.
 */
import { ItemView, TFile, setIcon, type App } from "obsidian";
import { VIEW_PRESENTATION } from "../constants.js";
import { splitPresentationMarkdown, presentationScale } from "../services/presentation.js";
import {
  renderPresentationSlide,
  PRESENTATION_SLIDE_WIDTH,
  PRESENTATION_SLIDE_HEIGHT,
  type RenderedPresentationSlide,
} from "../services/presentation-slide-renderer.js";
import { getRoleEditorDisplay } from "../utils/presentation-helpers.js";
import { t } from "../i18n/index.js";

const BASE_WIDTH = PRESENTATION_SLIDE_WIDTH;
const BASE_HEIGHT = PRESENTATION_SLIDE_HEIGHT;

function isEditableTarget(target: EventTarget | null): boolean {
  return (typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement)
    || (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement)
    || (typeof HTMLElement !== "undefined" && target instanceof HTMLElement && target.isContentEditable);
}

/* Le linter obsidianmd (no-forbidden-elements) interdit de créer/attacher un
 * <style> — le deck et le measurementHost (structurellement nouveaux dans
 * cette vue) sont donc posés exclusivement en inline ; le chrome existant
 * (toolbar/compteur/overflow/stage/frame/bouton/état vide) continue lui
 * d'utiliser ses classes CSS historiques de styles.css, inchangées. */
function styleEl(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

type PresentationSlideRecord = RenderedPresentationSlide;

export class PresentationView extends ItemView {
  private file: TFile | null = null;
  private slidesMarkdown: string[] = [];
  private activeIndex = 0;
  private deckGeneration = 0;
  private slideRecords: PresentationSlideRecord[] = [];
  private pendingMediaResolutions = new Set<number>();

  private rootEl: HTMLElement | null = null;
  private stageEl: HTMLElement | null = null;
  private frameEl: HTMLElement | null = null;
  private deckEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private overflowEl: HTMLElement | null = null;
  private previousButton: HTMLButtonElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private measurementHostEl: HTMLElement | null = null;
  private refreshTimer: number | null = null;

  getViewType(): string { return VIEW_PRESENTATION; }
  getDisplayText(): string { return `${t("presentation.display")} — ${this.file?.basename || this.file?.name || t("presentation.empty")}`; }
  getIcon(): string { return "presentation"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.rootEl = this.contentEl.createDiv({ cls: "feuillets-presentation-view" });
    this.rootEl.setAttribute("tabindex", "0");
    const toolbar = this.rootEl.createDiv({ cls: "feuillets-presentation-toolbar" });
    this.previousButton = this.iconButton(toolbar, "chevron-left", t("presentation.previous"), () => void this.previous());
    this.counterEl = toolbar.createSpan({ cls: "feuillets-presentation-counter" });
    this.nextButton = this.iconButton(toolbar, "chevron-right", t("presentation.next"), () => void this.next());
    this.overflowEl = toolbar.createSpan({ cls: "feuillets-presentation-overflow" });
    this.iconButton(toolbar, "maximize", t("presentation.fullscreen"), () => void this.toggleFullscreen());
    this.stageEl = this.rootEl.createDiv({ cls: "feuillets-presentation-stage" });
    this.frameEl = this.stageEl.createDiv({ cls: "feuillets-presentation-frame" });
    styleEl(this.frameEl, { position: "relative" });
    this.deckEl = this.frameEl.createDiv({ cls: "feuillets-presentation-deck" });
    styleEl(this.deckEl, { position: "relative", width: `${BASE_WIDTH}px`, height: `${BASE_HEIGHT}px` });

    /* measurementHost : conteneur de mesure dédié, attaché au DOM réel Obsidian
     * afin que CSS Grid/Flex et dimensions soient réellement calculés. Jamais
     * display:none. Le renderer y construit et y mesure les candidats d'une
     * slide ; cette vue ne connaît rien de ce qui s'y passe. */
    this.measurementHostEl = this.rootEl.createDiv({ cls: "feuillets-presentation-measurement-host" });
    styleEl(this.measurementHostEl, { position: "absolute", left: "-100000px", top: "0", width: `${BASE_WIDTH}px`, height: `${BASE_HEIGHT}px`, visibility: "hidden", pointerEvents: "none" });

    this.registerDomEvent(this.rootEl, "keydown", (event: KeyboardEvent) => this.handleKeydown(event));
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.updateScale());
      this.resizeObserver.observe(this.stageEl);
    }
    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultModify(file)));
    this.updateUi();
  }

  async onClose(): Promise<void> {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    for (const record of this.slideRecords) record.controller.abort();
    this.slideRecords = [];
    this.pendingMediaResolutions.clear();
    this.measurementHostEl = null;
  }

  async openFile(file: TFile): Promise<void> {
    const changed = this.file?.path !== file.path;
    this.file = file;
    if (changed) this.activeIndex = 0;
    const markdown = await this.app.vault.read(file);
    this.slidesMarkdown = splitPresentationMarkdown(markdown);
    this.activeIndex = Math.max(0, Math.min(this.activeIndex, Math.max(0, this.slidesMarkdown.length - 1)));
    await this.rebuildDeck();
  }

  async next(): Promise<void> { this.setActiveIndex(this.activeIndex + 1); }
  async previous(): Promise<void> { this.setActiveIndex(this.activeIndex - 1); }
  async first(): Promise<void> { this.setActiveIndex(0); }
  async last(): Promise<void> { this.setActiveIndex(this.slideRecords.length - 1); }

  handleKeydown(event: KeyboardEvent): void {
    if (isEditableTarget(event.target)) return;
    const nextKeys = ["ArrowRight", "ArrowDown", "PageDown", " "];
    const previousKeys = ["ArrowLeft", "ArrowUp", "PageUp"];
    if (nextKeys.includes(event.key)) { event.preventDefault(); void this.next(); }
    else if (previousKeys.includes(event.key)) { event.preventDefault(); void this.previous(); }
    else if (event.key === "Home") { event.preventDefault(); void this.first(); }
    else if (event.key === "End") { event.preventDefault(); void this.last(); }
  }

  /** Navigation pure : change uniquement la slide active et met à jour compteur/toolbar — jamais de rendu, jamais de recalcul de layout. */
  private setActiveIndex(index: number): void {
    if (!this.slideRecords.length) { this.activeIndex = 0; this.updateUi(); return; }
    this.activeIndex = Math.max(0, Math.min(index, this.slideRecords.length - 1));
    this.updateActiveVisibility();
    this.updateUi();
  }

  private updateActiveVisibility(): void {
    this.slideRecords.forEach((record, i) => {
      const active = i === this.activeIndex;
      record.section.classList.toggle("is-active", active);
      styleEl(record.section, { visibility: active ? "visible" : "hidden", pointerEvents: active ? "auto" : "none" });
    });
  }

  /**
   * (Re)construit le deck entier : une nouvelle génération, tous les anciens
   * contrôleurs abandonnés, aucune réutilisation des sections de l'ancien
   * deck (utilisé aussi bien à l'ouverture qu'au live refresh — section 8).
   */
  private async rebuildDeck(): Promise<void> {
    const generation = ++this.deckGeneration;
    this.pendingMediaResolutions.clear();
    for (const record of this.slideRecords) record.controller.abort();
    this.slideRecords = [];
    this.deckEl?.empty();
    if (!this.deckEl) return;

    if (!this.file || !this.slidesMarkdown.length) {
      this.deckEl.createDiv({ cls: "feuillets-presentation-empty", text: t("presentation.empty") });
      this.updateUi();
      return;
    }

    const records: PresentationSlideRecord[] = [];
    for (let i = 0; i < this.slidesMarkdown.length; i++) {
      const record = await this.renderSlide(i, generation);
      if (generation !== this.deckGeneration) { record.controller.abort(); record.section.remove(); return; }
      records.push(record);
    }
    this.slideRecords = records;
    const pendingMediaResolutions = [...this.pendingMediaResolutions];
    this.pendingMediaResolutions.clear();
    if (generation !== this.deckGeneration) return;
    for (const index of pendingMediaResolutions) {
      if (generation !== this.deckGeneration) return;
      await this.rebuildSlide(index, generation);
      if (generation !== this.deckGeneration) return;
    }
    this.updateActiveVisibility();
    this.updateUi();
  }

  /**
   * Délègue entièrement le rendu d'UNE slide au renderer partagé — cette vue
   * ne construit plus elle-même aucun candidat, aucune cellule, aucun calcul
   * de contain : elle fournit uniquement le contexte (app/component/chemin),
   * les conteneurs (measurementHost/deck) et les signaux de cycle de vie
   * (génération, AbortController, callback de résolution média).
   */
  private async renderSlide(index: number, generation: number): Promise<PresentationSlideRecord> {
    const controller = new AbortController();
    const roleEditorDisplay = getRoleEditorDisplay(this.app);
    return renderPresentationSlide({
      app: this.app,
      component: this,
      sourcePath: this.file?.path ?? "",
      markdown: this.slidesMarkdown[index] ?? "",
      index,
      generation,
      measurementHost: this.measurementHostEl!,
      deckContainer: this.deckEl!,
      controller,
      isGenerationStale: () => generation !== this.deckGeneration,
      onMediaResolved: () => this.handleImageResolved(index, generation),
      roleEditorDisplay,
    });
  }

  private handleImageResolved(index: number, generation: number): void {
    if (generation !== this.deckGeneration) return; // génération de deck périmée : aucun effet
    const record = this.slideRecords[index];
    if (!record) {
      this.pendingMediaResolutions.add(index);
      return;
    }
    if (record.generation !== generation) return; // la slide n'existe plus / a déjà été remplacée
    void this.rebuildSlide(index, generation);
  }

  /**
   * Reconstruit UNIQUEMENT la slide concernée : relance le renderer (nouveaux
   * candidats mesurés, DOM du gagnant adopté directement), puis remplace
   * atomiquement l'ancienne section par le nouveau DOM déjà mesuré.
   */
  private async rebuildSlide(index: number, generation: number): Promise<void> {
    if (generation !== this.deckGeneration) return;
    const oldRecord = this.slideRecords[index];
    if (!oldRecord) return;
    const newRecord = await this.renderSlide(index, generation);
    if (generation !== this.deckGeneration || this.slideRecords[index] !== oldRecord) {
      newRecord.controller.abort();
      newRecord.section.remove();
      return;
    }
    oldRecord.controller.abort();
    const active = this.activeIndex === index;
    newRecord.section.classList.toggle("is-active", active);
    styleEl(newRecord.section, { visibility: active ? "visible" : "hidden", pointerEvents: active ? "auto" : "none" });
    oldRecord.section.remove();
    this.slideRecords[index] = newRecord;
    this.updateUi();
  }

  private updateScale(): void {
    if (!this.stageEl || !this.frameEl) return;
    const scale = presentationScale(this.stageEl.clientWidth, this.stageEl.clientHeight, BASE_WIDTH, BASE_HEIGHT);
    this.frameEl.style.transform = `scale(${scale})`;
  }

  private updateUi(): void {
    const total = this.slideRecords.length;
    if (this.counterEl) this.counterEl.setText(`${total ? this.activeIndex + 1 : 0} / ${total}`);
    if (this.previousButton) this.previousButton.disabled = this.activeIndex <= 0 || !total;
    if (this.nextButton) this.nextButton.disabled = !total || this.activeIndex >= total - 1;
    const active = this.slideRecords[this.activeIndex];
    if (this.overflowEl) this.overflowEl.setText(active?.overflow ? t("presentation.overflow") : "");
    this.updateScale();
  }

  /**
   * Live refresh (section 8) : relit le Markdown, re-découpe en slides,
   * reconstruit un deck entièrement nouveau via rebuildDeck (nouvelle
   * génération, ancien deck abandonné/aborté, aucune réutilisation de ses
   * sections), index courant conservé et borné au nouveau nombre de slides.
   */
  private onVaultModify(file: import("obsidian").TAbstractFile): void {
    if (!(file instanceof TFile) || !this.file || file.path !== this.file.path) return;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { void this.openFile(file); }, 300);
  }

  private async toggleFullscreen(): Promise<void> {
    if (!this.rootEl) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.rootEl.requestFullscreen();
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, action: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "feuillets-presentation-button", attr: { "aria-label": label } });
    setIcon(button, icon);
    this.registerDomEvent(button, "click", action);
    return button;
  }
}

type PresentationLeafView = { openFile(file: TFile): Promise<void> };

function isPresentationLeafView(view: unknown): view is PresentationLeafView {
  return typeof view === "object" && view !== null && "openFile" in view && typeof (view as { openFile?: unknown }).openFile === "function";
}

export async function openPresentation(app: App, file: TFile): Promise<void> {
  const { workspace } = app;
  let leaf = workspace.getLeavesOfType(VIEW_PRESENTATION)[0];
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_PRESENTATION, active: true });
  }
  if (leaf.isDeferred) await leaf.loadIfDeferred();
  if (isPresentationLeafView(leaf.view)) await leaf.view.openFile(file);
  void workspace.revealLeaf(leaf);
}
