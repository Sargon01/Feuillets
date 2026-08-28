import { PLAN_MARKER } from "../blocks/plan/plan.js";
import type { CanvasNode } from "./types.js";

/** Nodes Canvas dont le CONTENU appartient à un bloc structuré Feuillets —
 * ils ne sont jamais des idées libres et ne doivent donc recevoir aucune
 * action générique du Carnet (conversion en feuillet/fiche, scission,
 * décoration de lecture legacy…).
 *
 * Ce prédicat vit dans la couche Carnet, PAS dans l'intégration Advanced
 * Canvas : c'est ici que Feuillets sait quels marqueurs il pose sur ses
 * propres nodes. Les consommateurs (integrations/advanced-canvas.ts,
 * notamment) posent seulement la question « ce node m'appartient-il ? » et
 * n'ont aucune connaissance du Plan, de la Mindmap ni d'un autre bloc. */
export function isFeuilletsOwnedNode(node: CanvasNode | null | undefined): boolean {
  if (!node) return false;
  return node.feuillets_binder_plan === PLAN_MARKER;
}
