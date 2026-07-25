import { VIEW_RESEARCH } from "../constants.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { isEditing } from "../utils/dom.js";

const { TFile } = require("obsidian");

export class ResearchView extends BaseFeuilletsView {
  constructor(leaf, plugin) {
    super(leaf, plugin);
  }

  getViewType() {
    return VIEW_RESEARCH;
  }

  getDisplayText() {
    return "Recherche";
  }

  getIcon() {
    return "library-big";
  }

  async onOpen() {
    await this.render();
  }

  async render(force = false) {
    const container = this.targetContainer || this.contentEl;
    if (!force && isEditing(container)) return;

    const myGen = (this._renderGen = (this._renderGen || 0) + 1);
    container.empty();
    container.addClass("feuillets-research-container");

    const root = this.plugin.getProjectFolder();
    if (!root) {
      container
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucun dossier projet défini (réglages du plugin).");
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
