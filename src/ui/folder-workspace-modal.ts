import { App, Modal, Setting, TFolder, normalizePath, setIcon, type ButtonComponent } from "obsidian";
import { PROJECT_MODES, projectBoardDefaults } from "../utils/project-modes.js";
import { newSheetIncludeSourcesForProjectType, planningFieldForProjectType } from "../services/project-settings.js";
import { isOuvrageRoot, ouvrageRelativePath, registerOuvrage, unregisterOuvrage } from "../services/editorial-roots.js";
import {
  folderPathToWorkspaceScope,
  workspaceDeadline,
  workspaceCardContent,
  workspaceFavoriteTags,
  workspaceFieldSource,
  workspaceHiddenBoardModes,
  workspaceIndentParagraphs,
  workspaceLineHeight,
  workspaceLiveEmptyLines,
  workspaceLiveHyphenation,
  workspaceLiveJustify,
  workspaceLabels,
  workspaceOutlineColumns,
  workspacePlanningField,
  workspaceReadingFontSize,
  workspaceSessionGoal,
  getFolderWorkspaceConfig,
  isDeclaredWorkspaceRoot,
  registerDeclaredWorkspaceRoot,
  unregisterDeclaredWorkspaceRoot,
  isFolderWorkspaceConfigEmpty,
  resolveFolderWorkspaceValue,
  workspaceStatuses,
  workspaceTolerance,
  workspaceTotalWordGoal,
  workspaceTextWidth,
  workspaceWordGoalDefault,
  workspaceScopeToFolderPath,
} from "../services/folder-workspaces.js";
import { t, getLocale } from "../i18n/index.js";
import { statusDisplayLabel, labelDisplayLabel } from "../services/project-taxonomy.js";
import { ReferenceCitationSettingsControls, refreshReferenceCitationSettings, saveWorkspaceSettings } from "./reference-citation-settings.js";
import type { CslCitationHost } from "../services/csl-citation-host.js";

type FolderWorkspacePlugin = {
  cslCitationHost?: Pick<CslCitationHost, "getProvider"> | null;
  refreshCitationRendering?(): void;
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  saveSettings(): Promise<void>;
  renderAllViews(force?: boolean): void;
};

const PRESETS: FolderWorkspacePreset[] = ["free", "fiction", "nonfiction"];
type WorkspaceSection = "views" | "workflow" | "goals" | "typography" | "references";
type WorkspaceListRow = { setting: Setting; index: number };
let nextWorkspaceModalId = 0;

function isFolderWorkspacePreset(value: string): value is FolderWorkspacePreset {
  return PRESETS.includes(value as FolderWorkspacePreset);
}

export class FolderWorkspaceModal extends Modal {
  private readonly plugin: FolderWorkspacePlugin;
  private readonly folder: TFolder;
  private citationControls: ReferenceCitationSettingsControls | null = null;
  private resetButton: ButtonComponent | null = null;
  private viewsEl: HTMLElement | null = null;
  private readonly fieldRefreshers = new Map<keyof FolderWorkspaceConfig, Set<() => void>>();
  private readonly sectionId = ++nextWorkspaceModalId;
  private readonly sectionStates: Record<WorkspaceSection, boolean> = {
    views: false, workflow: false, goals: false, typography: false, references: false,
  };

  constructor(app: App, plugin: FolderWorkspacePlugin, folder: TFolder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }

  onOpen(): void {
    this.renderContent();
  }

