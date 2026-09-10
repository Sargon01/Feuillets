import { normalizePath, TFile, TFolder, type App, type TAbstractFile } from "obsidian";
import { isFolderWorkspaceConfigEmpty } from "./folder-workspaces.js";

function cleanPath(path: string): string {
  return normalizePath(path.trim()).replace(/\/+$/, "");
}

function getParentFolder(app: App, folder: TFolder): TFolder | null {
  if (folder.parent instanceof TFolder) return folder.parent;
  const clean = cleanPath(folder.path);
  const lastSlash = clean.lastIndexOf("/");
  if (lastSlash > 0) {
    const candidate = app.vault.getAbstractFileByPath(clean.slice(0, lastSlash));
    if (candidate instanceof TFolder) return candidate;
  }
  return null;
}

/** Calcule le chemin relatif d'un dossier sous la racine globale du projet.
 * Renvoie null si les chemins sont identiques, si le dossier est hors du projet,
 * ou si une valeur est vide. */
export function ouvrageRelativePath(projectRootPath: string, folderPath: string): string | null {
  if (!projectRootPath || !folderPath) return null;
  const root = cleanPath(projectRootPath);
  const folder = cleanPath(folderPath);
  if (!root || !folder || root === folder) return null;
  const prefix = `${root}/`;
  if (!folder.startsWith(prefix)) return null;
  const relative = folder.slice(prefix.length);
  return relative || null;
}

/** Vérifie si un dossier est une racine d'ouvrage enregistrée et existante.
 * Ne renvoie true que pour un dossier existant dans le coffre, descendant strict
 * de la racine globale, et portant folderWorkspaces[relatif].ouvrage. */
export function isOuvrageRoot(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  folder: TFolder
): boolean {
  if (!app || !settings || !projectRoot || !folder) return false;
  const rel = ouvrageRelativePath(projectRoot.path, folder.path);
  if (!rel) return false;

  const existing = app.vault.getAbstractFileByPath(cleanPath(folder.path));
  if (!(existing instanceof TFolder)) return false;

  const rootKey = settings.projectMeta?.[projectRoot.path]
    ? projectRoot.path
    : cleanPath(projectRoot.path);
  const config = settings.projectMeta?.[rootKey]?.folderWorkspaces?.[rel];
  return Boolean(config?.ouvrage);
}

/** Résout la racine éditoriale pour un nœud donné (fichier ou dossier).
 * Remonte depuis le nœud (son parent pour un fichier, lui-même pour un dossier)
 * et renvoie l'ouvrage enregistré le plus profond trouvé, ou la racine globale.
 * Ne crée ni dossier, ni réglage, ni métadonnée. */
export function resolveEditorialRoot(
  app: App,
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  node: TAbstractFile
): TFolder {
  if (!app || !settings || !projectRoot || !node) return projectRoot;

  let current: TFolder | null = null;
  if (node instanceof TFile) {
    if (node.parent instanceof TFolder) {
      current = node.parent;
    } else {
      const clean = cleanPath(node.path);
      const lastSlash = clean.lastIndexOf("/");
      if (lastSlash > 0) {
        const candidate = app.vault.getAbstractFileByPath(clean.slice(0, lastSlash));
        if (candidate instanceof TFolder) current = candidate;
      }
    }
  } else if (node instanceof TFolder) {
    current = node;
  }

  const rootPath = cleanPath(projectRoot.path);

  while (current) {
    const currentPath = cleanPath(current.path);
    if (currentPath === rootPath) {
      break;
    }
    if (isOuvrageRoot(app, settings, projectRoot, current)) {
      return current;
    }
    current = getParentFolder(app, current);
  }

  return projectRoot;
}

/** Enregistre un dossier comme racine d'ouvrage sous la racine globale, en
 * posant folderWorkspaces[relatif].ouvrage — crée l'entrée FolderWorkspaceConfig
 * si nécessaire, sans toucher aux autres réglages qu'elle porte déjà.
 * Idempotente : renvoie false si l'ouvrage est déjà enregistré. */
export function registerOuvrage(
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  folder: TFolder
): boolean {
  if (!settings || !projectRoot || !folder) return false;
  const rel = ouvrageRelativePath(projectRoot.path, folder.path);
  if (!rel) return false;

  if (!settings.projectMeta) {
    settings.projectMeta = {};
  }
  const rootKey = settings.projectMeta[projectRoot.path]
    ? projectRoot.path
    : cleanPath(projectRoot.path);
  if (!settings.projectMeta[rootKey]) {
    settings.projectMeta[rootKey] = {};
  }
  const meta = settings.projectMeta[rootKey];
  if (!meta.folderWorkspaces) {
    meta.folderWorkspaces = {};
  }
  if (!meta.folderWorkspaces[rel]) {
    meta.folderWorkspaces[rel] = { version: 1 };
  }
  const config = meta.folderWorkspaces[rel];

  if (config.ouvrage) {
    return false;
  }

  config.ouvrage = { version: 1 };
  return true;
}

/** Désenregistre un dossier d'ouvrage : supprime uniquement le champ
 * `ouvrage` de sa FolderWorkspaceConfig, en préservant tous les autres
 * réglages qu'elle porte (préréglage, objectifs, typographie…). L'entrée
 * folderWorkspaces[relatif] n'est retirée que si elle ne porte plus aucun
 * réglage ; la map folderWorkspaces elle-même n'est retirée que si elle
 * devient vide. Les ouvrages descendants (ex. NEFES/Volume annexe) ne sont
 * jamais affectés par le désenregistrement d'un ancêtre. */
export function unregisterOuvrage(
  settings: FeuilletsSettings,
  projectRoot: TFolder,
  folder: TFolder
): boolean {
  if (!settings || !projectRoot || !folder) return false;
  const rel = ouvrageRelativePath(projectRoot.path, folder.path);
  if (!rel) return false;

  const rootKey = settings.projectMeta?.[projectRoot.path]
    ? projectRoot.path
    : cleanPath(projectRoot.path);
  const meta = settings.projectMeta?.[rootKey];
  const workspaces = meta?.folderWorkspaces;
  const config = workspaces?.[rel];
  if (!meta || !workspaces || !config?.ouvrage) return false;

  delete config.ouvrage;

  if (isFolderWorkspaceConfigEmpty(config)) {
    delete workspaces[rel];
    if (Object.keys(workspaces).length === 0) {
      delete meta.folderWorkspaces;
    }
  }

  return true;
}
