import { bindTextEditor, normalizeTextStyle, refreshTextStyle } from "./text-style.js";
import { attachDynamicStacks } from "./dynamic-stack.js";
import { attachNoteSizing } from "./note-size.js";
import { attachTextAnchors } from "./text-anchors.js";
import { Menu, Notice, type App, type EventRef, type TFile } from "obsidian";
import { t } from "../../i18n/index.js";
import type { MinimalRuntimeCanvas, MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import type { CanvasData, CanvasNode, CarnetNoteStyle, CarnetTextStyle } from "./types.js";

const styles = ["plain", "outline", "rounded", "filled", "classic"] as const;
const classes = styles.map((style) => `feuillets-note-${style}`);

type StyleCanvas = MinimalRuntimeCanvas & {
  nodes: Map<string, MinimalRuntimeNode>;
  getData(): CanvasData;
  importData: (data: CanvasData, clear: boolean) => unknown;
  requestSave(addHistory?: boolean): void;
  pushHistory(data: CanvasData): void;
  requestPushHistory: (() => void) & { run(): void; cancel(): void };
  readonly?: boolean;
  addNode?: (node: MinimalRuntimeNode) => void;
};

function hasStyleContract(value: unknown): value is StyleCanvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<StyleCanvas>;
  return canvas.nodes instanceof Map && typeof canvas.getData === "function" &&
    typeof canvas.importData === "function" && typeof canvas.requestSave === "function" &&
    typeof canvas.pushHistory === "function" && typeof canvas.requestPushHistory === "function" &&
    typeof canvas.requestPushHistory.run === "function" && typeof canvas.requestPushHistory.cancel === "function";
}

export function isFreeNote(data: CanvasData, node: CanvasNode): boolean {
  return node.type === "text" && !!node.id &&
    !Object.keys(node).some((key) => key.startsWith("feuillets_") && key !== "feuillets_note_style" && key !== "feuillets_note_width" && key !== "feuillets_text_style" && key !== "feuillets_stack") &&
    !Object.keys(node).some((key) => key.startsWith("mindmap")) &&
    !data.edges.some((edge) => (edge.fromNode === node.id || edge.toNode === node.id) &&
      Object.keys(edge).some((key) => key.startsWith("feuillets_") && key !== "feuillets_edge_style"));
}

export function applyNoteStyle(value: unknown, nodeId: string, style: CarnetNoteStyle | undefined): boolean {
  return applyNoteAppearance(value, nodeId, { style });
}

export function applyNoteAppearance(value: unknown, nodeId: string, change: { style?: CarnetNoteStyle; color?: string; textStyle?: CarnetTextStyle }): boolean {
  if (!hasStyleContract(value) || value.readonly) return false;
  const node = value.nodes.get(nodeId);
  const data = value.getData();
  const current = data.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !current || !isFreeNote(data, current)) return false;
  const next = { ...node.getData() };
  if (Object.prototype.hasOwnProperty.call(change, "style")) {
    if (change.style === undefined) delete next.feuillets_note_style;
    else next.feuillets_note_style = change.style;
  }
  if (change.color !== undefined) {
    if (change.color) next.color = change.color;
    else delete next.color;
  }
  if (Object.prototype.hasOwnProperty.call(change, "textStyle")) {
    const style = normalizeTextStyle(change.textStyle);
    if (style) next.feuillets_text_style = style;
    else delete next.feuillets_text_style;
  }
  if (JSON.stringify(next) === JSON.stringify(node.getData())) return true;
  // Flush the preceding native edit before recording this independent action.
  value.requestPushHistory.run();
  node.setData(next);
  value.requestPushHistory.cancel();
  value.requestSave(false);
  value.pushHistory(value.getData());
  return true;
}

