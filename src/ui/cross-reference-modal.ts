import { FuzzySuggestModal, type App } from "obsidian";
import { getLocale, t } from "../i18n/index.js";
import { formatCrossReference } from "../services/cross-reference-format.js";
import type { NumberedCrossReferenceTarget } from "../services/cross-reference-context.js";
import type { CrossReferenceModeOption } from "../services/cross-reference-editor-controller.js";

class CrossReferenceChoiceModal<T> extends FuzzySuggestModal<T> {
  constructor(app: App, private readonly items: readonly T[], private readonly label: (item: T) => string, private readonly finish: (item: T | null) => void) { super(app); }
  getItems(): T[] { return [...this.items]; }
  getItemText(item: T): string { return this.label(item); }
  onChooseItem(item: T): void { this.finish(item); }
  onClose(): void { queueMicrotask(() => this.finish(null)); }
}

export function chooseCrossReferenceTarget(app: App, targets: readonly NumberedCrossReferenceTarget[]): Promise<NumberedCrossReferenceTarget | null> {
  return new Promise((resolve) => {
    const modal = new CrossReferenceChoiceModal<NumberedCrossReferenceTarget>(app, targets, (target) =>
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
