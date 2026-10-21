import { bindTextEditor, normalizeTextStyle, refreshTextStyle, textAlignments, textColors } from "./text-style.js";
import { attachCompactFiles, compactFileSelection, expandedFileSize, hasCompactFiles, isCompactableFile, setFilesCompact } from "./compact-files.js";
import { attachDynamicStacks } from "./dynamic-stack.js";
import { isOrdinaryCard } from "./ordinary-cards.js";
import { attachNoteSizing } from "./note-size.js";
import { attachTextAnchors } from "./text-anchors.js";
import { Menu, Notice, type App, type EventRef, type TFile } from "obsidian";
import { t } from "../../i18n/index.js";
import type { MinimalRuntimeCanvas, MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import type { CanvasData, CanvasNode, CarnetNoteStyle, CarnetTextStyle } from "./types.js";

const styles = ["plain", "outline", "rounded", "filled", "classic"] as const;
const classes = styles.map((style) => `feuillets-note-${style}`);

type StyleCanvas = MinimalRuntimeCanvas & {
  nodes: Map<string, MinimalRuntimeNode>;
  getData(): CanvasData;
  importData: (data: CanvasData, clear: boolean) => unknown;
  requestSave(addHistory?: boolean): void;
  pushHistory(data: CanvasData): void;
  requestPushHistory: (() => void) & { run(): void; cancel(): void };
  readonly?: boolean;
  addNode?: (node: MinimalRuntimeNode) => void;
};

function hasStyleContract(value: unknown): value is StyleCanvas {
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<StyleCanvas>;
  return canvas.nodes instanceof Map && typeof canvas.getData === "function" &&
    typeof canvas.importData === "function" && typeof canvas.requestSave === "function" &&
    typeof canvas.pushHistory === "function" && typeof canvas.requestPushHistory === "function" &&
    typeof canvas.requestPushHistory.run === "function" && typeof canvas.requestPushHistory.cancel === "function";
}

export function isFreeNote(data: CanvasData, node: CanvasNode): boolean {
  return node.type === "text" && isOrdinaryCard(data, node);
}

export function applyNoteStyle(value: unknown, nodeId: string, style: CarnetNoteStyle | undefined): boolean {
  return applyNoteAppearance(value, nodeId, { style });
}

export function applyNoteAppearance(value: unknown, nodeId: string, change: { style?: CarnetNoteStyle; color?: string; textStyle?: CarnetTextStyle }): boolean {
  if (!hasStyleContract(value) || value.readonly) return false;
  const node = value.nodes.get(nodeId);
  const data = value.getData();
  const current = data.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || !current || !isOrdinaryCard(data, current)) return false;
  const next = { ...node.getData() };
  if (Object.prototype.hasOwnProperty.call(change, "style")) {
    if (change.style === undefined) delete next.feuillets_note_style;
    else next.feuillets_note_style = change.style;
  }
  if (change.color !== undefined) {
    if (change.color) next.color = change.color;
    else delete next.color;
  }
  if (Object.prototype.hasOwnProperty.call(change, "textStyle")) {
    const style = normalizeTextStyle(change.textStyle);
    if (style) next.feuillets_text_style = style;
    else delete next.feuillets_text_style;
  }
  if (JSON.stringify(next) === JSON.stringify(node.getData())) return true;
  // Flush the preceding native edit before recording this independent action.
  value.requestPushHistory.run();
  node.setData(next);
  value.requestPushHistory.cancel();
  value.requestSave(false);
  value.pushHistory(value.getData());
  return true;
}

