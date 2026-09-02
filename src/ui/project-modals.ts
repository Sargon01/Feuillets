import { App, Modal, Notice, normalizePath, setIcon, Setting, TAbstractFile, TFile, TFolder } from "obsidian";
import { PROJECT_MODES, projectBoardDefaults, resolveType } from "../utils/project-modes.js";
import { ConfirmModal } from "./basic-modals.js";
import { ScrivenerImportModal } from "./scrivener-import-modal.js";
import { FeuilProjectImportModal } from "./feuil-project-import-modal.js";
import type { FeuilProjectImportPlan } from "../services/feuil-project-import-plan.js";
import { FolderSuggest } from "./folder-suggest.js";
import { createMinimalProject, CreateProjectError, ensureCanonicalProjectBase, initResearchSubfolders } from "../services/project-files.js";
import { openFileActivatingWithCursor } from "../utils/dom.js";
import { t } from "../i18n/index.js";
import { ProjectConfigContent, type ProjectConfigPage } from "./project-config-content.js";

type ProjectModalsPlugin = {
  /* manuscriptAuthor : absent de l'interface globale FeuilletsSettings
     (écart préexistant, déjà contourné de la même façon dans
     preview-modal.ts) — champ bien réel dans default-settings.ts, réutilisé
     ici pour pré-remplir l'auteur d'un nouveau projet. */
  settings: FeuilletsSettings & { manuscriptAuthor?: string };
  /* ensureFolder/initProjectStructure : plus utilisés par NewProjectModal
     lui-même (voir createMinimalProject, services/project-files.ts), mais
     requis structurellement par ScrivenerImportPlugin — ManageProjectsModal
     instancie ScrivenerImportModal avec ce même this.plugin. */
  ensureFolder(path: string): Promise<TAbstractFile>;
  initProjectStructure(identity?: { title?: string; author?: string }): Promise<void>;
  saveSettings(): Promise<void>;
  refreshPresentationAppearance?(): Promise<void>;
  renderAllViews(force?: boolean): void;
  updateStatusBar(): void;
  syncProjectEditorScope?(): void;
  getProjectFolder(): TFolder | null;
  createDemoProject(): Promise<void>;
  projectDisplayName(path: string): string;
  duplicateProject(path: string, label: string): Promise<string | null>;
  writeOrder(parent: TFolder, orderedChildren: (TFile | TFolder)[]): Promise<void>;
  switchProject(path: string): Promise<boolean>;
  exportFeuilProject(path: string): Promise<boolean>;
  importFeuilProject(plan: FeuilProjectImportPlan, destinationRootPath: string): Promise<boolean>;
  flattenFiles(folder: TFolder): readonly (TFile | TFolder)[];
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
    contentEl.empty();
    contentEl.addClass("feuillets-new-project-modal");
    contentEl.createEl("h3", { text: t("modal.newProject.title") });
    contentEl.createDiv({ cls: "feuillets-feuil-import-intro", text: t("modal.newProject.desc") });

    const form = contentEl.createDiv({ cls: "feuillets-feuil-import-form" });
    const createField = (label: string): HTMLElement => {
      const field = form.createDiv({ cls: "feuillets-feuil-import-field" });
      field.createEl("label", { text: label });
      return field;
    };

    /* Ordre : nom (seul champ obligatoire) d'abord, puis les deux facultatifs
       — plutôt que l'ancien ordre dossier/nom/type, qui faisait taper le nom
       en second alors que c'est la seule information réellement requise. */
    const nameField = createField(t("modal.newProject.nameLabel"));
    const nameInput = nameField.createEl("input", {
      type: "text",
      attr: { placeholder: "Roman1" },
    });
    nameInput.focus();

    const authorField = createField(t("modal.newProject.authorLabel"));
    const authorInput = authorField.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.newProject.authorPlaceholder") },
    });
    /* Pré-rempli avec le réglage global (Réglages → Auteur, déjà utilisé par
       l'export) : évite de retaper son nom à chaque nouveau projet, sans
       empêcher de le changer pour ce projet précis (stocké alors dans
       projectMeta, indépendant du réglage global — voir createMinimalProject). */
    authorInput.value = this.plugin.settings.manuscriptAuthor || "";

    const parentField = createField(t("modal.newProject.parentFolderLabel"));
    const parentInput = parentField.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.newProject.parentFolderPlaceholder") },
    });
    new FolderSuggest(this.app, parentInput);

    const typeField = createField(t("modal.newProject.typeLabel"));
    const typeSelect = typeField.createEl("select");
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }

    const create = async () => {
      const S = this.plugin.settings;
      let result: Awaited<ReturnType<typeof createMinimalProject>>;
      try {
        result = await createMinimalProject(this.app, S, {
          name: nameInput.value,
          parentFolder: parentInput.value,
          type: typeSelect.value,
          author: authorInput.value,
        });
      } catch (e) {
        if (e instanceof CreateProjectError && e.code === "empty-name") {
          new Notice(t("modal.newProject.giveAName"));
          return;
        }
        if (e instanceof CreateProjectError && e.code === "already-exists") {
          new Notice(t("modal.newProject.alreadyExists", { path: e.path || "" }));
          return;
        }
        throw e;
      }

      await this.plugin.saveSettings();
      this.plugin.renderAllViews(true);
      this.plugin.syncProjectEditorScope?.();
      this.plugin.updateStatusBar();

      this.close();
      const leaf = this.app.workspace.getLeaf(false);
      await openFileActivatingWithCursor(this.app, leaf, result.firstFile);
      new Notice(t("modal.newProject.ready"));
    };

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow.createEl("button", { type: "button", text: t("shared.cancel") })
      .addEventListener("click", () => this.close());
    btnRow
      .createEl("button", { type: "button", text: t("modal.newProject.createAndActivate"), cls: "mod-cta" })
      .addEventListener("click", () => { void create(); });
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void create();
    });
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** Utilise un dossier déjà présent dans le coffre comme projet — sans rien y
 * déplacer, renommer, ni modifier : seule la référence dans les réglages
 * (settings.projectFolder / settings.projects) change. Même comportement que
 * le champ « Utiliser un dossier existant tel quel » du gestionnaire de projets (voir
 * feuillets-view.js, renderProjectManagerSplitView), mais en modale dédiée
 * avec un vrai sélecteur de dossier (FolderSuggest) plutôt qu'un champ texte
 * libre à saisir de mémoire — utile en premier lancement, quand on ne
 * connaît pas encore les raccourcis du binder. */
