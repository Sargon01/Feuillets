import type { App, TFile } from "obsidian";

type CanvasView = { file?: TFile | null; containerEl?: HTMLElement; contentEl?: HTMLElement; canvas?: unknown };
type LeafWithHeader = { view?: CanvasView; tabHeaderEl?: HTMLElement };
export type CarnetLifecycle = { refresh: () => void; cleanup: () => void };

/** Résout le titre visible à appliquer pour ce fichier Canvas — `null`
 * quand ce n'est pas un Carnet Feuillets reconnu (titre Obsidian intact). */
export type CarnetTitleResolver = (file: TFile | null | undefined) => string | null;

/** §12 du correctif Mindmap : décorations propres aux blocs Mindmap
 * (marqueurs de membre/racine, visibilité repli/dépli) — appliquées dans le
 * MÊME passage `refresh()` que le marqueur Carnet et le titre, jamais un
 * second lifecycle ni un nouvel observer. Reçoit la vue Canvas RÉELLE
 * (`file`/`canvas`, le vrai objet runtime natif) ; c'est à l'appelant
 * (main.ts) de savoir interpréter `canvas` (type `MinimalRuntimeCanvas`,
 * voir services/canvas-runtime.ts) — lifecycle.ts reste générique et
 * n'importe rien du bloc Mindmap. */
export type CarnetMindmapDecoratorOptions = {
  /** `true` uniquement lors du `cleanup()` du lifecycle : l'appelant doit
   * retirer TOUTES les classes de masquage résiduelles (nodes ET edges),
   * quel que soit l'état replié réellement persisté sur le groupe — ces
   * classes n'ont de sens que pendant que ce plugin gère activement le
   * Carnet ouvert. */
  forceVisible?: boolean;
};
export type CarnetMindmapDecorator = (view: { file?: TFile | null; canvas?: unknown }, options?: CarnetMindmapDecoratorOptions) => void;

/** Applies the Carnet marker only to exact recognized Canvas files, and
 * (§16 du correctif « Carnet logique unique ») réécrit UNIQUEMENT le titre
 * visible de la leaf reconnue comme Carnet — jamais le fichier physique
 * `<uuid>.canvas`, jamais un `document.querySelector` global : on cible
 * `.workspace-tab-header-inner-title` DANS le `tabHeaderEl` de CETTE leaf.
 * Réutilise le même passage `refresh()` que le marqueur CSS existant —
 * aucun second lifecycle, aucun nouvel observer global. Idempotent : un
 * refresh répété réapplique le même titre sans jamais l'empiler (le texte
 * d'origine n'est mémorisé qu'une fois, avant la première réécriture). */
export function createCarnetLifecycle(app: Pick<App, "workspace">, isCarnet: (file: TFile | null | undefined) => boolean, resolveTitle?: CarnetTitleResolver, decorateMindmap?: CarnetMindmapDecorator): CarnetLifecycle {
  const marked = new Set<HTMLElement>();
  const originalTitles = new Map<HTMLElement, string>();
  const restore = (titleEl: HTMLElement): void => {
    const original = originalTitles.get(titleEl);
    if (original !== undefined) titleEl.textContent = original;
    originalTitles.delete(titleEl);
  };
  const refresh = (): void => {
    const current = new Set<HTMLElement>();
    const currentTitleEls = new Set<HTMLElement>();
    for (const leaf of app.workspace.getLeavesOfType("canvas")) {
      const leafWithHeader = leaf as unknown as LeafWithHeader;
      const view = leafWithHeader.view ?? {};
      const wrapper = view.containerEl ?? view.contentEl;
      if (wrapper) {
        current.add(wrapper);
        wrapper.classList.toggle("feuillets-carnet-canvas", isCarnet(view.file));
      }
      if (isCarnet(view.file)) decorateMindmap?.(view);
      if (!resolveTitle) continue;
      const titleEl = leafWithHeader.tabHeaderEl?.querySelector<HTMLElement>(".workspace-tab-header-inner-title");
      if (!titleEl) continue;
      currentTitleEls.add(titleEl);
      const title = resolveTitle(view.file);
      if (title) {
        if (!originalTitles.has(titleEl)) originalTitles.set(titleEl, titleEl.textContent ?? "");
        titleEl.textContent = title;
      } else if (originalTitles.has(titleEl)) {
        restore(titleEl);
      }
    }
    for (const wrapper of marked) if (!current.has(wrapper)) wrapper.classList.remove("feuillets-carnet-canvas");
    marked.clear(); current.forEach((wrapper) => marked.add(wrapper));
    // Une leaf fermée/reconstruite ne réapparaît plus dans getLeavesOfType :
    // son ancien titleEl doit être restauré ici, jamais laissé en mémoire.
    for (const titleEl of [...originalTitles.keys()]) if (!currentTitleEls.has(titleEl)) restore(titleEl);
  };
  return {
    refresh,
    cleanup: () => {
      marked.forEach((wrapper) => wrapper.classList.remove("feuillets-carnet-canvas"));
      marked.clear();
      for (const titleEl of [...originalTitles.keys()]) restore(titleEl);
      if (decorateMindmap) {
        for (const leaf of app.workspace.getLeavesOfType("canvas")) {
          const view = (leaf as unknown as LeafWithHeader).view;
          if (view) decorateMindmap(view, { forceVisible: true });
        }
      }
    },
  };
}
