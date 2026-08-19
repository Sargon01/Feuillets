import { ItemView, type WorkspaceLeaf } from "obsidian";
import { VIEW_PROJECT } from "../constants.js";
import { t } from "../i18n/index.js";

type ProjectViewPlugin = {
  activateEditionPage(page: "home"): Promise<void>;
};

/** Shim de compatibilité pour les workspaces Obsidian qui référencent encore
 * l'ancien type de vue `feuillets-project`. Le contenu Projet/Export n'existe
 * plus comme vue autonome : toute restauration de cette leaf ouvre l'accueil
 * Édition dans la sidebar unifiée, puis retire la leaf héritée. */
export class ProjectView extends ItemView {
  readonly plugin: ProjectViewPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ProjectViewPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_PROJECT;
  }

  getDisplayText(): string {
    return t("sidebar.tab.edition");
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    await this.plugin.activateEditionPage("home");
    this.leaf.detach();
  }
}
