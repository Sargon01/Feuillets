import { Menu, Notice, type App, type EventRef, type TFile } from "obsidian";
import { t } from "../../i18n/index.js";
import type { MinimalRuntimeNode } from "../../services/canvas-runtime.js";
import { canStackNotes, stackNotes, type StackCanvas } from "./stack-notes.js";
import { canStackDynamically, canUnstackDynamically, stackDynamically, unstackDynamically } from "./dynamic-stack.js";
import { hasOrdinaryCardOwnership } from "./ordinary-cards.js";
import type { CanvasNode } from "./types.js";

type ArrangementCanvas = Pick<StackCanvas, "nodes" | "selection" | "getData" | "readonly" | "isDragging" | "isHoldingSpace"> & {
  view?: { file?: TFile | null };
  wrapperEl: HTMLElement;
  menu: { menuEl: HTMLElement; render(changed?: boolean): void };
  getContainingNodes?: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => MinimalRuntimeNode[];
};
type NativeItem = {
  titleEl?: HTMLElement;
  iconEl?: HTMLElement;
  section?: string;
  callback?: (event: MouseEvent | KeyboardEvent) => unknown;
  submenu?: Menu;
};
type Action = { title: string; icon: string; section: string; run: (event: MouseEvent | KeyboardEvent) => unknown };
type Group = "align" | "arrange" | "distribute" | "stack";
const iconKey = (icon: string): string => icon.replace(/^lucide-/, "");

function hasArrangementContract(value: unknown): value is ArrangementCanvas {
  // Native layout does not require the stacking transaction's history snapshot.
  if (!value || typeof value !== "object") return false;
  const canvas = value as Partial<ArrangementCanvas>;
  return canvas.nodes instanceof Map && canvas.selection instanceof Set && typeof canvas.getData === "function" &&
    typeof canvas.menu?.render === "function" && typeof canvas.menu.menuEl?.appendChild === "function" &&
    typeof canvas.wrapperEl?.isConnected === "boolean";
}

function eligibleSelection(canvas: ArrangementCanvas): boolean {
  if (canvas.readonly || canvas.isDragging || canvas.isHoldingSpace || !canvas.wrapperEl.isConnected || !canvas.selection.size) return false;
  const data = canvas.getData();
  const free = (raw: CanvasNode): boolean => ["text", "file", "link", "group"].includes(raw.type ?? "") && hasOrdinaryCardOwnership(data, raw);
  for (const node of canvas.selection) {
    const raw = data.nodes.find((candidate) => candidate.id === node.id);
    if (canvas.nodes.get(node.id) !== node || !raw || !free(raw) || node.isEditing || node.nodeEl?.classList.contains("is-dragging")) return false;
    if (raw.type === "group") {
      const bounds = node.getBBox?.();
      if (!bounds || !canvas.getContainingNodes || canvas.getContainingNodes(bounds).some((member) => member !== node && !free(member.getData()))) return false;
    }
  }
  return true;
}

function actions(menu: Menu): Action[] {
  const items = (menu as Menu & { items?: unknown[] }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as NativeItem;
    const title = item.titleEl?.textContent ?? "";
    const icon = Array.from(item.iconEl?.querySelector("svg")?.classList ?? []).find((name) => name !== "svg-icon") ?? "";
    const own = typeof item.callback === "function" && title ? [{ title, icon, section: item.section ?? "", run: item.callback }] : [];
    return [...own, ...(item.submenu ? actions(item.submenu) : [])];
  });
}

/** Native layout functions are private closures in the toolbar's menu builder. */
function nativeArrangementActions(canvas: ArrangementCanvas): Action[] {
  canvas.menu.render(true);
  const button = canvas.menu.menuEl.querySelector<HTMLButtonElement>("button:has(svg.lucide-align-start-vertical)");
  if (!button) return [];
  const original = Object.getOwnPropertyDescriptor(Menu.prototype, "showAtPosition")?.value as Menu["showAtPosition"] | undefined;
  if (typeof original !== "function") return [];
  const captured: Menu[] = [];
  // Capture only this button's popup synchronously; the right-click menu is untouched.
  Menu.prototype.showAtPosition = function (this: Menu, ...args: Parameters<Menu["showAtPosition"]>): Menu {
    if ((this as Menu & { parentEl?: HTMLElement }).parentEl === button) { captured.push(this); return this; }
    original.apply(this, args);
    return this;
  };
  const parent = button.parentNode, next = button.nextSibling;
  try {
    // Canvas suppresses trailing clicks after marquee selection. Discover the
    // native callbacks outside that ancestor guard, without consuming it.
    button.remove();
    button.click();
  } finally {
    Menu.prototype.showAtPosition = original;
    if (parent) parent.insertBefore(button, next);
  }
  return captured.length ? actions(captured[0]) : [];
}