  private renderContent(): void {
    const { contentEl } = this;
    this.citationControls?.destroy();
    this.citationControls = null;
    this.fieldRefreshers.clear();
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    contentEl.addClass("feuillets-workspace-modal");

    const projectRoot = this.plugin.getProjectFolder();
    const relativeScope = projectRoot
      ? folderPathToWorkspaceScope(projectRoot.path, this.folder.path)
      : null;
    if (!projectRoot || !relativeScope) return;

    const meta = this.plugin.settings.projectMeta[projectRoot.path];
    const localConfig = getFolderWorkspaceConfig(meta, relativeScope);
    const selectedPreset = resolveFolderWorkspaceValue(meta, projectRoot.path, this.folder.path, "preset", "free").value || "free";

    const titleRow = contentEl.createDiv({ cls: "feuillets-modal-title-row" });
    setIcon(titleRow.createDiv({ cls: "feuillets-cell-icon" }), "folder-cog");
    titleRow.createEl("h3", {
      text: t("modal.folderWorkspace.title", { name: this.folder.name }),
    });
    const context = contentEl.createDiv({ cls: "feuillets-workspace-context" });
    context.createDiv({
      text: t("modal.folderWorkspace.path", { path: relativeScope }),
      cls: "feuillets-notes-sub",
    });
    const presetSource = context.createDiv({
      text: this.sourceDescription(projectRoot.path, relativeScope, "preset"),
      cls: "feuillets-notes-sub",
    });

    const essentials = contentEl.createDiv({ cls: "feuillets-workspace-essentials" });
    this.renderContext(essentials, projectRoot);

    const saveLocalPreset = async (preset: FolderWorkspacePreset): Promise<void> => {
      const boardDefaults = projectBoardDefaults(preset);
      const mode = PROJECT_MODES[preset];
      const config = {
        ...(getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRoot.path], relativeScope) || { version: 1 }),
        preset,
        planningField: planningFieldForProjectType(preset),
        newSheetIncludeSources: newSheetIncludeSourcesForProjectType(preset),
        cardContent: mode.defaults.cardContent,
        hiddenBoardModes: [...boardDefaults.hiddenBoardModes],
        outlineCols: { ...boardDefaults.outlineCols },
      };
      const projectMeta = this.plugin.settings.projectMeta[projectRoot.path] || {};
      this.plugin.settings.projectMeta[projectRoot.path] = projectMeta;
      projectMeta.folderWorkspaces = {
        ...(projectMeta.folderWorkspaces || {}),
        [relativeScope]: config,
      };
      presetSource.setText(this.sourceDescription(projectRoot.path, relativeScope, "preset"));
      this.refreshViews(projectRoot.path, relativeScope);
      this.refreshResetAvailability();
      await saveWorkspaceSettings(this.plugin);
      this.plugin.renderAllViews(true);
    };

    new Setting(essentials)
      .setName(t("modal.folderWorkspace.preset"))
      .addDropdown((dropdown) => {
        dropdown.addOption("free", t("modal.folderWorkspace.free"));
        dropdown.addOption("fiction", t("modal.folderWorkspace.fiction"));
        dropdown.addOption("nonfiction", t("modal.folderWorkspace.nonfiction"));
        dropdown.setValue(isFolderWorkspacePreset(selectedPreset) ? selectedPreset : "free");
        dropdown.onChange((value) => {
          if (isFolderWorkspacePreset(value)) void saveLocalPreset(value);
        });
      });

    new Setting(essentials)
      .setClass("feuillets-workspace-reset")
      .addButton((button) => {
        this.resetButton = button;
        button.setButtonText(t("modal.folderWorkspace.reset"))
          .setDisabled(!localConfig)
          .onClick(() => { void this.resetLocalConfig(projectRoot.path, relativeScope); });
      });

    const advanced = contentEl.createDiv({ cls: "feuillets-workspace-advanced" });
    const views = this.createSection(advanced, "views", t("modal.folderWorkspace.views"));
    this.viewsEl = views;
    this.renderViews(views, projectRoot.path, relativeScope);

    const workflow = this.createSection(advanced, "workflow", t("modal.folderWorkspace.workflow"));
    this.renderStatuses(workflow, projectRoot.path, relativeScope);
    this.renderLabels(workflow, projectRoot.path, relativeScope);
    this.renderFavoriteTags(workflow, projectRoot.path, relativeScope);

    const goals = this.createSection(advanced, "goals", t("modal.folderWorkspace.goals"));
    this.renderGoals(goals, projectRoot.path, relativeScope);

    const typography = this.createSection(advanced, "typography", t("modal.folderWorkspace.typography"));
    this.renderTypography(typography, projectRoot.path, relativeScope);

    const references = this.createSection(advanced, "references", t("modal.folderWorkspace.references"));
    this.citationControls = new ReferenceCitationSettingsControls(this.app, this.plugin,
      { projectRoot, scopeRoot: this.folder, targetScope: this.folder },
      () => this.plugin.getProjectFolder()?.path === projectRoot.path && this.app.vault.getAbstractFileByPath(this.folder.path) === this.folder,
      references.createDiv(), undefined, false, () => this.refreshResetAvailability());
    this.citationControls.open();
  }

  /** Folding changes only instance UI state; existing controls remain mounted. */
  private createSection(container: HTMLElement, key: WorkspaceSection, title: string): HTMLElement {
    const section = container.createDiv({ cls: "feuillets-workspace-section",
      attr: { "data-workspace-section": key } });
    const contentId = `feuillets-workspace-${this.sectionId}-${key}`;
    const header = section.createEl("button", { cls: "feuillets-workspace-section-toggle",
      attr: { type: "button", "aria-controls": contentId } });
    header.createSpan({ text: title });
    const chevron = header.createSpan({ cls: "feuillets-workspace-section-chevron", attr: { "aria-hidden": "true" } });
    const content = section.createDiv({ cls: "feuillets-workspace-section-content", attr: { id: contentId } });
    const update = (): void => {
      const expanded = this.sectionStates[key];
      header.setAttr("aria-expanded", String(expanded));
      content.hidden = !expanded;
      setIcon(chevron, expanded ? "chevron-down" : "chevron-right");
    };
    header.addEventListener("click", () => {
      this.sectionStates[key] = !this.sectionStates[key];
      update();
    });
    update();
    return content;
  }

  /** Independent structural identities use the historical folder exclusions.
   * Neither toggle changes the active folder or session isolation. */
  private renderContext(container: HTMLElement, projectRoot: TFolder): void {
    const rel = ouvrageRelativePath(projectRoot.path, this.folder.path);
    if (!rel) return;
    if (this.folder.name.startsWith("_")) return;
    const frontPath = normalizePath(`${projectRoot.path}/Front`);
    if (this.folder.path === frontPath || this.folder.path.startsWith(`${frontPath}/`)) return;
    if (this.folder.name === "Front" || this.folder.path.split("/").includes("Front")) return;

    new Setting(container)
      .setName(t("modal.folderWorkspace.defineAsWorkspace"))
      .addToggle((toggle) => toggle
        .setValue(isDeclaredWorkspaceRoot(this.app, this.plugin.settings, projectRoot, this.folder))
        .onChange(async (value) => {
          const changed = value
            ? registerDeclaredWorkspaceRoot(this.plugin.settings, projectRoot, this.folder)
            : unregisterDeclaredWorkspaceRoot(this.plugin.settings, projectRoot, this.folder);
          if (changed) {
            this.refreshResetAvailability();
            await saveWorkspaceSettings(this.plugin);
            this.plugin.renderAllViews(true);
          }
        }));
    this.renderOuvrageOption(container, projectRoot);
  }

  /** Editorial identity retains its existing readers, writers and immediate save. */
  private renderOuvrageOption(container: HTMLElement, projectRoot: TFolder): void {
    new Setting(container)
      .setName(t("modal.folderWorkspace.defineAsOuvrage"))
      .addToggle((toggle) => toggle
        .setValue(isOuvrageRoot(this.app, this.plugin.settings, projectRoot, this.folder))
        .onChange(async (value) => {
          const changed = value
            ? registerOuvrage(this.plugin.settings, projectRoot, this.folder)
            : unregisterOuvrage(this.plugin.settings, projectRoot, this.folder);
          if (changed) {
            this.refreshResetAvailability();
            await saveWorkspaceSettings(this.plugin);
            this.plugin.renderAllViews(true);
          }
        }));
  }

  private renderViews(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    const modes: [string, string][] = [
      ["board", t("board.mode.board")],
      ["outline", t("board.mode.outline")],
      ["arcs", t("board.mode.arcs")],
      ["timeline", t("board.mode.timeline")],
    ];
    const hiddenModes = workspaceHiddenBoardModes(this.app, this.plugin.settings, this.folder);
    for (const [mode, label] of modes) {
      new Setting(container)
        .setName(label)
        .addToggle((toggle) => toggle.setValue(!hiddenModes.includes(mode)).onChange((visible) => {
          const next = workspaceHiddenBoardModes(this.app, this.plugin.settings, this.folder).filter((key) => key !== mode);
          if (!visible) next.push(mode);
          void this.saveLocalField(projectRootPath, relativeScope, "hiddenBoardModes", next, true);
        }));
    }
    this.addFieldReset(container, projectRootPath, relativeScope, "hiddenBoardModes", () => this.refreshViews(projectRootPath, relativeScope));

    container.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.planColumns") });
    const planningField = workspacePlanningField(this.app, this.plugin.settings, this.folder);
    const outlineColumns = workspaceOutlineColumns(this.app, this.plugin.settings, this.folder, planningField);
    const semanticColumn: [string, string] = planningField === "synopsis"
      ? ["synopsis", t("board.col.synopsis")]
      : ["summary", t("binder.preview.summary")];
    const columns: [string, string][] = [
      semanticColumn,
      ["pov", t("board.col.pov")],
      ["characters", t("board.col.characters")],
      ["thread", t("board.col.thread")],
      ["label", t("board.col.label")],
      ["status", t("board.col.status")],
      ["tags", t("board.col.tags")],
      ["date", t("board.col.date")],
      ["words", t("board.col.words")],
      ["goal", t("board.col.goal")],
    ];
    for (const [key, label] of columns) {
      new Setting(container)
        .setName(label)
        .addToggle((toggle) => toggle.setValue(!!outlineColumns[key]).onChange((visible) => {
          const next = { ...workspaceOutlineColumns(this.app, this.plugin.settings, this.folder, planningField) };
          next[key] = visible;
          void this.saveLocalField(projectRootPath, relativeScope, "outlineCols", next, true);
        }));
    }
    this.addFieldReset(container, projectRootPath, relativeScope, "outlineCols", () => this.refreshViews(projectRootPath, relativeScope));

    new Setting(container)
      .setName(t("modal.folderWorkspace.cardContent"))
      .addDropdown((dropdown) => {
        const cardContent = workspaceCardContent(this.app, this.plugin.settings, this.folder, planningField);
        dropdown.addOption(planningField, planningField === "synopsis" ? t("board.options.bodySynopsis") : t("binder.preview.summary"));
        dropdown.addOption("extrait", t("board.options.bodyContent"));
        dropdown.setValue(cardContent);
        dropdown.onChange((value) => {
          if (value === planningField || value === "extrait") void this.saveLocalField(projectRootPath, relativeScope, "cardContent", value, true);
        });
      });
    this.addFieldReset(container, projectRootPath, relativeScope, "cardContent", () => this.refreshViews(projectRootPath, relativeScope));
  }

  onClose(): void {
    this.citationControls?.destroy();
    this.citationControls = null;
    this.fieldRefreshers.clear();
    this.contentEl.empty();
  }

  private rerenderContent(): void {
    const scrollTop = this.contentEl.scrollTop;
    this.renderContent();
    this.contentEl.scrollTop = scrollTop;
    window.requestAnimationFrame(() => { this.contentEl.scrollTop = scrollTop; });
  }

  private refreshResetAvailability(): void {
    const root = this.plugin.getProjectFolder();
    const scope = root ? folderPathToWorkspaceScope(root.path, this.folder.path) : null;
    if (root && scope) this.resetButton?.setDisabled(!getFolderWorkspaceConfig(this.plugin.settings.projectMeta[root.path], scope));
  }

  private refreshViews(projectRootPath: string, relativeScope: string): void {
    if (!this.viewsEl) return;
    for (const key of ["hiddenBoardModes", "outlineCols", "cardContent"] as const) this.fieldRefreshers.delete(key);
    this.viewsEl.empty();
    this.renderViews(this.viewsEl, projectRootPath, relativeScope);
  }

  private registerFieldRefresh(key: keyof FolderWorkspaceConfig, refresh: () => void): void {
    let callbacks = this.fieldRefreshers.get(key);
    if (!callbacks) { callbacks = new Set(); this.fieldRefreshers.set(key, callbacks); }
    callbacks.add(refresh);
  }

  private refreshLocalField(key: keyof FolderWorkspaceConfig): void {
    for (const refresh of this.fieldRefreshers.get(key) ?? []) refresh();
    this.refreshResetAvailability();
  }

  private rebindListRows<Entry>(rows: Map<Entry, WorkspaceListRow>, entries: Entry[]): void {
    for (const [entry, row] of Array.from(rows)) {
      const replacement = entries[row.index];
      if (replacement !== undefined && replacement !== entry) {
        rows.delete(entry);
        rows.set(replacement, row);
      }
    }
  }

  private localConfig(projectRootPath: string, relativeScope: string): FolderWorkspaceConfig {
    const settings = this.plugin.settings;
    const meta = settings.projectMeta[projectRootPath] || {};
    settings.projectMeta[projectRootPath] = meta;
    if (!meta.folderWorkspaces) meta.folderWorkspaces = {};
    if (!meta.folderWorkspaces[relativeScope]) meta.folderWorkspaces[relativeScope] = { version: 1 };
    return meta.folderWorkspaces[relativeScope];
  }

  private async saveLocalField<K extends keyof FolderWorkspaceConfig>(
    projectRootPath: string,
    relativeScope: string,
    key: K,
    value: FolderWorkspaceConfig[K],
    structural = false,
  ): Promise<void> {
    const config = this.localConfig(projectRootPath, relativeScope);
    config[key] = value;
    this.refreshLocalField(key);
    await saveWorkspaceSettings(this.plugin);
    if (structural) {
      this.plugin.renderAllViews(true);
    }
  }

  private async saveLocalListField<K extends "statuses" | "labels">(
    projectRootPath: string,
    relativeScope: string,
    key: K,
    value: FolderWorkspaceConfig[K],
    refresh: () => void,
  ): Promise<void> {
    const saved = this.saveLocalField(projectRootPath, relativeScope, key, value);
    // Rebuild at the structural click, never at a later save completion.
    refresh();
    await saved;
    this.plugin.renderAllViews(true);
  }

  private async resetLocalField<K extends keyof FolderWorkspaceConfig>(
    projectRootPath: string,
    relativeScope: string,
    key: K,
    refresh?: () => void,
  ): Promise<void> {
    if (key === "workspaceRoot" || key === "ouvrage") return;
    const meta = this.plugin.settings.projectMeta[projectRootPath];
    const workspaces = meta?.folderWorkspaces;
    const config = workspaces?.[relativeScope];
    if (!config || config[key] === undefined) return;
    const next = { ...config };
    delete next[key];
    if (Object.keys(next).some((name) => name !== "version")) workspaces[relativeScope] = next;
    else delete workspaces[relativeScope];
    if (Object.keys(workspaces).length === 0) delete meta.folderWorkspaces;
    if (refresh) refresh();
    this.refreshLocalField(key);
    await saveWorkspaceSettings(this.plugin);
    this.plugin.renderAllViews(true);
  }

  private hasLocalField<K extends keyof FolderWorkspaceConfig>(config: FolderWorkspaceConfig | undefined, key: K): boolean {
    return config?.[key] !== undefined;
  }

  private sourceDescription<K extends keyof FolderWorkspaceConfig>(
    projectRootPath: string,
    relativeScope: string,
    key: K,
  ): string {
    const source = workspaceFieldSource(this.app, this.plugin.settings, this.folder, key);
    if (!source) return t("modal.folderWorkspace.inheritedFromProject");
    if (source === relativeScope) return t("modal.folderWorkspace.local");
    const sourcePath = workspaceScopeToFolderPath(projectRootPath, source);
    const sourceFolder = sourcePath ? this.app.vault.getAbstractFileByPath(sourcePath) : null;
    const name = sourceFolder instanceof TFolder ? sourceFolder.name : source.split("/").pop() || source;
    return t("modal.folderWorkspace.inheritedFromParent", { name });
  }

  private renderStatuses(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    const meta = this.plugin.settings.projectMeta[projectRootPath];
    const local = getFolderWorkspaceConfig(meta, relativeScope);
    const source = this.sourceDescription(projectRootPath, relativeScope, "statuses");
    const setting = new Setting(container)
      .setName(t("modal.folderWorkspace.statuses"))
      .setDesc(source)
      .addButton((button) => {
        this.registerFieldRefresh("statuses", () => {
          button.setDisabled(this.hasLocalField(getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope), "statuses"));
          setting.setDesc(this.sourceDescription(projectRootPath, relativeScope, "statuses"));
        });
        button.setButtonText(t("modal.folderWorkspace.customize"))
          .setDisabled(this.hasLocalField(local, "statuses"))
          .onClick(() => {
            const clone = workspaceStatuses(this.app, this.plugin.settings, this.folder).map((status) => ({ ...status }));
            this.rebindListRows(rows, clone);
            void this.saveLocalListField(projectRootPath, relativeScope, "statuses", clone, refresh);
          });
      });

    const listContainer = container.createDiv({ cls: "feuillets-workspace-status-list" });
    const rows = new Map<ProjectStatusEntry, WorkspaceListRow>();
    const refresh = (): void => {
      this.renderStatusRows(listContainer, projectRootPath, relativeScope, refresh, rows);
    };
    refresh();

    new Setting(container).addButton((button) => button
      .setButtonText(t("settings.statuses.add"))
      .onClick(() => {
        const next = this.localStatuses(projectRootPath, relativeScope, workspaceStatuses(this.app, this.plugin.settings, this.folder));
        this.rebindListRows(rows, next);
        next.push({ name: t("settings.statuses.item", { n: String(next.length + 1) }), color: "#888888" });
        void this.saveLocalListField(projectRootPath, relativeScope, "statuses", next, refresh);
      }));
    this.addFieldReset(container, projectRootPath, relativeScope, "statuses", refresh);
  }

  private renderStatusRows(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    refresh: () => void,
    rows: Map<ProjectStatusEntry, WorkspaceListRow>,
  ): void {
    const list = workspaceStatuses(this.app, this.plugin.settings, this.folder);
    const source = this.sourceDescription(projectRootPath, relativeScope, "statuses");
    for (const [entry, row] of rows) if (!list.includes(entry)) { row.setting.settingEl.remove(); rows.delete(entry); }
    list.forEach((status, index) => {
      const existing = rows.get(status);
      if (existing) { existing.index = index; existing.setting.setName(String(index + 1)).setDesc(source); return; }
      const row: WorkspaceListRow = { setting: new Setting(container), index };
      rows.set(status, row);
      row.setting
        .setName(String(index + 1))
        .setDesc(source)
        /* A built-in entry shows its translated name (statusDisplayLabel);
           typing here is an explicit rename that forks it into a plain
           legacy/custom entry — see project-config-content.ts for the
           identical contract applied to the global statuses page. */
        .addText((text) => text.setValue(statusDisplayLabel(status, getLocale())).onChange((value) => {
          const next = this.localStatuses(projectRootPath, relativeScope, list);
          this.rebindListRows(rows, next);
          delete next[row.index].id;
          next[row.index].name = value;
          void this.saveLocalField(projectRootPath, relativeScope, "statuses", next);
        }))
        .addColorPicker((color) => color.setValue(status.color || "#888888").onChange((value) => {
          const next = this.localStatuses(projectRootPath, relativeScope, list);
          this.rebindListRows(rows, next);
          next[row.index].color = value;
          void this.saveLocalField(projectRootPath, relativeScope, "statuses", next);
        }))
        .addExtraButton((button) => button
          .setIcon("trash")
          .setTooltip(t("settings.statuses.deleteTooltip"))
          .onClick(() => {
            const next = this.localStatuses(projectRootPath, relativeScope, list);
            this.rebindListRows(rows, next);
            next.splice(row.index, 1);
            void this.saveLocalListField(projectRootPath, relativeScope, "statuses", next, refresh);
          }));
    });
  }

  private localStatuses(projectRootPath: string, relativeScope: string, effective: ProjectStatusEntry[]): ProjectStatusEntry[] {
    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope)?.statuses;
    return Array.isArray(local) ? local : effective.map((status) => ({ ...status }));
  }

  private renderLabels(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    const meta = this.plugin.settings.projectMeta[projectRootPath];
    const local = getFolderWorkspaceConfig(meta, relativeScope);
    const source = this.sourceDescription(projectRootPath, relativeScope, "labels");
    const setting = new Setting(container)
      .setName(t("modal.folderWorkspace.labels"))
      .setDesc(source)
      .addButton((button) => {
        this.registerFieldRefresh("labels", () => {
          button.setDisabled(this.hasLocalField(getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope), "labels"));
          setting.setDesc(this.sourceDescription(projectRootPath, relativeScope, "labels"));
        });
        button.setButtonText(t("modal.folderWorkspace.customize"))
          .setDisabled(this.hasLocalField(local, "labels"))
          .onClick(() => {
            const clone = workspaceLabels(this.app, this.plugin.settings, this.folder).map((label) => ({ ...label }));
            this.rebindListRows(rows, clone);
            void this.saveLocalListField(projectRootPath, relativeScope, "labels", clone, refresh);
          });
      });
    const listContainer = container.createDiv({ cls: "feuillets-workspace-label-list" });
    const rows = new Map<Label, WorkspaceListRow>();
    const refresh = (): void => {
      this.renderLabelRows(listContainer, projectRootPath, relativeScope, refresh, rows);
    };
    refresh();

    new Setting(container).addButton((button) => button
      .setButtonText(t("settings.labels.add"))
      .onClick(() => {
        const next = this.localLabels(projectRootPath, relativeScope, workspaceLabels(this.app, this.plugin.settings, this.folder));
        this.rebindListRows(rows, next);
        next.push({ name: t("settings.labels.item", { n: String(next.length + 1) }), color: "#888888" });
        void this.saveLocalListField(projectRootPath, relativeScope, "labels", next, refresh);
      }));
    this.addFieldReset(container, projectRootPath, relativeScope, "labels", refresh);
  }

  private renderLabelRows(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    refresh: () => void,
    rows: Map<Label, WorkspaceListRow>,
  ): void {
    const list = workspaceLabels(this.app, this.plugin.settings, this.folder);
    const source = this.sourceDescription(projectRootPath, relativeScope, "labels");
    for (const [entry, row] of rows) if (!list.includes(entry)) { row.setting.settingEl.remove(); rows.delete(entry); }
    list.forEach((label, index) => {
      const existing = rows.get(label);
      if (existing) { existing.index = index; existing.setting.setName(String(index + 1)).setDesc(source); return; }
      const row: WorkspaceListRow = { setting: new Setting(container), index };
      rows.set(label, row);
      row.setting
        .setName(String(index + 1))
        .setDesc(source)
        /* Same contract as renderStatusRows above: a built-in entry shows
           its translated name, and typing here forks it into a plain
           legacy/custom entry. */
        .addText((text) => text.setValue(labelDisplayLabel(label, getLocale())).onChange((value) => {
          const next = this.localLabels(projectRootPath, relativeScope, list);
          this.rebindListRows(rows, next);
          delete next[row.index].id;
          next[row.index].name = value;
          void this.saveLocalField(projectRootPath, relativeScope, "labels", next);
        }))
        .addColorPicker((color) => color.setValue(label.color).onChange((value) => {
          const next = this.localLabels(projectRootPath, relativeScope, list);
          this.rebindListRows(rows, next);
          next[row.index].color = value;
          void this.saveLocalField(projectRootPath, relativeScope, "labels", next);
        }))
        .addExtraButton((button) => button
          .setIcon("trash")
          .setTooltip(t("settings.labels.deleteTooltip"))
          .onClick(() => {
            const next = this.localLabels(projectRootPath, relativeScope, list);
            this.rebindListRows(rows, next);
            next.splice(row.index, 1);
            void this.saveLocalListField(projectRootPath, relativeScope, "labels", next, refresh);
          }));
    });
  }

  private localLabels(projectRootPath: string, relativeScope: string, effective: Label[]): Label[] {
    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope)?.labels;
    return Array.isArray(local) ? local : effective.map((label) => ({ ...label }));
  }

  private renderFavoriteTags(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);
    const source = this.sourceDescription(projectRootPath, relativeScope, "favoriteTags");
    const setting = new Setting(container)
      .setName(t("settings.favoriteTags.name"))
      .setDesc(source)
      .addTextArea((text) => {
        this.registerFieldRefresh("favoriteTags", () => {
          if (!this.hasLocalField(getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope), "favoriteTags")) {
            text.setValue(workspaceFavoriteTags(this.app, this.plugin.settings, this.folder).join(", "));
          }
        });
        text.setPlaceholder(t("settings.favoriteTags.placeholder"))
        .setValue(workspaceFavoriteTags(this.app, this.plugin.settings, this.folder).join(", "))
        .onChange((value) => {
          const tags = [...new Set(value.split(/[,\n]+/).map((item) => item.replace(/^#/, "").trim()).filter(Boolean))];
          void this.saveLocalField(projectRootPath, relativeScope, "favoriteTags", tags);
        });
      });
    setting.addButton((button) => {
      this.registerFieldRefresh("favoriteTags", () => {
        button.setDisabled(this.hasLocalField(getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope), "favoriteTags"));
        setting.setDesc(this.sourceDescription(projectRootPath, relativeScope, "favoriteTags"));
      });
      button.setButtonText(t("modal.folderWorkspace.customize"))
        .setDisabled(this.hasLocalField(local, "favoriteTags"))
        .onClick(() => {
        const clone = [...workspaceFavoriteTags(this.app, this.plugin.settings, this.folder)];
        void this.saveLocalField(projectRootPath, relativeScope, "favoriteTags", clone, true);
      });
    });
    this.addFieldReset(container, projectRootPath, relativeScope, "favoriteTags");
  }

  private renderGoals(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    this.renderNumberGoal(container, projectRootPath, relativeScope, "wordGoal", t("settings.wordGoal.name"), workspaceWordGoalDefault(this.app, this.plugin.settings, this.folder));
    this.renderNumberGoal(container, projectRootPath, relativeScope, "tolerance", t("settings.tolerance.name"), workspaceTolerance(this.app, this.plugin.settings, this.folder));
    this.renderNumberGoal(container, projectRootPath, relativeScope, "projectWordGoal", t("modal.folderWorkspace.totalWordGoal"), workspaceTotalWordGoal(this.app, this.plugin.settings, this.folder));
    this.renderNumberGoal(container, projectRootPath, relativeScope, "sessionGoal", t("settings.sessionGoal.name"), workspaceSessionGoal(this.app, this.plugin.settings, this.folder));

    let restoreDeadline = (): void => {};
    const deadline = new Setting(container)
      .setName(t("settings.deadline.name"))
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, "deadlineDate"))
      .addText((text) => {
        restoreDeadline = () => { text.setValue(workspaceDeadline(this.app, this.plugin.settings, this.folder)); };
        text.setPlaceholder(t("settings.deadline.placeholder"))
        .setValue(workspaceDeadline(this.app, this.plugin.settings, this.folder))
        .onChange((value) => { void this.saveLocalField(projectRootPath, relativeScope, "deadlineDate", value.trim()); });
      });
    this.addResetButton(deadline, projectRootPath, relativeScope, "deadlineDate", restoreDeadline);
  }

  private renderTypography(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    this.renderTypographyToggle(container, projectRootPath, relativeScope, "indentParagraphs", t("settings.indentParagraphs.name"), workspaceIndentParagraphs(this.app, this.plugin.settings, this.folder));
    this.renderTypographyToggle(container, projectRootPath, relativeScope, "liveJustify", t("settings.liveJustify.name"), workspaceLiveJustify(this.app, this.plugin.settings, this.folder));

    const emptyLines = workspaceLiveEmptyLines(this.app, this.plugin.settings, this.folder);
    let restoreEmptyLines = (): void => {};
    const emptySetting = new Setting(container)
      .setName(t("settings.liveEmptyLines.name"))
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, "liveEmptyLines"))
      .addDropdown((dropdown) => {
        restoreEmptyLines = () => { dropdown.setValue(workspaceLiveEmptyLines(this.app, this.plugin.settings, this.folder)); };
        dropdown.addOption("normal", t("settings.liveEmptyLines.normal"))
        .addOption("reduit", t("settings.liveEmptyLines.reduced"))
        .addOption("invisible", t("settings.liveEmptyLines.invisible"))
        .setValue(emptyLines)
        .onChange((value) => {
          if (value === "normal" || value === "reduit" || value === "invisible") void this.saveLocalField(projectRootPath, relativeScope, "liveEmptyLines", value);
        });
      });
    this.addResetButton(emptySetting, projectRootPath, relativeScope, "liveEmptyLines", restoreEmptyLines);

    this.renderTypographyToggle(container, projectRootPath, relativeScope, "liveHyphenation", t("settings.liveHyphenation.name"), workspaceLiveHyphenation(this.app, this.plugin.settings, this.folder));
    this.renderTypographyNumber(container, projectRootPath, relativeScope, "readingFontSize", t("settings.readingFontSize.name"), workspaceReadingFontSize(this.app, this.plugin.settings, this.folder));
    this.renderTypographyNumber(container, projectRootPath, relativeScope, "lineHeight", t("settings.lineHeight.name"), workspaceLineHeight(this.app, this.plugin.settings, this.folder));
    this.renderTypographyNumber(container, projectRootPath, relativeScope, "textWidth", t("settings.textWidth.name"), workspaceTextWidth(this.app, this.plugin.settings, this.folder));
  }

  private renderTypographyToggle(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    key: "indentParagraphs" | "liveJustify" | "liveHyphenation",
    label: string,
    value: boolean,
  ): void {
    let restoreInherited = (): void => {};
    const setting = new Setting(container)
      .setName(label)
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, key))
      .addToggle((toggle) => {
        const resolve = { indentParagraphs: workspaceIndentParagraphs, liveJustify: workspaceLiveJustify, liveHyphenation: workspaceLiveHyphenation }[key];
        restoreInherited = () => { toggle.setValue(resolve(this.app, this.plugin.settings, this.folder)); };
        toggle.setValue(value).onChange((next) => { void this.saveLocalField(projectRootPath, relativeScope, key, next); });
      });
    this.addResetButton(setting, projectRootPath, relativeScope, key, restoreInherited);
  }

  private renderTypographyNumber(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    key: "readingFontSize" | "lineHeight" | "textWidth",
    label: string,
    value: number,
  ): void {
    let restoreInherited = (): void => {};
    const setting = new Setting(container)
      .setName(label)
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, key))
      .addText((text) => {
        const resolve = { readingFontSize: workspaceReadingFontSize, lineHeight: workspaceLineHeight, textWidth: workspaceTextWidth }[key];
        restoreInherited = () => { text.setValue(String(resolve(this.app, this.plugin.settings, this.folder))); };
        text.setValue(String(value)).onChange((raw) => {
          const parsed = Number(raw);
          void this.saveLocalField(projectRootPath, relativeScope, key, Number.isFinite(parsed) ? parsed : 0);
        });
      });
    this.addResetButton(setting, projectRootPath, relativeScope, key, restoreInherited);
  }

  private addResetButton<K extends keyof FolderWorkspaceConfig>(
    setting: Setting,
    projectRootPath: string,
    relativeScope: string,
    key: K,
    restoreInherited?: () => void,
  ): void {
    let resetEl: HTMLElement | null = null;
    const refresh = (): void => {
      const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);
      setting.setDesc(this.sourceDescription(projectRootPath, relativeScope, key));
      if (this.hasLocalField(local, key)) {
        if (!resetEl) setting.addExtraButton((button) => {
          resetEl = button.extraSettingsEl;
          button.setIcon("rotate-ccw").setTooltip(t("modal.folderWorkspace.resetField"))
            .onClick(() => { void this.resetLocalField(projectRootPath, relativeScope, key); });
        });
      } else {
        resetEl?.remove();
        resetEl = null;
        restoreInherited?.();
      }
    };
    this.registerFieldRefresh(key, refresh);
    refresh();
  }

  private renderNumberGoal(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    key: "wordGoal" | "tolerance" | "projectWordGoal" | "sessionGoal",
    label: string,
    value: number,
  ): void {
    let restoreInherited = (): void => {};
    const setting = new Setting(container)
      .setName(label)
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, key))
      .addText((text) => {
        const resolve = { wordGoal: workspaceWordGoalDefault, tolerance: workspaceTolerance, projectWordGoal: workspaceTotalWordGoal, sessionGoal: workspaceSessionGoal }[key];
        restoreInherited = () => { text.setValue(String(resolve(this.app, this.plugin.settings, this.folder))); };
        text.setValue(String(value)).onChange((raw) => {
          const parsed = parseInt(raw, 10);
          void this.saveLocalField(projectRootPath, relativeScope, key, isNaN(parsed) ? 0 : Math.max(0, parsed));
        });
      });
    this.addResetButton(setting, projectRootPath, relativeScope, key, restoreInherited);
  }

  private addFieldReset<K extends keyof FolderWorkspaceConfig>(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    key: K,
    refresh?: () => void,
  ): void {
    const holder = container.createDiv();
    let visible = false;
    const update = (): void => {
      const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);
      const next = this.hasLocalField(local, key);
      if (next === visible) return;
      visible = next;
      holder.empty();
      if (visible) new Setting(holder).setName(t("modal.folderWorkspace.resetField")).addExtraButton((button) => button
        .setIcon("rotate-ccw")
        .setTooltip(t("modal.folderWorkspace.resetField"))
        .onClick(() => { void this.resetLocalField(projectRootPath, relativeScope, key, refresh); }));
    };
    this.registerFieldRefresh(key, update);
    update();
  }

  private async resetLocalConfig(projectRootPath: string, relativeScope: string): Promise<void> {
    const meta = this.plugin.settings.projectMeta[projectRootPath];
    if (!meta?.folderWorkspaces || !Object.prototype.hasOwnProperty.call(meta.folderWorkspaces, relativeScope)) return;
    const restoreResetFocus = this.resetButton?.buttonEl === this.contentEl.ownerDocument?.activeElement;
    const next = { ...meta.folderWorkspaces };
    const config = next[relativeScope];
    const identity: FolderWorkspaceConfig = { version: 1 };
    if (config.workspaceRoot === true) identity.workspaceRoot = true;
    if (config.ouvrage !== undefined) identity.ouvrage = config.ouvrage;
    if (isFolderWorkspaceConfigEmpty(identity)) delete next[relativeScope];
    else next[relativeScope] = identity;
    if (Object.keys(next).length === 0) delete meta.folderWorkspaces;
    else meta.folderWorkspaces = next;
    this.plugin.refreshCitationRendering?.();
    refreshReferenceCitationSettings(this.plugin);
    this.rerenderContent();
    if (restoreResetFocus) {
      const control = this.resetButton?.buttonEl.disabled
        ? this.contentEl.querySelector<HTMLElement>(".feuillets-workspace-essentials select")
        : this.resetButton?.buttonEl;
      control?.focus();
    }
    await saveWorkspaceSettings(this.plugin);
    this.plugin.renderAllViews(true);
  }

}
