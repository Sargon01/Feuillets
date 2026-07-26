const { Modal } = require("obsidian");

export class CompileSelectionModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Feuillets à compiler" });
    contentEl.createEl("p", { cls: "feuillets-notes-sub" }).setText(
      "Décocher un feuillet écrit compile: false dans son frontmatter — il reste visible et numéroté, mais saute à l'export."
    );

    const root = this.plugin.getProjectFolder();
    if (!root) {
      contentEl.setText("Dossier projet introuvable.");
      return;
    }

    const numbering = this.plugin.buildNumbering(root);
    const listEl = contentEl.createDiv({ cls: "feuillets-read-selection" });
    const checkboxes = [];

    for (const file of this.plugin.flattenFiles(root)) {
      const fm = this.plugin.fmOf(file);
      const row = listEl.createDiv({ cls: "feuillets-read-selection-row" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = fm.compile !== false;
      checkboxes.push([cb, file]);

      const label = row.createSpan();
      label.setText(`${numbering.get(file.path) || ""} ${this.plugin.shortTitleFor(file)}`.trim());
      label.addEventListener("click", () => {
        cb.checked = !cb.checked;
      });
    }

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: "Tout" }).addEventListener("click", () => {
      checkboxes.forEach(([cb]) => (cb.checked = true));
    });
    btnRow.createEl("button", { text: "Aucun" }).addEventListener("click", () => {
      checkboxes.forEach(([cb]) => (cb.checked = false));
    });
    btnRow.createEl("button", { text: "Enregistrer", cls: "mod-cta" }).addEventListener("click", async () => {
      for (const [cb, file] of checkboxes) {
        const fm = this.plugin.fmOf(file);
        const current = fm.compile !== false;
        if (cb.checked !== current) {
          await this.app.fileManager.processFrontMatter(file, (data) => {
            if (cb.checked) delete data.compile;
            else data.compile = false;
            delete data.compiler;
          });
        }
      }
      this.close();
      this.plugin.renderAllViews(true);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class ReadSelectionModal extends Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Sélection de feuillets à lire" });

    const root = this.plugin.getProjectFolder();
    if (!root) {
      contentEl.setText("Dossier projet introuvable.");
      return;
    }

    const currentSelection = new Set(this.plugin.settings.readSelection || []);
    const numbering = this.plugin.buildNumbering(root);
    const listEl = contentEl.createDiv({ cls: "feuillets-read-selection" });
    const checkboxes = [];

    for (const file of this.plugin.flattenFiles(root)) {
      const row = listEl.createDiv({ cls: "feuillets-read-selection-row" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = currentSelection.has(file.path);
      checkboxes.push([cb, file.path]);

      const label = row.createSpan();
      // Utilisation explicite du titre court
      label.setText(`${numbering.get(file.path) || ""} ${this.plugin.shortTitleFor(file)}`.trim());
      label.addEventListener("click", () => {
        cb.checked = !cb.checked;
      });
    }

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: "Tout" }).addEventListener("click", () => {
      checkboxes.forEach(([cb]) => (cb.checked = true));
    });
    btnRow.createEl("button", { text: "Aucun" }).addEventListener("click", () => {
      checkboxes.forEach(([cb]) => (cb.checked = false));
    });
    btnRow.createEl("button", { text: "Lire la sélection", cls: "mod-cta" }).addEventListener("click", async () => {
      this.plugin.settings.readSelection = checkboxes.filter(([cb]) => cb.checked).map(([, path]) => path);
      this.plugin.settings.readScope = "__selection__";
      await this.plugin.saveSettings();
      this.close();
      if (this.onDone) this.onDone();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}