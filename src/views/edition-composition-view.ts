import type { WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { FirstPagePanel, type FirstPagePanelPlugin } from "../ui/first-page-panel.js";

type EditionCompositionPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1] & FirstPagePanelPlugin;

/** Sous-section "Composition de l'ouvrage" du nouvel espace Édition
 * (Phase 3) : première sous-section réellement fonctionnelle, « Première
 * page » (ui/first-page-panel.ts, déplacée depuis ExportPanel) — sans
 * callback, puisqu'aucune PreviewView n'existe forcément ici : les
 * modifications s'écrivent immédiatement dans le feuillet Front et les
 * réglages centraux, qu'un Aperçu ouvert relira à son prochain rendu.
 * Pages liminaires, sommaire, tables, bibliographie, annexes et index
 * rejoindront cette section dans leurs phases respectives — pas de ligne
 * factice les annonçant tant qu'elles ne sont pas réellement là. */
export class EditionCompositionView extends BaseFeuilletsView {
  declare plugin: EditionCompositionPlugin;
  declare targetContainer?: HTMLElement;
  private firstPagePanel: FirstPagePanel | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: EditionCompositionPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return "feuillets-edition-composition";
  }

  getDisplayText(): string {
    return t("editionComposition.displayText");
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-edition-composition-container");

    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "book-open",
      t("editionComposition.displayText"),
      "editionComposition",
      "panel"
    );
    if (collapsed) {
      this.firstPagePanel = null;
      return;
    }

    const firstPageEl = section.createDiv();
    this.firstPagePanel = new FirstPagePanel(this.app, this.plugin, firstPageEl);
    await this.firstPagePanel.render();
  }
}
