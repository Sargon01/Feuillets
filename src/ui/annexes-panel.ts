import { Notice, setIcon, setTooltip, TFile, TFolder, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { ANNEXES, defaultComposition, readGeneratedIncluded, writeGeneratedIncluded } from "../services/book-composition.js";
import { annexesFolder, annexesFiles } from "../services/compile-export.js";
import { ensureFolder } from "../services/project-files.js";

/** Sous-ensemble de plugin réellement utilisé par ce composant — même
 * contrat que BibliographyPanelPlugin (ui/bibliography-panel.ts) : ni
 * PreviewView ni ExportPanel ne sont importés. */
export type AnnexesPanelPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  saveSettings?(): Promise<void>;
};

export type AnnexesPanelCallbacks = {
  /** Appelé après toute bascule d'inclusion ou création du dossier —
   * facultatif, comme les autres sous-sections de Composition : fonctionne
   * parfaitement sans lui, y compris sans PreviewView. */
  onPresentationChanged?: () => Promise<void> | void;
};

const DEFAULT_INCLUDED = defaultComposition().find((item) => item.id === ANNEXES)?.included ?? false;

/** Métadonnées du projet courant, créées si absentes — même mécanisme que
 * BibliographyPanel.currentProjectMeta : un seul conteneur par projet
 * (`settings.projectMeta`), jamais un second système de réglages. Retourne
 * `null` sans projet actif. */
function currentProjectMeta(plugin: AnnexesPanelPlugin): ProjectMeta | null {
  const folder = plugin.getProjectFolder();
  if (!folder) return null;
  if (!plugin.settings.projectMeta) plugin.settings.projectMeta = {};
  const meta = plugin.settings.projectMeta[folder.path] || {};
  plugin.settings.projectMeta[folder.path] = meta;
  return meta;
}

/** Sous-ensemble de l'explorateur de fichiers natif réellement utilisé ici
 * — même patron que revealInFileExplorer (views/edition-docs-view.ts),
 * dupliqué plutôt que partagé (convention du dépôt), et retypé pour un
 * TFolder plutôt qu'un TFile : « Ouvrir le dossier » sélectionne le dossier
 * Annexes lui-même dans l'explorateur natif, pas un de ses fichiers. */
type FileExplorerInstance = { revealInFolder?(node: TFolder): void };
type AppWithInternalPlugins = App & {
  internalPlugins?: { getPluginById?(id: string): { instance?: FileExplorerInstance } | undefined };
};
function revealFolderInFileExplorer(app: App, folder: TFolder): boolean {
  const instance = (app as AppWithInternalPlugins).internalPlugins?.getPluginById?.("file-explorer")?.instance;
  if (!instance?.revealInFolder) return false;
  instance.revealInFolder(folder);
  return true;
}

/**
 * Sous-section « Annexes » (Phase 9) : de VRAIS fichiers Markdown, sous
 * Manuscrit/Annexes (ou Manuscrit/Appendices), édités normalement dans le
 * Binder — ce composant ne montre ni ne modifie leur contenu, seulement
 * leur inclusion globale (persistée dans `ProjectMeta` via
 * `writeGeneratedIncluded`, même système que summary/toc/tables/
 * bibliography) et, en confort, un raccourci pour ouvrir ou créer le
 * dossier. `compile: false` sur un fichier individuel reste respecté à la
 * compilation (services/compile-export.ts), sans réglage propre ici.
 *
 * Même contrat que les autres sous-sections de Composition : callback
 * `onPresentationChanged` facultatif, fonctionne parfaitement sans
 * PreviewView.
 */
export class AnnexesPanel {
  constructor(
    private app: App,
    private plugin: AnnexesPanelPlugin,
    private container: HTMLElement,
    private callbacks: AnnexesPanelCallbacks = {}
  ) {}

  includedState(): boolean {
    const meta = currentProjectMeta(this.plugin);
    const stored = meta ? readGeneratedIncluded(meta, ANNEXES) : undefined;
    return stored ?? DEFAULT_INCLUDED;
  }

  private folder(): TFolder | null {
    return annexesFolder(this.app, this.plugin.getProjectFolder());
  }

  fileCount(): number {
    return annexesFiles(this.app, this.plugin.settings, this.plugin.getProjectFolder()).length;
  }

  /** Une ligne latérale compacte : nom, décompte, inclusion et dossier. */
  async render(): Promise<void> {
    const container = this.container;
    container.empty();

    const folder = this.folder();
    const count = folder
      ? t("annexes.count", { count: String(this.fileCount()) })
      : t("annexes.empty");

    const row = container.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: t("annexes.sectionTitle") });
    const control = row.createDiv({ cls: "feuillets-edition-row-control" });
    control.createSpan({ cls: "feuillets-edition-count", text: count });
    const input = control.createEl("input", { type: "checkbox" });
    input.checked = this.includedState();
    input.setAttribute("aria-label", t("annexes.include"));
    input.addEventListener("change", () => void this.setIncluded(input.checked));

    const label = folder ? t("annexes.openFolder") : t("annexes.createFolder");
    const button = control.createEl("button", { cls: "clickable-icon" });
    setIcon(button, folder ? "folder-open" : "folder-plus");
    setTooltip(button, label);
    button.setAttribute("aria-label", label);
    button.addEventListener("click", () => {
      if (folder) {
        if (!revealFolderInFileExplorer(this.app, folder)) new Notice(t("annexes.openFolder"));
      } else void this.createFolder();
    });
  }

  /** Crée UNIQUEMENT `<Manuscrit>/Annexes` — aucun fichier à l'intérieur. */
  private async createFolder(): Promise<void> {
    const root = this.plugin.getProjectFolder();
    if (!root) return;
    await ensureFolder(this.app, `${root.path}/Annexes`);
    new Notice(t("annexes.folderCreated"));
    await this.render();
    await this.callbacks.onPresentationChanged?.();
  }

  /** Bascule l'inclusion — écrit immédiatement dans `ProjectMeta`, sans
   * jamais toucher aux fichiers d'Annexes (édités dans le Binder). */
  private async setIncluded(included: boolean): Promise<void> {
    const meta = currentProjectMeta(this.plugin);
    if (meta) writeGeneratedIncluded(meta, ANNEXES, included);
    await this.plugin.saveSettings?.();
    await this.callbacks.onPresentationChanged?.();
  }
}
