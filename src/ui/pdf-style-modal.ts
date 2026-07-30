import { App, Modal, Notice, Setting, type TFolder } from "obsidian";
import { exportPdf, paginateManuscript } from "../services/export-pdf.js";
import { resolveExportTemplate, exportBuiltInTemplates } from "../services/export-templates-custom.js";
import { templateToCss, EXPORT_TEMPLATES } from "../utils/export-templates.js";
import { compile, exportFile } from "../services/compile-export.js";
import { t } from "../i18n/index.js";
import { appendParagraphWithStrong, mountTemplatePreview } from "./template-preview.js";

type ExportFormat = "pdf" | "docx" | "epub";

type PdfStyleSettings = FeuilletsSettings & {
  exportFormat: ExportFormat;
  manuscriptTitle?: string;
  manuscriptAuthor?: string;
};

type PdfStyleModalPlugin = {
  settings: PdfStyleSettings;
  saveSettings(): Promise<void>;
  getProjectFolder(): TFolder | null;
};

export class PdfStyleModal extends Modal {
  plugin: PdfStyleModalPlugin;
  settings: PdfStyleSettings;
  activeFormat: ExportFormat;

  constructor(app: App, plugin: PdfStyleModalPlugin) {
    super(app);
    this.plugin = plugin;
    this.settings = plugin.settings;
    this.activeFormat = this.settings.exportFormat || "pdf";
  }

  async onOpen(): Promise<void> {
    const { contentEl, modalEl } = this;
    modalEl.addClass("feuillets-export-studio-modal");
    contentEl.empty();

    // 1. En-tête fixe et stable
    const headerBar = contentEl.createDiv({ cls: "feuillets-studio-header-bar" });
    headerBar.createEl("h3", { text: t("modal.pdfStyle.title") });

    // Onglets de format (PDF, Word, EPUB)
    const formatTabs = headerBar.createDiv({ cls: "feuillets-studio-format-tabs" });

    const pdfTab = formatTabs.createEl("button", {
      cls: `feuillets-studio-tab ${this.activeFormat === "pdf" ? "is-active" : ""}`,
      text: `📄 ${t("modal.pdfStyle.tabPdf")}`
    });
    const docxTab = formatTabs.createEl("button", {
      cls: `feuillets-studio-tab ${this.activeFormat === "docx" ? "is-active" : ""}`,
      text: `📝 ${t("modal.pdfStyle.tabDocx")}`
    });
    const epubTab = formatTabs.createEl("button", {
      cls: `feuillets-studio-tab ${this.activeFormat === "epub" ? "is-active" : ""}`,
      text: `📚 ${t("modal.pdfStyle.tabEpub")}`
    });

    // Actions à droite : Bouton Exporter (CTA) + Bouton Fermer
    const headerActions = headerBar.createDiv({ cls: "feuillets-studio-header-actions" });
    const exportCta = headerActions.createEl("button", {
      cls: "mod-cta feuillets-studio-export-btn",
      text: t("project.compilation.exportBtn")
    });
    const closeBtn = headerActions.createEl("button", {
      cls: "feuillets-studio-close-btn",
      text: "✕"
    });
    closeBtn.addEventListener("click", () => this.close());

    // 2. Corps de la modale avec défilement indépendant
    const bodyLayout = contentEl.createDiv({ cls: "feuillets-studio-body" });
    const settingsPane = bodyLayout.createDiv({ cls: "feuillets-studio-settings" });
    const previewPane = bodyLayout.createDiv({ cls: "feuillets-studio-preview" });

    const previewHeader = previewPane.createDiv({ cls: "feuillets-studio-preview-header" });
    previewHeader.createSpan({ text: t("modal.pdfStyle.previewHeader") });

    const sheetContainer = previewPane.createDiv({ cls: "feuillets-studio-sheet-container" });

    // Changement de format
    const switchFormat = async (fmt: ExportFormat) => {
      this.activeFormat = fmt;
      this.settings.exportFormat = fmt;
      pdfTab.toggleClass("is-active", fmt === "pdf");
      docxTab.toggleClass("is-active", fmt === "docx");
      epubTab.toggleClass("is-active", fmt === "epub");
      this.renderSettingsControls(settingsPane, sheetContainer);
      await this.renderWysiwygPreview(sheetContainer);
    };

    pdfTab.addEventListener("click", () => { void switchFormat("pdf"); });
    docxTab.addEventListener("click", () => { void switchFormat("docx"); });
    epubTab.addEventListener("click", () => { void switchFormat("epub"); });

    // Action d'exportation
    exportCta.addEventListener("click", () => {
      void (async () => {
        await this.plugin.saveSettings();
        const root = this.plugin.getProjectFolder();
        if (!root) {
          new Notice(t("modal.pdfStyle.selectActiveProject"));
          return;
        }

        if (this.activeFormat === "docx" || this.activeFormat === "epub") {
          await exportFile(this.app, this.settings, this.activeFormat);
        } else {
          const result = await compile(this.app, this.plugin.settings);
          if (!result) return;
          const title = this.settings.manuscriptTitle || root.name;
          const author = this.settings.manuscriptAuthor || "";
          const ctx = { markdown: result.manuscript, title, author, sourcePath: root.path };
          await exportPdf(this.app, this.settings, ctx);
        }
        this.close();
      })();
    });

    // Rendu initial
    this.renderSettingsControls(settingsPane, sheetContainer);
    await this.renderWysiwygPreview(sheetContainer);
  }