export class OpenExistingFolderModal extends Modal {
  plugin: ProjectModalsPlugin;

  constructor(app: App, plugin: ProjectModalsPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("feuillets-project-modal");
    contentEl.createEl("h3", { text: t("modal.openFolder.title") });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(t("modal.openFolder.desc"));

    contentEl.createEl("label", { text: t("modal.openFolder.folderLabel") });
    const folderInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.openFolder.placeholder") },
    });
    folderInput.addClass("feuillets-input-full");
    folderInput.addClass("feuillets-field-spacer");
    new FolderSuggest(this.app, folderInput);
    folderInput.focus();

    const open = async () => {
      const path = normalizePath(folderInput.value.trim());
      if (!path) {
        new Notice(t("modal.openFolder.noFolderChosen"));
        return;
      }
      const folder = this.app.vault.getAbstractFileByPath(path);
      if (!(folder instanceof TFolder)) {
        new Notice(t("modal.openFolder.notAFolder"));
        return;
      }

      const S = this.plugin.settings;
      if (S.projectFolder && S.projectFolder !== path && !S.projects.includes(S.projectFolder)) {
        S.projects.push(S.projectFolder);
      }
      S.projectFolder = path;
      if (!S.projects.includes(path)) S.projects.push(path);
      await this.plugin.saveSettings();

      this.plugin.renderAllViews(true);
      this.plugin.updateStatusBar();
      new Notice(t("modal.openFolder.opened", { path }));
      this.close();
    };

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.openFolder.pickBtn"), cls: "mod-cta" })
      .addEventListener("click", () => { void open(); });
    folderInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void open();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Modale d'initialisation d'un dossier existant en projet Feuillets avec
 * sélection du mode (Fiction, Non-fiction, Projet libre). */
export class TransformToProjectModal extends Modal {
  plugin: ProjectModalsPlugin;
  folderPath: string;

  constructor(app: App, plugin: ProjectModalsPlugin, folderPath: string) {
    super(app);
    this.plugin = plugin;
    this.folderPath = folderPath;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("feuillets-project-modal");
    const titleRow = contentEl.createDiv({ cls: "feuillets-modal-title-row" });
    setIcon(titleRow.createDiv({ cls: "feuillets-cell-icon" }), "folder-cog");
    titleRow.createEl("h3", { text: t("modal.transformProject.title") });
    contentEl.createDiv({ cls: "feuillets-notes-sub" }).setText(
      t("modal.transformProject.desc")
    );

    contentEl.createEl("label", { text: t("modal.newProject.typeLabel") });
    const typeSelect = contentEl.createEl("select");
    typeSelect.addClass("feuillets-input-full");
    typeSelect.addClass("feuillets-field-spacer");
    typeSelect.createEl("option", { text: t("modal.transformProject.typePlaceholder"), value: "" });
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }

