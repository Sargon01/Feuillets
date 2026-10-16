import type { MinimalRuntimeNode, MinimalRuntimeEdge } from "../../services/canvas-runtime.js";
import type { CanvasData } from "./types.js";
import { normalizeCarnetDefaultStyles, withNewNoteDefaults, withNewEdgeDefaults, type CarnetDefaultStyles } from "../core/default-styles.js";

type WorkspaceCanvas = {
  nodes: Map<string, MinimalRuntimeNode>;
  edges: Map<string, MinimalRuntimeEdge>;
  updateSelection: (change: () => void) => void;
  setDragging: (dragging: boolean) => void;
  addNode: (node: MinimalRuntimeNode) => void;
  addEdge: (edge: MinimalRuntimeEdge) => void;
  importData: (data: CanvasData, clear: boolean) => unknown;
  requestSave: (addHistory?: boolean) => void;
  getData(): CanvasData;
  markDirty?: (edge: MinimalRuntimeEdge) => void;
  markMoved?: (edge: MinimalRuntimeEdge) => void;
  readonly?: boolean;
  wrapperEl?: HTMLElement;
};

function hasContract(value: unknown): value is WorkspaceCanvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<WorkspaceCanvas>;
  return canvas.nodes instanceof Map && canvas.edges instanceof Map &&
    [canvas.updateSelection, canvas.setDragging, canvas.addNode, canvas.addEdge, canvas.importData, canvas.requestSave, canvas.getData].every((method) => typeof method === "function");
}

/** Bound once by the Carnet lifecycle; imports, loading and Undo/Redo are excluded. */
export function attachCarnetWorkspaceBinding(value: unknown, valid: () => boolean, changed: () => void, getDefaults: () => CarnetDefaultStyles, refreshStyles?: () => void): { cleanup(): void } | null {
  if (!hasContract(value)) return null;
  const canvas = value;
  const original = { updateSelection: canvas.updateSelection, setDragging: canvas.setDragging, addNode: canvas.addNode,
    addEdge: canvas.addEdge, importData: canvas.importData, requestSave: canvas.requestSave };
  const seen = new WeakSet<object>([...canvas.nodes.values(), ...canvas.edges.values()]);
  const pending = new Map<MinimalRuntimeNode | MinimalRuntimeEdge, { kind: "note" | "edge"; defaults: CarnetDefaultStyles }>();
  let importing = 0, flushing = false;
  const win = canvas.wrapperEl?.ownerDocument.defaultView;
  let selectionFrame: number | undefined, disposed = false;
  const selectionChanged = (): void => {
    if (disposed || selectionFrame !== undefined) return;
    if (!win) { if (valid()) changed(); return; }
    // Native focus/blur and the gesture's trailing click finish before this read.
    selectionFrame = win.requestAnimationFrame(() => {
      selectionFrame = undefined;
      if (!disposed && valid()) changed();
    });
  };
  const enqueue = (object: MinimalRuntimeNode | MinimalRuntimeEdge, kind: "note" | "edge"): void => {
    if (seen.has(object)) return;
    seen.add(object);
    if (!importing && !canvas.readonly && valid()) pending.set(object, { kind, defaults: normalizeCarnetDefaultStyles(getDefaults()) });
  };
  const flush = (): boolean => {
    if (flushing || importing || !pending.size) return false;
    const batch = [...pending]; pending.clear();
    if (canvas.readonly || !valid()) return false;
    let initialized = false;
    flushing = true;
    try {
      for (const [object, entry] of batch) {
        const data = canvas.getData(), raw = object.getData();
        if (entry.kind === "note" && canvas.nodes.get(raw.id) === object) {
          const next = withNewNoteDefaults(data, raw, entry.defaults.note);
          if (JSON.stringify(next) !== JSON.stringify(raw)) { object.setData(next); initialized = true; }
        } else if (entry.kind === "edge" && canvas.edges.get(raw.id) === object) {
          // Native connector gestures register an edge before its destination exists.
          // Keep its creation preferences until the gesture's completed save.
          if (typeof raw.fromNode !== "string" || typeof raw.toNode !== "string" || !canvas.nodes.has(raw.fromNode) || !canvas.nodes.has(raw.toNode)) {
            pending.set(object, entry);
            continue;
          }
          const next = withNewEdgeDefaults(data, raw, entry.defaults.edge);
          if (JSON.stringify(next) !== JSON.stringify(raw)) {
            object.setData(next);
            initialized = true;
            canvas.markDirty?.(object);
            canvas.markMoved?.(object);
          }
        }
      }
    } finally { flushing = false; }
    return initialized;
  };
  const updateSelection: WorkspaceCanvas["updateSelection"] = (change) => { original.updateSelection.call(canvas, change); selectionChanged(); };
  const setDragging: WorkspaceCanvas["setDragging"] = (dragging) => { original.setDragging.call(canvas, dragging); selectionChanged(); };
  const addNode: WorkspaceCanvas["addNode"] = (node) => { original.addNode.call(canvas, node); enqueue(node, "note"); };
  const addEdge: WorkspaceCanvas["addEdge"] = (edge) => { original.addEdge.call(canvas, edge); enqueue(edge, "edge"); };
  const importData: WorkspaceCanvas["importData"] = (data, clear) => {
    pending.clear();
    importing++;
    try { return original.importData.call(canvas, data, clear); }
    finally { importing--; if (valid()) changed(); }
  };
  const requestSave: WorkspaceCanvas["requestSave"] = (addHistory) => {
    const initialized = flush();
    original.requestSave.call(canvas, addHistory);
    if (initialized && valid()) refreshStyles?.();
  };
  Object.assign(canvas, { updateSelection, setDragging, addNode, addEdge, importData, requestSave });
  return { cleanup: () => {
    disposed = true;
    if (selectionFrame !== undefined) win?.cancelAnimationFrame(selectionFrame);
    selectionFrame = undefined;
    pending.clear();
    if (canvas.updateSelection === updateSelection) canvas.updateSelection = original.updateSelection;
    if (canvas.setDragging === setDragging) canvas.setDragging = original.setDragging;
    if (canvas.addNode === addNode) canvas.addNode = original.addNode;
    if (canvas.addEdge === addEdge) canvas.addEdge = original.addEdge;
    if (canvas.importData === importData) canvas.importData = original.importData;
    if (canvas.requestSave === requestSave) canvas.requestSave = original.requestSave;
  } };
}
