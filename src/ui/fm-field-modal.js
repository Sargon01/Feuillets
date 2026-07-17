const { Modal } = require("obsidian");

export class FmFieldModal extends Modal {
  constructor(app, plugin, file, key, title) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.key = key;
    this.titleText = title;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: `${this.titleText} — ${this.plugin.titleFor(this.file)}`,
    });
    const fm = this.plugin.fmOf(this.file);
    const ta = contentEl.createEl("textarea", { attr: { rows: "8" } });
    ta.style.width = "100%";
    ta.value = fm[this.key] || "";
    ta.focus();
    const save = async () => {
      const v = ta.value.trim();
      await this.app.fileManager.processFrontMatter(this.file, (x) => {
        if (v) x[this.key] = v;
        else delete x[this.key];
      });
      this.close();
    };
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: "Enregistrer" })
      .addEventListener("click", save);
  }
  onClose() {
    this.contentEl.empty();
  }
}
