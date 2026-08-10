import { Notice, TFile, TFolder, setIcon, setTooltip, type App, type WorkspaceLeaf } from "obsidian";
import { listExportTemplates } from "../services/export-templates-custom.js";
import { activePresetConfig } from "../services/compile-export.js";
import { isFrontMatter } from "../services/folder-structure.js";
import { fmOf } from "../services/frontmatter.js";
import { readTitleRoleValue, setTitleRoleValue } from "../utils/title-roles.js";
import { t } from "../i18n/index.js";
import { CompileSelectionModal } from "./selection-modals.js";
import { LayoutModal } from "./layout-modal.js";

/** Champs de la première page réellement pris en charge, dans l'ordre où ils
 * apparaissent sur la page. Chacun est un RÔLE du feuillet Front (voir
 * utils/title-roles.ts) : aucun champ n'a de stockage propre au panneau
 * Export. */
export function previewFirstPageFields(): Array<{ label: string; role: string }> {
  return [
    { label: t("preview.firstPageField.title"), role: "titre" },
    { label: t("preview.firstPageField.subtitle"), role: "sous-titre" },
    { label: t("preview.firstPageField.author"), role: "auteur" },
    { label: t("preview.firstPageField.additionalMention"), role: "mots" },
    { label: t("preview.firstPageField.imageOrLogo"), role: "image" },
  ];
}

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
 * PreviewView : le panneau ne doit connaître ni importer PreviewView. */
export type ExportPanelPlugin = {
  settings: ExportPanelSettings;
  getProjectFolder(): TFolder | null;
  getLeafForOpeningFile?(): WorkspaceLeaf;
  saveSettings?(): Promise<void>;
};

/** Les seules dépendances vers PreviewView : des callbacks, jamais
 * l'instance elle-même. La portée, l'actualisation et l'export réel restent
 * décidés par PreviewView (règle du chantier 1A). */
