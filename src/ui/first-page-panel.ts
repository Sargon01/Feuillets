import { Notice, TFile, TFolder, setIcon, setTooltip, type App, type WorkspaceLeaf } from "obsidian";
import { listExportTemplates } from "../services/export-templates-custom.js";
import { isFrontMatter } from "../services/folder-structure.js";
import { fmOf } from "../services/frontmatter.js";
import { readTitleRoleValue, setTitleRoleValue } from "../utils/title-roles.js";
import { t } from "../i18n/index.js";
import { LayoutModal } from "./layout-modal.js";

/** Champs de la première page réellement pris en charge, dans l'ordre où ils
 * apparaissent sur la page. Chacun est un RÔLE du feuillet Front (voir
 * utils/title-roles.ts) : aucun champ n'a de stockage propre à ce panneau.
 * Déplacé depuis ui/export-panel.ts (Phase 3) : Première page n'appartient
 * plus au panneau Export. */
export function previewFirstPageFields(): Array<{ label: string; role: string }> {
  return [
    { label: t("preview.firstPageField.title"), role: "titre" },
    { label: t("preview.firstPageField.subtitle"), role: "sous-titre" },
    { label: t("preview.firstPageField.author"), role: "auteur" },
    { label: t("preview.firstPageField.additionalMention"), role: "mots" },
    { label: t("preview.firstPageField.imageOrLogo"), role: "image" },
  ];
}

type FirstPagePanelSettings = FeuilletsSettings & {
  exportTemplate: string;
  manuscriptTitle?: string;
  manuscriptAuthor?: string;
};

/** Sous-ensemble de plugin réellement utilisé par ce composant : ni
 * PreviewView ni ExportPanel ne sont importés — Composition de l'ouvrage
 * (Édition) et l'Aperçu peuvent tous deux le monter sans dépendre l'un de
 * l'autre. */
export type FirstPagePanelPlugin = {
  settings: FirstPagePanelSettings;
  getProjectFolder(): TFolder | null;
  getLeafForOpeningFile?(): WorkspaceLeaf;
  saveSettings?(): Promise<void>;
};

export type FirstPagePanelCallbacks = {
  /** Appelé après tout changement susceptible d'influencer une PRÉSENTATION
   * déjà affichée ailleurs (gabarit, champs de première page, LayoutModal…)
   * — facultatif : le composant fonctionne parfaitement sans lui, y compris
   * lorsqu'aucune PreviewView n'existe (Composition, dans Édition). */
  onPresentationChanged?: () => Promise<void> | void;
};

/** Feuillets Front pouvant servir de première page : les pages Front de type
 * « titre ». `compile: false` n'exclut pas de cette liste — un feuillet
 * exclu reste choisissable, c'est justement l'intérêt.
 *
 * Fonction libre (pas une méthode) : PreviewView en a un vrai besoin
 * d'exécution (décider si une page de titre générique doit être ajoutée au
 * rendu, voir preview-view.ts) indépendant de tout FirstPagePanel monté —
 * elle l'appelle directement plutôt que de dépendre d'une instance. */
export function frontTitleCandidates(app: App, plugin: FirstPagePanelPlugin): TFile[] {
  const root = plugin.getProjectFolder();
  if (!root) return [];
  const out: TFile[] = [];
  const walk = (folder: TFolder): void => {
    for (const child of folder.children || []) {
      if (child instanceof TFolder) walk(child);
      else if (child instanceof TFile && child.extension === "md" && isFrontMatter(app, plugin.settings, child)) {
        const type = fmOf(app, child).type;
        if (typeof type === "string" && type.trim().toLowerCase() === "titre") out.push(child);
      }
    }
  };
  walk(root);
  return out;
}

/**
 * Sous-section « Première page » (Phase 3) : CONTENU et INCLUSION de la
 * page de titre, jamais sa mise en page fine — marges, distances,
 * typographie, en-têtes et pieds appartiennent au modal « Mise en page
 * visuelle » (et à l'onglet Export des paramètres), qui écrit dans le
 * gabarit et les réglages centraux lus à l'identique par l'aperçu et les
 * exports.
 *
 * Source de vérité unique : le feuillet Front lui-même. Les champs
 * ci-dessous LISENT ce fichier et y RÉÉCRIVENT — aucune copie locale, donc
 * aucun état concurrent possible entre l'Édition, l'aperçu et l'export.
 *
 * Extrait mécaniquement de ExportPanel (Phase 3) : même DOM (à l'exception
 * du wrapper, renommé hors du vocabulaire « preview-export », voir
 * styles.css), mêmes classes de contrôle, même comportement — seul
 * l'emplacement du code change. Monté aussi bien par EditionCompositionView
 * (Édition → Composition de l'ouvrage, sans callback) que par tout futur
 * consommateur qui voudrait informer une présentation déjà affichée
 * (callback facultatif).
 */
