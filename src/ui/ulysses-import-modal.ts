import { Modal, Notice, type App } from "obsidian";
import JSZip from "jszip";
import { t } from "../i18n/index.js";
import { importUlyssesStyleText } from "../services/ulysses-style-import.js";

type UlyssesImportPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
};

/** Lit le texte ULSS, directement ou depuis l'archive .ulstyle sélectionnée. */
export async function ulyssesStyleTextFromFile(file: Pick<File, "name" | "text" | "arrayBuffer">): Promise<string> {
  if (/\.ulss$/i.test(file.name)) return file.text();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const ulss = zip.file("Style.ulss") || Object.values(zip.files).find((entry) => !entry.dir && /\.ulss$/i.test(entry.name));
  if (!ulss) throw new Error("L’archive .ulstyle ne contient aucun fichier ULSS.");
  return ulss.async("text");
}

/** Import navigateur Ulysses : sélection native ou dépôt HTML5, sans accès Node. */
export class UlyssesImportModal extends Modal {
  private selectedFile: File | null = null;
  private busy = false;
  private importButton: HTMLButtonElement | null = null;
  private chooseButton: HTMLButtonElement | null = null;
  private fileNameEl: HTMLElement | null = null;

  constructor(
    app: App,
    private plugin: UlyssesImportPlugin,
    private onImported: () => Promise<void> | void
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-ulysses-import-modal");

    contentEl.createEl("h3", { text: t("editionLayout.ulyssesImportTitle") });
    contentEl.createDiv({ cls: "feuillets-feuil-import-intro", text: t("editionLayout.ulyssesImportDescription") });

    const form = contentEl.createDiv({ cls: "feuillets-feuil-import-form" });
    const field = form.createDiv({ cls: "feuillets-feuil-import-field" });
    field.createEl("label", { text: t("editionLayout.ulyssesFileLabel") });
    const fileInput = field.createEl("input", {
      type: "file",
      attr: { accept: ".ulstyle,.ulss" },
      cls: "feuillets-feuil-import-file-input",
    });

    const dropZone = field.createDiv({ cls: "feuillets-drop-target" });
    dropZone.setText(t("editionLayout.ulyssesDrop"));
    dropZone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dropZone.addClass("is-dragging");
    });
    dropZone.addEventListener("dragover", (event) => event.preventDefault());
    dropZone.addEventListener("dragleave", () => dropZone.removeClass("is-dragging"));
    dropZone.addEventListener("drop", (event: DragEvent) => {
      event.preventDefault();
      dropZone.removeClass("is-dragging");
      this.selectFile(event.dataTransfer?.files?.[0] || null);
    });

    const fileRow = field.createDiv({ cls: "feuillets-feuil-import-file-row" });
    this.chooseButton = fileRow.createEl("button", { type: "button", text: t("editionLayout.ulyssesChooseFile") });
    this.chooseButton.addEventListener("click", () => fileInput.click());
    this.fileNameEl = fileRow.createDiv({ cls: "feuillets-feuil-import-file-name" });
    this.fileNameEl.setText(t("editionLayout.ulyssesNoFile"));
    fileInput.addEventListener("change", () => this.selectFile(fileInput.files?.[0] || null));

    const footer = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    footer.createEl("button", { type: "button", text: t("shared.cancel") })
      .addEventListener("click", () => this.close());
    this.importButton = footer.createEl("button", {
      type: "button",
      text: t("editionLayout.ulyssesImportAction"),
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

  private selectFile(file: File | null): void {
    this.selectedFile = null;
    if (this.fileNameEl) this.fileNameEl.setText(file?.name || t("editionLayout.ulyssesNoFile"));
    this.updateSubmitState();
    if (!file || !/\.(ulstyle|ulss)$/i.test(file.name)) {
      if (file) new Notice(t("editionLayout.importInvalidFile"));
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
      const text = await ulyssesStyleTextFromFile(this.selectedFile);
      const result = await importUlyssesStyleText(this.app, this.plugin.settings, text, this.selectedFile.name);
      if (!result) throw new Error("Dossier projet introuvable.");
      await this.plugin.saveSettings();
      new Notice(t("editionLayout.imported", { label: result.label }));
      this.close();
      await this.onImported();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t("editionLayout.importError", { message }));
      this.busy = false;
      this.updateSubmitState();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
