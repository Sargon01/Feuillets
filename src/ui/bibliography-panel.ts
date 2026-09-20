import { type App, type TFolder } from "obsidian";
import { t, getLocale } from "../i18n/index.js";
import { bibliographyEntriesForEditorialRoot, bibliographyReferenceCount } from "../services/bibliography-generator.js";
import type { OuvrageCompositionBinding } from "../services/ouvrage-composition.js";

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

/**
 * Sous-section « Bibliographie » (Phase 8) : la bibliographie FINALE de
 * l'ouvrage, assemblée depuis les fiches déjà présentes dans
 * Recherche → Bibliographie/Bibliography (services/bibliography-
 * generator.ts) — ni son contenu ni ses références ne sont modifiables ici,
 * seulement son inclusion.
 *
 * LOT 5B — SOURCE UNIQUE : l'inclusion vient de `binding.value.bibliography`
 * (services/ouvrage-composition.ts effectiveComposition()), jamais un
 * second calcul via `ProjectMeta` ici. Le décompte est résolu via la
 * fonction partagée unique bibliographyEntriesForEditorialRoot(), restreinte
 * à la zone Recherche propre de l'ouvrage (ou vide si absente, sans aucun
 * repli sur WARPI).
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
    private binding: OuvrageCompositionBinding,
    private callbacks: BibliographyPanelCallbacks = {},
    private editorialRoot?: TFolder | null
  ) {}

  includedState(): boolean {
    return this.binding.value.bibliography;
  }

  referenceCount(): number {
    return bibliographyReferenceCount(
      bibliographyEntriesForEditorialRoot(this.app, this.plugin.settings, this.editorialRoot, getLocale())
    );
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

  /** Bascule l'inclusion via le binding — jamais `ProjectMeta` directement. */
  private async setIncluded(included: boolean): Promise<void> {
    await this.binding.update({ bibliography: included });
    await this.callbacks.onPresentationChanged?.();
  }
}
