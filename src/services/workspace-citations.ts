import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { getResearchRootForProject } from "./research.js";
import {
  folderWorkspaceScopeChain,
  getFolderWorkspaceConfig,
  workspaceScopeToFolderPath,
} from "./folder-workspaces.js";

export type WorkspaceCitationResourceSource =
  | "workspace"
  | "ancestor"
  | "project"
  | "legacy"
  | "none";

export type WorkspaceCitationResourceStatus =
  | "valid"
  | "missing_file"
  | "unbound_research"
  | "invalid_path"
  | "disabled"
  | "not_configured";

export type ResolvedWorkspaceCitationResource = {
  configuredPath: string | null;
  relativePath: string | null;
  status: WorkspaceCitationResourceStatus;
  source: WorkspaceCitationResourceSource;
  sourceScope: TFolder | null;
  researchFolder: TFolder | null;
  file: TFile | null;
};

export type WorkspaceCitationResourcesResolution = {
  selectionResearchFolder: TFolder | null;
  bibliography: ResolvedWorkspaceCitationResource;
  csl: ResolvedWorkspaceCitationResource;
};

export type WorkspaceCitationResourceResolution = WorkspaceCitationResourcesResolution;

export type WorkspaceCitationCandidate = {
  file: TFile;
  relativePath: string;
};

/**
 * Validates a citation-relative path before normalization.
 * Formally rejects:
 * - Empty strings
 * - Leading / or \
 * - Backslashes anywhere
 * - URI schemes or Windows drive prefixes (':')
 * - Empty segments (e.g. '//')
 * - '.' or '..' segments
 * - Control characters
 */
export function isValidCitationRelativePath(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== "string") return false;
  if (rawPath.startsWith("/") || rawPath.startsWith("\\")) return false;
  if (rawPath.includes("\\")) return false;
  if (rawPath.includes(":")) return false;

  for (let i = 0; i < rawPath.length; i++) {
    const code = rawPath.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }

  const segments = rawPath.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return false;
    }
  }

  const normalized = normalizePath(rawPath);
  if (normalized.startsWith("/")) {
    return false;
  }

  return true;
}

/**
 * Returns the normalized path of a file relative to a research folder,
 * enforcing a strict segment boundary. Returns null if external or invalid.
 */
export function citationRelativePath(
  researchFolder: TFolder,
  file: TFile,
): string | null {
  const researchPath = normalizePath(researchFolder.path);
  const filePath = normalizePath(file.path);
  const prefix = `${researchPath}/`;
  if (!filePath.startsWith(prefix)) return null;

  const rel = filePath.slice(prefix.length);
  if (!isValidCitationRelativePath(rel)) return null;
  return rel;
}

/**
 * Recursively lists citation candidates (.bib or .csl) inside a research folder.
 * Produces deterministic alphabetical sort by relativePath.
 */
export function listWorkspaceCitationCandidates(
  app: App,
  researchFolder: TFolder | null,
  extension: "bib" | "csl",
): WorkspaceCitationCandidate[] {
  if (!researchFolder) return [];

  const rootFolder = researchFolder;
  const candidates: WorkspaceCitationCandidate[] = [];
  const targetExt = extension.toLowerCase();

  function walk(folder: TFolder): void {
    for (const child of folder.children) {
      if (child instanceof TFile) {
        if (child.extension.toLowerCase() === targetExt) {
          const rel = citationRelativePath(rootFolder, child);
          if (rel !== null) {
            candidates.push({ file: child, relativePath: rel });
          }
        }
      } else if (child instanceof TFolder) {
        walk(child);
      }
    }
  }

  walk(rootFolder);
  candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return candidates;
}

/**
 * Resolves the effective research folder for a project or workspace folder.
 * In association-based mode (researchFolderLinks has >= 1 key):
 * - Traverses ancestors from workspaceFolder up to projectRoot.
 * - Nearest valid association wins.
 * - Stale/orphan associations (pointing to non-existent folder) are skipped,
 *   continuing to ancestors.
 * - Never implicitly falls back to common canonical Research container.
 * In legacy mode (researchFolderLinks absent or empty):
 * - Uses getResearchRootForProject.
 */
