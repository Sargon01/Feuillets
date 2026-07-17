const { Modal, Notice, normalizePath, TFolder } = require("obsidian");
import { PROJECT_MODES, applyModeDefaults, resolveType } from "../utils/project-modes.js";

export class NewProjectModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("feuillets-project-modal");
    contentEl.createEl("h3", { text: "Créer un nouveau projet" });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      "Crée un dossier de volume contenant Manuscrit, Recherche, Snapshots, Journal et Sortie en frères — la structure correcte dès le départ, sans réglage manuel à faire dans le bon ordre."
    );

    contentEl.createEl("label", { text: "Dossier parent (facultatif)" });
    const parentInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "Romans (laisser vide pour la racine du coffre)" },
    });
    parentInput.style.width = "100%";
    parentInput.style.marginBottom = "10px";

    contentEl.createEl("label", { text: "Nom du projet" });
    const nameInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "Roman1" },
    });
    nameInput.style.width = "100%";
    nameInput.style.marginBottom = "10px";

    contentEl.createEl("label", { text: "Type de document" });
    const typeSelect = contentEl.createEl("select");
    typeSelect.style.width = "100%";
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }

    const create = async () => {
      const name = nameInput.value.trim();
      if (!name) {
        new Notice("Donne un nom au projet.");
        return;
      }
      const parent = parentInput.value.trim().replace(/\/+$/, "");
      const volumePath = normalizePath(parent ? `${parent}/${name}` : name);
      if (this.app.vault.getAbstractFileByPath(volumePath)) {
        new Notice(`« ${volumePath} » existe déjà.`);
        return;
      }

      const S = this.plugin.settings;
      await this.plugin.ensureFolder(volumePath);
      const manuscritPath = normalizePath(`${volumePath}/Manuscrit`);
      await this.plugin.ensureFolder(manuscritPath);

      if (S.projectFolder && !S.projects.includes(S.projectFolder)) {
        S.projects.push(S.projectFolder);
      }
      S.projectFolder = manuscritPath;
      const type = typeSelect.value;
      if (!S.projectMeta[manuscritPath]) S.projectMeta[manuscritPath] = {};
      S.projectMeta[manuscritPath].type = type;
      applyModeDefaults(S, type);
      await this.plugin.saveSettings();

      await this.plugin.initProjectStructure();
      await this.plugin.getOutputFolder();

      this.plugin.renderAllViews(true);
      this.plugin.updateStatusBar();
      new Notice(
        `Projet créé : ${volumePath} (Manuscrit, Recherche, Snapshots, Journal, Sortie).`
      );
      this.close();
    };

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: "Créer et activer" })
      .addEventListener("click", create);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") create();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class ProjectManagerModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    this.render();
  }
  onClose() {
    this.contentEl.empty();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    contentEl.createEl("h3", { text: "Gestion des projets" });

    const S = this.plugin.settings;
    const all = [S.projectFolder, ...(S.projects || [])].filter(
      (p, i, a) => p && a.indexOf(p) === i
    );

    for (const path of all) {
      const meta = S.projectMeta[path] || {};
      const card = contentEl.createDiv({ cls: "feuillets-project-card" });
      const head = card.createDiv({ cls: "feuillets-project-head" });
      const name = head.createSpan({ cls: "feuillets-project-name" });
      name.setText(this.plugin.projectDisplayName(path));
      if (path === S.projectFolder) {
        head.createSpan({ cls: "feuillets-tag-chip" }).setText("actif");
      } else {
        const activate = head.createEl("button", { text: "Activer" });
        activate.addEventListener("click", async () => {
          S.projectFolder = path;
          await this.plugin.saveSettings();
          this.plugin.renderAllViews(true);
          this.plugin.updateStatusBar();
          this.render();
        });
      }
      const removeBtn = head.createEl("button", { text: "Retirer" });
      removeBtn.setAttr(
        "title",
        "Retire ce projet de la liste (ne supprime aucun fichier)"
      );
      removeBtn.addEventListener("click", async () => {
        if (path === S.projectFolder) {
          new Notice("Impossible de retirer le projet actif.");
          return;
        }
        S.projects = (S.projects || []).filter((p) => p !== path);
        delete S.projectMeta[path];
        await this.plugin.saveSettings();
        this.render();
      });

      const grid = card.createDiv({ cls: "feuillets-project-grid" });

      const mkField = (label, key, placeholder) => {
        grid.createDiv({ cls: "feuillets-notes-label" }).setText(label);
        const input = grid.createEl("input", {
          type: "text",
          attr: { placeholder },
        });
        input.value = meta[key] || "";
        input.addEventListener("blur", async () => {
          if (!S.projectMeta[path]) S.projectMeta[path] = {};
          S.projectMeta[path][key] = input.value.trim();
          await this.plugin.saveSettings();
        });
      };
      mkField("Auteur", "author", "Nom de l'auteur");

      grid.createDiv({ cls: "feuillets-notes-label" }).setText("Type");
      const typeSelect = grid.createEl("select");
      for (const [key, mode] of Object.entries(PROJECT_MODES)) {
        typeSelect.createEl("option", { text: mode.label, value: key });
      }
      typeSelect.value = resolveType(meta.type);
      typeSelect.addEventListener("change", async () => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].type = typeSelect.value;
        await this.plugin.saveSettings();
      });

      grid.createDiv({ cls: "feuillets-notes-label" }).setText("Description");
      const desc = grid.createEl("textarea", { attr: { rows: "2" } });
      desc.style.gridColumn = "1 / -1";
      desc.value = meta.description || "";
      desc.addEventListener("blur", async () => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].description = desc.value.trim();
        await this.plugin.saveSettings();
      });
    }

    const addRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    addRow
      .createEl("button", { text: "Créer un nouveau projet…" })
      .addEventListener("click", () => {
        this.close();
        new NewProjectModal(this.app, this.plugin).open();
      });
    const addInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "Chemin du dossier (ex. Romans/AKSAK/Manuscrit)" },
    });
    addInput.style.width = "100%";
    addRow.createEl("button", { text: "Ajouter un projet" }).addEventListener(
      "click",
      async () => {
        const p = normalizePath(addInput.value.trim());
        if (!p) return;
        const folder = this.app.vault.getAbstractFileByPath(p);
        if (!(folder instanceof TFolder)) {
          new Notice("Dossier introuvable dans le coffre.");
          return;
        }
        if (!S.projects.includes(p) && p !== S.projectFolder) {
          S.projects.push(p);
          await this.plugin.saveSettings();
        }
        addInput.value = "";
        this.render();
      }
    );
  }
}
