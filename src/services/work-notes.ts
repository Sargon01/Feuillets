import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { getProjectFolder, resourcesFolderPath, resourcesSubfolderPath, FEUILLETS_RESOURCE_FOLDERS } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";

export interface WorkNote { id: string; file: string; text: string; }
export interface WorkNotesStore { version: 1; notes: WorkNote[]; }
export class WorkNotesFileCorruptedError extends Error { constructor(readonly path: string) { super(`Fichier work-notes JSON invalide : ${path}`); } }

function folderPath(app: App, root: TFolder): string {
  return resourcesSubfolderPath(app, resourcesFolderPath(app, root), FEUILLETS_RESOURCE_FOLDERS.assets, "Assets", "Visuels", "Internal resources");
}
export function workNotesFilePath(app: App, settings: FeuilletsSettings | null | undefined): string | null {
  const root = getProjectFolder(app, settings);
  return root ? normalizePath(`${folderPath(app, root)}/work-notes.json`) : null;
}
function empty(): WorkNotesStore { return { version: 1, notes: [] }; }
function valid(value: unknown): value is WorkNotesStore {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && Array.isArray(v.notes) && v.notes.every((n) => n && typeof n === "object" && typeof (n as WorkNote).id === "string" && typeof (n as WorkNote).file === "string" && typeof (n as WorkNote).text === "string");
}
export async function loadWorkNotes(app: App, settings: FeuilletsSettings | null | undefined): Promise<WorkNotesStore> {
  const path = workNotesFilePath(app, settings); if (!path) return empty();
  const file = app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return empty();
  let parsed: unknown; try { parsed = JSON.parse(await app.vault.read(file)); } catch { throw new WorkNotesFileCorruptedError(path); }
  if (!valid(parsed)) throw new WorkNotesFileCorruptedError(path); return parsed;
}
export async function saveWorkNotes(app: App, settings: FeuilletsSettings | null | undefined, store: WorkNotesStore): Promise<void> {
  const root = getProjectFolder(app, settings); if (!root) throw new Error("Aucun projet Feuillets actif.");
  const folder = folderPath(app, root); await ensureFolder(app, folder); const path = normalizePath(`${folder}/work-notes.json`); const existing = app.vault.getAbstractFileByPath(path); const json = JSON.stringify(store, null, 2);
  if (existing instanceof TFile) await app.vault.modify(existing, json); else await app.vault.create(path, json);
}
function id(): string { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
export async function addWorkNote(app: App, settings: FeuilletsSettings | null | undefined, file: string, text: string): Promise<WorkNote | null> { if (!text.trim()) return null; const store = await loadWorkNotes(app, settings); const note = { id: id(), file, text }; store.notes.push(note); await saveWorkNotes(app, settings, store); return note; }
export async function updateWorkNote(app: App, settings: FeuilletsSettings | null | undefined, id: string, text: string): Promise<void> { const store = await loadWorkNotes(app, settings); const note = store.notes.find((n) => n.id === id); if (!note) return; if (!text.trim()) store.notes = store.notes.filter((n) => n.id !== id); else note.text = text; await saveWorkNotes(app, settings, store); }
export async function deleteWorkNote(app: App, settings: FeuilletsSettings | null | undefined, id: string): Promise<void> { const store = await loadWorkNotes(app, settings); const before = store.notes.length; store.notes = store.notes.filter((n) => n.id !== id); if (store.notes.length !== before) await saveWorkNotes(app, settings, store); }

/** Même règle que les annotations : remapper un fichier ou tous les
 * descendants d'un dossier, et ne jamais réécrire un JSON illisible. */
export async function remapWorkNotesAfterRename(app: App, settings: FeuilletsSettings | null | undefined, oldVaultPath: string, newVaultPath: string): Promise<boolean> {
  const root = getProjectFolder(app, settings);
  if (!root || !oldVaultPath || !newVaultPath) return false;
  const oldPrefix = oldVaultPath === root.path ? "" : oldVaultPath.startsWith(`${root.path}/`) ? oldVaultPath.slice(root.path.length + 1) : null;
  const newPrefix = newVaultPath === root.path ? "" : newVaultPath.startsWith(`${root.path}/`) ? newVaultPath.slice(root.path.length + 1) : null;
  if (oldPrefix === null || newPrefix === null || oldPrefix === newPrefix) return false;
  const store = await loadWorkNotes(app, settings);
  let changed = false;
  for (const note of store.notes) {
    if (note.file !== oldPrefix && !note.file.startsWith(`${oldPrefix}/`)) continue;
    note.file = `${newPrefix}${note.file.slice(oldPrefix.length)}`;
    changed = true;
  }
  if (changed) await saveWorkNotes(app, settings, store);
  return changed;
}