export class FirstPagePanel {
  private bodyEl: HTMLElement | null = null;
  private templates: Array<{ key: string; label: string }> = [];
  private isOpen = false;

  constructor(
    private app: App,
    private plugin: FirstPagePanelPlugin,
    private container: HTMLElement,
    private callbacks: FirstPagePanelCallbacks = {}
  ) {}

  frontTitleCandidates(): TFile[] {
    return frontTitleCandidates(this.app, this.plugin);
  }

  /** État de la première page, lu à chaque rendu : le feuillet retenu par la
   * compilation est le premier Front « titre » non exclu — exactement la
   * règle qu'applique `compile()`. */
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
    await this.reloadFields();
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
    await this.reloadFields();
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

  /** Écrit un champ dans le feuillet Front puis avertit l'éventuel appelant.
   * Le HTML rendu n'est jamais retouché à la main : c'est le fichier qui
   * change, et le rendu qui en découle. */
  private async setFirstPageField(path: string, role: string, value: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.cachedRead(file);
    const next = setTitleRoleValue(content, role, value);
    if (next !== content) await this.app.vault.modify(file, next);
    if (role === "titre") this.plugin.settings.manuscriptTitle = value.trim();
    if (role === "auteur") this.plugin.settings.manuscriptAuthor = value.trim();
    await this.plugin.saveSettings?.();
    await this.callbacks.onPresentationChanged?.();
  }

  /** Reconstruit tout le composant (les valeurs affichées viennent du
   * fichier). Réservé à un rafraîchissement explicite de l'appelant — jamais
   * déclenché en silence par un simple changement de champ : reconstruire le
   * <details> le refermerait et en chasserait le focus. */
  async render(): Promise<void> {
    const container = this.container;
    container.empty();
    const templates = await listExportTemplates(this.app, this.plugin.settings);
    this.templates = templates;

    const details = container.createEl("details", { cls: "feuillets-first-page" });
    details.open = this.isOpen;
    details.addEventListener("toggle", () => { this.isOpen = details.open; });
    const summary = details.createEl("summary", { cls: "feuillets-first-page-summary" });
    summary.createSpan({ text: t("preview.export.firstPage") });
    const body = details.createDiv({ cls: "feuillets-first-page-body" });
    this.bodyEl = body;
    await this.renderFields(body, templates);
  }

  /** Réactualise SEULEMENT le contenu, sans toucher au <details> qui
   * l'enveloppe : l'inclusion/exclusion et le choix d'un autre fichier Front
   * ne doivent ni refermer la sous-section ni faire sauter le focus. */
  private async reloadFields(): Promise<void> {
    try {
      if (this.bodyEl) await this.renderFields(this.bodyEl, this.templates);
      else await this.render();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(t("preview.notice.firstPageError", { message: msg }));
      console.error("Feuillets : échec de FirstPagePanel.renderFields", e);
    }
    await this.callbacks.onPresentationChanged?.();
  }

  /** Contenu de « Première page » — jamais le <details>/<summary> qui
   * l'enveloppe : appelée seule pour un rafraîchissement ciblé
   * (`reloadFields`), ou depuis `render` lors d'une reconstruction complète.
   * Réutilise les classes de contrôle génériques du panneau Export
   * (`.feuillets-preview-export-control` etc.) : mêmes petits champs
   * compacts partout dans le plugin, sans dupliquer leur CSS — voir
   * styles.css pour le réglage de compacité propre à ce composant. */
  private async renderFields(body: HTMLElement, templates: Array<{ key: string; label: string }>): Promise<void> {
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
      // La valeur persistée est la référence : le composant peut être en
      // train de se reconstruire après un changement de gabarit.
      const activeKey = this.plugin.settings.exportTemplate;
      const activeLabel = templates.find((item) => item.key === activeKey)?.label || activeKey;
      new LayoutModal(
        this.app,
        this.plugin as unknown as ConstructorParameters<typeof LayoutModal>[1],
        activeKey,
        activeLabel,
        () => { void this.callbacks.onPresentationChanged?.(); }
      ).open();
    });
  }

  /* ========================== Bouton-icône ========================== */

  /** Bouton-icône, calqué sur BaseFeuilletsView.iconBtn / ExportPanel.iconBtn
   * : même classe `clickable-icon`, mêmes icônes Lucide. Le style (taille,
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
