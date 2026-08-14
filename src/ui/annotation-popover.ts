import { t } from "../i18n/index.js";
import { setIcon } from "obsidian";
import type { AnchorRect, AnnotationDecorationTarget } from "../utils/cm-annotation-highlighter.js";

/** Correctif UI (avant le lot 5) : remplace l'ancien AnnotationModal (un
 * vrai Modal Obsidian, plein overlay assombri) par une petite carte
 * flottante ~320px ancrée près du passage annoté — ni Modal, ni overlay,
 * juste un élément positionné en `position: fixed` par rapport au DOMRect
 * du passage (ou de l'élément décoré pour une modification). Aucune API
 * Obsidian interne/instable : createDiv/createEl (extensions déjà posées
 * sur HTMLElement.prototype par Obsidian, utilisées partout ailleurs dans
 * ce plugin) et un DOMRect ordinaire suffisent.
 *
 * Callbacks (onSave/onDelete) et leur contrat INCHANGÉS depuis l'ancien
 * modal — seule la présentation change. Stockage, ancrage textuel et page
 * Annotations (lots 1, 3 partiel, 4) ne sont pas touchés par ce fichier. */

export type AnnotationPopoverColor = "yellow" | "green" | "blue" | "pink";
export type AnnotationPopoverStyle = "highlight" | "underline" | "strikethrough";

const COLORS: AnnotationPopoverColor[] = ["yellow", "green", "blue", "pink"];
const STYLES: Array<{ value: AnnotationPopoverStyle; icon: string }> = [
  { value: "highlight", icon: "highlighter" }, { value: "underline", icon: "underline" }, { value: "strikethrough", icon: "strikethrough" },
];
const POPOVER_WIDTH = 320;
const POPOVER_MARGIN = 8;
const ESTIMATED_HEIGHT = 160;

/** Sous-ensemble minimal d'HTMLElement (+ extensions Obsidian createDiv/
 * createEl/createSpan) dont ce popover a besoin — permet de le tester sans
 * DOM réel (voir test/annotation-popover.test.js), exactement comme le
 * reste de ce plugin teste ses vues avec un FakeElement. */
export interface PopoverElement {
  createDiv(options?: { cls?: string }): PopoverElement;
  createEl(tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }): PopoverElement;
  createSpan(options?: { cls?: string; text?: string }): PopoverElement;
  addClass(cls: string): void;
  removeClass(cls: string): void;
  setText(text: string): void;
  setAttr(name: string, value: string): void;
  addEventListener(type: string, callback: (event: Event) => void): void;
  removeEventListener?(type: string, callback: (event: Event) => void): void;
  remove(): void;
  contains(target: unknown): boolean;
  focus?(): void;
  /* `CSSStyleDeclaration` en production (vrai HTMLElement.style, aucun
     index signature) | objet simple en test (voir FakeElement) — les deux
     acceptent une affectation `.left = "…px"` / `.top = "…px"`, seule
     opération faite par ce module (voir position()). */
  style?: CSSStyleDeclaration | Record<string, string>;
}

/** `value` n'est PAS sur PopoverElement (HTMLLIElement.value est un
 * `number`, incompatible avec le `string` d'un textarea) — seul l'élément
 * textarea en a besoin, typé ici séparément à l'endroit où il est créé. */
type PopoverTextArea = PopoverElement & { value: string };

