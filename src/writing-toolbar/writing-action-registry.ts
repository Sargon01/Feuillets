import type { WritingContext } from "./writing-context.js";

/** Groupes d'affichage du preset — un séparateur est rendu entre deux groupes
 *  visibles consécutifs. */
export type WritingActionGroup = "navigation" | "writing" | "notes" | "view" | "structure";

/** Métadonnées d'une action : ce que le preset sait d'elle SANS savoir comment
 *  l'exécuter. Le handler est enregistré séparément (registerHandler), jamais
 *  avant que son moteur existe. */
export interface WritingActionDefinition {
  id: string;
  /** Libellé littéral (symboles ‹ › ¶ autorisés) — sinon labelKey via i18n. */
  label?: string;
  labelKey: string;
  tooltipKey: string;
  group: WritingActionGroup;
  /** Priorité responsive : les priorités les plus FAIBLES partent d'abord
   *  dans l'overflow quand la largeur manque. */
  priority: number;
  /** Split visuel (carence en Scrivener) : indique une action à sous-options. */
  split?: boolean;
}

/** Exécution d'une action, branchée par le Lot 2 sur les moteurs existants. */
export type WritingActionHandler = (context: WritingContext) => void | Promise<void>;

/** Registre typé, partagé par la barre et le contrôleur. Séparation stricte
 *  métadonnées / handler : une action sans handler est `canRun() === false`
 *  et `run()` reste un no-op sûr — jamais une exception. */
export interface WritingActionRegistry {
  registerDefinition(definition: WritingActionDefinition): void;
  registerHandler(id: string, handler: WritingActionHandler): void;
  /** Toutes les définitions, dans l'ordre d'enregistrement (ordre du preset). */
  definitions(): WritingActionDefinition[];
  canRun(id: string, context: WritingContext): boolean;
  run(id: string, context: WritingContext): void | Promise<void>;
}

class InMemoryWritingActionRegistry implements WritingActionRegistry {
  private definitionsOrdered: WritingActionDefinition[] = [];
  private handlers = new Map<string, WritingActionHandler>();

  registerDefinition(definition: WritingActionDefinition): void {
    this.definitionsOrdered.push(definition);
  }

  registerHandler(id: string, handler: WritingActionHandler): void {
    this.handlers.set(id, handler);
  }

  definitions(): WritingActionDefinition[] {
    return this.definitionsOrdered.slice();
  }

  canRun(id: string, _context: WritingContext): boolean {
    return this.handlers.has(id);
  }

  run(id: string, context: WritingContext): void | Promise<void> {
    const handler = this.handlers.get(id);
    if (!handler) return;
    return handler(context);
  }
}

/** Preset Auteur — ordre exact, groupes et priorités imposés par le Lot 1.
 *  Aucun handler n'est branché ici : le Lot 2 câblera les moteurs existants. */
export function createDefaultWritingActionRegistry(): WritingActionRegistry {
  const registry = new InMemoryWritingActionRegistry();
  registry.registerDefinition({
    id: "history-back",
    label: "\u2039",
    labelKey: "writingToolbar.action.historyBack.label",
    tooltipKey: "writingToolbar.action.historyBack.tooltip",
    group: "navigation",
    priority: 100,
  });
  registry.registerDefinition({
    id: "history-forward",
    label: "\u203A",
    labelKey: "writingToolbar.action.historyForward.label",
    tooltipKey: "writingToolbar.action.historyForward.tooltip",
    group: "navigation",
    priority: 100,
  });
  registry.registerDefinition({
    id: "writing-settings",
    label: "\u00B6",
    labelKey: "writingToolbar.action.writingSettings.label",
    tooltipKey: "writingToolbar.action.writingSettings.tooltip",
    group: "writing",
    priority: 90,
  });
  registry.registerDefinition({
    id: "footnote",
    labelKey: "writingToolbar.action.footnote.label",
    tooltipKey: "writingToolbar.action.footnote.tooltip",
    group: "notes",
    priority: 80,
  });
  registry.registerDefinition({
    id: "annotation",
    labelKey: "writingToolbar.action.annotation.label",
    tooltipKey: "writingToolbar.action.annotation.tooltip",
    group: "notes",
    priority: 80,
    split: true,
  });
  registry.registerDefinition({
    id: "preview",
    labelKey: "writingToolbar.action.preview.label",
    tooltipKey: "writingToolbar.action.preview.tooltip",
    group: "view",
    priority: 70,
  });
  registry.registerDefinition({
    id: "focus",
    labelKey: "writingToolbar.action.focus.label",
    tooltipKey: "writingToolbar.action.focus.tooltip",
    group: "view",
    priority: 70,
  });
  registry.registerDefinition({
    id: "reorganize",
    labelKey: "writingToolbar.action.reorganize.label",
    tooltipKey: "writingToolbar.action.reorganize.tooltip",
    group: "structure",
    priority: 60,
  });
  return registry;
}