import type { Editor } from "obsidian";
import type { MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import type { CarnetTextStyle } from "./types.js";
import { getNoteEditor } from "./note-size.js";

export const textColors = ["red", "orange", "green", "cyan", "purple"] as const;
export const textAlignments = ["left", "center", "right", "justify"] as const;

export function normalizeTextStyle(value: unknown): CarnetTextStyle | undefined {
  const style = value && typeof value === "object" ? value as Partial<CarnetTextStyle> : undefined;
  const result: CarnetTextStyle = {};
  if (typeof style?.size === "number" && Number.isFinite(style.size)) result.size = Math.min(40, Math.max(12, Math.round(style.size)));
  if (style?.align && style.align !== "left" && textAlignments.includes(style.align)) result.align = style.align;
  if (style?.color && textColors.includes(style.color)) result.color = style.color;
  return Object.keys(result).length ? result : undefined;
}

function decorate(element: HTMLElement | undefined, style: CarnetTextStyle | undefined): boolean {
  if (!element?.style) return false;
  const previous = element.style.cssText;
  element.classList.toggle("feuillets-note-typography", !!style);
  if (style) element.setAttribute("data-feuillets-typography", "true");
  else element.removeAttribute("data-feuillets-typography");
  for (const [name, value] of Object.entries({ size: style?.size ? `${style.size}px` : undefined, align: style?.align, color: style?.color ? `color-mix(in srgb, var(--color-${style.color}) 70%, var(--text-normal))` : undefined })) {
    const property = `--feuillets-text-${name}`;
    if (value) element.style.setProperty(property, value);
    else element.style.removeProperty(property);
  }
  return previous !== element.style.cssText;
}

export function refreshTextStyle(node: MinimalRuntimeNode, eligible = true): boolean {
  const style = eligible ? normalizeTextStyle(node.getData().feuillets_text_style) : undefined;
  const changed = decorate(node.nodeEl, style);
  const mode = node.getData().type === "text" && node.isEditing ? getNoteEditor(node) : undefined;
  if (mode && decorate(mode.cm.dom, style)) {
    mode.cm.requestMeasure({ key: mode, read: () => null, write: () => {} });
  }
  return changed;
}

export function bindTextEditor(node: MinimalRuntimeNode): () => void {
  const mode = getNoteEditor(node);
  if (!mode) return () => {};
  refreshTextStyle(node);
  return () => { decorate(mode.cm.dom, undefined); };
}

type FormattingEditor = Editor & { toggleMarkdownFormatting?: (format: "bold" | "italic" | "strikethrough") => void };
export function getFormattingEditor(node: MinimalRuntimeNode): FormattingEditor | undefined {
  if (!node.isEditing) return undefined;
  const editor = (node as MinimalRuntimeNode & { child?: { editor?: FormattingEditor } }).child?.editor;
  return editor && typeof editor.getSelection === "function" && typeof editor.focus === "function" && typeof editor.toggleMarkdownFormatting === "function" ? editor : undefined;
}

export function formatNoteSelection(node: MinimalRuntimeNode, format: "bold" | "italic" | "strikethrough" | "underline"): boolean {
  const editor = getFormattingEditor(node), text = editor?.getSelection();
  if (!editor || !text) return false;
  if (format === "underline") {
    // Inline HTML stays inline only within a single Markdown paragraph.
    if (text.includes("\n") || typeof editor.replaceSelection !== "function" || typeof editor.getCursor !== "function" ||
      typeof editor.posToOffset !== "function" || typeof editor.offsetToPos !== "function" || typeof editor.setSelection !== "function") return false;
    const start = editor.posToOffset(editor.getCursor("from"));
    editor.replaceSelection(`<u>${text}</u>`);
    editor.setSelection(editor.offsetToPos(start + 3), editor.offsetToPos(start + 3 + text.length));
  } else editor.toggleMarkdownFormatting?.(format);
  editor.focus();
  return true;
}