    const transform = async () => {
      const S = this.plugin.settings;
      const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
      if (!(folder instanceof TFolder)) {
        new Notice(t("modal.openFolder.notAFolder"));
        return;
      }

      // Enregistrer le mode dans projectMeta
      const chosenMode = typeSelect.value;
      if (!Object.prototype.hasOwnProperty.call(PROJECT_MODES, chosenMode)) {
        new Notice(t("modal.transformProject.typeRequired"));
        return;
      }
      if (!S.projectMeta[this.folderPath]) S.projectMeta[this.folderPath] = {};
      S.projectMeta[this.folderPath].type = chosenMode;
      const boardDefaults = projectBoardDefaults(chosenMode);
      S.projectMeta[this.folderPath].hiddenBoardModes = boardDefaults.hiddenBoardModes;
      S.projectMeta[this.folderPath].outlineCols = boardDefaults.outlineCols;

      // Ajouter le dossier à la liste des projets
      if (!S.projects) S.projects = [];
      if (!S.projects.includes(this.folderPath)) {
        S.projects.push(this.folderPath);
      }
      S.projectFolder = this.folderPath;
      await this.plugin.saveSettings();

      const { researchPath } = await ensureCanonicalProjectBase(this.app, folder);
      await initResearchSubfolders(this.app, researchPath, chosenMode);

      this.plugin.renderAllViews(true);
      this.plugin.updateStatusBar();
      new Notice(t("modal.transformProject.ready", { name: folder.name }));
      this.close();
    };

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.transformProject.transform"), cls: "mod-cta" })
      .addEventListener("click", () => { void transform(); });
    typeSelect.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void transform();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

type ManageProjectDetailPage = {
  projectPath: string;
  page: ManageProjectDetailPageKind;
};

type ManageProjectDetailPageKind = ProjectConfigPage | "citations";

/** Gestion des projets (créer/importer/basculer/retirer/métadonnées) — vivait
 * auparavant dans une section dédiée du panneau Projet & export ; ouverte
 * maintenant en fenêtre flottante depuis le binder ("Gérer les projets…",
 * menu de la racine en double volet) puisqu'on peut déjà basculer de projet
 * directement là. Reprend telle quelle l'ancienne logique de project-view.js. */
export class ManageProjectsModal extends Modal {
  plugin: ProjectModalsPlugin;
  expandedProjects: Set<string>;
  detailPage: ManageProjectDetailPage | null;
  private detailContentEl: HTMLElement | null = null;
  projectConfigContent: ProjectConfigContent;

  constructor(app: App, plugin: ProjectModalsPlugin) {
    super(app);
    this.plugin = plugin;
    this.expandedProjects = new Set();
    this.detailPage = null;
    this.projectConfigContent = new ProjectConfigContent(
      app,
      plugin,
      () => this.renderCurrentDetailContent()
    );
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
    this.detailContentEl = null;
    contentEl.empty();
    contentEl.addClass("feuillets-project-modal");
    const S = this.plugin.settings;

    if (this.detailPage !== null) {
      this.renderDetailPage();
      return;
    }

    const header = contentEl.createDiv({ cls: "feuillets-modal-header-row" });
    header.createEl("h3", { text: t("modal.manageProjects.title") });
    const actions = header.createDiv({ cls: "feuillets-project-actions" });
    this.iconBtn(actions, "folder-plus", t("main.cmd.createProject"), () =>
      new NewProjectModal(this.app, this.plugin).open()
    );
    this.iconBtn(actions, "import", t("main.cmd.importScrivener"), () =>
      new ScrivenerImportModal(this.app, this.plugin).open()
    );
    this.iconBtn(actions, "archive-restore", t("feuil.import.action"), () =>
      new FeuilProjectImportModal(this.app, this.plugin).open()
    );
    this.iconBtn(actions, "sparkles", t("modal.manageProjects.createDemoTooltip"), () => {
      void this.plugin.createDemoProject().then(() => this.render());
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

    const addExisting = contentEl.createDiv({ cls: "feuillets-project-existing-folder" });
    addExisting.createDiv({
      cls: "feuillets-project-existing-folder-label",
      text: t("binder.projectManager.addExisting"),
    });
    const addRow = addExisting.createDiv({ cls: "feuillets-project-existing-folder-row" });
    const input = addRow.createEl("input", {
      type: "text",
      attr: { placeholder: t("modal.manageProjects.addExistingPlaceholder") },
    });
    new FolderSuggest(this.app, input);
    const useExistingFolder = async (): Promise<void> => {
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
    };
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      void useExistingFolder();
    });
    addRow.createEl("button", { type: "button", text: t("modal.openFolder.pickBtn") })
      .addEventListener("click", () => { void useExistingFolder(); });
  }