export type ExportPanelCallbacks = {
  /** Libellé de portée à afficher (lecture seule ici, jamais modifiable
   * depuis le panneau). */
  getScopeLabel: () => string;
  /** Réactualise l'aperçu — TOUJOURS relu dynamiquement sur l'instance
   * PreviewView au moment de l'appel (jamais capturé une fois pour toutes). */
  refreshPreview: () => Promise<void> | void;
  /** Lance l'export réel via PreviewView.doExport(). */
  onExport: () => void | Promise<void>;
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
  /** Corps de la sous-section « Première page », gardé en référence pour
   * pouvoir la réactualiser SEULE : inclure/exclure ou changer de fichier
   * Front ne doit pas reconstruire tout le panneau Export (portée, format,
   * gabarit…), ce qui refermerait la sous-section et déplacerait le focus
   * hors de tout contrôle. */
  firstPageBodyEl: HTMLElement | null = null;
  private firstPageTemplates: Array<{ key: string; label: string }> = [];
  /** État repliée/dépliée de « Première page », conservé même à travers un
   * réel rebuild complet du panneau (bouton Actualiser, réouverture). */
  private firstPageOpen = false;
  /** État d'interface de session uniquement ; aucun réglage d'export n'est
   * dupliqué ici. */
  private collapsed = true;
  private scopeLabelEl: HTMLElement | null = null;

  constructor(
    private app: App,
    private plugin: ExportPanelPlugin,
    private container: HTMLElement,
    private callbacks: ExportPanelCallbacks
  ) {}

  /* ======================= Ouverture / repli =========================== */

  toggle(collapsed?: boolean): void {
    this.collapsed = collapsed ?? !this.collapsed;
    this.container.toggleClass("is-hidden", this.collapsed);
    /* À l'ouverture, les champs de la première page sont relus dans le
       feuillet Front : il a pu être modifié dans l'éditeur entre-temps, et
       l'écran ne doit jamais montrer une valeur que le fichier n'a plus. */
    if (!this.collapsed) void this.render();
  }

  /** Le libellé de portée du panneau Export suit la même portée que le rendu
   * et le fil d'Ariane (une seule source de vérité, décidée par
   * PreviewView). Appelé depuis PreviewView.updateUI(). */
  refreshScopeLabel(): void {
    if (this.scopeLabelEl) this.scopeLabelEl.textContent = this.callbacks.getScopeLabel();
  }

  /* ======================= Réglages & export ==========================
     Aucun réglage de compilation n'est défini ici : l'onglet Export des
     paramètres Feuillets reste la source unique. L'export appelle le point
     d'entrée existant de PreviewView (doExport, via callback), qui gère le
     titre repris de la page de titre, le dossier de sortie et les notices. */

  /** Panneau contextuel compact : aucune valeur propre au panneau. Tous les
   * contrôles lisent et écrivent les réglages déjà consommés par
   * compile()/exportFile(), tandis que la portée est fournie par
   * PreviewView. */
  async render(): Promise<void> {
    const panel = this.container;
    panel.empty();
    panel.toggleClass("is-hidden", this.collapsed);

    const header = panel.createDiv({ cls: "feuillets-preview-export-header" });
    header.createSpan({ cls: "feuillets-preview-export-title", text: t("project.compilation.exportBtn") });
    const headerActions = header.createDiv({ cls: "feuillets-preview-export-header-actions" });
    /* Resynchronise TOUT le panneau — y compris les champs de la première
       page, relus dans le feuillet Front — avec l'aperçu. Utile si le
       fichier a été modifié ailleurs (éditeur, autre onglet) pendant que ce
       panneau restait ouvert. */
    this.iconBtn(headerActions, "refresh-cw", t("preview.export.refreshPreview"), () => void this.reload());
    this.iconBtn(headerActions, "x", t("preview.export.collapsePanel"), () => this.toggle(true));

    const main = panel.createDiv({ cls: "feuillets-preview-export-main" });
    const field = (label: string, control: HTMLElement): HTMLElement => {
      const wrap = main.createDiv({ cls: "feuillets-preview-export-field" });
      wrap.createSpan({ cls: "feuillets-preview-export-label", text: label });
      wrap.appendChild(control);
      return control;
    };

    /* La portée est AFFICHÉE, jamais modifiable ici : le fil d'Ariane est le
       seul endroit qui change la portée (règle 3 et 4 du chantier). */
    const scopeLabel = createSpan({ cls: "feuillets-preview-export-control feuillets-preview-export-scope-value" });
    scopeLabel.setAttribute("aria-label", t("preview.export.scopeAriaLabel"));
    scopeLabel.textContent = this.callbacks.getScopeLabel();
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
      void this.callbacks.refreshPreview();
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

    await this.renderFirstPageSection(panel, templates);

    const footer = panel.createDiv({ cls: "feuillets-preview-export-footer" });
    const launch = footer.createEl("button", { cls: "clickable-icon mod-cta feuillets-preview-export-launch" });
    setIcon(launch, "download");
    launch.createSpan({ text: t("project.compilation.exportBtn") });
    launch.setAttribute("aria-label", t("preview.export.launch"));
    launch.addEventListener("click", () => void this.callbacks.onExport());
  }

  /* ======================== Première page =============================
     CONTENU et INCLUSION de la page de titre, jamais sa mise en page fine :
     marges, distances, typographie, en-têtes et pieds appartiennent au modal
     « Mise en page visuelle » (et à l'onglet Export des paramètres), qui
     écrit dans le gabarit et les réglages centraux lus à l'identique par
     l'aperçu et par les exports.

     Source de vérité unique : le feuillet Front lui-même. Les champs
     ci-dessous LISENT ce fichier et y RÉÉCRIVENT — aucune copie locale, donc
     aucun état concurrent possible entre l'aperçu et l'export. */

  /** Feuillets Front pouvant servir de première page : les pages Front de
   * type « titre ». `compile: false` n'exclut pas de cette liste — un
   * feuillet exclu reste choisissable, c'est justement l'intérêt. */
  frontTitleCandidates(): TFile[] {
    const root = this.plugin.getProjectFolder();
    if (!root) return [];
    const out: TFile[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children || []) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md" && isFrontMatter(this.app, this.plugin.settings, child)) {
          const type = fmOf(this.app, child).type;
          if (typeof type === "string" && type.trim().toLowerCase() === "titre") out.push(child);
        }
      }
    };
    walk(root);
    return out;
  }

  /** État de la première page, lu à chaque rendu du panneau : le feuillet
   * retenu par la compilation est le premier Front « titre » non exclu —
   * exactement la règle qu'applique `compile()`. */
  private frontTitleState(): { files: TFile[]; selected: TFile | null; included: boolean } {
    const files = this.frontTitleCandidates();
    const included = files.find((file) => fmOf(this.app, file).compile !== false) || null;
    return { files, selected: included || files[0] || null, included: !!included };
  }

  /** Inclut ou exclut la page de titre. Le fichier Front et ses métadonnées
   * restent intacts : seul l'indicateur `compile` du frontmatter change,
   * celui-là même que lisent `compile()` et « Éléments inclus ». */
  private async setFirstPageIncluded(included: boolean): Promise<void> {
    const { selected } = this.frontTitleState();
    if (!selected) return;
    await this.app.fileManager?.processFrontMatter?.(selected, (data: Record<string, unknown>) => {
      data.compile = included;
    });
    await this.reloadFirstPageSection();
  }

  /** Choisit un autre feuillet Front. Les autres candidats sont exclus, pas
   * supprimés : revenir en arrière ne coûte qu'un second choix. */
  private async chooseFrontTitleFile(path: string): Promise<void> {
    for (const file of this.frontTitleCandidates()) {
      const wanted = file.path === path;
      if ((fmOf(this.app, file).compile !== false) === wanted) continue;
      await this.app.fileManager?.processFrontMatter?.(file, (data: Record<string, unknown>) => {
        data.compile = wanted;
      });
    }
    await this.reloadFirstPageSection();
  }

  /** Ouvre le feuillet Front dans l'éditeur, comme n'importe quel feuillet du
   * Binder — et le sélectionne au passage dans le Binder. */
  private async openFrontFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const leaf = this.plugin.getLeafForOpeningFile?.() || this.app.workspace.getLeaf(false);
    if (!leaf) return;
    await leaf.openFile(file, { active: true });
    if (file.parent) this.plugin.settings.binderSelectedPath = file.parent.path;
    await this.plugin.saveSettings?.();
  }

  /** Écrit un champ dans le feuillet Front puis réactualise l'aperçu. Le HTML
   * rendu n'est jamais retouché à la main : c'est le fichier qui change, et
   * le rendu qui en découle (zoom et position de lecture conservés par
   * refreshPreview, décidé par PreviewView). */
  private async setFirstPageField(path: string, role: string, value: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.cachedRead(file);
    const next = setTitleRoleValue(content, role, value);
    if (next !== content) await this.app.vault.modify(file, next);
    if (role === "titre") this.plugin.settings.manuscriptTitle = value.trim();
    if (role === "auteur") this.plugin.settings.manuscriptAuthor = value.trim();
    await this.plugin.saveSettings?.();
    await this.callbacks.refreshPreview();
  }

  /** Reconstruit le panneau ENTIER (les valeurs affichées viennent du
   * fichier) puis l'aperçu, sans toucher au zoom ni à la position de
   * lecture. Réservé aux actions qui justifient de tout redessiner —
   * ouverture du panneau, bouton « Actualiser » — jamais déclenché en
   * silence par un simple changement de champ : reconstruire le <details>
   * de la première page le refermerait et en chasserait le focus. */
  private async reload(): Promise<void> {
    /* Un échec pendant la reconstruction du panneau (lecture d'un fichier
       Front supprimé entre-temps, gabarit personnalisé invalide…) ne doit
       jamais faire disparaître le bouton « Actualiser » en silence : sans
       ce filet, une exception ici empêchait même l'appel à
       refreshPreview() qui suit — vu de l'utilisatrice, un clic qui ne fait
       plus jamais rien tant que l'onglet n'est pas rouvert. */
    try {
      await this.render();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(t("preview.notice.exportPanelError", { message: msg }));
      console.error("Feuillets : échec de renderExportPanel", e);
    }
    await this.callbacks.refreshPreview();
  }

  /** Réactualise SEULEMENT le contenu de « Première page », sans toucher au
   * reste du panneau ni recréer son <details> : l'inclusion/exclusion et le
   * choix d'un autre fichier Front ne doivent ni refermer la sous-section ni
   * faire sauter le focus ailleurs dans l'écran. Même filet qu'au-dessus. */
  private async reloadFirstPageSection(): Promise<void> {
    try {
      if (this.firstPageBodyEl) await this.renderFirstPageFields(this.firstPageBodyEl, this.firstPageTemplates);
      else await this.render();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(t("preview.notice.firstPageError", { message: msg }));
      console.error("Feuillets : échec de renderFirstPageFields", e);
    }
    await this.callbacks.refreshPreview();
  }

  private async renderFirstPageSection(panel: HTMLElement, templates: Array<{ key: string; label: string }>): Promise<void> {
    const details = panel.createEl("details", { cls: "feuillets-preview-export-details" });
    details.open = this.firstPageOpen;
    details.addEventListener("toggle", () => { this.firstPageOpen = details.open; });
    const summary = details.createEl("summary", { cls: "feuillets-preview-export-summary" });
    summary.createSpan({ text: t("preview.export.firstPage") });
    const body = details.createDiv({ cls: "feuillets-preview-export-details-body" });
    this.firstPageBodyEl = body;
    this.firstPageTemplates = templates;
    await this.renderFirstPageFields(body, templates);
  }

  /** Contenu de « Première page » — jamais le <details>/<summary> qui
   * l'enveloppe : appelée seule pour un rafraîchissement ciblé
   * (`reloadFirstPageSection`), ou depuis `renderFirstPageSection` lors
   * d'un rebuild complet du panneau. */
  private async renderFirstPageFields(body: HTMLElement, templates: Array<{ key: string; label: string }>): Promise<void> {
    body.empty();
    const { files, selected, included } = this.frontTitleState();

    const row1 = body.createDiv({ cls: "feuillets-preview-export-row feuillets-preview-export-row-1" });
    const row2 = body.createDiv({ cls: "feuillets-preview-export-row feuillets-preview-export-row-2" });

    const includeWrap = row1.createDiv({ cls: "feuillets-preview-export-field feuillets-preview-export-field-checkbox" });
    const includeRow = includeWrap.createEl("label", { cls: "feuillets-preview-export-inline-field" });
    const includeInput = includeRow.createEl("input", { type: "checkbox" });
    includeInput.checked = included;
    includeInput.setAttribute("aria-label", t("preview.export.includeTitlePage"));
    includeInput.addEventListener("change", () => void this.setFirstPageIncluded(includeInput.checked));
    includeRow.createSpan({ text: t("preview.export.includeTitlePage") });

    if (selected) {
      /* Un <div>, pas un <label> : le bouton « ouvrir » qui suit ne doit pas
         être avalé par le libellé (un clic dedans activerait la liste). */
      const fileWrap = row1.createDiv({ cls: "feuillets-preview-export-field feuillets-preview-export-field-front" });
      fileWrap.createSpan({ cls: "feuillets-preview-export-label", text: t("preview.export.frontFile") });
      const fileControls = fileWrap.createDiv({ cls: "feuillets-preview-export-file-controls" });
      const picker = fileControls.createEl("select", { cls: "feuillets-preview-export-control" });
      for (const file of files) picker.createEl("option", { value: file.path, text: file.basename });
      picker.value = selected.path;
      picker.setAttribute("aria-label", t("preview.export.usedFrontFile"));
      picker.addEventListener("change", () => void this.chooseFrontTitleFile(picker.value));
      this.iconBtn(fileControls, "pencil", t("preview.export.openFrontFile"), () => void this.openFrontFile(selected.path));

      const content = await this.app.vault.cachedRead(selected);
      for (const { label, role } of previewFirstPageFields()) {
        const isRow1 = role === "titre" || role === "sous-titre";
        const targetRow = isRow1 ? row1 : row2;

        const wrap = targetRow.createDiv({
          cls: `feuillets-preview-export-field feuillets-preview-export-field-${role}`,
        });
        wrap.createSpan({ cls: "feuillets-preview-export-label", text: label });
        const input = wrap.createEl("input", { type: "text", cls: "feuillets-preview-export-control" });
        input.value = readTitleRoleValue(content, role);
        input.setAttribute("aria-label", label);
        input.addEventListener("change", () => void this.setFirstPageField(selected.path, role, input.value));
      }
    } else {
      row2.createDiv({
        cls: "setting-item-description",
        text: t("preview.export.noTitleFrontFile"),
      });
    }

    /* Le réglage visuel n'est pas une seconde configuration : LayoutModal
     * modifie le même gabarit actif que le rendu et les exports, et c'est le
     * seul endroit où se règlent en-têtes, pieds, numéros de page, distances
     * aux bords et positionnement. */
    const visualLayout = body.createEl("button", { cls: "clickable-icon feuillets-preview-export-visual-btn" });
    const visualLeft = visualLayout.createDiv({ cls: "feuillets-preview-export-visual-left" });
    const iconSpan = visualLeft.createSpan({ cls: "feuillets-preview-export-visual-icon" });
    setIcon(iconSpan, "panel-top");
    visualLeft.createSpan({ text: t("preview.export.visualLayout") });

    const chevron = visualLayout.createSpan({ cls: "feuillets-preview-export-chevron" });
    setIcon(chevron, "chevron-right");
    visualLayout.setAttribute("aria-label", t("preview.export.adjustTitlePageLayout"));
    visualLayout.addEventListener("click", () => {
      // La valeur persistée est la référence : le panneau peut être en train
      // de se reconstruire après un changement de gabarit.
      const activeKey = this.plugin.settings.exportTemplate;
      const activeLabel = templates.find((item) => item.key === activeKey)?.label || activeKey;
      new LayoutModal(
        this.app,
        this.plugin as unknown as ConstructorParameters<typeof LayoutModal>[1],
        activeKey,
        activeLabel,
        () => { void this.callbacks.refreshPreview(); }
      ).open();
    });
  }

  private exportFileName(): string {
    return activePresetConfig(this.plugin.settings).fileName || `${t("preview.export.defaultFileName")}.md`;
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
