import { t } from "../i18n/index.js";
import { normalizeCarnetDefaultStyles, nativeCanvasColors, type CarnetDefaultStyles, type CarnetNoteDefaults, type CarnetEdgeDefaults } from "../carnet/core/default-styles.js";
import { textAlignments, textColors } from "../carnet/canvas/text-style.js";
import { setIcon } from "obsidian";
import { createCarnetSection } from "./carnet-section.js";

/** Future-object preferences never invoke a live selection styling transaction. */
export class CarnetDefaultStylesContent {
  private updates: Array<(force: boolean) => void> = [];

  constructor(private host: HTMLElement, private settings: () => FeuilletsSettings, private save: () => Promise<void>) {
    host.createDiv({ cls: "feuillets-notes-sub", text: t("carnet.defaults.description") });
    const note = createCarnetSection(host, settings, save, "defaults.cards", t("carnet.defaults.cards"), "type", true, true);
    this.select(note, "style", t("carnet.noteStyle.title"), ["plain", "outline", "rounded", "filled"] as const,
      (value) => t(`carnet.noteStyle.${value}`), () => this.current().note?.style ?? "", (style) => this.note({ style }));
    this.colors(note, "cardColor", t("carnet.workspace.cardColor"), nativeCanvasColors,
      (color) => t("carnet.workspace.cardColorValue", { color: t(`carnet.workspace.color${color || "Default"}`) }), () => this.current().note?.color ?? "", (color) => this.note({ color }));
    this.colors(note, "textColor", t("carnet.typography.color"), ["", ...textColors] as const,
      (color) => t("carnet.workspace.textColor", { color: t(`carnet.typography.${color || "defaultColor"}`) }), () => this.current().note?.textStyle?.color ?? "",
      (color) => this.note({ textStyle: { ...this.current().note?.textStyle, color: color || undefined } }));
    const font = this.row(note, t("carnet.typography.size"));
    const size = font.createDiv({ cls: "feuillets-carnets-font-size" });
    const symbol = size.createSpan({ cls: "feuillets-notes-section-icon", attr: { "aria-hidden": "true" } });
    setIcon(symbol, "type");
    const input = size.createEl("input", { type: "number", attr: { min: "12", max: "40", step: "1", "aria-label": t("carnet.typography.size"), "data-default-field": "size", placeholder: t("carnet.defaults.themeSize"), title: t("carnet.typography.defaultSize") } });
    input.addEventListener("change", () => {
      const value = input.value.trim(), size = value ? Number(value) : undefined;
      if (size !== undefined && !Number.isFinite(size)) { this.refresh(true); return; }
      this.note({ textStyle: { ...this.current().note?.textStyle, size } });
      this.refresh(true);
    });
    this.updates.push((force) => { if (force || input.ownerDocument.activeElement !== input) input.value = String(this.current().note?.textStyle?.size ?? ""); });
    this.select(note, "align", t("carnet.typography.alignment"), textAlignments, (value) => t(`carnet.typography.${value}`),
      () => this.current().note?.textStyle?.align ?? "", (align) => this.note({ textStyle: { ...this.current().note?.textStyle, align } }));

    const edge = createCarnetSection(host, settings, save, "defaults.connections", t("carnet.defaults.connections"), "git-branch", true, true);
    this.select(edge, "geometry", t("carnet.edgeStyle.geometry"), ["curved", "straight", "map"] as const,
      (value) => t(`carnet.edgeStyle.${value}`), () => this.current().edge?.geometry ?? "", (geometry) => this.edge({ geometry }));
    this.select(edge, "pattern", t("carnet.edgeStyle.line"), ["solid", "dashed", "dotted"] as const,
      (value) => t(`carnet.edgeStyle.${value}`), () => this.current().edge?.pattern ?? "", (pattern) => this.edge({ pattern }));
    this.select(edge, "width", t("carnet.edgeStyle.width"), ["thin", "regular", "thick"] as const,
      (value) => t(`carnet.edgeStyle.${value}`), () => this.current().edge?.width ?? "", (width) => this.edge({ width }));
    this.select(edge, "arrows", t("carnet.edgeStyle.arrows"), ["none", "start", "end", "both"] as const,
      (value) => t(`carnet.edgeStyle.${value}`), () => this.current().edge?.arrows ?? "", (arrows) => this.edge({ arrows }));
    this.colors(edge, "edgeColor", t("carnet.workspace.canvasColors"), nativeCanvasColors,
      (color) => t("carnet.workspace.edgeColorValue", { color: t(`carnet.workspace.color${color || "Default"}`) }), () => this.current().edge?.color ?? "", (color) => this.edge({ color }));
    const footer = host.createDiv({ cls: "feuillets-carnets-default-reset" });
    const restore = footer.createEl("button", { cls: "feuillets-carnets-action", attr: { type: "button" } });
    setIcon(restore, "rotate-ccw");
    restore.createSpan({ text: t("carnet.defaults.restore") });
    restore.addEventListener("mousedown", (event) => event.preventDefault());
    restore.addEventListener("click", () => { this.settings().carnetDefaultStyles = {}; this.persist(); this.refresh(true); });
    this.refresh();
  }

