const { Modal, Notice, normalizePath, setIcon, TFolder, Menu } = require("obsidian");
import { PROJECT_MODES, applyModeDefaults, resolveType } from "../utils/project-modes.js";
import { ConfirmModal } from "./basic-modals.js";
import { ScrivenerImportModal } from "./scrivener-import-modal.js";

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

/** Gestion des projets (créer/importer/basculer/retirer/métadonnées) — vivait
 * auparavant dans une section dédiée du panneau Projet & export ; ouverte
 * maintenant en fenêtre flottante depuis le binder ("Gérer les projets…",
 * menu de la racine en double volet) puisqu'on peut déjà basculer de projet
 * directement là. Reprend telle quelle l'ancienne logique de project-view.js. */
export class ManageProjectsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.expandedProjects = new Set();
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  iconBtn(parent, icon, tooltip, onClick) {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    btn.setAttr("aria-label", tooltip);
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    const S = this.plugin.settings;

    const header = contentEl.createDiv({ cls: "feuillets-modal-header-row" });
    header.createEl("h3", { text: "Gérer les projets" });
    const actions = header.createDiv({ cls: "feuillets-project-actions" });
    this.iconBtn(actions, "folder-plus", "Créer un nouveau projet…", () =>
      new NewProjectModal(this.app, this.plugin).open()
    );
    this.iconBtn(actions, "import", "Importer un projet Scrivener…", () =>
      new ScrivenerImportModal(this.app, this.plugin).open()
    );
    this.iconBtn(actions, "sparkles", "Créer un projet d'exemple…", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Roman générique (Elira) — explique chaque champ").onClick(async () => {
          await this.plugin.createDemoProject("elira");
          this.render();
        })
      );
      menu.addItem((item) =>
        item
          .setTitle("Candide, ou l'Optimisme (Voltaire) — labels, fils & personnages")
          .onClick(async () => {
            await this.plugin.createDemoProject("candide");
            this.render();
          })
      );
      menu.showAtMouseEvent(e);
    });

    const root = this.plugin.getProjectFolder();
    if (root) {
      const allProjects = [S.projectFolder, ...(S.projects || [])].filter(
        (p, i, a) => p && a.indexOf(p) === i
      );
      const list = contentEl.createDiv({ cls: "feuillets-project-list" });
      for (const p of allProjects) this.renderProjectRow(list, p, S);
    } else {
      contentEl
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucun projet actif — crée-en un, importe un projet Scrivener, ou ajoute un dossier existant ci-dessous.");
    }

    const addRow = contentEl.createDiv({ cls: "feuillets-properties-add-row" });
    const input = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: "Ajouter un projet existant (chemin du dossier)…" },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const p = normalizePath(input.value.trim());
      if (!p) return;
      const folder = this.app.vault.getAbstractFileByPath(p);
      if (!(folder instanceof TFolder)) {
        new Notice("Dossier introuvable dans le coffre.");
        return;
      }
      if (!S.projectFolder) {
        S.projectFolder = p;
      } else if (!S.projects.includes(p) && p !== S.projectFolder) {
        S.projects.push(p);
      }
      await this.plugin.saveSettings();
      input.value = "";
      this.plugin.renderAllViews(true);
      this.plugin.updateStatusBar();
      this.render();
    });
  }

  renderProjectRow(list, path, S) {
    const folderObj = this.app.vault.getAbstractFileByPath(path);
    const folderExists = folderObj instanceof TFolder;
    const isActive = folderExists && path === S.projectFolder;
    const isExpanded = this.expandedProjects.has(path);

    const activate = async () => {
      if (!folderExists) {
        new Notice(`Le dossier « ${path} » n'existe plus dans le coffre (supprimé ou déplacé).`);
        return;
      }
      if (isActive) return;
      if (S.projectFolder && !S.projects.includes(S.projectFolder)) {
        S.projects.push(S.projectFolder);
      }
      S.projectFolder = path;
      await this.plugin.saveSettings();
      this.plugin.renderAllViews(true);
      this.plugin.updateStatusBar();
      this.render();
    };

    const row = list.createDiv({ cls: `feuillets-project-item ${isActive ? "is-active" : ""}` });
    const icon = row.createSpan({ cls: "feuillets-cell-icon" });
    const meta = S.projectMeta[path] || {};
    setIcon(icon, !folderExists ? "alert-triangle" : meta.icon || (isActive ? "folder-open" : "folder"));
    const name = row.createSpan({ cls: "feuillets-project-name" });
    name.setText(
      folderExists
        ? this.plugin.projectDisplayName(path)
        : `${this.plugin.projectDisplayName(path)} (introuvable)`
    );
    if (!folderExists) {
      name.style.opacity = "0.6";
      name.style.fontStyle = "italic";
    }
    row.addEventListener("click", activate);

    const actions = row.createDiv({ cls: "feuillets-project-actions" });
    const toggleBtn = actions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
    setIcon(toggleBtn, isExpanded ? "chevron-down" : "chevron-right");
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isExpanded) this.expandedProjects.delete(path);
      else this.expandedProjects.add(path);
      this.render();
    });

    if (!isActive) {
      const removeBtn = actions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(removeBtn, "trash-2");
      removeBtn.setAttr("aria-label", "Retirer ce projet…");
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        new ConfirmModal(
          this.app,
          `Retirer « ${this.plugin.projectDisplayName(path)} » ?`,
          "Le projet disparaît de cette liste — le dossier reste intact sur le disque.",
          "Retirer",
          async () => {
            S.projects = (S.projects || []).filter((p) => p !== path);
            delete S.projectMeta[path];
            await this.plugin.saveSettings();
            this.expandedProjects.delete(path);
            this.render();
          }
        ).open();
      });
    }

    if (!isExpanded) return;

    const detail = list.createDiv({ cls: "feuillets-project-detail feuillets-project-grid" });
    const mkField = (label, key, placeholder) => {
      detail.createDiv({ cls: "feuillets-notes-label" }).setText(label);
      const fieldInput = detail.createEl("input", { type: "text", attr: { placeholder } });
      fieldInput.value = meta[key] || "";
      fieldInput.addEventListener("blur", async () => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path][key] = fieldInput.value.trim();
        await this.plugin.saveSettings();
      });
    };
    detail.createDiv({ cls: "feuillets-notes-label" }).setText("Nom");
    const nameInput = detail.createEl("input", {
      type: "text",
      attr: { placeholder: this.plugin.projectDisplayName(path) },
    });
    nameInput.value = meta.name || "";
    nameInput.addEventListener("blur", async () => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      S.projectMeta[path].name = nameInput.value.trim();
      await this.plugin.saveSettings();
      this.plugin.renderAllViews(true);
      this.render();
    });

    mkField("Auteur", "author", "Nom de l'auteur");

    detail.createDiv({ cls: "feuillets-notes-label" }).setText("Icône");
    const iconWrap = detail.createDiv({ cls: "feuillets-project-icon-row" });
    const iconPreview = iconWrap.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconPreview, meta.icon || "folder");
    const iconInput = iconWrap.createEl("input", {
      type: "text",
      attr: { placeholder: "ex. book, feather, compass…" },
    });
    iconInput.value = meta.icon || "";
    iconInput.addEventListener("blur", async () => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      S.projectMeta[path].icon = iconInput.value.trim();
      await this.plugin.saveSettings();
      setIcon(iconPreview, iconInput.value.trim() || "folder");
      this.plugin.renderAllViews(true);
    });

    detail.createDiv({ cls: "feuillets-notes-label" }).setText("Type");
    const typeSelect = detail.createEl("select");
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }
    typeSelect.value = resolveType(meta.type);
    typeSelect.addEventListener("change", async () => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      S.projectMeta[path].type = typeSelect.value;
      await this.plugin.saveSettings();
    });

    detail.createDiv({ cls: "feuillets-notes-label" }).setText("Description");
    const desc = detail.createEl("textarea", { attr: { rows: "2" } });
    desc.style.gridColumn = "1 / -1";
    desc.value = meta.description || "";
    desc.addEventListener("blur", async () => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      S.projectMeta[path].description = desc.value.trim();
      await this.plugin.saveSettings();
    });
  }
}
