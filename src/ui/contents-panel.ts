import { type App, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";
import type { OuvrageCompositionBinding } from "../services/ouvrage-composition.js";

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

/**
 * Sous-sections « Sommaire » et « Table des matières » (Phase 6) : deux
 * éléments GÉNÉRÉS du modèle commun de composition
 * (services/book-composition.ts) — ce composant ne montre ni ne modifie
 * jamais leur contenu (calculé à la compilation, voir
 * services/contents-generator.ts et compile-export.ts), seulement leur
 * inclusion.
 *
 * LOT 5B — SOURCE UNIQUE : l'inclusion vient de `binding.value.summary`/
 * `.toc` (services/ouvrage-composition.ts effectiveComposition()), la
 * composition EFFECTIVE de la portée affichée (WARPI ou un ouvrage) —
 * jamais un second calcul via `ProjectMeta` ici. `binding.update()` écrit
 * au bon endroit (réglages globaux ou composition locale de l'ouvrage)
 * sans que ce panneau ait besoin de le savoir.
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
    private binding: OuvrageCompositionBinding,
    private callbacks: ContentsPanelCallbacks = {}
  ) {}

  includedState(id: "summary" | "toc"): boolean {
    return this.binding.value[id];
  }

  async render(): Promise<void> {
    const container = this.container;
    container.empty();
    this.renderSection(container, "summary", "contents.summary.sectionTitle", "contents.summary.include");
    this.renderSection(container, "toc", "contents.toc.sectionTitle", "contents.toc.include");
  }

  /** Affiche uniquement le Sommaire — utilisé par Composition → Avant → Sommaire. */
  async renderSummary(): Promise<void> {
    const container = this.container;
    container.empty();
    this.renderSection(container, "summary", "contents.summary.sectionTitle", "contents.summary.include");
  }

  /** Affiche uniquement la Table des matières — utilisé par Composition → Après → Table des matières. */
  async renderTableOfContents(): Promise<void> {
    const container = this.container;
    container.empty();
    this.renderSection(container, "toc", "contents.toc.sectionTitle", "contents.toc.include");
  }

  /** Une ligne latérale compacte par élément généré. */
  private renderSection(parent: HTMLElement, id: "summary" | "toc", titleKey: string, includeKey: string): void {
    const row = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row" });
    row.createSpan({ cls: "feuillets-properties-key", text: t(titleKey) });
    const control = row.createDiv({ cls: "feuillets-edition-row-control" });
    const input = control.createEl("input", { type: "checkbox" });
    input.checked = this.includedState(id);
    input.setAttribute("aria-label", t(includeKey));
    input.setAttribute("title", t("contents.generatedNote"));
    input.addEventListener("change", () => void this.setIncluded(id, input.checked));
  }

  /** Bascule l'inclusion via le binding — jamais `ProjectMeta` directement. */
  private async setIncluded(id: "summary" | "toc", included: boolean): Promise<void> {
    await this.binding.update({ [id]: included });
    await this.callbacks.onPresentationChanged?.();
  }
}