  renderSettingsControls(container: HTMLElement, sheetContainer: HTMLElement): void {
    container.empty();

    // Section 1 : Style Éditorial
    container.createEl("h4", { text: `🎨 ${t("modal.pdfStyle.layoutModel")}` });

    new Setting(container)
      .setName(t("modal.pdfStyle.editorialModel"))
      .setDesc(t("modal.pdfStyle.editorialModelDesc"))
      .addDropdown((d) => {
        Object.keys(EXPORT_TEMPLATES).forEach((k) => {
          d.addOption(k, EXPORT_TEMPLATES[k].label);
        });
        d.setValue(this.settings.exportTemplate || "classique");
        d.onChange(async (v) => {
          this.settings.exportTemplate = v;
          await this.renderWysiwygPreview(sheetContainer);
        });
      });

    new Setting(container)
      .setName(t("modal.pdfStyle.customTemplates"))
      .setDesc(t("modal.pdfStyle.customTemplatesDesc"))
      .addButton((b) =>
        b.setButtonText(t("modal.pdfStyle.exportBtn")).onClick(async () => {
          const n = await exportBuiltInTemplates(this.app, this.settings);
          new Notice(
            n > 0
              ? t("main.notice.templatesExported", { count: String(n) })
              : t("main.notice.templatesAlreadyPresent")
          );
        })
      );

    // Section 2 : En-têtes & Pieds de page (Word & PDF)
    container.createEl("h4", { text: `✍️ ${t("modal.pdfStyle.headersFooters")}` });

    new Setting(container)
      .setName(t("settings.pdfDiffHeaders.name"))
      .setDesc(t("modal.pdfStyle.altHeadersDesc"))
      .addToggle((t2) =>
        t2.setValue(!!this.settings.pdfDiffHeaders).onChange(async (v) => {
          this.settings.pdfDiffHeaders = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    new Setting(container)
      .setName(t("settings.pdfHeaderLeft.name"))
      .addText((text) =>
        text.setValue(this.settings.pdfHeaderLeft || "{title}").onChange(async (v) => {
          this.settings.pdfHeaderLeft = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    new Setting(container)
      .setName(t("settings.pdfHeaderRight.name"))
      .addText((text) =>
        text.setValue(this.settings.pdfHeaderRight || "{author}").onChange(async (v) => {
          this.settings.pdfHeaderRight = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    // Section 3 : Numérotation
    container.createEl("h4", { text: `🔢 ${t("modal.pdfStyle.pageNumbering")}` });

    new Setting(container)
      .setName(t("modal.pdfStyle.numberPosition"))
      .addDropdown((d) =>
        d
          .addOptions({
            right: t("settings.pdfPageNumberPosition.right"),
            center: t("settings.pdfPageNumberPosition.center"),
            left: t("settings.pdfPageNumberPosition.left"),
          })
          .setValue(this.settings.pdfPageNumberPosition || "right")
          .onChange(async (v: "right" | "center" | "left") => {
            this.settings.pdfPageNumberPosition = v;
            await this.renderWysiwygPreview(sheetContainer);
          })
      );

    new Setting(container)
      .setName(t("modal.pdfStyle.numberFormat"))
      .addText((text) =>
        text.setValue(this.settings.pdfFooterRight || "Page {page} sur {pages}").onChange(async (v) => {
          this.settings.pdfFooterRight = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    new Setting(container)
      .setName(t("modal.pdfStyle.hideOnFirstPage"))
      .addToggle((t2) =>
        t2.setValue(this.settings.pdfHideFirstPageHeader ?? true).onChange(async (v) => {
          this.settings.pdfHideFirstPageHeader = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    if (this.activeFormat !== "epub") {
      // Section 4 : Format & Marges
      container.createEl("h4", { text: `📐 ${t("modal.pdfStyle.marginsBinding")}` });

      new Setting(container)
        .setName(t("settings.pdfPageSize.name"))
        .addDropdown((d) =>
          d
            .addOptions({ A4: "A4", letter: "US Letter", A5: "A5", poche: t("modal.pdfStyle.pocketSize") })
            .setValue(this.settings.pdfPageSize || "A4")
            .onChange(async (v) => {
              this.settings.pdfPageSize = v;
              await this.renderWysiwygPreview(sheetContainer);
            })
        );

      new Setting(container)
        .setName(t("modal.pdfStyle.marginTopBottom"))
        .addText((t2) =>
          t2.setValue(String(this.settings.pdfMarginTop ?? 2.5)).onChange(async (v) => {
            this.settings.pdfMarginTop = parseFloat(v) || 2.5;
            this.settings.pdfMarginBottom = parseFloat(v) || 2.5;
            await this.renderWysiwygPreview(sheetContainer);
          })
        );

      new Setting(container)
        .setName(t("settings.pdfMarginLeft.name"))
        .addText((t2) =>
          t2.setValue(String(this.settings.pdfMarginLeft ?? 2.5)).onChange(async (v) => {
            this.settings.pdfMarginLeft = parseFloat(v) || 2.5;
            await this.renderWysiwygPreview(sheetContainer);
          })
        );

      new Setting(container)
        .setName(t("settings.pdfMirrorMargins.name"))
        .addToggle((t2) =>
          t2.setValue(!!this.settings.pdfMirrorMargins).onChange(async (v) => {
            this.settings.pdfMirrorMargins = v;
            await this.renderWysiwygPreview(sheetContainer);
          })
        );
    }
  }

  async renderWysiwygPreview(container: HTMLElement): Promise<void> {
    container.empty();

    const root = this.plugin ? this.plugin.getProjectFolder() : null;
    const title = this.settings.manuscriptTitle || (root ? root.name : t("analysis.dashboard.defaultManuscriptName"));
    const author = this.settings.manuscriptAuthor || t("modal.preview.defaultAuthor");

    const tpl = await resolveExportTemplate(this.app, this.settings, this.settings.exportTemplate);
    const css = templateToCss(tpl);

    // Détaché tant qu'il n'est pas passé à paginateManuscript — élément du
    // document principal Obsidian (ses enfants sont déjà créés via createEl).
    const dummyEl = createDiv();
    dummyEl.createEl("h1", { text: t("modal.preview.dummy.h1") });
    dummyEl.createEl("p", { text: t("modal.preview.dummy.p1") });
    dummyEl.createEl("p", { text: t("modal.pdfStyle.dummyP2") });
    dummyEl.createEl("h2", { text: t("modal.preview.dummy.h2a") });
    appendParagraphWithStrong(dummyEl, "modal.pdfStyle.dummyP3", t("modal.preview.dummy.h2a"));
    dummyEl.createEl("h2", { text: t("modal.preview.dummy.h2b") });
    dummyEl.createEl("p", { text: t("modal.preview.dummy.p3") });

    const { pagesHtml } = paginateManuscript(dummyEl, [], this.settings, tpl, title, author);

    const previewWrap = container.createDiv({ cls: "feuillets-pdf-spread-wrap" });
    mountTemplatePreview(previewWrap, css, pagesHtml, {
      scale: 0.56,
      marginBottomPx: -175,
      shadow: "0 4px 16px rgba(0,0,0,0.15)",
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
