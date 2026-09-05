import { App, Modal, Setting, TFolder } from "obsidian";
import { PROJECT_MODES, projectBoardDefaults } from "../utils/project-modes.js";
import { newSheetIncludeSourcesForProjectType, planningFieldForProjectType } from "../services/project-settings.js";
import {
  folderPathToWorkspaceScope,
  folderWorkspaceScopeChain,
  getFolderWorkspaceConfig,
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
  }

  onClose(): void {
    this.contentEl.empty();
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
