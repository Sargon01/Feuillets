import { Modal, TFile, TFolder, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { getOrderedChildren, isFrontMatter } from "../services/folder-structure.js";

type CompileFrontmatter = {
  compile?: boolean;
};

type SelectionPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  fmOf(file: TFile): CompileFrontmatter;
  shortTitleFor(file: TFile): string;
  renderAllViews(force: boolean): void;
  saveSettings(): Promise<void>;
};

const EXCLUDED_BODY_FOLDERS = new Set(["Annexes", "Appendices", "_Recherche", "_Ressources", "_Edition", "_Sortie", "_Snapshots", "_Backups"]);

export function manuscriptBodyFiles(app: App, settings: FeuilletsSettings, root: TFolder | null): TFile[] {
  if (!root) return [];
  const files: TFile[] = [];
  const walk = (folder: TFolder) => {
    for (const child of getOrderedChildren(app, settings, folder, false)) {
      if (child instanceof TFile && child.extension === "md" && !isFrontMatter(app, settings, child)) files.push(child);
      else if (child instanceof TFolder && !EXCLUDED_BODY_FOLDERS.has(child.name) && !child.name.startsWith("_") && !isFrontMatter(app, settings, child)) walk(child);
    }
  };
  walk(root);
  return files;
}

export class CompileSelectionModal extends Modal {
  plugin: SelectionPlugin;

  constructor(app: App, plugin: SelectionPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("feuillets-compile-selection-modal");
    contentEl.addClass("feuillets-compile-selection-content");
    const infoEl = contentEl.createDiv({ cls: "feuillets-compile-selection-info" });
    infoEl.createEl("h3", { text: t("modal.compileSelection.title") });
    infoEl.createEl("p", { cls: "feuillets-compile-selection-description" }).setText(
      t("modal.compileSelection.desc")
    );

    const root = this.plugin.getProjectFolder();
    if (!root) {
      infoEl.createDiv({ text: t("main.notice.projectFolderNotFound") });
      return;
    }

    const files = manuscriptBodyFiles(this.app, this.plugin.settings, root);
    const included = files.filter((file) => this.plugin.fmOf(file).compile !== false).length;
    infoEl.createEl("p", { cls: "feuillets-compile-selection-counter", text: `${included} sur ${files.length} éléments inclus` });
    const listEl = contentEl.createDiv({ cls: "feuillets-read-selection feuillets-manuscript-selection" });
    const checkboxes: Array<[HTMLInputElement, TFile]> = [];

    const renderFolder = (folder: TFolder, depth: number) => {
      for (const child of getOrderedChildren(this.app, this.plugin.settings, folder, false)) {
        if (child instanceof TFolder) {
          if (EXCLUDED_BODY_FOLDERS.has(child.name) || child.name.startsWith("_") || isFrontMatter(this.app, this.plugin.settings, child)) continue;
          listEl.createDiv({ cls: "feuillets-manuscript-selection-folder", text: child.name }).style.paddingLeft = `${depth * 16}px`;
          renderFolder(child, depth + 1);
        } else if (child instanceof TFile && child.extension === "md" && !isFrontMatter(this.app, this.plugin.settings, child)) {
          const row = listEl.createDiv({ cls: "feuillets-read-selection-row" });
          row.style.paddingLeft = `${depth * 16}px`;
          const cb = row.createEl("input", { type: "checkbox" });
          cb.checked = this.plugin.fmOf(child).compile !== false;
          checkboxes.push([cb, child]);
          const label = row.createSpan({ text: this.plugin.shortTitleFor(child) });
          label.addEventListener("click", () => { cb.checked = !cb.checked; });
        }
      }
    };
    renderFolder(root, 0);

    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons feuillets-compile-selection-footer" });
    btnRow.createEl("button", { text: t("modal.selectAll") }).addEventListener("click", () => {
      checkboxes.forEach(([cb]) => (cb.checked = true));
    });
    btnRow.createEl("button", { text: t("modal.selectNone") }).addEventListener("click", () => {
      checkboxes.forEach(([cb]) => (cb.checked = false));
    });
    btnRow.createEl("button", { text: t("modal.cancel") }).addEventListener("click", () => this.close());
    btnRow.createEl("button", { text: t("modal.save"), cls: "mod-cta" }).addEventListener("click", () => {
      void (async () => {
        for (const [cb, file] of checkboxes) {
          const fm = this.plugin.fmOf(file);
          const current = fm.compile !== false;
          if (cb.checked !== current) {
            await this.app.fileManager.processFrontMatter(file, (data: Record<string, unknown>) => {
              if (cb.checked) delete data.compile;
              else data.compile = false;
              delete data.compiler;
            });
          }
        }
        this.close();
        this.plugin.renderAllViews(true);
      })();
    });
  }

  onClose() {
    this.modalEl.removeClass("feuillets-compile-selection-modal");
    this.contentEl.empty();
  }
}
