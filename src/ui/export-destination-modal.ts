import { Modal, Notice, Setting, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { FolderSuggest } from "./folder-suggest.js";
import { assertExportDestinationAvailable, exportDestination, type ExportDestination, type ExportSaveRequest } from "../services/export-destination.js";

/** Uses only public Obsidian APIs, including on mobile. */
export class ExportDestinationModal extends Modal {
  private fileName: string;
  private folderPath: string;
  private settled = false;

  constructor(app: App, private request: ExportSaveRequest, private resolve: (destination: ExportDestination | null) => void) {
    super(app);
    this.fileName = request.fileName;
    this.folderPath = request.folderPath;
  }

  onOpen(): void {
    this.titleEl.setText(t("export.save.title"));
    this.contentEl.createEl("p", { text: t("export.save.vaultDescription"), cls: "setting-item-description" });
    new Setting(this.contentEl).setName(t("preview.export.fileName")).addText((text) => {
      text.setValue(this.fileName).onChange((value) => { this.fileName = value; });
      text.inputEl.setAttribute("aria-label", t("preview.export.outputFileName"));
    });
    new Setting(this.contentEl).setName(t("export.save.folder")).addText((text) => {
      text.setValue(this.folderPath).onChange((value) => { this.folderPath = value; });
      text.inputEl.setAttribute("aria-label", t("export.save.folder"));
      new FolderSuggest(this.app, text.inputEl).onSelect((folder) => { this.folderPath = folder.path; });
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t("shared.cancel")).onClick(() => this.close()))
      .addButton((button) => button.setButtonText(t("export.save.action")).setCta().onClick(() => this.submit()));
  }

  private submit(): void {
    if (this.settled) return;
    try {
      const destination = exportDestination(this.app, this.folderPath, this.fileName, this.request.extension);
      assertExportDestinationAvailable(this.app, destination);
      this.settled = true;
      this.resolve(destination);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("export.save.failed"));
    }
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
    this.contentEl.empty();
  }
}
