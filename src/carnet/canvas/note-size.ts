import type { CanvasData } from "./types.js";
import type { MinimalRuntimeCanvas, MinimalRuntimeNode } from "../../services/canvas-runtime.js";

type NoteEditor = {
  cm: {
    contentDOM: HTMLElement;
    scrollDOM: HTMLElement;
    dom: HTMLElement;
    contentHeight: number;
    state: { doc: { toString(): string } };
    requestMeasure(request: { key: unknown; read(): number | null; write(height: number | null): void }): void;
  };
  iframeEl?: HTMLIFrameElement;
  onUpdate: (update: { docChanged: boolean; geometryChanged: boolean }, changed: boolean) => void;
};

export function getNoteEditor(node: MinimalRuntimeNode): NoteEditor | undefined {
  const mode = (node as MinimalRuntimeNode & { child?: { editMode?: Partial<NoteEditor> } }).child?.editMode;
  return mode?.cm?.contentDOM && typeof mode.cm.requestMeasure === "function" && typeof mode.onUpdate === "function" ? mode as NoteEditor : undefined;
}

type SizedNode = MinimalRuntimeNode & {
  resize: (size: { width: number; height: number }) => void;
  moveAndResize: (rect: { x: number; y: number; width: number; height: number }) => void;
  setIsEditing?: (editing: boolean) => void;
};
type SizeCanvas = MinimalRuntimeCanvas & {
  getData: () => CanvasData;
  requestSave: (history?: boolean) => void;
  requestPushHistory: (() => void) & { run(): void };
  overrideHistory: () => void;
  history: { data: CanvasData[]; current: number };
  isDragging: boolean;
  readonly?: boolean;
};

function canvasFingerprint(data: CanvasData | undefined): string | undefined {
  if (!data) return undefined;
  return JSON.stringify({ ...data, nodes: [...data.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...data.edges].sort((a, b) => a.id.localeCompare(b.id)) });
}

/** Measure the existing Markdown preview synchronously, before the browser paints. */
export function measureNoteSize(node: SizedNode): { width: number; height: number } | null {
  const element = node.nodeEl, preview = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-view");
  const data = node.getData();
  if (!element || !preview || !preview.getClientRects().length || !data.width) return null;
  const scale = element.getBoundingClientRect().width / data.width;
  if (!(scale > 0)) return null;
  const readingRect = preview.getBoundingClientRect();
  const horizontalInset = Math.max(0, data.width - readingRect.width / scale);
  const verticalInset = Math.max(0, (data.height ?? 0) - readingRect.height / scale);
  element.classList.add("feuillets-note-measuring");
  element.classList.toggle("feuillets-note-measuring-auto", data.feuillets_note_width !== "manual");
  try {
    const rect = preview.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { width: data.feuillets_note_width === "manual" ? data.width : Math.max(50, Math.ceil(rect.width / scale + horizontalInset)),
      height: Math.max(50, Math.ceil(rect.height / scale + verticalInset)) };
  } finally { element.classList.remove("feuillets-note-measuring", "feuillets-note-measuring-auto"); }
}

