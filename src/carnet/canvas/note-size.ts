import { stackMembership } from "./dynamic-stack.js";
import type { CanvasNode, CanvasData } from "./types.js";
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
  onUpdate: (update: { docChanged: boolean; geometryChanged: boolean; selectionSet?: boolean }, changed: boolean) => void;
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

function refreshPreviewLayout(node: MinimalRuntimeNode): void {
  const renderer = (node as MinimalRuntimeNode & { child?: { previewMode?: { renderer?: {
    sections?: Array<{ resetCompute?: () => void }>;
    onRender?: () => void;
  } } } }).child?.previewMode?.renderer;
  if (!Array.isArray(renderer?.sections) || typeof renderer.onRender !== "function" ||
    !renderer.sections.every((section) => typeof section.resetCompute === "function")) return;
  // Canvas invalidates these cached block heights on width changes, but not font changes.
  for (const section of renderer.sections) section.resetCompute?.();
  renderer.onRender();
}

/** Measure the existing Markdown preview synchronously, before the browser paints. */
export function measureNoteSize(node: SizedNode, typographyChanged = false): { width: number; height: number } | null {
  const element = node.nodeEl, preview = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-view");
  const data = node.getData();
  if (!element || !preview || !preview.getClientRects().length || !data.width) return null;
  const scale = element.getBoundingClientRect().width / data.width;
  if (!(scale > 0)) return null;
  const readSize = (): { width: number; height: number } => {
    const rect = preview.getBoundingClientRect();
    const css = element.ownerDocument.defaultView?.getComputedStyle?.(preview);
    const width = css?.boxSizing === "border-box" ? parseFloat(css.width) : NaN;
    const height = css?.boxSizing === "border-box" ? parseFloat(css.height) : NaN;
    return { width: Number.isFinite(width) ? width : rect.width / scale,
      height: Number.isFinite(height) ? height : rect.height / scale };
  };
  const reading = readSize();
  const horizontalInset = Math.max(0, data.width - reading.width);
  const verticalInset = Math.max(0, (data.height ?? 0) - reading.height);
  element.classList.add("feuillets-note-measuring");
  element.classList.toggle("feuillets-note-measuring-auto", data.feuillets_note_width !== "manual" && !stackMembership(data));
  try {
    if (typographyChanged) refreshPreviewLayout(node);
    const size = readSize();
    if (!size.width || !size.height) return null;
    return { width: data.feuillets_note_width === "manual" || stackMembership(data) ? data.width : Math.max(50, Math.ceil(size.width + horizontalInset)),
      height: Math.max(50, Math.ceil(size.height + verticalInset)) };
  } finally { element.classList.remove("feuillets-note-measuring", "feuillets-note-measuring-auto"); }
}

export function attachNoteSizing(value: MinimalRuntimeCanvas, onLiveChange?: (node: MinimalRuntimeNode) => void, onEditor?: (node: MinimalRuntimeNode) => (() => void), onSelectionChange?: () => void, geometry?: { geometryChanged(node: MinimalRuntimeNode): void; moved(node: MinimalRuntimeNode, before: CanvasNode): void; beforeSave(): void }): { refresh(free: Set<string>): void; update(node: MinimalRuntimeNode, typographyChanged?: boolean): void; cleanup(): void } | null {
  const canvas = value as Partial<SizeCanvas>;
  if (typeof canvas.getData !== "function" || typeof canvas.requestSave !== "function" || typeof canvas.overrideHistory !== "function" ||
    typeof canvas.requestPushHistory?.run !== "function" || !Array.isArray(canvas.history?.data)) return null;
  const runtime = canvas as SizeCanvas;
  const nodes = new Map<SizedNode, { restore(): void; startWidth?: number; typographyChanged?: boolean }>();
  const pending = new Set<SizedNode>();
  const canResize = (node: MinimalRuntimeNode): boolean => !runtime.readonly && !runtime.isDragging && !node.nodeEl?.classList.contains("is-dragging");
  const bindEditor = (node: SizedNode): (() => void) => {
    const mode = getNoteEditor(node);
    if (!mode) return () => {};
    const cleanupStyle = onEditor?.(node);
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
            const typographyChanged = JSON.stringify(data.feuillets_text_style) !== JSON.stringify(initial.feuillets_text_style);
            const committed = typographyChanged && canvasFingerprint(runtime.history.data[runtime.history.current]) === canvasFingerprint(runtime.getData());
            node.resize({ width: data.width, height });
            cm.scrollDOM.scrollTop = 0;
            if (committed) runtime.overrideHistory();
          }
          onLiveChange?.(node);
        },
      });
    };
    const update: NoteEditor["onUpdate"] = (event, changed) => {
      original.call(mode, event, changed);
      if (event.selectionSet) onSelectionChange?.();
      if (event.docChanged || event.geometryChanged) measure();
    };
    mode.onUpdate = update;
    measure();
    return () => {
      active = false;
      cleanupStyle?.();
      if (mode.onUpdate === update) mode.onUpdate = original;
      if (cm.state.doc.toString() === initial.text && JSON.stringify(node.getData().feuillets_text_style) === JSON.stringify(initial.feuillets_text_style) && initial.width && initial.height && canResize(node)) {
        node.resize({ width: initial.width, height: initial.height });
      }
    };
  };
  const update = (node: MinimalRuntimeNode, typographyChanged = false): void => {
    const binding = nodes.get(node as SizedNode);
    if (!binding) return;
    if (typographyChanged) binding.typographyChanged = true;
    if (!canResize(node) || node.isEditing) return;
    const size = measureNoteSize(node as SizedNode, binding.typographyChanged), data = node.getData();
    if (!size) return;
    if (data.width === size.width && data.height === size.height) { binding.typographyChanged = false; return; }
    runtime.requestPushHistory.run();
    // Resize only a committed native state; never absorb an unrelated unfinished action.
    if (canvasFingerprint(runtime.history.data[runtime.history.current]) !== canvasFingerprint(runtime.getData())) return;
    (node as SizedNode).resize(size);
    runtime.overrideHistory();
    binding.typographyChanged = false;
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
    geometry?.beforeSave();
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
          if (rect.width !== data.width || rect.height !== data.height) geometry?.geometryChanged(target);
          else if (rect.x !== data.x || rect.y !== data.y) geometry?.moved(target, data);
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
