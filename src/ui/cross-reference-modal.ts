import { FuzzySuggestModal, type App, type FuzzyMatch } from "obsidian";
import { getLocale, t } from "../i18n/index.js";
import { formatCrossReference } from "../services/cross-reference-format.js";
import type { NumberedCrossReferenceTarget } from "../services/cross-reference-context.js";
import type { CrossReferenceModeOption } from "../services/cross-reference-editor-controller.js";
import type { CrossReferenceTargetType } from "../services/cross-reference-model.js";

class CrossReferenceChoiceModal<T> extends FuzzySuggestModal<T> {
  constructor(app: App, private readonly items: readonly T[], private readonly label: (item: T) => string, private readonly finish: (item: T | null) => void) { super(app); }
  getItems(): T[] { return [...this.items]; }
  getItemText(item: T): string { return this.label(item); }
  onChooseItem(item: T): void { this.finish(item); }
  onClose(): void { queueMicrotask(() => this.finish(null)); }
}

class CrossReferenceTargetModal extends CrossReferenceChoiceModal<NumberedCrossReferenceTarget> {
  renderSuggestion(match: FuzzyMatch<NumberedCrossReferenceTarget>, el: HTMLElement): void {
    const target = match.item;
    el.empty();
    el.addClass("is-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title",
      text: `${formatCrossReference(target, "type-number", getLocale())} — ${target.detectedTarget.titleOrCaption}` });
    content.createDiv({ cls: "suggestion-note", text: target.detectedTarget.sourceFile });
  }
}

const targetTypeOrder: Record<CrossReferenceTargetType, number> = { figure: 0, table: 1, appendix: 2, section: 3 };

export function chooseCrossReferenceTarget(app: App, targets: readonly NumberedCrossReferenceTarget[]): Promise<NumberedCrossReferenceTarget | null> {
  return new Promise((resolve) => {
    const items = [...targets].sort((a, b) => targetTypeOrder[a.detectedTarget.type] - targetTypeOrder[b.detectedTarget.type]);
    const modal = new CrossReferenceTargetModal(app, items, (target) =>
      `${formatCrossReference(target, "type-number", getLocale())} — ${target.detectedTarget.titleOrCaption} — ${target.detectedTarget.sourceFile}`, resolve);
    modal.setPlaceholder(t("xref.pickTarget"));
    modal.open();
  });
}

export function chooseCrossReferenceMode(app: App, modes: readonly CrossReferenceModeOption[]): Promise<CrossReferenceModeOption["mode"] | null> {
  return new Promise((resolve) => {
    const modal = new CrossReferenceChoiceModal<CrossReferenceModeOption>(app, modes, (option) => `${option.text} — ${t(`xref.mode.${option.mode}`)}`, (option) => resolve(option?.mode ?? null));
    modal.setPlaceholder(t("xref.pickMode"));
    modal.open();
  });
}
