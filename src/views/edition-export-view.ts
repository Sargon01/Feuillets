import type { WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { ExportPanel } from "../ui/export-panel.js";

type EditionExportPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];

/** Sous-section "Exporter" du nouvel espace Édition (Phase 1) : monte le
 * panneau Export partagé (ui/export-panel.ts) SANS aucune instance de
 * PreviewView. La portée vient donc automatiquement de
 * `currentExportScope(plugin)` (services/export-workflow.ts) : la portée
 * choisie en session dans l'Aperçu ou le Binder si elle existe, sinon le
 * Projet entier.
 *
 * Volontairement minimale : aucune logique d'export propre, aucune
 * duplication du panneau — juste son montage, comme DocxReviewView et
 * EditionDocsView montent leur propre contenu dans le même onglet
 * "Édition" du panneau latéral (sidebar-feuillets-view.js). */
export class EditionExportView extends BaseFeuilletsView {
  declare plugin: EditionExportPlugin;
  declare targetContainer?: HTMLElement;

  private exportPanel: ExportPanel | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: EditionExportPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return "feuillets-edition-export";
  }

  getDisplayText(): string {
    return t("editionExport.displayText");
  }

  getIcon(): string {
    return "download";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-edition-export-container");

    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "download",
      t("editionExport.displayText"),
      "editionExport",
      "panel"
    );
    if (collapsed) {
      this.exportPanel = null;
      return;
    }

    const panelEl = section.createDiv({ cls: "feuillets-edition-export-panel" });
    this.exportPanel = new ExportPanel(this.app, this.plugin, panelEl, {
      embedded: true,
    });
    await this.exportPanel.render();
  }
}
