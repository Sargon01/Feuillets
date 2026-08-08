import { Modal, Notice } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";
import { defaultSplitOf } from "../services/canvas-split-merge.js";

/** Modale « Scinder… » (section 5A) : deux zones de texte préremplies par
 * une coupure par défaut raisonnable (voir `defaultSplitOf`), librement
 * réécrites par l'autrice avant confirmation — jamais de coupure imposée.
 * `onConfirm` reçoit juste les deux morceaux validés ; toute la logique de
 * création du second élément (TextNode ou feuillet) reste à l'appelant
 * (voir integrations/advanced-canvas.ts), jamais dupliquée ici. */
export class CanvasSplitModal extends Modal {
  private title: string;
  private originalText: string;
  private onConfirm: (first: string, second: string) => void | Promise<void>;

  constructor(app: App, title: string, originalText: string, onConfirm: (first: string, second: string) => void | Promise<void>) {
    super(app);
    this.title = title;
    this.originalText = originalText;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.canvasSplit.title", { name: this.title }) });

    const { first, second } = defaultSplitOf(this.originalText);

    contentEl.createEl("label", { text: t("modal.canvasSplit.firstLabel") });
    const firstArea = contentEl.createEl("textarea");
    firstArea.addClass("feuillets-input-full");
    firstArea.rows = 8;
    firstArea.value = first;

    contentEl.createEl("label", { text: t("modal.canvasSplit.secondLabel") });
    const secondArea = contentEl.createEl("textarea");
    secondArea.addClass("feuillets-input-full");
    secondArea.rows = 8;
    secondArea.value = second;

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const confirmBtn = btnRow.createEl("button", { text: t("modal.canvasSplit.confirm"), cls: "mod-cta" });
    confirmBtn.addEventListener("click", () => {
      const a = firstArea.value;
      const b = secondArea.value;
      if (!a.trim() && !b.trim()) {
        new Notice(t("modal.canvasSplit.errorEmpty"));
        return;
      }
      this.close();
      void this.onConfirm(a, b);
    });
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
