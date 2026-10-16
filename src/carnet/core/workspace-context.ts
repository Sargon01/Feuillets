import type { App, TFile } from "obsidian";
import type { MinimalRuntimeEdge, MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import type { CanvasData } from "../canvas/types.js";

export type InspectorCanvas = {
  nodes: Map<string, MinimalRuntimeNode>;
  edges: Map<string, MinimalRuntimeEdge>;
  selection: Set<MinimalRuntimeNode | MinimalRuntimeEdge>;
  getData(): CanvasData;
  readonly?: boolean;
  isDragging?: boolean;
  staleSelection?: unknown[] | null;
};
export type CarnetWorkspaceTarget = { view: { file?: TFile | null; canvas?: unknown }; file: TFile; canvas: InspectorCanvas };
export type CarnetSelection = { target: CarnetWorkspaceTarget; objects: Array<MinimalRuntimeNode | MinimalRuntimeEdge> };

function inspectorCanvas(value: unknown): value is InspectorCanvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<InspectorCanvas>;
  return canvas.nodes instanceof Map && canvas.edges instanceof Map && canvas.selection instanceof Set && typeof canvas.getData === "function";
}

/** One retained view identity, shared with the existing Carnet lifecycle. */
export class CarnetWorkspaceContext {
  private target: CarnetWorkspaceTarget | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(private workspace: App["workspace"], private isCarnet: (file: TFile | null | undefined) => boolean) {}

  activate(view: unknown): void {
    if (this.disposed || !view || typeof view !== "object") return;
    const candidate = view as CarnetWorkspaceTarget["view"];
    if (candidate.file && this.isCarnet(candidate.file) && inspectorCanvas(candidate.canvas)) {
      if (this.target?.view !== view || this.target.canvas !== candidate.canvas || this.target.file !== candidate.file) {
        this.target = { view: candidate, file: candidate.file, canvas: candidate.canvas };
        this.changed();
      }
    } else if (candidate.file || "canvas" in candidate) {
      this.target = null;
      this.changed();
    }
    // A sidebar has no file. Moving focus into it preserves the intended view.
  }

  current(): CarnetWorkspaceTarget | null {
    const target = this.target;
    if (!target || this.disposed || target.view.file !== target.file || target.view.canvas !== target.canvas ||
      !this.isCarnet(target.file) || !this.workspace.getLeavesOfType("canvas").some((leaf) => leaf.view as unknown === target.view)) {
      this.target = null;
      return null;
    }
    return target;
  }

  snapshot(): CarnetSelection | null {
    const target = this.current();
    if (!target || target.canvas.readonly || target.canvas.isDragging || selectionPending(target.canvas)) return null;
    const snapshot = { target, objects: [...target.canvas.selection] };
    return this.valid(snapshot) ? snapshot : null;
  }

  valid(snapshot: CarnetSelection): boolean {
    const target = this.current(), canvas = target?.canvas;
    if (target !== snapshot.target || !canvas || canvas.readonly || canvas.isDragging || selectionPending(canvas) || canvas.selection.size !== snapshot.objects.length) return false;
    try {
      const data = canvas.getData();
      return snapshot.objects.every((object) => {
        const id = object.getData().id;
        return canvas.selection.has(object) && ((canvas.nodes.get(id) === object && data.nodes.some((node) => node.id === id)) ||
          (canvas.edges.get(id) === object && data.edges.some((edge) => edge.id === id)));
      });
    } catch { return false; }
  }

  changed(): void { if (!this.disposed) this.listeners.forEach((listener) => listener()); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  cleanup(): void { this.disposed = true; this.target = null; this.listeners.clear(); }
}

/** Canvas reconciles the previous selection's focus/blur in its next frame. */
function selectionPending(canvas: InspectorCanvas): boolean {
  return canvas.staleSelection != null;
}
