import { Component, Notice, Setting, TFile, setIcon, type App, type TFolder } from "obsidian";
import { CarnetDefaultStylesContent } from "./carnet-default-styles.js";
import { createCarnetSection } from "./carnet-section.js";
import { t } from "../i18n/index.js";
import { openFileActivating } from "../utils/dom.js";
import { listCarnetWorkspaceEntries, type CarnetWorkspaceEntry } from "../carnet/core/workspace-entries.js";
import type { CarnetLifecycle } from "../carnet/core/lifecycle.js";
import type { CarnetSelection, CarnetWorkspaceContext } from "../carnet/core/workspace-context.js";
import { applyNoteAppearance } from "../carnet/canvas/note-style.js";
import { isOrdinaryCard } from "../carnet/canvas/ordinary-cards.js";
import { applyEdgeStyle, getEdgeAppearance, isEligibleEdge } from "../carnet/canvas/edge-style.js";
import { normalizeTextStyle, textAlignments, textColors } from "../carnet/canvas/text-style.js";
import { getCarnetArrangementActions } from "../carnet/canvas/arrangement-menu.js";
import { textNodesOf } from "../services/canvas-bridge.js";
import { admissibleChapterNodes, makeManuscriptPathChecker } from "../services/canvas-chapter.js";

export type CarnetsPlugin = {
  settings: FeuilletsSettings;
  saveSettings(): Promise<void>;
  carnetLifecycle?: CarnetLifecycle;
  getProjectFolder(): TFolder | null;
  isFeuilletsCarnetFile(file: TFile | null | undefined): boolean;
  isGlobalCarnetFile(file: TFile | null | undefined): boolean;
  resolveCarnetTitleForFile(file: TFile | null | undefined): string | null;
  isSceneFile(file: TFile): boolean;
  generateCanvasBoard(): Promise<void>;
  openFolderCarnet(folder: TFolder): Promise<void>;
  openCaptureIdeaModal(target?: TFile): void;
  addFileToNotebook(file: TFile, target?: TFile): Promise<void>;
  openVisualOutline(): Promise<void>;
  openCanvasBridge(mode: "manuscript" | "research", target?: TFile): Promise<void>;
  openCanvasChapterModal(target?: TFile): Promise<void>;
  runCarnetMindmapAction(id: string, checking: boolean, view: { file?: TFile | null; canvas?: unknown }): boolean;
};

/** Mounted once per tab activation. Only selection changes replace inspector controls. */
export class CarnetsContent extends Component {
  private manager: HTMLElement;
  private inspector: HTMLElement;
  private tools: HTMLElement;
  private title: HTMLElement;
  private inspectorHint: HTMLElement;
  private defaultsContent: CarnetDefaultStylesContent;
  private managerKey = "";
  private entries: CarnetWorkspaceEntry[] = [];
  private selectedEntry = "";
  private sheet: TFile | null = null;
  private selection: CarnetSelection | null = null;
  private selectionKey = "";
  private updates: Array<() => void> = [];
  private toolUpdates: Array<() => void> = [];
  private queued = false;
  private alive = false;
  private boundContext: CarnetWorkspaceContext | undefined;
  private unsubscribeContext: (() => void) | undefined;

  constructor(private app: App, private plugin: CarnetsPlugin, private host: HTMLElement) {
    super();
    host.addClass("feuillets-carnets");
    this.title = host.createDiv({ cls: "feuillets-notes-section-title" });
    this.manager = this.section("manager", "carnet.sections.available", "notebook-tabs", false);
    this.manager.addClass("feuillets-carnets-manager");
    const inspector = this.section("inspector", "carnet.sections.inspector", "sliders-horizontal", false);
    inspector.createDiv({ cls: "feuillets-notes-sub", text: t("carnet.sections.inspectorDescription") });
    this.inspectorHint = inspector.createDiv({ cls: "feuillets-notes-sub", text: t("carnet.sections.noSelection") });
    this.inspector = inspector.createDiv({ cls: "feuillets-carnets-inspector" });
    this.tools = this.section("tools", "carnet.sections.tools", "wrench", true).createDiv({ cls: "feuillets-carnets-tools" });
    const defaults = this.section("defaults", "carnet.sections.defaults", "palette", true);
    this.defaultsContent = new CarnetDefaultStylesContent(defaults, () => this.plugin.settings, async () => {
      await this.plugin.saveSettings(); this.plugin.carnetLifecycle?.context.changed();
    });
    const display = this.section("display", "carnet.sections.display", "eye", true);
    new Setting(display).setName(t("carnet.showFloatingToolbar")).addToggle((toggle) => toggle
      .setValue(this.plugin.settings.carnetShowFloatingToolbar !== false).onChange(async (value) => {
        this.plugin.settings.carnetShowFloatingToolbar = value;
        this.plugin.carnetLifecycle?.refresh();
        await this.plugin.saveSettings();
      }));
  }

