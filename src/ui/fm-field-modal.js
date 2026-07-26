const { Modal } = require("obsidian");
import { t } from "../i18n/index.js";

export class FmFieldModal extends Modal {
  constructor(app, plugin, file, key, title, onSaved) {
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
