import { Notice, setIcon, type App, type TFile, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import { FirstPagePanel, type FirstPagePanelPlugin } from "./first-page-panel.js";
import { FrontMatterPanel, type FrontMatterPanelPlugin } from "./front-matter-panel.js";
import { ContentsPanel, type ContentsPanelPlugin } from "./contents-panel.js";
import { TablesPanel, type TablesPanelPlugin } from "./tables-panel.js";
import { BibliographyPanel, type BibliographyPanelPlugin } from "./bibliography-panel.js";
import { AnnexesPanel, type AnnexesPanelPlugin } from "./annexes-panel.js";
import { LayoutEditor, type LayoutEditorPlugin } from "./layout-editor.js";
import { CompileSelectionModal, manuscriptBodyFiles } from "./selection-modals.js";
import { ConfirmModal } from "./basic-modals.js";
import { ContentVariantModal, contentVariantErrorNoticeKey } from "./content-variant-modal.js";
import { ContentExtractionModal, contentExtractionErrorNoticeKey } from "./content-extraction-modal.js";
import { ContentCollectionModal, contentCollectionErrorNoticeKey } from "./content-collection-modal.js";
import {
  ContentVariantsFileCorruptedError,
  createContentVariant,
  deleteContentVariant,
  loadContentVariants,
  selectContentVariant,
  updateContentVariant,
  type ContentVariant,
  type ContentVariantsStore,
} from "../services/content-variants.js";
import {
  ContentExtractionsFileCorruptedError,
  createContentExtraction,
  deleteContentExtraction,
  loadContentExtractions,
  updateContentExtraction,
  type ContentExtraction,
} from "../services/content-extractions.js";
import {
  ContentCollectionsFileCorruptedError,
  createContentCollection,
  deleteContentCollection,
  loadContentCollections,
  updateContentCollection,
  type ContentCollection,
} from "../services/content-collections.js";
import type { DefaultSettings } from "../default-settings.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";

/* Même intersection que FeuilletsSettingTab (settings/feuillets-setting-tab.ts) :
   `FeuilletsSettings` n'expose qu'une partie des clés, DEFAULT_SETTINGS reste la
   référence exhaustive — les réglages déplacés ici (§20) lisent et écrivent
   EXACTEMENT les mêmes propriétés qu'avant, sur le même objet. */
type CompositionSettings = FeuilletsSettings & DefaultSettings;

/** Dernier lot UX avant 2.5, §3 : plus de navigation permanente à quatre
 * colonnes (Contenu/Structure/Notes/Informations) — Composition devient une
 * page-sommaire unique et compacte, avec des SOUS-PAGES pour les entrées qui
 * réclament plusieurs contrôles (même principe que le panneau Projet :
 * sommaire compact → sous-page → retour). "Notes" (une seule case à cocher)
 * et "Informations" (doublon de Première page/métadonnées projet, §4)
 * disparaissent en tant que rubriques séparées.
 * Passe ergonomique finale : trois groupes (AVANT, MANUSCRIT, APRÈS) avec
 * sous-pages respectant l'ordre de compilation réel. */
type CompositionSection = "summary" | "before" | "manuscript" | "variants" | "extractions" | "collections" | "after" | "firstPage" | "frontMatter" | "structure";

export type EditionCompositionContentPlugin = FirstPagePanelPlugin
  & FrontMatterPanelPlugin
  & ContentsPanelPlugin
  & TablesPanelPlugin
  & BibliographyPanelPlugin
  & AnnexesPanelPlugin
  & LayoutEditorPlugin
  & {
    /* Volontairement `FeuilletsSettings`, PAS `CompositionSettings` : ce
       type est intersecté dans BoardViewPlugin (board-view.ts), et une
       narrower `settings` ici rétrécirait `boardMode`/`progressFilter`/etc.
       pour TOUT le Tableau. Les accesseurs internes castent ponctuellement
       `as CompositionSettings` (voir plus bas), exactement comme faisait
       l'ancienne EditionCompositionView. */
    settings: FeuilletsSettings;
    getProjectFolder(): TFolder | null;
    saveSettings(): Promise<void>;
    unitLabel(): string;
    unitLabelPlural(): string;
    /** Rafraîchit UNIQUEMENT le Binder — jamais la surface Composition
     * elle-même (§9 : bug de perte de focus dans Structure, voir main.ts). */
    refreshBinderViews(): void;
    fmOf(file: TFile): { compile?: boolean };
    shortTitleFor(file: TFile): string;
    renderAllViews(force: boolean): void;
  };

export type EditionCompositionContentOptions = {
  /** Notifié après chaque sauvegarde réussie de l'un des panneaux montés
   * (Première page, Pages liminaires, Sommaire/Table des matières, Tables,
   * Bibliographie, Annexes) — transmis tel quel au `onPresentationChanged`
   * de chacun (même contrat qu'ExportPanel). Permet à l'espace central
   * Édition de rafraîchir le Preview lié sans dupliquer la logique de
   * sauvegarde de chaque panneau. */
  onChange?: () => void | Promise<void>;
  /** Sidebar embedded uniquement — notifié à chaque changement de section :
   * `isRoot` ne vaut true que sur le sommaire principal ("summary"). Le
   * parent (SidebarFeuilletsView) ne retient QUE cette racine pour décider
   * d'afficher ou non son « Retour à Édition » : aucun état partagé, aucune
   * donnée, aucun déclenchement de leaf. */
  onNavigationRootChange?: (isRoot: boolean) => void;
};

/** Sous-section "Composition de l'ouvrage" de l'espace central Édition —
 * micro-correctif « ne plus embarquer d'ItemView dans BoardView » : composant
 * DOM PUR, sans View ni ItemView ni WorkspaceLeaf, monté directement dans la
 * surface centrale d'EditionWorkspaceContent (elle-même déjà montée dans la
 * leaf du Tableau). Réutilise exactement les panneaux déjà partagés :
 * FirstPagePanel, FrontMatterPanel, ContentsPanel, TablesPanel,
 * BibliographyPanel, AnnexesPanel, et — pour la présentation de la première
 * page — LayoutEditor.renderStandaloneFirstPage() (même gabarit
 * ExportTemplateV2, même TitlePageMiniature que Mise en page) : aucun
 * nouveau moteur, aucune seconde source de vérité, seul l'emplacement du
 * code (et sa présentation en sommaire + sous-pages) change. */
export class EditionCompositionContent {
  private firstPagePanel: FirstPagePanel | null = null;
  private frontMatterPanel: FrontMatterPanel | null = null;
  private contentsPanel: ContentsPanel | null = null;
  private tablesPanel: TablesPanel | null = null;
  private bibliographyPanel: BibliographyPanel | null = null;
  private annexesPanel: AnnexesPanel | null = null;
  private layoutEditor: LayoutEditor | null = null;
  private onChangeOpt: (() => void | Promise<void>) | undefined;
  private onNavigationRootChangeOpt: ((isRoot: boolean) => void) | undefined;
  private selectedSection: CompositionSection = "summary";
  private bodyEl: HTMLElement | null = null;
  private contentListEl: HTMLElement | null = null;
  /** Rendu de la sous-page/sommaire courant en cours — exposé pour que les
   * tests puissent l'attendre après un `navigateTo()` fire-and-forget (comme
   * un clic réel sur une ligne-résumé), même contrat que
   * EditionWorkspaceContent.modeRenderPromise. Aucun rôle fonctionnel :
   * jamais lu par le reste du plugin. */
  renderPromise: Promise<void> = Promise.resolve();

  constructor(
    private app: App,
    private plugin: EditionCompositionContentPlugin,
    private container: HTMLElement,
    opts: EditionCompositionContentOptions = {},
  ) {
    this.onChangeOpt = opts.onChange;
    this.onNavigationRootChangeOpt = opts.onNavigationRootChange;
  }

  /** Réattache le composant à un nouveau conteneur — l'hôte reconstruit son
   * DOM à chaque rendu, l'instance et la sous-page courante survivent. */
  attach(container: HTMLElement): void {
    this.container = container;
  }

  async render(): Promise<void> {
    const container = this.container;
    container.empty();
    container.addClass("feuillets-edition-composition-container");
    this.bodyEl = container.createDiv({ cls: "feuillets-composition-body" });
    await this.renderBody();
  }

  /** Reconstruit UNIQUEMENT le corps (sommaire ou sous-page) — jamais tout
   * `render()` : conserve la classe/le conteneur posés une fois par
   * render(), pour que les rafraîchissements internes (navigation entre
   * sommaire et sous-page, sauvegarde d'un champ) ne fassent jamais
   * reconstruire l'hôte (EditionWorkspaceContent) qui, lui, ne reconstruit
   * ce composant qu'au changement d'onglet Édition. */
  private async renderBody(): Promise<void> {
    const body = this.bodyEl;
    if (!body) return;
    body.empty();
    this.contentListEl = null;

    if (this.selectedSection !== "summary") {
      this.renderSubpageHeader(body, this.subpageTitle(this.selectedSection));
    }

    const renderPromise =
      this.selectedSection === "summary" ? this.renderSummary(body)
      : this.selectedSection === "before" ? this.renderBeforeSubpage(body)
      : this.selectedSection === "manuscript" ? this.renderManuscriptSubpage(body)
      : this.selectedSection === "variants" ? this.renderVariantsSubpage(body)
      : this.selectedSection === "extractions" ? this.renderExtractionsSubpage(body)
      : this.selectedSection === "collections" ? this.renderCollectionsSubpage(body)
      : this.selectedSection === "after" ? this.renderAfterSubpage(body)
      : this.selectedSection === "firstPage" ? this.renderFirstPageSubpage(body)
      : this.selectedSection === "frontMatter" ? this.renderFrontMatterSubpage(body)
      : this.renderStructureSubpage(body);

    /* Le parent (sidebar embedded) ne veut savoir QUE si le composant est
       sur sa page racine (sommaire) — « Retour à Édition » n'est rendu que
       dans ce cas seul (voir SidebarFeuilletsView). */
    if (this.onNavigationRootChangeOpt) this.onNavigationRootChangeOpt(this.selectedSection === "summary");

    return renderPromise;
  }

  private subpageTitle(section: CompositionSection): string {
    if (section === "before") return t("compositionSummary.beforeManuscript");
    if (section === "manuscript") return t("compositionSummary.theManuscript");
    if (section === "variants") return t("contentVariants.title");
    if (section === "extractions") return t("contentExtractions.title");
    if (section === "collections") return t("contentCollections.title");
    if (section === "after") return t("compositionSummary.afterManuscript");
    if (section === "firstPage") return t("preview.export.firstPage");
    if (section === "frontMatter") return t("frontMatter.sectionTitle");
    if (section === "structure") return t("compositionSummary.structureRow");
    return "";
  }

  private parentSection(section: CompositionSection): CompositionSection {
    if (section === "firstPage" || section === "frontMatter") return "before";
    if (section === "variants") return "manuscript";
    if (section === "extractions") return "manuscript";
    if (section === "collections") return "manuscript";
    if (section === "structure") return "manuscript";
    return "summary";
  }

  /** En-tête de sous-page — GRAMMAIRE « PAGE DE NAVIGATION » (micro-correctif
   * visuel) : le Retour (‹, vers la page parente) et le titre de la sous-page
   * sont DEUX LIGNES VERTICALES distinctes sous eux (.feuillets-composition-
   * subpage-header est une colonne) — jamais retour + titre dans le même
   * flex-row, jamais de nav permanente à côté. */
  private renderSubpageHeader(parent: HTMLElement, title: string): void {
    const header = parent.createDiv({ cls: "feuillets-composition-subpage-header" });
    const back = header.createEl("button", { cls: "feuillets-composition-back" });
    setIcon(back, "chevron-left");
    const parent_section = this.parentSection(this.selectedSection);
    const backText = parent_section === "summary" ? t("compositionSummary.backToComposition")
                   : parent_section === "before" ? t("compositionSummary.backToBefore")
                   : parent_section === "manuscript" ? t("compositionSummary.backToManuscript")
                   : t("compositionSummary.backToComposition");
    back.createSpan({ text: backText });
    back.setAttribute("aria-label", backText);
    back.addEventListener("click", () => void this.navigateTo(parent_section));
    header.createDiv({ cls: "feuillets-composition-subpage-title", text: title });
  }

  private async navigateTo(section: CompositionSection): Promise<void> {
    this.selectedSection = section;
    this.renderPromise = this.renderBody();
    await this.renderPromise;
  }

  /* ============================ Sommaire ================================ */

  private async renderSummary(body: HTMLElement): Promise<void> {
    this.renderSummaryRow(body, t("compositionSummary.beforeManuscript"), null, () => void this.navigateTo("before"));
    this.renderSummaryRow(body, t("compositionSummary.theManuscript"), null, () => void this.navigateTo("manuscript"));
    this.renderSummaryRow(body, t("compositionSummary.afterManuscript"), null, () => void this.navigateTo("after"));
  }

  /** Statut affiché sur la ligne-résumé "Première page" — recalculé via un
   * FirstPagePanel jetable (`statusLabel()` ne touche jamais le conteneur,
   * aucun DOM n'est donc requis ni monté ici) : même logique que la
   * sous-page, aucune duplication. */
  private firstPageStatusLabel(): string {
    return new FirstPagePanel(this.app, this.plugin, null as unknown as HTMLElement, this.panelCallbacks()).statusLabel();
  }

  /** Ligne-résumé compacte ouvrant une sous-page — GRAMMAIRE « PAGE DE
   * NAVIGATION » : LABEL | STATUS OPTIONNEL | CHEVRON sur UNE SEULE LIGNE
   * (`.feuillets-project-row` est un flex aligné au centre, statut et chevron
   * sont des frères du label — jamais une valeur renvoyée à la ligne) — même
   * grammaire que "Contenu du manuscrit" (`feuillets-project-row`/chevron),
   * jamais d'accordéon ouvert au milieu du sommaire. */
  private renderSummaryRow(parent: HTMLElement, label: string, status: string | null, onActivate: () => void): void {
    const row = parent.createDiv({ cls: "feuillets-project-row feuillets-edition-action-row" });
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.createSpan({ cls: "feuillets-project-row-label", text: label });
    const actions = row.createDiv({ cls: "feuillets-project-row-actions" });
    if (status) actions.createSpan({ cls: "feuillets-edition-count", text: status });
    const chevron = actions.createEl("button", { cls: "clickable-icon" });
    setIcon(chevron, "chevron-right");
    chevron.setAttribute("aria-label", label);
    row.addEventListener("click", onActivate);
    row.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(); }
    });
    chevron.addEventListener("click", (event) => { event.stopPropagation(); onActivate(); });
  }

  private renderManuscriptContentRow(parent: HTMLElement): void {
    const label = t("compositionSummary.manuscriptContent");
    const root = this.plugin.getProjectFolder();
    const files = manuscriptBodyFiles(this.app, this.plugin.settings, root);
    const included = files.filter((file) => this.plugin.fmOf(file).compile !== false).length;
    this.renderSummaryRow(parent, label, `${included}/${files.length}`, () => {
      new CompileSelectionModal(this.app, this.plugin).open();
    });
  }

  /* ============================ Sous-pages =============================== */

  /** Composition → Avant le manuscrit : quatre entrées. Première page et Pages
   * liminaires ouvrent des sous-pages ; Sommaire et Tables affichent leurs
   * panneaux existants directement. */
  private async renderBeforeSubpage(body: HTMLElement): Promise<void> {
    this.renderSummaryRow(body, t("preview.export.firstPage"), this.firstPageStatusLabel(), () => void this.navigateTo("firstPage"));
    this.renderSummaryRow(body, t("frontMatter.sectionTitle"), null, () => void this.navigateTo("frontMatter"));

    const contentsEl = body.createDiv();
    this.contentsPanel = new ContentsPanel(this.app, this.plugin, contentsEl, this.panelCallbacks());
    await this.contentsPanel.renderSummary();

    const tablesEl = body.createDiv();
    this.tablesPanel = new TablesPanel(this.app, this.plugin, tablesEl, this.panelCallbacks());
    await this.tablesPanel.render();
  }

  /** Composition → Le manuscrit : quatre entrées dans l'ordre du pipeline. */
  private async renderManuscriptSubpage(body: HTMLElement): Promise<void> {
    this.renderManuscriptContentRow(body);
    let status: string | null = null;
    try {
      const store = await loadContentVariants(this.app, this.plugin.settings);
      const selected = store.variants.find((variant) => variant.id === store.selectedVariantId);
      status = selected?.name || null;
    } catch (error) {
      if (!(error instanceof ContentVariantsFileCorruptedError)) throw error;
      status = t("contentVariants.errorStatus");
    }
    this.renderSummaryRow(body, t("contentVariants.title"), status, () => void this.navigateTo("variants"));
    this.renderSummaryRow(body, t("contentExtractions.title"), null, () => void this.navigateTo("extractions"));
    this.renderSummaryRow(body, t("contentCollections.title"), null, () => void this.navigateTo("collections"));
    this.renderSummaryRow(body, t("compositionSummary.structureRow"), null, () => void this.navigateTo("structure"));
  }

  private async renderVariantsSubpage(body: HTMLElement): Promise<void> {
    body.createDiv({ cls: "feuillets-notes-sub feuillets-content-variants-hint", text: t("contentVariants.optionalHint") });
    const store = await loadContentVariants(this.app, this.plugin.settings).catch((error: unknown) => {
      if (!(error instanceof ContentVariantsFileCorruptedError)) throw error;
      return null;
    });
    if (!store) {
      body.createDiv({ cls: "feuillets-content-variants-error", text: t("contentVariants.invalidFile") });
      return;
    }
    if (store.variants.length > 0) {
      const row = body.createDiv({ cls: "feuillets-properties-row feuillets-edition-row feuillets-content-selection-control" });
      row.createSpan({ cls: "feuillets-properties-key", text: t("contentVariants.use") });
      const select = row.createEl("select");
      select.createEl("option", { value: "", text: t("contentVariants.none") });
      for (const variant of store.variants) select.createEl("option", { value: variant.id, text: variant.name });
      select.value = store.selectedVariantId || "";
      select.setAttribute("aria-label", t("contentVariants.use"));
      select.addEventListener("change", () => {
        this.renderPromise = this.changeSelectedVariant(select.value || null);
      });
    }
    this.contentListEl = body.createDiv({ cls: "feuillets-content-entry-list" });
    this.renderVariantList(this.contentListEl, store);
    const add = body.createEl("button", { text: t("contentVariants.newVariant"), cls: "feuillets-content-variant-add" });
    add.addEventListener("click", () => this.openVariantModal(null));
  }

  private async renderExtractionsSubpage(body: HTMLElement): Promise<void> {
    body.createDiv({ cls: "feuillets-notes-sub feuillets-content-extractions-hint", text: t("contentExtractions.optionalHint") });
    this.contentListEl = body.createDiv({ cls: "feuillets-content-entry-list" });
    await this.renderExtractionList(this.contentListEl);
    const add = body.createEl("button", { text: t("contentExtractions.newExtraction"), cls: "feuillets-content-extraction-add" });
    add.addEventListener("click", () => this.openExtractionModal(null));
  }

  private async renderCollectionsSubpage(body: HTMLElement): Promise<void> {
    body.createDiv({ cls: "feuillets-notes-sub feuillets-content-collections-hint", text: t("contentCollections.optionalHint") });
    this.contentListEl = body.createDiv({ cls: "feuillets-content-entry-list" });
    await this.renderCollectionList(this.contentListEl);
    const add = body.createEl("button", { text: t("contentCollections.newCollection"), cls: "feuillets-content-collection-add" });
    add.addEventListener("click", () => this.openCollectionModal(null));
  }

  private renderContentEmptyState(parent: HTMLElement, text: string, cls = "feuillets-content-empty"): void {
    const empty = parent.createDiv({ cls: `feuillets-content-empty-state ${cls}` });
    empty.createDiv({ cls: "feuillets-content-empty-title", text });
    empty.createDiv({ cls: "feuillets-content-empty-description", text: t("contentDerivation.emptyDescription") });
  }

  private roleSummary(roles: SemanticRole[]): string {
    const labels = roles.map((role) => t(`contentVariants.roles.${role}`));
    if (labels.length <= 3) return labels.join(", ") || t("contentDerivation.noRoles");
    return t("contentDerivation.rolesCount", { count: String(labels.length) });
  }

  private roleNamesSummary(roles: SemanticRole[]): string {
    const labels = roles.map((role) => t(`contentVariants.roles.${role}`));
    if (labels.length <= 3) return labels.join(" · ") || t("contentDerivation.noRoles");
    return `${labels.slice(0, 3).join(" · ")} · +${labels.length - 3}`;
  }

  private renderVariantList(parent: HTMLElement, store: ContentVariantsStore): void {
    parent.empty();
    if (store.variants.length === 0) {
      this.renderContentEmptyState(parent, t("contentVariants.empty"), "feuillets-content-variants-empty");
      return;
    }
    for (const variant of store.variants) this.renderVariantRow(parent, variant, store.selectedVariantId);
  }

  private async renderExtractionList(parent: HTMLElement): Promise<void> {
    parent.empty();
    try {
      const store = await loadContentExtractions(this.app, this.plugin.settings);
      if (store.extractions.length === 0) this.renderContentEmptyState(parent, t("contentExtractions.empty"), "feuillets-content-extractions-empty");
      for (const extraction of store.extractions) this.renderExtractionRow(parent, extraction);
    } catch (error) {
      if (!(error instanceof ContentExtractionsFileCorruptedError)) throw error;
      parent.createDiv({ cls: "feuillets-content-extractions-error", text: t("contentExtractions.invalidFile") });
    }
  }

  private async renderCollectionList(parent: HTMLElement): Promise<void> {
    parent.empty();
    try {
      const store = await loadContentCollections(this.app, this.plugin.settings);
      if (store.collections.length === 0) this.renderContentEmptyState(parent, t("contentCollections.empty"), "feuillets-content-collections-empty");
      for (const collection of store.collections) this.renderCollectionRow(parent, collection);
    } catch (error) {
      if (!(error instanceof ContentCollectionsFileCorruptedError)) throw error;
      parent.createDiv({ cls: "feuillets-content-collections-error", text: t("contentCollections.invalidFile") });
    }
  }

  private renderCollectionRow(parent: HTMLElement, collection: ContentCollection): void {
    const row = parent.createDiv({ cls: "feuillets-content-item" });
    const content = row.createDiv({ cls: "feuillets-content-entry-main" });
    const name = content.createDiv({ cls: "feuillets-content-item-name", text: collection.name });
    name.setAttribute("title", collection.name);
    content.createDiv({ cls: "feuillets-content-item-summary", text: this.roleNamesSummary(collection.roles) });
    const actions = row.createDiv({ cls: "feuillets-content-item-actions" });
    const edit = actions.createEl("button", { text: t("contentCollections.edit") });
    edit.addEventListener("click", (event) => { event.stopPropagation(); this.openCollectionModal(collection); });
    const remove = actions.createEl("button", { text: t("contentCollections.delete") });
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      new ConfirmModal(this.app, t("contentCollections.deleteTitle"), t("contentCollections.deleteMessage", { name: collection.name }), t("contentCollections.delete"),
        () => this.removeCollection(collection.id)).open();
    });
  }

  private openCollectionModal(collection: ContentCollection | null): void {
    new ContentCollectionModal(this.app, collection, async (draft) => {
      if (collection) await updateContentCollection(this.app, this.plugin.settings, collection.id, draft);
      else await createContentCollection(this.app, this.plugin.settings, draft.name, draft.roles);
      await this.refreshCurrentSection();
      await this.onChangeOpt?.();
    }).open();
  }

  private async removeCollection(id: string): Promise<void> {
    try {
      await deleteContentCollection(this.app, this.plugin.settings, id);
      await this.refreshCurrentSection();
      await this.onChangeOpt?.();
    } catch (error) {
      new Notice(t(contentCollectionErrorNoticeKey(error)));
    }
  }

  private renderExtractionRow(parent: HTMLElement, extraction: ContentExtraction): void {
    const row = parent.createDiv({ cls: "feuillets-content-item" });
    const content = row.createDiv({ cls: "feuillets-content-entry-main" });
    const name = content.createDiv({ cls: "feuillets-content-item-name", text: extraction.name });
    name.setAttribute("title", extraction.name);
    content.createDiv({ cls: "feuillets-content-item-summary", text: this.roleNamesSummary(extraction.triggerRoles) });
    const actions = row.createDiv({ cls: "feuillets-content-item-actions" });
    const edit = actions.createEl("button", { text: t("contentExtractions.edit") });
    edit.addEventListener("click", (event) => { event.stopPropagation(); this.openExtractionModal(extraction); });
    const remove = actions.createEl("button", { text: t("contentExtractions.delete") });
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      new ConfirmModal(this.app, t("contentExtractions.deleteTitle"), t("contentExtractions.deleteMessage", { name: extraction.name }), t("contentExtractions.delete"),
        () => this.removeExtraction(extraction.id)).open();
    });
  }

  private openExtractionModal(extraction: ContentExtraction | null): void {
    new ContentExtractionModal(this.app, extraction, async (draft) => {
      if (extraction) await updateContentExtraction(this.app, this.plugin.settings, extraction.id, draft);
      else await createContentExtraction(this.app, this.plugin.settings, draft.name, draft.triggerRoles);
      await this.refreshCurrentSection();
      await this.onChangeOpt?.();
    }).open();
  }

  private async removeExtraction(id: string): Promise<void> {
    try {
      await deleteContentExtraction(this.app, this.plugin.settings, id);
      await this.refreshCurrentSection();
      await this.onChangeOpt?.();
    } catch (error) {
      new Notice(t(contentExtractionErrorNoticeKey(error)));
    }
  }

  private renderVariantRow(parent: HTMLElement, variant: ContentVariant, selectedVariantId: string | null): void {
    const isSelected = variant.id === selectedVariantId;
    const row = parent.createDiv({ cls: `feuillets-content-item${isSelected ? " feuillets-content-item-selected" : ""}` });
    row.setAttribute("data-content-entry-id", variant.id);
    const content = row.createDiv({ cls: "feuillets-content-entry-main" });
    const name = content.createDiv({ cls: "feuillets-content-item-name", text: variant.name });
    name.setAttribute("title", variant.name);
    const includedRoles = SEMANTIC_ROLES.filter((role) => !variant.excludedRoles.includes(role));
    content.createDiv({ cls: "feuillets-content-item-summary", text: this.roleSummary(includedRoles) });
    if (isSelected) row.createSpan({ cls: "feuillets-content-entry-state", text: t("contentVariants.selected") });
    const actions = row.createDiv({ cls: "feuillets-content-item-actions" });
    const edit = actions.createEl("button", { text: t("contentVariants.edit") });
    edit.addEventListener("click", (event) => { event.stopPropagation(); this.openVariantModal(variant); });
    const remove = actions.createEl("button", { text: t("contentVariants.delete") });
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      new ConfirmModal(this.app, t("contentVariants.deleteTitle"), t("contentVariants.deleteMessage", { name: variant.name }), t("contentVariants.delete"),
        () => this.removeVariant(variant.id)).open();
    });
  }

  private openVariantModal(variant: ContentVariant | null): void {
    new ContentVariantModal(this.app, variant, async (draft) => {
      if (variant) await updateContentVariant(this.app, this.plugin.settings, variant.id, draft);
      else await createContentVariant(this.app, this.plugin.settings, draft.name, draft.excludedRoles, draft.questionAnswerSpace);
      await this.refreshCurrentSection();
      await this.onChangeOpt?.();
    }).open();
  }

  private async changeSelectedVariant(id: string | null): Promise<void> {
    try {
      await selectContentVariant(this.app, this.plugin.settings, id);
      const selectedRows = this.bodyEl?.querySelectorAll(".feuillets-content-item") || [];
      for (const row of Array.from(selectedRows)) {
        const isSelected = row.getAttribute("data-content-entry-id") === id;
        row.toggleClass("feuillets-content-item-selected", isSelected);
        const state = row.querySelector(".feuillets-content-entry-state");
        if (isSelected && !state) row.createSpan({ cls: "feuillets-content-entry-state", text: t("contentVariants.selected") });
        if (!isSelected && state) state.remove();
      }
      await this.onChangeOpt?.();
    } catch (error) {
      new Notice(t(contentVariantErrorNoticeKey(error)));
    }
  }

  private async removeVariant(id: string): Promise<void> {
    try {
      await deleteContentVariant(this.app, this.plugin.settings, id);
      await this.refreshCurrentSection();
      await this.onChangeOpt?.();
    } catch (error) {
      new Notice(t(contentVariantErrorNoticeKey(error)));
    }
  }

  private async refreshCurrentSection(): Promise<void> {
    if (this.contentListEl && this.selectedSection === "variants") {
      const store = await loadContentVariants(this.app, this.plugin.settings);
      this.renderVariantList(this.contentListEl, store);
      return;
    }
    if (this.contentListEl && this.selectedSection === "extractions") {
      await this.renderExtractionList(this.contentListEl);
      return;
    }
    if (this.contentListEl && this.selectedSection === "collections") {
      await this.renderCollectionList(this.contentListEl);
      return;
    }
    this.renderPromise = this.renderBody();
    await this.renderPromise;
  }

  /** Composition → Après le manuscrit : Table des matières, Bibliographie,
   * Annexes. Affiche les trois éléments directement sans sous-pages. */
  private async renderAfterSubpage(body: HTMLElement): Promise<void> {
    const contentsEl = body.createDiv();
    this.contentsPanel = new ContentsPanel(this.app, this.plugin, contentsEl, this.panelCallbacks());
    await this.contentsPanel.renderTableOfContents();

    const bibliographyEl = body.createDiv();
    this.bibliographyPanel = new BibliographyPanel(this.app, this.plugin, bibliographyEl, this.panelCallbacks());
    await this.bibliographyPanel.render();

    const annexesEl = body.createDiv();
    this.annexesPanel = new AnnexesPanel(this.app, this.plugin, annexesEl, this.panelCallbacks());
    await this.annexesPanel.render();
  }

  /** Composition → Première page (§6) : CONTENU (FirstPagePanel, inchangé)
   * puis PRÉSENTATION (LayoutEditor.renderStandaloneFirstPage — même
   * gabarit ExportTemplateV2, même TitlePageMiniature que Mise en page).
   * Seule et unique entrée « Première page » de tout Édition (§6). */
  private async renderFirstPageSubpage(body: HTMLElement): Promise<void> {
    this.groupLabel(body, t("compositionSummary.firstPageContentGroup"));
    const contentHost = body.createDiv();
    this.firstPagePanel = new FirstPagePanel(this.app, this.plugin, contentHost, this.panelCallbacks());
    await this.firstPagePanel.renderExpandedFields(contentHost);

    this.groupLabel(body, t("compositionSummary.firstPagePresentationGroup"));
    /* Même classe que l'inspecteur de Mise en page (`feuillets-layout-inspector`)
       — mêmes contrôles ExportTemplateV2, même grammaire visuelle, jamais un
       second style ad hoc pour la même famille de champs. */
    const presentationHost = body.createDiv({ cls: "feuillets-layout-inspector" });
    const S = this.plugin.settings as CompositionSettings;
    this.layoutEditor = new LayoutEditor(this.app, this.plugin, null, S.exportTemplate, {
      mode: "workspace",
      onChange: () => void this.onChangeOpt?.(),
    });
    await this.layoutEditor.renderStandaloneFirstPage(presentationHost);
  }

  /** Composition → Pages liminaires (§6) : réutilise FrontMatterPanel tel
   * quel, sans sa propre ligne-résumé (déjà fournie par le sommaire). */
  private async renderFrontMatterSubpage(body: HTMLElement): Promise<void> {
    const host = body.createDiv();
    this.frontMatterPanel = new FrontMatterPanel(this.app, this.plugin, host, this.panelCallbacks());
    await this.frontMatterPanel.renderExpandedList(host);
  }

  /** Composition → Structure : mêmes réglages qu'avant (numérotation,
   * presets de compilation), plus — en bas — "Notes de bas de page" (§5 :
   * l'ancienne rubrique "Notes" ne contenait qu'une seule case, elle
   * rejoint donc Structure plutôt que de rester une rubrique à part). */
  private async renderStructureSubpage(body: HTMLElement): Promise<void> {
    this.renderStructureSection(body);
    this.renderCompilationSection(body);
    this.groupLabel(body, t("compositionSummary.footnotesGroup"));
    this.renderNotesSection(body);
  }

  /* ============ Réglages déplacés depuis les Paramètres (§20) ============ */

  private groupLabel(parent: HTMLElement, text: string): void {
    parent.createDiv({ cls: "feuillets-edition-group-label", text });
  }

  private propertyRow(parent: HTMLElement, label: string): HTMLElement {
    const row = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: label });
    return row.createDiv({ cls: "feuillets-edition-row-control" });
  }

  private selectRow(
    parent: HTMLElement,
    label: string,
    options: Array<[string, string]>,
    value: string,
    onChange: (value: string) => void | Promise<void>,
  ): void {
    const control = this.propertyRow(parent, label);
    const select = control.createEl("select");
    for (const [key, text] of options) select.createEl("option", { value: key, text });
    select.value = value;
    select.setAttribute("aria-label", label);
    select.addEventListener("change", () => void onChange(select.value));
  }

  private textRow(
    parent: HTMLElement,
    label: string,
    value: string,
    onChange: (value: string) => void | Promise<void>,
    placeholder?: string,
  ): void {
    const control = this.propertyRow(parent, label);
    const input = control.createEl("input", { type: "text" });
    input.value = value;
    if (placeholder) input.setAttribute("placeholder", placeholder);
    input.setAttribute("aria-label", label);
    input.addEventListener("change", () => void onChange(input.value));
  }

  private toggleRow(
    parent: HTMLElement,
    label: string,
    value: boolean,
    onChange: (value: boolean) => void | Promise<void>,
  ): void {
    const control = this.propertyRow(parent, label);
    const input = control.createEl("input", { type: "checkbox" });
    input.checked = value;
    input.setAttribute("aria-label", label);
    input.addEventListener("change", () => void onChange(input.checked));
  }

  private renderStructureSection(parent: HTMLElement): void {
    const S = this.plugin.settings as CompositionSettings;
    const unit = this.plugin.unitLabel();
    const unitPlural = this.plugin.unitLabelPlural();
    const save = async (): Promise<void> => { await this.plugin.saveSettings(); };
    /* §9 du dernier lot UX avant 2.5 : ce réglage change la numérotation
       affichée par le Binder — mais ne doit JAMAIS reconstruire la surface
       Composition active (perte de focus/scroll/sous-page). refreshBinderViews()
       (main.ts) rafraîchit UNIQUEMENT le Binder, jamais VIEW_BOARD : c'est
       la différence avec l'ancien `plugin.refreshView()` (→ renderAllViews()
       → reconstruction globale, y compris cette même sous-page). */
    const saveAndRefresh = async (): Promise<void> => { await save(); this.plugin.refreshBinderViews(); };

    this.selectRow(parent, t("settings.level1Role.name"), [
      ["parties", t("settings.level1Role.parts")],
      ["chapitres", t("settings.level1Role.chapters", { unitPlural })],
    ], S.level1Role, async (v) => { S.level1Role = v as DefaultSettings["level1Role"]; await saveAndRefresh(); });

    this.selectRow(parent, t("settings.chapterNumbering.name"), [
      ["continu", t("settings.chapterNumbering.continuous")],
      ["parPartie", t("settings.chapterNumbering.perPart")],
      ["aucune", t("settings.chapterNumbering.none")],
    ], S.chapterNumbering, async (v) => { S.chapterNumbering = v as DefaultSettings["chapterNumbering"]; await saveAndRefresh(); });

    this.selectRow(parent, t("settings.sceneNumbering.name", { unitPlural }), [
      ["hier", t("settings.sceneNumbering.hierarchical", { unit })],
      ["continue", t("settings.sceneNumbering.continuous")],
      ["aucune", t("settings.chapterNumbering.none")],
    ], S.sceneNumbering, async (v) => { S.sceneNumbering = v as DefaultSettings["sceneNumbering"]; await saveAndRefresh(); });

    this.toggleRow(parent, t("settings.autoRename.name"), S.autoRename,
      async (v) => { S.autoRename = v; await save(); });
    this.textRow(parent, t("settings.renamePrefix.name"), S.renamePrefix,
      async (v) => { S.renamePrefix = v.trim() || "chapitre"; await save(); });

    this.toggleRow(parent, t("settings.insertFolderTitles.name"), S.insertFolderTitles,
      async (v) => { S.insertFolderTitles = v; await save(); });
    this.toggleRow(parent, t("settings.insertTitles.name"), S.insertTitles,
      async (v) => { S.insertTitles = v; await save(); });
    this.toggleRow(parent, t("settings.insertSceneTitles.name", { unitPlural }), S.insertSceneTitles,
      async (v) => { S.insertSceneTitles = v; await save(); });
  }

  private renderNotesSection(parent: HTMLElement): void {
    const S = this.plugin.settings as CompositionSettings;
    this.toggleRow(parent, t("settings.footnoteRenumberOnCompile.name"), S.footnoteRenumberOnCompile,
      async (v) => { S.footnoteRenumberOnCompile = v; await this.plugin.saveSettings(); });
  }

  private renderCompilationSection(parent: HTMLElement): void {
    const S = this.plugin.settings as CompositionSettings;
    const unitPlural = this.plugin.unitLabelPlural();

    this.textRow(parent, t("settings.separator.name"), S.separator,
      async (v) => { S.separator = v; await this.plugin.saveSettings(); }, "—");

    this.groupLabel(parent, t("settings.compilePresets.groupLabel"));

    const presets = (S.compilePresets as PresetConfig[]) || [];
    presets.forEach((preset, index) => {
      const head = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
      head.createSpan({
        cls: "feuillets-properties-key",
        text: preset.name || t("settings.compilePresets.item", { n: String(index + 1) }),
      });
      const headActions = head.createDiv({ cls: "feuillets-edition-row-control" });
      const del = headActions.createEl("button", { cls: "clickable-icon" });
      setIcon(del, "x");
      del.setAttribute("aria-label", t("settings.compilePresets.deleteAria"));
      del.addEventListener("click", () => void this.removePreset(index));

      this.textRow(parent, t("settings.compilePresets.name"), preset.name || "",
        async (v) => { preset.name = v.trim(); await this.plugin.saveSettings(); });
      this.textRow(parent, t("settings.compilePresets.outputFile"), preset.fileName || "",
        async (v) => { preset.fileName = v.trim(); await this.plugin.saveSettings(); }, "Sortie.md");
      this.toggleRow(parent, t("settings.insertFolderTitles.name"), preset.folderTitles !== false,
        async (v) => { preset.folderTitles = v; await this.plugin.saveSettings(); });
      this.toggleRow(parent, t("settings.compilePresets.insertChapterTitles"), preset.chapterTitles !== false,
        async (v) => { preset.chapterTitles = v; await this.plugin.saveSettings(); });
      this.toggleRow(parent, t("settings.insertSceneTitles.name", { unitPlural }), preset.sceneTitles === true,
        async (v) => { preset.sceneTitles = v; await this.plugin.saveSettings(); });
    });

    const addRow = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row feuillets-edition-preset-add-row" });
    const addActions = addRow.createDiv({ cls: "feuillets-edition-row-control" });
    const add = addActions.createEl("button", { text: t("settings.compilePresets.add") });
    add.addEventListener("click", () => void this.addPreset());
  }

  private async addPreset(): Promise<void> {
    const S = this.plugin.settings as CompositionSettings;
    (S.compilePresets as PresetConfig[]).push({
      name: t("settings.compilePresets.item", { n: String(S.compilePresets.length + 1) }),
      fileName: "Sortie.md",
      folderTitles: true,
      chapterTitles: true,
      sceneTitles: false,
    } as PresetConfig);
    await this.plugin.saveSettings();
    await this.renderBody();
  }

  private async removePreset(index: number): Promise<void> {
    const S = this.plugin.settings as CompositionSettings;
    S.compilePresets.splice(index, 1);
    if (S.activePreset >= S.compilePresets.length) S.activePreset = -1;
    await this.plugin.saveSettings();
    await this.renderBody();
  }

  /** Callback commun transmis aux panneaux — voir
   * EditionCompositionContentOptions.onChange. Un seul objet recréé à chaque
   * mont (pas de coût notable, cohérent avec le reste du composant). */
  private panelCallbacks(): { onPresentationChanged: () => void | Promise<void> } {
    return { onPresentationChanged: () => this.onChangeOpt?.() };
  }
}