export function resolveWorkspaceCitationResearchFolder(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  targetScope: TFolder | TFile | null,
): TFolder | null {
  const configuredLinks = settings.projectMeta?.[projectRoot.path]?.researchFolderLinks;
  const isAssociationBased =
    configuredLinks != null &&
    typeof configuredLinks === "object" &&
    Object.keys(configuredLinks).length > 0;

  if (isAssociationBased) {
    if (targetScope === null || targetScope.path === projectRoot.path) {
      const explicit = configuredLinks[projectRoot.path];
      if (explicit) {
        const folder = app.vault.getAbstractFileByPath(normalizePath(explicit));
        if (folder instanceof TFolder) return folder;
      }
      return null;
    }

    const rootPath = normalizePath(projectRoot.path);
    const targetPath = normalizePath(targetScope.path);
    const prefix = `${rootPath}/`;
    if (!targetPath.startsWith(prefix)) return null;

    // Direct-file association lookup explicitly before physical folder ancestors
    if (targetScope instanceof TFile) {
      if (targetPath in configuredLinks) {
        const link = configuredLinks[targetPath];
        if (link) {
          const folder = app.vault.getAbstractFileByPath(normalizePath(link));
          if (folder instanceof TFolder) return folder;
        }
        // Stale/orphan link: target folder does not exist on disk.
        // Ignore orphan link and continue checking physical folder ancestors.
      }
    }

    // Physical folder ancestors traversal up to projectRoot
    const folderPath = targetScope instanceof TFile
      ? (targetScope.parent ? normalizePath(targetScope.parent.path) : null)
      : targetPath;

    if (folderPath && folderPath.startsWith(prefix)) {
      const rel = folderPath.slice(prefix.length);
      const parts = rel.split("/");
      for (let end = parts.length; end > 0; end -= 1) {
        const candidatePath = normalizePath(`${rootPath}/${parts.slice(0, end).join("/")}`);
        if (candidatePath in configuredLinks) {
          const link = configuredLinks[candidatePath];
          if (link) {
            const folder = app.vault.getAbstractFileByPath(normalizePath(link));
            if (folder instanceof TFolder) return folder;
          }
          // Stale/orphan link: target folder does not exist on disk.
          // Ignore orphan link and continue checking ancestors.
        }
      }
    }

    if (projectRoot.path in configuredLinks) {
      const projectExplicit = configuredLinks[projectRoot.path];
      if (projectExplicit) {
        const folder = app.vault.getAbstractFileByPath(normalizePath(projectExplicit));
        if (folder instanceof TFolder) return folder;
      }
    }

    return null;
  }

  return getResearchRootForProject(app, settings, projectRoot);
}

/**
 * Resolves the associated Research folder for a specific configuration scope folder.
 * If the scope folder has an explicit key in researchFolderLinks:
 * - Returns the folder if valid.
 * - Returns null if the link target is missing (orphan on this scope).
 * If the scope folder has no explicit key:
 * - Inherits association from nearest ancestor with a valid association.
 */
function getScopeAssociatedResearchFolder(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  scopeFolder: TFolder,
): TFolder | null {
  const configuredLinks = settings.projectMeta?.[projectRoot.path]?.researchFolderLinks;
  const isAssociationBased =
    configuredLinks != null &&
    typeof configuredLinks === "object" &&
    Object.keys(configuredLinks).length > 0;

  if (isAssociationBased) {
    if (scopeFolder.path in configuredLinks) {
      const explicit = configuredLinks[scopeFolder.path];
      if (explicit) {
        const folder = app.vault.getAbstractFileByPath(normalizePath(explicit));
        if (folder instanceof TFolder) return folder;
      }
      return null;
    }

    return resolveWorkspaceCitationResearchFolder(app, settings, projectRoot, scopeFolder);
  }

  return getResearchRootForProject(app, settings, projectRoot);
}

/**
 * Resolves workspace citation resources (.bib and .csl) independently,
 * returning distinct research folders for each resource if defined at different levels.
 * Full hierarchical lookup: workspace folder -> parent workspaces -> project root.
 */
