import { TFile, TFolder, setIcon, setTooltip, type App, type WorkspaceLeaf } from "obsidian";
import { FRONT_FOLDER_NAME, getOrderedChildren } from "../services/folder-structure.js";
import { fmOf } from "../services/frontmatter.js";
import { t } from "../i18n/index.js";

/** Sous-ensemble de plugin réellement utilisé par ce composant — même
 * contrat que FirstPagePanelPlugin (ui/first-page-panel.ts) : ni PreviewView
 * ni ExportPanel ne sont importés. */
export type FrontMatterPanelPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  getLeafForOpeningFile?(): WorkspaceLeaf;
  saveSettings?(): Promise<void>;
};

export type FrontMatterPanelCallbacks = {
  /** Appelé après toute inclusion/exclusion — facultatif, comme
   * FirstPagePanel : le composant fonctionne parfaitement sans lui, y
   * compris lorsqu'aucune PreviewView n'existe. */
  onPresentationChanged?: () => Promise<void> | void;
};

/** Dossier Front du projet, s'il existe — même emplacement que celui que
 * lisent isFrontMatter()/FirstPagePanel (services/folder-structure.ts). */
function frontFolder(app: App, plugin: FrontMatterPanelPlugin): TFolder | null {
  const root = plugin.getProjectFolder();
  if (!root) return null;
  const path = `${root.path}/${FRONT_FOLDER_NAME}`;
  const folder = app.vault.getAbstractFileByPath(path);
  return folder instanceof TFolder ? folder : null;
}

/** Pages liminaires : tous les feuillets Markdown du dossier Front, DANS
 * L'ORDRE DU PROJET — `getOrderedChildren()` (services/folder-structure.ts),
 * le même service que le Binder et la compilation, aucun second système
 * d'ordre — à l'exclusion du feuillet `type: titre`, déjà géré par
 * FirstPagePanel (Première page).
 *
 * Fonction libre, pas une méthode : comme `frontTitleCandidates`
 * (ui/first-page-panel.ts), un futur appelant qui n'a pas besoin de
 * monter le panneau (ex. compilation, décompte) peut l'utiliser sans
 * instancier FrontMatterPanel. */
export function frontMatterPages(app: App, plugin: FrontMatterPanelPlugin): TFile[] {
  const folder = frontFolder(app, plugin);
  if (!folder) return [];
  const out: TFile[] = [];
  for (const child of getOrderedChildren(app, plugin.settings, folder)) {
    if (!(child instanceof TFile) || child.extension !== "md") continue;
    const type = fmOf(app, child).type;
    if (typeof type === "string" && type.trim().toLowerCase() === "titre") continue;
    out.push(child);
  }
  return out;
}

/** Titre affiché d'une page liminaire : le `title` du frontmatter s'il
 * existe, sinon le nom de fichier — jamais un second champ de titre
 * propre à ce composant. */
function displayTitle(app: App, file: TFile): string {
  const title = fmOf(app, file).title;
  return typeof title === "string" && title.trim() ? title.trim() : file.basename;
}

/**
 * Sous-section « Pages liminaires » (Phase 5) : liste les feuillets Front
 * autres que la page de titre, dans l'ordre du projet. `compile` dans le
 * frontmatter de chaque feuillet reste l'unique source de vérité pour son
 * inclusion/exclusion — exactement l'indicateur que lisent déjà `compile()`
 * et « Éléments inclus » (ExportPanel). Ce composant ne fait qu'AFFICHER et
 * BASCULER cet indicateur ; il ne crée, ne renomme ni ne réordonne aucun
 * fichier — aucun second système d'ordre.
 *
 * Même contrat que FirstPagePanel : callback `onPresentationChanged`
 * facultatif, fonctionne parfaitement sans PreviewView.
 */
export class FrontMatterPanel {
  private bodyEl: HTMLElement | null = null;
  private expanded = false;

