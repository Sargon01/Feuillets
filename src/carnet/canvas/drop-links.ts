import type { App, TFile } from "obsidian";
import { ItemView } from "obsidian";
import type { MinimalRuntimeCanvas, MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import { findOpenCanvasView } from "./adapter.js";
import type { CanvasData, CanvasEdge, CanvasNode } from "./types.js";

type CanvasHistory = { data: CanvasData[]; current: number };
type HistoryRequest = (() => void) & { run(): void; cancel(): void };
type DropCanvas = MinimalRuntimeCanvas & {
  nodes: Map<string, MinimalRuntimeNode>;
  selection: Set<MinimalRuntimeNode>;
  wrapperEl: HTMLElement;
  posFromEvt: (event: { clientX: number; clientY: number }) => { x: number; y: number };
  getData(): CanvasData;
  importData(data: CanvasData, clear: boolean): void;
  requestSave(addHistory?: boolean): void;
  pushHistory(data: CanvasData): void;
  requestPushHistory: HistoryRequest;
  history: CanvasHistory;
  isDragging: boolean;
  readonly?: boolean;
  isHoldingSpace?: boolean;
};

export type DropLinkView = {
  file?: TFile | null;
  canvas?: unknown;
  register?(cleanup: () => void): void;
};

type Drag = {
  pointer: number;
  clientX: number;
  clientY: number;
  moved: boolean;
  source: MinimalRuntimeNode;
  before: CanvasData;
  history: CanvasHistory;
  entries: CanvasData[];
  fingerprints: string[];
  current: number;
  instances: Map<string, MinimalRuntimeNode>;
};

function hasContract(value: unknown): value is DropCanvas {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<DropCanvas>;
  return c.nodes instanceof Map && c.selection instanceof Set && !!c.wrapperEl &&
    typeof c.getData === "function" && typeof c.posFromEvt === "function" &&
    typeof c.importData === "function" && typeof c.requestSave === "function" &&
    typeof c.pushHistory === "function" && typeof c.requestPushHistory === "function" &&
    typeof c.requestPushHistory.run === "function" && typeof c.requestPushHistory.cancel === "function" &&
    Array.isArray(c.history?.data) && Number.isInteger(c.history.current) && typeof c.isDragging === "boolean";
}

function isFreeText(data: CanvasData, node: CanvasNode): boolean {
  return node.type === "text" && !!node.id &&
    !Object.keys(node).some((key) => key.startsWith("feuillets_") && key !== "feuillets_note_style" && key !== "feuillets_note_width") &&
    !data.edges.some((edge) => (edge.fromNode === node.id || edge.toNode === node.id) &&
      Object.keys(edge).some((key) => key.startsWith("feuillets_")));
}

function validData(data: CanvasData): boolean {
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) return false;
  const ids = new Set(data.nodes.map((node) => node.id));
  return ids.size === data.nodes.length && !ids.has("") &&
    data.nodes.every((node) => typeof node.id === "string" &&
      [node.x, node.y, node.width, node.height].every((value) => typeof value === "number" && Number.isFinite(value))) &&
    new Set(data.edges.map((edge) => edge.id)).size === data.edges.length &&
    data.edges.every((edge) => typeof edge.id === "string" && !!edge.id &&
      typeof edge.fromNode === "string" && ids.has(edge.fromNode) && typeof edge.toNode === "string" && ids.has(edge.toNode));
}

function sameHistory(canvas: DropCanvas, drag: Drag): boolean {
  const history = canvas.history;
  return history === drag.history && history.current === drag.current &&
    history.data.length === drag.entries.length && history.data.every((entry, index) =>
      entry === drag.entries[index] && JSON.stringify(entry) === drag.fingerprints[index]);
}

function unchanged(canvas: DropCanvas, drag: Drag, current: CanvasData): boolean {
  if (!validData(current) || current.nodes.length !== drag.before.nodes.length) return false;
  const original = new Map(drag.before.nodes.map((node) => [node.id, node]));
  return current.nodes.every((node) => {
    const before = original.get(node.id);
    if (!before || canvas.nodes.get(node.id) !== drag.instances.get(node.id)) return false;
    const comparable = node.id === drag.source.id ? { ...node, x: before.x, y: before.y } : node;
    return JSON.stringify(comparable) === JSON.stringify(before);
  }) && JSON.stringify({ ...current, nodes: [] }) === JSON.stringify({ ...drag.before, nodes: [] });
}

/** Only an unlabelled, unstyled, unmanaged line may be toggled off. */
export function toggleDropLink(data: CanvasData, sourceId: string, targetId: string): CanvasData | null {
  if (!validData(data) || sourceId === targetId) return null;
  const source = data.nodes.find((node) => node.id === sourceId);
  const target = data.nodes.find((node) => node.id === targetId);
  if (!source || !target || !isFreeText(data, source) || !isFreeText(data, target)) return null;
  const between = data.edges.filter((edge) =>
    (edge.fromNode === sourceId && edge.toNode === targetId) || (edge.fromNode === targetId && edge.toNode === sourceId));
  if (between.length > 1) return null;
  const existing = between[0];
  if (existing) {
    const fields = new Set(["id", "fromNode", "toNode", "fromSide", "toSide", "fromEnd", "toEnd"]);
    if ((existing.fromEnd ?? "none") !== "none" || existing.toEnd !== "none" ||
      Object.keys(existing).some((key) => !fields.has(key))) return null;
    return { ...data, edges: data.edges.filter((edge) => edge !== existing) };
  }
  const dx = (target.x ?? 0) - (source.x ?? 0);
  const dy = (target.y ?? 0) - (source.y ?? 0);
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const edge: CanvasEdge = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 16), fromNode: sourceId, toNode: targetId,
    fromSide: horizontal ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top"),
    toSide: horizontal ? (dx >= 0 ? "left" : "right") : (dy >= 0 ? "top" : "bottom"),
    fromEnd: "none", toEnd: "none",
  };
  if (data.edges.some((candidate) => candidate.id === edge.id)) return null;
  return { ...data, edges: [...data.edges, edge] };
}

