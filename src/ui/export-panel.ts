import { Notice, Setting, TFile, TFolder, setIcon, setTooltip, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import {
  currentExportScope,
  exportBaseName,
  rememberExportScope,
  runExportWorkflow,
  type ExportWorkflowPlugin,
} from "../services/export-workflow.js";
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
  /** true : panneau toujours visible, sans sa propre barre Actualiser/fermer
   * (utilisé par EditionExportView, dont le conteneur fournit déjà le titre
   * de section). Par défaut (false) : comportement historique du panneau
   * repliable de l'Aperçu. */
  embedded?: boolean;
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
    if (!this.callbacks.embedded) this.container.toggleClass("is-hidden", this.collapsed);
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

  /** Panneau contextuel compact : aucune valeur propre au panneau. Tous les
   * contrôles lisent et écrivent les réglages déjà consommés par
   * compile()/exportFile(). En mode `embedded`, toujours visible et sans sa
   * propre barre Actualiser/fermer — le conteneur parent (EditionExportView)
   * fournit déjà le titre de section. */
  async render(): Promise<void> {
    const panel = this.container;
    const embedded = !!this.callbacks.embedded;
    panel.empty();
    /* Classe de base portant tout le CSS du panneau (styles.css,
       .feuillets-preview-export…) : posée par le panneau lui-même plutôt
       que supposée déjà présente sur le conteneur fourni par l'appelant —
       PreviewView comme EditionExportView n'ont ainsi rien à dupliquer. */
    panel.toggleClass("feuillets-preview-export", !embedded);
    panel.toggleClass("is-hidden", embedded ? false : this.collapsed);
    /* Seule la présentation change en mode embedded (styles.css,
       .feuillets-preview-export.is-embedded) : même DOM, mêmes classes de
       contrôle, même comportement — le panneau de l'Aperçu (sans cette
       classe) n'est pas affecté. */
    panel.toggleClass("is-embedded", embedded);
    panel.toggleClass("feuillets-edition-export-panel", embedded);

    if (embedded) {
      this.renderEditionEmbedded(panel);
      return;
    }

    if (!embedded) {
      const header = panel.createDiv({ cls: "feuillets-preview-export-header" });
      header.createSpan({ cls: "feuillets-preview-export-title", text: t("project.compilation.exportBtn") });
      const headerActions = header.createDiv({ cls: "feuillets-preview-export-header-actions" });
      /* Resynchronise TOUT le panneau avec l'aperçu. Utile si les réglages
         ont été modifiés ailleurs (Édition, autre onglet) pendant que ce
         panneau restait ouvert. */
      this.iconBtn(headerActions, "refresh-cw", t("preview.export.refreshPreview"), () => void this.reload());
      this.iconBtn(headerActions, "x", t("preview.export.collapsePanel"), () => this.toggle(true));
    }

    const main = panel.createDiv({ cls: "feuillets-preview-export-main" });

    /* La portée est AFFICHÉE, jamais modifiable ici : le fil d'Ariane
       (PreviewView) reste le seul endroit qui la change. */
    const scopeSetting = new Setting(main).setName(t("preview.export.scope"));
    const scopeLabel = scopeSetting.controlEl.createSpan();
    scopeLabel.setAttribute("aria-label", t("preview.export.scopeAriaLabel"));
    scopeLabel.textContent = this.scopeLabel();
    this.scopeLabelEl = scopeLabel;

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

  /** Rendu propre à l'inspecteur Édition. Il ne réutilise délibérément
   * aucune classe ni aucune cellule `Setting` du panneau Aperçu. */
  private renderEditionEmbedded(panel: HTMLElement): void {
    panel.createDiv({
      cls: "feuillets-edition-group-label feuillets-edition-export-title",
      text: "Sortie",
    });

    const scopeControl = this.editionPropertyRow(panel, t("preview.export.scope"));
    const scope = scopeControl.createEl("select");
    const current = this.resolveScope();
    const active = this.activeProjectFile();
    if (current?.type === "selection") scope.createEl("option", { value: "selection", text: t("preview.scope.selection", { count: String(current.paths.length) }) });
    if (active) {
      scope.createEl("option", { value: "file", text: t("preview.scope.file") });
      scope.createEl("option", { value: "folder", text: t("preview.scope.folder") });
    }
    scope.createEl("option", { value: "project", text: t("preview.scope.project") });
    scope.value = current?.type === "selection" ? "selection" : (current?.type || "project");
    scope.setAttribute("aria-label", t("preview.export.scopeAriaLabel"));
    scope.addEventListener("change", () => this.setEditionScope(scope.value, active, current));

    const formatControl = this.editionPropertyRow(panel, t("preview.export.format"));
    const format = formatControl.createEl("select");
    for (const [value, label] of [["docx", "DOCX"], ["pdf", "PDF"], ["epub", "EPUB"], ["odt", "ODT"]]) {
      format.createEl("option", { value, text: label });
    }
    format.value = this.exportFormat === "md" ? "docx" : this.exportFormat;
    format.setAttribute("aria-label", t("preview.export.outputFormat"));
    format.addEventListener("change", () => {
      this.plugin.settings.exportFormat = format.value;
      void this.plugin.saveSettings?.();
    });

    const fileNameControl = this.editionPropertyRow(panel, t("preview.export.fileName"));
    const fileName = fileNameControl.createEl("input", { type: "text" });
    fileName.value = this.exportFileName().replace(/\.md$/i, "");
    fileName.setAttribute("placeholder", t("preview.export.manuscriptPlaceholder"));
    fileName.setAttribute("aria-label", t("preview.export.outputFileName"));
    fileName.addEventListener("change", () => this.setExportFileName(fileName.value));

    /* §21 : seule option de l'ancien onglet « Composition & export » qui
       relève réellement du geste d'export. Le gabarit, les marges,
       l'orientation, l'en-tête/pied et les styles typographiques appartiennent
       à Mise en page et ne sont volontairement PAS réaffichés ici. */
    panel.createDiv({ cls: "feuillets-edition-group-label", text: "Options" });
    const typographyControl = this.editionPropertyRow(panel, t("settings.exportFrenchTypography.name"));
    const typography = typographyControl.createEl("input", { type: "checkbox" });
    typography.checked = this.plugin.settings.exportFrenchTypography !== false;
    typography.setAttribute("aria-label", t("settings.exportFrenchTypography.name"));
    typography.addEventListener("change", () => {
      this.plugin.settings.exportFrenchTypography = typography.checked;
      void this.plugin.saveSettings?.();
    });

    const footer = panel.createDiv({ cls: "feuillets-edition-export-footer" });
    const launch = footer.createEl("button", { cls: "mod-cta feuillets-edition-export-cta" });
    launch.setText(t("project.compilation.exportBtn"));
    launch.setAttribute("aria-label", t("preview.export.launch"));
    launch.addEventListener("click", () => void this.launchExport());
  }

  private editionPropertyRow(parent: HTMLElement, label: string): HTMLElement {
    const row = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: label });
    return row.createDiv({ cls: "feuillets-edition-row-control" });
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
