const { Modal, TFolder, setIcon } = require("obsidian");
import { openFileActivating } from "../utils/dom.js";

export class AppearancesModal extends Modal {
  constructor(app, plugin, entityFile) {
    super(app);
    this.plugin = plugin;
    this.entityFile = entityFile;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("feuillets-appearances-modal");
    contentEl.createEl("h3", {
      text: `Apparitions de « ${this.plugin.titleFor(this.entityFile)} »`,
    });
    const loading = contentEl.createDiv({ cls: "feuillets-empty" });
    loading.setText("Recherche dans le manuscrit…");

    const root = this.plugin.getProjectFolder();
    const numbering = root ? this.plugin.buildNumbering(root) : new Map();
    const results = await this.plugin.findAppearances(this.entityFile);
    loading.remove();

    if (results.length === 0) {
      contentEl
        .createDiv({ cls: "feuillets-empty" })
        .setText("Aucune scène ne cite cette fiche pour l'instant.");
      return;
    }

    contentEl
      .createDiv({ cls: "feuillets-notes-sub" })
      .setText(
        `${results.length} scène${results.length > 1 ? "s" : ""}, dans l'ordre du manuscrit`
      );

    if (root) {
      const chapters = this.plugin.getChapters(root);
      const totalChapters = chapters.length;

      if (totalChapters > 0) {
        const chaptersWithAppearance = new Set();
        for (const r of results) {
          const idx = chapters.findIndex((c) =>
            c instanceof TFolder
              ? r.file.path.startsWith(c.path + "/")
              : r.file.path === c.path
          );
          if (idx !== -1) chaptersWithAppearance.add(idx + 1);
        }
        contentEl
          .createDiv({ cls: "feuillets-notes-label" })
          .setText(`Présence sur ${totalChapters} chapitres`);
        const density = contentEl.createDiv({ cls: "feuillets-density-strip" });
        for (let c = 1; c <= totalChapters; c++) {
          const tick = density.createDiv({ cls: "feuillets-density-tick" });
          if (chaptersWithAppearance.has(c)) tick.addClass("feuillets-density-hit");
          tick.setAttr("title", `Chapitre ${c}`);
        }
      }
    }

    const list = contentEl.createDiv({ cls: "feuillets-appearances-list" });
    for (const r of results) {
      const row = list.createDiv({ cls: "feuillets-appearances-row" });
      const head = row.createDiv({ cls: "feuillets-appearances-head" });
      head.createSpan({ cls: "feuillets-row-num" }).setText(
        numbering.get(r.file.path) || ""
      );
      head
        .createSpan({ cls: "feuillets-appearances-title" })
        .setText(this.plugin.shortTitleFor(r.file));
      if (r.excerpt) {
        row.createDiv({ cls: "feuillets-appearances-excerpt" }).setText(r.excerpt);
      }
      row.addEventListener("click", () => {
        openFileActivating(this.app, this.app.workspace.getLeaf(false), r.file);
        this.close();
      });
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class TagsModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: `Tags — ${this.plugin.titleFor(this.file)}`,
    });
    const current = this.plugin.tagsOf(this.file);
    const input = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "tag1, tag2, tag3" },
    });
    input.style.width = "100%";
    input.value = current.join(", ");

    const favs = this.plugin.settings.favoriteTags || [];
    if (favs.length > 0) {
      const favRow = contentEl.createDiv({ cls: "feuillets-tags" });
      favRow.style.marginTop = "8px";
      for (const f of favs) {
        const chip = favRow.createSpan({ cls: "feuillets-tag-chip" });
        chip.setText(`#${f}`);
        chip.setAttr("title", "Cliquer pour ajouter/retirer");
        chip.addEventListener("click", () => {
          const tags = input.value
            .split(/[,\s]+/)
            .map((t) => t.replace(/^#/, "").trim())
            .filter(Boolean);
          const idx = tags.indexOf(f);
          if (idx >= 0) tags.splice(idx, 1);
          else tags.push(f);
          input.value = tags.join(", ");
        });
      }
    }

    const save = async () => {
      const tags = [
        ...new Set(
          input.value
            .split(/[,\s]+/)
            .map((t) => t.replace(/^#/, "").trim())
            .filter(Boolean)
        ),
      ];
      await this.app.fileManager.processFrontMatter(this.file, (fm) => {
        if (tags.length) fm.tags = tags;
        else delete fm.tags;
      });
      this.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: "Enregistrer" })
      .addEventListener("click", save);
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class FolderGoalModal extends Modal {
  constructor(app, plugin, folder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: `Objectif de mots — ${this.folder.name}`,
    });
    
    const current = this.plugin.settings.folderGoals[this.folder.path] || "";
    
    const input = contentEl.createEl("input", {
      type: "number",
      attr: { placeholder: "Objectif (ex. 5000)" },
    });
    input.style.width = "100%";
    input.value = String(current);
    input.focus();

    const btnRow = contentEl.createDiv({ style: "margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px;" });
    const cancel = btnRow.createEl("button", { text: "Annuler" });
    cancel.addEventListener("click", () => this.close());
    
    const save = btnRow.createEl("button", { text: "Enregistrer", cls: "mod-cta" });
    const doSave = async () => {
      const val = parseInt(input.value, 10);
      if (isNaN(val) || val <= 0) {
        delete this.plugin.settings.folderGoals[this.folder.path];
      } else {
        this.plugin.settings.folderGoals[this.folder.path] = val;
      }
      await this.plugin.saveSettings();
      this.plugin.renderAllViews(true);
      this.close();
    };
    save.addEventListener("click", doSave);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSave();
    });
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Nomme le filtre actif du panneau Recherche (texte + tag) avant de
 * l'enregistrer comme "dossier virtuel" réutilisable — voir
 * base-feuillets-view.js renderSavedFiltersButton. */
export class SaveResearchFilterModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Enregistrer ce filtre" });
    const input = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "Nom du dossier sauvegardé" },
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
      .createEl("button", { text: "Enregistrer", cls: "mod-cta" })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Liste/supprime les filtres de Recherche sauvegardés du projet actif
 * (S.projectMeta[root.path].savedResearchFilters). Pas de renommage/édition
 * ici : un filtre mal nommé se recrée en un clic (recherche + tag déjà en
 * place), plus simple qu'un formulaire d'édition pour un usage aussi
 * ponctuel. */