export interface AnnotationPopoverOptions {
  /** Élément dans lequel construire le popover (`document.body`, ou le
   * `body` du document propriétaire de l'ancre pour une fenêtre détachée —
   * voir preview-view.ts, même convention `ownerDocument`). Injecté plutôt
   * que lu depuis une globale : ce module n'accède jamais lui-même à
   * `document`/`window` pour se construire, seulement pour se positionner
   * (voir resolveViewportSize) où une valeur par défaut sûre existe déjà. */
  parentEl: PopoverElement;
  /** Position d'ancrage : soit un rectangle déjà calculé (sélection dans
   * l'éditeur, via coordsAtOffset), soit l'élément décoré transmis par
   * annotationDoubleClickExtension (dont on lira getBoundingClientRect()
   * s'il est défini). */
  anchor: AnchorRect | AnnotationDecorationTarget;
  text: string;
  color: AnnotationPopoverColor;
  style?: AnnotationPopoverStyle;
  /** Les notes de travail utilisent exactement la même carte, sans palette. */
  showColors?: boolean;
  showStyles?: boolean;
  onStyleChange?: (style: AnnotationPopoverStyle) => void | Promise<void>;
  onSave: (text: string, color: AnnotationPopoverColor, style: AnnotationPopoverStyle) => void | Promise<void>;
  /** Absent en création (rien à supprimer) — présent en modification, ce
   * qui décide seul si l'action « Supprimer » est affichée. */
  onDelete?: () => void | Promise<void>;
  /** Une création ne doit pas laisser d'annotation vide lors d'Escape. */
  saveOnClose?: boolean;
}

function resolveRect(anchor: AnnotationPopoverOptions["anchor"]): AnchorRect {
  const target = anchor as AnnotationDecorationTarget | null;
  if (target && typeof target.getBoundingClientRect === "function") {
    return target.getBoundingClientRect();
  }
  return anchor as AnchorRect;
}

/** Taille de la fenêtre pour border le popover — repli raisonnable hors
 * navigateur (tests) plutôt qu'un accès direct à `window` qui n'existe pas
 * dans l'environnement de test Node. */
