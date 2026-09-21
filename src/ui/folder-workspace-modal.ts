import { App, Modal, Setting, TFolder, normalizePath, setIcon } from "obsidian";
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
  folderWorkspaceScopeChain,
  getFolderWorkspaceConfig,
  workspaceStatuses,
  workspaceTolerance,
  workspaceTotalWordGoal,
  workspaceTextWidth,
  workspaceWordGoalDefault,
  workspaceScopeToFolderPath,
} from "../services/folder-workspaces.js";
import { t, getLocale } from "../i18n/index.js";
import { statusDisplayLabel, labelDisplayLabel } from "../services/project-taxonomy.js";
import {
  listWorkspaceCitationCandidates,
  resolveWorkspaceCitationResources,
  type ResolvedWorkspaceCitationResource,
} from "../services/workspace-citations.js";

type FolderWorkspacePlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  saveSettings(): Promise<void>;
  renderAllViews(force?: boolean): void;
};

const PRESETS: FolderWorkspacePreset[] = ["free", "fiction", "nonfiction"];

function isFolderWorkspacePreset(value: string): value is FolderWorkspacePreset {
  return PRESETS.includes(value as FolderWorkspacePreset);
}

export class FolderWorkspaceModal extends Modal {
  private readonly plugin: FolderWorkspacePlugin;
  private readonly folder: TFolder;

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
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");

    const projectRoot = this.plugin.getProjectFolder();
    const relativeScope = projectRoot
      ? folderPathToWorkspaceScope(projectRoot.path, this.folder.path)
      : null;
    if (!projectRoot || !relativeScope) return;

    const meta = this.plugin.settings.projectMeta[projectRoot.path];
    const localConfig = getFolderWorkspaceConfig(meta, relativeScope);
    const inherited = this.findInheritedConfig(meta, projectRoot.path, this.folder.path);
    const effectiveConfig = localConfig || inherited.config;
    const selectedPreset = effectiveConfig?.preset || "free";

    const titleRow = contentEl.createDiv({ cls: "feuillets-modal-title-row" });
    setIcon(titleRow.createDiv({ cls: "feuillets-cell-icon" }), "folder-cog");
    titleRow.createEl("h3", {
      text: t("modal.folderWorkspace.title", { name: this.folder.name }),
    });
    contentEl.createDiv({
      text: t("modal.folderWorkspace.path", { path: relativeScope }),
      cls: "feuillets-notes-sub",
    });
    contentEl.createDiv({
      text: localConfig
        ? t("modal.folderWorkspace.local")
        : inherited.scope
          ? t("modal.folderWorkspace.inheritedFromParent", { name: inherited.name })
          : t("modal.folderWorkspace.inheritedFromProject"),
      cls: "feuillets-notes-sub",
    });

