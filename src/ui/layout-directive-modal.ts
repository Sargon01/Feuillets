import { Modal, Setting, type App } from "obsidian";
import type { LayoutDirectiveContext } from "../utils/editor-layout-directives.js";

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
    const { contentEl } = this; contentEl.createEl("h3", { text: "Disposition" });
    if (this.context.question) this.questionSection(contentEl);
    if (this.context.pagination) new Setting(contentEl).setName("Pagination").addToggle((toggle) => toggle.setTooltip("Saut de page avant").setValue(this.values.pagination).onChange((value) => { this.values.pagination = value; }));
    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: "Annuler" }).addEventListener("click", () => this.close());
    buttons.createEl("button", { text: "Appliquer", cls: "mod-cta" }).addEventListener("click", () => { void this.onApplyAsync(this.values).then(() => this.close()); });
  }
  onClose(): void { this.contentEl.empty(); }
  private questionSection(container: HTMLElement): void {
    container.createEl("h4", { text: "Zone de réponse" });
    new Setting(container).setName("Type").addDropdown((drop) => { drop.addOption("default", "Par défaut (2 lignes)"); drop.addOption("lines", "Lignes"); drop.addOption("space", "Espace"); drop.setValue(this.values.question?.mode || "default").onChange((value) => { if (this.values.question) this.values.question.mode = value as "default" | "lines" | "space"; }); });
    new Setting(container).setName("Valeur").addText((text) => text.setPlaceholder("Entier positif").setValue(String(this.values.question?.lines || this.values.question?.amount || "")).onChange((value) => { const n = Number(value); if (!this.values.question || !Number.isInteger(n) || n <= 0) return; if (this.values.question.mode === "lines") this.values.question.lines = n; else this.values.question.amount = n; }));
    new Setting(container).setName("Unité").addDropdown((drop) => { drop.addOption("lh", "Lh"); drop.addOption("mm", "Mm"); drop.setValue(this.values.question?.unit || "lh").onChange((value) => { if (this.values.question) this.values.question.unit = value as "lh" | "mm"; }); });
  }
}
