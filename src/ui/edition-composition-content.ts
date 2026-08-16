import { setIcon, type App, type TFile, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import { FirstPagePanel, type FirstPagePanelPlugin } from "./first-page-panel.js";
import { FrontMatterPanel, type FrontMatterPanelPlugin } from "./front-matter-panel.js";
import { ContentsPanel, type ContentsPanelPlugin } from "./contents-panel.js";
import { TablesPanel, type TablesPanelPlugin } from "./tables-panel.js";
import { BibliographyPanel, type BibliographyPanelPlugin } from "./bibliography-panel.js";
import { AnnexesPanel, type AnnexesPanelPlugin } from "./annexes-panel.js";
import { LayoutEditor, type LayoutEditorPlugin } from "./layout-editor.js";
import { CompileSelectionModal, manuscriptBodyFiles } from "./selection-modals.js";
import type { DefaultSettings } from "../default-settings.js";

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
 * disparaissent en tant que rubriques séparées. */
type CompositionSection = "summary" | "firstPage" | "frontMatter" | "structure";

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
  private selectedSection: CompositionSection = "summary";
  private bodyEl: HTMLElement | null = null;
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

    if (this.selectedSection !== "summary") {
      this.renderSubpageHeader(body, this.subpageTitle(this.selectedSection));
    }

    if (this.selectedSection === "summary") return this.renderSummary(body);
    if (this.selectedSection === "firstPage") return this.renderFirstPageSubpage(body);
    if (this.selectedSection === "frontMatter") return this.renderFrontMatterSubpage(body);
    if (this.selectedSection === "structure") return this.renderStructureSubpage(body);
  }

  private subpageTitle(section: CompositionSection): string {
    if (section === "firstPage") return t("preview.export.firstPage");
    if (section === "frontMatter") return t("frontMatter.sectionTitle");
    if (section === "structure") return t("compositionSummary.structureRow");
    return "";
  }

  /** En-tête de sous-page — même principe que le panneau Projet : retour
   * (‹) vers le sommaire + titre de la sous-page, jamais de nav permanente
   * à côté. */
  private renderSubpageHeader(parent: HTMLElement, title: string): void {
    const header = parent.createDiv({ cls: "feuillets-composition-subpage-header" });
    const back = header.createEl("button", { cls: "feuillets-composition-back" });
    setIcon(back, "chevron-left");
    back.createSpan({ text: t("compositionSummary.backToComposition") });
    back.setAttribute("aria-label", t("compositionSummary.backToComposition"));
    back.addEventListener("click", () => void this.navigateTo("summary"));
    header.createDiv({ cls: "feuillets-composition-subpage-title", text: title });
  }

  private async navigateTo(section: CompositionSection): Promise<void> {
    this.selectedSection = section;
    this.renderPromise = this.renderBody();
    await this.renderPromise;
  }

  /* ============================ Sommaire ================================ */

  private async renderSummary(body: HTMLElement): Promise<void> {
    this.groupLabel(body, t("compositionSummary.groupManuscript"));
    this.renderManuscriptContentRow(body);
    this.renderSummaryRow(body, t("preview.export.firstPage"), this.firstPageStatusLabel(), () => void this.navigateTo("firstPage"));
    this.renderSummaryRow(body, t("frontMatter.sectionTitle"), null, () => void this.navigateTo("frontMatter"));

    this.groupLabel(body, t("compositionSummary.groupGenerated"));
    const contentsEl = body.createDiv();
    this.contentsPanel = new ContentsPanel(this.app, this.plugin, contentsEl, this.panelCallbacks());
    await this.contentsPanel.render();
    const tablesEl = body.createDiv();
    this.tablesPanel = new TablesPanel(this.app, this.plugin, tablesEl, this.panelCallbacks());
    await this.tablesPanel.render();

    this.groupLabel(body, t("compositionSummary.groupBackMatter"));
    const bibliographyEl = body.createDiv();
    this.bibliographyPanel = new BibliographyPanel(this.app, this.plugin, bibliographyEl, this.panelCallbacks());
    await this.bibliographyPanel.render();
    const annexesEl = body.createDiv();
    this.annexesPanel = new AnnexesPanel(this.app, this.plugin, annexesEl, this.panelCallbacks());
    await this.annexesPanel.render();

    this.groupLabel(body, t("compositionSummary.groupStructure"));
    this.renderSummaryRow(body, t("compositionSummary.structureRow"), null, () => void this.navigateTo("structure"));
  }

  /** Statut affiché sur la ligne-résumé "Première page" — recalculé via un
   * FirstPagePanel jetable (`statusLabel()` ne touche jamais le conteneur,
   * aucun DOM n'est donc requis ni monté ici) : même logique que la
   * sous-page, aucune duplication. */
  private firstPageStatusLabel(): string {
    return new FirstPagePanel(this.app, this.plugin, null as unknown as HTMLElement, this.panelCallbacks()).statusLabel();
  }

  /** Ligne-résumé compacte ouvrant une sous-page — même grammaire que
   * "Contenu du manuscrit" (`feuillets-project-row`/chevron), jamais
   * d'accordéon ouvert au milieu du sommaire. */
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
