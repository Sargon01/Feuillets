import { Menu, Notice, Setting, TFile, TFolder, setIcon, setTooltip, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import {
  currentExportScope,
  exportBaseName,
  rememberExportScope,
  runExportWorkflow,
  currentExportDerivation,
  rememberExportDerivation,
  type ContentDerivationSelection,
  type ExportWorkflowPlugin,
} from "../services/export-workflow.js";
import { loadContentExtractions, type ContentExtraction } from "../services/content-extractions.js";
import { loadContentCollections, type ContentCollection } from "../services/content-collections.js";
import { type CompileScope } from "../services/compile-scope.js";
import { createFileScope, createFolderScope, createProjectScope } from "../services/compile-scope.js";

type ExportPanelSettings = FeuilletsSettings & {
  exportTemplate: string;
  exportFormat?: string;
  compileFileName?: string;
  activePreset?: number;
  compilePresets?: unknown[];
  manuscriptTitle?: string;
  manuscriptAuthor?: string;
};

type DerivationData = {
  extractions: ContentExtraction[];
  collections: ContentCollection[];
  extractionsCorrupted: boolean;
  collectionsCorrupted: boolean;
  selection: ContentDerivationSelection;
};

type DerivationDropdown = {
  addOption(value: string, label: string): DerivationDropdown;
  setValue(value: string): DerivationDropdown;
  onChange(callback: (value: string) => void): DerivationDropdown;
  selectEl?: HTMLSelectElement;
};

/** Sous-ensemble de PreviewViewPlugin réellement utilisé par le panneau
 * Export. Un type structurel propre, plutôt qu'un import du plugin de
 * PreviewView : le panneau ne doit connaître ni importer PreviewView. Étend
 * ExportWorkflowPlugin (services/export-workflow.ts) : c'est ce même service
 * qui fournit la portée par défaut et lance l'export réel. */
export type ExportPanelPlugin = ExportWorkflowPlugin & {
  settings: ExportPanelSettings;
  getProjectFolder(): TFolder | null;
  getLeafForOpeningFile?(): WorkspaceLeaf;
  saveSettings?(): Promise<void>;
};

/** Phase 1 : le panneau ne dépend plus d'aucun callback obligatoire vers
 * PreviewView. La portée vient directement de `getScope()` (ou, à défaut,
 * de `currentExportScope()` — services/export-workflow.ts) et l'export
 * appelle directement `runExportWorkflow()` : ExportPanel fonctionne aussi
 * bien monté par PreviewView que par EditionExportView, sans instance
 * Preview. */
export type ExportPanelCallbacks = {
  /** Portée explicite à utiliser, si l'appelant en connaît une (PreviewView :
   * `effectiveExportScope()`). Facultatif — sans lui, le panneau retombe sur
   * `currentExportScope(plugin)`. */
  getScope?: () => CompileScope | null;
  /** Appelé après le bouton « Actualiser » (Aperçu uniquement) — facultatif :
   * depuis Preview il rafraîchit l'Aperçu, depuis Édition aucune instance
   * PreviewView n'existe et il peut rester absent. Le gabarit ne se règle
   * plus ici (Phase 11, voir Édition → Mise en page) : ExportPanel ne
   * déclenche donc plus ce callback pour cette raison. */
  onPresentationChanged?: () => Promise<void> | void;
};

/**
 * Panneau contextuel compact de l'Aperçu : aucune valeur qui lui soit
 * propre. Tous les contrôles lisent et écrivent les réglages déjà consommés
 * par compile()/exportFile() (via PreviewViewPlugin.settings), tandis que la
 * portée affichée et l'actualisation restent décidées par PreviewView et
 * transmises par callback.
 *
 * Extrait mécaniquement de PreviewView (chantier 1A) : même DOM, mêmes
 * classes CSS, mêmes événements, même comportement — seul l'emplacement du
 * code change.
 */
export class ExportPanel {
  /** État d'interface de session uniquement ; aucun réglage d'export n'est
   * dupliqué ici. */
  private collapsed = true;
  private scopeLabelEl: HTMLElement | null = null;

  constructor(
    private app: App,
    private plugin: ExportPanelPlugin,
    private container: HTMLElement,
    private callbacks: ExportPanelCallbacks = {}
  ) {}

  /* ======================= Portée ======================================
     Phase 1 : le panneau ne reçoit plus un simple texte de portée. Il lit le
     CompileScope réel — celui de l'appelant (`getScope`) s'il en fournit un,
     sinon `currentExportScope()` (services/export-workflow.ts) — et en
     dérive lui-même le libellé, à partir des mêmes clés i18n
     `preview.scope.*` qu'utilisait PreviewView. */

  private resolveScope(): CompileScope | null {
    return this.callbacks.getScope ? this.callbacks.getScope() : currentExportScope(this.plugin);
  }

  private scopeLabel(): string {
    const scope = this.resolveScope();
    if (!scope) return t("preview.scope.project");
    switch (scope.type) {
      case "file":
        return t("preview.scope.file");
      case "folder":
        return t("preview.scope.folder");
      case "project":
        return t("preview.scope.project");
      case "selection":
        return t("preview.scope.selection", { count: String(scope.paths.length) });
    }
  }

  /* ======================= Ouverture / repli =========================== */

  toggle(collapsed?: boolean): void {
    this.collapsed = collapsed ?? !this.collapsed;
    this.container.toggleClass("is-hidden", this.collapsed);
    /* À l'ouverture, les réglages affichés sont relus depuis les réglages
       centraux : ils ont pu être modifiés ailleurs (Édition) entre-temps. */
    if (!this.collapsed) void this.render();
  }

  /** Le libellé de portée du panneau Export suit la même portée que le rendu
   * et le fil d'Ariane (une seule source de vérité). Appelé depuis
   * PreviewView.updateUI() ; sans effet si le panneau n'a pas encore été
   * rendu (`scopeLabelEl` alors `null`). */
  refreshScopeLabel(): void {
    if (this.scopeLabelEl) this.scopeLabelEl.textContent = this.scopeLabel();
  }

  /* ======================= Réglages & export ==========================
     Aucun réglage de compilation n'est défini ici : l'onglet Export des
     paramètres Feuillets reste la source unique. L'export appelle
     directement runExportWorkflow() (services/export-workflow.ts), point
     d'entrée commun à Binder, Aperçu et Édition. */

  /** Panneau contextuel compact de l'Aperçu — seul mode restant depuis que
   * la barre d'export compacte d'Édition (renderQuickBar) a remplacé le mode
   * `embedded` (dernier lot UX avant 2.5, §1) : aucun appelant ne construit
   * plus ExportPanel avec un mode embedded. */
  async render(): Promise<void> {
    const panel = this.container;
    panel.empty();
    /* Classe de base portant tout le CSS du panneau (styles.css,
       .feuillets-preview-export…) : posée par le panneau lui-même plutôt
       que supposée déjà présente sur le conteneur fourni par l'appelant. */
    panel.addClass("feuillets-preview-export");
    panel.toggleClass("is-hidden", this.collapsed);

    const header = panel.createDiv({ cls: "feuillets-preview-export-header" });
    header.createSpan({ cls: "feuillets-preview-export-title", text: t("project.compilation.exportBtn") });
    const headerActions = header.createDiv({ cls: "feuillets-preview-export-header-actions" });
    /* Resynchronise TOUT le panneau avec l'aperçu. Utile si les réglages
       ont été modifiés ailleurs (Édition, autre onglet) pendant que ce
       panneau restait ouvert. */
    this.iconBtn(headerActions, "refresh-cw", t("preview.export.refreshPreview"), () => void this.reload());
    this.iconBtn(headerActions, "x", t("preview.export.collapsePanel"), () => this.toggle(true));

    const main = panel.createDiv({ cls: "feuillets-preview-export-main" });

    /* La portée est AFFICHÉE, jamais modifiable ici : le fil d'Ariane
       (PreviewView) reste le seul endroit qui la change. */
    const scopeSetting = new Setting(main).setName(t("preview.export.scope"));
    const scopeLabel = scopeSetting.controlEl.createSpan();
    scopeLabel.setAttribute("aria-label", t("preview.export.scopeAriaLabel"));
    scopeLabel.textContent = this.scopeLabel();
    this.scopeLabelEl = scopeLabel;

    const derivationData = await this.loadDerivationData();
    if (this.hasDerivationOptions(derivationData)) {
      new Setting(main)
        .setName(t("contentDerivation.select"))
        .addDropdown((dropdown) => this.configureDerivationDropdown(dropdown, derivationData));
    }

    new Setting(main)
      .setName(t("preview.export.format"))
      .addDropdown((dropdown) => {
        for (const [value, label] of [["docx", "DOCX"], ["pdf", "PDF"], ["epub", "EPUB"], ["odt", "ODT"]]) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(this.exportFormat === "md" ? "docx" : this.exportFormat);
        dropdown.onChange((value) => {
          this.plugin.settings.exportFormat = value;
          void this.plugin.saveSettings?.();
        });
        dropdown.selectEl.setAttribute("aria-label", t("preview.export.outputFormat"));
      });

    new Setting(main)
      .setName(t("preview.export.fileName"))
      .addText((text) => {
        text
          .setValue(this.exportFileName().replace(/\.md$/i, ""))
          .setPlaceholder(t("preview.export.manuscriptPlaceholder"))
          .onChange((value) => {
            const fileName = `${value.trim() || t("preview.export.defaultFileName")}.md`;
            const index = typeof this.plugin.settings.activePreset === "number" ? this.plugin.settings.activePreset : -1;
            const candidate = index >= 0 ? this.plugin.settings.compilePresets?.[index] : null;
            const preset = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
            if (preset) preset.fileName = fileName;
            else this.plugin.settings.compileFileName = fileName;
            void this.plugin.saveSettings?.();
          });
        text.inputEl.setAttribute("aria-label", t("preview.export.outputFileName"));
      });

    const footer = panel.createDiv({ cls: "feuillets-preview-export-footer" });
    new Setting(footer).addButton((button) => {
      button
        .setIcon("download")
        .setButtonText(t("project.compilation.exportBtn"))
        .setCta()
        .onClick(() => void this.launchExport());
      button.buttonEl.addClass("feuillets-preview-export-launch");
      button.buttonEl.setAttribute("aria-label", t("preview.export.launch"));
    });
  }

  /** Barre d'export compacte (dernier lot UX avant 2.5, §1) : uniquement
   * portée + format + bouton Exporter, sans étiquette ("Projet ▾" est déjà
   * assez explicite pour ne pas dupliquer "Portée"/"Format" à côté) ni champ
   * nom de fichier — hébergée dans la barre principale d'Édition, visible
   * quel que soit l'onglet actif (Composition ou Mise en page). Réutilise
   * EXACTEMENT la même logique que renderEditionEmbedded ci-dessus
   * (resolveScope/setEditionScope/exportFormat/launchExport) : seul le DOM
   * diffère, aucune nouvelle portée ni aucun nouveau point d'entrée
   * d'export. Le champ « Nom du fichier » et les « Options » (typographie
   * française) ne sont plus affichés ici : le nom continue de fonctionner
   * via compileFileName/preset (voir setExportFileName, inchangé), la
   * typographie française vit désormais dans Mise en page → Corps de texte. */
  renderQuickBar(bar: HTMLElement): void {
    bar.empty();
    bar.addClass("feuillets-edition-quickexport");

    const scopeButton = this.quickMenuButton(bar, "scope", "layers", this.quickScopeTooltip(this.resolveScope()));
    scopeButton.addEventListener("click", (event) => this.showQuickScopeMenu(event, scopeButton));
    const contentButton = this.quickMenuButton(bar, "content", "file-text", t("contentDerivation.fullTooltip"));
    contentButton.addEventListener("click", (event) => void this.showQuickContentMenu(event, contentButton));
    void this.updateQuickContentButton(contentButton);
    const formatButton = this.quickMenuButton(bar, "format", "file-cog", this.quickFormatTooltip(this.exportFormat));
    formatButton.addEventListener("click", (event) => this.showQuickFormatMenu(event, formatButton));

    const launch = bar.createEl("button", {
      cls: "mod-cta feuillets-edition-quickexport-cta",
      text: t("project.compilation.exportBtn"),
    });
    launch.setAttribute("aria-label", t("preview.export.launch"));
    launch.addEventListener("click", () => void this.launchExport());
  }

  private quickMenuButton(parent: HTMLElement, kind: string, icon: string, tooltip: string): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `clickable-icon feuillets-edition-quickexport-${kind}` });
    setIcon(button, icon);
    setTooltip(button, tooltip);
    button.setAttribute("title", tooltip);
    button.setAttribute("aria-label", tooltip);
    return button;
  }

  private quickScopeTooltip(scope: CompileScope | null): string {
    const label = scope?.type === "selection"
      ? t("preview.scope.selection", { count: String(scope.paths.length) })
      : scope?.type === "file" ? t("preview.scope.file")
      : scope?.type === "folder" ? t("preview.scope.folder")
      : t("preview.scope.project");
    return t("preview.export.scopeTooltip", { scope: label });
  }

  private quickFormatTooltip(format: string): string {
    const label = format === "md" ? "Markdown" : format.toUpperCase();
    return t("preview.export.formatTooltip", { format: label });
  }

  private showQuickScopeMenu(event: MouseEvent, button: HTMLButtonElement): void {
    const current = this.resolveScope();
    const active = this.activeProjectFile();
    const menu = new Menu();
    const addScope = (value: string, title: string): void => {
      menu.addItem((item) => item.setTitle(title).setChecked((current?.type || "project") === value).onClick(() => {
        this.setEditionScope(value, active, current);
        void this.updateQuickScopeButton(button);
      }));
    };
    addScope("project", t("preview.scope.project"));
    if (active?.parent) addScope("folder", t("preview.scope.folder"));
    if (active) addScope("file", t("preview.scope.file"));
    if (current?.type === "selection") addScope("selection", t("preview.scope.selection", { count: String(current.paths.length) }));
    this.showQuickMenu(menu, event, button);
  }

  /** Menu natif : onHide couvre sélection, clic extérieur et Échap. La
   * restauration est attachée au bouton déclencheur, sans rerendu ni délai. */
  private showQuickMenu(menu: Menu, event: MouseEvent, button: HTMLButtonElement): void {
    menu.onHide(() => button.focus());
    menu.showAtMouseEvent(event);
  }

  private updateQuickScopeButton(button: HTMLButtonElement): void {
    const tooltip = this.quickScopeTooltip(this.resolveScope());
    setTooltip(button, tooltip);
    button.setAttribute("title", tooltip);
    button.setAttribute("aria-label", tooltip);
  }

  private async updateQuickContentButton(button: HTMLButtonElement): Promise<void> {
    const derivationData = await this.loadDerivationData();
    const title = this.quickContentTooltip(derivationData);
    setTooltip(button, title);
    button.setAttribute("title", title);
    button.setAttribute("aria-label", title);
    setIcon(button, derivationData.selection.kind === "collection" ? "layers" : "file-text");
  }

  private quickContentTooltip(data: DerivationData): string {
    if (data.selection.kind === "full") return t("contentDerivation.fullTooltip");
    const selection = data.selection;
    const items = selection.kind === "extraction" ? data.extractions : data.collections;
    const item = items.find((candidate) => candidate.id === selection.id);
    if (!item && (selection.kind === "extraction" ? data.extractionsCorrupted : data.collectionsCorrupted)) {
      return selection.kind === "extraction" ? t("contentDerivation.unavailableExtraction") : t("contentDerivation.unavailableCollection");
    }
    return this.derivationLabel(selection, data);
  }

  private async showQuickContentMenu(event: MouseEvent, button: HTMLButtonElement): Promise<void> {
    const data = await this.loadDerivationData();
    const selectedExtractionId = data.selection.kind === "extraction" ? data.selection.id : null;
    const selectedCollectionId = data.selection.kind === "collection" ? data.selection.id : null;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("contentDerivation.fullDocument")).setChecked(data.selection.kind === "full").onClick(() => {
      rememberExportDerivation(this.plugin, { kind: "full" });
      void this.updateQuickContentButton(button);
    }));
    if (data.extractions.length > 0 || data.extractionsCorrupted) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("contentDerivation.extractions")).setDisabled(true));
      for (const extraction of data.extractions) {
        menu.addItem((item) => item.setTitle(extraction.name).setChecked(selectedExtractionId === extraction.id).onClick(() => {
          rememberExportDerivation(this.plugin, { kind: "extraction", id: extraction.id });
          void this.updateQuickContentButton(button);
        }));
      }
      if (data.extractionsCorrupted && data.selection.kind === "extraction") {
        menu.addItem((item) => item.setTitle(t("contentDerivation.unavailableExtraction")).setChecked(true));
      }
    }
    if (data.collections.length > 0 || data.collectionsCorrupted) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("contentDerivation.collections")).setDisabled(true));
      for (const collection of data.collections) {
        menu.addItem((item) => item.setTitle(collection.name).setChecked(selectedCollectionId === collection.id).onClick(() => {
          rememberExportDerivation(this.plugin, { kind: "collection", id: collection.id });
          void this.updateQuickContentButton(button);
        }));
      }
      if (data.collectionsCorrupted && data.selection.kind === "collection") {
        menu.addItem((item) => item.setTitle(t("contentDerivation.unavailableCollection")).setChecked(true));
      }
    }
    this.showQuickMenu(menu, event, button);
  }

  private showQuickFormatMenu(event: MouseEvent, button: HTMLButtonElement): void {
    const current = this.exportFormat === "md" ? "docx" : this.exportFormat;
    const menu = new Menu();
    for (const [value, label] of [["pdf", "PDF"], ["docx", "DOCX"], ["odt", "ODT"], ["epub", "EPUB"], ["md", "Markdown"]]) {
      menu.addItem((item) => item.setTitle(label).setChecked(current === value).onClick(() => {
        this.plugin.settings.exportFormat = value;
        void this.plugin.saveSettings?.();
        setTooltip(button, this.quickFormatTooltip(value));
        button.setAttribute("title", this.quickFormatTooltip(value));
      }));
    }
    this.showQuickMenu(menu, event, button);
  }

  private async loadDerivationData(): Promise<DerivationData> {
    const extractionResult = await loadContentExtractions(this.app, this.plugin.settings)
      .then((store) => ({ store, corrupted: false }))
      .catch(() => ({ store: null, corrupted: true }));
    const collectionResult = await loadContentCollections(this.app, this.plugin.settings)
      .then((store) => ({ store, corrupted: false }))
      .catch(() => ({ store: null, corrupted: true }));
    let selection = currentExportDerivation(this.plugin);
    if (selection.kind === "extraction") {
      const extractionId = selection.id;
      if (!extractionResult.corrupted && !extractionResult.store?.extractions.some((item) => item.id === extractionId)) {
        rememberExportDerivation(this.plugin, { kind: "full" });
        selection = { kind: "full" };
      }
    } else if (selection.kind === "collection") {
      const collectionId = selection.id;
      if (!collectionResult.corrupted && !collectionResult.store?.collections.some((item) => item.id === collectionId)) {
        rememberExportDerivation(this.plugin, { kind: "full" });
        selection = { kind: "full" };
      }
    }
    return {
      extractions: extractionResult.store?.extractions || [],
      collections: collectionResult.store?.collections || [],
      extractionsCorrupted: extractionResult.corrupted,
      collectionsCorrupted: collectionResult.corrupted,
      selection,
    };
  }

  private hasDerivationOptions(data: DerivationData): boolean {
    return data.extractions.length > 0 || data.collections.length > 0
      || (data.selection.kind === "extraction" && data.extractionsCorrupted)
      || (data.selection.kind === "collection" && data.collectionsCorrupted);
  }

  private derivationValue(selection: ContentDerivationSelection): string {
    return selection.kind === "full" ? "full" : `${selection.kind}:${selection.id}`;
  }

  private derivationLabel(selection: ContentDerivationSelection, data: DerivationData): string {
    if (selection.kind === "full") return t("contentDerivation.fullDocument");
    const items = selection.kind === "extraction" ? data.extractions : data.collections;
    const item = items.find((candidate) => candidate.id === selection.id);
    const prefix = selection.kind === "extraction"
      ? t("contentDerivation.extractionPrefix")
      : t("contentDerivation.collectionPrefix");
    return `${prefix} ${item?.name || (selection.kind === "extraction" ? t("contentDerivation.unavailableExtraction") : t("contentDerivation.unavailableCollection"))}`;
  }

  private selectionFromValue(value: string): ContentDerivationSelection {
    if (value === "full") return { kind: "full" };
    const separator = value.indexOf(":");
    if (separator > 0) {
      const kind = value.slice(0, separator);
      const id = value.slice(separator + 1);
      if (kind === "extraction" || kind === "collection") return { kind, id };
    }
    return { kind: "full" };
  }

  private configureDerivationDropdown(dropdown: DerivationDropdown, data: DerivationData): void {
    dropdown.addOption("full", this.derivationLabel({ kind: "full" }, data));
    const addGroup = (label: string, items: { id: string; name: string }[]): void => {
      if (items.length === 0) return;
      if (dropdown.selectEl && typeof dropdown.selectEl.createEl === "function") {
        const group = dropdown.selectEl.createEl("optgroup", { attr: { label } });
        const kind: "extraction" | "collection" = label === t("contentDerivation.extractions") ? "extraction" : "collection";
        for (const item of items) group.createEl("option", { value: `${kind}:${item.id}`, text: this.derivationLabel({ kind, id: item.id }, data) });
      } else {
        const kind = label === t("contentDerivation.extractions") ? "extraction" : "collection";
        for (const item of items) dropdown.addOption(`${kind}:${item.id}`, this.derivationLabel({ kind, id: item.id }, data));
      }
    };
    addGroup(t("contentDerivation.extractions"), data.extractions);
    addGroup(t("contentDerivation.collections"), data.collections);
    if (data.selection.kind === "extraction" && data.extractionsCorrupted) dropdown.addOption(this.derivationValue(data.selection), this.derivationLabel(data.selection, data));
    if (data.selection.kind === "collection" && data.collectionsCorrupted) dropdown.addOption(this.derivationValue(data.selection), this.derivationLabel(data.selection, data));
    dropdown.setValue(this.derivationValue(data.selection));
    dropdown.onChange((value) => rememberExportDerivation(this.plugin, this.selectionFromValue(value)));
  }

  private configureNativeDerivationSelect(select: HTMLSelectElement, data: DerivationData): void {
    select.createEl("option", { value: "full", text: this.derivationLabel({ kind: "full" }, data) });
    const addGroup = (label: string, items: { id: string; name: string }[], kind: "extraction" | "collection"): void => {
      if (items.length === 0) return;
      const group = select.createEl("optgroup", { attr: { label } });
      for (const item of items) group.createEl("option", { value: `${kind}:${item.id}`, text: this.derivationLabel({ kind, id: item.id }, data) });
    };
    addGroup(t("contentDerivation.extractions"), data.extractions, "extraction");
    addGroup(t("contentDerivation.collections"), data.collections, "collection");
    if (data.selection.kind === "extraction" && data.extractionsCorrupted) select.createEl("option", { value: this.derivationValue(data.selection), text: this.derivationLabel(data.selection, data) });
    if (data.selection.kind === "collection" && data.collectionsCorrupted) select.createEl("option", { value: this.derivationValue(data.selection), text: this.derivationLabel(data.selection, data) });
    select.value = this.derivationValue(data.selection);
    select.addEventListener("change", () => rememberExportDerivation(this.plugin, this.selectionFromValue(select.value)));
  }


  private activeProjectFile(): TFile | null {
    const file = this.app.workspace?.getActiveFile?.();
    const root = this.plugin.getProjectFolder();
    if (!(file instanceof TFile) || file.extension !== "md" || !root || !file.path.startsWith(`${root.path}/`)) return null;
    if (file.path.includes("/Front/") || file.path.includes("/Annexes/") || file.path.includes("/Appendices/") || file.path.includes("/_")) return null;
    return file;
  }

  private setEditionScope(value: string, active: TFile | null, current: CompileScope | null): void {
    const root = this.plugin.getProjectFolder();
    if (!root) return;
    let scope: CompileScope;
    if (value === "selection" && current?.type === "selection") scope = current;
    else if (value === "file" && active) scope = createFileScope(root.path, active.path);
    else if (value === "folder" && active?.parent) scope = createFolderScope(root.path, active.parent.path);
    else scope = createProjectScope(root.path);
    rememberExportScope(this.plugin, scope);
    this.scopeLabelEl = null;
  }

  private setExportFileName(value: string): void {
    const fileName = `${value.trim() || t("preview.export.defaultFileName")}.md`;
    const index = typeof this.plugin.settings.activePreset === "number" ? this.plugin.settings.activePreset : -1;
    const candidate = index >= 0 ? this.plugin.settings.compilePresets?.[index] : null;
    const preset = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
    if (preset) preset.fileName = fileName;
    else this.plugin.settings.compileFileName = fileName;
    void this.plugin.saveSettings?.();
  }

  /** Lance l'export réel via le workflow commun (services/export-workflow.ts)
   * — même point d'entrée que le Binder — avec la portée réellement affichée
   * par ce panneau. Aucun appel à PreviewView.doExport(). */
  private async launchExport(): Promise<void> {
    await runExportWorkflow(this.app, this.plugin, this.resolveScope());
  }

  /** Reconstruit le panneau ENTIER (les valeurs affichées viennent des
   * réglages) puis l'aperçu, sans toucher au zoom ni à la position de
   * lecture — bouton « Actualiser » du panneau (Aperçu uniquement, jamais en
   * mode embedded : voir render()). */
  private async reload(): Promise<void> {
    /* Un échec pendant la reconstruction du panneau ne doit jamais faire
       disparaître le bouton « Actualiser » en silence : sans ce filet, une
       exception ici empêchait même l'appel à refreshPreview() qui suit — vu
       de l'utilisatrice, un clic qui ne fait plus jamais rien tant que
       l'onglet n'est pas rouvert. */
    try {
      await this.render();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(t("preview.notice.exportPanelError", { message: msg }));
      console.error("Feuillets : échec de renderExportPanel", e);
    }
    await this.callbacks.onPresentationChanged?.();
  }

  private exportFileName(): string {
    return `${exportBaseName(this.plugin.settings)}.md`;
  }

  private get exportFormat(): string {
    const format = this.plugin?.settings?.exportFormat;
    return typeof format === "string" && format ? format : "docx";
  }

  /* ========================== Bouton-icône ========================== */

  /** Bouton-icône, calqué sur BaseFeuilletsView.iconBtn / PreviewView.iconBtn :
   * même classe `clickable-icon`, mêmes icônes Lucide. Le style (taille,
   * couleur, survol, arrondi) vient du THÈME — styles.css ne fait qu'aligner
   * et gérer l'opacité, comme pour les autres barres du plugin. */
  private iconBtn(parent: HTMLElement, icon: string, label: string, onClick?: (e: MouseEvent) => void): HTMLElement {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    setTooltip(btn, label);
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
    if (onClick) btn.addEventListener("click", (e) => onClick(e));
    return btn;
  }
}