export class ManageSavedFiltersModal extends Modal {
  constructor(app, plugin, root, onChange) {
    super(app);
    this.plugin = plugin;
    this.root = root;
    this.onChange = onChange;
  }
  onOpen() {
    this.render();
  }
  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Dossiers de recherche sauvegardés" });
    const S = this.plugin.settings;
    const meta = S.projectMeta[this.root.path] || {};
    const filters = meta.savedResearchFilters || [];
    if (filters.length === 0) {
      contentEl.createDiv({ cls: "feuillets-empty" }).setText("Aucun filtre sauvegardé pour ce projet.");
    }
    const list = contentEl.createDiv({ cls: "feuillets-project-list" });
    filters.forEach((f, i) => {
      const row = list.createDiv({ cls: "feuillets-project-item" });
      const desc = [f.search ? `"${f.search}"` : null, f.tag ? `#${f.tag}` : null]
        .filter(Boolean)
        .join(" · ") || "(sans critère)";
      row.createSpan({ cls: "feuillets-project-name", text: `${f.name} — ${desc}` });
      const del = row.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(del, "trash-2");
      del.setAttr("aria-label", "Supprimer ce dossier sauvegardé");
      del.addEventListener("click", async () => {
        filters.splice(i, 1);
        await this.plugin.saveSettings();
        this.render();
        if (this.onChange) this.onChange();
      });
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: "Fermer" }).addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
}