/** Share the native menu closures and existing stacking transactions with the inspector. */
export function getCarnetArrangementActions(value: unknown, valid: () => boolean): Action[] {
  if (!hasArrangementContract(value) || !eligibleSelection(value)) return [];
  const canvas = value;
  const result = canvas.selection.size >= 2 ? nativeArrangementActions(canvas)
    .filter((action) => action.section !== "distribute" || canvas.selection.size >= 3).map((action) => ({
    ...action,
    title: iconKey(action.icon) === "stretch-vertical" ? t("carnet.arrangement.justifyVertical") : action.title,
    run: (event: MouseEvent | KeyboardEvent) => { if (valid() && eligibleSelection(canvas)) return action.run(event); },
  })) : [];
  for (const action of [
    { title: t("carnet.stackNotes.title"), icon: "rows-3", eligible: canStackNotes, apply: stackNotes },
    { title: t("carnet.dynamicStack.title"), icon: "list-start", eligible: canStackDynamically, apply: stackDynamically },
    { title: t("carnet.dynamicStack.dissociate"), icon: "unlink", eligible: canUnstackDynamically, apply: unstackDynamically },
  ]) if (action.eligible(canvas)) result.push({ title: action.title, icon: action.icon, section: "stack", run: () => {
    if (valid() && eligibleSelection(canvas) && !action.apply(canvas, valid)) new Notice(t("carnet.stackNotes.unavailable"));
  } });
  return result;
}

type MenuWorkspace = {
  on(name: "canvas:selection-menu", callback: (menu: Menu, canvas: unknown) => void): EventRef;
  on(name: "canvas:node-menu", callback: (menu: Menu, node: MinimalRuntimeNode & { canvas?: unknown }) => void): EventRef;
};

export function registerCarnetArrangementMenu(plugin: { app: App; registerEvent(event: EventRef): void }, isCarnet: (file: TFile | null | undefined) => boolean): void {
  const workspace = plugin.app.workspace as unknown as MenuWorkspace;
  const extended = new WeakSet<Menu>();
  const extend = (menu: Menu, value: unknown): void => {
    if (extended.has(menu) || !hasArrangementContract(value)) return;
    const canvas = value, file = canvas.view?.file;
    if (!file || !isCarnet(file) || !eligibleSelection(canvas) || (canvas.selection.size < 2 && !canUnstackDynamically(canvas))) return;
    extended.add(menu);
    const selection = [...canvas.selection];
    const active = (): boolean => canvas.view?.file === file && isCarnet(file) &&
      plugin.app.workspace.getMostRecentLeaf()?.view === (canvas.view as unknown) && eligibleSelection(canvas) &&
      canvas.selection.size === selection.length && selection.every((node) => canvas.selection.has(node));
    const existing = actions(menu), groups = new Map<Group, Menu>();
    const add = (group: Group, action: Action): void => {
      if (existing.some((item) => item.run === action.run || (item.icon && action.icon ? iconKey(item.icon) === iconKey(action.icon) : item.title === action.title))) return;
      let submenu = groups.get(group);
      if (!submenu) menu.addItem((item) => {
        item.setTitle(t(`carnet.arrangement.${group}`));
        submenu = (item as typeof item & { setSubmenu(): Menu }).setSubmenu();
        groups.set(group, submenu);
      });
      submenu?.addItem((item) => item.setTitle(action.title).setIcon(action.icon).onClick((event) => { if (active()) action.run(event); }));
      existing.push(action);
    };
    for (const action of getCarnetArrangementActions(canvas, active)) {
      const group = action.section === "stack" ? "stack" : action.section.startsWith("align") ? "align" : action.section === "distribute" ? "distribute" : "arrange";
      add(group, action);
    }
  };
  plugin.registerEvent(workspace.on("canvas:selection-menu", extend));
  plugin.registerEvent(workspace.on("canvas:node-menu", (menu, node) => {
    if (hasArrangementContract(node.canvas) && node.canvas.selection.size === 1 && node.canvas.selection.has(node)) extend(menu, node.canvas);
  }));
}
