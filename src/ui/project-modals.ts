import { App, Menu, Modal, Notice, normalizePath, setIcon, TFile, TFolder } from "obsidian";
import { PROJECT_MODES, applyModeDefaults, resolveType } from "../utils/project-modes.js";
import { ConfirmModal } from "./basic-modals.js";
import { ScrivenerImportModal } from "./scrivener-import-modal.js";
import { t } from "../i18n/index.js";

type ProjectModalsPlugin = {
  settings: FeuilletsSettings;
  ensureFolder(path: string): Promise<TFolder>;
  saveSettings(): Promise<void>;
  initProjectStructure(): Promise<void>;
  getOutputFolder(): Promise<TFolder | null>;
  renderAllViews(force?: boolean): void;
  updateStatusBar(): void;
  getProjectFolder(): TFolder | null;
  createDemoProject(kind: string): Promise<void>;
  projectDisplayName(path: string): string;
  duplicateProject(path: string, label: string): Promise<string | null>;
  writeOrder(parent: TFolder, orderedChildren: (TFile | TFolder)[]): Promise<void>;
};

/** Étiquette de version pour dupliquer un manuscrit (ex. "v1", "premier
 * jet") — le dossier dupliqué est nommé "<manuscrit> (<étiquette>)". */
export class DuplicateVersionModal extends Modal {
  projectName: string;
  onSubmit: (label: string) => void;

  constructor(app: App, projectName: string, onSubmit: (label: string) => void) {
    super(app);
    this.projectName = projectName;
    this.onSubmit = onSubmit;
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.duplicateVersion.title", { name: this.projectName }) });
    contentEl.createEl("p", {
      text: t("modal.duplicateVersion.desc"),
      cls: "setting-item-description",
    });
    const input = contentEl.createEl("input", { type: "text", placeholder: t("modal.duplicateVersion.placeholder") });
    input.addClass("feuillets-input-full");
    input.focus();
    const submit = () => {
      const label = input.value.trim();
      if (!label) return;
      this.close();
      this.onSubmit(label);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { text: t("modal.duplicateVersion.btn") }).addEventListener("click", submit);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

export class NewProjectModal extends Modal {
  plugin: ProjectModalsPlugin;

  constructor(app: App, plugin: ProjectModalsPlugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("feuillets-project-modal");
    contentEl.createEl("h3", { text: t("modal.newProject.title") });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("modal.newProject.desc")
    );

    contentEl.createEl("label", { text: t("modal.newProject.parentFolderLabel") });
    const parentInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.newProject.parentFolderPlaceholder") },
    });
    parentInput.addClass("feuillets-input-full");
    parentInput.addClass("feuillets-field-spacer");

    contentEl.createEl("label", { text: t("modal.newProject.nameLabel") });
    const nameInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: "Roman1" },
    });
    nameInput.addClass("feuillets-input-full");
    nameInput.addClass("feuillets-field-spacer");

    contentEl.createEl("label", { text: t("modal.newProject.typeLabel") });
    const typeSelect = contentEl.createEl("select");
    typeSelect.addClass("feuillets-input-full");
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }

    const create = async () => {
      const name = nameInput.value.trim();
      if (!name) {
        new Notice(t("modal.newProject.giveAName"));
        return;
      }
      const parent = parentInput.value.trim().replace(/\/+$/, "");
      const volumePath = normalizePath(parent ? `${parent}/${name}` : name);
      if (this.app.vault.getAbstractFileByPath(volumePath)) {
        new Notice(t("modal.newProject.alreadyExists", { path: volumePath }));
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
        t("modal.newProject.created", { path: volumePath })
      );
      this.close();
    };

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.newProject.createAndActivate") })
      .addEventListener("click", create);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") create();
    });
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** Gestion des projets (créer/importer/basculer/retirer/métadonnées) — vivait
 * auparavant dans une section dédiée du panneau Projet & export ; ouverte
 * maintenant en fenêtre flottante depuis le binder ("Gérer les projets…",
 * menu de la racine en double volet) puisqu'on peut déjà basculer de projet
 * directement là. Reprend telle quelle l'ancienne logique de project-view.js. */
export class ManageProjectsModal extends Modal {
  plugin: ProjectModalsPlugin;
  expandedProjects: Set<string>;

  constructor(app: App, plugin: ProjectModalsPlugin) {
    super(app);
    this.plugin = plugin;
    this.expandedProjects = new Set();
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  iconBtn(parent: HTMLElement, icon: string, tooltip: string, onClick?: (e: MouseEvent) => void): HTMLButtonElement {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    btn.setAttr("aria-label", tooltip);
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    const S = this.plugin.settings;

    const header = contentEl.createDiv({ cls: "feuillets-modal-header-row" });
    header.createEl("h3", { text: t("modal.manageProjects.title") });
    const actions = header.createDiv({ cls: "feuillets-project-actions" });
    this.iconBtn(actions, "folder-plus", t("main.cmd.createProject"), () =>
      new NewProjectModal(this.app, this.plugin).open()
    );
    this.iconBtn(actions, "import", t("main.cmd.importScrivener"), () =>
      new ScrivenerImportModal(this.app, this.plugin).open()
    );
    this.iconBtn(actions, "sparkles", t("modal.manageProjects.createDemoTooltip"), (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle(t("settings.demoProject.elira")).onClick(async () => {
          await this.plugin.createDemoProject("elira");
          this.render();
        })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("settings.demoProject.candide"))
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
        (p, i, a): p is string => !!p && a.indexOf(p) === i
      );
      const list = contentEl.createDiv({ cls: "feuillets-project-list" });
      for (const p of allProjects) this.renderProjectRow(list, p, S);
    } else {
      contentEl
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("modal.manageProjects.noneActive"));
    }

