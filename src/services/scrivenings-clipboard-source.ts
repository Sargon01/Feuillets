import { TFolder, type App } from "obsidian";
import { resolveCompileScopeFiles, type CompileScope } from "./compile-scope.js";
import { resolvedFileTitleMarkdown } from "./compile-export.js";
import { effectiveComposition } from "./ouvrage-composition.js";
import { fmOf, shortTitleFor } from "./frontmatter.js";
import { FRONT_PAGE_TYPES, depthOf, getProjectFolder, isFrontMatter, roleOfFile, roleOfFolder } from "./folder-structure.js";
import { loadScriveningsDocument, type ScriveningsSegment } from "./scrivenings-document.js";
import {
  buildScriveningsClipboardText,
  type ScriveningsClipboardFolderTitles,
  type ScriveningsClipboardTitleResolver,
} from "./scrivenings-clipboard.js";

/**
 * Vault-aware side of the Scrivenings clipboard: the single place that binds
 * `buildScriveningsClipboardText` to Feuillets' title rules. Used by the
 * Continu copy (ScriveningsView) and by the Binder "Copy contents" action, so
 * both always produce the same text.
 */

export interface ScriveningsClipboardRules {
  titleFor: ScriveningsClipboardTitleResolver;
  folderTitlesFor: ScriveningsClipboardFolderTitles;
}

/** Rules shared by every Scrivenings copy, mirroring compile-export.ts:
 * - file titles: none for Front pages, else `resolvedFileTitleMarkdown` at the compile() level (scene →
 *   H4, otherwise depth + 1) with the Continu widget title as fallback;
 * - folder titles: same walk as compile() — a `partie` folder is titled and
 *   descended into, a `chapitre` folder is titled and stops there (deeper
 *   folders are flattened), the Front folder is never titled, the editorial
 *   root never is. Level = `depthOf(folder)` (= walk depth + 1), title = the
 *   folder name.
 * `scope` bounds folder titles like compile(): a folder scope titles the
 * folder itself and its descendants, never its ancestors. */
export function createScriveningsClipboardRules(
  app: App,
  settings: FeuilletsSettings,
  scope: CompileScope | null
): ScriveningsClipboardRules {
  const globalRoot = getProjectFolder(app, settings);
  const scopedRoot = scope ? app.vault.getAbstractFileByPath(scope.projectRoot) : null;
  const editorialRoot = scopedRoot instanceof TFolder ? scopedRoot : globalRoot;
  const level1Role = globalRoot && editorialRoot ? effectiveComposition(settings, globalRoot, editorialRoot).level1Role : undefined;
  const folderScopePath = scope?.type === "folder" ? scope.path : null;

  const titleFor: ScriveningsClipboardTitleResolver = (segment, selectedBody) => {
    const file = segment.file;
    /* Front pages (title page, dedication, epigraph) never get a generated
       title — same predicate as compile-export.ts (pushFile). */
    const frontType = fmOf(app, file).type;
    const normalizedFrontType = typeof frontType === "string" ? frontType.trim().toLowerCase() : "";
    if (isFrontMatter(app, settings, file, editorialRoot) && FRONT_PAGE_TYPES.includes(normalizedFrontType)) return null;
    const level = roleOfFile(app, settings, file, editorialRoot, level1Role) === "scene"
      ? 4
      : Math.max(1, depthOf(app, settings, file, editorialRoot));
    return resolvedFileTitleMarkdown(app, file, selectedBody, true, level, shortTitleFor(app, file) || file.basename);
  };

  /** Titled ancestor folders of a segment, outermost first. */
  const chainOf = (segment: ScriveningsSegment): TFolder[] => {
    if (!editorialRoot) return [];
    const prefix = `${editorialRoot.path}/`;
    if (!segment.path.startsWith(prefix)) return [];
    const ancestors: TFolder[] = [];
    for (let folder = segment.file.parent; folder && folder.path !== editorialRoot.path; folder = folder.parent) {
      ancestors.unshift(folder);
    }
    const chain: TFolder[] = [];
    for (const folder of ancestors) {
      if (isFrontMatter(app, settings, folder, editorialRoot)) break;
      if (folderScopePath && folder.path !== folderScopePath && !folder.path.startsWith(`${folderScopePath}/`)) continue;
      chain.push(folder);
      if (roleOfFolder(app, settings, folder, editorialRoot, level1Role) === "chapitre") break;
    }
    return chain;
  };

  const folderTitlesFor: ScriveningsClipboardFolderTitles = (segment, previous) => {
    const chain = chainOf(segment);
    const before = previous ? chainOf(previous) : [];
    let shared = 0;
    while (shared < chain.length && shared < before.length && chain[shared].path === before[shared].path) shared++;
    return chain.slice(shared).map((folder) => `${"#".repeat(Math.min(Math.max(1, depthOf(app, settings, folder, editorialRoot)), 6))} ${folder.name}`);
  };

  return { titleFor, folderTitlesFor };
}

/** Clipboard text for the composite range `[from, to)` of `doc`. */
export function buildScriveningsRangeClipboardText(
  app: App,
  settings: FeuilletsSettings,
  scope: CompileScope | null,
  doc: Parameters<typeof buildScriveningsClipboardText>[0],
  from: number,
  to: number
): string {
  const rules = createScriveningsClipboardRules(app, settings, scope);
  return buildScriveningsClipboardText(doc, from, to, rules.titleFor, rules.folderTitlesFor);
}

/** Text a Continu opened on `scope` would copy with select-all. The
 * composite document is built in memory only (read-only vault access, Binder
 * order from `resolveCompileScopeFiles`). Empty string when the scope has no
 * Markdown file. */
export async function buildScopeClipboardText(app: App, settings: FeuilletsSettings, scope: CompileScope): Promise<string> {
  const files = resolveCompileScopeFiles(app, settings, scope);
  if (!files.length) return "";
  const doc = await loadScriveningsDocument(app, files);
  return buildScriveningsRangeClipboardText(app, settings, scope, doc, 0, doc.text.length);
}
