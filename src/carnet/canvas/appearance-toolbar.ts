import { Notice, setIcon, setTooltip } from "obsidian";
import { t } from "../../i18n/index.js";
import type { MinimalRuntimeEdge, MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import { applyEdgeStyle, getEdgeAppearance, isEligibleEdge } from "./edge-style.js";
import { applyNoteAppearance, applyNoteStyle, isFreeNote } from "./note-style.js";
import { canStackDynamically, canUnstackDynamically, stackDynamically, unstackDynamically } from "./dynamic-stack.js";
import { canStackNotes, stackNotes } from "./stack-notes.js";
import { formatNoteSelection, getFormattingEditor, normalizeTextStyle, textAlignments, textColors } from "./text-style.js";
import type { CanvasData, CarnetTextStyle } from "./types.js";

type Selection = { kind: "note"; target: MinimalRuntimeNode } | { kind: "edge"; target: MinimalRuntimeEdge };
type ToolbarCanvas = {
  nodes: Map<string, MinimalRuntimeNode>;
  edges: Map<string, MinimalRuntimeEdge>;
  selection: Set<MinimalRuntimeNode | MinimalRuntimeEdge>;
  getData(): CanvasData;
  menu: { menuEl: HTMLElement; render: (changed?: boolean) => void };
  readonly?: boolean;
  isDragging?: boolean;
  wrapperEl?: HTMLElement;
};

function hasToolbar(value: unknown): value is ToolbarCanvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<ToolbarCanvas>;
  return canvas.nodes instanceof Map && canvas.edges instanceof Map && canvas.selection instanceof Set &&
    typeof canvas.getData === "function" && typeof canvas.menu?.render === "function" &&
    typeof canvas.menu.menuEl?.appendChild === "function";
}

function selected(canvas: ToolbarCanvas): Selection | null {
  if (canvas.readonly || canvas.isDragging || canvas.selection.size !== 1) return null;
  const [target] = canvas.selection, data = canvas.getData(), raw = target.getData();
  if (canvas.nodes.get(raw.id) === target) {
    const node = data.nodes.find((candidate) => candidate.id === raw.id);
    return node && isFreeNote(data, node) ? { kind: "note", target: target as MinimalRuntimeNode } : null;
  }
  const edge = data.edges.find((candidate) => candidate.id === raw.id);
  return canvas.edges.get(raw.id) === target && edge && isEligibleEdge(data, edge) ? { kind: "edge", target } : null;
}

