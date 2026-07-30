import { TFile, type WorkspaceLeaf } from "obsidian";
import { VIEW_RESEARCH } from "../constants.js";
import { t } from "../i18n/index.js";
import { isEditing } from "../utils/dom.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";

type ResearchViewPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];

export class ResearchView extends BaseFeuilletsView {
  declare plugin: ResearchViewPlugin;
  declare targetContainer?: HTMLElement;
  declare viewingFile: TFile | null;
  declare _renderGen?: number;

  constructor(leaf: WorkspaceLeaf, plugin: ResearchViewPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return VIEW_RESEARCH;
  }

  getDisplayText(): string {
    return t("research.displayText");
  }

  getIcon(): string {
    return "book-marked";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(force = false): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    if (!force && isEditing(container)) return;

    const myGen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-research-container");

    const root = this.plugin.getProjectFolder();
    if (!root) {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("board.noProjectFolder"));
      return;
    }

    if (this.viewingFile) {
      const stillExists = this.app.vault.getAbstractFileByPath(
        this.viewingFile.path
      );
      if (stillExists instanceof TFile) {
        await this.renderFileView(container, stillExists, root);
        return;
      }
      this.viewingFile = null;
    }

    await this.renderResearchBody(container, root, myGen);
  }
}
