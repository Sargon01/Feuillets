import { Modal, type App, type TFile, type TFolder, Notice, Setting } from "obsidian";
import { t } from "../i18n/index.js";
import { getProjectFolder } from "../services/folder-structure.js";
import { type CompileScope, resolveCompileScopeFiles, createProjectScope, createFileScope, createFolderScope, createSelectionScope } from "../services/compile-scope.js";
import { type ExportFormat } from "../services/compile-export.js";

export type ExportScope = {
  type: "file" | "folder" | "selection" | "project";
  files?: TFile[];
  name?: string;
  folderPath?: string;
};

type ExportModalPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  titleFor(file: TFile): string;
};

export class ExportModal extends Modal {
  plugin: ExportModalPlugin;
  exportScope: ExportScope;
  private selectedFormat: ExportFormat;
  private outputName: string = "";
  private onSubmit?: (format: ExportFormat, name: string) => Promise<void>;

  constructor(app: App, plugin: ExportModalPlugin, exportScope: ExportScope) {
    super(app);
    this.plugin = plugin;
    this.exportScope = exportScope;
    const configuredFormat = plugin.settings.exportFormat;
    this.selectedFormat =
      configuredFormat === "md" ||
      configuredFormat === "epub" ||
      configuredFormat === "docx" ||
      configuredFormat === "odt" ||
      configuredFormat === "pdf"
        ? configuredFormat
        : "docx";
    this.outputName = this.getDefaultOutputName();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // Titre
    contentEl.createEl("h2", { text: t("modal.export.title") });

    // Description de la portée
    const scopeDesc = this.getScopeDescription();
    contentEl.createEl("p", { cls: "setting-item-description", text: scopeDesc });

    // Nombre de fichiers
    const projectRoot = getProjectFolder(this.app, this.plugin.settings);
    if (projectRoot) {
      const scope = this.getCompileScope(projectRoot);
      const files = resolveCompileScopeFiles(this.app, this.plugin.settings, scope);
      contentEl.createEl("p", { cls: "setting-item-description" }).setText(
        t("modal.export.fileCount", { count: String(files.length), s: files.length > 1 ? "s" : "" })
      );
    }

    // Section des réglages
    const settingsContainer = contentEl.createDiv();

    // Nom de sortie
    new Setting(settingsContainer)
      .setName(t("modal.export.outputName"))
      .setDesc(t("modal.export.outputNameDesc") || "")
      .addText((text) =>
        text
          .setValue(this.outputName)
          .setPlaceholder("Manuscrit")
          .onChange((value) => {
            this.outputName = this.sanitizeFileName(value);
          })
      );

    // Format d'export
    new Setting(settingsContainer)
      .setName(t("modal.export.format"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("epub", "EPUB")
          .addOption("docx", "Word (DOCX)")
          .addOption("pdf", "PDF")
          .addOption("odt", "OpenDocument (ODT)")
          .addOption("md", "Markdown");
        dropdown.setValue(this.selectedFormat);
        dropdown.onChange((value) => {
          this.selectedFormat = value as ExportFormat;
        });
      });

    // Boutons
    const buttonContainer = contentEl.createDiv({
      cls: "modal-button-container feuillets-export-modal-buttons",
    });

    const cancelBtn = buttonContainer.createEl("button", { text: t("shared.cancel") });
    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    const exportBtn = buttonContainer.createEl("button", {
      text: t("modal.export.exportAction"),
      cls: "mod-cta",
    });
    exportBtn.addEventListener("click", () => {
      void (async () => {
        if (!this.outputName.trim()) {
          new Notice(t("modal.export.emptyName") || "Le nom ne peut pas être vide");
          return;
        }
        if (this.onSubmit) {
          await this.onSubmit(this.selectedFormat, this.outputName);
        }
        this.close();
      })();
    });
  }

  setOnSubmit(callback: (format: ExportFormat, name: string) => Promise<void>) {
    this.onSubmit = callback;
  }

  private getScopeDescription(): string {
    switch (this.exportScope.type) {
      case "file":
        return t("modal.export.scope.file");
      case "folder":
        return t("modal.export.scope.folder", { name: this.exportScope.name || "dossier" });
      case "selection":
        return t("modal.export.scope.selection");
      case "project":
        return t("modal.export.scope.project");
      default:
        return "";
    }
  }

  private getDefaultOutputName(): string {
    switch (this.exportScope.type) {
      case "file":
        return this.exportScope.files?.[0]?.basename || "Manuscrit";
      case "folder":
        return this.exportScope.name || "Dossier";
      case "selection":
        return "Recueil";
      case "project":
        return this.plugin.getProjectFolder()?.name || "Manuscrit";
      default:
        return "Manuscrit";
    }
  }

  private getCompileScope(projectRoot: TFolder): CompileScope {
    switch (this.exportScope.type) {
      case "file":
        return createFileScope(projectRoot.path, this.exportScope.files?.[0]?.path || "");
      case "folder":
        return createFolderScope(projectRoot.path, this.exportScope.folderPath || "");
      case "selection":
        return createSelectionScope(projectRoot.path, this.exportScope.files?.map((f) => f.path) || []);
      case "project":
        return createProjectScope(projectRoot.path);
      default:
        return createProjectScope(projectRoot.path);
    }
  }

  private sanitizeFileName(name: string): string {
    if (!name) return "";
    // Enlever l'extension si elle existe
    let cleaned = name.replace(/\.(epub|docx|pdf|odt|md)$/i, "");
    // Enlever les caractères interdits dans les noms de fichier
    cleaned = cleaned.replace(/[<>:"/\\|?*]/g, "");
    return cleaned.trim();
  }

  onClose() {
    this.contentEl.empty();
  }
}