/** Bound by the existing Carnet lifecycle, including native reload and undo. */
export function attachCarnetNoteStyles(canvasValue: unknown, onRefresh?: () => void, files?: { valid(): boolean; title(path: string): string }): { refresh(typographyChanged?: boolean): void; cleanup(): void } | null {
  if (!hasStyleContract(canvasValue)) return null;
  const canvas = canvasValue;
  const decorated = new Set<HTMLElement>();
  let importing = false;
  const stacks = attachDynamicStacks(canvas, () => importing);
  const sizing = attachNoteSizing(canvas, (node) => anchors?.update(node), bindTextEditor, onRefresh, stacks ?? undefined);
  const anchors = attachTextAnchors(canvas, (node) => sizing?.update(node));
  const compact = files ? attachCompactFiles(canvas, () => files.valid(), (path) => files.title(path), () => refresh()) : null;
  const refresh = (typographyChanged = false): void => {
    const data = canvas.getData();
    const current = new Set<HTMLElement>();
    const typographyChanges: MinimalRuntimeNode[] = [];
    const free = new Set(data.nodes.filter((node) => isFreeNote(data, node)).map((node) => node.id));
    for (const node of data.nodes) {
      const runtime = canvas.nodes.get(node.id);
      if (runtime && refreshTextStyle(runtime, isOrdinaryCard(data, node))) typographyChanges.push(runtime);
      const el = runtime?.nodeEl;
      if (!el?.classList) continue;
      current.add(el);
      const style = isOrdinaryCard(data, node) ? (node.feuillets_note_style ?? "plain") : undefined;
      styles.forEach((candidate, index) => el.classList.toggle(classes[index], style === candidate));
      el.classList.toggle("feuillets-markdown-file", isCompactableFile(data, node));
      decorated.add(el);
    }
    for (const el of decorated) if (!current.has(el)) { el.classList.remove(...classes, "feuillets-markdown-file"); decorated.delete(el); }
    compact?.refresh();
    sizing?.refresh(free);
    anchors?.refresh(free);
    for (const node of canvas.nodes.values()) if (free.has(node.id) && (typographyChanged || typographyChanges.includes(node))) sizing?.update(node, true);
    onRefresh?.();
  };
  const originalAdd = canvas.addNode;
  const add = originalAdd ? (node: MinimalRuntimeNode): void => { originalAdd.call(canvas, node); if (!importing) refresh(); } : undefined;
  if (add) canvas.addNode = add;
  const original = canvas.importData;
  const wrapped: StyleCanvas["importData"] = function (data, clear) {
    const previous = importing;
    importing = true;
    let result: unknown;
    try { result = original.call(canvas, data, clear); }
    finally { importing = previous; }
    if (!importing) refresh();
    return result;
  };
  canvas.importData = wrapped;
  return {
    refresh,
    cleanup: () => {
      compact?.cleanup();
      sizing?.cleanup();
      stacks?.cleanup();
      anchors?.cleanup();
      if (canvas.addNode === add) canvas.addNode = originalAdd;
      if (canvas.importData === wrapped) canvas.importData = original;
      for (const node of canvas.nodes.values()) refreshTextStyle(node, false);
      decorated.forEach((el) => el.classList.remove(...classes, "feuillets-markdown-file"));
      decorated.clear();
    },
  };
}

type MenuNode = MinimalRuntimeNode & { canvas?: StyleCanvas & { view?: { file?: TFile | null } } };
type MenuWorkspace = { on(name: "canvas:node-menu", callback: (menu: Menu, node: MenuNode) => void): EventRef };