export function attachNoteSizing(value: MinimalRuntimeCanvas, onLiveChange?: (node: MinimalRuntimeNode) => void): { refresh(free: Set<string>): void; update(node: MinimalRuntimeNode): void; cleanup(): void } | null {
  const canvas = value as Partial<SizeCanvas>;
  if (typeof canvas.getData !== "function" || typeof canvas.requestSave !== "function" || typeof canvas.overrideHistory !== "function" ||
    typeof canvas.requestPushHistory?.run !== "function" || !Array.isArray(canvas.history?.data)) return null;
  const runtime = canvas as SizeCanvas;
  const nodes = new Map<SizedNode, { restore(): void; startWidth?: number }>();
  const pending = new Set<SizedNode>();
  const canResize = (node: MinimalRuntimeNode): boolean => !runtime.readonly && !runtime.isDragging && !node.nodeEl?.classList.contains("is-dragging");
  const bindEditor = (node: SizedNode): (() => void) => {
    const mode = getNoteEditor(node);
    if (!mode) return () => {};
    const original = mode.onUpdate, initial = node.getData(), cm = mode.cm;
    let active = true;
    const measure = (): void => {
      cm.requestMeasure({ key: node,
        read: () => {
          if (!active || !node.isEditing || !canResize(node) || !cm.dom.isConnected) return null;
          const css = cm.scrollDOM.ownerDocument.defaultView?.getComputedStyle(cm.scrollDOM);
          const inset = Math.max(0, (node.nodeEl?.offsetHeight ?? node.getData().height ?? 0) - cm.scrollDOM.clientHeight);
          // Native Canvas adds editor spacing through scroller pseudo-elements.
          const spacers = ["::before", "::after"].reduce((height, pseudo) => {
            const style = cm.scrollDOM.ownerDocument.defaultView?.getComputedStyle(cm.scrollDOM, pseudo);
            return height + (style?.content !== "none" ? parseFloat(style?.height ?? "0") || 0 : 0);
          }, 0);
          return Math.max(50, Math.ceil(cm.contentHeight + inset + spacers + (parseFloat(css?.paddingTop ?? "0") || 0) + (parseFloat(css?.paddingBottom ?? "0") || 0)));
        },
        write: (height) => {
          if (!active || !node.isEditing || !canResize(node) || height === null) return;
          const data = node.getData();
          if (data.width && height !== data.height) {
            node.resize({ width: data.width, height });
            cm.scrollDOM.scrollTop = 0;
          }
          onLiveChange?.(node);
        },
      });
    };
    const update: NoteEditor["onUpdate"] = (event, changed) => {
      original.call(mode, event, changed);
      if (event.docChanged || event.geometryChanged) measure();
    };
    mode.onUpdate = update;
    measure();
    return () => {
      active = false;
      if (mode.onUpdate === update) mode.onUpdate = original;
      if (cm.state.doc.toString() === initial.text && initial.width && initial.height && canResize(node)) {
        node.resize({ width: initial.width, height: initial.height });
      }
    };
  };
  const update = (node: MinimalRuntimeNode): void => {
    if (!nodes.has(node as SizedNode) || !canResize(node) || node.isEditing) return;
    const size = measureNoteSize(node as SizedNode), data = node.getData();
    if (!size || (data.width === size.width && data.height === size.height)) return;
    runtime.requestPushHistory.run();
    // Resize only a committed native state; never absorb an unrelated unfinished action.
    if (canvasFingerprint(runtime.history.data[runtime.history.current]) !== canvasFingerprint(runtime.getData())) return;
    (node as SizedNode).resize(size);
    runtime.overrideHistory();
  };
  const originalSave = runtime.requestSave;
  const save: SizeCanvas["requestSave"] = (history?: boolean) => {
    const changed = [...pending]; pending.clear();
    for (const node of changed) {
      const binding = nodes.get(node), data = node.getData();
      if (binding?.startWidth !== undefined && binding.startWidth !== data.width && data.feuillets_note_width !== "manual") {
        node.setData({ ...data, feuillets_note_width: "manual" });
      }
      if (binding) binding.startWidth = undefined;
    }
    originalSave.call(runtime, history);
    for (const node of changed) node.nodeEl?.ownerDocument.defaultView?.requestAnimationFrame(() => update(node));
  };
  runtime.requestSave = save;
  return {
    update,
    refresh: (free) => {
      for (const [node, binding] of nodes) if (!free.has(node.id) || value.nodes?.get(node.id) !== node) { binding.restore(); nodes.delete(node); pending.delete(node); }
      for (const node of value.nodes?.values() ?? []) {
        const sized = node as Partial<SizedNode>;
        if (!free.has(node.id) || nodes.has(node as SizedNode) || typeof sized.resize !== "function" || typeof sized.moveAndResize !== "function") continue;
        const target = node as SizedNode, original = target.moveAndResize;
        const move: SizedNode["moveAndResize"] = (rect) => {
          const data = target.getData(), binding = nodes.get(target);
          if (binding && rect.width !== data.width && target.nodeEl?.classList.contains("is-dragging")) {
            binding.startWidth ??= data.width; pending.add(target);
          }
          original.call(target, rect);
        };
        target.moveAndResize = move;
        const originalEditing = target.setIsEditing;
        let stopEditor = target.isEditing ? bindEditor(target) : undefined;
        const editing = (active: boolean): void => {
          const previous = target.isEditing;
          originalEditing?.call(target, active);
          if (previous === active) return;
          stopEditor?.(); stopEditor = active ? bindEditor(target) : undefined;
        };
        if (originalEditing) target.setIsEditing = editing;
        nodes.set(target, { restore: () => {
          stopEditor?.();
          if (target.setIsEditing === editing) target.setIsEditing = originalEditing;
          if (target.moveAndResize === move) target.moveAndResize = original;
        } });
      }
    },
    cleanup: () => {
      if (runtime.requestSave === save) runtime.requestSave = originalSave;
      nodes.forEach((binding) => binding.restore()); nodes.clear(); pending.clear();
    },
  };
}
