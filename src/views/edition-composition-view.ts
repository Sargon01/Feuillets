import { setIcon, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { FirstPagePanel, type FirstPagePanelPlugin } from "../ui/first-page-panel.js";
import { FrontMatterPanel, type FrontMatterPanelPlugin } from "../ui/front-matter-panel.js";
import { ContentsPanel, type ContentsPanelPlugin } from "../ui/contents-panel.js";
import { TablesPanel, type TablesPanelPlugin } from "../ui/tables-panel.js";
import { BibliographyPanel, type BibliographyPanelPlugin } from "../ui/bibliography-panel.js";
import { AnnexesPanel, type AnnexesPanelPlugin } from "../ui/annexes-panel.js";
import { CompileSelectionModal, manuscriptBodyFiles } from "../ui/selection-modals.js";

type EditionCompositionPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1]
  & FirstPagePanelPlugin
  & FrontMatterPanelPlugin
  & ContentsPanelPlugin
  & TablesPanelPlugin
  & BibliographyPanelPlugin
  & AnnexesPanelPlugin;

/** Sous-section "Composition de l'ouvrage" du nouvel espace Édition :
 * « Première page » (ui/first-page-panel.ts, Phase 3), « Pages liminaires »
 * (ui/front-matter-panel.ts, Phase 5), « Sommaire »/« Table des matières »
 * (ui/contents-panel.ts, Phase 6), « Tables » (ui/tables-panel.ts,
 * Phase 7), « Bibliographie » (ui/bibliography-panel.ts, Phase 8), puis
 * « Annexes » (ui/annexes-panel.ts, Phase 9) — toutes sans callback, aucune
 * PreviewView n'existe forcément ici : les modifications s'écrivent
 * immédiatement dans les feuillets Front/ProjectMeta, qu'un Aperçu ouvert
 * relira à son prochain rendu. Seul Index rejoindra cette section dans sa
 * propre phase — pas de ligne factice l'annonçant tant qu'il n'est pas
 * réellement là. */
export class EditionCompositionView extends BaseFeuilletsView {
  declare plugin: EditionCompositionPlugin;
  declare targetContainer?: HTMLElement;
  private firstPagePanel: FirstPagePanel | null = null;
  private frontMatterPanel: FrontMatterPanel | null = null;
  private contentsPanel: ContentsPanel | null = null;
  private tablesPanel: TablesPanel | null = null;
  private bibliographyPanel: BibliographyPanel | null = null;
  private annexesPanel: AnnexesPanel | null = null;
  /** Intégrée dans un onglet déjà navigable (sidebar-feuillets-view.ts,
   * barre de sous-onglets de l'espace Édition) : son propre grand en-tête
   * repliable ("Composition de l'ouvrage") devient redondant avec le
   * libellé du sous-onglet. `false` par défaut pour tout autre usage futur
   * de cette vue hors de cet onglet. */
  private embedded: boolean;

  constructor(leaf: WorkspaceLeaf, plugin: EditionCompositionPlugin, opts: { embedded?: boolean } = {}) {
    super(leaf, plugin);
    this.embedded = !!opts.embedded;
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
    if (!this.embedded) {
      const collapsed = this.renderSectionHead(
        section,
        "book-open",
        t("editionComposition.displayText"),
        "editionComposition",
        "panel"
      );
      if (collapsed) {
        this.firstPagePanel = null;
        this.frontMatterPanel = null;
        this.contentsPanel = null;
        this.tablesPanel = null;
        this.bibliographyPanel = null;
        this.annexesPanel = null;
        return;
      }
    }

    section.createDiv({ cls: "feuillets-edition-group-label", text: "Contenu" });
    this.renderManuscriptContentRow(section);

    const firstPageEl = section.createDiv();
    this.firstPagePanel = new FirstPagePanel(this.app, this.plugin, firstPageEl);
    await this.firstPagePanel.render();

    const frontMatterEl = section.createDiv();
    this.frontMatterPanel = new FrontMatterPanel(this.app, this.plugin, frontMatterEl);
    await this.frontMatterPanel.render();

    section.createDiv({ cls: "feuillets-edition-group-label", text: "Éléments générés" });

    const contentsEl = section.createDiv();
    this.contentsPanel = new ContentsPanel(this.app, this.plugin, contentsEl);
    await this.contentsPanel.render();

    const tablesEl = section.createDiv();
    this.tablesPanel = new TablesPanel(this.app, this.plugin, tablesEl);
    await this.tablesPanel.render();

    section.createDiv({ cls: "feuillets-edition-group-label", text: "Fin d’ouvrage" });

    const bibliographyEl = section.createDiv();
    this.bibliographyPanel = new BibliographyPanel(this.app, this.plugin, bibliographyEl);
    await this.bibliographyPanel.render();

    const annexesEl = section.createDiv();
    this.annexesPanel = new AnnexesPanel(this.app, this.plugin, annexesEl);
    await this.annexesPanel.render();
  }

  private renderManuscriptContentRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: "feuillets-project-row feuillets-edition-action-row" });
    row.createSpan({ cls: "feuillets-project-row-label", text: "Contenu du manuscrit" });
    const root = this.plugin.getProjectFolder();
    const files = manuscriptBodyFiles(this.app, this.plugin.settings, root);
    const included = files.filter((file) => this.plugin.fmOf(file).compile !== false).length;
    row.createSpan({ cls: "feuillets-edition-count", text: `${included}/${files.length}` });
    const actions = row.createDiv({ cls: "feuillets-project-row-actions" });
    const button = actions.createEl("button", { cls: "clickable-icon" });
    setIcon(button, "chevron-right");
    button.setAttribute("aria-label", "Contenu du manuscrit");
    button.addEventListener("click", () => {
      new CompileSelectionModal(this.app, this.plugin).open();
    });
  }
}
