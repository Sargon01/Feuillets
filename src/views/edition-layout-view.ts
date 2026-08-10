import type { WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";

type EditionLayoutPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];

/** Sous-section "Mise en page" du nouvel espace Édition (Phase 2) :
 * conteneur structurel uniquement. Gabarit, typographie, marges, en-têtes et
 * pieds de page (sélecteur de gabarit, LayoutModal…) rejoindront cette
 * section à partir de la Phase 11 — ils restent pour l'instant dans le
 * panneau Export (Première page comprise). Aucun réglage, aucun fichier
 * créé, aucune nouvelle donnée ; aucune dépendance à PreviewView. */
export class EditionLayoutView extends BaseFeuilletsView {
  declare plugin: EditionLayoutPlugin;
  declare targetContainer?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: EditionLayoutPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return "feuillets-edition-layout";
  }

  getDisplayText(): string {
    return t("editionLayout.displayText");
  }

  getIcon(): string {
    return "panel-top";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-edition-layout-container");

    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "panel-top",
      t("editionLayout.displayText"),
      "editionLayout",
      "panel"
    );
    if (collapsed) return;

    section.createDiv({ cls: "feuillets-edition-section-description" }).setText(
      t("editionLayout.description")
    );
  }
}
