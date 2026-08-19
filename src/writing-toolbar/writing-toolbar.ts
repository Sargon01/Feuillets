import { Menu, setTooltip } from "obsidian";
import { t } from "../i18n/index.js";
import type { WritingContext } from "./writing-context.js";
import type {
  WritingActionDefinition,
  WritingActionGroup,
  WritingActionRegistry,
} from "./writing-action-registry.js";

/** Modes d'affichage de la Barre — le mode (persistant, Settings) et
 *  l'override de session (non persistant, commande) s'appliquent par classes. */
export type WritingToolbarMode = "always" | "hover" | "shortcut" | "disabled";
export type WritingToolbarPosition = "bottom" | "top";
/** Override de session : "show" | "hide" | null (repli sur le mode). */
export type WritingToolbarOverride = "show" | "hide" | null;

export interface WritingToolbarOptions {
  context: WritingContext;
  registry: WritingActionRegistry;
  position: WritingToolbarPosition;
  mode: WritingToolbarMode;
}

/** Barre d'écriture — coque uniquement. Elle construit le DOM, rend les
 *  actions du registre (tout le temps disabled tant que le Lot 2 n'a pas
 *  enregistré de handler), gère la position, les modes d'affichage, le
 *  responsive par overflow et le menu « … ». Aucune logique métier. */
export class WritingToolbar {
  readonly context: WritingContext;
  readonly registry: WritingActionRegistry;

  private position: WritingToolbarPosition;
  private mode: WritingToolbarMode;
  private override: WritingToolbarOverride = null;
  private barEl: HTMLElement;
  /** Actions passées en overflow, dans l'ordre de retrait (priorité). */
  private overflowIds: string[] = [];
  private defsById = new Map<string, WritingActionDefinition>();
  private resizeObserver: ResizeObserver | null = null;
  private rafPending: number | null = null;
  private destroyed = false;

