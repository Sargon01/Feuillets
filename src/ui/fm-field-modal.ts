import { Modal, type App, type TFile } from "obsidian";
import { t } from "../i18n/index.js";

type FrontmatterPlugin = {
  titleFor(file: TFile): string;
  fmOf(file: TFile): Record<string, string | undefined>;
};

type SavedHandler = () => void | Promise<void>;

export class FmFieldModal extends Modal {
  plugin: FrontmatterPlugin;
  file: TFile;
  key: string;
  titleText: string;
  onSaved?: SavedHandler;

  constructor(app: App, plugin: FrontmatterPlugin, file: TFile, key: string, title: string, onSaved?: SavedHandler) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.key = key;
    this.titleText = title;
    this.onSaved = onSaved;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: `${this.titleText} — ${this.plugin.titleFor(this.file)}`,
    });
    const fm = this.plugin.fmOf(this.file);
    const ta = contentEl.createEl("textarea", { attr: { rows: "8" } });
    ta.addClass("feuillets-input-full");
    ta.value = fm[this.key] || "";
    ta.focus();
    const save = async () => {
      const v = ta.value.trim();
      await this.app.fileManager.processFrontMatter(this.file, (x) => {
        if (v) x[this.key] = v;
        else delete x[this.key];
      });
      this.close();
      if (this.onSaved) this.onSaved();
    };
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.save") })
      .addEventListener("click", save);
  }
  onClose() {
    this.contentEl.empty();
  }
}