  private renderCurrentDetailContent(): void {
    const detailPage = this.detailPage;
    const detailContentEl = this.detailContentEl;
    if (!detailPage || !detailContentEl) return;

    const projectFolder = this.app.vault.getAbstractFileByPath(detailPage.projectPath);
    if (!(projectFolder instanceof TFolder)) {
      this.detailPage = null;
      this.render();
      return;
    }

    detailContentEl.empty();
    if (detailPage.page === "citations") {
      this.renderProjectCitationsPage(detailContentEl, detailPage.projectPath);
    } else {
      this.projectConfigContent.renderPage(
        detailPage.page,
        detailContentEl,
        detailPage.projectPath,
        projectFolder,
      );
    }
  }

  private renderDetailPage(): void {
    const { contentEl } = this;
    if (!this.detailPage) return;

    const { projectPath } = this.detailPage;
    const projectFile = this.app.vault.getAbstractFileByPath(projectPath);
    if (!(projectFile instanceof TFolder)) {
      this.detailPage = null;
      this.render();
      return;
    }

    const backBar = contentEl.createDiv({ cls: "feuillets-notes-back-bar" });
    const backBtn = backBar.createEl("button", {
      cls: "feuillets-back-btn",
      text: ` ${t("modal.manageProjects.backToProject", { name: this.plugin.projectDisplayName(projectPath) })}`
    });
    const iconSpan = backBtn.createSpan({ cls: "feuillets-back-icon" });
    setIcon(iconSpan, "arrow-left");
    backBtn.prepend(iconSpan);
    backBtn.addEventListener("click", () => {
      this.detailPage = null;
      this.render();
    });

    contentEl.createEl("h3", { text: this.plugin.projectDisplayName(projectPath) });

    const content = contentEl.createDiv({ cls: "feuillets-sidebar-project" });
    this.detailContentEl = content;
    this.renderCurrentDetailContent();
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
      const switched = await this.plugin.switchProject(path);
      if (switched) this.render();
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
    row.addEventListener("click", () => { void activate(); });

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
      const exportBtn = actions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(exportBtn, "download");
      exportBtn.setAttr("aria-label", t("feuil.export.action"));
      exportBtn.addEventListener("click", (e) => { e.stopPropagation(); void this.plugin.exportFeuilProject(path); });
      const dupBtn = actions.createSpan({ cls: "feuillets-cell-icon clickable-icon" });
      setIcon(dupBtn, "copy-plus");
      dupBtn.setAttr("aria-label", t("modal.manageProjects.duplicateTooltip"));
      dupBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        new DuplicateVersionModal(this.app, this.plugin.projectDisplayName(path), (label) => {
          void (async () => {
            await this.plugin.duplicateProject(path, label);
            this.render();
          })();
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
      fieldInput.addEventListener("blur", () => {
        void (async () => {
          if (!S.projectMeta[path]) S.projectMeta[path] = {};
          S.projectMeta[path][key] = fieldInput.value.trim();
          await this.plugin.saveSettings();
        })();
      });
    };
    detail.createDiv({ cls: "feuillets-notes-label" }).setText(t("modal.manageProjects.nameField"));
    const nameInput = detail.createEl("input", {
      type: "text",
      attr: { placeholder: this.plugin.projectDisplayName(path) },
    });
    nameInput.value = (meta.name as string) || "";
    nameInput.addEventListener("blur", () => {
      void (async () => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].name = nameInput.value.trim();
        await this.plugin.saveSettings();
        this.plugin.renderAllViews(true);
        name.setText(this.plugin.projectDisplayName(path));
      })();
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
    iconInput.addEventListener("blur", () => {
      void (async () => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].icon = iconInput.value.trim();
        await this.plugin.saveSettings();
        setIcon(iconPreview, iconInput.value.trim() || "folder");
        this.plugin.renderAllViews(true);
      })();
    });

