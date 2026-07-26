const { Modal } = require("obsidian");
import { resolveExportTemplate } from "../services/export-templates-custom.js";
import { paginateManuscript } from "../services/export-pdf.js";
import { templateToCss } from "../utils/export-templates.js";
import { t } from "../i18n/index.js";
import { appendParagraphWithStrong, mountTemplatePreview } from "./template-preview.js";

/** Modale d'aperçu visuel dédiée : s'ouvre uniquement au clic sur l'icône d'œil
 * ou le bouton "Aperçu visuel", sans encombrer la barre latérale. */
export class PreviewModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.settings = plugin.settings;
  }

  async onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("feuillets-preview-modal");
    contentEl.empty();

    // En-tête sobre
    const header = contentEl.createDiv({ cls: "feuillets-preview-modal-header" });
    header.createEl("h3", { text: t("modal.preview.title") });
    
    const closeBtn = header.createEl("button", { cls: "feuillets-studio-close-btn", text: "✕" });
    closeBtn.addEventListener("click", () => this.close());

    // Canvas d'aperçu de la feuille de papier
    const body = contentEl.createDiv({ cls: "feuillets-preview-modal-body" });
    await this.renderPreview(body);
  }

  async renderPreview(container) {
    container.empty();
    const root = this.plugin ? this.plugin.getProjectFolder() : null;
    const title = this.settings.manuscriptTitle || (root ? root.name : t("analysis.dashboard.defaultManuscriptName"));
    const author = this.settings.manuscriptAuthor || t("modal.preview.defaultAuthor");

    const tpl = await resolveExportTemplate(this.app, this.settings, this.settings.exportTemplate);
    const css = templateToCss(tpl);

    const dummyEl = document.createElement("div");
    dummyEl.createEl("h1", { text: t("modal.preview.dummy.h1") });
    dummyEl.createEl("p", { text: t("modal.preview.dummy.p1") });
    dummyEl.createEl("h2", { text: t("modal.preview.dummy.h2a") });
    appendParagraphWithStrong(dummyEl, "modal.preview.dummy.p2", t("modal.preview.dummy.h2a"));
    dummyEl.createEl("h2", { text: t("modal.preview.dummy.h2b") });
    dummyEl.createEl("p", { text: t("modal.preview.dummy.p3") });

    const { pagesHtml } = paginateManuscript(dummyEl, [], this.settings, tpl, title, author);

    const wrap = container.createDiv({ cls: "feuillets-pdf-spread-wrap" });
    mountTemplatePreview(wrap, css, pagesHtml, {
      scale: 0.65,
      marginBottomPx: -130,
      shadow: "0 4px 20px rgba(0,0,0,0.2)",
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