  constructor(
    private app: App,
    private plugin: FrontMatterPanelPlugin,
    private container: HTMLElement,
    private callbacks: FrontMatterPanelCallbacks = {}
  ) {}

  pages(): TFile[] {
    return frontMatterPages(this.app, this.plugin);
  }

  async render(): Promise<void> {
    const container = this.container;
    container.empty();

    const head = container.createDiv({ cls: "feuillets-project-row feuillets-edition-action-row" });
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("aria-expanded", String(this.expanded));
    head.createSpan({ cls: "feuillets-project-row-label", text: t("frontMatter.sectionTitle") });
    const actions = head.createDiv({ cls: "feuillets-project-row-actions" });
    const toggleExpanded = async () => { this.expanded = !this.expanded; await this.render(); };
    head.addEventListener("click", () => void toggleExpanded());
    head.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void toggleExpanded(); }
    });
    const toggle = this.iconButton(actions, this.expanded ? "chevron-down" : "chevron-right", t("frontMatter.sectionTitle"));
    toggle.setAttribute("aria-expanded", String(this.expanded));
    toggle.addEventListener("click", (event) => { event.stopPropagation?.(); void toggleExpanded(); });

    const body = container.createDiv({ cls: "feuillets-front-matter-body" });
    this.bodyEl = body;
    if (this.expanded) this.renderList(body);
  }

  /** Réactualise SEULEMENT la liste, sans toucher au <details> qui
   * l'enveloppe : basculer une inclusion ne doit ni refermer la
   * sous-section ni faire sauter le focus ailleurs dans l'écran — même
   * règle que FirstPagePanel.reloadFields(). */
  private async reloadList(): Promise<void> {
    if (this.bodyEl) this.renderList(this.bodyEl);
    else await this.render();
    await this.callbacks.onPresentationChanged?.();
  }

  private renderList(body: HTMLElement): void {
    body.empty();
    const pages = this.pages();

    if (!pages.length) {
      body.createDiv({ cls: "feuillets-edition-empty", text: t("frontMatter.empty") });
      return;
    }

    for (const file of pages) {
      const title = displayTitle(this.app, file);
      const row = body.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
      row.createSpan({ cls: "feuillets-properties-key", text: title });
      const control = row.createDiv({ cls: "feuillets-edition-row-control" });
      const includeInput = control.createEl("input", { type: "checkbox" });
      includeInput.checked = fmOf(this.app, file).compile !== false;
      includeInput.setAttribute("aria-label", t("frontMatter.includePage", { title }));
      includeInput.addEventListener("change", () => void this.setIncluded(file, includeInput.checked));
      const open = this.iconButton(control, "pencil", t("frontMatter.openFile", { title }));
      open.addEventListener("click", () => void this.openFile(file));
    }
  }

  /** Bascule `compile` dans le frontmatter du feuillet — même mécanisme que
   * `compile()` et « Éléments inclus » : rien d'autre dans le fichier ne
   * change. */
  private async setIncluded(file: TFile, included: boolean): Promise<void> {
    await this.app.fileManager?.processFrontMatter?.(file, (data: Record<string, unknown>) => {
      data.compile = included;
    });
    await this.reloadList();
  }

  /** Ouvre le feuillet dans l'éditeur, comme n'importe quel feuillet du
   * Binder — et le sélectionne au passage dans le Binder (même geste que
   * FirstPagePanel.openFrontFile). */
  private async openFile(file: TFile): Promise<void> {
    const leaf = this.plugin.getLeafForOpeningFile?.() || this.app.workspace.getLeaf(false);
    if (!leaf) return;
    await leaf.openFile(file, { active: true });
    if (file.parent) this.plugin.settings.binderSelectedPath = file.parent.path;
    await this.plugin.saveSettings?.();
  }

  private iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(button, icon);
    setTooltip(button, label);
    button.setAttribute("aria-label", label);
    return button;
  }

}
