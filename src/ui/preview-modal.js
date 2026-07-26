const { Modal } = require("obsidian");
import { resolveExportTemplate } from "../services/export-templates-custom.js";
import { paginateManuscript } from "../services/export-pdf.js";
import { templateToCss } from "../utils/export-templates.js";
import { t } from "../i18n/index.js";

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
    dummyEl.innerHTML = `
      <h1>${t("modal.preview.dummy.h1")}</h1>
      <p>${t("modal.preview.dummy.p1")}</p>
      <h2>${t("modal.preview.dummy.h2a")}</h2>
      <p>${t("modal.preview.dummy.p2", { section: `<strong>${t("modal.preview.dummy.h2a")}</strong>` })}</p>
      <h2>${t("modal.preview.dummy.h2b")}</h2>
      <p>${t("modal.preview.dummy.p3")}</p>
    `;

    const { pagesHtml } = paginateManuscript(dummyEl, [], this.settings, tpl, title, author);

    const styleEl = document.createElement("style");
    styleEl.textContent = `
      ${css}
      .pdf-page { transform: scale(0.65); transform-origin: top center; margin-bottom: -130px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); border-radius: 2px; }
    `;

    const wrap = container.createDiv({ cls: "feuillets-pdf-spread-wrap" });
    wrap.appendChild(styleEl);
    wrap.innerHTML += pagesHtml;
  }

  onClose() {
    this.contentEl.empty();
  }
}
