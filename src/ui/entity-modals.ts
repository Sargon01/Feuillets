import { Modal, TFile, TFolder, setIcon } from "obsidian";
import type { App } from "obsidian";
import { openFileActivating } from "../utils/dom.js";
import { t } from "../i18n/index.js";

type Appearance = {
  file: TFile;
  excerpt?: string;
};

type AppearancesPlugin = {
  titleFor(file: TFile): string;
  getProjectFolder(): TFolder | null;
  buildNumbering(root: TFolder): Map<string, string>;
  findAppearances(file: TFile): Promise<Appearance[]>;
  getChapters(root: TFolder): Array<TFile | TFolder>;
  shortTitleFor(file: TFile): string;
};

type TagsPlugin = {
  settings: { favoriteTags?: string[] };
  titleFor(file: TFile): string;
  tagsOf(file: TFile): string[];
};

type FolderGoalPlugin = {
  settings: { folderGoals: Record<string, number> };
  saveSettings(): Promise<void>;
  renderAllViews(force: boolean): void;
};

type NameSubmitHandler = (name: string) => void | Promise<void>;

type SavedResearchFilter = {
  name: string;
  search?: string;
  tag?: string;
};

type SavedFiltersPlugin = {
  settings: {
    projectMeta: Record<string, { savedResearchFilters?: SavedResearchFilter[] }>;
  };
  saveSettings(): Promise<void>;
};

type ChangeHandler = () => void | Promise<void>;

export class AppearancesModal extends Modal {
  plugin: AppearancesPlugin;
  entityFile: TFile;

  constructor(app: App, plugin: AppearancesPlugin, entityFile: TFile) {
    super(app);
    this.plugin = plugin;
    this.entityFile = entityFile;
  }
  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("feuillets-appearances-modal");
    contentEl.createEl("h3", {
      text: t("modal.appearances.title", { name: this.plugin.titleFor(this.entityFile) }),
    });
    const loading = contentEl.createDiv({ cls: "feuillets-empty" });
    loading.setText(t("modal.appearances.searching"));

    const root = this.plugin.getProjectFolder();
    const numbering = root ? this.plugin.buildNumbering(root) : new Map<string, string>();
    const results = await this.plugin.findAppearances(this.entityFile);
    loading.remove();

    if (results.length === 0) {
      contentEl
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("modal.appearances.none"));
      return;
    }

    contentEl
      .createDiv({ cls: "feuillets-notes-sub" })
      .setText(
        t("modal.appearances.count", { count: String(results.length), s: results.length > 1 ? "s" : "" })
      );

    if (root) {
      const chapters = this.plugin.getChapters(root);
      const totalChapters = chapters.length;

      if (totalChapters > 0) {
        const chaptersWithAppearance = new Set<number>();
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
          .setText(t("modal.appearances.presenceOnChapters", { count: String(totalChapters) }));
        const density = contentEl.createDiv({ cls: "feuillets-density-strip" });
        for (let c = 1; c <= totalChapters; c++) {
          const tick = density.createDiv({ cls: "feuillets-density-tick" });
          if (chaptersWithAppearance.has(c)) tick.addClass("feuillets-density-hit");
          tick.setAttr("title", t("modal.appearances.chapterN", { n: String(c) }));
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
  plugin: TagsPlugin;
  file: TFile;

  constructor(app: App, plugin: TagsPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.tags.title", { name: this.plugin.titleFor(this.file) }),
    });
    const current = this.plugin.tagsOf(this.file);
    const input = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "tag1, tag2, tag3" },
    });
    input.addClass("feuillets-input-full");
    input.value = current.join(", ");

    const favs = this.plugin.settings.favoriteTags || [];
    if (favs.length > 0) {
      const favRow = contentEl.createDiv({ cls: "feuillets-tags" });
      favRow.addClass("feuillets-mt-sm");
      for (const f of favs) {
        const chip = favRow.createSpan({ cls: "feuillets-tag-chip" });
        chip.setText(`#${f}`);
        chip.setAttr("title", t("modal.tags.toggleTooltip"));
        chip.addEventListener("click", () => {
          const tags = input.value
            .split(/[,\s]+/)
            .map((tg) => tg.replace(/^#/, "").trim())
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
            .map((tg) => tg.replace(/^#/, "").trim())
            .filter(Boolean)
        ),
      ];
      await this.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
        if (tags.length) fm.tags = tags;
        else delete fm.tags;
      });
      this.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void save();
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.save") })
      .addEventListener("click", () => { void save(); });
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class FolderGoalModal extends Modal {
  plugin: FolderGoalPlugin;
  folder: TFolder;

  constructor(app: App, plugin: FolderGoalPlugin, folder: TFolder) {
    super(app);
    this.plugin = plugin;
    this.folder = folder;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.folderGoal.title", { name: this.folder.name }),
    });

    const current = this.plugin.settings.folderGoals[this.folder.path] || "";

    const input = contentEl.createEl("input", {
      type: "number",
      attr: { placeholder: t("modal.folderGoal.placeholder") },
    });
    input.addClass("feuillets-input-full");
    input.value = String(current);
    input.focus();

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const cancel = btnRow.createEl("button", { text: t("modal.cancel") });
    cancel.addEventListener("click", () => this.close());

    const save = btnRow.createEl("button", { text: t("modal.save"), cls: "mod-cta" });
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
    save.addEventListener("click", () => { void doSave(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void doSave();
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
  onSubmit: NameSubmitHandler;

  constructor(app: App, onSubmit: NameSubmitHandler) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.saveFilter.title") });
    const input = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.saveFilter.placeholder") },
    });
    input.addClass("feuillets-input-full");
    input.focus();
    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      this.close();
      void this.onSubmit(name);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.save"), cls: "mod-cta" })
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
  plugin: SavedFiltersPlugin;
  root: TFolder;
  onChange?: ChangeHandler;

  constructor(app: App, plugin: SavedFiltersPlugin, root: TFolder, onChange?: ChangeHandler) {
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
    contentEl.createEl("h3", { text: t("modal.manageSavedFilters.title") });
    const S = this.plugin.settings;
    const meta = S.projectMeta[this.root.path] || {};
    const filters = meta.savedResearchFilters || [];
    if (filters.length === 0) {
      contentEl.createDiv({ cls: "feuillets-empty" }).setText(t("modal.manageSavedFilters.empty"));
    }
    const list = contentEl.createDiv({ cls: "feuillets-project-list" });
    filters.forEach((f, i) => {
      const row = list.createDiv({ cls: "feuillets-project-item" });
      const desc = [f.search ? `"${f.search}"` : null, f.tag ? `#${f.tag}` : null]
        .filter(Boolean)
        .join(" · ") || t("modal.manageSavedFilters.noCriteria");
      row.createSpan({ cls: "feuillets-project-name", text: `${f.name} — ${desc}` });
      const del = row.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(del, "trash-2");
      del.setAttr("aria-label", t("modal.manageSavedFilters.deleteAria"));
      del.addEventListener("click", () => {
        void (async () => {
          filters.splice(i, 1);
          await this.plugin.saveSettings();
          this.render();
          if (this.onChange) void this.onChange();
        })();
      });
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: t("modal.close") }).addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
}
