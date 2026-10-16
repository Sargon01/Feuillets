import { normalizeTextStyle } from "../canvas/text-style.js";
import { isFreeNote } from "../canvas/note-style.js";
import { getEdgeAppearance, isEligibleEdge, type Arrows } from "../canvas/edge-style.js";
import type { CanvasData, CanvasNode, CanvasEdge, CarnetNoteStyle, CarnetTextStyle } from "../canvas/types.js";

export type CarnetNoteDefaults = { style?: Exclude<CarnetNoteStyle, "classic">; color?: string; textStyle?: CarnetTextStyle };
export type CarnetEdgeDefaults = NonNullable<CanvasEdge["feuillets_edge_style"]> & { arrows?: Arrows; color?: string };
export type CarnetDefaultStyles = { note?: CarnetNoteDefaults; edge?: CarnetEdgeDefaults };
export const nativeCanvasColors = ["", "1", "2", "3", "4", "5", "6"] as const;

/** Settings are validated separately from Canvas data; no creation override is implicit. */
export function normalizeCarnetDefaultStyles(value: unknown): CarnetDefaultStyles {
  if (!value || typeof value !== "object") return {};
  const input = value as { note?: unknown; edge?: unknown }, result: CarnetDefaultStyles = {};
  if (input.note && typeof input.note === "object") {
    const raw = input.note as CarnetNoteDefaults, note: CarnetNoteDefaults = {};
    if (raw.style && ["plain", "outline", "rounded", "filled"].includes(raw.style)) note.style = raw.style;
    if (typeof raw.color === "string" && nativeCanvasColors.some((color) => color && color === raw.color)) note.color = raw.color;
    let textStyle = normalizeTextStyle(raw.textStyle);
    if (raw.textStyle?.align === "left") textStyle = { ...textStyle, align: "left" };
    if (textStyle) note.textStyle = textStyle;
    if (Object.keys(note).length) result.note = note;
  }
  if (input.edge && typeof input.edge === "object") {
    const raw = input.edge as CarnetEdgeDefaults, edge: CarnetEdgeDefaults = {};
    if (raw.geometry && ["curved", "straight", "map"].includes(raw.geometry)) edge.geometry = raw.geometry;
    if (raw.pattern && ["solid", "dashed", "dotted"].includes(raw.pattern)) edge.pattern = raw.pattern;
    if (raw.width && ["thin", "regular", "thick"].includes(raw.width)) edge.width = raw.width;
    if (raw.arrows && ["none", "start", "end", "both"].includes(raw.arrows)) edge.arrows = raw.arrows;
    if (typeof raw.color === "string" && nativeCanvasColors.some((color) => color && color === raw.color)) edge.color = raw.color;
    if (Object.keys(edge).length) result.edge = edge;
  }
  return result;
}

/** Initialize only missing fields, before the original creation transaction saves. */
export function withNewNoteDefaults(data: CanvasData, node: CanvasNode, defaults: CarnetNoteDefaults | undefined): CanvasNode {
  if (!defaults || !isFreeNote(data, node)) return node;
  const next = { ...node };
  if (next.feuillets_note_style === undefined && defaults.style) next.feuillets_note_style = defaults.style;
  if (next.color === undefined && defaults.color) next.color = defaults.color;
  const textStyle = normalizeTextStyle({ ...defaults.textStyle, ...node.feuillets_text_style });
  if (textStyle) next.feuillets_text_style = textStyle;
  return next;
}

export function withNewEdgeDefaults(data: CanvasData, edge: CanvasEdge, defaults: CarnetEdgeDefaults | undefined): CanvasEdge {
  if (!defaults || !isEligibleEdge(data, edge)) return edge;
  const next = { ...edge }, style = { ...edge.feuillets_edge_style };
  for (const field of ["geometry", "pattern", "width"] as const) if (style[field] === undefined && defaults[field]) Object.assign(style, { [field]: defaults[field] });
  if (Object.keys(style).length) next.feuillets_edge_style = style;
  if (next.color === undefined && defaults.color) next.color = defaults.color;
  // Preserve nonstandard native endpoints already chosen during creation.
  if (defaults.arrows && getEdgeAppearance(edge).arrows === "end") {
    next.fromEnd = defaults.arrows === "start" || defaults.arrows === "both" ? "arrow" : "none";
    next.toEnd = defaults.arrows === "end" || defaults.arrows === "both" ? "arrow" : "none";
  }
  return next;
}