export function resolveWorkspaceCitationResources(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  targetScope: TFolder | TFile | null,
): WorkspaceCitationResourcesResolution {
  const selectionResearchFolder = resolveWorkspaceCitationResearchFolder(
    app,
    settings,
    projectRoot,
    targetScope,
  );

  const meta = settings.projectMeta?.[projectRoot.path];
  const configuredLinks = meta?.researchFolderLinks;
  const isAssociationBased =
    configuredLinks != null &&
    typeof configuredLinks === "object" &&
    Object.keys(configuredLinks).length > 0;
  const isLegacyMode = !isAssociationBased;

  type ScopeEntry = {
    folder: TFolder;
    relativeScope: string | null;
    isWorkspace: boolean;
    isAncestor: boolean;
    isProject: boolean;
  };

  const scopes: ScopeEntry[] = [];
  const targetFolder = targetScope instanceof TFile ? targetScope.parent ?? null : targetScope;
  const isWorkspace = targetFolder !== null && targetFolder.path !== projectRoot.path;

  if (isWorkspace) {
    const chain = folderWorkspaceScopeChain(projectRoot.path, targetFolder.path);
    const exactScope = chain[0] || null;

    for (const relScope of chain) {
      const folderPath = workspaceScopeToFolderPath(projectRoot.path, relScope);
      const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
      if (folder instanceof TFolder) {
        scopes.push({
          folder,
          relativeScope: relScope,
          isWorkspace: relScope === exactScope && !(targetScope instanceof TFile),
          isAncestor: relScope !== exactScope || (targetScope instanceof TFile),
          isProject: false,
        });
      }
    }
  }

  // Project root is always the final scope on the chain
  scopes.push({
    folder: projectRoot,
    relativeScope: null,
    isWorkspace: false,
    isAncestor: false,
    isProject: true,
  });

  function resolveResource(
    key: "citekeyBibliographyPath" | "citekeyCslPath",
    expectedExt: "bib" | "csl",
  ): ResolvedWorkspaceCitationResource {
    for (const entry of scopes) {
      let rawValue: string | undefined;

      if (entry.relativeScope !== null) {
        const config = getFolderWorkspaceConfig(meta, entry.relativeScope);
        rawValue = config ? config[key] : undefined;
      } else {
        rawValue = meta ? meta[key] : undefined;
      }

      // A. Property is undefined -> not configured at this level, continue to next scope
      if (rawValue === undefined) {
        continue;
      }

      // B. Property is exactly "" -> explicit disablement, stop resolution
      if (rawValue === "") {
        return {
          configuredPath: "",
          relativePath: null,
          status: "disabled",
          source: "none",
          sourceScope: entry.folder,
          researchFolder: null,
          file: null,
        };
      }

      // C. Property is a non-empty string
      let source: WorkspaceCitationResourceSource;
      if (entry.isWorkspace) {
        source = "workspace";
      } else if (entry.isAncestor) {
        source = "ancestor";
      } else {
        source = isLegacyMode ? "legacy" : "project";
      }

      const scopeResearch = getScopeAssociatedResearchFolder(
        app,
        settings,
        projectRoot,
        entry.folder,
      );

      const hasExplicitOrphanLink = (folderPath: string): boolean => {
        if (!isAssociationBased || !configuredLinks) return false;
        if (!(folderPath in configuredLinks)) return false;
        const link = configuredLinks[folderPath];
        if (!link) return true;
        const target = app.vault.getAbstractFileByPath(normalizePath(link));
        return !(target instanceof TFolder);
      };

      let ownerResearch: TFolder | null = null;
      if (hasExplicitOrphanLink(entry.folder.path)) {
        ownerResearch = null;
      } else if (scopeResearch) {
        ownerResearch = scopeResearch;
      } else if (
        entry.folder.path === projectRoot.path &&
        configuredLinks &&
        !hasExplicitOrphanLink(projectRoot.path) &&
        !(projectRoot.path in configuredLinks) &&
        !(targetScope && hasExplicitOrphanLink(targetScope.path))
      ) {
        ownerResearch = selectionResearchFolder;
      }

      if (!ownerResearch) {
        return {
          configuredPath: rawValue,
          relativePath: null,
          status: "unbound_research",
          source,
          sourceScope: entry.folder,
          researchFolder: null,
          file: null,
        };
      }

      if (typeof rawValue !== "string" || !isValidCitationRelativePath(rawValue)) {
        return {
          configuredPath: typeof rawValue === "string" ? rawValue : null,
          relativePath: null,
          status: "invalid_path",
          source,
          sourceScope: entry.folder,
          researchFolder: ownerResearch,
          file: null,
        };
      }

      const norm = normalizePath(rawValue);
      const targetPath = normalizePath(`${ownerResearch.path}/${norm}`);
      const expectedPrefix = `${normalizePath(ownerResearch.path)}/`;
      if (!targetPath.startsWith(expectedPrefix)) {
        return {
          configuredPath: rawValue,
          relativePath: null,
          status: "invalid_path",
          source,
          sourceScope: entry.folder,
          researchFolder: ownerResearch,
          file: null,
        };
      }

      const candidate = app.vault.getAbstractFileByPath(targetPath);
      if (candidate instanceof TFile && candidate.extension.toLowerCase() === expectedExt) {
        return {
          configuredPath: rawValue,
          relativePath: norm,
          status: "valid",
          source,
          sourceScope: entry.folder,
          researchFolder: ownerResearch,
          file: candidate,
        };
      }

      return {
        configuredPath: rawValue,
        relativePath: norm,
        status: "missing_file",
        source,
        sourceScope: entry.folder,
        researchFolder: ownerResearch,
        file: null,
      };
    }

    // Historical legacy fallback only for bibliography when citekeyBibliographyPath is not set on project
    if (key === "citekeyBibliographyPath" && meta?.pandocBibliographyPath) {
      const rawLegacy = meta.pandocBibliographyPath.trim();
      if (rawLegacy !== "") {
        let ownerResearch: TFolder | null = null;
        let source: WorkspaceCitationResourceSource;

        if (isAssociationBased) {
          source = "project";
          const explicit = configuredLinks[projectRoot.path];
          if (explicit) {
            const folder = app.vault.getAbstractFileByPath(normalizePath(explicit));
            if (folder instanceof TFolder) {
              ownerResearch = folder;
            }
          }
        } else {
          source = "legacy";
          ownerResearch = getResearchRootForProject(app, settings, projectRoot);
        }

        if (!ownerResearch) {
          return {
            configuredPath: rawLegacy,
            relativePath: null,
            status: "unbound_research",
            source,
            sourceScope: projectRoot,
            researchFolder: null,
            file: null,
          };
        }

        if (!isValidCitationRelativePath(rawLegacy)) {
          return {
            configuredPath: rawLegacy,
            relativePath: null,
            status: "invalid_path",
            source,
            sourceScope: projectRoot,
            researchFolder: ownerResearch,
            file: null,
          };
        }

        let file: TFile | null = null;
        let rel: string | null = null;

        const targetPath = normalizePath(`${ownerResearch.path}/${normalizePath(rawLegacy)}`);
        const candidate = app.vault.getAbstractFileByPath(targetPath);
        if (candidate instanceof TFile && candidate.extension.toLowerCase() === "bib") {
          file = candidate;
          rel = normalizePath(rawLegacy);
        }

        if (!file) {
          const candidate = app.vault.getAbstractFileByPath(normalizePath(rawLegacy));
          if (candidate instanceof TFile && candidate.extension.toLowerCase() === "bib") {
            const relCandidate = citationRelativePath(ownerResearch, candidate);
            if (relCandidate !== null) {
              file = candidate;
              rel = relCandidate;
            }
          }
        }

        if (file && rel) {
          return {
            configuredPath: rawLegacy,
            relativePath: rel,
            status: "valid",
            source,
            sourceScope: projectRoot,
            researchFolder: ownerResearch,
            file,
          };
        }

        return {
          configuredPath: rawLegacy,
          relativePath: normalizePath(rawLegacy),
          status: "missing_file",
          source,
          sourceScope: projectRoot,
          researchFolder: ownerResearch,
          file: null,
        };
      }
    }

    // Not configured anywhere
    return {
      configuredPath: null,
      relativePath: null,
      status: "not_configured",
      source: "none",
      sourceScope: null,
      researchFolder: null,
      file: null,
    };
  }

  const bibliography = resolveResource("citekeyBibliographyPath", "bib");
  const csl = resolveResource("citekeyCslPath", "csl");

  return {
    selectionResearchFolder,
    bibliography,
    csl,
  };
}

