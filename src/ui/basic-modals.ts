import { Modal, type App } from "obsidian";
import { t } from "../i18n/index.js";

type NewSheetHandler = (fileName: string, title: string) => void | Promise<void>;
type NewFolderHandler = (name: string) => void | Promise<void>;
type RenameFolderHandler = (name: string) => void | Promise<void>;
type NewResearchFileHandler = (name: string) => void | Promise<void>;
type RenameFileHandler = (name: string) => void | Promise<void>;
type ConfirmHandler = () => void | Promise<void>;

export class NewSheetModal extends Modal {
  folderName: string;
  onSubmit: NewSheetHandler;

  constructor(app: App, folderName: string, onSubmit: NewSheetHandler) {
    super(app);
    this.folderName = folderName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.newSheet.title", { folder: this.folderName }),
    });
    contentEl.createEl("label", { text: t("modal.newSheet.fileNameLabel") });
    const fileInput = contentEl.createEl("input", {
      type: "text",
      placeholder: t("modal.newSheet.fileNamePlaceholder"),
    });
    fileInput.addClass("feuillets-input-full");
    fileInput.addClass("feuillets-mb-sm");
    contentEl.createEl("label", {
      text: t("modal.newSheet.titleLabel"),
    });
    const titleInput = contentEl.createEl("input", { type: "text" });
    titleInput.addClass("feuillets-input-full");
    fileInput.focus();
    const submit = () => {
      const fileName = fileInput.value.trim();
      if (!fileName) return;
      this.close();
      void this.onSubmit(fileName, titleInput.value.trim());
    };
    for (const el of [fileInput, titleInput]) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    }
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    btnRow
      .createEl("button", { text: t("modal.create") })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Confirmation générique avant une action destructive/étendue (ex.
 * supprimer une propriété de tous les feuillets d'un projet) — pas de
 * window.confirm() natif, pour rester cohérent avec le reste de l'UI. */
export class ConfirmModal extends Modal {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: ConfirmHandler;

  constructor(app: App, title: string, message: string, confirmLabel: string, onConfirm: ConfirmHandler) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", { text: this.message });
    const btnRow = contentEl.createDiv({ cls: "feuillets-modal-buttons" });
    const confirmBtn = btnRow.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-warning",
    });
    confirmBtn.addEventListener("click", () => {
      this.close();
      void this.onConfirm();
    });
    btnRow
      .createEl("button", { text: t("modal.cancel") })
      .addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class NewFolderModal extends Modal {
  parentName: string;
  onSubmit: NewFolderHandler;

  constructor(app: App, parentName: string, onSubmit: NewFolderHandler) {
    super(app);
    this.parentName = parentName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.newFolder.title", { parent: this.parentName }),
    });
    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: t("modal.newFolder.placeholder"),
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
      .createEl("button", { text: t("modal.create") })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Modale de saisie du nom d'un fichier de recherche avant sa création.
 *  Préremplie avec un nom par défaut, valide par Entrée ou bouton. */
export class NewResearchFileModal extends Modal {
  folderName: string;
  defaultName: string;
  onSubmit: NewResearchFileHandler;

  constructor(app: App, folderName: string, defaultName: string, onSubmit: NewResearchFileHandler) {
    super(app);
    this.folderName = folderName;
    this.defaultName = defaultName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.newResearchFile.title", { folder: this.folderName }),
    });
    const input = contentEl.createEl("input", {
      type: "text",
      value: this.defaultName,
    });
    input.addClass("feuillets-input-full");
    input.focus();
    input.select();
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
      .createEl("button", { text: t("modal.create") })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Modale de renommage d'un fichier de recherche. Préremplie avec le nom
 *  actuel (basename, sans extension .md). */
export class RenameFileModal extends Modal {
  currentName: string;
  onSubmit: RenameFileHandler;

  constructor(app: App, currentName: string, onSubmit: RenameFileHandler) {
    super(app);
    this.currentName = currentName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("modal.renameFile.title") });
    contentEl.createEl("label", { text: t("modal.renameFile.label") });
    const input = contentEl.createEl("input", {
      type: "text",
      value: this.currentName,
    });
    input.addClass("feuillets-input-full");
    input.focus();
    input.select();
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
      .createEl("button", { text: t("modal.rename") })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}

export class RenameFolderModal extends Modal {
  currentName: string;
  onSubmit: RenameFolderHandler;

  constructor(app: App, currentName: string, onSubmit: RenameFolderHandler) {
    super(app);
    this.currentName = currentName;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", {
      text: t("modal.renameFolder.title"),
    });
    contentEl.createEl("label", { text: t("modal.renameFolder.label") });
    const input = contentEl.createEl("input", {
      type: "text",
      value: this.currentName,
    });
    input.addClass("feuillets-input-full");
    input.focus();
    input.select();
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
      .createEl("button", { text: t("modal.save") })
      .addEventListener("click", submit);
  }
  onClose() {
    this.contentEl.empty();
  }
}