/** Bound by the existing Carnet lifecycle, including native reload and undo. */
export function attachCarnetNoteStyles(canvasValue: unknown, onRefresh?: () => void): { refresh(): void; cleanup(): void } | null {
  if (!hasStyleContract(canvasValue)) return null;
  const canvas = canvasValue;
  const decorated = new Set<HTMLElement>();
  let importing = false;
  const stacks = attachDynamicStacks(canvas, () => importing);
  const sizing = attachNoteSizing(canvas, (node) => anchors?.update(node), bindTextEditor, onRefresh, stacks ?? undefined);
  const anchors = attachTextAnchors(canvas, (node) => sizing?.update(node));
  const refresh = (): void => {
    const data = canvas.getData();
    const current = new Set<HTMLElement>();
    const typographyChanges: MinimalRuntimeNode[] = [];
    const free = new Set(data.nodes.filter((node) => isFreeNote(data, node)).map((node) => node.id));
    for (const node of data.nodes) {
      const runtime = canvas.nodes.get(node.id);
      if (runtime && refreshTextStyle(runtime, free.has(node.id))) typographyChanges.push(runtime);
      const el = runtime?.nodeEl;
      if (!el?.classList) continue;
      current.add(el);
      const style = free.has(node.id) ? (node.feuillets_note_style ?? "plain") : undefined;
      styles.forEach((candidate, index) => el.classList.toggle(classes[index], style === candidate));
      decorated.add(el);
    }
    for (const el of decorated) if (!current.has(el)) { el.classList.remove(...classes); decorated.delete(el); }
    sizing?.refresh(free);
    anchors?.refresh(free);
    for (const node of typographyChanges) if (free.has(node.id)) sizing?.update(node, true);
    onRefresh?.();
  };
  const originalAdd = canvas.addNode;
  const add = originalAdd ? (node: MinimalRuntimeNode): void => { originalAdd.call(canvas, node); if (!importing) refresh(); } : undefined;
  if (add) canvas.addNode = add;
  const original = canvas.importData;
  const wrapped: StyleCanvas["importData"] = function (data, clear) {
    const previous = importing;
    importing = true;
    let result: unknown;
    try { result = original.call(canvas, data, clear); }
    finally { importing = previous; }
    if (!importing) refresh();
    return result;
  };
  canvas.importData = wrapped;
  return {
    refresh,
    cleanup: () => {
      sizing?.cleanup();
      stacks?.cleanup();
      anchors?.cleanup();
      if (canvas.addNode === add) canvas.addNode = originalAdd;
      if (canvas.importData === wrapped) canvas.importData = original;
      for (const node of canvas.nodes.values()) refreshTextStyle(node, false);
      decorated.forEach((el) => el.classList.remove(...classes));
      decorated.clear();
    },
  };
}

type MenuNode = MinimalRuntimeNode & { canvas?: StyleCanvas & { view?: { file?: TFile | null } } };
type MenuWorkspace = { on(name: "canvas:node-menu", callback: (menu: Menu, node: MenuNode) => void): EventRef };

export function registerCarnetNoteStyleMenu(plugin: {
  app: App;
  registerEvent(event: EventRef): void;
}, isCarnet: (file: TFile | null | undefined) => boolean, refresh: () => void): void {
  const workspace = plugin.app.workspace as unknown as MenuWorkspace;
  plugin.registerEvent(workspace.on("canvas:node-menu", (menu, node) => {
    const canvas = node.canvas;
    const file = canvas?.view?.file;
    if (!file || !isCarnet(file) || !hasStyleContract(canvas) || canvas.readonly || !isFreeNote(canvas.getData(), node.getData())) return;
    menu.addItem((item) => {
      item.setTitle(t("carnet.noteStyle.title")).setIcon("palette");
      const submenu = (item as typeof item & { setSubmenu(): Menu }).setSubmenu();
      for (const style of [undefined, ...styles]) {
        submenu.addItem((choice) => choice
          .setTitle(t(style === undefined ? "carnet.noteStyle.default" : `carnet.noteStyle.${style}`))
          .setChecked(node.getData().feuillets_note_style === style)
          .onClick(() => {
            if (!isCarnet(canvas.view?.file) || canvas.view?.file !== file) return;
            if (!applyNoteStyle(canvas, node.id, style)) new Notice(t("carnet.noteStyle.unavailable"));
            refresh();
          }));
      }
    });
  }));
}
