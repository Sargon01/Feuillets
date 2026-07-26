const { Modal, Notice, Setting, ButtonComponent } = require("obsidian");
import { exportPdf, paginateManuscript } from "../services/export-pdf.js";
import { resolveExportTemplate, exportBuiltInTemplates } from "../services/export-templates-custom.js";
import { templateToCss, EXPORT_TEMPLATES } from "../utils/export-templates.js";
import { compile, exportFile } from "../services/compile-export.js";

export class PdfStyleModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.settings = plugin.settings;
    this.activeFormat = this.settings.exportFormat || "pdf"; // "pdf" | "docx" | "epub"
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("feuillets-export-studio-modal");
    contentEl.empty();

    // 1. En-tête fixe et stable
    const headerBar = contentEl.createDiv({ cls: "feuillets-studio-header-bar" });
    headerBar.createEl("h3", { text: "Studio d'exportation & Mise en page" });

    // Onglets de format (PDF, Word, EPUB)
    const formatTabs = headerBar.createDiv({ cls: "feuillets-studio-format-tabs" });
    
    const pdfTab = formatTabs.createEl("button", {
      cls: `feuillets-studio-tab ${this.activeFormat === "pdf" ? "is-active" : ""}`,
      text: "📄 PDF (Impression)"
    });
    const docxTab = formatTabs.createEl("button", {
      cls: `feuillets-studio-tab ${this.activeFormat === "docx" ? "is-active" : ""}`,
      text: "📝 Word (.docx)"
    });
    const epubTab = formatTabs.createEl("button", {
      cls: `feuillets-studio-tab ${this.activeFormat === "epub" ? "is-active" : ""}`,
      text: "📚 EPUB (Ebook)"
    });

    // Actions à droite : Bouton Exporter (CTA) + Bouton Fermer
    const headerActions = headerBar.createDiv({ cls: "feuillets-studio-header-actions" });
    const exportCta = headerActions.createEl("button", {
      cls: "mod-cta feuillets-studio-export-btn",
      text: "Exporter"
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
    previewHeader.createSpan({ text: "Aperçu visuel du manuscrit" });

    const sheetContainer = previewPane.createDiv({ cls: "feuillets-studio-sheet-container" });

    // Changement de format
    const switchFormat = async (fmt) => {
      this.activeFormat = fmt;
      this.settings.exportFormat = fmt;
      pdfTab.toggleClass("is-active", fmt === "pdf");
      docxTab.toggleClass("is-active", fmt === "docx");
      epubTab.toggleClass("is-active", fmt === "epub");
      this.renderSettingsControls(settingsPane, sheetContainer);
      await this.renderWysiwygPreview(sheetContainer);
    };

    pdfTab.addEventListener("click", () => switchFormat("pdf"));
    docxTab.addEventListener("click", () => switchFormat("docx"));
    epubTab.addEventListener("click", () => switchFormat("epub"));

    // Action d'exportation
    exportCta.addEventListener("click", async () => {
      await this.plugin.saveSettings();
      const root = this.plugin.getProjectFolder();
      if (!root) {
        new Notice("Veuillez sélectionner un projet actif.");
        return;
      }

      if (this.activeFormat === "docx" || this.activeFormat === "epub") {
        await exportFile(this.app, this.settings, this.activeFormat);
      } else {
        const result = await compile(this.app, this.plugin.settings);
        const title = this.settings.manuscriptTitle || root.name;
        const author = this.settings.manuscriptAuthor || "";
        const ctx = { markdown: result.manuscript, title, author, sourcePath: root.path };
        await exportPdf(this.app, this.settings, ctx);
      }
      this.close();
    });

    // Rendu initial
    this.renderSettingsControls(settingsPane, sheetContainer);
    await this.renderWysiwygPreview(sheetContainer);
  }

  renderSettingsControls(container, sheetContainer) {
    container.empty();

    // Section 1 : Style Éditorial
    container.createEl("h4", { text: "🎨 Modèle de mise en page" });

    new Setting(container)
      .setName("Modèle éditorial")
      .setDesc("Style de typographie et d'interligne.")
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
      .setName("Modèles personnalisés")
      .setDesc("Exporter les modèles dans le coffre (Resources/Layouts) pour les éditer.")
      .addButton((b) =>
        b.setButtonText("Exporter…").onClick(async () => {
          const n = await exportBuiltInTemplates(this.app, this.settings);
          new Notice(
            n > 0
              ? `${n} modèle(s) exporté(s) dans Resources/Layouts.`
              : "Tous les modèles intégrés sont déjà présents dans Resources/Layouts."
          );
        })
      );

    // Section 2 : En-têtes & Pieds de page (Word & PDF)
    container.createEl("h4", { text: "✍️ En-têtes & Pieds de page" });

    new Setting(container)
      .setName("En-têtes alternés")
      .setDesc("Pages paires (gauches) et impaires (droites).")
      .addToggle((t) =>
        t.setValue(!!this.settings.pdfDiffHeaders).onChange(async (v) => {
          this.settings.pdfDiffHeaders = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    new Setting(container)
      .setName("En-tête gauche")
      .addText((text) =>
        text.setValue(this.settings.pdfHeaderLeft || "{title}").onChange(async (v) => {
          this.settings.pdfHeaderLeft = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    new Setting(container)
      .setName("En-tête droit")
      .addText((text) =>
        text.setValue(this.settings.pdfHeaderRight || "{author}").onChange(async (v) => {
          this.settings.pdfHeaderRight = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    // Section 3 : Numérotation
    container.createEl("h4", { text: "🔢 Numérotation des pages" });

    new Setting(container)
      .setName("Position du numéro")
      .addDropdown((d) =>
        d
          .addOptions({ right: "Droite", center: "Centré", left: "Gauche" })
          .setValue(this.settings.pdfPageNumberPosition || "right")
          .onChange(async (v) => {
            this.settings.pdfPageNumberPosition = v;
            await this.renderWysiwygPreview(sheetContainer);
          })
      );

    new Setting(container)
      .setName("Format du numéro")
      .addText((text) =>
        text.setValue(this.settings.pdfFooterRight || "Page {page} sur {pages}").onChange(async (v) => {
          this.settings.pdfFooterRight = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    new Setting(container)
      .setName("Masquer sur 1re page")
      .addToggle((t) =>
        t.setValue(this.settings.pdfHideFirstPageHeader ?? true).onChange(async (v) => {
          this.settings.pdfHideFirstPageHeader = v;
          await this.renderWysiwygPreview(sheetContainer);
        })
      );

    if (this.activeFormat !== "epub") {
      // Section 4 : Format & Marges
      container.createEl("h4", { text: "📐 Marges & Reliure" });

      new Setting(container)
        .setName("Format du papier")
        .addDropdown((d) =>
          d
            .addOptions({ A4: "A4", letter: "US Letter", A5: "A5", poche: "Poche (11x18 cm)" })
            .setValue(this.settings.pdfPageSize || "A4")
            .onChange(async (v) => {
              this.settings.pdfPageSize = v;
              await this.renderWysiwygPreview(sheetContainer);
            })
        );

      new Setting(container)
        .setName("Marge Haut/Bas (cm)")
        .addText((t) =>
          t.setValue(String(this.settings.pdfMarginTop ?? 2.5)).onChange(async (v) => {
            this.settings.pdfMarginTop = parseFloat(v) || 2.5;
            this.settings.pdfMarginBottom = parseFloat(v) || 2.5;
            await this.renderWysiwygPreview(sheetContainer);
          })
        );

      new Setting(container)
        .setName("Marge Reliure (cm)")
        .addText((t) =>
          t.setValue(String(this.settings.pdfMarginLeft ?? 2.5)).onChange(async (v) => {
            this.settings.pdfMarginLeft = parseFloat(v) || 2.5;
            await this.renderWysiwygPreview(sheetContainer);
          })
        );

      new Setting(container)
        .setName("Marges miroir")
        .addToggle((t) =>
          t.setValue(!!this.settings.pdfMirrorMargins).onChange(async (v) => {
            this.settings.pdfMirrorMargins = v;
            await this.renderWysiwygPreview(sheetContainer);
          })
        );
    }
  }

  async renderWysiwygPreview(container) {
    container.empty();

    const root = this.plugin ? this.plugin.getProjectFolder() : null;
    const title = this.settings.manuscriptTitle || (root ? root.name : "Manuscrit");
    const author = this.settings.manuscriptAuthor || "Auteur";

    const tpl = await resolveExportTemplate(this.app, this.settings, this.settings.exportTemplate);
    const css = templateToCss(tpl);

    const dummyEl = document.createElement("div");
    dummyEl.innerHTML = `
      <h1>Bonjour et bienvenue !</h1>
      <p>Nous sommes ravis de vous voir ici ! Merci de nous accorder quelques instants avant de vous lancer dans l'écriture. Bien que l'éditeur ressemble à un simple outil de texte, il offre une mise en page très complète.</p>
      <p>Voici donc un peu de lecture avant de commencer à écrire.</p>
      <h2>Ce qu'il faut savoir</h2>
      <p>Dans <strong>Ce qu'il faut savoir</strong>, nous expliquons les principes fondamentaux du projet. Rassurez-vous : ça n'a rien de compliqué, et vous aurez tout compris en un rien de temps.</p>
      <h2>Organisation du manuscrit</h2>
      <p>Vous pouvez facilement structurer vos chapitres, vos scènes et vos notes de projet.</p>
    `;

    const { pagesHtml } = paginateManuscript(dummyEl, [], this.settings, tpl, title, author);

    const styleEl = document.createElement("style");
    styleEl.textContent = `
      ${css}
      .pdf-page { transform: scale(0.56); transform-origin: top center; margin-bottom: -175px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); border-radius: 2px; }
    `;

    const previewWrap = container.createDiv({ cls: "feuillets-pdf-spread-wrap" });
    previewWrap.appendChild(styleEl);
    previewWrap.innerHTML += pagesHtml;
  }

  onClose() {
    this.contentEl.empty();
  }
}
