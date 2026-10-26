import { TFolder, normalizePath, type App } from "obsidian";
import { t } from "../i18n/index.js";
import { ensureFolder } from "./project-files.js";

export interface ExportDestination {
  path: string;
}

export interface ExportSaveRequest {
  fileName: string;
  folderPath: string;
  extension: string;
}

export type ExportDestinationPicker = (app: App, request: ExportSaveRequest) => Promise<ExportDestination | null>;

function hasInvalidPathCharacters(value: string): boolean {
  return /[\\/:*?"<>|]/u.test(value) || Array.from(value).some((character) => character.charCodeAt(0) < 32);
}

export function exportFileName(name: string, extension: string): string {
  const trimmed = name.trim();
  const base = trimmed.replace(/\.(md|docx|epub|odt|pdf|zip)$/i, "");
  if (!base || base === "." || base === ".." || hasInvalidPathCharacters(base) || /[. ]$/.test(base)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) {
    throw new Error(t("export.save.invalidName"));
  }
  return `${base}.${extension}`;
}

export function exportDestination(app: App, folder: string, name: string, extension: string): ExportDestination {
  const folderPath = folder.trim().replace(/^\/+|\/+$/g, "");
  if (folderPath.split("/").some((part) => part === "." || part === ".." || hasInvalidPathCharacters(part))) {
    throw new Error(t("export.save.invalidFolder"));
  }
  const existing = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
  if (existing && !(existing instanceof TFolder)) throw new Error(t("export.save.invalidFolder"));
  return { path: normalizePath(`${folderPath ? `${folderPath}/` : ""}${exportFileName(name, extension)}`) };
}

export function assertExportDestinationAvailable(app: App, destination: ExportDestination): void {
  const path = destination.path;
  const slash = path.lastIndexOf("/");
  const parent = app.vault.getAbstractFileByPath(slash < 0 ? "/" : path.slice(0, slash));
  const name = path.slice(slash + 1).toLowerCase();
  if (app.vault.getAbstractFileByPath(path)
    || (parent instanceof TFolder && parent.children.some((child) => child.name.toLowerCase() === name))) {
    throw new Error(t("export.save.collision", { path }));
  }
}

/** Exclusive creation: an export never changes a source or an existing output. */
export async function writeExportDestination(
  app: App,
  destination: ExportDestination,
  data: string | Uint8Array | Blob | ArrayBuffer
): Promise<string> {
  assertExportDestinationAvailable(app, destination);
  const slash = destination.path.lastIndexOf("/");
  if (slash > 0) await ensureFolder(app, destination.path.slice(0, slash));
  assertExportDestinationAvailable(app, destination);
  if (typeof data === "string") return (await app.vault.create(destination.path, data)).path;
  const buffer = data instanceof Blob ? await data.arrayBuffer()
    : data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
  return (await app.vault.createBinary(destination.path, buffer)).path;
}

export async function chooseExportDestination(app: App, request: ExportSaveRequest): Promise<ExportDestination | null> {
  const { ExportDestinationModal } = await import("../ui/export-destination-modal.js");
  return new Promise((resolve) => new ExportDestinationModal(app, request, resolve).open());
}
