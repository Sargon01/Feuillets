import { normalizePath, TFile, TFolder, type App, type TAbstractFile } from "obsidian";

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
 * de la racine globale, et inscrit dans ouvrageRoots. */
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
  const roots = settings.projectMeta?.[rootKey]?.ouvrageRoots;
  if (!roots) return false;

  return Boolean(roots[rel]);
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

/** Enregistre un dossier comme racine d'ouvrage sous la racine globale.
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
  if (!meta.ouvrageRoots) {
    meta.ouvrageRoots = {};
  }

  if (meta.ouvrageRoots[rel]) {
    return false;
  }

  meta.ouvrageRoots[rel] = { version: 1 };
  return true;
}

/** Désenregistre un dossier d'ouvrage.
 * Ne supprime que l'entrée exacte, conserve les ouvrages descendants,
 * et supprime la map ouvrageRoots si elle devient vide. */
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
  if (!meta || !meta.ouvrageRoots) return false;

  if (!(rel in meta.ouvrageRoots)) return false;

  delete meta.ouvrageRoots[rel];

  if (Object.keys(meta.ouvrageRoots).length === 0) {
    delete meta.ouvrageRoots;
  }

  return true;
}

/** Remappe les clés d'ouvrages après renommage ou déplacement d'un dossier.
 * Déplace la clé exacte et tous les ouvrages descendants.
 * Conserve l'entrée cible existante en cas de collision et ignore la clé déplacée.
 * Renvoie true uniquement si au moins une clé a été modifiée. */
export function remapOuvrageRoots(
  settings: FeuilletsSettings,
  projectRootPath: string,
  oldPath: string,
  newPath: string
): boolean {
  if (!settings || !projectRootPath || !oldPath || !newPath) return false;
  if (cleanPath(oldPath) === cleanPath(newPath)) return false;

  const rootKey = settings.projectMeta?.[projectRootPath]
    ? projectRootPath
    : cleanPath(projectRootPath);
  const meta = settings.projectMeta?.[rootKey];
  if (!meta || !meta.ouvrageRoots) return false;
  const roots = meta.ouvrageRoots;

  const oldRel = ouvrageRelativePath(projectRootPath, oldPath);
  if (!oldRel) return false;

  const newRel = ouvrageRelativePath(projectRootPath, newPath);
  if (!newRel) {
    let changed = false;
    for (const key of Object.keys(roots)) {
      if (key === oldRel || key.startsWith(`${oldRel}/`)) {
        delete roots[key];
        changed = true;
      }
    }
    if (changed && Object.keys(roots).length === 0) {
      delete meta.ouvrageRoots;
    }
    return changed;
  }

  const toMove: Array<{ from: string; to: string; config: OuvrageConfig }> = [];
  for (const key of Object.keys(roots)) {
    if (key === oldRel) {
      toMove.push({ from: key, to: newRel, config: roots[key] });
    } else if (key.startsWith(`${oldRel}/`)) {
      const suffix = key.slice(oldRel.length);
      toMove.push({ from: key, to: `${newRel}${suffix}`, config: roots[key] });
    }
  }

  if (toMove.length === 0) return false;

  let changed = false;
  for (const item of toMove) {
    if (item.to in roots) {
      // Collision : conserver strictement roots[item.to] et supprimer roots[item.from]
      delete roots[item.from];
      changed = true;
      continue;
    }
    roots[item.to] = item.config;
    delete roots[item.from];
    changed = true;
  }

  return changed;
}
