import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";

export type MergeRow = { id: string; title: string };

/** Modale « Fusionner… » (section 5B) : ordre des cartes/feuillets
 * sélectionnés (monter/descendre) et choix de la carte cible qui reçoit le
 * texte concaténé — les autres ne sont supprimées qu'après succès (voir
 * services/canvas-split-merge.ts `executeMerge`, jamais dupliqué ici). */
export class CanvasMergeModal extends Modal {
  private rows: MergeRow[];
  private targetId: string;
  private onConfirm: (orderedIds: string[], targetId: string) => void | Promise<void>;

  private rowsEl?: HTMLElement;

  constructor(app: App, rows: MergeRow[], onConfirm: (orderedIds: string[], targetId: string) => void | Promise<void>) {
    super(app);
    this.rows = [...rows];
    this.targetId = rows[0]?.id || "";
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.canvasMerge.title") });
    contentEl.createEl("p", { cls: "feuillets-muted", text: t("modal.canvasMerge.explain") });

    contentEl.createEl("label", { text: t("modal.canvasMerge.targetLabel") });
    const select = contentEl.createEl("select");
    select.addClass("feuillets-input-full");
    for (const row of this.rows) select.createEl("option", { text: row.title, value: row.id });
    select.value = this.targetId;
    select.addEventListener("change", () => {
      this.targetId = select.value;
    });

    contentEl.createEl("label", { text: t("modal.canvasMerge.orderLabel") });
    this.rowsEl = contentEl.createDiv({ cls: "feuillets-canvas-bridge-list" });
    this.renderRows();

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const confirmBtn = btnRow.createEl("button", { text: t("modal.canvasMerge.confirm"), cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => {
      if (!this.targetId) {
        new Notice(t("modal.canvasMerge.errorNoTarget"));
        return;
      }
      this.close();
      void this.onConfirm(this.rows.map((r) => r.id), this.targetId);
    });
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
  }

  private renderRows() {
    if (!this.rowsEl) return;
    const list = this.rowsEl;
    list.empty();
    this.rows.forEach((row, i) => {
      const rowEl = list.createDiv({ cls: "feuillets-canvas-bridge-row" });
      const label = rowEl.createDiv({ cls: "feuillets-canvas-bridge-label" });
      label.createSpan({ text: row.title, cls: "feuillets-canvas-bridge-title" });

      const moveBtns = rowEl.createDiv({ cls: "feuillets-canvas-bridge-move" });
      const up = moveBtns.createEl("button", { text: "↑" });
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        if (i === 0) return;
        [this.rows[i - 1], this.rows[i]] = [this.rows[i], this.rows[i - 1]];
        this.renderRows();
      });
      const down = moveBtns.createEl("button", { text: "↓" });
      down.disabled = i === this.rows.length - 1;
      down.addEventListener("click", () => {
        if (i === this.rows.length - 1) return;
        [this.rows[i + 1], this.rows[i]] = [this.rows[i], this.rows[i + 1]];
        this.renderRows();
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
