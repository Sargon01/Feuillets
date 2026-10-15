import type { MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import { isFreeNote } from "./note-style.js";
import type { CanvasData } from "./types.js";

type StackNode = MinimalRuntimeNode & { moveTo: (position: { x: number; y: number }) => void };
type StackCanvas = {
  nodes: Map<string, StackNode>;
  selection: Set<MinimalRuntimeNode>;
  getData(): CanvasData;
  requestSave(addHistory?: boolean): void;
  pushHistory(data: CanvasData): void;
  requestPushHistory: (() => void) & { run(): void; cancel(): void };
  history: { data: CanvasData[]; current: number };
  readonly?: boolean;
  isDragging?: boolean;
  isHoldingSpace?: boolean;
};

function hasContract(value: unknown): value is StackCanvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<StackCanvas>;
  return canvas.nodes instanceof Map && canvas.selection instanceof Set && typeof canvas.getData === "function" &&
    typeof canvas.requestSave === "function" && typeof canvas.pushHistory === "function" &&
    typeof canvas.requestPushHistory === "function" && typeof canvas.requestPushHistory.run === "function" &&
    typeof canvas.requestPushHistory.cancel === "function" && Array.isArray(canvas.history?.data) &&
    Number.isInteger(canvas.history.current) && canvas.history.current >= 0 && canvas.history.current < canvas.history.data.length &&
    Array.isArray(canvas.history.data[canvas.history.current]?.nodes) && Array.isArray(canvas.history.data[canvas.history.current]?.edges);
}

function selectedNotes(canvas: StackCanvas): StackNode[] | null {
  if (canvas.readonly || canvas.isDragging || canvas.isHoldingSpace || canvas.selection.size < 2) return null;
  const data = canvas.getData(), selected: StackNode[] = [];
  if (!Array.isArray(data?.nodes) || !Array.isArray(data.edges)) return null;
  for (const target of canvas.selection) {
    const node = data.nodes.find((candidate) => candidate.id === target.id);
    if (!node || canvas.nodes.get(node.id) !== target || target.isEditing || target.nodeEl?.classList.contains("is-dragging") ||
      typeof (target as Partial<StackNode>).moveTo !== "function" || !isFreeNote(data, node) ||
      ![node.x, node.y, node.width, node.height].every((number) => typeof number === "number" && Number.isFinite(number)) ||
      !(node.width && node.width > 0 && node.height && node.height > 0) || data.nodes.filter((candidate) => candidate.id === node.id).length !== 1) return null;
    selected.push(target as StackNode);
  }
  return selected;
}

export function canStackNotes(value: unknown): boolean {
  return hasContract(value) && selectedNotes(value) !== null;
}

function fingerprint(data: CanvasData): string {
  return JSON.stringify({ ...data, nodes: [...data.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...data.edges].sort((a, b) => a.id.localeCompare(b.id)) });
}

/** Apply one native move transaction; no stack relationship is retained. */
export function stackNotes(value: unknown, isActive: () => boolean = () => true): boolean {
  if (!hasContract(value) || !isActive()) return false;
  const notes = selectedNotes(value);
  if (!notes) return false;
  const before = value.getData(), snapshot = fingerprint(before), history = value.history;
  const ordered = notes.map((node) => ({ node, data: node.getData(), move: node.moveTo })).sort((a, b) =>
    (a.data.y ?? 0) - (b.data.y ?? 0) || (a.data.x ?? 0) - (b.data.x ?? 0) || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0));
  const x = ordered[0].data.x ?? 0;
  let y = ordered[0].data.y ?? 0;
  const moves = ordered.map((entry) => {
    const move = { ...entry, x, y };
    y += entry.data.height ?? 0;
    return move;
  });
  if (!Number.isFinite(y)) return false;
  const changed = moves.filter((entry) => entry.data.x !== entry.x || entry.data.y !== entry.y);
  if (!changed.length) return true;
  value.requestPushHistory.run();
  // A pending native save may run other work; revalidate before the first move.
  if (!hasContract(value) || !isActive() || value.history !== history || fingerprint(value.getData()) !== snapshot ||
    fingerprint(history.data[history.current]) !== snapshot) return false;
  const current = selectedNotes(value);
  if (!current || current.length !== notes.length || notes.some((node) => !current.includes(node)) ||
    moves.some((entry) => entry.node.moveTo !== entry.move)) return false;
  for (const entry of changed) entry.node.moveTo({ x: entry.x, y: entry.y });
  value.requestPushHistory.cancel();
  value.requestSave(false);
  value.pushHistory(value.getData());
  return true;
}