  private current(): CarnetDefaultStyles { return normalizeCarnetDefaultStyles(this.settings().carnetDefaultStyles); }
  private persist(): void { this.refresh(); void this.save(); }
  private note(patch: CarnetNoteDefaults): void {
    const current = this.current();
    this.settings().carnetDefaultStyles = normalizeCarnetDefaultStyles({ ...current, note: { ...current.note, ...patch } });
    this.persist();
  }
  private edge(patch: CarnetEdgeDefaults): void {
    const current = this.current();
    this.settings().carnetDefaultStyles = normalizeCarnetDefaultStyles({ ...current, edge: { ...current.edge, ...patch } });
    this.persist();
  }
  private row(parent: HTMLElement, title: string): HTMLElement {
    const row = parent.createDiv({ cls: "feuillets-properties-row feuillets-edition-row feuillets-carnets-default-property", attr: { role: "group", "aria-label": title } });
    row.createSpan({ cls: "feuillets-properties-key", text: title });
    return row.createDiv({ cls: "feuillets-edition-row-control" });
  }
  private select<Value extends string>(parent: HTMLElement, field: string, title: string, values: readonly Value[], label: (value: Value) => string, current: () => string, change: (value: Value | undefined) => void): void {
    const control = this.row(parent, title).createDiv({ cls: "feuillets-carnets-select" });
    const select = control.createEl("select", { attr: { "aria-label": title, "data-default-field": field } });
    const chevron = control.createSpan({ cls: "feuillets-notes-section-icon", attr: { "aria-hidden": "true" } });
    setIcon(chevron, "chevron-down");
    select.createEl("option", { text: t("carnet.defaults.original"), value: "" });
    for (const value of values) select.createEl("option", { text: label(value), value });
    select.addEventListener("change", () => change(values.find((value) => value === select.value)));
    this.updates.push(() => { select.value = current(); });
  }
  private colors<Value extends string>(parent: HTMLElement, field: string, title: string, values: readonly Value[], label: (value: Value) => string, current: () => string, change: (value: Value) => void): void {
    const control = this.row(parent, title);
    control.classList.add("feuillets-carnets-color-control");
    const row = control.createDiv({ cls: "feuillets-appearance-row" });
    for (const value of values) {
      const button = row.createEl("button", { cls: "clickable-icon feuillets-carnets-swatch", attr: { title: label(value), "aria-label": label(value), "data-default-field": field, "data-default-value": value } });
      if (field === "textColor") {
        if (value) button.setAttribute("data-text-color", value);
        button.createSpan({ cls: "feuillets-carnets-color-sample feuillets-carnets-text-sample", text: "A", attr: { "aria-hidden": "true" } });
      } else {
        button.setAttribute("data-canvas-color", value);
        button.createSpan({ cls: "feuillets-carnets-color-sample feuillets-carnets-canvas-sample", attr: { "aria-hidden": "true" } });
      }
      if (!value) {
        button.classList.add("feuillets-carnets-color-reset");
        button.createSpan({ text: t("carnet.defaults.original") });
      }
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => change(value));
      this.updates.push(() => {
        const selected = current() === value, pressed = String(selected);
        if (button.getAttribute("aria-pressed") === pressed) return;
        button.setAttribute("aria-pressed", pressed);
        button.classList.toggle("is-active", selected);
      });
    }
  }
  refresh(force = false): void { this.updates.forEach((update) => update(force)); }
}
