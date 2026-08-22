import { ItemView, MarkdownRenderer, TFile, setIcon, type App } from "obsidian";
import { VIEW_PRESENTATION } from "../constants.js";
import { PRESENTATION_DEFAULT_BODY_PX, PRESENTATION_MEDIA_SCALES, mediaQuestionsModeFor, presentationBodySizeCandidates, presentationExplicitMediaSize, presentationHeadingSize, presentationLayoutFor, presentationMediaBlocks, presentationOverflows, presentationScale, splitPresentationMarkdown, type PresentationLayout } from "../services/presentation.js";
import { t } from "../i18n/index.js";

const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;

function isEditableTarget(target: EventTarget | null): boolean {
  return (typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement)
    || (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement)
    || (typeof HTMLElement !== "undefined" && target instanceof HTMLElement && target.isContentEditable);
}

export class PresentationView extends ItemView {
  private file: TFile | null = null;
  private slides: string[] = [];
  private index = 0;
  private rootEl: HTMLElement | null = null;
  private stageEl: HTMLElement | null = null;
  private frameEl: HTMLElement | null = null;
  private slideEl: HTMLElement | null = null;
  private innerEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private previousButton: HTMLButtonElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private overflowEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private refreshTimer: number | null = null;
  private renderVersion = 0;
  private fitting = false;

