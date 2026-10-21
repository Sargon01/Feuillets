import type { MinimalRuntimeCanvas, MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import { isOrdinaryCard } from "./ordinary-cards.js";
import type { CanvasData, CanvasNode } from "./types.js";

type CompactCanvas = MinimalRuntimeCanvas & {
  nodes: Map<string, MinimalRuntimeNode>;
  getData(): CanvasData;
  requestSave(history?: boolean): void;
  pushHistory(data: CanvasData): void;
  requestPushHistory: (() => void) & { run(): void; cancel(): void };
  readonly?: boolean;
  isDragging?: boolean;
};
const bindings = new WeakMap<object, { refresh(): void; valid(): boolean }>();

export function expandedFileSize(node: CanvasNode): CanvasNode["feuillets_compact_file"] {
  const value = node.feuillets_compact_file;
  return value && typeof value.width === "number" && Number.isFinite(value.width) && value.width > 0 &&
    typeof value.height === "number" && Number.isFinite(value.height) && value.height > 0 ? value : undefined;
}

export function isCompactableFile(data: CanvasData, node: CanvasNode): boolean {
  return node.type === "file" && typeof node.file === "string" && /\.md$/i.test(node.file) && isOrdinaryCard(data, node);
}

function hasContract(value: unknown): value is CompactCanvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<CompactCanvas>;
  return canvas.nodes instanceof Map && typeof canvas.getData === "function" && typeof canvas.requestSave === "function" &&
    typeof canvas.pushHistory === "function" && typeof canvas.requestPushHistory === "function" &&
    typeof canvas.requestPushHistory.run === "function" && typeof canvas.requestPushHistory.cancel === "function";
}

export function hasCompactFiles(value: object): boolean {
  return bindings.get(value)?.valid() === true;
}

/** All selected objects must be admissible files; mixed structural selections stay untouched. */
export function compactFileSelection(value: unknown): MinimalRuntimeNode[] {
  if (!hasContract(value) || value.readonly || value.isDragging || !bindings.get(value)?.valid()) return [];
  const selected = [...(value.selection ?? [])], data = value.getData();
  return selected.length && selected.every((node) => value.nodes.get(node.id) === node && isCompactableFile(data, node.getData())) ? selected : [];
}

/** A single native history entry, with the original FileNode and all its edges retained. */
export function setFilesCompact(value: unknown, ids: string[], compact: boolean): boolean {
  if (!hasContract(value) || value.readonly || value.isDragging || !bindings.get(value)?.valid() || !ids.length) return false;
  const data = value.getData();
  const nodes = [...new Set(ids)].map((id) => value.nodes.get(id));
  if (nodes.some((node) => !node || node.isEditing || !isCompactableFile(data, node.getData()))) return false;
  const changes: Array<{ node: MinimalRuntimeNode; next: CanvasNode }> = [];
  for (const node of nodes) {
    if (!node) return false;
    const raw = node.getData(), expanded = expandedFileSize(raw);
    if (!!expanded === compact) continue;
    if (!(typeof raw.width === "number" && raw.width > 0 && Number.isFinite(raw.width) &&
      typeof raw.height === "number" && raw.height > 0 && Number.isFinite(raw.height))) return false;
    const next = { ...raw };
    if (compact) {
      next.feuillets_compact_file = { width: raw.width, height: raw.height, version: 2 };
      next.height = 56;
    } else if (expanded) {
      // Only untouched legacy cards need their former fixed width restored.
      next.width = expanded.version !== 2 && raw.width === 260 ? expanded.width : raw.width;
      next.height = expanded.height;
      delete next.feuillets_compact_file;
    }
    changes.push({ node, next });
  }
  if (!changes.length) return true;
  value.requestPushHistory.run();
  for (const { node, next } of changes) node.setData(next, false);
  bindings.get(value)?.refresh();
  value.requestPushHistory.cancel();
  value.requestSave(false);
  value.pushHistory(value.getData());
  return true;
}

/** Decorations belong to the recognized view, never to global Canvas prototypes. */
export function attachCompactFiles(value: unknown, valid: () => boolean, resolveTitle: (path: string) => string, changed: () => void): { refresh(): void; cleanup(): void } | null {
  if (!hasContract(value)) return null;
  const canvas = value;
  const nodeBindings = new Map<MinimalRuntimeNode, () => void>();
  const decorations = new Map<MinimalRuntimeNode, { container: HTMLElement; title: HTMLElement; name: HTMLElement; cleanup(): void }>();
  let data: CanvasData = { nodes: [], edges: [] };
  let eligible = new Set<string>();
  const clear = (node: MinimalRuntimeNode): void => {
    decorations.get(node)?.cleanup();
    decorations.delete(node);
  };
  const decorate = (node: MinimalRuntimeNode): void => {
    const raw = node.getData();
    if (!eligible.has(node.id) || canvas.nodes.get(node.id) !== node || !isCompactableFile(data, raw) || !expandedFileSize(raw)) {
      clear(node); return;
    }
    const container = node.nodeEl?.querySelector<HTMLElement>(".canvas-node-container");
    if (!container?.createDiv) { clear(node); return; }
    if (decorations.get(node)?.container !== container) clear(node);
    let entry = decorations.get(node);
    if (!entry) {
      const title = container.createDiv({ cls: "feuillets-compact-file-title" });
      const name = title.createSpan({ cls: "feuillets-compact-file-name" });
      entry = { container, title, name, cleanup: () => { title.remove(); node.nodeEl?.classList.remove("feuillets-compact-file"); } };
      decorations.set(node, entry);
    }
    node.nodeEl?.classList.add("feuillets-compact-file");
    const title = resolveTitle(raw.file ?? "") || (raw.file ?? "").split("/").pop()?.replace(/\.md$/i, "") || "";
    if (entry.name.textContent !== title) {
      entry.name.textContent = title;
      entry.title.setAttribute("title", title);
    }
  };
  const refresh = (): void => {
    data = canvas.getData();
    eligible = new Set(data.nodes.filter((node) => isCompactableFile(data, node)).map((node) => node.id));
    for (const [node, restore] of nodeBindings) if (!eligible.has(node.id) || canvas.nodes.get(node.id) !== node) { restore(); nodeBindings.delete(node); }
    for (const node of decorations.keys()) if (!eligible.has(node.id) || canvas.nodes.get(node.id) !== node) clear(node);
    for (const node of canvas.nodes.values()) {
      if (!eligible.has(node.id)) continue;
      if (!nodeBindings.has(node)) {
        const target = node as MinimalRuntimeNode & { render?: () => void; startEditing?: (position?: unknown) => void };
        const original = target.render;
        if (original) {
          const render = (): void => { original.call(target); decorate(target); };
          target.render = render;
          const originalEditing = target.startEditing;
          const startEditing = (position?: unknown): void => {
            // Native double-click editing must reveal the existing Markdown editor.
            if (isCompactableFile(data, target.getData()) && expandedFileSize(target.getData()) && !setFilesCompact(canvas, [target.id], false)) return;
            originalEditing?.call(target, position);
          };
          if (originalEditing) target.startEditing = startEditing;
          nodeBindings.set(node, () => {
            if (target.render === render) target.render = original;
            if (target.startEditing === startEditing) target.startEditing = originalEditing;
          });
        }
      }
      decorate(node);
    }
  };
  bindings.set(canvas, { refresh: () => { refresh(); changed(); }, valid });
  return { refresh, cleanup: () => { bindings.delete(canvas); nodeBindings.forEach((restore) => restore()); nodeBindings.clear(); decorations.forEach((entry) => entry.cleanup()); decorations.clear(); } };
}