/**
 * Remaps relative citation resource paths when files or folders are renamed/moved.
 * Preserves relative paths when the research root itself is renamed.
 * Keeps orphan selections without re-attaching when moved outside the owner research.
 */
export function remapWorkspaceCitationResourcePaths(
  app: App,
  settings: FeuilletsSettings,
  oldPath: string,
  newPath: string,
): boolean {
  if (!oldPath || !newPath || oldPath === newPath) return false;
  let changed = false;
  const projectMeta = settings.projectMeta;
  if (!projectMeta) return false;

  const normOld = normalizePath(oldPath);
  const normNew = normalizePath(newPath);

  for (const [projectPath, meta] of Object.entries(projectMeta)) {
    if (!meta) continue;
    const projectFolder = app.vault.getAbstractFileByPath(projectPath);
    if (!(projectFolder instanceof TFolder)) continue;

    const remapField = (
      ownerResearch: TFolder | null,
      currentRel: string | undefined,
    ): string | undefined => {
      if (!ownerResearch || !currentRel) return undefined;
      const researchPath = normalizePath(ownerResearch.path);
      const prefix = `${researchPath}/`;

      if (normOld.startsWith(prefix)) {
        const oldRel = normOld.slice(prefix.length);
        if (currentRel === oldRel || currentRel.startsWith(`${oldRel}/`)) {
          if (normNew.startsWith(prefix)) {
            const newRel = normNew.slice(prefix.length);
            const updated = currentRel === oldRel
              ? newRel
              : `${newRel}${currentRel.slice(oldRel.length)}`;
            return updated;
          }
        }
      }
      return undefined;
    };

    // 1. Remap project-level citations
    const projectResearch = resolveWorkspaceCitationResearchFolder(
      app,
      settings,
      projectFolder,
      null,
    );

    if (meta.citekeyBibliographyPath) {
      const next = remapField(projectResearch, meta.citekeyBibliographyPath);
      if (next !== undefined && next !== meta.citekeyBibliographyPath) {
        meta.citekeyBibliographyPath = next;
        changed = true;
      }
    }
    if (meta.citekeyCslPath) {
      const next = remapField(projectResearch, meta.citekeyCslPath);
      if (next !== undefined && next !== meta.citekeyCslPath) {
        meta.citekeyCslPath = next;
        changed = true;
      }
    }

    // 2. Remap workspace-level citations
    if (meta.folderWorkspaces) {
      for (const [scope, wsConfig] of Object.entries(meta.folderWorkspaces)) {
        if (!wsConfig) continue;
        const scopeFolderPath = workspaceScopeToFolderPath(projectPath, scope);
        const scopeFolder = scopeFolderPath
          ? app.vault.getAbstractFileByPath(scopeFolderPath)
          : null;
        if (!(scopeFolder instanceof TFolder)) continue;

        const wsResearch = resolveWorkspaceCitationResearchFolder(
          app,
          settings,
          projectFolder,
          scopeFolder,
        );

        if (wsConfig.citekeyBibliographyPath) {
          const next = remapField(wsResearch, wsConfig.citekeyBibliographyPath);
          if (next !== undefined && next !== wsConfig.citekeyBibliographyPath) {
            wsConfig.citekeyBibliographyPath = next;
            changed = true;
          }
        }
        if (wsConfig.citekeyCslPath) {
          const next = remapField(wsResearch, wsConfig.citekeyCslPath);
          if (next !== undefined && next !== wsConfig.citekeyCslPath) {
            wsConfig.citekeyCslPath = next;
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}