  getViewType(): string { return VIEW_PRESENTATION; }
  getDisplayText(): string { return `${t("presentation.display") } — ${this.file?.basename || this.file?.name || t("presentation.empty")}`; }
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
    this.slideEl = this.frameEl.createDiv({ cls: "feuillets-presentation-slide" });
    this.innerEl = this.slideEl.createDiv({ cls: "feuillets-presentation-inner" });
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
  }

  async openFile(file: TFile): Promise<void> {
    const changed = this.file?.path !== file.path;
    this.file = file;
    if (changed) this.index = 0;
    const markdown = await this.app.vault.read(file);
    this.slides = splitPresentationMarkdown(markdown);
    this.index = Math.max(0, Math.min(this.index, Math.max(0, this.slides.length - 1)));
    await this.renderCurrent();
  }

  async next(): Promise<void> {
    if (!this.slides.length) return;
    this.index = Math.min(this.slides.length - 1, this.index + 1);
    await this.renderCurrent();
  }

  async previous(): Promise<void> {
    if (!this.slides.length) return;
    this.index = Math.max(0, this.index - 1);
    await this.renderCurrent();
  }

  async first(): Promise<void> { this.index = 0; await this.renderCurrent(); }
  async last(): Promise<void> { this.index = Math.max(0, this.slides.length - 1); await this.renderCurrent(); }

  handleKeydown(event: KeyboardEvent): void {
    if (isEditableTarget(event.target)) return;
    const nextKeys = ["ArrowRight", "ArrowDown", "PageDown", " "];
    const previousKeys = ["ArrowLeft", "ArrowUp", "PageUp"];
    if (nextKeys.includes(event.key)) { event.preventDefault(); void this.next(); }
    else if (previousKeys.includes(event.key)) { event.preventDefault(); void this.previous(); }
    else if (event.key === "Home") { event.preventDefault(); void this.first(); }
    else if (event.key === "End") { event.preventDefault(); void this.last(); }
  }

  private async renderCurrent(): Promise<void> {
    const inner = this.innerEl;
    if (!inner) return;
    const version = ++this.renderVersion;
    inner.empty();
    this.slideEl?.classList.remove("feuillets-presentation-has-overflow");
    if (!this.file || !this.slides.length) {
      inner.createDiv({ cls: "feuillets-presentation-empty", text: t("presentation.empty") });
      this.updateUi();
      return;
    }
    await MarkdownRenderer.render(this.app, this.slides[this.index], inner, this.file.path, this);
    if (version !== this.renderVersion) return;
    const layout = presentationLayoutFor(inner, this.index);
    this.applyLayout(layout);
    this.bindMediaFitAfterLoad();
    this.fitCurrentSlide();
    this.updateUi();
  }

  private applyLayout(layout: PresentationLayout): void {
    const slide = this.slideEl;
    const inner = this.innerEl;
    if (!slide || !inner) return;
    slide.className = `feuillets-presentation-slide feuillets-presentation-layout-${layout}`;
    if (layout === "media-questions") {
      this.layoutMediaQuestions(inner);
      return;
    }
    if (layout !== "media-text") return;
    const blocks = Array.from(inner.children) as HTMLElement[];
    const heading = inner.createDiv({ cls: "feuillets-presentation-heading" });
    const text = inner.createDiv({ cls: "feuillets-presentation-text" });
    const media = inner.createDiv({ cls: "feuillets-presentation-media" });
    const mediaBlocks = new Set(presentationMediaBlocks(inner));
    for (const block of blocks) {
      if (/^H[1-6]$/.test(block.tagName)) heading.appendChild(block);
      else if (mediaBlocks.has(block)) media.appendChild(block);
      else text.appendChild(block);
    }
  }

  private layoutMediaQuestions(inner: HTMLElement): void {
    const blocks = Array.from(inner.children) as HTMLElement[];
    const heading = inner.createDiv({ cls: "feuillets-presentation-heading" });
    const media = inner.createDiv({ cls: "feuillets-presentation-media" });
    const questions = inner.createDiv({ cls: "feuillets-presentation-questions" });
    const mediaBlocks = new Set(presentationMediaBlocks(inner));
    for (const block of blocks) {
      if (/^H[1-6]$/.test(block.tagName)) heading.appendChild(block);
      else if (mediaBlocks.has(block)) media.appendChild(block);
      else questions.appendChild(block);
    }
    this.updateMediaQuestionsMode(media, questions);
  }

  private bindMediaFitAfterLoad(): void {
    const inner = this.innerEl;
    if (!inner) return;
    for (const image of Array.from(inner.querySelectorAll("img"))) {
      if (image.complete) continue;
      this.registerDomEvent(image, "load", () => this.refitLoadedMedia());
      this.registerDomEvent(image, "error", () => this.refitLoadedMedia());
    }
  }

  private refitLoadedMedia(): void {
    const inner = this.innerEl;
    if (!inner) return;
    const media = inner.querySelector(".feuillets-presentation-media");
    const questions = inner.querySelector(".feuillets-presentation-questions");
    if (media instanceof HTMLElement && questions instanceof HTMLElement) {
      this.updateMediaQuestionsMode(media, questions);
      return;
    }
    this.fitCurrentSlide();
  }

  private updateMediaQuestionsMode(media: HTMLElement, questions: HTMLElement): void {
    const image = media.querySelector("img");
    const list = Array.from(questions.children).find((block) => block.tagName === "OL" || block.tagName === "UL");
    const count = list?.children.length ?? 0;
    const mode = mediaQuestionsModeFor(image?.naturalWidth ?? 0, image?.naturalHeight ?? 0, count);
    this.innerEl?.classList.remove("feuillets-presentation-media-questions-side", "feuillets-presentation-media-questions-stacked");
    this.innerEl?.classList.add(`feuillets-presentation-media-questions-${mode}`);
    this.fitCurrentSlide();
  }

  private updateScale(): void {
    if (!this.stageEl || !this.frameEl) return;
    const scale = presentationScale(this.stageEl.clientWidth, this.stageEl.clientHeight, BASE_WIDTH, BASE_HEIGHT);
    this.frameEl.style.transform = `scale(${scale})`;
  }

  private updateOverflow(): void {
    const overflow = !!this.innerEl && presentationOverflows(this.innerEl);
    this.slideEl?.classList.toggle("feuillets-presentation-has-overflow", overflow);
    if (this.overflowEl) this.overflowEl.setText(overflow ? t("presentation.overflow") : "");
  }

  private fitCurrentSlide(): void {
    const inner = this.innerEl;
    const slide = this.slideEl;
    if (!inner || !slide || this.fitting) return;
    const images = Array.from(inner.querySelectorAll("img"));
    if (images.some((image) => image.complete === false)) {
      this.applyFit(1, false, PRESENTATION_DEFAULT_BODY_PX);
      this.updateOverflow();
      return;
    }
    this.fitting = true;
    for (const image of images) {
      const explicit = presentationExplicitMediaSize(image);
      if (explicit?.width) image.style.setProperty("--feuillets-presentation-explicit-width", `${explicit.width}px`);
      if (explicit?.height) image.style.setProperty("--feuillets-presentation-explicit-height", `${explicit.height}px`);
    }
    const mediaScales = images.length ? PRESENTATION_MEDIA_SCALES : [1];
    const smallestMediaScale = mediaScales[mediaScales.length - 1] ?? 1;
    for (const mediaScale of mediaScales) {
      this.applyFit(mediaScale, false, PRESENTATION_DEFAULT_BODY_PX);
      if (!presentationOverflows(inner)) break;
    }
    if (presentationOverflows(inner)) this.applyFit(smallestMediaScale, true, PRESENTATION_DEFAULT_BODY_PX);
    if (presentationOverflows(inner)) {
      for (const bodySize of presentationBodySizeCandidates()) {
        this.applyFit(smallestMediaScale, true, bodySize);
        if (!presentationOverflows(inner)) break;
      }
    }
    this.updateOverflow();
    this.fitting = false;
  }

  private applyFit(mediaScale: number, compact: boolean, bodySize: number): void {
    const slide = this.slideEl;
    if (!slide) return;
    slide.classList.toggle("feuillets-presentation-fit-compact", compact);
    slide.style.setProperty("--feuillets-presentation-media-scale", String(mediaScale));
    slide.style.setProperty("--feuillets-presentation-body-size", `${bodySize}px`);
    slide.style.setProperty("--feuillets-presentation-h1-size", `${presentationHeadingSize(1, bodySize)}px`);
    slide.style.setProperty("--feuillets-presentation-h2-size", `${presentationHeadingSize(2, bodySize)}px`);
    slide.style.setProperty("--feuillets-presentation-h3-size", `${presentationHeadingSize(3, bodySize)}px`);
    slide.style.setProperty("--feuillets-presentation-h4-size", `${presentationHeadingSize(4, bodySize)}px`);
  }

  private updateUi(): void {
    const total = this.slides.length;
    if (this.counterEl) this.counterEl.setText(`${total ? this.index + 1 : 0} / ${total}`);
    if (this.previousButton) this.previousButton.disabled = this.index <= 0 || !total;
    if (this.nextButton) this.nextButton.disabled = !total || this.index >= total - 1;
    this.updateScale();
  }

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
