import type { CanvasData, CanvasNode } from "../../canvas/types.js";
import { flattenPlan, type PlanItem } from "./model.js";
import type { BinderSnapshot } from "../../bridges/binder.js";

/** État du Plan tel qu'il vit DANS un node Canvas (Prompt 3/5).
 *
 * Le marqueur historique `feuillets_binder_plan: "outliner-v1"` est
 * CONSERVÉ (§13) : un Plan écrit par la version précédente reste reconnu et
 * lisible. Le modèle, lui, migre vers des items à UUID stables, stockés
 * sous une clé distincte — l'ancienne (`feuillets_binder_items`) n'est
 * jamais réécrite, seulement lue une fois pour la conversion. */

export const PLAN_MARKER = "outliner-v1";
export const PLAN_MODEL_VERSION = 2;

export type PlanState = {
  rootPath: string;
  items: PlanItem[];
  baseFingerprint: string;
  dirty: boolean;
};

/** Item de l'ancien modèle (services/canvas-binder-plan.ts) — décrit ici
 * uniquement pour pouvoir le LIRE lors de la migration. */
type LegacyItem = {
  id?: unknown;
  kind?: unknown;
  title?: unknown;
  path?: unknown;
  collapsed?: unknown;
  children?: unknown;
};

function isLegacyItem(value: unknown): value is LegacyItem {
  return !!value && typeof value === "object";
}

/** §13 — convertit l'ancien modèle vers le nouveau : structure, repli et
 * chemins préservés, `new-folder`/`new-file` fondus en un seul `draft`
 * (dont la nature se déduit désormais de la présence d'enfants). De
 * NOUVEAUX UUID sont attribués, puisque l'ancien `id` était le chemin —
 * précisément ce dont on se débarrasse. Aucun fichier Binder n'est touché. */
export function migrateLegacyPlanItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return [];
  const convert = (raw: unknown): PlanItem | null => {
    if (!isLegacyItem(raw)) return null;
    const legacyKind = typeof raw.kind === "string" ? raw.kind : "";
    const path = typeof raw.path === "string" && raw.path ? raw.path : undefined;
    const rawChildren = Array.isArray(raw.children) ? raw.children : [];
    /* §2 — l'ancien modèle n'avait qu'un `new-folder`/`new-file` d'un côté
       et un `draft` implicite de l'autre. On les traduit en genres
       EXPLICITES, sans perte : le genre annoncé prime ; à défaut, la
       présence d'enfants tranche une dernière fois (c'était la règle
       implicite d'avant), puisqu'aucune autre information n'existe. */
    let resolved: PlanItem["kind"];
    if (path) {
      resolved = legacyKind === "folder" ? "folder" : "file";
    } else if (legacyKind === "new-folder" || legacyKind === "draft-folder") {
      resolved = "draft-folder";
    } else if (legacyKind === "new-file" || legacyKind === "draft-file") {
      resolved = "draft-file";
    } else {
      resolved = rawChildren.length > 0 ? "draft-folder" : "draft-file";
    }
    const children = rawChildren.map(convert).filter((item): item is PlanItem => !!item);
    return {
      id: crypto.randomUUID(),
      kind: resolved,
      title: typeof raw.title === "string" ? raw.title : "",
      path,
      collapsed: raw.collapsed === true,
      children,
    };
  };
  return value.map(convert).filter((item): item is PlanItem => !!item);
}

/** Vrai node Plan d'un Canvas — au plus UN par Carnet (§2). `null` si
 * absent ; `"conflict"` si plusieurs, auquel cas l'appelant ne doit rien
 * écrire (même prudence que l'ancien `upsertBinderOutliner`). */
export function findPlanNode(canvas: CanvasData): CanvasNode | null | "conflict" {
  const plans = canvas.nodes.filter((node) => node.feuillets_binder_plan === PLAN_MARKER);
  if (plans.length > 1) return "conflict";
  return plans[0] ?? null;
}

/** Lit l'état du Plan porté par `node`, en migrant l'ancien modèle au
 * passage si nécessaire (§13). Ne mute jamais `node`. */
export function readPlanState(node: CanvasNode): PlanState {
  const rootPath = typeof node.feuillets_binder_root === "string" ? node.feuillets_binder_root : "";
  const baseFingerprint = typeof node.feuillets_binder_fingerprint === "string" ? node.feuillets_binder_fingerprint : "";
  const dirty = node.feuillets_binder_dirty === true;
  const modern = node.feuillets_plan_items;
  if (node.feuillets_plan_version === PLAN_MODEL_VERSION && Array.isArray(modern)) {
    return { rootPath, baseFingerprint, dirty, items: modern as PlanItem[] };
  }
  return { rootPath, baseFingerprint, dirty, items: migrateLegacyPlanItems(node.feuillets_binder_items) };
}

