import { t } from "../i18n/index.js";
import type { AnchorRect, AnnotationDecorationTarget } from "../utils/cm-annotation-highlighter.js";
import type { NativeReviewThread } from "../services/native-review-threads.js";

/** Une note n'a qu'une seule issue : elle est traitée. Pas de fil de
 * discussion, pas de réponse, pas de réouverture. */
export type NativeReviewThreadAction = "handled";
export function nativeReviewThreadActions(status: "open" | "resolved", readOnly = false): NativeReviewThreadAction[] {
  return readOnly || status === "resolved" ? [] : ["handled"];
}

type ElementOptions = { cls?: string; text?: string; attr?: Record<string, string>; type?: string; placeholder?: string };
export type NativeReviewElement = HTMLElement & {
  createDiv(options?: ElementOptions): NativeReviewElement;
  createEl(tag: string, options?: ElementOptions): NativeReviewElement;
  empty(): void;
};

export interface NativeReviewThreadControlOptions {
  status: "open" | "resolved";
  readOnly?: boolean;
  onHandled: () => Promise<void>;
}

/** Renders the note-level action zone once. Messages never own controls. */
export function renderNativeReviewThreadControls(parent: NativeReviewElement, options: NativeReviewThreadControlOptions): NativeReviewElement | null {
  const actions = nativeReviewThreadActions(options.status, options.readOnly);
  if (!actions.length) return null;
  const zone = parent.createDiv({ cls: "feuillets-native-review-actions" });
  const control = zone.createEl("button", { text: t("nativeReview.action.handled"), attr: { "data-native-review-action": "handled" } });
  control.addEventListener("click", (event) => { event.stopPropagation(); void options.onHandled(); });
  return zone;
}

export interface NativeReviewThreadPopoverOptions {
  parentEl: NativeReviewElement;
  anchor: AnchorRect | AnnotationDecorationTarget;
  thread: NativeReviewThread;
  names: Map<string, string>;
  readOnly: boolean;
  onHandled: () => Promise<void>;
}

export class NativeReviewThreadPopover {
  private el: HTMLElement | null = null;
  constructor(private readonly options: NativeReviewThreadPopoverOptions) { }
  open(): void {
    const el = this.options.parentEl.createDiv({ cls: "feuillets-annotation-popover feuillets-native-review-thread-popover" });
    this.el = el;
    const rect: AnchorRect = typeof (this.options.anchor as AnnotationDecorationTarget).getBoundingClientRect === "function" ? (this.options.anchor as AnnotationDecorationTarget).getBoundingClientRect!() : this.options.anchor as AnchorRect;
    el.style.left = `${Math.max(8, Math.min(rect?.left ?? 24, window.innerWidth - 328))}px`; el.style.top = `${Math.max(8, rect?.bottom ?? 24)}px`;
    el.createDiv({ cls: "feuillets-native-review-quote", text: `« ${this.options.thread.anchor.quote} »` });
    for (const message of this.options.thread.messages) {
      const entry = el.createDiv({ cls: "feuillets-native-review-message" });
      entry.createDiv({ cls: "feuillets-native-review-message-author", text: this.options.names.get(message.participantId) ?? message.participantId });
      entry.createDiv({ text: message.text });
    }
    if (this.options.thread.status === "resolved") el.createDiv({ cls: "feuillets-native-review-status", text: t("nativeReview.note.handled") });
    renderNativeReviewThreadControls(el, { status: this.options.thread.status, readOnly: this.options.readOnly, onHandled: this.options.onHandled });
  }
  close(): void { this.el?.remove(); this.el = null; }
}