  constructor(options: WritingToolbarOptions) {
    this.context = options.context;
    this.registry = options.registry;
    this.position = options.position;
    this.mode = options.mode;

    for (const def of this.registry.definitions()) {
      this.defsById.set(def.id, def);
    }

    this.context.hostEl.addClass("feuillets-writing-toolbar-host");
    this.barEl = this.context.hostEl.createDiv({ cls: "feuillets-writing-toolbar" });

    this.applyPositionClass();
    this.applyModeClasses();

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.syncStatusBarGeometry();
        this.scheduleRelayout();
      });
      this.resizeObserver.observe(this.context.hostEl);
      this.observeStatusBar();
    }

    this.syncStatusBarGeometry();
    this.fit();
  }

  /** Élément hôte auquel la barre est attachée — permet au contrôleur de
   *  reconnaître un contexte inchangé. */
  get hostEl(): HTMLElement {
    return this.context.hostEl;
  }

  /** Identifiants actuellement en overflow, dans l'ordre du preset. */
  get overflowed(): string[] {
    const overflowed = new Set(this.overflowIds);
    return this.registry.definitions().filter((def) => overflowed.has(def.id)).map((def) => def.id);
  }

  setPosition(position: WritingToolbarPosition): void {
    if (position === this.position) return;
    this.position = position;
    this.applyPositionClass();
    this.syncStatusBarGeometry();
    this.scheduleRelayout();
  }

  setMode(mode: WritingToolbarMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applyModeClasses();
  }

  setOverride(override: WritingToolbarOverride): void {
    if (override === this.override) return;
    this.override = override;
    this.barEl.removeClass("is-override-show");
    this.barEl.removeClass("is-override-hide");
    if (override === "show") this.barEl.addClass("is-override-show");
    if (override === "hide") this.barEl.addClass("is-override-hide");
  }

  /** Re-rend la coque (états disabled repaints après enregistrement d'un
   *  handler par le Lot 2) puis reproduit le layout responsive. */
  refreshActions(): void {
    this.fit();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafPending !== null) {
      window.cancelAnimationFrame(this.rafPending);
      this.rafPending = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.barEl.remove();
    this.context.hostEl.removeClass("feuillets-writing-toolbar-host");
  }

  /* ------------------------- DOM / rendu ------------------------- */

  private applyPositionClass(): void {
    this.barEl.removeClass("feuillets-writing-toolbar-top");
    this.barEl.removeClass("feuillets-writing-toolbar-bottom");
    this.barEl.addClass(
      this.position === "top" ? "feuillets-writing-toolbar-top" : "feuillets-writing-toolbar-bottom"
    );
  }

  private applyModeClasses(): void {
    this.barEl.removeClass("feuillets-writing-toolbar-hover");
    this.barEl.removeClass("feuillets-writing-toolbar-shortcut");
    if (this.mode === "hover") this.barEl.addClass("feuillets-writing-toolbar-hover");
    if (this.mode === "shortcut") this.barEl.addClass("feuillets-writing-toolbar-shortcut");
    if (this.override === "show") this.barEl.addClass("is-override-show");
    if (this.override === "hide") this.barEl.addClass("is-override-hide");
  }

  /** Rend la barre pour l'état courant d'overflow : actions visibles dans
   *  l'ordre du preset, séparateurs entre groupes, puis « … ». */
  private renderBar(): void {
    this.barEl.empty();
    const overflowed = new Set(this.overflowIds);
    let lastGroup: WritingActionGroup | null = null;
    let firstVisible = true;
    for (const def of this.registry.definitions()) {
      if (overflowed.has(def.id)) continue;
      if (!firstVisible && def.group !== lastGroup) {
        this.barEl.createDiv({ cls: "feuillets-writing-toolbar-separator" });
      }
      firstVisible = false;
      lastGroup = def.group;
      this.appendActionButton(def);
    }
    if (this.barEl.children.length > 0) {
      this.barEl.createDiv({ cls: "feuillets-writing-toolbar-separator" });
    }
    this.appendMoreButton();
  }

  private appendActionButton(def: WritingActionDefinition): void {
    const runnable = this.context ? this.registry.canRun(def.id, this.context) : false;
    const label = def.label ?? t(def.labelKey);
    const cls = ["feuillets-writing-toolbar-item"];
    if (def.split) cls.push("is-split");
    if (!runnable) cls.push("is-disabled");
    const button = this.barEl.createEl("button", {
      cls: cls.join(" "),
      text: label,
      attr: { "data-action-id": def.id },
    });
    if (!runnable) {
      button.setAttribute("disabled", "true");
      button.disabled = true;
    }
    setTooltip(button, t(def.tooltipKey));
    /* Cliquer dans la Barre ne doit pas déplacer le focus hors de l'éditeur :
       preventDefault sur mousedown, jamais de focus() après l'action. */
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", () => {
      if (this.context) void this.registry.run(def.id, this.context);
    });
  }

  private appendMoreButton(): void {
    const more = this.barEl.createEl("button", {
      cls: "feuillets-writing-toolbar-item feuillets-writing-toolbar-more",
      text: "\u2026",
      attr: { "data-more": "true" },
    });
    setTooltip(more, t("writingToolbar.more"));
    if (this.overflowIds.length === 0) {
      more.addClass("is-disabled");
      more.setAttribute("disabled", "true");
      more.disabled = true;
    }
    more.addEventListener("mousedown", (e) => e.preventDefault());
    more.addEventListener("click", () => this.openOverflowMenu(more));
  }

  private openOverflowMenu(anchor: HTMLElement): void {
    if (this.overflowIds.length === 0) return;
    const menu = new Menu();
    /* Actions en overflow affichées dans l'ordre d'origine du preset. */
    for (const id of this.overflowed) {
      const def = this.defsById.get(id);
      if (!def) continue;
      const label = def.label ?? t(def.labelKey);
      menu.addItem((item) => {
        item.setTitle(label);
        if (!this.context || !this.registry.canRun(id, this.context)) {
          item.setDisabled(true);
        }
        item.onClick(() => {
          if (this.context) void this.registry.run(id, this.context);
        });
      });
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }

  /* --------------------- Responsive / overflow --------------------- */

  /** Reproduit la géométrie VISUELLE de la status bar native (hauteur seule)
   *  sur la Barre d'écriture en position basse. Lecture purement utilitaire :
   *  Feuillets ne devient pas un status-bar-item, ne monte rien dans
   *  `.status-bar`, et continue de fonctionner si elle n'existe pas. */
  private syncStatusBarGeometry(): void {
    /* La hauteur de la status bar n'est reproduite qu'en position basse : en
       position top, la Barre garde sa hauteur naturelle. */
    if (this.position !== "bottom") {
      this.barEl.style.removeProperty("--feuillets-writing-toolbar-status-height");
      return;
    }
    const statusBar = document.querySelector<HTMLElement>(".status-bar");
    if (!statusBar) {
      this.barEl.style.removeProperty("--feuillets-writing-toolbar-status-height");
      return;
    }
    const rect = statusBar.getBoundingClientRect();
    const computed = getComputedStyle(statusBar);
    const visible =
      rect.height > 0 && computed.display !== "none" && computed.visibility !== "hidden";
    if (visible) {
      this.barEl.style.setProperty(
        "--feuillets-writing-toolbar-status-height",
        `${rect.height}px`
      );
    } else {
      this.barEl.style.removeProperty("--feuillets-writing-toolbar-status-height");
    }
  }

  /** Observe la status bar native avec le MÊME ResizeObserver que le host :
   *  un changement réel de sa hauteur ajuste immédiatement Feuillets. */
  private observeStatusBar(): void {
    if (!this.resizeObserver) return;
    const statusBar = document.querySelector<HTMLElement>(".status-bar");
    if (statusBar) this.resizeObserver.observe(statusBar);
  }

  private scheduleRelayout(): void {
    if (this.rafPending !== null) return;
    this.rafPending = window.requestAnimationFrame(() => {
      this.rafPending = null;
      if (!this.destroyed) this.fit();
    });
  }

  /** Repart TOUJOURS de toutes les actions puis pousse dans l'overflow les
   *  priorités les plus faibles (égalité → la plus à droite) jusqu'à ce que
   *  la ligne tienne. « … » reste en permanence dans la barre. */
  private fit(): void {
    this.syncStatusBarGeometry();
    this.overflowIds = [];
    this.renderBar();
    const limit = this.availableWidth();
    if (!(limit > 0)) return;
    let needed = this.contentWidth();
    let guard = 0;
    while (needed > limit && guard <= 64) {
      const candidate = this.lowestPriorityVisible();
      if (candidate === null) break;
      this.overflowIds.push(candidate);
      this.renderBar();
      needed = this.contentWidth();
      guard += 1;
    }
  }

  /** Id visible de plus basse priorité ; à égalité, la plus à droite. */
  private lowestPriorityVisible(): string | null {
    const overflowed = new Set(this.overflowIds);
    let best: { id: string; priority: number; index: number } | null = null;
    let index = 0;
    for (const def of this.registry.definitions()) {
      if (overflowed.has(def.id)) {
        index += 1;
        continue;
      }
      if (
        best === null ||
        def.priority < best.priority ||
        (def.priority === best.priority && index > best.index)
      ) {
        best = { id: def.id, priority: def.priority, index };
      }
      index += 1;
    }
    return best ? best.id : null;
  }

  private availableWidth(): number {
    const width = this.barEl.clientWidth;
    /* La status bar ne limite la largeur disponible que si elle est visible,
       en position basse, et horizontalement dans la zone du host — sinon la
       largeur réelle actuelle de la barre fait foi. */
    if (this.position !== "bottom") return width;
    const statusBar = document.querySelector<HTMLElement>(".status-bar");
    if (!statusBar) return width;
    const computed = getComputedStyle(statusBar);
    const statusRect = statusBar.getBoundingClientRect();
    const visible =
      statusRect.height > 0 && computed.display !== "none" && computed.visibility !== "hidden";
    if (!visible) return width;
    const barRect = this.barEl.getBoundingClientRect();
    const hostRect = this.context.hostEl.getBoundingClientRect();
    if (statusRect.left >= barRect.left && statusRect.left <= hostRect.right) {
      return Math.min(width, Math.max(1, statusRect.left - barRect.left));
    }
    return width;
  }

  private contentWidth(): number {
    return this.barEl.scrollWidth;
  }
}