/** Écrit l'état sur `node` (mutation en place, comme le reste du pont
 * Canvas). Le repli texte reste renseigné : si le renderer ne peut pas se
 * monter, la carte demeure lisible (§12). L'ancienne clé
 * `feuillets_binder_items` n'est jamais réécrite. */
export function writePlanState(node: CanvasNode, state: PlanState): void {
  node.type = "text";
  /* CORRECTIF ERGONOMIE — `dynamicHeight` est RÉIMPOSÉ à chaque écriture,
     pas seulement à la création. Advanced Canvas propose une hauteur
     dynamique qui recalcule la taille d'un TextNode d'après son contenu :
     activée sur cette carte, tout agrandissement se rétractait aussitôt sur
     la hauteur du seul texte de repli — « la carte se replie ». Le Plan est
     une UI de taille libre, sa hauteur ne doit JAMAIS être déduite de son
     texte. Une taille minimale est garantie pour qu'une carte réduite à
     presque rien reste rattrapable. */
  node.dynamicHeight = false;
  if (!(Number(node.width) >= PLAN_NODE_MIN_SIZE.width)) node.width = PLAN_NODE_SIZE.width;
  if (!(Number(node.height) >= PLAN_NODE_MIN_SIZE.height)) node.height = PLAN_NODE_SIZE.height;
  node.feuillets_binder_plan = PLAN_MARKER;
  node.feuillets_plan_version = PLAN_MODEL_VERSION;
  node.feuillets_binder_root = state.rootPath;
  node.feuillets_plan_items = state.items;
  node.feuillets_binder_fingerprint = state.baseFingerprint;
  node.feuillets_binder_dirty = state.dirty;
  node.text = planFallbackText(state);
}

/** Repli texte lisible du Plan (§12) — c'est le contenu réel du TextNode,
 * donc ce que voit l'autrice si le renderer ne se monte pas. */
export function planFallbackText(state: PlanState): string {
  const lines = [state.dirty ? "Plan du manuscrit •" : "Plan du manuscrit"];
  const walk = (items: PlanItem[], depth: number) => {
    for (const item of items) {
      const bullet = item.kind === "file" ? "•" : item.kind === "folder" ? "▾" : "+";
      lines.push(`${"  ".repeat(depth)}${bullet} ${item.title || "(sans titre)"}`);
      walk(item.children, depth + 1);
    }
  };
  walk(state.items, 0);
  return lines.join("\n");
}

/** Géométrie du node Plan — reprise telle quelle de la carte existante
 * (520×620, hauteur fixe) pour ne pas déranger les Carnets déjà en place. */
export const PLAN_NODE_SIZE = { width: 520, height: 620 } as const;
/** En deçà, la carte n'est plus utilisable : `writePlanState` la ramène
 * alors à sa taille par défaut plutôt que de laisser une carte écrasée. */
export const PLAN_NODE_MIN_SIZE = { width: 260, height: 160 } as const;

export function createPlanNode(canvas: CanvasData, id: string, state: PlanState): CanvasNode {
  const bottom = canvas.nodes.reduce((max, node) => Math.max(max, (Number(node.y) || 0) + (Number(node.height) || 0)), 0);
  const node: CanvasNode = {
    id,
    type: "text",
    x: 0,
    y: canvas.nodes.length > 0 ? bottom + 40 : 0,
    width: PLAN_NODE_SIZE.width,
    height: PLAN_NODE_SIZE.height,
    dynamicHeight: false,
    feuillets_binder_ui_version: 2,
  };
  writePlanState(node, state);
  return node;
}

/** Marque le Plan comme modifié localement (§8) — toute édition passe par
 * là, jamais par une écriture directe de `feuillets_binder_dirty`. */
export function markPlanDirty(state: PlanState, items: PlanItem[]): PlanState {
  return { ...state, items, dirty: true };
}

/** Après un Apply réussi (§10) : les chemins des items sont réalignés sur
 * le Binder relu, les UUID préservés, le Plan redevient propre et adopte la
 * nouvelle empreinte. La correspondance se fait par POSITION dans l'arbre —
 * l'ordre du Plan appliqué EST celui du Binder relu, par construction. */
export function reconcilePlanAfterApply(items: PlanItem[], snapshot: BinderSnapshot, fingerprint: string, rootPath: string): PlanState {
  const walk = (plan: PlanItem[], binder: BinderSnapshot["children"]): PlanItem[] =>
    plan.map((item, index) => {
      const match = binder[index];
      if (!match) return item;
      return {
        ...item,
        kind: match.kind,
        path: match.path,
        title: match.title,
        children: walk(item.children, match.children),
      };
    });
  return { rootPath, items: walk(items, snapshot.children), baseFingerprint: fingerprint, dirty: false };
}

/** Nombre d'items réels référencés — utile aux diagnostics et aux tests de
 * non-régression (« le Plan n'a rien perdu »). */
export function countRealPlanItems(items: PlanItem[]): number {
  return flattenPlan(items).filter((item) => !!item.path).length;
}
