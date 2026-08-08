import { Modal } from "obsidian";
import type { App } from "obsidian";
import { t } from "../i18n/index.js";

/** Saisie minimale : une ligne non vide donnera une TextNode enfant. */
export class CanvasIdeaTreeModal extends Modal {
  constructor(app: App, private readonly onSubmit: (text: string) => void | Promise<void>) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.canvasIdeaTree.title") });
    const input = contentEl.createEl("textarea");
    input.addClass("feuillets-input-full");
    input.rows = 7;
    input.placeholder = t("modal.canvasIdeaTree.placeholder");
    input.focus();

    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
    const confirm = buttons.createEl("button", {
      text: t("modal.canvasIdeaTree.confirm"),
      cls: "mod-cta",
    });
    confirm.addEventListener("click", () => {
      void Promise.resolve(this.onSubmit(input.value)).then(() => this.close());
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
