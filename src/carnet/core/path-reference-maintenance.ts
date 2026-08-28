import { folderPathToRelativeScope, relativeScopeToFolderPath } from "./folder-carnets.js";

export function remapPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  return path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path;
}

/** Compatibility helper kept as a public pure import for existing callers. */
export function remapResearchFolderLinks(links: Record<string, string> | undefined, oldPath: string, newPath: string): Record<string, string> | undefined {
  if (!links) return links;
  const result: Record<string, string> = {}; let changed = false;
  for (const [key, value] of Object.entries(links)) { const nextKey = remapPath(key, oldPath, newPath); const nextValue = remapPath(value, oldPath, newPath); result[nextKey] = nextValue; if (nextKey !== key || nextValue !== value) changed = true; }
  return changed ? result : links;
}

type Conflict = { kind: string; from: string; to: string };
const remapValue = (value: string | undefined, oldPath: string, newPath: string): string | undefined => value === undefined ? value : remapPath(value, oldPath, newPath);
const rekey = <T>(input: Record<string, T> | undefined, oldPath: string, newPath: string, kind: string, conflicts: Conflict[]): [Record<string, T> | undefined, boolean] => {
  if (!input) return [input, false]; const output: Record<string, T> = {}; let changed = false;
  for (const [key, value] of Object.entries(input)) { const target = remapPath(key, oldPath, newPath); if (target !== key) changed = true; if (target in output && target !== key) { conflicts.push({ kind, from: key, to: target }); output[key] = value; } else output[target] = value; }
  return [changed ? output : input, changed];
};
function remapStringMap(input: Record<string, string> | undefined, oldPath: string, newPath: string, kind: string, conflicts: Conflict[]): [Record<string, string> | undefined, boolean] {
  const [keys, changedKeys] = rekey(input, oldPath, newPath, kind, conflicts); if (!keys) return [keys, changedKeys]; let changed = changedKeys; const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(keys)) { const next = remapPath(value, oldPath, newPath); if (next !== value) changed = true; output[key] = next; }
  return [changed ? output : input, changed];
}
function remapFolderCarnets(meta: ProjectMeta, oldProjectRoot: string, newProjectRoot: string, oldPath: string, newPath: string): boolean {
  if (!meta.folderCarnets) return false; const next: Record<string, import("./folder-carnets.js").FolderCarnetRegistration> = {}; let changed = false;
  for (const [relative, registration] of Object.entries(meta.folderCarnets)) {
    const absolute = relativeScopeToFolderPath(oldProjectRoot, relative); const remapped = absolute ? remapPath(absolute, oldPath, newPath) : null;
    const target = remapped ? folderPathToRelativeScope(newProjectRoot, remapped) : null;
    if (target && !(target in next)) { next[target] = registration; if (target !== relative) changed = true; } else next[relative] = registration;
  }
  if (changed) meta.folderCarnets = next; return changed;
}
export function remapFeuilletsPathReferences(settings: FeuilletsSettings, oldPath: string, newPath: string): { changed: boolean; conflicts: Conflict[] } {
  const conflicts: Conflict[] = []; let changed = false;
  if (settings.projectFolder) { const next = remapPath(settings.projectFolder, oldPath, newPath); if (next !== settings.projectFolder) { settings.projectFolder = next; changed = true; } }
  if (settings.projects) { const mapped = settings.projects.map((p) => remapPath(p, oldPath, newPath)); const deduped = mapped.filter((p, i) => mapped.indexOf(p) === i); if (deduped.some((p, i) => p !== settings.projects[i]) || deduped.length !== settings.projects.length) { settings.projects = deduped; changed = true; } }
  const oldMeta = settings.projectMeta ?? {}; const nextMeta: Record<string, ProjectMeta> = {};
  for (const [key, meta] of Object.entries(oldMeta)) {
    const target = remapPath(key, oldPath, newPath); if (target in nextMeta && target !== key) { conflicts.push({ kind: "projectMeta", from: key, to: target }); nextMeta[key] = meta; continue; }
    nextMeta[target] = meta; if (target !== key) changed = true;
    const [links, linksChanged] = remapStringMap(meta.researchFolderLinks, oldPath, newPath, "researchFolderLinks", conflicts); if (linksChanged) { meta.researchFolderLinks = links; changed = true; }
    for (const keyName of ["placeholders", "origins"] as const) { const values = meta.narrativeState?.[keyName]; if (values) for (const valueKey of Object.keys(values)) { const value = values[valueKey]; const next = remapPath(value, oldPath, newPath); if (next !== value) { values[valueKey] = next; changed = true; } } }
    if (remapFolderCarnets(meta, key, target, oldPath, newPath)) changed = true;
  }
  if (changed) settings.projectMeta = nextMeta;
  for (const field of ["folderPositions", "folderGoals"] as const) { const [next, did] = rekey(settings[field], oldPath, newPath, field, conflicts); if (did && next) { settings[field] = next; changed = true; } }
  if (settings.orders) {
    const [nextOrders, did] = rekey(settings.orders, oldPath, newPath, "orders", conflicts); if (did && nextOrders) { settings.orders = nextOrders; changed = true; }
    const oldParent = oldPath.slice(0, oldPath.lastIndexOf("/")); const newParent = newPath.slice(0, newPath.lastIndexOf("/")); const oldName = oldPath.slice(oldPath.lastIndexOf("/") + 1); const newName = newPath.slice(newPath.lastIndexOf("/") + 1);
    if (oldParent === newParent && settings.orders[oldParent]) { const list = settings.orders[oldParent]; const i = list.indexOf(oldName); if (i >= 0) { list[i] = newName; changed = true; } }
    if (oldParent !== newParent) { const source = settings.orders[oldParent]; if (source) { const i = source.indexOf(oldName); if (i >= 0) { source.splice(i, 1); changed = true; } } const destination = settings.orders[newParent]; if (destination && !destination.includes(newName)) { destination.push(newName); changed = true; } }
  }
  if (settings.collapsed) { const out: Record<string, boolean> = {}; for (const [key, value] of Object.entries(settings.collapsed)) { let target = key; if (key.startsWith("binder:vault:")) target = `binder:vault:${remapPath(key.slice(13), oldPath, newPath)}`; else if (!key.includes(":")) target = remapPath(key, oldPath, newPath); if (target !== key) changed = true; out[target] = value; } if (changed) settings.collapsed = out; }
  { const next = remapValue(settings.binderSelectedPath, oldPath, newPath); if (next !== settings.binderSelectedPath && next !== undefined) { settings.binderSelectedPath = next; changed = true; } }
  for (const entries of [settings.filPlaceholders, settings.filOrigins]) { if (entries) for (const key of Object.keys(entries)) { const value = entries[key]; const next = remapPath(value, oldPath, newPath); if (next !== value) { entries[key] = next; changed = true; } } }
  if (settings.notesPinned) {
    const source = settings.notesPinned as unknown as Record<string, string[]>;
    const output: Record<string, string[]> = {}; let pinnedChanged = false;
    for (const [key, values] of Object.entries(source)) { const target = remapPath(key, oldPath, newPath); const mapped = values.map((value) => remapPath(value, oldPath, newPath)); if (target !== key || mapped.some((value, index) => value !== values[index])) pinnedChanged = true; if (target in output && target !== key) { conflicts.push({ kind: "notesPinned", from: key, to: target }); output[key] = mapped; } else output[target] = mapped; }
    if (pinnedChanged) { settings.notesPinned = output; changed = true; }
  }
  return { changed, conflicts };
}
