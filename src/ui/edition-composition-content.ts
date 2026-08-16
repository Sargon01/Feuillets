import { setIcon, type App, type TFile, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import { FirstPagePanel, type FirstPagePanelPlugin } from "./first-page-panel.js";
import { FrontMatterPanel, type FrontMatterPanelPlugin } from "./front-matter-panel.js";
import { ContentsPanel, type ContentsPanelPlugin } from "./contents-panel.js";
import { TablesPanel, type TablesPanelPlugin } from "./tables-panel.js";
import { BibliographyPanel, type BibliographyPanelPlugin } from "./bibliography-panel.js";
import { AnnexesPanel, type AnnexesPanelPlugin } from "./annexes-panel.js";
import { CompileSelectionModal, manuscriptBodyFiles } from "./selection-modals.js";
import type { DefaultSettings } from "../default-settings.js";

/* Même intersection que FeuilletsSettingTab (settings/feuillets-setting-tab.ts) :
   `FeuilletsSettings` n'expose qu'une partie des clés, DEFAULT_SETTINGS reste la
   référence exhaustive — les réglages déplacés ici (§20) lisent et écrivent
   EXACTEMENT les mêmes propriétés qu'avant, sur le même objet. */
type CompositionSettings = FeuilletsSettings & DefaultSettings;

export type EditionCompositionContentPlugin = FirstPagePanelPlugin
  & FrontMatterPanelPlugin
  & ContentsPanelPlugin
  & TablesPanelPlugin
  & BibliographyPanelPlugin
  & AnnexesPanelPlugin
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
    refreshView(): void;
    fmOf(file: TFile): { compile?: boolean };
    shortTitleFor(file: TFile): string;
    renderAllViews(force: boolean): void;
  };