/** Observe the native drag; only its completed result is transformed. */
export function attachCarnetDropLinks(
  app: Pick<App, "workspace">,
  view: DropLinkView,
  isCarnet: (file: TFile | null | undefined) => boolean
): (() => void) | null {
  const file = view.file;
  if (!file || !isCarnet(file) || !view.register || !hasContract(view.canvas)) return null;
  const canvas = view.canvas;
  const wrapper = canvas.wrapperEl;
  const win = wrapper.ownerDocument.defaultView;
  if (!win) return null;
  let disposed = false;
  let drag: Drag | null = null;
  let timer: number | undefined;
  const active = (): boolean => !disposed && view.file === file && view.canvas === canvas &&
    wrapper.isConnected && !canvas.readonly && isCarnet(file) &&
    app.workspace.getActiveViewOfType(ItemView) === view && findOpenCanvasView(app, file) === view;
  const cancel = (): void => {
    drag = null;
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
  };
  const finalize = (pending: Drag, targetId: string): void => {
    timer = undefined;
    if (!active() || !hasContract(canvas) || canvas.isDragging || canvas.isHoldingSpace || canvas.selection.size !== 1 ||
      !canvas.selection.has(pending.source) || pending.source.isEditing || !sameHistory(canvas, pending)) return;
    const current = canvas.getData();
    if (!unchanged(canvas, pending, current) || canvas.nodes.get(targetId)?.isEditing) return;
    const source = pending.before.nodes.find((node) => node.id === pending.source.id);
    const moved = current.nodes.find((node) => node.id === pending.source.id);
    if (!source || !moved || (moved.x === source.x && moved.y === source.y)) return;
    const restored = { ...current, nodes: current.nodes.map((node) =>
      node.id === source.id ? { ...node, x: source.x, y: source.y } : node) };
    const next = toggleDropLink(restored, source.id, targetId);
    if (!next) return;
    // Keep the native drag checkpoint out of history and save one final snapshot.
    canvas.requestPushHistory.cancel();
    canvas.importData(next, true);
    canvas.requestSave(false);
    canvas.requestPushHistory.cancel();
    canvas.pushHistory(canvas.getData());
  };
  const onDown = (event: PointerEvent): void => {
    cancel();
    if (!active() || !hasContract(canvas) || canvas.isDragging || canvas.isHoldingSpace ||
      !event.isPrimary || event.pointerType !== "mouse" || event.button !== 0 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || canvas.selection.size > 1) return;
    if ((event.target as Element | null)?.closest?.(".canvas-node-resizer, .canvas-node-connection-point, input, textarea, button, a, [contenteditable]")) return;
    const data = canvas.getData();
    if (!validData(data)) return;
    const source = [...canvas.nodes.values()].find((node) => node.nodeEl?.contains(event.target as Node));
    const node = source && data.nodes.find((candidate) => candidate.id === source.id);
    if (!source || source.isEditing || !node || !isFreeText(data, node)) return;
    canvas.requestPushHistory.run();
    const history = canvas.history;
    if (history.current < 0 || history.current >= history.data.length) return;
    drag = {
      pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, moved: false, source,
      before: JSON.parse(JSON.stringify(canvas.getData())) as CanvasData,
      history, entries: history.data.slice(), fingerprints: history.data.map((entry) => JSON.stringify(entry)),
      current: history.current, instances: new Map(canvas.nodes),
    };
  };
  const onMove = (event: PointerEvent): void => {
    if (drag && event.pointerId === drag.pointer && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 8) drag.moved = true;
  };
  const onUp = (event: PointerEvent): void => {
    const pending = drag;
    drag = null;
    if (!pending?.moved || pending.pointer !== event.pointerId || !active() || !hasContract(canvas) || !canvas.isDragging || canvas.isHoldingSpace ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const pos = canvas.posFromEvt(event);
    const data = canvas.getData();
    const target = [...data.nodes].reverse().find((node) => {
      if (node.id === pending.source.id || !isFreeText(data, node)) return false;
      const bbox = canvas.nodes.get(node.id)?.getBBox?.();
      return bbox && pos.x >= bbox.minX && pos.x <= bbox.maxX && pos.y >= bbox.minY && pos.y <= bbox.maxY;
    });
    if (target) timer = win.setTimeout(() => finalize(pending, target.id), 0);
  };
  wrapper.addEventListener("pointerdown", onDown, true);
  wrapper.addEventListener("pointermove", onMove, true);
  wrapper.addEventListener("pointerup", onUp, true);
  wrapper.addEventListener("pointercancel", cancel, true);
  const cleanup = (): void => {
    disposed = true;
    cancel();
    wrapper.removeEventListener("pointerdown", onDown, true);
    wrapper.removeEventListener("pointermove", onMove, true);
    wrapper.removeEventListener("pointerup", onUp, true);
    wrapper.removeEventListener("pointercancel", cancel, true);
  };
  view.register(cleanup);
  return cleanup;
}
