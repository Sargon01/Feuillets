const { Modal } = require("obsidian");
import { t } from "../i18n/index.js";

export class NewSheetModal extends Modal {
  constructor(app, folderName, onSubmit) {
    super(app);
    this.folderName = folderName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.newSheet.title", { folder: this.folderName }),
    });
    contentEl.createEl("label", { text: t("modal.newSheet.fileNameLabel") });
    const fileInput = contentEl.createEl("input", {
      type: "text",
      placeholder: t("modal.newSheet.fileNamePlaceholder"),
    });
    fileInput.addClass("feuillets-input-full");
    fileInput.addClass("feuillets-mb-sm");
    contentEl.createEl("label", {
      text: t("modal.newSheet.titleLabel"),
    });
    const titleInput = contentEl.createEl("input", { type: "text" });
    titleInput.addClass("feuillets-input-full");
    fileInput.focus();
    const submit = () => {
      const fileName = fileInput.value.trim();
      if (!fileName) return;
      this.close();
      this.onSubmit(fileName, titleInput.value.trim());
    };
    for (const el of [fileInput, titleInput]) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    }
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.create") })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Confirmation générique avant une action destructive/étendue (ex.
 * supprimer une propriété de tous les feuillets d'un projet) — pas de
 * window.confirm() natif, pour rester cohérent avec le reste de l'UI. */
export class ConfirmModal extends Modal {
  constructor(app, title, message, confirmLabel, onConfirm) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", { text: this.message });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const confirmBtn = btnRow.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-warning",
    });
    confirmBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
    btnRow
      .createEl("button", { text: t("modal.cancel") })
      .addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class NewFolderModal extends Modal {
  constructor(app, parentName, onSubmit) {
    super(app);
    this.parentName = parentName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.newFolder.title", { parent: this.parentName }),
    });
    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: t("modal.newFolder.placeholder"),
    });
    input.addClass("feuillets-input-full");
    input.focus();
    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      this.close();
      this.onSubmit(name);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.create") })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}
