import { Modal, Setting, type App } from "obsidian";
import type { LayoutDirectiveContext } from "../utils/editor-layout-directives.js";
import { t } from "../i18n/index.js";

export interface LayoutDirectiveValues {
  question: { mode: "default" | "lines" | "space"; lines?: number; amount?: number; unit?: "lh" | "mm" } | null;
  pagination: boolean;
}

export class LayoutDirectiveModal extends Modal {
  private values: LayoutDirectiveValues;
  private readonly onApplyAsync: (values: LayoutDirectiveValues) => Promise<void>;
  constructor(app: App, private readonly context: LayoutDirectiveContext, values: LayoutDirectiveValues, onApplyAsync: (values: LayoutDirectiveValues) => Promise<void>) {
    super(app); this.values = structuredClone(values); this.onApplyAsync = onApplyAsync;
  }
  onOpen(): void {
    const { contentEl } = this; contentEl.createEl("h3", { text: t("modal.layoutDirective.title") });
    if (this.context.question) this.questionSection(contentEl);
    if (this.context.pagination) new Setting(contentEl).setName(t("modal.layoutDirective.pagination")).addToggle((toggle) => toggle.setTooltip(t("modal.layoutDirective.pageBreakBefore")).setValue(this.values.pagination).onChange((value) => { this.values.pagination = value; }));
    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: t("modal.apply"), cls: "mod-cta" }).addEventListener("click", () => { void this.onApplyAsync(this.values).then(() => this.close()); });
  }
  onClose(): void { this.contentEl.empty(); }
  private questionSection(container: HTMLElement): void {
    container.createEl("h4", { text: t("modal.layoutDirective.answerArea") });
    new Setting(container).setName(t("modal.layoutDirective.type")).addDropdown((drop) => { drop.addOption("default", t("modal.layoutDirective.defaultTwoLines")); drop.addOption("lines", t("modal.layoutDirective.lines")); drop.addOption("space", t("modal.layoutDirective.space")); drop.setValue(this.values.question?.mode || "default").onChange((value) => { if (this.values.question) this.values.question.mode = value as "default" | "lines" | "space"; }); });
    new Setting(container).setName(t("modal.layoutDirective.value")).addText((text) => text.setPlaceholder(t("modal.layoutDirective.positiveInteger")).setValue(String(this.values.question?.lines || this.values.question?.amount || "")).onChange((value) => { const n = Number(value); if (!this.values.question || !Number.isInteger(n) || n <= 0) return; if (this.values.question.mode === "lines") this.values.question.lines = n; else this.values.question.amount = n; }));
    new Setting(container).setName(t("modal.layoutDirective.unit")).addDropdown((drop) => { drop.addOption("lh", t("modal.layoutDirective.unitLh")); drop.addOption("mm", t("modal.layoutDirective.unitMm")); drop.setValue(this.values.question?.unit || "lh").onChange((value) => { if (this.values.question) this.values.question.unit = value as "lh" | "mm"; }); });
  }
}
