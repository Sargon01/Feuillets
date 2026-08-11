import { Modal, Notice, type App } from "obsidian";
import JSZip from "jszip";
import { t } from "../i18n/index.js";
import { importUlyssesStyleText } from "../services/ulysses-style-import.js";

type UlyssesImportPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
};

/** Lit le texte ULSS, directement ou depuis l'archive .ulstyle déposée. */
export async function ulyssesStyleTextFromFile(file: Pick<File, "name" | "text" | "arrayBuffer">): Promise<string> {
  if (/\.ulss$/i.test(file.name)) return file.text();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const ulss = zip.file("Style.ulss") || Object.values(zip.files).find((entry) => !entry.dir && /\.ulss$/i.test(entry.name));
  if (!ulss) throw new Error("L’archive .ulstyle ne contient aucun fichier ULSS.");
  return ulss.async("text");
}

/** Import navigateur exclusivement : aucun picker ni accès filesystem, le
 * texte ULSS d'un File déposé est transmis au service existant. */
export class UlyssesImportModal extends Modal {
  constructor(
    app: App,
    private plugin: UlyssesImportPlugin,
    private onImported: () => Promise<void> | void
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("feuillets-ulysses-import-modal");
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Importer un style Ulysses" });
    contentEl.createEl("p", { cls: "feuillets-notes-sub", text: "Déposez ici un fichier .ulstyle ou .ulss" });
    const dropZone = contentEl.createDiv({ cls: "feuillets-ulysses-drop-zone", text: "Déposer un fichier Ulysses ici\n.ulstyle ou .ulss" });
    dropZone.addEventListener("dragenter", (event) => { event.preventDefault(); dropZone.addClass("is-dragging"); });
    dropZone.addEventListener("dragover", (event) => event.preventDefault());
    dropZone.addEventListener("dragleave", () => dropZone.removeClass("is-dragging"));
    dropZone.addEventListener("drop", (event: DragEvent) => {
      event.preventDefault();
      dropZone.removeClass("is-dragging");
      void this.importFile(event.dataTransfer?.files?.[0] || null);
    });
    const footer = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    footer.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
  }

  private async importFile(file: File | null): Promise<void> {
    if (!file || !/\.(ulstyle|ulss)$/i.test(file.name)) {
      new Notice(t("editionLayout.importInvalidFile"));
      return;
    }
    try {
      const result = await importUlyssesStyleText(this.app, this.plugin.settings, await ulyssesStyleTextFromFile(file), file.name);
      if (!result) throw new Error("Dossier projet introuvable.");
      await this.plugin.saveSettings();
      new Notice(t("editionLayout.imported", { label: result.label }));
      this.close();
      await this.onImported();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t("editionLayout.importError", { message }));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
