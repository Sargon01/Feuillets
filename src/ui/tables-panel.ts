import { type App, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import { TABLES, defaultComposition, readGeneratedIncluded, writeGeneratedIncluded } from "../services/book-composition.js";

/** Sous-ensemble de plugin réellement utilisé par ce composant — même
 * contrat que ContentsPanelPlugin (ui/contents-panel.ts) : ni PreviewView
 * ni ExportPanel ne sont importés. */
export type TablesPanelPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  saveSettings?(): Promise<void>;
};

export type TablesPanelCallbacks = {
  /** Appelé après toute bascule d'inclusion — facultatif, comme les autres
   * sous-sections de Composition : fonctionne parfaitement sans lui, y
   * compris sans PreviewView. */
  onPresentationChanged?: () => Promise<void> | void;
};

const DEFAULT_INCLUDED = defaultComposition().find((item) => item.id === TABLES)?.included ?? false;

/** Métadonnées du projet courant, créées si absentes — même mécanisme que
 * ContentsPanel.currentProjectMeta : un seul conteneur par projet
 * (`settings.projectMeta`), jamais un second système de réglages. Retourne
 * `null` sans projet actif. */
function currentProjectMeta(plugin: TablesPanelPlugin): ProjectMeta | null {
  const folder = plugin.getProjectFolder();
  if (!folder) return null;
  if (!plugin.settings.projectMeta) plugin.settings.projectMeta = {};
  const meta = plugin.settings.projectMeta[folder.path] || {};
  plugin.settings.projectMeta[folder.path] = meta;
  return meta;
}

/**
 * Sous-section « Tables » (Phase 7) : aujourd'hui un seul élément généré,
 * la Table des illustrations (services/tables-generator.ts) — ni son
 * contenu ni sa légende ne sont modifiables ici, seulement son inclusion,
 * persistée dans `ProjectMeta` via `writeGeneratedIncluded` sous le même
 * identifiant `tables` que le modèle commun de composition (services/
 * book-composition.ts). D'autres tables (tableaux, figures séparées…)
 * pourront rejoindre cette même sous-section plus tard, sans changer son
 * inclusion — une seule case pour tout « Tables », comme demandé.
 *
 * Même contrat que FirstPagePanel/FrontMatterPanel/ContentsPanel : callback
 * `onPresentationChanged` facultatif, fonctionne parfaitement sans
 * PreviewView.
 */
export class TablesPanel {
  constructor(
    private app: App,
    private plugin: TablesPanelPlugin,
    private container: HTMLElement,
    private callbacks: TablesPanelCallbacks = {}
  ) {}

  includedState(): boolean {
    const meta = currentProjectMeta(this.plugin);
    const stored = meta ? readGeneratedIncluded(meta, TABLES) : undefined;
    return stored ?? DEFAULT_INCLUDED;
  }

  /** Une ligne latérale compacte pour les tables générées. */
  async render(): Promise<void> {
    const container = this.container;
    container.empty();

    const row = container.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: t("tables.sectionTitle") });
    const control = row.createDiv({ cls: "feuillets-edition-row-control" });
    const input = control.createEl("input", { type: "checkbox" });
    input.checked = this.includedState();
    input.setAttribute("aria-label", t("tables.include"));
    input.setAttribute("title", t("tables.illustrationsLabel"));
    input.addEventListener("change", () => void this.setIncluded(input.checked));
  }

  /** Bascule l'inclusion — écrit immédiatement dans `ProjectMeta`, sans
   * jamais toucher au contenu (généré, jamais stocké). */
  private async setIncluded(included: boolean): Promise<void> {
    const meta = currentProjectMeta(this.plugin);
    if (meta) writeGeneratedIncluded(meta, TABLES, included);
    await this.plugin.saveSettings?.();
    await this.callbacks.onPresentationChanged?.();
  }
}