    detail.createDiv({ cls: "feuillets-notes-label" }).setText(t("modal.manageProjects.typeField"));
    const typeSelect = detail.createEl("select");
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      typeSelect.createEl("option", { text: mode.label, value: key });
    }
    typeSelect.value = resolveType(meta.type);
    typeSelect.addEventListener("change", () => {
      void (async () => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].type = typeSelect.value;
        await this.plugin.saveSettings();
      })();
    });

    detail.createDiv({ cls: "feuillets-notes-label" }).setText(t("modal.manageProjects.descriptionField"));
    const desc = detail.createEl("textarea", { attr: { rows: "2" } });
    desc.addClass("feuillets-grid-full-row");
    desc.value = (meta.description as string) || "";
    desc.addEventListener("blur", () => {
      void (async () => {
        if (!S.projectMeta[path]) S.projectMeta[path] = {};
        S.projectMeta[path].description = desc.value.trim();
        await this.plugin.saveSettings();
      })();
    });

    if (!(folderObj instanceof TFolder)) {
      return;
    }
    this.renderProjectNavRows(detail, path, folderObj);
  }

  private renderProjectCitationsPage(container: HTMLElement, path: string): void {
    const S = this.plugin.settings;
    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({
      cls: "feuillets-settings-subhead",
      text: t("modal.manageProjects.citationsAndBibliography")
    });

    const meta = (): ProjectMeta | undefined => S.projectMeta[path];
    const ensureMeta = (): ProjectMeta => {
      if (!S.projectMeta[path]) S.projectMeta[path] = {};
      return S.projectMeta[path];
    };

    if (resolveType(meta()?.type) === "nonfiction") {
      new Setting(section)
        .setName(t("settings.citationStyle.name"))
        .addDropdown((d) => {
          d.addOption("footnote", t("settings.citationStyle.footnote"));
          d.addOption("parenthetical", t("settings.citationStyle.parenthetical"));
          d.setValue(meta()?.citationStyle || "footnote");
          d.onChange((value) => {
            ensureMeta().citationStyle = value;
            void this.plugin.saveSettings();
          });
        });
    }

    section.createDiv({
      cls: "feuillets-settings-subhead",
      text: t("project.pandocCitationPreview.title")
    });
    new Setting(section)
      .setName(t("project.pandocCitationPreview.styleLabel"))
      .addDropdown((d) => {
        d.addOption("off", t("project.pandocCitationPreview.styleOff"));
        d.addOption("author-date", t("project.pandocCitationPreview.styleAuthorDate"));
        d.setValue(meta()?.pandocCitationPreviewStyle || "off");
        d.onChange((value) => {
          ensureMeta().pandocCitationPreviewStyle = value as PandocCitationPreviewStyle;
          void this.plugin.saveSettings();
        });
      });
    new Setting(section)
      .setName(t("project.pandocCitationPreview.bibliographyLabel"))
      .addText((text) => {
        text.setPlaceholder(t("project.pandocCitationPreview.bibliographyPlaceholder"));
        text.setValue(meta()?.pandocBibliographyPath || "");
        text.onChange((value) => {
          ensureMeta().pandocBibliographyPath = value.trim();
          void this.plugin.saveSettings();
        });
      });
  }

  private renderProjectNavRows(container: HTMLElement, path: string, root: TFolder): void {
    const mkNavRow = (icon: string, label: string, page: ManageProjectDetailPageKind): void => {
      const row = container.createDiv({ cls: "feuillets-notes-section-head feuillets-clickable feuillets-grid-full-row" });
      const iconSpan = row.createSpan({ cls: "feuillets-notes-section-icon" });
      setIcon(iconSpan, icon);
      row.createSpan({ cls: "feuillets-notes-section-title", text: label });
      const chevron = row.createSpan({ cls: "feuillets-notes-section-icon" });
      chevron.setAttr("style", "margin-left: auto;");
      setIcon(chevron, "chevron-right");
      row.addEventListener("click", () => {
        this.detailPage = { projectPath: path, page };
        this.render();
      });
    };

    const section = container.createDiv({ cls: "feuillets-notes-section" });
    section.createDiv({ cls: "feuillets-settings-subhead", text: t("modal.manageProjects.configurationHeader") });
    mkNavRow("target", t("sidebar.project.rowGoals"), "goals");
    mkNavRow("quote", t("modal.manageProjects.citationsAndBibliography"), "citations");

    const metaSection = container.createDiv({ cls: "feuillets-notes-section" });
    metaSection.createDiv({ cls: "feuillets-settings-subhead", text: t("sidebar.project.metadataHeader") });
    mkNavRow("arrow-left-right", t("sidebar.project.rowMapping"), "mapping");
    mkNavRow("circle-dot", t("sidebar.project.rowStatuses"), "statuses");
    mkNavRow("tag", t("sidebar.project.rowLabels"), "labels");
    mkNavRow("hash", t("sidebar.project.rowTags"), "tags");
  }
}