  private section(name: string, title: string, icon: string, initiallyCollapsed: boolean): HTMLElement {
    return createCarnetSection(this.host, () => this.plugin.settings, () => this.plugin.saveSettings(), name, t(title), icon, initiallyCollapsed);
  }

  onload(): void {
    this.alive = true;
    this.register(() => this.unsubscribeContext?.());
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.schedule()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.schedule()));
    this.registerEvent(this.app.vault.on("create", () => this.schedule()));
    this.registerEvent(this.app.vault.on("delete", () => this.schedule()));
    this.registerEvent(this.app.vault.on("rename", () => this.schedule()));
    this.refresh();
  }

  onunload(): void { this.alive = false; this.selection = null; this.updates = []; this.toolUpdates = []; }

  private schedule(): void {
    if (this.queued || !this.alive) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (this.alive) this.refresh(); });
  }

  private existing(file: TFile | null | undefined): file is TFile {
    return !!file && this.app.vault.getAbstractFileByPath(file.path) === file && this.plugin.isFeuilletsCarnetFile(file);
  }

  refresh(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && this.plugin.isSceneFile(activeFile)) this.sheet = activeFile;
    if (this.sheet && (this.app.vault.getAbstractFileByPath(this.sheet.path) !== this.sheet || !this.plugin.isSceneFile(this.sheet))) this.sheet = null;
    const context = this.plugin.carnetLifecycle?.context;
    if (context !== this.boundContext) {
      this.unsubscribeContext?.();
      this.boundContext = context;
      this.unsubscribeContext = context?.subscribe(() => this.schedule());
    }
    const snapshot = context?.snapshot() ?? null;
    const target = context?.current();
    const current = this.existing(target?.file) ? snapshot : null;
    const entries = listCarnetWorkspaceEntries(this.app, this.plugin.settings, this.plugin.getProjectFolder(), this.sheet?.parent);
    this.entries = entries;
    if (target && this.existing(target.file)) this.selectedEntry = entries.find((entry) => entry.file === target.file)?.key ?? this.selectedEntry;
    if (!entries.some((entry) => entry.key === this.selectedEntry)) this.selectedEntry = entries[0]?.key ?? "";
    const managerKey = JSON.stringify(entries.map((entry) => [entry.key, entry.label, entry.context, entry.file?.path, entry.key === this.selectedEntry]));
    if (managerKey !== this.managerKey) { this.managerKey = managerKey; this.renderManager(entries); }
    this.title.setText(target && this.existing(target.file) ? this.plugin.resolveCarnetTitleForFile(target.file) ?? t("sidebar.tab.carnets") : t("sidebar.tab.carnets"));
    const objects = current?.objects ?? [];
    const key = JSON.stringify([current?.target.file.path, objects.map((object) => object.getData().id),
      objects.map((object) => { const raw = object.getData(), data = current?.target.canvas.getData() ?? { nodes: [], edges: [] };
        return [raw.type, isOrdinaryCard(data, raw), current?.target.canvas.edges.get(raw.id) === object && isEligibleEdge(data, raw), raw.feuillets_stack];
      })]);
    const sameObjects = this.selection?.target === current?.target && this.selection?.objects.length === objects.length && objects.every((object, i) => this.selection?.objects[i] === object);
    if (key !== this.selectionKey || !sameObjects) {
      this.selection = current; this.selectionKey = key;
      this.renderInspector(current);
    }
    for (const update of this.updates) update();
    if (!this.tools.childElementCount) this.renderTools();
    // Tool callbacks resolve against the current entries and revalidate the file.
    for (const update of this.toolUpdates) update();
    this.defaultsContent.refresh();
    this.inspectorHint.hidden = this.inspector.childElementCount > 0;
    this.host.classList.toggle("has-inspector", this.inspector.childElementCount > 0);
  }

  private iconButton(parent: HTMLElement, label: string, icon: string, run: (event: MouseEvent) => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
    setIcon(button, icon);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", run);
    return button;
  }

  private actionButton(parent: HTMLElement, label: string, icon: string, run: (event: MouseEvent) => void): HTMLButtonElement {
    const button = this.iconButton(parent, label, icon, run);
    button.removeClass("clickable-icon");
    button.addClass("feuillets-carnets-action");
    button.createSpan({ text: label });
    return button;
  }

  private actionGroup(parent: HTMLElement, label: string): HTMLElement {
    const group = parent.createDiv({ cls: "feuillets-carnets-tool-group", attr: { role: "group", "aria-label": label } });
    group.createDiv({ cls: "feuillets-notes-sub feuillets-carnets-group-label", text: label });
    return group.createDiv({ cls: "feuillets-carnets-action-grid" });
  }

  private renderManager(entries: CarnetWorkspaceEntry[]): void {
    this.manager.empty();
    if (!entries.length) this.manager.createDiv({ cls: "feuillets-notes-sub", text: t("carnet.workspace.noProject") });
    for (const entry of entries) {
      const row = this.manager.createDiv({ cls: "feuillets-carnets-entry" });
      const label = row.createEl("button", { cls: "feuillets-carnets-name", text: entry.label, attr: { title: entry.context, "aria-current": String(entry.key === this.selectedEntry) } });
      const open = async (): Promise<void> => {
        this.selectedEntry = entry.key;
        if (this.existing(entry.file)) {
          const leaf = this.app.workspace.getLeavesOfType("canvas").find((candidate) => (candidate.view as unknown as { file?: TFile }).file === entry.file);
          if (leaf) await this.app.workspace.revealLeaf(leaf);
          else await openFileActivating(this.app, this.app.workspace.getLeaf(true), entry.file);
        } else if (!entry.file) {
          if (entry.folder && this.app.vault.getAbstractFileByPath(entry.folder.path) === entry.folder) await this.plugin.openFolderCarnet(entry.folder);
          else if (!entry.folder) await this.plugin.generateCanvasBoard();
        }
        this.plugin.carnetLifecycle?.refresh(); this.refresh();
      };
      label.addEventListener("click", () => { if (entry.file) void open(); });
      label.disabled = !entry.file;
      this.iconButton(row, t(entry.file ? "carnet.workspace.open" : "carnet.workspace.create"), entry.file ? "external-link" : "plus", () => { void open(); });
    }
  }

  private renderTools(): void {
    const capture = this.actionGroup(this.tools, t("carnet.workspace.captureGroup"));
    const plan = this.actionGroup(this.tools, t("carnet.workspace.planGroup"));
    const mindmap = this.actionGroup(this.tools, t("carnet.workspace.mindmapGroup"));
    const convert = this.actionGroup(this.tools, t("carnet.workspace.convertGroup"));
    const file = (): TFile | null => {
      const candidate = this.entries.find((entry) => entry.key === this.selectedEntry)?.file;
      const target = this.plugin.carnetLifecycle?.context.current();
      return this.existing(candidate) && !(target?.file === candidate && target.canvas.readonly) ? candidate : null;
    };
    const tool = (parent: HTMLElement, label: string, icon: string, allowed: () => boolean, run: () => unknown): void => {
      const button = this.actionButton(parent, t(label), icon, () => {
        if (!allowed()) { this.schedule(); return; }
        void Promise.resolve(run()).catch(() => new Notice(t("carnet.workspace.unavailable"))).finally(() => this.schedule());
      });
      this.toolUpdates.push(() => { button.disabled = !allowed(); });
    };
    tool(capture, "main.cmd.notebookCaptureIdea", "pen-line", () => !!file(), () => { const target = file(); if (target) this.plugin.openCaptureIdeaModal(target); });
    tool(capture, "main.cmd.notebookAddCurrentSheet", "file-plus", () => !!file() && !!this.sheet,
      () => { const target = file(); if (target && this.sheet) return this.plugin.addFileToNotebook(this.sheet, target); });
    tool(plan, "carnet.workspace.binderPlan", "list-tree", () => this.plugin.isGlobalCarnetFile(file()), () => this.plugin.openVisualOutline());
    for (const [id, icon, key] of [
      ["create", "network", "create"], ["reorganize", "refresh-cw", "reorganize"],
      ["toggle-collapse", "fold-vertical", "toggleCollapse"], ["toggle-orientation", "rotate-cw", "toggleOrientation"],
      ["add-child", "corner-down-right", "addChild"], ["add-sibling", "list-plus", "addSibling"], ["outdent", "outdent", "outdent"],
      ["convert-idea-tree", "git-branch", "convertIdeaTree"],
    ]) {
      const invoke = (checking: boolean): boolean => {
        const target = this.plugin.carnetLifecycle?.context.current();
        return !!target && target.file === file() && this.plugin.runCarnetMindmapAction(`mindmap-${id}`, checking, target.view);
      };
      tool(mindmap, `mindmap.action.${key}`, icon, () => invoke(true), () => invoke(false));
    }
    const canConvert = (): boolean => {
      const target = this.plugin.carnetLifecycle?.context.current();
      return !!file() && (!target || target.file !== file() || textNodesOf(target.canvas.getData()).length > 0);
    };
    for (const mode of ["manuscript", "research"] as const) tool(convert, mode === "manuscript" ? "main.cmd.canvasBridgeToManuscript" : "main.cmd.canvasBridgeToResearch", mode === "manuscript" ? "file-output" : "book-marked",
      canConvert, () => { const target = file(); if (target) return this.plugin.openCanvasBridge(mode, target); });
    tool(convert, "main.cmd.canvasChapterCreate", "folder-plus", () => {
      const target = this.plugin.carnetLifecycle?.context.current();
      return !!file() && (!target || target.file !== file() || admissibleChapterNodes(target.canvas.getData().nodes, makeManuscriptPathChecker(this.app, this.plugin.settings)).length > 0);
    }, () => { const target = file(); if (target) return this.plugin.openCanvasChapterModal(target); });
  }

  private renderInspector(selection: CarnetSelection | null): void {
    this.inspector.empty(); this.updates = [];
    if (!selection || !selection.objects.length) return;
    const { canvas } = selection.target;
    const valid = (): boolean => this.alive && this.existing(selection.target.file) && !!this.plugin.carnetLifecycle?.context.valid(selection);
    const option = (parent: HTMLElement, field: string, value: string, label: string, checked: () => boolean, apply: () => boolean): HTMLButtonElement => {
      const button = this.iconButton(parent, label, "", () => {
        if (!valid()) { this.schedule(); return; }
        if (!checked() && !apply()) new Notice(t("carnet.workspace.unavailable"));
        this.plugin.carnetLifecycle?.refresh();
        this.schedule();
      });
      button.setAttribute("data-inspector-field", field); button.setAttribute("data-inspector-value", value);
      this.updates.push(() => { const active = checked(); button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); button.disabled = !valid(); });
      return button;
    };
    const group = (label: string): HTMLElement => {
      const row = this.inspector.createDiv({ cls: "feuillets-carnets-property", attr: { role: "group", "aria-label": label } });
      row.createDiv({ cls: "feuillets-notes-sub", text: label });
      return row.createDiv({ cls: "feuillets-appearance-row" });
    };
    const [object] = selection.objects, raw = object.getData(), data = canvas.getData();
    const note = selection.objects.length === 1 && canvas.nodes.get(raw.id) === object && isOrdinaryCard(data, raw);
    const edge = selection.objects.length === 1 && canvas.edges.get(raw.id) === object && isEligibleEdge(data, raw);
    if (note) {
      const appearance = group(t("carnet.noteStyle.title"));
      for (const style of ["plain", "outline", "rounded", "filled", "classic"] as const) {
        const button = option(appearance, "style", style, t(`carnet.noteStyle.${style}`), () => (object.getData().feuillets_note_style ?? "plain") === style, () => applyNoteAppearance(canvas, raw.id, { style }));
        setIcon(button, { plain: "type", outline: "square", rounded: "rectangle-horizontal", filled: "square-dashed-bottom", classic: "sticky-note" }[style]);
      }
      const current = () => normalizeTextStyle(object.getData().feuillets_text_style) ?? {};
      const content = canvas.nodes.get(raw.id)?.contentEl;
      const defaultSize = parseFloat(content?.ownerDocument.defaultView?.getComputedStyle(content).getPropertyValue("--font-text-size") ?? "") || 16;
      const font = group(t("carnet.typography.size"));
      for (const [value, icon, delta] of [["decrease", "minus", -2], ["defaultSize", "type", 0], ["increase", "plus", 2]] as const) {
        const button = option(font, "size", value, t(`carnet.typography.${value}`), () => false, () => applyNoteAppearance(canvas, raw.id, { textStyle: { ...current(), size: delta ? Math.min(40, Math.max(12, (current().size ?? defaultSize) + delta)) : undefined } }));
        setIcon(button, icon);
        if (!delta) this.updates.push(() => button.setText(String(current().size ?? defaultSize)));
      }
      const align = group(t("carnet.typography.alignment"));
      for (const value of textAlignments) setIcon(option(align, "align", value, t(`carnet.typography.${value}`), () => (current().align ?? "left") === value,
        () => applyNoteAppearance(canvas, raw.id, { textStyle: { ...current(), align: value } })), `align-${value}`);
      const colors = group(t("carnet.typography.color"));
      for (const color of [undefined, ...textColors]) {
        const label = t("carnet.workspace.textColor", { color: t(`carnet.typography.${color ?? "defaultColor"}`) });
        const button = option(colors, "textColor", color ?? "default", label, () => current().color === color,
          () => applyNoteAppearance(canvas, raw.id, { textStyle: { ...current(), color } }));
        button.addClass("feuillets-carnets-swatch");
        if (color) button.setAttribute("data-text-color", color);
        button.createSpan({ cls: "feuillets-carnets-color-sample feuillets-carnets-text-sample", text: "A", attr: { "aria-hidden": "true" } });
      }
    } else if (edge) {
      const appearance = () => getEdgeAppearance(object.getData(), canvas.getData());
      for (const field of ["geometry", "pattern", "width", "arrows"] as const) {
        const choices = { geometry: ["curved", "straight", "map"], pattern: ["solid", "dashed", "dotted"], width: ["thin", "regular", "thick"], arrows: ["none", "start", "end", "both"] } as const;
        const row = group(t(`carnet.edgeStyle.${field === "pattern" ? "line" : field}`));
        for (const value of choices[field]) {
          const button = option(row, field, value, t(`carnet.edgeStyle.${value}`), () => appearance()[field] === value,
            () => applyEdgeStyle(canvas, raw.id, { [field]: value }));
          button.setText(t(`carnet.edgeStyle.${value}`));
        }
      }
    }
    if (note || edge) {
      const colors = group(t(note ? "carnet.workspace.cardColor" : "carnet.workspace.canvasColors"));
      for (const color of ["", "1", "2", "3", "4", "5", "6"]) {
        const label = t(note ? "carnet.workspace.cardColorValue" : "carnet.workspace.edgeColorValue", { color: t(`carnet.workspace.color${color || "Default"}`) });
        const button = option(colors, "color", color, label, () => (object.getData().color ?? "") === color,
          () => note ? applyNoteAppearance(canvas, raw.id, { color }) : applyEdgeStyle(canvas, raw.id, { color }));
        button.addClass("feuillets-carnets-swatch");
        button.setAttribute("data-canvas-color", color);
        button.createSpan({ cls: "feuillets-carnets-color-sample feuillets-carnets-canvas-sample", attr: { "aria-hidden": "true" } });
      }
    }
    const arrangementGroups = new Map<string, HTMLElement>();
    if (!edge) for (const action of getCarnetArrangementActions(canvas, valid)) {
      const section = action.section === "stack" ? "stack" : action.section.startsWith("align") ? "align" : action.section === "distribute" ? "distribute" : "arrange";
      let parent = arrangementGroups.get(section);
      if (!parent) {
        parent = this.actionGroup(this.inspector, t(`carnet.arrangement.${section}`));
        arrangementGroups.set(section, parent);
      }
      const button = this.actionButton(parent, action.title, action.icon, (event) => {
        if (valid()) action.run(event);
        this.plugin.carnetLifecycle?.refresh(); this.schedule();
      });
      this.updates.push(() => { button.disabled = !valid(); });
    }
  }
}
