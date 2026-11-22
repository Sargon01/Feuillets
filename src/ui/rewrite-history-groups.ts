import { TFile, TFolder, type App } from "obsidian";
import type { RewriteEntry } from "../services/rewrite-history-store.js";
import { getOrderedChildren } from "../services/folder-structure.js";

export interface RewriteHistoryGroup {
  key: string;
  path: string | null;
  file: TFile | null;
  entries: RewriteEntry[];
  latestAt: number;
}

/** Group metadata by identity, then follow only Binder branches containing
 * history. Missing/deleted sheets remain accessible after the current Binder. */
export function rewriteHistoryGroups(
  app: App, settings: FeuilletsSettings, root: TFolder,
  entries: readonly RewriteEntry[], currentPath: (entry: RewriteEntry) => string | null,
): RewriteHistoryGroup[] {
  const groups = new Map<string, RewriteHistoryGroup>();
  for (const entry of entries) {
    const key = `journal:rewrite-sheet:${entry.projectId}:${entry.sheetId}`;
    let group = groups.get(key);
    if (!group) {
      const path = currentPath(entry);
      const file = path ? app.vault.getAbstractFileByPath(path) : null;
      group = { key, path, file: file instanceof TFile ? file : null, entries: [], latestAt: entry.endedAt };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.latestAt = Math.max(group.latestAt, entry.endedAt);
  }
  const byPath = new Map<string, RewriteHistoryGroup[]>();
  const branches = new Set<TFolder>();
  for (const group of groups.values()) {
    group.entries.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
    if (!group.file) continue;
    const matches = byPath.get(group.file.path) ?? [];
    matches.push(group);
    byPath.set(group.file.path, matches);
    let parent = group.file.parent;
    while (parent && (parent.path === root.path || parent.path.startsWith(`${root.path}/`))) {
      // Shared ancestors were already traversed by another sheet.
      if (branches.has(parent)) break;
      branches.add(parent);
      if (parent === root) break;
      parent = parent.parent;
    }
  }
  const ordered: RewriteHistoryGroup[] = [];
  const visit = (folder: TFolder): void => {
    for (const child of getOrderedChildren(app, settings, folder)) {
      if (child instanceof TFolder) { if (branches.has(child)) visit(child); }
      else for (const group of byPath.get(child.path) ?? []) {
        ordered.push(group);
        groups.delete(group.key);
      }
    }
  };
  if (branches.has(root)) visit(root);
  return ordered.concat([...groups.values()].sort((a, b) => b.latestAt - a.latestAt || a.key.localeCompare(b.key)));
}