    this.renderOuvrageOption(contentEl, projectRoot);

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
      await this.plugin.saveSettings();
      this.plugin.renderAllViews(true);
      this.rerenderContent();
    };

    const presetSection = contentEl.createDiv({ cls: "feuillets-notes-section" });
    presetSection.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.preset") });
    new Setting(presetSection)
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

    new Setting(presetSection)
      .addButton((button) => button
        .setButtonText(t("modal.folderWorkspace.reset"))
        .setDisabled(!localConfig)
        .onClick(() => { void this.resetLocalConfig(projectRoot.path, relativeScope); }));

    const views = contentEl.createDiv({ cls: "feuillets-notes-section" });
    views.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.views") });
    this.renderViews(views, projectRoot.path, relativeScope);

    const workflow = contentEl.createDiv({ cls: "feuillets-notes-section" });
    workflow.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.workflow") });
    this.renderStatuses(workflow, projectRoot.path, relativeScope);
    this.renderLabels(workflow, projectRoot.path, relativeScope);
    this.renderFavoriteTags(workflow, projectRoot.path, relativeScope);

    const citations = contentEl.createDiv({ cls: "feuillets-notes-section" });
    citations.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.citations") });
    this.renderCitations(citations, projectRoot.path, relativeScope);

    const goals = contentEl.createDiv({ cls: "feuillets-notes-section" });
    goals.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.goals") });
    this.renderGoals(goals, projectRoot.path, relativeScope);

    const typography = contentEl.createDiv({ cls: "feuillets-notes-section" });
    typography.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.typography") });
    this.renderTypography(typography, projectRoot.path, relativeScope);
  }

  /** Option « Définir ce dossier comme ouvrage » — statut lu et écrit via
   *  services/editorial-roots.ts (isOuvrageRoot/registerOuvrage/
   *  unregisterOuvrage), seuls points d'accès légitimes à
   *  folderWorkspaces[relatif].ouvrage. Absente pour la racine globale, pour
   *  Front et ses descendants, et pour un dossier préfixé par "_" — mêmes
   *  exclusions que l'ancienne entrée de menu contextuel du Binder.
   *  Applique le changement immédiatement, comme tous les autres champs de
   *  cette modale (voir saveLocalField, renderTypographyToggle…) : pas
   *  d'état local ni de validation séparée. */
  private renderOuvrageOption(container: HTMLElement, projectRoot: TFolder): void {
    const rel = ouvrageRelativePath(projectRoot.path, this.folder.path);
    if (!rel) return;
    if (this.folder.name.startsWith("_")) return;
    const frontPath = normalizePath(`${projectRoot.path}/Front`);
    if (this.folder.path === frontPath || this.folder.path.startsWith(`${frontPath}/`)) return;
    if (this.folder.name === "Front" || this.folder.path.split("/").includes("Front")) return;

    new Setting(container)
      .setName(t("modal.folderWorkspace.defineAsOuvrage"))
      .addToggle((toggle) => toggle
        .setValue(isOuvrageRoot(this.app, this.plugin.settings, projectRoot, this.folder))
        .onChange(async (value) => {
          const changed = value
            ? registerOuvrage(this.plugin.settings, projectRoot, this.folder)
            : unregisterOuvrage(this.plugin.settings, projectRoot, this.folder);
          if (changed) {
            await this.plugin.saveSettings();
            this.plugin.renderAllViews(true);
            this.rerenderContent();
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
    this.addFieldReset(container, projectRootPath, relativeScope, "hiddenBoardModes");

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
    this.addFieldReset(container, projectRootPath, relativeScope, "outlineCols");

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
    this.addFieldReset(container, projectRootPath, relativeScope, "cardContent");
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private rerenderContent(): void {
    const scrollTop = this.contentEl.scrollTop;
    this.renderContent();
    this.contentEl.scrollTop = scrollTop;
    window.requestAnimationFrame(() => { this.contentEl.scrollTop = scrollTop; });
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
    await this.plugin.saveSettings();
    if (structural) {
      this.plugin.renderAllViews(true);
      this.rerenderContent();
    }
  }

  private async saveLocalListField<K extends "statuses" | "labels">(
    projectRootPath: string,
    relativeScope: string,
    key: K,
    value: FolderWorkspaceConfig[K],
    refresh: () => void,
  ): Promise<void> {
    await this.saveLocalField(projectRootPath, relativeScope, key, value);
    this.plugin.renderAllViews(true);
    refresh();
  }

  private async resetLocalField<K extends keyof FolderWorkspaceConfig>(
    projectRootPath: string,
    relativeScope: string,
    key: K,
    refresh?: () => void,
  ): Promise<void> {
    const meta = this.plugin.settings.projectMeta[projectRootPath];
    const workspaces = meta?.folderWorkspaces;
    const config = workspaces?.[relativeScope];
    if (!config || config[key] === undefined) return;
    const next = { ...config };
    delete next[key];
    if (Object.keys(next).some((name) => name !== "version")) workspaces[relativeScope] = next;
    else delete workspaces[relativeScope];
    if (Object.keys(workspaces).length === 0) delete meta.folderWorkspaces;
    await this.plugin.saveSettings();
    this.plugin.renderAllViews(true);
    if (refresh) refresh();
    else this.rerenderContent();
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
    const list = workspaceStatuses(this.app, this.plugin.settings, this.folder);
    const source = this.sourceDescription(projectRootPath, relativeScope, "statuses");
    new Setting(container)
      .setName(t("modal.folderWorkspace.statuses"))
      .setDesc(source)
      .addButton((button) => button
        .setButtonText(t("modal.folderWorkspace.customize"))
        .setDisabled(this.hasLocalField(local, "statuses"))
        .onClick(() => {
          const clone = list.map((status) => ({ ...status }));
          void this.saveLocalField(projectRootPath, relativeScope, "statuses", clone, true);
        }));

    const listContainer = container.createDiv({ cls: "feuillets-workspace-status-list" });
    const refresh = (): void => {
      listContainer.empty();
      this.renderStatusRows(listContainer, projectRootPath, relativeScope, refresh);
    };
    this.renderStatusRows(listContainer, projectRootPath, relativeScope, refresh);

    new Setting(container).addButton((button) => button
      .setButtonText(t("settings.statuses.add"))
      .onClick(() => {
        const next = this.localStatuses(projectRootPath, relativeScope, workspaceStatuses(this.app, this.plugin.settings, this.folder));
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
  ): void {
    const list = workspaceStatuses(this.app, this.plugin.settings, this.folder);
    const source = this.sourceDescription(projectRootPath, relativeScope, "statuses");
    list.forEach((status, index) => {
      new Setting(container)
        .setName(String(index + 1))
        .setDesc(source)
        /* A built-in entry shows its translated name (statusDisplayLabel);
           typing here is an explicit rename that forks it into a plain
           legacy/custom entry — see project-config-content.ts for the
           identical contract applied to the global statuses page. */
        .addText((text) => text.setValue(statusDisplayLabel(status, getLocale())).onChange((value) => {
          const next = this.localStatuses(projectRootPath, relativeScope, list);
          delete next[index].id;
          next[index].name = value;
          void this.saveLocalField(projectRootPath, relativeScope, "statuses", next);
        }))
        .addColorPicker((color) => color.setValue(status.color || "#888888").onChange((value) => {
          const next = this.localStatuses(projectRootPath, relativeScope, list);
          next[index].color = value;
          void this.saveLocalField(projectRootPath, relativeScope, "statuses", next);
        }))
        .addExtraButton((button) => button
          .setIcon("trash")
          .setTooltip(t("settings.statuses.deleteTooltip"))
          .onClick(() => {
            const next = this.localStatuses(projectRootPath, relativeScope, list);
            next.splice(index, 1);
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
    const list = workspaceLabels(this.app, this.plugin.settings, this.folder);
    const source = this.sourceDescription(projectRootPath, relativeScope, "labels");
    new Setting(container)
      .setName(t("modal.folderWorkspace.labels"))
      .setDesc(source)
      .addButton((button) => button
        .setButtonText(t("modal.folderWorkspace.customize"))
        .setDisabled(this.hasLocalField(local, "labels"))
        .onClick(() => {
          const clone = list.map((label) => ({ ...label }));
          void this.saveLocalField(projectRootPath, relativeScope, "labels", clone, true);
        }));
    const listContainer = container.createDiv({ cls: "feuillets-workspace-label-list" });
    const refresh = (): void => {
      listContainer.empty();
      this.renderLabelRows(listContainer, projectRootPath, relativeScope, refresh);
    };
    this.renderLabelRows(listContainer, projectRootPath, relativeScope, refresh);

    new Setting(container).addButton((button) => button
      .setButtonText(t("settings.labels.add"))
      .onClick(() => {
        const next = this.localLabels(projectRootPath, relativeScope, workspaceLabels(this.app, this.plugin.settings, this.folder));
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
  ): void {
    const list = workspaceLabels(this.app, this.plugin.settings, this.folder);
    const source = this.sourceDescription(projectRootPath, relativeScope, "labels");
    list.forEach((label, index) => {
      new Setting(container)
        .setName(String(index + 1))
        .setDesc(source)
        /* Same contract as renderStatusRows above: a built-in entry shows
           its translated name, and typing here forks it into a plain
           legacy/custom entry. */
        .addText((text) => text.setValue(labelDisplayLabel(label, getLocale())).onChange((value) => {
          const next = this.localLabels(projectRootPath, relativeScope, list);
          delete next[index].id;
          next[index].name = value;
          void this.saveLocalField(projectRootPath, relativeScope, "labels", next);
        }))
        .addColorPicker((color) => color.setValue(label.color).onChange((value) => {
          const next = this.localLabels(projectRootPath, relativeScope, list);
          next[index].color = value;
          void this.saveLocalField(projectRootPath, relativeScope, "labels", next);
        }))
        .addExtraButton((button) => button
          .setIcon("trash")
          .setTooltip(t("settings.labels.deleteTooltip"))
          .onClick(() => {
            const next = this.localLabels(projectRootPath, relativeScope, list);
            next.splice(index, 1);
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
      .addTextArea((text) => text
        .setPlaceholder(t("settings.favoriteTags.placeholder"))
        .setValue(workspaceFavoriteTags(this.app, this.plugin.settings, this.folder).join(", "))
        .onChange((value) => {
          const tags = [...new Set(value.split(/[,\n]+/).map((item) => item.replace(/^#/, "").trim()).filter(Boolean))];
          void this.saveLocalField(projectRootPath, relativeScope, "favoriteTags", tags);
        }));
    setting.addButton((button) => button
      .setButtonText(t("modal.folderWorkspace.customize"))
      .setDisabled(this.hasLocalField(local, "favoriteTags"))
      .onClick(() => {
        const clone = [...workspaceFavoriteTags(this.app, this.plugin.settings, this.folder)];
        void this.saveLocalField(projectRootPath, relativeScope, "favoriteTags", clone, true);
      }));
    this.addFieldReset(container, projectRootPath, relativeScope, "favoriteTags");
  }

  private renderGoals(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    this.renderNumberGoal(container, projectRootPath, relativeScope, "wordGoal", t("settings.wordGoal.name"), workspaceWordGoalDefault(this.app, this.plugin.settings, this.folder));
    this.renderNumberGoal(container, projectRootPath, relativeScope, "tolerance", t("settings.tolerance.name"), workspaceTolerance(this.app, this.plugin.settings, this.folder));
    this.renderNumberGoal(container, projectRootPath, relativeScope, "projectWordGoal", t("modal.folderWorkspace.totalWordGoal"), workspaceTotalWordGoal(this.app, this.plugin.settings, this.folder));
    this.renderNumberGoal(container, projectRootPath, relativeScope, "sessionGoal", t("settings.sessionGoal.name"), workspaceSessionGoal(this.app, this.plugin.settings, this.folder));

    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);
    const deadline = new Setting(container)
      .setName(t("settings.deadline.name"))
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, "deadlineDate"))
      .addText((text) => text
        .setPlaceholder(t("settings.deadline.placeholder"))
        .setValue(workspaceDeadline(this.app, this.plugin.settings, this.folder))
        .onChange((value) => { void this.saveLocalField(projectRootPath, relativeScope, "deadlineDate", value.trim()); }));
    if (this.hasLocalField(local, "deadlineDate")) deadline.addExtraButton((button) => button
      .setIcon("rotate-ccw")
      .setTooltip(t("modal.folderWorkspace.resetField"))
      .onClick(() => { void this.resetLocalField(projectRootPath, relativeScope, "deadlineDate"); }));
  }

  private renderTypography(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    this.renderTypographyToggle(container, projectRootPath, relativeScope, "indentParagraphs", t("settings.indentParagraphs.name"), workspaceIndentParagraphs(this.app, this.plugin.settings, this.folder));
    this.renderTypographyToggle(container, projectRootPath, relativeScope, "liveJustify", t("settings.liveJustify.name"), workspaceLiveJustify(this.app, this.plugin.settings, this.folder));

    const emptyLines = workspaceLiveEmptyLines(this.app, this.plugin.settings, this.folder);
    const emptySetting = new Setting(container)
      .setName(t("settings.liveEmptyLines.name"))
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, "liveEmptyLines"))
      .addDropdown((dropdown) => dropdown
        .addOption("normal", t("settings.liveEmptyLines.normal"))
        .addOption("reduit", t("settings.liveEmptyLines.reduced"))
        .addOption("invisible", t("settings.liveEmptyLines.invisible"))
        .setValue(emptyLines)
        .onChange((value) => {
          if (value === "normal" || value === "reduit" || value === "invisible") void this.saveLocalField(projectRootPath, relativeScope, "liveEmptyLines", value);
        }));
    this.addResetButton(emptySetting, projectRootPath, relativeScope, "liveEmptyLines");

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
    const setting = new Setting(container)
      .setName(label)
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, key))
      .addToggle((toggle) => toggle.setValue(value).onChange((next) => { void this.saveLocalField(projectRootPath, relativeScope, key, next); }));
    this.addResetButton(setting, projectRootPath, relativeScope, key);
  }

  private renderTypographyNumber(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    key: "readingFontSize" | "lineHeight" | "textWidth",
    label: string,
    value: number,
  ): void {
    const setting = new Setting(container)
      .setName(label)
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, key))
      .addText((text) => text.setValue(String(value)).onChange((raw) => {
        const parsed = Number(raw);
        void this.saveLocalField(projectRootPath, relativeScope, key, Number.isFinite(parsed) ? parsed : 0);
      }));
    this.addResetButton(setting, projectRootPath, relativeScope, key);
  }

  private addResetButton<K extends keyof FolderWorkspaceConfig>(
    setting: Setting,
    projectRootPath: string,
    relativeScope: string,
    key: K,
  ): void {
    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);
    if (this.hasLocalField(local, key)) setting.addExtraButton((button) => button
      .setIcon("rotate-ccw")
      .setTooltip(t("modal.folderWorkspace.resetField"))
      .onClick(() => { void this.resetLocalField(projectRootPath, relativeScope, key); }));
  }

  private renderNumberGoal(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    key: "wordGoal" | "tolerance" | "projectWordGoal" | "sessionGoal",
    label: string,
    value: number,
  ): void {
    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);
    const setting = new Setting(container)
      .setName(label)
      .setDesc(this.sourceDescription(projectRootPath, relativeScope, key))
      .addText((text) => text.setValue(String(value)).onChange((raw) => {
        const parsed = parseInt(raw, 10);
        void this.saveLocalField(projectRootPath, relativeScope, key, isNaN(parsed) ? 0 : Math.max(0, parsed));
      }));
    if (this.hasLocalField(local, key)) setting.addExtraButton((button) => button
      .setIcon("rotate-ccw")
      .setTooltip(t("modal.folderWorkspace.resetField"))
      .onClick(() => { void this.resetLocalField(projectRootPath, relativeScope, key); }));
  }

  private addFieldReset<K extends keyof FolderWorkspaceConfig>(
    container: HTMLElement,
    projectRootPath: string,
    relativeScope: string,
    key: K,
    refresh?: () => void,
  ): void {
    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);
    if (!this.hasLocalField(local, key)) return;
    new Setting(container).setName(t("modal.folderWorkspace.resetField")).addExtraButton((button) => button
      .setIcon("rotate-ccw")
      .setTooltip(t("modal.folderWorkspace.resetField"))
      .onClick(() => { void this.resetLocalField(projectRootPath, relativeScope, key, refresh); }));
  }

  private findInheritedConfig(
    meta: ProjectMeta | undefined,
    projectRootPath: string,
    folderPath: string,
  ): { config: FolderWorkspaceConfig | undefined; scope: string | null; name: string } {
    const chain = folderWorkspaceScopeChain(projectRootPath, folderPath);
    for (const scope of chain.slice(1)) {
      const config = getFolderWorkspaceConfig(meta, scope);
      if (!config) continue;
      const inheritedPath = workspaceScopeToFolderPath(projectRootPath, scope);
      const inheritedFolder = inheritedPath
        ? this.app.vault.getAbstractFileByPath(inheritedPath)
        : null;
      return {
        config,
        scope,
        name: inheritedFolder instanceof TFolder ? inheritedFolder.name : scope.split("/").pop() || scope,
      };
    }
    return { config: undefined, scope: null, name: "" };
  }

  private async resetLocalConfig(projectRootPath: string, relativeScope: string): Promise<void> {
    const meta = this.plugin.settings.projectMeta[projectRootPath];
    if (!meta?.folderWorkspaces || !Object.prototype.hasOwnProperty.call(meta.folderWorkspaces, relativeScope)) return;
    const next = { ...meta.folderWorkspaces };
    delete next[relativeScope];
    if (Object.keys(next).length === 0) delete meta.folderWorkspaces;
    else meta.folderWorkspaces = next;
    await this.plugin.saveSettings();
    this.plugin.renderAllViews(true);
    this.rerenderContent();
  }

  private citationSourceDescription(
    projectRootPath: string,
    relativeScope: string,
    res: ResolvedWorkspaceCitationResource,
    localConfig: FolderWorkspaceConfig | undefined,
    fieldKey: "citekeyBibliographyPath" | "citekeyCslPath",
  ): string {
    const hasLocal = this.hasLocalField(localConfig, fieldKey);

    if (res.status === "not_configured") {
      return t("modal.folderWorkspace.notConfigured");
    }

    if (res.status === "disabled") {
      if (hasLocal) {
        return `${t("modal.folderWorkspace.local")} — ${t("modal.folderWorkspace.disabled")}`;
      }
      if (res.sourceScope && res.sourceScope.path === projectRootPath) {
        return `${t("modal.folderWorkspace.inheritedFromProject")} — ${t("modal.folderWorkspace.disabled")}`;
      }
      const name = res.sourceScope ? res.sourceScope.name : "";
      return `${t("modal.folderWorkspace.inheritedFromParent", { name })} — ${t("modal.folderWorkspace.disabled")}`;
    }

    let provenance: string;
    if (hasLocal) {
      provenance = t("modal.folderWorkspace.local");
    } else if (res.source === "ancestor" && res.sourceScope) {
      provenance = t("modal.folderWorkspace.inheritedFromParent", { name: res.sourceScope.name });
    } else if (res.source === "legacy") {
      provenance = t("modal.folderWorkspace.inheritedFromLegacy");
    } else {
      provenance = t("modal.folderWorkspace.inheritedFromProject");
    }

    if (res.status === "valid") {
      return provenance;
    }
    if (res.status === "missing_file") {
      return `${provenance} — ${t("modal.folderWorkspace.missingFile")}`;
    }
    if (res.status === "invalid_path") {
      return `${provenance} — ${t("modal.folderWorkspace.invalidPath")}`;
    }
    if (res.status === "unbound_research") {
      return `${provenance} — ${t("modal.folderWorkspace.unboundResearch")}`;
    }

    return provenance;
  }

  private renderCitations(container: HTMLElement, projectRootPath: string, relativeScope: string): void {
    const projectFolder = this.app.vault.getAbstractFileByPath(projectRootPath);
    if (!(projectFolder instanceof TFolder)) return;

    const resolution = resolveWorkspaceCitationResources(
      this.app,
      this.plugin.settings,
      projectFolder,
      this.folder,
    );

    const selectionResearchFolder = resolution.selectionResearchFolder;
    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);

    // --- Bibliography (.bib) ---
    const bibDesc = this.citationSourceDescription(
      projectRootPath,
      relativeScope,
      resolution.bibliography,
      local,
      "citekeyBibliographyPath",
    );
    const bibCandidates = selectionResearchFolder
      ? listWorkspaceCitationCandidates(this.app, selectionResearchFolder, "bib")
      : [];
    const hasLocalBib = this.hasLocalField(local, "citekeyBibliographyPath");
    const localBibVal = local?.citekeyBibliographyPath ?? "";

    new Setting(container)
      .setName(t("modal.folderWorkspace.bibliography"))
      .setDesc(bibDesc)
      .addDropdown((d) => {
        if (!hasLocalBib && resolution.bibliography.source !== "none" && resolution.bibliography.relativePath) {
          const inheritedLabel = `${resolution.bibliography.relativePath} (${bibDesc})`;
          d.addOption("__inherited__", inheritedLabel);
        }
        d.addOption("", t("modal.folderWorkspace.noFile"));
        for (const c of bibCandidates) {
          d.addOption(c.relativePath, c.relativePath);
        }
        if (hasLocalBib && localBibVal !== "" && !bibCandidates.some((c) => c.relativePath === localBibVal)) {
          d.addOption(localBibVal, t("modal.folderWorkspace.missingItemLabel", { file: localBibVal }));
        }

        if (hasLocalBib) {
          d.setValue(localBibVal);
        } else if (resolution.bibliography.source !== "none" && resolution.bibliography.relativePath) {
          d.setValue("__inherited__");
        } else {
          d.setValue("");
        }

        if (!selectionResearchFolder) {
          d.setDisabled(true);
        } else {
          d.onChange((value) => {
            if (value === "__inherited__") return;
            void this.saveLocalField(projectRootPath, relativeScope, "citekeyBibliographyPath", value, true);
          });
        }
      });
    this.addFieldReset(container, projectRootPath, relativeScope, "citekeyBibliographyPath");

    // --- Citation style (.csl) ---
    const cslDesc = this.citationSourceDescription(
      projectRootPath,
      relativeScope,
      resolution.csl,
      local,
      "citekeyCslPath",
    );
    const cslCandidates = selectionResearchFolder
      ? listWorkspaceCitationCandidates(this.app, selectionResearchFolder, "csl")
      : [];
    const hasLocalCsl = this.hasLocalField(local, "citekeyCslPath");
    const localCslVal = local?.citekeyCslPath ?? "";

    new Setting(container)
      .setName(t("modal.folderWorkspace.csl"))
      .setDesc(cslDesc)
      .addDropdown((d) => {
        if (!hasLocalCsl && resolution.csl.source !== "none" && resolution.csl.relativePath) {
          const inheritedLabel = `${resolution.csl.relativePath} (${cslDesc})`;
          d.addOption("__inherited__", inheritedLabel);
        }
        d.addOption("", t("modal.folderWorkspace.noFile"));
        for (const c of cslCandidates) {
          d.addOption(c.relativePath, c.relativePath);
        }
        if (hasLocalCsl && localCslVal !== "" && !cslCandidates.some((c) => c.relativePath === localCslVal)) {
          d.addOption(localCslVal, t("modal.folderWorkspace.missingItemLabel", { file: localCslVal }));
        }

        if (hasLocalCsl) {
          d.setValue(localCslVal);
        } else if (resolution.csl.source !== "none" && resolution.csl.relativePath) {
          d.setValue("__inherited__");
        } else {
          d.setValue("");
        }

        if (!selectionResearchFolder) {
          d.setDisabled(true);
        } else {
          d.onChange((value) => {
            if (value === "__inherited__") return;
            void this.saveLocalField(projectRootPath, relativeScope, "citekeyCslPath", value, true);
          });
        }
      });
    this.addFieldReset(container, projectRootPath, relativeScope, "citekeyCslPath");
  }
}
