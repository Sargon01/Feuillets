import { Modal, Notice, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { buildFeuilProjectImportPlan } from "../services/feuil-project-import-plan.js";
import type { FeuilProjectImportPlan } from "../services/feuil-project-import-plan.js";
import { isPortableFeuilNameSegment, sanitizeFeuilFileStem } from "../utils/feuil-file-io.js";
import { FolderSuggest } from "./folder-suggest.js";
import { t } from "../i18n/index.js";

type FeuilProjectImportModalPlugin = {
  importFeuilProject(plan: FeuilProjectImportPlan, destinationRootPath: string): Promise<boolean>;
};

export class FeuilProjectImportModal extends Modal {
  private plan: FeuilProjectImportPlan | null = null;
  private busy = false;
  private importButton: HTMLButtonElement | null = null;
  private folderInput: HTMLInputElement | null = null;
  private parentInput: HTMLInputElement | null = null;

  constructor(app: App, private readonly plugin: FeuilProjectImportModalPlugin) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("feuil.import.title") });
    contentEl.createEl("label", { text: t("feuil.import.file") });
    const fileInput = contentEl.createEl("input", { type: "file", attr: { accept: ".feuil" } });
    const detected = contentEl.createDiv({ cls: "setting-item-description" });
    fileInput.addEventListener("change", () => { void this.readFile(fileInput, detected); });
    contentEl.createEl("label", { text: t("feuil.import.parent") });
    this.parentInput = contentEl.createEl("input", { type: "text" }); new FolderSuggest(this.app, this.parentInput);
    contentEl.createEl("label", { text: t("feuil.import.folderName") });
    this.folderInput = contentEl.createEl("input", { type: "text" });
    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { text: t("common.cancel") }).addEventListener("click", () => this.close());
    this.importButton = buttons.createEl("button", { text: t("feuil.import.action"), cls: "mod-cta" }); this.importButton.disabled = true;
    this.importButton.addEventListener("click", () => { void this.submit(); });
  }

  private async readFile(input: HTMLInputElement, detected: HTMLElement): Promise<void> {
    this.plan = null; if (this.importButton) this.importButton.disabled = true;
    const file = input.files?.length === 1 ? input.files[0] : null;
    if (!file || !/\.feuil$/i.test(file.name)) { new Notice(t("feuil.import.invalidExtension")); return; }
    try {
      this.plan = await buildFeuilProjectImportPlan(new Uint8Array(await file.arrayBuffer()));
      detected.setText(`${t("feuil.import.detected")} : ${this.plan.manifest.project.name}`);
      if (this.folderInput) this.folderInput.value = sanitizeFeuilFileStem(this.plan.manifest.project.name);
      if (this.importButton) this.importButton.disabled = false;
    } catch { new Notice(t("feuil.import.invalidArchive")); }
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.plan || !this.folderInput || !this.parentInput) return;
    const name = this.folderInput.value.trim(); const parent = normalizePath(this.parentInput.value.trim());
    if (!isPortableFeuilNameSegment(name)) { new Notice(t("feuil.import.invalidName")); return; }
    if (parent && !(this.app.vault.getAbstractFileByPath(parent) instanceof TFolder)) { new Notice(t("feuil.import.invalidParent")); return; }
    this.busy = true; if (this.importButton) this.importButton.disabled = true;
    const success = await this.plugin.importFeuilProject(this.plan, normalizePath(parent ? `${parent}/${name}` : name));
    if (success) { new Notice(t("feuil.import.success")); this.close(); return; }
    this.busy = false; if (this.importButton) this.importButton.disabled = false;
  }

  onClose(): void { this.contentEl.empty(); }
}
