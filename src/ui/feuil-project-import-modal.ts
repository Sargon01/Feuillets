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
    contentEl.empty();
    contentEl.addClass("feuillets-feuil-import-modal");
    contentEl.createEl("h3", { text: t("feuil.import.title") });
    contentEl.createDiv({ cls: "feuillets-feuil-import-intro", text: t("feuil.import.description") });

    const form = contentEl.createDiv({ cls: "feuillets-feuil-import-form" });
    const fileField = form.createDiv({ cls: "feuillets-feuil-import-field" });
    fileField.createEl("label", { text: t("feuil.import.file"), attr: { for: "feuil-import-file" } });
    const fileInput = fileField.createEl("input", {
      type: "file",
      attr: { accept: ".feuil", id: "feuil-import-file" },
      cls: "feuillets-feuil-import-file-input",
    });
    const fileRow = fileField.createDiv({ cls: "feuillets-feuil-import-file-row" });
    const chooseButton = fileRow.createEl("button", { type: "button", text: t("feuil.import.chooseFile") });
    chooseButton.addEventListener("click", () => fileInput.click());
    const fileNameEl = fileRow.createDiv({ cls: "feuillets-feuil-import-file-name" });
    fileNameEl.setText(t("feuil.import.noFile"));
    const summary = contentEl.createDiv({ cls: "feuillets-feuil-import-summary" });
    fileInput.addEventListener("change", () => { void this.readFile(fileInput, summary, fileNameEl); });

    const parentField = form.createDiv({ cls: "feuillets-feuil-import-field" });
    parentField.createEl("label", { text: t("feuil.import.parent"), attr: { for: "feuil-import-parent" } });
    this.parentInput = parentField.createEl("input", { type: "text", attr: { id: "feuil-import-parent" } });
    new FolderSuggest(this.app, this.parentInput);

    const folderField = form.createDiv({ cls: "feuillets-feuil-import-field" });
    folderField.createEl("label", { text: t("feuil.import.folderName"), attr: { for: "feuil-import-folder-name" } });
    this.folderInput = folderField.createEl("input", { type: "text", attr: { id: "feuil-import-folder-name" } });
    this.folderInput.addEventListener("input", () => this.updateSubmitState());

    const buttons = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    buttons.createEl("button", { type: "button", text: t("shared.cancel") }).addEventListener("click", () => this.close());
    this.importButton = buttons.createEl("button", { type: "button", text: t("feuil.import.action"), cls: "mod-cta" });
    this.importButton.addEventListener("click", () => { void this.submit(); });
    this.updateSubmitState();
  }

  private updateSubmitState(): void {
    if (!this.importButton) return;
    this.importButton.disabled = this.busy || this.plan === null || !this.folderInput || this.folderInput.value.trim() === "";
  }

  private async readFile(input: HTMLInputElement, detected: HTMLElement, fileNameEl: HTMLElement): Promise<void> {
    this.plan = null;
    detected.setText("");
    const file = input.files?.length === 1 ? input.files[0] : null;
    fileNameEl.setText(file?.name || t("feuil.import.noFile"));
    this.updateSubmitState();
    if (!file || !/\.feuil$/i.test(file.name)) { new Notice(t("feuil.import.invalidExtension")); return; }
    try {
      this.plan = await buildFeuilProjectImportPlan(new Uint8Array(await file.arrayBuffer()));
      detected.setText(`${t("feuil.import.detected")} : ${this.plan.manifest.project.name}`);
      if (this.folderInput) this.folderInput.value = sanitizeFeuilFileStem(this.plan.manifest.project.name);
      this.updateSubmitState();
    } catch { this.plan = null; detected.setText(""); this.updateSubmitState(); new Notice(t("feuil.import.invalidArchive")); }
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.plan || !this.folderInput || !this.parentInput) return;
    const name = this.folderInput.value.trim(); const parent = normalizePath(this.parentInput.value.trim());
    if (!isPortableFeuilNameSegment(name)) { new Notice(t("feuil.import.invalidName")); return; }
    if (parent && !(this.app.vault.getAbstractFileByPath(parent) instanceof TFolder)) { new Notice(t("feuil.import.invalidParent")); return; }
    this.busy = true; this.updateSubmitState();
    const success = await this.plugin.importFeuilProject(this.plan, normalizePath(parent ? `${parent}/${name}` : name));
    if (success) { new Notice(t("feuil.import.success")); this.close(); return; }
    this.busy = false; this.updateSubmitState();
  }

  onClose(): void { this.contentEl.empty(); }
}