/** Extend only this view's native selection toolbar; native rendering owns its lifetime. */
export function attachAppearanceToolbar(value: unknown, refreshStyles: () => void, isActive: () => boolean): { refresh(): void; cleanup(): void } | null {
  if (!hasToolbar(value)) return null;
  const canvas = value, menu = canvas.menu, original = menu.render;
  let button: HTMLButtonElement | undefined, panel: HTMLElement | undefined, editing: Selection | null = null;
  let typographyButton: HTMLButtonElement | undefined, typography = false;
  let panelEditor: ReturnType<typeof getFormattingEditor>;
  let stackButton: HTMLButtonElement | undefined;
  const dynamicButtons = new Map<string, HTMLButtonElement>();
  let nativeDirection: HTMLButtonElement | undefined;
  const close = (): void => { panel?.remove(); panel = undefined; editing = null; panelEditor = undefined; updateChoices = undefined; button?.classList.remove("is-active"); typographyButton?.classList.remove("is-active"); };
  const fitPanel = (): void => {
    const win = panel?.ownerDocument?.defaultView;
    if (!panel || !win) return;
    const bounds = canvas.wrapperEl?.getBoundingClientRect() ?? { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
    const inset = parseFloat(win.getComputedStyle(panel).paddingLeft) || 0;
    panel.style.setProperty("--feuillets-panel-width", `${Math.max(0, bounds.right - bounds.left - 2 * inset)}px`);
    panel.style.setProperty("--feuillets-panel-height", `${Math.max(0, bounds.bottom - bounds.top - 2 * inset)}px`);
    panel.style.removeProperty("translate");
    const rect = panel.getBoundingClientRect();
    const x = Math.max(bounds.left + inset, Math.min(rect.left, bounds.right - inset - rect.width)) - rect.left;
    const y = Math.max(bounds.top + inset, Math.min(rect.top, bounds.bottom - inset - rect.height)) - rect.top;
    panel.style.translate = `${x}px ${y}px`;
  };
  const same = (a: Selection | null, b: Selection | null): boolean => !!a && !!b && a.kind === b.kind && a.target === b.target;
  let updateChoices: (() => void) | undefined;
  const open = (selection: Selection, text = false): void => {
    close();
    typography = text;
    editing = selection;
    panelEditor = text && selection.kind === "note" ? getFormattingEditor(selection.target) : undefined;
    const id = selection.target.getData().id;
    panel = menu.menuEl.createDiv({ cls: "canvas-submenu feuillets-appearance-panel", attr: { role: "toolbar", "aria-label": t(text ? "carnet.typography.title" : selection.kind === "note" ? "carnet.appearance.note" : "carnet.edgeStyle.title") } });
    const content = panel;
    const choices: Array<{ element: HTMLButtonElement; active: () => boolean }> = [];
    const group = (name: string, label: string): HTMLElement => content.createDiv({ cls: "feuillets-appearance-row", attr: { role: "group", "aria-label": label, "data-appearance-group": name } });
    const option = (parent: HTMLElement, field: string, value: string, title: string, active: () => boolean, apply: () => boolean): HTMLButtonElement => {
      const control = parent.createEl("button", { cls: "clickable-icon feuillets-appearance-option", attr: { "aria-label": title, "data-appearance-field": field, "data-appearance-value": value } });
      setTooltip(control, title, { placement: "top" });
      control.addEventListener("mousedown", (event) => event.preventDefault());
      control.addEventListener("click", () => {
        if (!same(selection, selected(canvas)) || !isActive()) { close(); return; }
        if (!active() && !apply()) new Notice(t(selection.kind === "note" ? "carnet.noteStyle.unavailable" : "carnet.edgeStyle.unavailable"));
        refreshStyles();
        updateChoices?.();
      });
      choices.push({ element: control, active });
      return control;
    };
    if (selection.kind === "note" && text) {
      const current = () => normalizeTextStyle(selection.target.getData().feuillets_text_style) ?? {};
      const change = (patch: CarnetTextStyle | undefined): boolean => applyNoteAppearance(canvas, id, { textStyle: patch });
      const font = group("font", t("carnet.typography.size"));
      const defaultSize = parseFloat(selection.target.contentEl?.ownerDocument.defaultView?.getComputedStyle(selection.target.contentEl).getPropertyValue("--font-text-size") ?? "") || 16;
      const size = () => current().size ?? defaultSize;
      const resizeText = (delta: number): boolean => {
        const next = Math.min(40, Math.max(12, size() + delta));
        return change({ ...current(), size: next === defaultSize ? undefined : next });
      };
      const decrease = option(font, "size", "decrease", t("carnet.typography.decrease"), () => size() <= 12, () => resizeText(-2)); setIcon(decrease, "minus");
      const label = option(font, "size", "default", t("carnet.typography.defaultSize"), () => current().size === undefined, () => change({ ...current(), size: undefined }));
      const increase = option(font, "size", "increase", t("carnet.typography.increase"), () => size() >= 40, () => resizeText(2)); setIcon(increase, "plus");
      const align = group("align", t("carnet.typography.alignment"));
      for (const value of textAlignments) setIcon(option(align, "align", value, t(`carnet.typography.${value}`), () => (current().align ?? "left") === value, () => change({ ...current(), align: value })), `align-${value}`);
      const colors = group("textColor", t("carnet.typography.color"));
      setIcon(option(colors, "textColor", "default", t("carnet.typography.defaultColor"), () => current().color === undefined, () => change({ ...current(), color: undefined })), "baseline");
      for (const color of textColors) {
        const control = option(colors, "textColor", color, t(`carnet.typography.${color}`), () => current().color === color, () => change({ ...current(), color }));
        control.setAttribute("data-text-color", color); setIcon(control, "baseline");
      }
      const editor = panelEditor;
      if (editor) {
        const formats = group("format", t("carnet.typography.selection"));
        for (const format of ["bold", "italic", "strikethrough", "underline"] as const) {
          const control = option(formats, "format", format, t(`carnet.typography.${format}`), () => false, () => !editor.getSelection() || formatNoteSelection(selection.target, format));
          setIcon(control, format);
          choices.push({ element: control, active: () => { control.disabled = !editor.getSelection() || (format === "underline" && editor.getSelection().includes("\n")); return false; } });
        }
      }
      choices.push({ element: label, active: () => { label.textContent = String(size()); return current().size === undefined; } });
    } else if (selection.kind === "note") {
      const row = group("style", t("carnet.noteStyle.title"));
      for (const style of ["plain", "outline", "rounded", "filled", "classic"] as const) {
        const control = option(row, "style", style, t(`carnet.noteStyle.${style}`), () => (selection.target.getData().feuillets_note_style ?? "plain") === style,
          () => applyNoteStyle(canvas, id, style));
        if (style === "plain" || style === "classic") setIcon(control, style === "plain" ? "type" : "sticky-note");
        else {
          const svg = control.createSvg("svg", { attr: { viewBox: "0 0 32 24", "aria-hidden": "true" } });
          svg.createSvg("rect", { attr: { x: "3", y: "4", width: "26", height: "16", rx: style === "rounded" ? "4" : "0", fill: style === "filled" ? "currentColor" : "none", "fill-opacity": "0.2", stroke: "currentColor", "stroke-width": "1.5" } });
          svg.createSvg("path", { attr: { d: "M8 10 H24 M8 14 H20", fill: "none", stroke: "currentColor", "stroke-width": "1.5" } });
        }
      }
    } else {
      const preview = (control: HTMLButtonElement, field: string, value: string): void => {
        const svg = control.createSvg("svg", { attr: { viewBox: "0 0 32 24", "aria-hidden": "true" } });
        const widths: Record<string, string> = { thin: "1.25", regular: "2", thick: "3" };
        const patterns: Record<string, string> = { solid: "none", dashed: "4 3", dotted: "0.5 4" };
        const width = field === "width" ? widths[value] ?? "1.25" : "1.5";
        const dash = field === "pattern" ? patterns[value] ?? "none" : "none";
        svg.createSvg("path", { attr: { d: "M3 12 H29", fill: "none", stroke: "currentColor", "stroke-width": width, "stroke-dasharray": dash, "stroke-linecap": "round" } });
        if (field === "arrows") {
          if (value === "start" || value === "both") svg.createSvg("path", { attr: { d: "M8 7 L3 12 L8 17", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linejoin": "round" } });
          if (value === "end" || value === "both") svg.createSvg("path", { attr: { d: "M24 7 L29 12 L24 17", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linejoin": "round" } });
        }
      };
      const patterns = group("pattern", t("carnet.edgeStyle.line"));
      for (const pattern of ["solid", "dashed", "dotted"] as const) preview(option(patterns, "pattern", pattern, t(`carnet.edgeStyle.${pattern}`),
        () => getEdgeAppearance(selection.target.getData()).pattern === pattern, () => applyEdgeStyle(canvas, id, { pattern })), "pattern", pattern);
      const widths = group("width", t("carnet.edgeStyle.width"));
      for (const width of ["thin", "regular", "thick"] as const) preview(option(widths, "width", width, t(`carnet.edgeStyle.${width}`),
        () => getEdgeAppearance(selection.target.getData()).width === width, () => applyEdgeStyle(canvas, id, { width })), "width", width);
      const arrows = group("arrows", t("carnet.edgeStyle.arrows"));
      for (const ends of ["none", "start", "end", "both"] as const) preview(option(arrows, "arrows", ends, t(`carnet.edgeStyle.${ends}`),
        () => getEdgeAppearance(selection.target.getData()).arrows === ends, () => applyEdgeStyle(canvas, id, { arrows: ends })), "arrows", ends);
    }
    updateChoices = () => {
      for (const { element, active } of choices) {
        const checked = active();
        element.classList.toggle("is-active", checked);
        element.setAttribute("aria-pressed", String(checked));
      }
    };
    updateChoices();
    content.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    (text ? typographyButton : button)?.classList.add("is-active");
    fitPanel();
  };
  const releaseButton = (): void => {
    if (button?.parentElement === menu.menuEl && nativeDirection) button.replaceWith(nativeDirection);
    else button?.remove();
    button = undefined; nativeDirection = undefined;
    typographyButton?.remove(); typographyButton = undefined;
  };
  const refresh = (): void => {
    if (!isActive() || !menu.menuEl.isConnected || !canStackNotes(canvas)) {
      stackButton?.remove(); stackButton = undefined;
    } else if (!stackButton || stackButton.parentElement !== menu.menuEl) {
      stackButton?.remove();
      stackButton = menu.menuEl.createEl("button", { cls: "clickable-icon feuillets-stack-notes-button", attr: { "aria-label": t("carnet.stackNotes.title") } });
      setIcon(stackButton, "rows-3"); setTooltip(stackButton, t("carnet.stackNotes.title"), { placement: "top" });
      stackButton.addEventListener("click", () => {
        if (!stackNotes(canvas, isActive)) new Notice(t("carnet.stackNotes.unavailable"));
      });
    }
    for (const action of [
      { key: "title", icon: "list-start", eligible: canStackDynamically, apply: stackDynamically },
      { key: "dissociate", icon: "unlink", eligible: canUnstackDynamically, apply: unstackDynamically },
    ] as const) {
      const existing = dynamicButtons.get(action.key);
      if (!isActive() || !menu.menuEl.isConnected || !action.eligible(canvas)) {
        existing?.remove(); dynamicButtons.delete(action.key);
      } else if (!existing || existing.parentElement !== menu.menuEl) {
        existing?.remove();
        const label = t(`carnet.dynamicStack.${action.key}`);
        const control = menu.menuEl.createEl("button", { cls: `clickable-icon feuillets-dynamic-stack-${action.key}`, attr: { "aria-label": label } });
        setIcon(control, action.icon); setTooltip(control, label, { placement: "top" });
        control.addEventListener("mousedown", (event) => event.preventDefault());
        control.addEventListener("click", () => {
          if (!action.apply(canvas, isActive)) new Notice(t("carnet.stackNotes.unavailable"));
          refreshStyles(); refresh();
        });
        dynamicButtons.set(action.key, control);
      }
    }
    const selection = selected(canvas);
    if (panel && typography && editing?.kind === "note" && panelEditor !== getFormattingEditor(editing.target)) close();
    if (editing && (!same(editing, selection) || !isActive() || !panel?.isConnected)) close();
    if (!selection || !menu.menuEl.isConnected) { close(); releaseButton(); return; }
    if (!button || button.parentElement !== menu.menuEl) {
      releaseButton();
      const direction = selection.kind === "edge" ? menu.menuEl.querySelector<HTMLButtonElement>("button:has(svg.line-horizontal, svg.lucide-arrow-right, svg.lucide-move-horizontal)") : null;
      button = menu.menuEl.createEl("button", { cls: "clickable-icon feuillets-appearance-button" });
      if (direction) { direction.replaceWith(button); nativeDirection = direction; }
      setIcon(button, "sliders-horizontal");
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => { const target = selected(canvas); if (panel && !typography) close(); else if (target) open(target); });
    }
    button.setAttribute("aria-label", t(selection.kind === "note" ? "carnet.appearance.note" : "carnet.edgeStyle.title"));
    button.setAttribute("data-appearance-kind", selection.kind);
    button.setAttribute("data-tooltip-position", "top");
    if (selection.kind === "note" && (!typographyButton || typographyButton.parentElement !== menu.menuEl)) {
      typographyButton?.remove();
      typographyButton = menu.menuEl.createEl("button", { cls: "clickable-icon feuillets-typography-button", attr: { "aria-label": t("carnet.typography.title") } });
      setIcon(typographyButton, "type"); setTooltip(typographyButton, t("carnet.typography.title"), { placement: "top" });
      typographyButton.addEventListener("mousedown", (event) => event.preventDefault());
      typographyButton.addEventListener("click", () => { const target = selected(canvas); if (panel && typography) close(); else if (target?.kind === "note") open(target, true); });
    } else if (selection.kind !== "note") { typographyButton?.remove(); typographyButton = undefined; }
    button.classList.toggle("is-active", !!panel && !typography);
    typographyButton?.classList.toggle("is-active", !!panel && typography);
    if (panel) { updateChoices?.(); fitPanel(); }
  };
  const outside = (event: Event): void => {
    const path = event.composedPath();
    if (panel && !path.includes(panel) && !(button && path.includes(button)) && !(typographyButton && path.includes(typographyButton))) close();
  };
  const host = canvas.wrapperEl ?? menu.menuEl;
  host.addEventListener("pointerdown", outside, true);
  const wrapped: typeof menu.render = function (changed) {
    const retained = panel;
    original.call(menu, changed);
    if (retained && same(editing, selected(canvas)) && isActive() && menu.menuEl.isConnected && retained.parentElement !== menu.menuEl) menu.menuEl.appendChild(retained);
    refresh();
  };
  menu.render = wrapped;
  return { refresh, cleanup: () => {
    stackButton?.remove(); stackButton = undefined;
    dynamicButtons.forEach((control) => control.remove()); dynamicButtons.clear();
    close(); releaseButton(); host.removeEventListener("pointerdown", outside, true);
    if (menu.render === wrapped) { menu.render = original; if (menu.menuEl.isConnected) original.call(menu, true); }
  } };

}
