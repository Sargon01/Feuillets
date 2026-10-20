import { Menu, Notice, type App, type EventRef, type TFile } from "obsidian";
import { t } from "../../i18n/index.js";
import type { MinimalRuntimeCanvas, MinimalRuntimeEdge } from "../../services/canvas-runtime.js";
import { hasOrdinaryCardOwnership, isOrdinaryCard } from "./ordinary-cards.js";
import { isOrdinaryEdge } from "./text-anchors.js";
import type { CanvasData, CanvasEdge, CarnetEdgeGeometry, CarnetEdgePattern, CarnetEdgeWidth } from "./types.js";

export type Arrows = "none" | "start" | "end" | "both";
export type EdgeAppearance = { pattern: CarnetEdgePattern; width: CarnetEdgeWidth; color: string; arrows: Arrows; geometry: CarnetEdgeGeometry };
type AppearanceChange = { pattern?: CarnetEdgePattern; width?: CarnetEdgeWidth; color?: string; arrows?: Arrows; geometry?: CarnetEdgeGeometry } | "reset";
type EdgeCanvas = MinimalRuntimeCanvas & {
  edges: Map<string, MinimalRuntimeEdge>;
  getData(): CanvasData;
  markDirty(edge: MinimalRuntimeEdge): void;
  markMoved?: (edge: MinimalRuntimeEdge) => void;
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
    return !!node && (isOrdinaryCard(data, node) || (node.type === "group" && hasOrdinaryCardOwnership(data, node)));
  });
}

function arrowStyle(edge: CanvasEdge): Arrows {
  const start = edge.fromEnd === "arrow", end = (edge.toEnd ?? "arrow") === "arrow";
  return start ? (end ? "both" : "start") : (end ? "end" : "none");
}

export function getEdgeAppearance(edge: CanvasEdge, data?: CanvasData): EdgeAppearance {
  const native = data && !isEligibleEdge(data, edge);
  return { pattern: edge.feuillets_edge_style?.pattern ?? (native ? "solid" : "dotted"), width: edge.feuillets_edge_style?.width ?? (native ? "regular" : "thin"), color: edge.color ?? "", arrows: arrowStyle(edge),
    geometry: edge.feuillets_edge_style?.geometry === "curved" || edge.feuillets_edge_style?.geometry === "straight" || edge.feuillets_edge_style?.geometry === "map" ? edge.feuillets_edge_style.geometry : native ? "curved" : "straight" };
}

export function applyEdgeStyle(value: unknown, edgeId: string, change: AppearanceChange): boolean {
  if (!hasStyleContract(value) || value.readonly) return false;
  const edge = value.edges.get(edgeId), data = value.getData();
  const current = data.edges.find((candidate) => candidate.id === edgeId);
  if (!edge || !current || typeof edge.setData !== "function" || !isEligibleEdge(data, current)) return false;
  const next = { ...current };
  const style = { ...current.feuillets_edge_style };
  const defaults = getEdgeAppearance({ ...current, feuillets_edge_style: undefined }, data);
  if (change === "reset") {
    if (Object.keys(style).every((key) => key === "geometry") && !current.color && arrowStyle(current) === "none") return true;
    // Appearance reset preserves the explicit geometry choice.
    if (style.geometry) next.feuillets_edge_style = { geometry: style.geometry };
    else delete next.feuillets_edge_style;
    delete next.color;
    next.fromEnd = "none"; next.toEnd = "none";
  } else {
    if (change.pattern !== undefined) {
      if (change.pattern === defaults.pattern) delete style.pattern;
      else style.pattern = change.pattern;
    }
    if (change.width !== undefined) {
      if (change.width === defaults.width) delete style.width;
      else style.width = change.width;
    }
    if (change.geometry !== undefined) style.geometry = change.geometry;
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
  if (change !== "reset" && change.geometry !== undefined && typeof value.markMoved === "function") value.markMoved(edge);
  value.requestPushHistory.cancel();
  value.requestSave(false);
  value.pushHistory(value.getData());
  return true;
}

type MenuEdge = MinimalRuntimeEdge & { canvas?: EdgeCanvas };
type MenuWorkspace = { on(name: "canvas:edge-menu", callback: (menu: Menu, edge: MenuEdge) => void): EventRef };

export function registerCarnetEdgeStyleMenu(plugin: { app: App; registerEvent(event: EventRef): void }, isCarnet: (file: TFile | null | undefined) => boolean): void {
  const workspace = plugin.app.workspace as unknown as MenuWorkspace;
  const extendedMenus = new WeakSet<Menu>();
  plugin.registerEvent(workspace.on("canvas:edge-menu", (menu, edge) => {
    const canvas = edge.canvas, file = canvas?.view?.file;
    if (extendedMenus.has(menu) || !file || !isCarnet(file) || !hasStyleContract(canvas) || canvas.readonly ||
      canvas.edges.get(edge.getData().id) !== edge || !isEligibleEdge(canvas.getData(), edge.getData())) return;
    extendedMenus.add(menu);
    const current: CanvasEdge = edge.getData();
    const appearanceValue = getEdgeAppearance(current, canvas.getData());
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
    const appearance = submenu(menu, t("carnet.edgeStyle.menu"));
    const geometryMenu = submenu(appearance, t("carnet.edgeStyle.geometry"));
    for (const geometry of ["curved", "straight", "map"] as const) geometryMenu.addItem((item) => item
      .setTitle(t(`carnet.edgeStyle.${geometry}`)).setChecked(appearanceValue.geometry === geometry).onClick(() => apply({ geometry })));
    const line = submenu(appearance, t("carnet.edgeStyle.line"));
    for (const pattern of ["solid", "dashed", "dotted"] as const) line.addItem((item) => item
      .setTitle(t(`carnet.edgeStyle.${pattern}`)).setChecked(appearanceValue.pattern === pattern).onClick(() => apply({ pattern })));
    const widthMenu = submenu(appearance, t("carnet.edgeStyle.width"));
    for (const width of ["thin", "regular", "thick"] as const) widthMenu.addItem((item) => item
      .setTitle(t(`carnet.edgeStyle.${width}`)).setChecked(appearanceValue.width === width).onClick(() => apply({ width })));
    const arrowsMenu = submenu(appearance, t("carnet.edgeStyle.arrows"));
    for (const arrows of ["none", "start", "end", "both"] as const) arrowsMenu.addItem((item) => item
      .setTitle(t(`carnet.edgeStyle.${arrows}`)).setChecked(appearanceValue.arrows === arrows).onClick(() => apply({ arrows })));
    const colorMenu = submenu(appearance, t("carnet.edgeStyle.color"));
    colorMenu.addItem((item) => item.setTitle(t("carnet.edgeStyle.defaultColor"))
      .setChecked(appearanceValue.color === "").onClick(() => apply({ color: "" })));
    for (const [index, color] of ["red", "orange", "yellow", "green", "cyan", "purple"].entries()) {
      const value = String(index + 1);
      colorMenu.addItem((item) => item.setTitle(t(`carnet.edgeStyle.${color}`))
        .setChecked(appearanceValue.color === value).onClick(() => apply({ color: value })));
    }
    appearance.addItem((item) => item.setTitle(t("carnet.edgeStyle.reset")).onClick(() => apply("reset")));
  }));
}