function resolveViewportSize(): { width: number; height: number } {
  if (typeof window !== "undefined") {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return { width: 1024, height: 768 };
}

export class AnnotationPopover {
  private text: string;
  private color: AnnotationPopoverColor;
  private style: AnnotationPopoverStyle;
  private readonly onSave: AnnotationPopoverOptions["onSave"];
  private readonly onDelete?: AnnotationPopoverOptions["onDelete"];
  private readonly parentEl: PopoverElement;
  private readonly anchor: AnnotationPopoverOptions["anchor"];
  private readonly showColors: boolean;
  private readonly showStyles: boolean;
  private readonly onStyleChange?: AnnotationPopoverOptions["onStyleChange"];
  private readonly saveOnClose: boolean;
  private el: PopoverElement | null = null;
  private closed = false;
  private deleted = false;
  private readonly handleOutsideMouseDown = (event: Event): void => {
    const target = (event as MouseEvent).target;
    if (this.el && !this.el.contains(target)) this.close();
  };
  private readonly handleKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key === "Escape") this.close();
  };

  constructor(options: AnnotationPopoverOptions) {
    this.text = options.text;
    this.color = options.color;
    this.style = options.style ?? "highlight";
    this.onSave = options.onSave;
    this.onDelete = options.onDelete;
    this.parentEl = options.parentEl;
    this.anchor = options.anchor;
    this.showColors = options.showColors ?? true;
    this.showStyles = options.showStyles ?? true;
    this.onStyleChange = options.onStyleChange;
    this.saveOnClose = options.saveOnClose ?? true;
  }

  open(): void {
    const el = this.parentEl.createDiv({ cls: "feuillets-annotation-popover" });
    this.el = el;
    this.position(el);

    const textarea = el.createEl("textarea", {
      cls: "feuillets-annotation-popover-textarea",
      attr: { placeholder: t("annotation.popover.textPlaceholder") },
    }) as PopoverTextArea;
    textarea.value = this.text;
    textarea.addEventListener("input", () => {
      this.text = textarea.value ?? "";
    });

    const footer = (this.showStyles || this.showColors || this.onDelete) ? el.createDiv({ cls: "feuillets-annotation-popover-footer" }) : null;
    if (this.showStyles) {
      const stylesRow = footer!.createDiv({ cls: "feuillets-annotation-popover-styles" });
      const styleEls: Partial<Record<AnnotationPopoverStyle, PopoverElement>> = {};
      for (const option of STYLES) {
        const button = stylesRow.createSpan({ cls: "feuillets-annotation-popover-style feuillets-clickable" });
        if (option.value === this.style) button.addClass("is-selected");
        setIcon(button as unknown as HTMLElement, option.icon);
        button.setAttr("aria-label", option.value);
        styleEls[option.value] = button;
        button.addEventListener("click", () => { this.style = option.value; for (const style of STYLES) { const candidate = styleEls[style.value]; if (candidate) { if (style.value === option.value) candidate.addClass("is-selected"); else candidate.removeClass("is-selected"); } } void this.onStyleChange?.(option.value); });
      }
    }
    const colorsRow = this.showColors ? footer!.createDiv({ cls: "feuillets-annotation-popover-colors" }) : null;
    const dotEls: Partial<Record<AnnotationPopoverColor, PopoverElement>> = {};
    for (const color of this.showColors ? COLORS : []) {
      const dot = colorsRow!.createSpan({
        cls: `feuillets-annotation-dot feuillets-annotation-dot-${color} feuillets-annotation-popover-color`,
      });
      if (color === this.color) dot.addClass("is-selected");
      dot.setAttr("role", "button");
      dot.setAttr("aria-label", t(`annotation.popover.color.${color}`));
      dotEls[color] = dot;
      dot.addEventListener("click", () => {
        this.color = color;
        for (const c of COLORS) {
          const el2 = dotEls[c];
          if (!el2) continue;
          if (c === color) el2.addClass("is-selected");
          else el2.removeClass("is-selected");
        }
      });
    }

    if (this.onDelete) {
      const deleteBtn = footer!.createDiv({ cls: "feuillets-annotation-popover-delete feuillets-clickable" });
      setIcon(deleteBtn as unknown as HTMLElement, "trash-2");
      deleteBtn.setAttr("aria-label", t("annotation.popover.delete"));
      deleteBtn.addEventListener("click", () => {
        this.deleted = true;
        this.close();
        void this.onDelete?.();
      });
    }

    // Écoutés sur parentEl plutôt que sur `document`/`window` : ce module
    // n'a besoin d'aucune globale pour fonctionner ni pour être testé (voir
    // PopoverElement) — un mousedown/keydown en dehors du popover mais dans
    // parentEl suffit à détecter "clic extérieur"/Escape.
    this.parentEl.addEventListener("mousedown", this.handleOutsideMouseDown);
    this.parentEl.addEventListener("keydown", this.handleKeyDown);

    textarea.focus?.();
  }

  private position(el: PopoverElement): void {
    const rect = resolveRect(this.anchor);
    const { width: vw, height: vh } = resolveViewportSize();

    const left = Math.max(POPOVER_MARGIN, Math.min(rect.left, vw - POPOVER_WIDTH - POPOVER_MARGIN));
    const preferredTop = rect.bottom + 6;
    const top = preferredTop + ESTIMATED_HEIGHT > vh
      ? Math.max(POPOVER_MARGIN, rect.top - ESTIMATED_HEIGHT - 6)
      : preferredTop;

    if (el.style) {
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
  }

  /** Ferme le popover — retire son DOM et ses deux écouteurs, puis
   * sauvegarde le texte/couleur courants SAUF si l'annotation vient d'être
   * supprimée (this.deleted) : « Supprimer » n'enregistre jamais le texte
   * en cours. Appelé par Escape, un clic extérieur, ou explicitement après
   * suppression — un seul chemin de fermeture, jamais dupliqué. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.parentEl.removeEventListener?.("mousedown", this.handleOutsideMouseDown);
    this.parentEl.removeEventListener?.("keydown", this.handleKeyDown);
    this.el?.remove();
    if (!this.deleted && this.saveOnClose) {
      void this.onSave(this.text, this.color, this.style);
    }
  }
}
