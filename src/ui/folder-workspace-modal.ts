import { App, Modal, Setting, TFolder } from "obsidian";
import { PROJECT_MODES, projectBoardDefaults } from "../utils/project-modes.js";
import { newSheetIncludeSourcesForProjectType, planningFieldForProjectType } from "../services/project-settings.js";
import {
  folderPathToWorkspaceScope,
  workspaceDeadline,
  workspaceFavoriteTags,
  workspaceFieldSource,
  workspaceLabels,
  workspaceSessionGoal,
  folderWorkspaceScopeChain,
  getFolderWorkspaceConfig,
  workspaceStatuses,
  workspaceTolerance,
  workspaceTotalWordGoal,
  workspaceWordGoalDefault,
  workspaceScopeToFolderPath,
} from "../services/folder-workspaces.js";
import { t } from "../i18n/index.js";

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

    contentEl.createEl("h3", {
      text: t("modal.folderWorkspace.title", { name: this.folder.name }),
    });
    contentEl.createEl("p", {
      text: t("modal.folderWorkspace.path", { path: relativeScope }),
      cls: "setting-item-description",
    });
    contentEl.createEl("p", {
      text: localConfig
        ? t("modal.folderWorkspace.local")
        : inherited.scope
          ? t("modal.folderWorkspace.inheritedFromParent", { name: inherited.name })
          : t("modal.folderWorkspace.inheritedFromProject"),
      cls: "setting-item-description",
    });

    const saveLocalPreset = async (preset: FolderWorkspacePreset): Promise<void> => {
      const boardDefaults = projectBoardDefaults(preset);
      const mode = PROJECT_MODES[preset];
      const config: FolderWorkspaceConfig = {
        version: 1,
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
      this.close();
    };

    new Setting(contentEl)
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

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText(t("modal.folderWorkspace.reset"))
        .setDisabled(!localConfig)
        .onClick(() => { void this.resetLocalConfig(projectRoot.path, relativeScope); }));

    const workflow = contentEl.createDiv({ cls: "feuillets-notes-section" });
    workflow.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.workflow") });
    this.renderStatuses(workflow, projectRoot.path, relativeScope);
    this.renderLabels(workflow, projectRoot.path, relativeScope);
    this.renderFavoriteTags(workflow, projectRoot.path, relativeScope);

    const goals = contentEl.createDiv({ cls: "feuillets-notes-section" });
    goals.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.folderWorkspace.goals") });
    this.renderGoals(goals, projectRoot.path, relativeScope);
  }

  onClose(): void {
    this.contentEl.empty();
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
  ): Promise<void> {
    const config = this.localConfig(projectRootPath, relativeScope);
    config[key] = value;
    await this.plugin.saveSettings();
    this.plugin.renderAllViews(true);
    this.renderContent();
  }

  private async resetLocalField<K extends keyof FolderWorkspaceConfig>(
    projectRootPath: string,
    relativeScope: string,
    key: K,
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
    this.renderContent();
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
          void this.saveLocalField(projectRootPath, relativeScope, "statuses", clone);
        }));

    list.forEach((status, index) => {
      new Setting(container)
        .setName(String(index + 1))
        .setDesc(source)
        .addText((text) => text.setValue(status.name || "").onChange((value) => {
          const next = this.localStatuses(projectRootPath, relativeScope, list);
          next[index].name = value.trim() || t("settings.statuses.item", { n: String(index + 1) });
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
            void this.saveLocalField(projectRootPath, relativeScope, "statuses", next);
          }));
    });

    new Setting(container).addButton((button) => button
      .setButtonText(t("settings.statuses.add"))
      .onClick(() => {
        const next = this.localStatuses(projectRootPath, relativeScope, list);
        next.push({ name: t("settings.statuses.item", { n: String(next.length + 1) }), color: "#888888" });
        void this.saveLocalField(projectRootPath, relativeScope, "statuses", next);
      }));
    this.addFieldReset(container, projectRootPath, relativeScope, "statuses");
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
          void this.saveLocalField(projectRootPath, relativeScope, "labels", clone);
        }));
    list.forEach((label, index) => {
      new Setting(container)
        .setName(String(index + 1))
        .setDesc(source)
        .addText((text) => text.setValue(label.name).onChange((value) => {
          const next = this.localLabels(projectRootPath, relativeScope, list);
          next[index].name = value.trim() || t("settings.labels.item", { n: String(index + 1) });
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
            void this.saveLocalField(projectRootPath, relativeScope, "labels", next);
          }));
    });
    new Setting(container).addButton((button) => button
      .setButtonText(t("settings.labels.add"))
      .onClick(() => {
        const next = this.localLabels(projectRootPath, relativeScope, list);
        next.push({ name: t("settings.labels.item", { n: String(next.length + 1) }), color: "#888888" });
        void this.saveLocalField(projectRootPath, relativeScope, "labels", next);
      }));
    this.addFieldReset(container, projectRootPath, relativeScope, "labels");
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
        void this.saveLocalField(projectRootPath, relativeScope, "favoriteTags", clone);
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
        .setPlaceholder("AAAA-MM-JJ")
        .setValue(workspaceDeadline(this.app, this.plugin.settings, this.folder))
        .onChange((value) => { void this.saveLocalField(projectRootPath, relativeScope, "deadlineDate", value.trim()); }));
    if (this.hasLocalField(local, "deadlineDate")) deadline.addExtraButton((button) => button
      .setIcon("rotate-ccw")
      .setTooltip(t("modal.folderWorkspace.resetField"))
      .onClick(() => { void this.resetLocalField(projectRootPath, relativeScope, "deadlineDate"); }));
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
  ): void {
    const local = getFolderWorkspaceConfig(this.plugin.settings.projectMeta[projectRootPath], relativeScope);
    if (!this.hasLocalField(local, key)) return;
    new Setting(container).setName(t("modal.folderWorkspace.resetField")).addExtraButton((button) => button
      .setIcon("rotate-ccw")
      .setTooltip(t("modal.folderWorkspace.resetField"))
      .onClick(() => { void this.resetLocalField(projectRootPath, relativeScope, key); }));
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
    this.close();
  }
}
