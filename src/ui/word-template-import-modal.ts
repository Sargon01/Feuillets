import { Modal, Notice, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { importWordTemplate } from "../services/word-template-import.js";

type Plugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
};

/** Import navigateur Word : dépôt HTML5 et sélection native, aucun accès Node. */
export class WordTemplateImportModal extends Modal {
  private selectedFile: File | null = null;
  private busy = false;
  private importButton: HTMLButtonElement | null = null;
  private chooseButton: HTMLButtonElement | null = null;
  private fileNameEl: HTMLElement | null = null;

  constructor(app: App, private plugin: Plugin, private onImported: () => Promise<void> | void) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-word-template-import-modal");
    this.selectedFile = null;
    this.busy = false;

    contentEl.createEl("h3", { text: t("editionLayout.importWord") });
    contentEl.createDiv({ cls: "feuillets-feuil-import-intro", text: t("editionLayout.wordDescription") });

    const form = contentEl.createDiv({ cls: "feuillets-feuil-import-form" });
    const field = form.createDiv({ cls: "feuillets-feuil-import-field" });
    field.createEl("label", { text: t("editionLayout.wordDrop") });

    const fileInput = field.createEl("input", {
      type: "file",
      attr: {
        accept: ".docx,.dotx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.wordprocessingml.template"
      },
      cls: "feuillets-feuil-import-file-input",
    });
    const dropArea = field.createDiv({ cls: "feuillets-drop-target" });
    dropArea.setText(t("editionLayout.wordDrop"));
    dropArea.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropArea.addClass("is-active");
    });
    dropArea.addEventListener("dragleave", () => dropArea.removeClass("is-active"));
    dropArea.addEventListener("drop", (event) => {
      event.preventDefault();
      dropArea.removeClass("is-active");
      void this.selectFile(event.dataTransfer?.files?.[0] || null);
    });

    const fileRow = field.createDiv({ cls: "feuillets-feuil-import-file-row" });
    this.chooseButton = fileRow.createEl("button", { type: "button", text: t("editionLayout.wordChooseFile") });
    this.chooseButton.addEventListener("click", () => fileInput.click());
    this.fileNameEl = fileRow.createDiv({ cls: "feuillets-feuil-import-file-name" });
    this.fileNameEl.setText(t("editionLayout.wordNoFile"));
    fileInput.addEventListener("change", () => { void this.selectFile(fileInput.files?.[0] || null); });

    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { type: "button", text: t("shared.cancel") })
      .addEventListener("click", () => this.close());
    this.importButton = buttons.createEl("button", {
      type: "button",
      text: t("editionLayout.importWord"),
      cls: "mod-cta",
    });
    this.importButton.addEventListener("click", () => { void this.submit(); });
    this.updateSubmitState();
  }

  private updateSubmitState(): void {
    const disabled = this.busy || this.selectedFile === null;
    if (this.importButton) this.importButton.disabled = disabled;
    if (this.chooseButton) this.chooseButton.disabled = this.busy;
  }

  private async selectFile(file: File | null): Promise<void> {
    this.selectedFile = null;
    if (this.fileNameEl) this.fileNameEl.setText(file?.name || t("editionLayout.wordNoFile"));
    this.updateSubmitState();
    if (!file || !/\.(docx|dotx)$/i.test(file.name)) {
      if (file) new Notice(t("editionLayout.wordInvalidFile"));
      return;
    }
    this.selectedFile = file;
    this.updateSubmitState();
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.selectedFile) return;
    this.busy = true;
    this.updateSubmitState();
    try {
      const result = await importWordTemplate(
        this.app,
        this.plugin.settings,
        this.selectedFile.name,
        await this.selectedFile.arrayBuffer(),
      );
      if (!result) throw new Error("Dossier projet introuvable.");
      await this.plugin.saveSettings();
      new Notice(t("editionLayout.wordImported", { label: result.label }));
      this.close();
      await this.onImported();
    } catch (error) {
      new Notice(t("editionLayout.wordImportError", {
        message: error instanceof Error ? error.message : String(error),
      }));
      this.busy = false;
      this.updateSubmitState();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
