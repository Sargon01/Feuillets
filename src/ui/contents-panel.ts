import { type App, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import { SUMMARY, TOC, defaultComposition, readGeneratedIncluded, writeGeneratedIncluded } from "../services/book-composition.js";

/** Sous-ensemble de plugin réellement utilisé par ce composant — même
 * contrat que FirstPagePanelPlugin/FrontMatterPanelPlugin : ni PreviewView
 * ni ExportPanel ne sont importés. */
export type ContentsPanelPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  saveSettings?(): Promise<void>;
};

export type ContentsPanelCallbacks = {
  /** Appelé après toute bascule d'inclusion — facultatif, comme
   * FirstPagePanel/FrontMatterPanel : fonctionne parfaitement sans lui, y
   * compris sans PreviewView. */
  onPresentationChanged?: () => Promise<void> | void;
};

const DEFAULT_INCLUDED: Record<string, boolean> = Object.fromEntries(
  defaultComposition().map((item) => [item.id, item.included])
);

/** Métadonnées du projet courant, créées si absentes — même conteneur par
 * projet que le reste de `settings.projectMeta` (voir project-modals.ts) :
 * jamais un second système de réglages. Retourne `null` sans projet actif. */
function currentProjectMeta(plugin: ContentsPanelPlugin): ProjectMeta | null {
  const folder = plugin.getProjectFolder();
  if (!folder) return null;
  if (!plugin.settings.projectMeta) plugin.settings.projectMeta = {};
  const meta = plugin.settings.projectMeta[folder.path] || {};
  plugin.settings.projectMeta[folder.path] = meta;
  return meta;
}

/**
 * Sous-sections « Sommaire » et « Table des matières » (Phase 6) : deux
 * éléments GÉNÉRÉS du modèle commun de composition
 * (services/book-composition.ts) — ce composant ne montre ni ne modifie
 * jamais leur contenu (calculé à la compilation, voir
 * services/contents-generator.ts et compile-export.ts), seulement leur
 * inclusion, persistée dans `ProjectMeta` via `writeGeneratedIncluded`.
 *
 * Même contrat que FirstPagePanel/FrontMatterPanel : callback
 * `onPresentationChanged` facultatif, fonctionne parfaitement sans
 * PreviewView.
 */
export class ContentsPanel {
  constructor(
    private app: App,
    private plugin: ContentsPanelPlugin,
    private container: HTMLElement,
    private callbacks: ContentsPanelCallbacks = {}
  ) {}

  includedState(id: string): boolean {
    const meta = currentProjectMeta(this.plugin);
    const stored = meta ? readGeneratedIncluded(meta, id) : undefined;
    return stored ?? DEFAULT_INCLUDED[id] ?? false;
  }

  async render(): Promise<void> {
    const container = this.container;
    container.empty();
    this.renderSection(container, SUMMARY, "contents.summary.sectionTitle", "contents.summary.include");
    this.renderSection(container, TOC, "contents.toc.sectionTitle", "contents.toc.include");
  }

  /** Une ligne latérale compacte par élément généré. */
  private renderSection(parent: HTMLElement, id: string, titleKey: string, includeKey: string): void {
    const row = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: t(titleKey) });
    const control = row.createDiv({ cls: "feuillets-edition-row-control" });
    const input = control.createEl("input", { type: "checkbox" });
    input.checked = this.includedState(id);
    input.setAttribute("aria-label", t(includeKey));
    input.setAttribute("title", t("contents.generatedNote"));
    input.addEventListener("change", () => void this.setIncluded(id, input.checked));
  }

  /** Bascule l'inclusion — écrit immédiatement dans `ProjectMeta`, sans
   * jamais toucher au contenu (généré, jamais stocké). */
  private async setIncluded(id: string, included: boolean): Promise<void> {
    const meta = currentProjectMeta(this.plugin);
    if (meta) writeGeneratedIncluded(meta, id, included);
    await this.plugin.saveSettings?.();
    await this.callbacks.onPresentationChanged?.();
  }
}
