import { TFile, TFolder, type App } from "obsidian";
import { editionRootPaths, EDITORIAL_OPERATIONAL_FOLDERS, getProjectFolder } from "./folder-structure.js";
import { normalizeLegacyTemplate, normalizeV2Template } from "./export-template-v2.js";
import { EXPORT_TEMPLATES } from "../utils/export-templates.js";

export const EDITORIAL_EXPORTS_FOLDER = "Exports";
export const EDITORIAL_TEMPLATE_KEY = "editorialDocument";

export function isEditorialWorkFolder(root: TFolder, path: string): boolean {
  if (path === root.path) return true;
  if (!path.startsWith(root.path + "/")) return false;
  return path.slice(root.path.length + 1).split("/").every(part => !EDITORIAL_OPERATIONAL_FOLDERS.has(part));
}

export function isEditorialSourceFolder(root: TFolder, path: string): boolean {
  const output = `${root.path}/${EDITORIAL_EXPORTS_FOLDER}`;
  return path !== output && !path.startsWith(output + "/") && isEditorialWorkFolder(root, path);
}

export function isEditorialMarkdown(file: TFile, root: TFolder): boolean {
  return file.extension === "md" && !!file.parent && isEditorialSourceFolder(root, file.parent.path);
}

export function resolveEditorialDocument(app: App, settings: FeuilletsSettings, path: string): TFile | null {
  const project = getProjectFolder(app, settings);
  const file = app.vault.getAbstractFileByPath(path);
  if (!project || !(file instanceof TFile)) return null;
  for (const root of editionRootPaths(project)) {
    if (!file.path.startsWith(root + "/")) continue;
    const folder = app.vault.getAbstractFileByPath(root);
    if (folder instanceof TFolder && isEditorialMarkdown(file, folder)) return file;
  }
  return null;
}

export function editorialComposition(settings: FeuilletsSettings, file: TFile) {
  const value = settings.editorialDocuments?.[file.path];
  return { automaticTitle: value?.automaticTitle === true, frenchTypography: value?.frenchTypography !== false };
}

export function editorialTemplate(settings: FeuilletsSettings, file: TFile): ExportTemplateV2 {
  const saved = settings.editorialDocuments?.[file.path]?.template;
  return saved?.version === 2 && saved.page && saved.body
    ? asEditorialTemplate(saved)
    : normalizeLegacyTemplate(EXPORT_TEMPLATES[EDITORIAL_TEMPLATE_KEY]);
}

export function asEditorialTemplate(template: ExportTemplateV2): ExportTemplateV2 {
  return normalizeV2Template({ ...template, profile: "document", titlePage: { styles: {} } });
}

export function updateEditorialProperties(settings: FeuilletsSettings, path: string, patch: EditorialDocumentSettings): void {
  const documents = settings.editorialDocuments ??= {};
  documents[path] = { ...documents[path], ...patch };
}
