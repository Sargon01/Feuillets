const { Modal } = require("obsidian");

export class NewSheetModal extends Modal {
  constructor(app, folderName, onSubmit) {
    super(app);
    this.folderName = folderName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: `Nouveau feuillet dans « ${this.folderName} »`,
    });
    contentEl.createEl("label", { text: "Nom du fichier (technique)" });
    const fileInput = contentEl.createEl("input", {
      type: "text",
      placeholder: "ex. scene-12-01",
    });
    fileInput.style.width = "100%";
    fileInput.style.marginBottom = "8px";
    contentEl.createEl("label", {
      text: "Titre (facultatif, seul le titre peut apparaître à la compilation)",
    });
    const titleInput = contentEl.createEl("input", { type: "text" });
    titleInput.style.width = "100%";
    fileInput.focus();
    const submit = () => {
      const fileName = fileInput.value.trim();
      if (!fileName) return;
      this.close();
      this.onSubmit(fileName, titleInput.value.trim());
    };
    for (const el of [fileInput, titleInput]) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    }
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: "Créer" })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class NewFolderModal extends Modal {
  constructor(app, parentName, onSubmit) {
    super(app);
    this.parentName = parentName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: `Nouveau dossier dans « ${this.parentName} »`,
    });
    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: "ex. Partie III",
    });
    input.style.width = "100%";
    input.focus();
    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      this.close();
      this.onSubmit(name);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: "Créer" })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}