    const addRow = contentEl.createDiv({ cls: "feuillets-properties-add-row" });
    const input = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.manageProjects.addExistingPlaceholder") },
    });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      const p = normalizePath(input.value.trim());
      if (!p) return;
      const folder = this.app.vault.getAbstractFileByPath(p);
      if (!(folder instanceof TFolder)) {
        new Notice(t("modal.manageProjects.folderNotFound"));
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

  renderProjectRow(list: HTMLElement, path: string, S: FeuilletsSettings): void {
    const folderObj = this.app.vault.getAbstractFileByPath(path);
    const folderExists = folderObj instanceof TFolder;
    const isActive = folderExists && path === S.projectFolder;
    const isExpanded = this.expandedProjects.has(path);

    const activate = async () => {
      if (!folderExists) {
        new Notice(t("modal.manageProjects.folderGone", { path }));
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
    setIcon(icon, !folderExists ? "alert-triangle" : (meta.icon as string) || (isActive ? "folder-open" : "folder"));
    const name = row.createSpan({ cls: "feuillets-project-name" });
    name.setText(
      folderExists
        ? this.plugin.projectDisplayName(path)
        : t("settings.activeProject.notFound", { name: this.plugin.projectDisplayName(path) })
    );
    if (!folderExists) {
      name.addClass("feuillets-muted-italic");
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

    if (folderExists) {
      const dupBtn = actions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(dupBtn, "copy-plus");
      dupBtn.setAttr("aria-label", t("modal.manageProjects.duplicateTooltip"));
      dupBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        new DuplicateVersionModal(this.app, this.plugin.projectDisplayName(path), async (label) => {
          await this.plugin.duplicateProject(path, label);
          this.render();
        }).open();
      });
    }

    if (!isActive) {
      const removeBtn = actions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(removeBtn, "trash-2");
      removeBtn.setAttr("aria-label", t("modal.manageProjects.removeTooltip"));
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        new ConfirmModal(
          this.app,
          t("modal.manageProjects.removeConfirmTitle", { name: this.plugin.projectDisplayName(path) }),
          t("modal.manageProjects.removeConfirmBody"),
          t("modal.manageProjects.removeBtn"),
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
    const mkField = (label: string, key: string, placeholder: string) => {
      detail.createDiv({ cls: "feuillets-notes-label" }).setText(label);
      const fieldInput = detail.createEl("input", { type: "text", attr: { placeholder } });
      fieldInput.value = (meta[key] as string) || "";
      fieldInput.addEventListener("blur", async () => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path][key] = fieldInput.value.trim();
        await this.plugin.saveSettings();
      });
    };
    detail.createDiv({ cls: "feuillets-notes-label" }).setText(t("modal.manageProjects.nameField"));
    const nameInput = detail.createEl("input", {
      type: "text",
      attr: { placeholder: this.plugin.projectDisplayName(path) },
    });
    nameInput.value = (meta.name as string) || "";
    nameInput.addEventListener("blur", async () => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      S.projectMeta[path].name = nameInput.value.trim();
      await this.plugin.saveSettings();
      this.plugin.renderAllViews(true);
      this.render();
    });

    mkField(t("modal.manageProjects.authorField"), "author", t("modal.manageProjects.authorPlaceholder"));

    detail.createDiv({ cls: "feuillets-notes-label" }).setText(t("modal.manageProjects.iconField"));
    const iconWrap = detail.createDiv({ cls: "feuillets-project-icon-row" });
    const iconPreview = iconWrap.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(iconPreview, (meta.icon as string) || "folder");
    const iconInput = iconWrap.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.manageProjects.iconPlaceholder") },
    });
    iconInput.value = (meta.icon as string) || "";
    iconInput.addEventListener("blur", async () => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      S.projectMeta[path].icon = iconInput.value.trim();
      await this.plugin.saveSettings();
      setIcon(iconPreview, iconInput.value.trim() || "folder");
      this.plugin.renderAllViews(true);
    });

    detail.createDiv({ cls: "feuillets-notes-label" }).setText(t("modal.manageProjects.typeField"));
    const typeSelect = detail.createEl("select");
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }
    typeSelect.value = resolveType(meta.type as string);
    typeSelect.addEventListener("change", async () => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      S.projectMeta[path].type = typeSelect.value;
      await this.plugin.saveSettings();
    });

    detail.createDiv({ cls: "feuillets-notes-label" }).setText(t("modal.manageProjects.descriptionField"));
    const desc = detail.createEl("textarea", { attr: { rows: "2" } });
    desc.addClass("feuillets-grid-full-row");
    desc.value = (meta.description as string) || "";
    desc.addEventListener("blur", async () => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      S.projectMeta[path].description = desc.value.trim();
      await this.plugin.saveSettings();
    });
  }
}