export function registerCarnetNoteStyleMenu(plugin: {
  app: App;
  registerEvent(event: EventRef): void;
}, isCarnet: (file: TFile | null | undefined) => boolean, refresh: () => void): void {
  const workspace = plugin.app.workspace as unknown as MenuWorkspace;
  const extendedMenus = new WeakSet<Menu>();
  plugin.registerEvent(workspace.on("canvas:node-menu", (menu, node) => {
    const canvas = node.canvas;
    const file = canvas?.view?.file;
    if (extendedMenus.has(menu) || !file || !isCarnet(file) || !hasStyleContract(canvas) || canvas.readonly ||
      canvas.nodes.get(node.id) !== node || !isOrdinaryCard(canvas.getData(), node.getData())) return;
    extendedMenus.add(menu);
    const current = node.getData();
    if (hasCompactFiles(canvas) && isCompactableFile(canvas.getData(), current)) {
      const selected = compactFileSelection(canvas);
      const targets = selected.includes(node) ? selected : [node];
      const collapse = targets.some((target) => !expandedFileSize(target.getData()));
      menu.addItem((item) => item.setTitle(t(collapse ? "carnet.compact.collapse" : "carnet.compact.expand"))
        .setIcon(collapse ? "chevrons-down-up" : "chevrons-up-down").onClick(() => {
          if (!isCarnet(canvas.view?.file) || canvas.view?.file !== file || targets.some((target) => canvas.nodes.get(target.id) !== target)) return;
          if (!setFilesCompact(canvas, targets.map((target) => target.id), collapse)) new Notice(t("carnet.noteStyle.unavailable"));
          refresh();
        }));
    }
    const apply = (change: { style?: CarnetNoteStyle; color?: string; textStyle?: CarnetTextStyle }): void => {
      if (!isCarnet(canvas.view?.file) || canvas.view?.file !== file || canvas.nodes.get(node.id) !== node) return;
      if (Object.prototype.hasOwnProperty.call(change, "textStyle") && node.isEditing) return;
      if (!applyNoteAppearance(canvas, node.id, change)) new Notice(t("carnet.noteStyle.unavailable"));
      refresh();
    };
    menu.addItem((item) => {
      item.setTitle(t("carnet.noteStyle.menu")).setIcon("palette");
      const submenu = (item as typeof item & { setSubmenu(): Menu }).setSubmenu();
      for (const style of ["plain", "outline", "rounded", "filled"] as const) {
        submenu.addItem((choice) => choice
          .setTitle(t(`carnet.noteStyle.menu.${style}`))
          .setChecked((current.feuillets_note_style ?? "plain") === style)
          .onClick(() => apply({ style })));
      }
      submenu.addSeparator();
      submenu.addItem((choice) => choice.setTitle(t("carnet.noteStyle.menu.defaultColor"))
        .setChecked(!current.color).onClick(() => apply({ color: "" })));
      for (const [index, color] of ["red", "orange", "yellow", "green", "cyan", "purple"].entries()) {
        const value = String(index + 1);
        submenu.addItem((choice) => choice.setTitle(t(`carnet.noteStyle.menu.${color}`))
          .setChecked(current.color === value).onClick(() => apply({ color: value })));
      }
    });
    if (node.isEditing) return;
    const textStyle = (): CarnetTextStyle => normalizeTextStyle(node.getData().feuillets_text_style) ?? {};
    const defaultSize = parseFloat(node.contentEl?.ownerDocument.defaultView?.getComputedStyle(node.contentEl).getPropertyValue("--font-text-size") ?? "") || 16;
    const size = (): number => textStyle().size ?? defaultSize;
    const changeText = (patch: CarnetTextStyle): void => apply({ textStyle: { ...textStyle(), ...patch } });
    menu.addItem((item) => {
      item.setTitle(t("carnet.typography.title")).setIcon("type");
      const typography = (item as typeof item & { setSubmenu(): Menu }).setSubmenu();
      typography.addItem((font) => {
        font.setTitle(t("carnet.typography.menuSize", { size: String(size()) }));
        const sizes = (font as typeof font & { setSubmenu(): Menu }).setSubmenu();
        for (const delta of [-1, 1]) sizes.addItem((choice) => choice
          .setTitle(t(delta < 0 ? "carnet.typography.decreaseOne" : "carnet.typography.increaseOne"))
          .setDisabled(delta < 0 ? size() <= 12 : size() >= 40)
          .onClick(() => {
            const next = Math.min(40, Math.max(12, size() + delta));
            changeText({ size: next === defaultSize ? undefined : next });
          }));
        sizes.addSeparator();
        sizes.addItem((choice) => choice.setTitle(t("carnet.typography.defaultSize"))
          .setChecked(textStyle().size === undefined).onClick(() => changeText({ size: undefined })));
        const presets = [12, 14, 16, 18, 20, 24, 32, 40];
        if (textStyle().size !== undefined && !presets.includes(size())) presets.push(size());
        for (const value of presets.sort((a, b) => a - b)) sizes.addItem((choice) => choice
          .setTitle(`${value} px`).setChecked(textStyle().size === value).onClick(() => changeText({ size: value })));
      });
      typography.addItem((alignment) => {
        alignment.setTitle(t("carnet.typography.alignment"));
        const alignments = (alignment as typeof alignment & { setSubmenu(): Menu }).setSubmenu();
        for (const align of textAlignments) alignments.addItem((choice) => choice
          .setTitle(t(`carnet.typography.${align}`)).setChecked((textStyle().align ?? "left") === align)
          .onClick(() => changeText({ align })));
      });
      typography.addItem((color) => {
        color.setTitle(t("carnet.typography.color"));
        const colors = (color as typeof color & { setSubmenu(): Menu }).setSubmenu();
        colors.addItem((choice) => choice.setTitle(t("carnet.typography.defaultColor"))
          .setChecked(textStyle().color === undefined).onClick(() => changeText({ color: undefined })));
        for (const value of textColors) colors.addItem((choice) => choice
          .setTitle(t(`carnet.typography.${value}`)).setChecked(textStyle().color === value)
          .onClick(() => changeText({ color: value })));
      });
    });
  }));
}