export type EditionCompositionContentOptions = {
  /** Notifié après chaque sauvegarde réussie de l'un des six panneaux
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
 * leaf du Tableau). Réutilise exactement les six panneaux déjà partagés :
 * FirstPagePanel, FrontMatterPanel, ContentsPanel, TablesPanel,
 * BibliographyPanel, AnnexesPanel — aucun nouveau moteur ni duplication de
 * logique, seul l'emplacement du code a changé. */
export class EditionCompositionContent {
  private firstPagePanel: FirstPagePanel | null = null;
  private frontMatterPanel: FrontMatterPanel | null = null;
  private contentsPanel: ContentsPanel | null = null;
  private tablesPanel: TablesPanel | null = null;
  private bibliographyPanel: BibliographyPanel | null = null;
  private annexesPanel: AnnexesPanel | null = null;
  private onChangeOpt: (() => void | Promise<void>) | undefined;

  constructor(
    private app: App,
    private plugin: EditionCompositionContentPlugin,
    private container: HTMLElement,
    opts: EditionCompositionContentOptions = {},
  ) {
    this.onChangeOpt = opts.onChange;
  }

  /** Réattache le composant à un nouveau conteneur — l'hôte reconstruit son
   * DOM à chaque rendu, l'instance survit. */
  attach(container: HTMLElement): void {
    this.container = container;
  }

  async render(): Promise<void> {
    const container = this.container;
    container.empty();
    container.addClass("feuillets-edition-composition-container");

    const section = container.createDiv({ cls: "feuillets-project-section" });

    section.createDiv({ cls: "feuillets-edition-group-label", text: "Contenu" });
    this.renderManuscriptContentRow(section);

    const firstPageEl = section.createDiv();
    this.firstPagePanel = new FirstPagePanel(this.app, this.plugin, firstPageEl, this.panelCallbacks());
    await this.firstPagePanel.render();

    const frontMatterEl = section.createDiv();
    this.frontMatterPanel = new FrontMatterPanel(this.app, this.plugin, frontMatterEl, this.panelCallbacks());
    await this.frontMatterPanel.render();

    section.createDiv({ cls: "feuillets-edition-group-label", text: "Éléments générés" });

    const contentsEl = section.createDiv();
    this.contentsPanel = new ContentsPanel(this.app, this.plugin, contentsEl, this.panelCallbacks());
    await this.contentsPanel.render();

    const tablesEl = section.createDiv();
    this.tablesPanel = new TablesPanel(this.app, this.plugin, tablesEl, this.panelCallbacks());
    await this.tablesPanel.render();

    section.createDiv({ cls: "feuillets-edition-group-label", text: "Fin d’ouvrage" });

    const bibliographyEl = section.createDiv();
    this.bibliographyPanel = new BibliographyPanel(this.app, this.plugin, bibliographyEl, this.panelCallbacks());
    await this.bibliographyPanel.render();

    const annexesEl = section.createDiv();
    this.annexesPanel = new AnnexesPanel(this.app, this.plugin, annexesEl, this.panelCallbacks());
    await this.annexesPanel.render();

    /* §20 du chantier « espace central » : les réglages de FABRICATION du
       livre quittent l'onglet « Composition & export » des Paramètres pour
       vivre ici. Mêmes propriétés, même `saveSettings()`, mêmes callbacks —
       aucun comportement réinventé, seule l'interface a déménagé. Grammaire
       de lignes déjà utilisée par ExportPanel embedded (.feuillets-edition-row),
       jamais une seconde apparence. */
    this.renderStructureSection(section);
    this.renderNotesSection(section);
    this.renderBookInfoSection(section);
    this.renderCompilationSection(section);
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
    /* `refreshView()` : exactement le même effet de bord que dans l'ancien
       onglet de réglages — la numérotation change l'affichage du Binder. */
    const saveAndRefresh = async (): Promise<void> => { await save(); this.plugin.refreshView(); };

    this.groupLabel(parent, t("settings.section.numbering"));
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
    this.groupLabel(parent, "Notes");
    this.toggleRow(parent, t("settings.footnoteRenumberOnCompile.name"), S.footnoteRenumberOnCompile,
      async (v) => { S.footnoteRenumberOnCompile = v; await this.plugin.saveSettings(); });
  }

  private renderBookInfoSection(parent: HTMLElement): void {
    const S = this.plugin.settings as CompositionSettings;
    this.groupLabel(parent, t("editionComposition.bookInfo"));
    this.textRow(parent, t("settings.manuscriptTitle.name"), S.manuscriptTitle,
      async (v) => { S.manuscriptTitle = v.trim(); await this.plugin.saveSettings(); await this.onChangeOpt?.(); });
    this.textRow(parent, t("settings.manuscriptAuthor.name"), S.manuscriptAuthor,
      async (v) => { S.manuscriptAuthor = v.trim(); await this.plugin.saveSettings(); await this.onChangeOpt?.(); });
  }

  private renderCompilationSection(parent: HTMLElement): void {
    const S = this.plugin.settings as CompositionSettings;
    const unitPlural = this.plugin.unitLabelPlural();
    this.groupLabel(parent, t("settings.section.compilation"));

    this.textRow(parent, "Séparateur", S.separator,
      async (v) => { S.separator = v; await this.plugin.saveSettings(); });

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

    const addRow = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
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
    await this.render();
  }

  private async removePreset(index: number): Promise<void> {
    const S = this.plugin.settings as CompositionSettings;
    S.compilePresets.splice(index, 1);
    if (S.activePreset >= S.compilePresets.length) S.activePreset = -1;
    await this.plugin.saveSettings();
    await this.render();
  }

  /** Callback commun transmis aux six panneaux — voir
   * EditionCompositionContentOptions.onChange. Un seul objet recréé à chaque
   * render() (pas de coût notable, cohérent avec le reste du composant qui
   * reconstruit tout son DOM à chaque appel). */
  private panelCallbacks(): { onPresentationChanged: () => void | Promise<void> } {
    return { onPresentationChanged: () => this.onChangeOpt?.() };
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
