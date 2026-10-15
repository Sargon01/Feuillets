import { Menu, Notice, type App, type EventRef, type TFile } from "obsidian";
import { t } from "../../i18n/index.js";
import type { MinimalRuntimeCanvas, MinimalRuntimeEdge } from "../../services/canvas-runtime.js";
import { isFreeNote } from "./note-style.js";
import { isOrdinaryEdge } from "./text-anchors.js";
import type { CanvasData, CanvasEdge, CarnetEdgePattern, CarnetEdgeWidth } from "./types.js";

export type Arrows = "none" | "start" | "end" | "both";
export type EdgeAppearance = { pattern: CarnetEdgePattern; width: CarnetEdgeWidth; color: string; arrows: Arrows };
type AppearanceChange = { pattern?: CarnetEdgePattern; width?: CarnetEdgeWidth; color?: string; arrows?: Arrows } | "reset";
type EdgeCanvas = MinimalRuntimeCanvas & {
  edges: Map<string, MinimalRuntimeEdge>;
  getData(): CanvasData;
  markDirty(edge: MinimalRuntimeEdge): void;
  requestSave(addHistory?: boolean): void;
  pushHistory(data: CanvasData): void;
  requestPushHistory: (() => void) & { run(): void; cancel(): void };
  readonly?: boolean;
  view?: { file?: TFile | null };
};

function hasStyleContract(value: unknown): value is EdgeCanvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<EdgeCanvas>;
  return canvas.edges instanceof Map && typeof canvas.getData === "function" &&
    typeof canvas.markDirty === "function" && typeof canvas.requestSave === "function" &&
    typeof canvas.pushHistory === "function" && typeof canvas.requestPushHistory === "function" &&
    typeof canvas.requestPushHistory.run === "function" && typeof canvas.requestPushHistory.cancel === "function";
}

export function isEligibleEdge(data: CanvasData, edge: CanvasEdge): boolean {
  if (!isOrdinaryEdge(edge)) return false;
  return [edge.fromNode, edge.toNode].every((id) => {
    const node = data.nodes.find((candidate) => candidate.id === id);
    return !!node && isFreeNote(data, node);
  });
}

function arrowStyle(edge: CanvasEdge): Arrows {
  const start = edge.fromEnd === "arrow", end = (edge.toEnd ?? "arrow") === "arrow";
  return start ? (end ? "both" : "start") : (end ? "end" : "none");
}

export function getEdgeAppearance(edge: CanvasEdge): EdgeAppearance {
  return { pattern: edge.feuillets_edge_style?.pattern ?? "dashed", width: edge.feuillets_edge_style?.width ?? "thin", color: edge.color ?? "", arrows: arrowStyle(edge) };
}

export function applyEdgeStyle(value: unknown, edgeId: string, change: AppearanceChange): boolean {
  if (!hasStyleContract(value) || value.readonly) return false;
  const edge = value.edges.get(edgeId), data = value.getData();
  const current = data.edges.find((candidate) => candidate.id === edgeId);
  if (!edge || !current || typeof edge.setData !== "function" || !isEligibleEdge(data, current)) return false;
  const next = { ...current };
  const style = { ...current.feuillets_edge_style };
  if (change === "reset") {
    if (!current.feuillets_edge_style && !current.color && arrowStyle(current) === "none") return true;
    delete next.feuillets_edge_style;
    delete next.color;
    next.fromEnd = "none"; next.toEnd = "none";
  } else {
    if (change.pattern !== undefined) {
      if (change.pattern === "dashed") delete style.pattern;
      else style.pattern = change.pattern;
    }
    if (change.width !== undefined) {
      if (change.width === "thin") delete style.width;
      else style.width = change.width;
    }
    if (Object.keys(style).length) next.feuillets_edge_style = style;
    else delete next.feuillets_edge_style;
    if (change.color !== undefined) {
      if (change.color) next.color = change.color;
      else delete next.color;
    }
    if (change.arrows !== undefined) {
      next.fromEnd = change.arrows === "start" || change.arrows === "both" ? "arrow" : "none";
      next.toEnd = change.arrows === "end" || change.arrows === "both" ? "arrow" : "none";
    }
    // Match the native serialization defaults.
    if (next.fromEnd === "none" && current.fromEnd === undefined) delete next.fromEnd;
    if (next.toEnd === "arrow" && current.toEnd === undefined) delete next.toEnd;
    if (JSON.stringify(next) === JSON.stringify(current)) return true;
  }
  value.requestPushHistory.run();
  edge.setData(next);
  value.markDirty(edge);
  value.requestPushHistory.cancel();
  value.requestSave(false);
  value.pushHistory(value.getData());
  return true;
}

type MenuEdge = MinimalRuntimeEdge & { canvas?: EdgeCanvas };
type MenuWorkspace = { on(name: "canvas:edge-menu", callback: (menu: Menu, edge: MenuEdge) => void): EventRef };

export function registerCarnetEdgeStyleMenu(plugin: { app: App; registerEvent(event: EventRef): void }, isCarnet: (file: TFile | null | undefined) => boolean): void {
  const workspace = plugin.app.workspace as unknown as MenuWorkspace;
  plugin.registerEvent(workspace.on("canvas:edge-menu", (menu, edge) => {
    const canvas = edge.canvas, file = canvas?.view?.file;
    if (!file || !isCarnet(file) || !hasStyleContract(canvas) || canvas.readonly || !isEligibleEdge(canvas.getData(), edge.getData())) return;
    const current: CanvasEdge = edge.getData();
    const appearanceValue = getEdgeAppearance(current);
    const apply = (change: AppearanceChange): void => {
      if (canvas.view?.file !== file || !isCarnet(file) || canvas.edges.get(current.id) !== edge) return;
      if (!applyEdgeStyle(canvas, current.id, change)) new Notice(t("carnet.edgeStyle.unavailable"));
    };
    const submenu = (parent: Menu, title: string): Menu => {
      let result = parent;
      parent.addItem((item) => {
        item.setTitle(title);
        result = (item as typeof item & { setSubmenu(): Menu }).setSubmenu();
      });
      return result;
    };
    const appearance = submenu(menu, t("carnet.edgeStyle.title"));
    const line = submenu(appearance, t("carnet.edgeStyle.line"));
    for (const pattern of ["solid", "dashed", "dotted"] as const) line.addItem((item) => item
      .setTitle(t(`carnet.edgeStyle.${pattern}`)).setChecked(appearanceValue.pattern === pattern).onClick(() => apply({ pattern })));
    const widthMenu = submenu(appearance, t("carnet.edgeStyle.width"));
    for (const width of ["thin", "regular", "thick"] as const) widthMenu.addItem((item) => item
      .setTitle(t(`carnet.edgeStyle.${width}`)).setChecked(appearanceValue.width === width).onClick(() => apply({ width })));
    const arrowsMenu = submenu(appearance, t("carnet.edgeStyle.arrows"));
    for (const arrows of ["none", "start", "end", "both"] as const) arrowsMenu.addItem((item) => item
      .setTitle(t(`carnet.edgeStyle.${arrows}`)).setChecked(appearanceValue.arrows === arrows).onClick(() => apply({ arrows })));
    appearance.addItem((item) => item.setTitle(t("carnet.edgeStyle.reset")).onClick(() => apply("reset")));
  }));
}
