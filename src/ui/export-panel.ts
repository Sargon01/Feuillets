import { Notice, TFolder, setIcon, setTooltip, type App, type WorkspaceLeaf } from "obsidian";
import { listExportTemplates } from "../services/export-templates-custom.js";
import { t } from "../i18n/index.js";
import { CompileSelectionModal } from "./selection-modals.js";
import {
  currentExportScope,
  exportBaseName,
  runExportWorkflow,
  type ExportWorkflowPlugin,
} from "../services/export-workflow.js";
import { type CompileScope } from "../services/compile-scope.js";

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
  /** Appelé après tout changement susceptible d'influencer une PRÉSENTATION
   * déjà affichée ailleurs (gabarit…) — facultatif : depuis Preview il
   * rafraîchit l'Aperçu, depuis Édition aucune instance PreviewView n'existe
   * et il peut rester absent. */
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
    panel.addClass("feuillets-preview-export");
    panel.toggleClass("is-hidden", embedded ? false : this.collapsed);
    /* Seule la présentation change en mode embedded (styles.css,
       .feuillets-preview-export.is-embedded) : même DOM, mêmes classes de
       contrôle, même comportement — le panneau de l'Aperçu (sans cette
       classe) n'est pas affecté. */
    panel.toggleClass("is-embedded", embedded);

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
    const field = (label: string, control: HTMLElement): HTMLElement => {
      const wrap = main.createDiv({ cls: "feuillets-preview-export-field" });
      wrap.createSpan({ cls: "feuillets-preview-export-label", text: label });
      wrap.appendChild(control);
      return control;
    };

    /* La portée est AFFICHÉE, jamais modifiable ici : le fil d'Ariane
       (PreviewView) reste le seul endroit qui la change. */
    const scopeLabel = createSpan({ cls: "feuillets-preview-export-control feuillets-preview-export-scope-value" });
    scopeLabel.setAttribute("aria-label", t("preview.export.scopeAriaLabel"));
    scopeLabel.textContent = this.scopeLabel();
    this.scopeLabelEl = scopeLabel;
    field(t("preview.export.scope"), scopeLabel);

    const included = createEl("button");
    included.className = "clickable-icon feuillets-preview-export-control feuillets-preview-export-action-btn";
    setIcon(included, "list-checks");
    included.createSpan({ text: t("preview.export.includedItems") });
    included.setAttribute("aria-label", t("preview.export.chooseIncludedItems"));
    included.addEventListener("click", () => {
      new CompileSelectionModal(
        this.app,
        this.plugin as unknown as ConstructorParameters<typeof CompileSelectionModal>[1]
      ).open();
    });
    field(t("preview.export.content"), included);

    const format = createEl("select");
    format.className = "feuillets-preview-export-control";
    for (const [value, label] of [["docx", "DOCX"], ["pdf", "PDF"], ["epub", "EPUB"], ["odt", "ODT"]]) {
      format.createEl("option", { value, text: label });
    }
    format.value = this.exportFormat === "md" ? "docx" : this.exportFormat;
    format.setAttribute("aria-label", t("preview.export.outputFormat"));
    format.addEventListener("change", () => {
      this.plugin.settings.exportFormat = format.value;
      void this.plugin.saveSettings?.();
    });
    field(t("preview.export.format"), format);

    const template = createEl("select");
    template.className = "feuillets-preview-export-control";
    const templates = await listExportTemplates(this.app, this.plugin.settings);
    for (const tpl of templates) template.createEl("option", { value: tpl.key, text: tpl.label });
    template.value = this.plugin.settings.exportTemplate;
    template.setAttribute("aria-label", t("preview.export.templateAriaLabel"));
    template.addEventListener("change", () => {
      this.plugin.settings.exportTemplate = template.value;
      void this.plugin.saveSettings?.();
      void this.callbacks.onPresentationChanged?.();
    });
    field(t("preview.export.template"), template);

    const name = createEl("input");
    name.className = "feuillets-preview-export-control";
    name.type = "text";
    name.value = this.exportFileName().replace(/\.md$/i, "");
    name.setAttribute("aria-label", t("preview.export.outputFileName"));
    name.setAttribute("placeholder", t("preview.export.manuscriptPlaceholder"));
    name.addEventListener("change", () => {
      const fileName = `${name.value.trim() || t("preview.export.defaultFileName")}.md`;
      const index = typeof this.plugin.settings.activePreset === "number" ? this.plugin.settings.activePreset : -1;
      const candidate = index >= 0 ? this.plugin.settings.compilePresets?.[index] : null;
      const preset = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
      if (preset) preset.fileName = fileName;
      else this.plugin.settings.compileFileName = fileName;
      void this.plugin.saveSettings?.();
    });
    field(t("preview.export.fileName"), name);

    const footer = panel.createDiv({ cls: "feuillets-preview-export-footer" });
    const launch = footer.createEl("button", { cls: "clickable-icon mod-cta feuillets-preview-export-launch" });
    setIcon(launch, "download");
    launch.createSpan({ text: t("project.compilation.exportBtn") });
    launch.setAttribute("aria-label", t("preview.export.launch"));
    launch.addEventListener("click", () => void this.launchExport());
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
