import type { CanvasData, CanvasNode } from "./canvas-board.js";
import { freshCanvasNodeId } from "./canvas-bridge.js";

export const BINDER_OUTLINER_MARKER = "outliner-v1";
export type BinderOutlinerItem = { id: string; kind: "folder" | "file" | "new-folder" | "new-file"; title: string; path?: string; collapsed: boolean; children: BinderOutlinerItem[] };
export type BinderOutlinerSnapshot = { path: string; title: string; children: BinderOutlinerItem[] };

function stable(value: unknown): string { return JSON.stringify(value); }
export function binderOutlinerFingerprint(snapshot: BinderOutlinerSnapshot): string { return stable(snapshot); }
export function outlinerFallback(snapshot: BinderOutlinerSnapshot): string {
  const lines = ["Plan du manuscrit"];
  const walk = (items: BinderOutlinerItem[], depth: number) => items.forEach((item) => { lines.push(`${"  ".repeat(depth)}${item.kind.includes("folder") ? "▾" : "•"} ${item.title}`); walk(item.children, depth + 1); });
  walk(snapshot.children, 0); return lines.join("\n");
}
export function refreshOutlinerItems(snapshot: BinderOutlinerSnapshot, previous: BinderOutlinerItem[] = []): BinderOutlinerItem[] {
  const collapsed = new Map<string, boolean>(); const visit = (items: BinderOutlinerItem[]) => items.forEach((item) => { if (item.path) collapsed.set(item.path, item.collapsed); visit(item.children); }); visit(previous);
  const build = (items: BinderOutlinerItem[]): BinderOutlinerItem[] => items.map((item) => ({ ...item, collapsed: item.path ? collapsed.get(item.path) ?? item.collapsed : item.collapsed, children: build(item.children) }));
  return build(snapshot.children);
}
export function upsertBinderOutliner(canvas: CanvasData, snapshot: BinderOutlinerSnapshot): { ok: true; canvas: CanvasData; nodeId: string } | { ok: false } {
  const plans = canvas.nodes.filter((node) => node.feuillets_binder_plan === BINDER_OUTLINER_MARKER);
  if (plans.length > 1) return { ok: false };
  const next: CanvasData = { nodes: canvas.nodes.map((node) => ({ ...node })), edges: canvas.edges.map((edge) => ({ ...edge })) };
  const items = refreshOutlinerItems(snapshot, Array.isArray(plans[0]?.feuillets_binder_items) ? plans[0].feuillets_binder_items as BinderOutlinerItem[] : []);
  const fingerprint = binderOutlinerFingerprint(snapshot);
  const node = plans.length ? next.nodes.find((candidate) => candidate.id === plans[0].id) as CanvasNode : { id: freshCanvasNodeId(next), type: "text", x: 0, y: Math.max(0, ...next.nodes.map((candidate) => (Number(candidate.y) || 0) + (Number(candidate.height) || 0))) + 40, width: 520, height: 620, dynamicHeight: false, feuillets_binder_ui_version: 2 };
  if (node.feuillets_binder_ui_version !== 2) { node.dynamicHeight = false; node.width = 520; node.height = 620; node.feuillets_binder_ui_version = 2; }
  node.type = "text"; node.text = outlinerFallback({ ...snapshot, children: items }); node.feuillets_binder_plan = BINDER_OUTLINER_MARKER; node.feuillets_binder_root = snapshot.path; node.feuillets_binder_items = items; node.feuillets_binder_fingerprint = fingerprint; node.feuillets_binder_dirty = false;
  if (!plans.length) next.nodes.push(node);
  return { ok: true, canvas: next, nodeId: node.id };
}
export function addOutlinerItem(items: BinderOutlinerItem[], kind: "new-folder" | "new-file"): BinderOutlinerItem[] { return [...items, { id: crypto.randomUUID(), kind, title: "", collapsed: false, children: [] }]; }
export function removeNewOutlinerItem(items: BinderOutlinerItem[], id: string): BinderOutlinerItem[] { return items.filter((item) => !(item.id === id && item.kind.startsWith("new-"))).map((item) => ({ ...item, children: removeNewOutlinerItem(item.children, id) })); }

export function findPlanItem(items: BinderOutlinerItem[], id: string): BinderOutlinerItem | null { for (const item of items) { if (item.id === id) return item; const found = findPlanItem(item.children, id); if (found) return found; } return null; }
export function removePlanItem(items: BinderOutlinerItem[], id: string): { items: BinderOutlinerItem[]; removed: BinderOutlinerItem | null } { let removed: BinderOutlinerItem | null = null; const next = items.flatMap((item) => { if (item.id === id) { removed = item; return []; } const child = removePlanItem(item.children, id); if (child.removed) removed = child.removed; return [{ ...item, children: child.items }]; }); return { items: next, removed }; }
function contains(item: BinderOutlinerItem, id: string): boolean { return item.id === id || item.children.some((child) => contains(child, id)); }
export type PlanDrop = "before" | "after" | "inside";
export function canMovePlanItem(items: BinderOutlinerItem[], sourceId: string, targetId: string, drop: PlanDrop): boolean { const source = findPlanItem(items, sourceId); const target = findPlanItem(items, targetId); return !!source && !!target && sourceId !== targetId && !contains(source, targetId) && (drop !== "inside" || target.kind.endsWith("folder")); }
export function movePlanItem(items: BinderOutlinerItem[], sourceId: string, targetId: string, drop: PlanDrop): BinderOutlinerItem[] { if (!canMovePlanItem(items, sourceId, targetId, drop)) return items; const removed = removePlanItem(items, sourceId); const insert = (list: BinderOutlinerItem[]): BinderOutlinerItem[] => list.flatMap((item) => { if (item.id === targetId) { if (drop === "inside") return [{ ...item, collapsed: false, children: [...item.children, removed.removed as BinderOutlinerItem] }]; return drop === "before" ? [removed.removed as BinderOutlinerItem, item] : [item, removed.removed as BinderOutlinerItem]; } return [{ ...item, children: insert(item.children) }]; }); return insert(removed.items); }
export function indentPlanItem(items: BinderOutlinerItem[], id: string): BinderOutlinerItem[] { const index = items.findIndex((item) => item.id === id); if (index > 0 && items[index - 1].kind.endsWith("folder")) { const parent = items[index - 1]; return [...items.slice(0, index - 1), { ...parent, collapsed: false, children: [...parent.children, items[index]] }, ...items.slice(index + 1)]; } return items.map((item) => ({ ...item, children: indentPlanItem(item.children, id) })); }
export function outdentPlanItem(items: BinderOutlinerItem[], id: string): BinderOutlinerItem[] { for (let index = 0; index < items.length; index += 1) { const parent = items[index]; const childIndex = parent.children.findIndex((child) => child.id === id); if (childIndex >= 0) return [...items.slice(0, index + 1), parent.children[childIndex], ...items.slice(index + 1)].map((item, itemIndex) => itemIndex === index ? { ...parent, children: parent.children.filter((child) => child.id !== id) } : item); const children = outdentPlanItem(parent.children, id); if (children !== parent.children) return items.map((item, itemIndex) => itemIndex === index ? { ...parent, children } : item); } return items; }
