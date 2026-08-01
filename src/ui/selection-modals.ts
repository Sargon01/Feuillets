import { Modal, type App, type TFile, type TFolder } from "obsidian";
import { t } from "../i18n/index.js";

type CompileFrontmatter = {
  compile?: boolean;
};

type SelectionPlugin = {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  buildNumbering(folder: TFolder): Map<string, string>;
  flattenFiles(folder: TFolder): TFile[];
  fmOf(file: TFile): CompileFrontmatter;
  shortTitleFor(file: TFile): string;
  renderAllViews(force: boolean): void;
  saveSettings(): Promise<void>;
};

export class CompileSelectionModal extends Modal {
  plugin: SelectionPlugin;

  constructor(app: App, plugin: SelectionPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.compileSelection.title") });
    contentEl.createEl("p", { cls: "feuillets-notes-sub" }).setText(
      t("modal.compileSelection.desc")
    );

    const root = this.plugin.getProjectFolder();
    if (!root) {
      contentEl.setText(t("main.notice.projectFolderNotFound"));
      return;
    }

    const numbering = this.plugin.buildNumbering(root);
    const listEl = contentEl.createDiv({ cls: "feuillets-read-selection" });
    const checkboxes: Array<[HTMLInputElement, TFile]> = [];

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
    btnRow.createEl("button", { text: t("modal.selectAll") }).addEventListener("click", () => {
      checkboxes.forEach(([cb]) => (cb.checked = true));
    });
    btnRow.createEl("button", { text: t("modal.selectNone") }).addEventListener("click", () => {
      checkboxes.forEach(([cb]) => (cb.checked = false));
    });
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
    this.contentEl.empty();
  }
}
