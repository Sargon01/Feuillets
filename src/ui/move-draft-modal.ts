import { App, Modal, Notice, TFile, TFolder, setIcon } from "obsidian";
import { t } from "../i18n/index.js";

type ProjectNode = TFile | TFolder;

export type MoveDraftToProjectPlugin = {
  settings: FeuilletsSettings;
  getOrderedChildren(folder: TFolder, includeHidden?: boolean): ProjectNode[];
  projectDisplayName(path: string): string;
  moveDraftToProject(file: TFile, destProjectRootPath: string, destFolderPath: string): Promise<boolean>;
};

/** « Déplacer vers un projet… » (menu contextuel d'un brouillon) — modale en
 * deux étapes : choisir un projet Feuillets connu, puis sa racine ou un
 * sous-dossier. Aucun dossier technique (`_Feuillets`, `_Recherche`,
 * `_Sortie`, `_Snapshots`, `_Backups`…) n'est jamais proposé : l'arbre
 * réutilise `getOrderedChildren` (même filtre « _ » que le Binder), jamais
 * une liste de noms techniques recopiée ici. Chaque ligne exécute le
 * déplacement au clic — pas d'étape de confirmation séparée, comme le
 * gestionnaire de projets (ManageProjectsModal). */
export class MoveDraftToProjectModal extends Modal {
  private readonly plugin: MoveDraftToProjectPlugin;
  private readonly file: TFile;
  private chosenProjectPath: string | null = null;
  private moving = false;

  constructor(app: App, plugin: MoveDraftToProjectPlugin, file: TFile) {
    super(app);
    this.plugin = plugin;
    this.file = file;
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("feuillets-move-draft-modal");
    if (this.chosenProjectPath) this.renderFolderStep(this.chosenProjectPath);
    else this.renderProjectStep();
  }

  private renderProjectStep(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.moveDraftToProject.title") });
    contentEl.createDiv({
      cls: "feuillets-compile-selection-description",
      text: t("modal.moveDraftToProject.pickProjectDesc"),
    });

    const S = this.plugin.settings;
    const projects = [S.projectFolder, ...(S.projects || [])].filter(
      (p, i, a): p is string => !!p && a.indexOf(p) === i
    );

    if (projects.length === 0) {
      contentEl.createDiv({ cls: "feuillets-empty", text: t("modal.moveDraftToProject.noProjects") });
      return;
    }

    const list = contentEl.createDiv({ cls: "feuillets-project-list" });
    for (const path of projects) {
      const folder = this.app.vault.getAbstractFileByPath(path);
      const exists = folder instanceof TFolder;

      const row = list.createDiv({ cls: "feuillets-project-item" });
      const icon = row.createSpan({ cls: "feuillets-cell-icon" });
      setIcon(icon, exists ? "folder" : "alert-triangle");
      const name = row.createSpan({ cls: "feuillets-project-name" });
      name.setText(
        exists
          ? this.plugin.projectDisplayName(path)
          : t("settings.activeProject.notFound", { name: this.plugin.projectDisplayName(path) })
      );
      if (!exists) name.addClass("feuillets-muted-italic");

      row.addEventListener("click", () => {
        if (!exists) {
          new Notice(t("modal.manageProjects.folderGone", { path }));
          return;
        }
        this.chosenProjectPath = path;
        this.render();
      });
    }
  }

  private renderFolderStep(projectPath: string): void {
    const { contentEl } = this;
    const root = this.app.vault.getAbstractFileByPath(projectPath);
    if (!(root instanceof TFolder)) {
      this.chosenProjectPath = null;
      this.render();
      return;
    }

    const backBar = contentEl.createDiv({ cls: "feuillets-notes-back-bar" });
    const backBtn = backBar.createEl("button", { cls: "feuillets-back-btn" });
    setIcon(backBtn.createSpan({ cls: "feuillets-back-icon" }), "arrow-left");
    backBtn.createSpan({ text: ` ${t("modal.moveDraftToProject.backToProjects")}` });
    backBtn.addEventListener("click", () => {
      this.chosenProjectPath = null;
      this.render();
    });

    contentEl.createEl("h3", { text: this.plugin.projectDisplayName(projectPath) });
    contentEl.createDiv({
      cls: "feuillets-compile-selection-description",
      text: t("modal.moveDraftToProject.pickFolderDesc"),
    });

    const list = contentEl.createDiv({ cls: "feuillets-move-draft-tree" });

    const selectDestination = (folder: TFolder): void => {
      if (this.moving) return;
      this.moving = true;
      void this.plugin.moveDraftToProject(this.file, root.path, folder.path).then((ok) => {
        this.moving = false;
        if (ok) this.close();
      });
    };

    const rootRow = list.createDiv({ cls: "feuillets-move-draft-target is-root" });
    rootRow.setText(t("modal.moveDraftToProject.projectRoot"));
    rootRow.addEventListener("click", () => selectDestination(root));

    const renderChildren = (folder: TFolder, depth: number): void => {
      for (const child of this.plugin.getOrderedChildren(folder, false)) {
        if (!(child instanceof TFolder)) continue;
        const row = list.createDiv({ cls: "feuillets-move-draft-target" });
        row.style.paddingLeft = `${depth * 16}px`;
        row.setText(child.name);
        row.addEventListener("click", () => selectDestination(child));
        renderChildren(child, depth + 1);
      }
    };
    renderChildren(root, 1);
  }
}
