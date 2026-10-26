import { Modal, Notice, Platform, Setting, TFile, type App } from "obsidian";
import { t } from "../i18n/index.js";

export interface ExportShell {
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

function desktopShell(): ExportShell | null {
  if (!Platform.isDesktop || typeof require !== "function") return null;
  try {
    const nodeRequire: (id: string) => unknown = require;
    const electron = nodeRequire("electron");
    if (typeof electron !== "object" || electron === null || !("shell" in electron)) return null;
    const shell = electron.shell;
    if (typeof shell !== "object" || shell === null || !("openPath" in shell) || !("showItemInFolder" in shell)
      || typeof shell.openPath !== "function" || typeof shell.showItemInFolder !== "function") return null;
    return shell as ExportShell;
  } catch {
    return null;
  }
}

function absoluteExportPath(app: App, vaultPath: string): string | null {
  const adapter = app.vault.adapter;
  if (!adapter || !("getFullPath" in adapter) || typeof adapter.getFullPath !== "function") return null;
  const getFullPath = adapter.getFullPath as (path: string) => unknown;
  const result: unknown = getFullPath.call(adapter, vaultPath);
  return typeof result === "string" ? result : null;
}

class ExportLocationModal extends Modal {
  constructor(app: App, private path: string) { super(app); }
  onOpen(): void {
    this.titleEl.setText(t("export.result.reveal"));
    this.contentEl.createEl("p", { text: t("export.result.location", { path: this.path }) });
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText(t("export.result.copyPath"))
      .onClick(async () => {
        try { await navigator.clipboard.writeText(this.path); }
        catch { new Notice(t("binder.copyFailed")); }
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export function exportResultActions(app: App, path: string, shell: ExportShell | null = desktopShell()) {
  const existingFile = (): TFile => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(t("export.result.missing"));
    return file;
  };
  return {
    open: async (): Promise<void> => {
      existingFile();
      const absolute = shell ? absoluteExportPath(app, path) : null;
      if (shell && absolute) {
        try {
          const error = await shell.openPath(absolute);
          if (!error) return;
        } catch {
          // Fall back to the vault when the desktop bridge is unavailable.
        }
      }
      await app.workspace.openLinkText(path, "", true);
    },
    reveal: async (): Promise<void> => {
      const file = existingFile();
      const absolute = shell ? absoluteExportPath(app, path) : null;
      if (shell && absolute) {
        try {
          shell.showItemInFolder(absolute);
          return;
        } catch {
          // Fall back to the vault when the desktop bridge is unavailable.
        }
      }
      const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
      const view = leaf?.view;
      if (view && "revealInFolder" in view && typeof view.revealInFolder === "function") {
        try {
          const revealInFolder = view.revealInFolder as (file: TFile) => void | Promise<void>;
          await app.workspace.revealLeaf(leaf);
          await revealInFolder.call(view, file);
          return;
        } catch {
          // Keep the actual location accessible if the explorer cannot reveal it.
        }
      }
      new ExportLocationModal(app, path).open();
    },
  };
}

/** One completion notice, only after the writer has returned its actual path. */
export function presentExportResult(app: App, path: string): void {
  const fragment = createFragment();
  fragment.appendText(t("export.pandoc.exportSuccess", { path }));
  const actions = exportResultActions(app, path);
  const button = (label: string, action: () => Promise<void>): void => {
    fragment.appendText(" ");
    const element = fragment.createEl("button", { text: label });
    element.addEventListener("click", () => {
      void action().catch(() => new Notice(t("export.result.failed")));
    });
  };
  button(t("export.result.open"), actions.open);
  button(t("export.result.reveal"), actions.reveal);
  new Notice(fragment, 15000);
}
