import type { MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import { isFreeNote } from "./note-style.js";
import { fingerprint, hasContract, selectedNotes, type StackCanvas } from "./stack-notes.js";
import type { CanvasNode } from "./types.js";

export function stackMembership(node: CanvasNode): { id: string; order: number } | undefined {
  const value = node.feuillets_stack;
  return value && typeof value === "object" && typeof value.id === "string" && value.id.trim() &&
    Number.isSafeInteger(value.order) && value.order >= 0 ? value : undefined;
}

function independent(canvas: StackCanvas): boolean {
  const notes = selectedNotes(canvas);
  return !!notes && notes.every((node) => node.getData().feuillets_stack === undefined && typeof node.setData === "function") &&
    Number.isFinite((Math.min(...notes.map((node) => node.getData().y ?? 0))) + notes.reduce((height, node) => height + (node.getData().height ?? 0), 0));
}

export function canStackDynamically(value: unknown): boolean {
  return hasContract(value) && independent(value);
}

function selectedStacks(canvas: StackCanvas): Set<string> | null {
  const notes = selectedNotes(canvas, 1);
  if (!notes || notes.some((node) => !stackMembership(node.getData()))) return null;
  return new Set(notes.map((node) => stackMembership(node.getData())?.id).filter((id): id is string => !!id));
}

export function canUnstackDynamically(value: unknown): boolean {
  return hasContract(value) && selectedStacks(value) !== null;
}

/** Match the punctual action's native history boundary, including pending edits. */
function transact(value: unknown, active: () => boolean, eligible: (canvas: StackCanvas) => boolean, apply: (canvas: StackCanvas) => void): boolean {
  if (!hasContract(value) || !active() || !eligible(value)) return false;
  const snapshot = fingerprint(value.getData()), history = value.history, selection = [...value.selection];
  value.requestPushHistory.run();
  if (!hasContract(value) || !active() || !eligible(value) || value.history !== history ||
    snapshot !== fingerprint(value.getData()) || snapshot !== fingerprint(history.data[history.current]) ||
    value.selection.size !== selection.length || selection.some((node) => !value.selection.has(node))) return false;
  apply(value);
  value.requestPushHistory.cancel();
  value.requestSave(false);
  value.pushHistory(value.getData());
  return true;
}

export function stackDynamically(value: unknown, active: () => boolean = () => true): boolean {
  return transact(value, active, independent, (canvas) => {
    const notes = [...canvas.selection].sort((a, b) => {
      const left = a.getData(), right = b.getData();
      return (left.y ?? 0) - (right.y ?? 0) || (left.x ?? 0) - (right.x ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    const id = crypto.randomUUID();
    notes.forEach((node, order) => node.setData({ ...node.getData(), feuillets_stack: { id, order } }));
    reflowStack(canvas, id);
  });
}

/** Dissolve every selected relationship, leaving all rectangles untouched. */
export function unstackDynamically(value: unknown, active: () => boolean = () => true): boolean {
  return transact(value, active, (canvas) => selectedStacks(canvas) !== null, (canvas) => {
    const ids = selectedStacks(canvas), data = canvas.getData();
    for (const raw of data.nodes) if (isFreeNote(data, raw) && ids?.has(stackMembership(raw)?.id ?? "")) {
      const node = canvas.nodes.get(raw.id);
      if (node) clearMembership(node);
    }
  });
}

function clearMembership(node: MinimalRuntimeNode): void {
  const data = { ...node.getData() };
  delete data.feuillets_stack;
  node.setData(data);
}

/** Move native rectangles only; sizing, connections and saving remain native. */
export function reflowStack(canvas: StackCanvas, id: string): number {
  const data = canvas.getData();
  const members = data.nodes.filter((node) => stackMembership(node)?.id === id);
  if (members.length < 2 || members.some((node) => !isFreeNote(data, node)) ||
    new Set(members.map((node) => stackMembership(node)?.order)).size !== members.length ||
    new Set(members.map((node) => node.id)).size !== members.length) return 0;
  members.sort((a, b) => (stackMembership(a)?.order ?? 0) - (stackMembership(b)?.order ?? 0));
  if (members.some((node) => ![node.x, node.y, node.width, node.height].every((n) => typeof n === "number" && Number.isFinite(n)) ||
    !(node.width && node.width > 0 && node.height && node.height > 0) || typeof canvas.nodes.get(node.id)?.moveTo !== "function")) return 0;
  const x = members[0].x ?? 0;
  let y = members[0].y ?? 0;
  const moves = members.map((node) => { const position = { node, x, y }; y += node.height ?? 0; return position; });
  if (!Number.isFinite(y)) return 0;
  let changed = 0;
  for (const move of moves) if (move.node.x !== move.x || move.node.y !== move.y) {
    canvas.nodes.get(move.node.id)?.moveTo({ x: move.x, y: move.y });
    changed++;
  }
  return changed;
}

/** Called by the existing scoped sizing hooks, before their history/save boundary. */
export function attachDynamicStacks(value: unknown, suspended: () => boolean = () => false): {
  geometryChanged(node: MinimalRuntimeNode): void;
  moved(node: MinimalRuntimeNode, before: CanvasNode): void;
  beforeSave(): void;
  cleanup(): void;
} | null {
  if (!hasContract(value)) return null;
  const canvas = value;
  const dragged = new Map<MinimalRuntimeNode, CanvasNode>();
  let running = false, disposed = false;
  const enabled = (): boolean => !running && !disposed && !suspended() && !canvas.readonly;
  const guarded = (callback: () => void): void => {
    if (!enabled()) return;
    running = true;
    try { callback(); } finally { running = false; }
  };
  return {
    geometryChanged: (node) => guarded(() => {
      const id = stackMembership(node.getData())?.id;
      if (id && !canvas.isDragging && !node.nodeEl?.classList.contains("is-dragging")) reflowStack(canvas, id);
    }),
    moved: (node, before) => {
      // Native selection dragging uses moveTo with unchanged dimensions; resize handles change them.
      if (enabled() && canvas.isDragging && node.nodeEl?.classList.contains("is-dragging") && stackMembership(before)) dragged.set(node, dragged.get(node) ?? before);
    },
    beforeSave: () => guarded(() => {
      for (const [node, before] of dragged) {
        const now = node.getData();
        if (canvas.nodes.get(node.id) === node && (now.x !== before.x || now.y !== before.y)) clearMembership(node);
      }
      dragged.clear();
      const data = canvas.getData(), stacks = new Map<string, CanvasNode[]>();
      for (const raw of data.nodes) {
        if (!isFreeNote(data, raw) || raw.feuillets_stack === undefined) continue;
        const membership = stackMembership(raw), node = canvas.nodes.get(raw.id);
        if (!membership) { if (node) clearMembership(node); continue; }
        const members = stacks.get(membership.id) ?? [];
        members.push(raw); stacks.set(membership.id, members);
      }
      for (const [id, members] of stacks) {
        if (members.length < 2 || new Set(members.map((node) => stackMembership(node)?.order)).size !== members.length) {
          for (const raw of members) { const node = canvas.nodes.get(raw.id); if (node) clearMembership(node); }
        } else reflowStack(canvas, id);
      }
    }),
    cleanup: () => { disposed = true; dragged.clear(); },
  };
}
