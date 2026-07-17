const { Modal, Notice } = require("obsidian");

export class CompileSelectionModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Feuillets à compiler" });
    contentEl
      .createEl("p", {
        cls: "feuillets-notes-sub",
      })
      .setText(
        "Décocher un feuillet écrit compiler: false dans son frontmatter — il reste visible et numéroté, mais saute à l'export."
      );
    const root = this.plugin.getProjectFolder();
    if (!root) {
      contentEl.setText("Dossier projet introuvable.");
      return;
    }
    const numbering = this.plugin.buildNumbering(root);
    const list = contentEl.createDiv({ cls: "feuillets-read-selection" });
    const boxes = [];
    for (const f of this.plugin.flattenFiles(root)) {
      const fm = this.plugin.fmOf(f);
      const row = list.createDiv({ cls: "feuillets-read-selection-row" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = !(fm.compiler === false || fm.compile === false);
      boxes.push([cb, f]);
      const label = row.createSpan();
      label.setText(
        `${numbering.get(f.path) || ""} ${this.plugin.titleFor(f)}`.trim()
      );
      label.addEventListener("click", () => {
        cb.checked = !cb.checked;
      });
    }
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: "Tout" }).addEventListener("click", () => {
      boxes.forEach(([cb]) => (cb.checked = true));
    });
    btnRow.createEl("button", { text: "Aucun" }).addEventListener("click", () => {
      boxes.forEach(([cb]) => (cb.checked = false));
    });
    btnRow
      .createEl("button", { text: "Enregistrer" })
      .addEventListener("click", async () => {
        let changed = 0;
        for (const [cb, f] of boxes) {
          const fm = this.plugin.fmOf(f);
          const current = !(fm.compiler === false || fm.compile === false);
          if (cb.checked !== current) {
            await this.app.fileManager.processFrontMatter(f, (x) => {
              if (cb.checked) delete x.compiler;
              else x.compiler = false;
              delete x.compile;
            });
            changed++;
          }
        }
        new Notice(`${changed} feuillet(s) mis à jour.`);
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
    const selected = new Set(this.plugin.settings.readSelection || []);
    const numbering = this.plugin.buildNumbering(root);
    const list = contentEl.createDiv({ cls: "feuillets-read-selection" });
    const boxes = [];
    for (const f of this.plugin.flattenFiles(root)) {
      const row = list.createDiv({ cls: "feuillets-read-selection-row" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = selected.has(f.path);
      boxes.push([cb, f.path]);
      const label = row.createSpan();
      label.setText(
        `${numbering.get(f.path) || ""} ${this.plugin.titleFor(f)}`.trim()
      );
      label.addEventListener("click", () => {
        cb.checked = !cb.checked;
      });
    }
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: "Tout" }).addEventListener("click", () => {
      boxes.forEach(([cb]) => (cb.checked = true));
    });
    btnRow.createEl("button", { text: "Aucun" }).addEventListener("click", () => {
      boxes.forEach(([cb]) => (cb.checked = false));
    });
    btnRow
      .createEl("button", { text: "Lire la sélection" })
      .addEventListener("click", async () => {
        this.plugin.settings.readSelection = boxes
          .filter(([cb]) => cb.checked)
          .map(([, p]) => p);
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
