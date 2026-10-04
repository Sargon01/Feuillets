import { TFolder, TFile, normalizePath, type App } from "obsidian";
import { getOrderedChildren } from "./folder-structure.js";

const ANNEXES_FOLDER_NAMES = ["Annexes", "Appendices"];

/** Finds the existing appendix folder directly under the editorial root. */
export function annexesFolder(app: App, projectRoot: TFolder | null): TFolder | null {
  if (!projectRoot) return null;
  for (const name of ANNEXES_FOLDER_NAMES) {
    const f = app.vault.getAbstractFileByPath(normalizePath(`${projectRoot.path}/${name}`));
    if (f instanceof TFolder) return f;
  }
  return null;
}

/** Lists direct Markdown children in Binder order, regardless of compile inclusion. */
export function annexesFiles(app: App, settings: FeuilletsSettings, projectRoot: TFolder | null): TFile[] {
  const folder = annexesFolder(app, projectRoot);
  if (!folder) return [];
  const out: TFile[] = [];
  for (const child of getOrderedChildren(app, settings, folder)) {
    if (child instanceof TFile && child.extension === "md") out.push(child);
  }
  return out;
}
