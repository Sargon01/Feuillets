import type { App, TFile } from "obsidian";
import { attachCarnetNoteStyles } from "../canvas/note-style.js";
import { attachCarnetDropLinks, type DropLinkView } from "../canvas/drop-links.js";
import { attachAppearanceToolbar } from "../canvas/appearance-toolbar.js";
import { CarnetWorkspaceContext } from "./workspace-context.js";
import { attachCarnetWorkspaceBinding } from "../canvas/workspace-binding.js";
import type { CarnetDefaultStyles } from "./default-styles.js";

type CanvasView = DropLinkView & { containerEl?: HTMLElement; contentEl?: HTMLElement };
type LeafWithHeader = { view?: CanvasView; tabHeaderEl?: HTMLElement };
export type CarnetLifecycle = { refresh: () => void; cleanup: () => void; context: CarnetWorkspaceContext };

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
export function createCarnetLifecycle(app: Pick<App, "workspace">, isCarnet: (file: TFile | null | undefined) => boolean, resolveTitle?: CarnetTitleResolver, decorateMindmap?: CarnetMindmapDecorator, preferences?: () => { showFloatingToolbar?: boolean; defaultStyles?: CarnetDefaultStyles }): CarnetLifecycle {
  const context = new CarnetWorkspaceContext(app.workspace, isCarnet);
  const noteStyles = new Map<CanvasView, { canvas: unknown; file: TFile; binding: NonNullable<ReturnType<typeof attachCarnetNoteStyles>> }>();
  const workspaceBindings = new Map<CanvasView, { canvas: unknown; file: TFile; binding: NonNullable<ReturnType<typeof attachCarnetWorkspaceBinding>> }>();
  const toolbars = new Map<CanvasView, { canvas: unknown; file: TFile; binding: NonNullable<ReturnType<typeof attachAppearanceToolbar>> }>();
  const marked = new Set<HTMLElement>();
  const originalTitles = new Map<HTMLElement, string>();
  const dropLinks = new Map<CanvasView, { canvas: unknown; file: TFile; cleanup: () => void }>();
  const restore = (titleEl: HTMLElement): void => {
    const original = originalTitles.get(titleEl);
    if (original !== undefined) titleEl.textContent = original;
    originalTitles.delete(titleEl);
  };
  const refresh = (): void => {
    const current = new Set<HTMLElement>();
    const currentTitleEls = new Set<HTMLElement>();
    const currentViews = new Set<CanvasView>();
    for (const leaf of app.workspace.getLeavesOfType("canvas")) {
      const leafWithHeader = leaf as unknown as LeafWithHeader;
      const view = leafWithHeader.view ?? {};
      if (isCarnet(view.file) && view.file) {
        currentViews.add(view);
        const styled = noteStyles.get(view);
        if (styled && (styled.canvas !== view.canvas || styled.file !== view.file)) {
          styled.binding.cleanup();
          noteStyles.delete(view);
        }
        const workspaceBinding = workspaceBindings.get(view);
        if (workspaceBinding && (workspaceBinding.canvas !== view.canvas || workspaceBinding.file !== view.file)) { workspaceBinding.binding.cleanup(); workspaceBindings.delete(view); }
        if (!workspaceBindings.has(view)) {
          const file = view.file, canvas = view.canvas;
          const binding = attachCarnetWorkspaceBinding(canvas,
            () => view.file === file && view.canvas === canvas && isCarnet(file) && app.workspace.getLeavesOfType("canvas").some((leaf) => leaf.view as unknown === view),
            () => { if (app.workspace.getMostRecentLeaf?.()?.view === view) context.activate(view); context.changed(); },
            () => preferences?.().defaultStyles ?? {},
            () => noteStyles.get(view)?.binding.refresh());
          if (binding) workspaceBindings.set(view, { canvas, file, binding });
        }
        if (!noteStyles.has(view)) {
          const binding = attachCarnetNoteStyles(view.canvas, () => { toolbars.get(view)?.binding.refresh(); context.changed(); });
          if (binding) noteStyles.set(view, { canvas: view.canvas, file: view.file, binding });
        }
        noteStyles.get(view)?.binding.refresh();
        const toolbar = toolbars.get(view);
        if (toolbar && (toolbar.canvas !== view.canvas || toolbar.file !== view.file)) { toolbar.binding.cleanup(); toolbars.delete(view); }
        if (!toolbars.has(view)) {
          const binding = attachAppearanceToolbar(view.canvas, () => noteStyles.get(view)?.binding.refresh(), () => app.workspace.getMostRecentLeaf()?.view === view, () => context.changed());
          if (binding) toolbars.set(view, { canvas: view.canvas, file: view.file, binding });
        }
        toolbars.get(view)?.binding.refresh();
        const existing = dropLinks.get(view);
        if (existing && (existing.canvas !== view.canvas || existing.file !== view.file)) {
          existing.cleanup();
          dropLinks.delete(view);
        }
        if (!dropLinks.has(view)) {
          const cleanup = attachCarnetDropLinks(app, view, isCarnet);
          if (cleanup) dropLinks.set(view, { canvas: view.canvas, file: view.file, cleanup });
        }
      }
      const wrapper = view.containerEl ?? view.contentEl;
      if (wrapper) {
        current.add(wrapper);
        wrapper.classList.toggle("feuillets-carnet-canvas", isCarnet(view.file));
        wrapper.classList.toggle("feuillets-carnet-hide-selection-toolbar", isCarnet(view.file) && preferences?.().showFloatingToolbar === false);
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
    for (const wrapper of marked) if (!current.has(wrapper)) wrapper.classList.remove("feuillets-carnet-canvas", "feuillets-carnet-hide-selection-toolbar");
    marked.clear(); current.forEach((wrapper) => marked.add(wrapper));
    for (const [view, styled] of noteStyles) {
      if (!currentViews.has(view)) {
        styled.binding.cleanup();
        noteStyles.delete(view);
      }
    }
    for (const [view, binding] of dropLinks) {
      if (!currentViews.has(view)) {
        binding.cleanup();
        dropLinks.delete(view);
      }
    }
    for (const [view, toolbar] of toolbars) if (!currentViews.has(view)) { toolbar.binding.cleanup(); toolbars.delete(view); }
    for (const [view, binding] of workspaceBindings) if (!currentViews.has(view)) { binding.binding.cleanup(); workspaceBindings.delete(view); }
    // Une leaf fermée/reconstruite ne réapparaît plus dans getLeavesOfType :
    // son ancien titleEl doit être restauré ici, jamais laissé en mémoire.
    for (const titleEl of [...originalTitles.keys()]) if (!currentTitleEls.has(titleEl)) restore(titleEl);
    context.activate(app.workspace.getMostRecentLeaf?.()?.view);
    context.changed();
  };
  return {
    context,
    refresh,
    cleanup: () => {
      context.cleanup();
      toolbars.forEach((toolbar) => toolbar.binding.cleanup()); toolbars.clear();
      noteStyles.forEach((styled) => styled.binding.cleanup());
      noteStyles.clear();
      workspaceBindings.forEach((binding) => binding.binding.cleanup()); workspaceBindings.clear();
      dropLinks.forEach((binding) => binding.cleanup());
      dropLinks.clear();
      marked.forEach((wrapper) => wrapper.classList.remove("feuillets-carnet-canvas", "feuillets-carnet-hide-selection-toolbar"));
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
