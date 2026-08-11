import { type App, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import { BIBLIOGRAPHY, defaultComposition, readGeneratedIncluded, writeGeneratedIncluded } from "../services/book-composition.js";
import { bibliographyEntries, bibliographyReferenceCount } from "../services/bibliography-generator.js";

/** Sous-ensemble de plugin réellement utilisé par ce composant — même
 * contrat que TablesPanelPlugin (ui/tables-panel.ts) : ni PreviewView ni
 * ExportPanel ne sont importés. */
export type BibliographyPanelPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  saveSettings?(): Promise<void>;
};

export type BibliographyPanelCallbacks = {
  /** Appelé après toute bascule d'inclusion — facultatif, comme les autres
   * sous-sections de Composition : fonctionne parfaitement sans lui, y
   * compris sans PreviewView. */
  onPresentationChanged?: () => Promise<void> | void;
};

const DEFAULT_INCLUDED = defaultComposition().find((item) => item.id === BIBLIOGRAPHY)?.included ?? false;

/** Métadonnées du projet courant, créées si absentes — même mécanisme que
 * TablesPanel.currentProjectMeta : un seul conteneur par projet
 * (`settings.projectMeta`), jamais un second système de réglages. Retourne
 * `null` sans projet actif. */
function currentProjectMeta(plugin: BibliographyPanelPlugin): ProjectMeta | null {
  const folder = plugin.getProjectFolder();
  if (!folder) return null;
  if (!plugin.settings.projectMeta) plugin.settings.projectMeta = {};
  const meta = plugin.settings.projectMeta[folder.path] || {};
  plugin.settings.projectMeta[folder.path] = meta;
  return meta;
}

/**
 * Sous-section « Bibliographie » (Phase 8) : la bibliographie FINALE de
 * l'ouvrage, assemblée depuis les fiches déjà présentes dans
 * Recherche → Bibliographie/Bibliography (services/bibliography-
 * generator.ts) — ni son contenu ni ses références ne sont modifiables ici,
 * seulement son inclusion, persistée dans `ProjectMeta` via
 * `writeGeneratedIncluded` sous l'identifiant `bibliography` du modèle
 * commun de composition (services/book-composition.ts). Les fiches
 * elles-mêmes continuent d'être éditées dans Recherche — aucun second
 * système bibliographique, aucun nouveau fichier source.
 *
 * Même contrat que FirstPagePanel/FrontMatterPanel/ContentsPanel/
 * TablesPanel : callback `onPresentationChanged` facultatif, fonctionne
 * parfaitement sans PreviewView.
 */
export class BibliographyPanel {
  constructor(
    private app: App,
    private plugin: BibliographyPanelPlugin,
    private container: HTMLElement,
    private callbacks: BibliographyPanelCallbacks = {}
  ) {}

  includedState(): boolean {
    const meta = currentProjectMeta(this.plugin);
    const stored = meta ? readGeneratedIncluded(meta, BIBLIOGRAPHY) : undefined;
    return stored ?? DEFAULT_INCLUDED;
  }

  referenceCount(): number {
    return bibliographyReferenceCount(bibliographyEntries(this.app, this.plugin.settings));
  }

  /** Une ligne latérale compacte : nom, décompte et inclusion. */
  async render(): Promise<void> {
    const container = this.container;
    container.empty();

    const row = container.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: t("bibliography.sectionTitle") });
    const control = row.createDiv({ cls: "feuillets-edition-row-control" });
    control.createSpan({ cls: "feuillets-edition-count", text: t("bibliography.referenceCount", { count: String(this.referenceCount()) }) });
    const input = control.createEl("input", { type: "checkbox" });
    input.checked = this.includedState();
    input.setAttribute("aria-label", t("bibliography.include"));
    input.addEventListener("change", () => void this.setIncluded(input.checked));
  }

  /** Bascule l'inclusion — écrit immédiatement dans `ProjectMeta`, sans
   * jamais toucher aux fiches de Recherche (source, jamais copiée). */
  private async setIncluded(included: boolean): Promise<void> {
    const meta = currentProjectMeta(this.plugin);
    if (meta) writeGeneratedIncluded(meta, BIBLIOGRAPHY, included);
    await this.plugin.saveSettings?.();
    await this.callbacks.onPresentationChanged?.();
  }
}
