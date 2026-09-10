import { type App, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import type { OuvrageCompositionBinding } from "../services/ouvrage-composition.js";

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

/**
 * Sous-section « Tables » (Phase 7) : aujourd'hui un seul élément généré,
 * la Table des illustrations (services/tables-generator.ts) — ni son
 * contenu ni sa légende ne sont modifiables ici, seulement son inclusion.
 *
 * LOT 5B — SOURCE UNIQUE : l'inclusion vient de `binding.value.tables`
 * (services/ouvrage-composition.ts effectiveComposition()), jamais un
 * second calcul via `ProjectMeta` ici.
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
    private binding: OuvrageCompositionBinding,
    private callbacks: TablesPanelCallbacks = {}
  ) {}

  includedState(): boolean {
    return this.binding.value.tables;
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

  /** Bascule l'inclusion via le binding — jamais `ProjectMeta` directement. */
  private async setIncluded(included: boolean): Promise<void> {
    await this.binding.update({ tables: included });
    await this.callbacks.onPresentationChanged?.();
  }
}
