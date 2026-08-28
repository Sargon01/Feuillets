import { normalizePath, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";
import { FEUILLETS_RESOURCE_FOLDERS, feuilletsAuxiliaryPath } from "../../services/folder-structure.js";
import { ensureFolder } from "../../services/project-files.js";

export type FolderCarnetRegistration = { id: string; version: 1 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validRelative = (scope: string): boolean => !!scope && !scope.startsWith("/") && !scope.split("/").includes("..") && normalizePath(scope) === scope;
export function folderPathToRelativeScope(projectRoot: string, folder: string): string | null {
  const root = normalizePath(projectRoot); const path = normalizePath(folder);
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}
export function relativeScopeToFolderPath(projectRoot: string, relative: string): string | null {
  if (!validRelative(relative)) return null;
  const root = normalizePath(projectRoot); const path = normalizePath(`${root}/${relative}`);
  return path.startsWith(`${root}/`) ? path : null;
}
function validRegistration(value: unknown): value is FolderCarnetRegistration { return !!value && typeof value === "object" && (value as { version?: unknown }).version === 1 && typeof (value as { id?: unknown }).id === "string" && UUID.test((value as { id: string }).id); }
export function getFolderCarnetRegistration(meta: ProjectMeta | undefined, relative: string): FolderCarnetRegistration | null { const candidate = meta?.folderCarnets?.[relative]; return validRelative(relative) && validRegistration(candidate) ? candidate : null; }
export function hasFolderCarnetRegistration(meta: ProjectMeta | undefined, relative: string): boolean { return getFolderCarnetRegistration(meta, relative) !== null; }
export function folderCarnetCanvasPath(manuscriptRoot: TFolder, id: string): string | null { if (!UUID.test(id)) return null; return normalizePath(`${feuilletsAuxiliaryPath(manuscriptRoot, "resources")}/${FEUILLETS_RESOURCE_FOLDERS.assets}/Carnets/${id}.canvas`); }
export async function createFolderCarnet(app: App, manuscriptRoot: TFolder, meta: ProjectMeta, projectRootPath: string, folder: TFolder): Promise<{ registration: FolderCarnetRegistration; file: TFile } | null> {
  const relative = folderPathToRelativeScope(projectRootPath, folder.path); if (!relative) return null;
  const existing = getFolderCarnetRegistration(meta, relative); if (existing) return null;
  const registration: FolderCarnetRegistration = { id: crypto.randomUUID(), version: 1 };
  const path = folderCarnetCanvasPath(manuscriptRoot, registration.id); if (!path) return null;
  await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
  const existingFile = app.vault.getAbstractFileByPath(path);
  const file = existingFile instanceof TFile ? existingFile : await app.vault.create(path, "{\n\t\"nodes\": [],\n\t\"edges\": []\n}");
  if (!meta.folderCarnets) meta.folderCarnets = {};
  meta.folderCarnets[relative] = registration;
  return { registration, file };
}
export function resolveFolderCarnet(app: Pick<App, "vault">, manuscriptRoot: TFolder, meta: ProjectMeta | undefined, projectRootPath: string, folder: TFolder): TFile | null {
  const relative = folderPathToRelativeScope(projectRootPath, folder.path); if (!relative) return null;
  const registration = getFolderCarnetRegistration(meta, relative); const path = registration && folderCarnetCanvasPath(manuscriptRoot, registration.id);
  const file = path ? app.vault.getAbstractFileByPath(path) : null; return file instanceof TFile ? file : null;
}
export function isFolderCarnetCanvasFile(manuscriptRoot: TFolder, meta: ProjectMeta | undefined, file: TFile | null | undefined): boolean { if (!file || !meta?.folderCarnets) return false; return Object.values(meta.folderCarnets).some((reg) => validRegistration(reg) && folderCarnetCanvasPath(manuscriptRoot, reg.id) === file.path); }

/** Correctif « suppression/recréation d'un Carnet de dossier » : quand le
 * fichier `<uuid>.canvas` d'une registration est supprimé (jamais le
 * dossier propriétaire — voir vault.on("delete") dans main.ts, qui ne
 * transmet ici QUE des suppressions de fichier), retire TOUTES les clés de
 * `meta.folderCarnets` dont le chemin calculé correspond exactement à
 * `filePath` — un même UUID legacy dupliqué sous plusieurs clés (Binder ET
 * Recherche) est ainsi nettoyé d'un coup, jamais une seule des deux. Une
 * registration dont l'UUID pointe vers un AUTRE fichier (encore présent)
 * n'est jamais touchée. Mute `meta.folderCarnets` en place ; retourne les
 * clés retirées (pour les tests/logs) — jamais de saveSettings ici,
 * toujours à la charge de l'appelant. */
export function removeFolderCarnetRegistrationsForDeletedFile(meta: ProjectMeta, manuscriptRoot: TFolder, filePath: string): string[] {
  const registrations = meta.folderCarnets;
  if (!registrations) return [];
  const path = normalizePath(filePath);
  const removed: string[] = [];
  for (const relative of Object.keys(registrations)) {
    const registration = getFolderCarnetRegistration(meta, relative);
    if (!registration) continue;
    if (folderCarnetCanvasPath(manuscriptRoot, registration.id) === path) removed.push(relative);
  }
  for (const relative of removed) delete registrations[relative];
  return removed;
}

/* ================================================================
 * Correctif « Carnet logique unique Binder ↔ Recherche »
 *
 * Un dossier Recherche explicitement associé (ProjectMeta.researchFolderLinks)
 * à UN SEUL dossier Binder représente le MÊME contexte de travail que ce
 * dossier Binder : les deux points d'entrée doivent résoudre le même
 * propriétaire canonique de Carnet, donc le même UUID et le même fichier
 * `.canvas`. Le nom des dossiers n'a AUCUNE valeur sémantique ici — seule
 * la présence réelle d'un lien dans researchFolderLinks compte (§3 du
 * correctif). Tout ce module reste pur (aucune écriture disque, aucun
 * saveSettings) : main.ts orchestre la persistance et les Notice. */

type VaultLookup = Pick<App["vault"], "getAbstractFileByPath">;

/** Nœuds Binder (TFolder uniquement, §Règle 3 — un lien vers un TFile
 * n'aliase jamais un Carnet de dossier) qui pointent RÉELLEMENT vers
 * `researchFolderPath` via researchFolderLinks, et qui restent à l'intérieur
 * du projet (garde défensive, §Règle 1/9). */
function findValidBinderOwners(vault: VaultLookup, projectRootPath: string, meta: ProjectMeta | undefined, researchFolderPath: string): TFolder[] {
  const links = meta?.researchFolderLinks; if (!links) return [];
  const project = normalizePath(projectRootPath);
  const target = normalizePath(researchFolderPath);
  const owners: TFolder[] = [];
  for (const [binderPath, linkedPath] of Object.entries(links)) {
    if (normalizePath(linkedPath) !== target) continue;
    const node = vault.getAbstractFileByPath(binderPath);
    if (!(node instanceof TFolder)) continue;
    const nodePath = normalizePath(node.path);
    if (nodePath !== project && !nodePath.startsWith(`${project}/`)) continue;
    owners.push(node);
  }
  return owners;
}

export type CanonicalFolderCarnetOwner = { owner: TFolder; linkedResearchFolder: TFolder | null };

/** Résolveur pur de propriétaire canonique (§2 du correctif).
 *
 * RÈGLE 1 : `folder` n'est la valeur d'aucun lien Binder→Recherche
 * admissible → owner = folder lui-même.
 * RÈGLE 2 : `folder` EST la valeur d'exactement un lien Binder→Recherche
 * dont la clé résout un TFolder réel → owner = ce dossier Binder,
 * linkedResearchFolder = folder.
 * RÈGLE 3 : un lien vers un TFile est ignoré (filtré par findValidBinderOwners).
 * RÈGLE 4 : plusieurs liens Binder valides pointent vers le même `folder` →
 * aucune attribution arbitraire, owner = folder lui-même.
 *
 * Si `folder` est lui-même un dossier Binder qui pointe vers un dossier
 * Recherche, et que ce lien est réciproquement non ambigu (exactement CE
 * dossier Binder comme unique propriétaire valide de la cible), le dossier
 * Recherche est exposé comme `linkedResearchFolder` du côté Binder aussi —
 * un seul Carnet logique, accessible symétriquement (§19). */
export function resolveCanonicalFolderCarnetOwner(vault: VaultLookup, projectRootPath: string, meta: ProjectMeta | undefined, folder: TFolder): CanonicalFolderCarnetOwner {
  const owners = findValidBinderOwners(vault, projectRootPath, meta, folder.path);
  if (owners.length === 1) return { owner: owners[0], linkedResearchFolder: folder };
  if (owners.length > 1) return { owner: folder, linkedResearchFolder: null };

  const links = meta?.researchFolderLinks;
  const linkedPath = links ? links[folder.path] : undefined;
  if (linkedPath) {
    const researchNode = vault.getAbstractFileByPath(linkedPath);
    if (researchNode instanceof TFolder) {
      const reciprocalOwners = findValidBinderOwners(vault, projectRootPath, meta, researchNode.path);
      if (reciprocalOwners.length === 1 && reciprocalOwners[0].path === folder.path) {
        return { owner: folder, linkedResearchFolder: researchNode };
      }
    }
  }
  return { owner: folder, linkedResearchFolder: null };
}

export type FolderCarnetContext = {
  owner: TFolder;
  linkedResearchFolder: TFolder | null;
  ownerRelative: string;
  linkedRelative: string | null;
};

/** Combine la résolution canonique et sa projection en clés de registre
 * relatives (§4) — un seul appel pour hasFolderCarnet/openFolderCarnet.
 * `null` si le propriétaire résolu tombe hors du projectRoot (garde
 * défensive, §Règle 1/test 9). */
export function resolveFolderCarnetContext(vault: VaultLookup, projectRootPath: string, meta: ProjectMeta | undefined, folder: TFolder): FolderCarnetContext | null {
  const { owner, linkedResearchFolder } = resolveCanonicalFolderCarnetOwner(vault, projectRootPath, meta, folder);
  const ownerRelative = folderPathToRelativeScope(projectRootPath, owner.path);
  if (!ownerRelative) return null;
  const linkedRelative = linkedResearchFolder ? folderPathToRelativeScope(projectRootPath, linkedResearchFolder.path) : null;
  return { owner, linkedResearchFolder, ownerRelative, linkedRelative };
}

/** Registration existante pour un contexte canonique — clé propriétaire en
 * priorité, repli sur la clé alias (Recherche) tant qu'elle n'a pas encore
 * été rapatriée par `canonicalizeFolderCarnetRegistration` (§5, CAS A). */
export function resolveExistingFolderCarnetRegistration(meta: ProjectMeta | undefined, ownerRelative: string, linkedRelative: string | null): FolderCarnetRegistration | null {
  const ownerReg = getFolderCarnetRegistration(meta, ownerRelative);
  if (ownerReg) return ownerReg;
  if (linkedRelative) {
    const linkedReg = getFolderCarnetRegistration(meta, linkedRelative);
    if (linkedReg) return linkedReg;
  }
  return null;
}

export type FolderCarnetCanonicalizationResult = { changed: boolean; conflict: boolean };

/** Rapatrie/nettoie une registration alias vers la clé canonique du
 * propriétaire Binder (§7). Mute `meta.folderCarnets` en place, exactement
 * comme `createFolderCarnet` — jamais d'E/S, jamais de saveSettings ici
 * (à la charge de l'appelant, une seule fois). Ne fusionne, n'écrase ni ne
 * supprime JAMAIS deux UUID distincts (CAS C) : `conflict: true` signale
 * seulement que l'appelant doit informer l'autrice une fois. */
export function canonicalizeFolderCarnetRegistration(meta: ProjectMeta, ownerRelative: string, linkedRelative: string | null): FolderCarnetCanonicalizationResult {
  if (!linkedRelative || ownerRelative === linkedRelative || !meta.folderCarnets) return { changed: false, conflict: false };
  const ownerReg = getFolderCarnetRegistration(meta, ownerRelative);
  const linkedReg = getFolderCarnetRegistration(meta, linkedRelative);
  if (!linkedReg) return { changed: false, conflict: false };
  if (!ownerReg) {
    // CAS A : seule la clé Recherche existe — déplacer la registration.
    meta.folderCarnets[ownerRelative] = linkedReg;
    delete meta.folderCarnets[linkedRelative];
    return { changed: true, conflict: false };
  }
  if (ownerReg.id === linkedReg.id) {
    // CAS B : même UUID des deux côtés — ne retirer que la clé alias.
    delete meta.folderCarnets[linkedRelative];
    return { changed: true, conflict: false };
  }
  // CAS C : deux UUID distincts — UUID propriétaire conservé comme
  // canonique, rien n'est supprimé ni fusionné côté alias.
  return { changed: false, conflict: true };
}

/** Tous les propriétaires canoniques actuellement enregistrés pour ce
 * projet (dédupliqués), utilisés pour détecter les homonymes (§14). */
export function listCanonicalFolderCarnetOwners(vault: VaultLookup, projectRootPath: string, meta: ProjectMeta | undefined): TFolder[] {
  if (!meta?.folderCarnets) return [];
  const seen = new Map<string, TFolder>();
  for (const relative of Object.keys(meta.folderCarnets)) {
    const absolute = relativeScopeToFolderPath(projectRootPath, relative);
    if (!absolute) continue;
    const node = vault.getAbstractFileByPath(absolute);
    if (!(node instanceof TFolder)) continue;
    const { owner } = resolveCanonicalFolderCarnetOwner(vault, projectRootPath, meta, node);
    if (!seen.has(owner.path)) seen.set(owner.path, owner);
  }
  return [...seen.values()];
}

/** Étiquette d'affichage courte d'un propriétaire canonique (§14) : son
 * basename seul s'il est unique parmi `allOwners`, sinon le plus court
 * suffixe de chemin qui le distingue de ses homonymes. Jamais tout le
 * chemin projet si ce n'est pas nécessaire. */
export function getFolderCarnetDisplayLabel(owner: TFolder, allOwners: TFolder[]): string {
  const collisions = allOwners.filter((candidate) => candidate.path !== owner.path && candidate.name === owner.name);
  if (collisions.length === 0) return owner.name;
  const group = [owner, ...collisions];
  const segmentsOf = (folder: TFolder): string[] => folder.path.split("/");
  const maxDepth = Math.max(...group.map((folder) => segmentsOf(folder).length));
  for (let depth = 2; depth <= maxDepth; depth++) {
    const suffixes = group.map((folder) => segmentsOf(folder).slice(-depth).join("/"));
    if (new Set(suffixes).size === group.length) return suffixes[0];
  }
  return owner.path;
}

/** Retrouve, pour un fichier `.canvas` ouvert, le propriétaire canonique du
 * Carnet de dossier auquel il correspond (§13/§16) — clé canonique ou clé
 * alias, peu importe : le titre affiché doit être identique des deux côtés
 * tant que la paire reste résolue par `resolveCanonicalFolderCarnetOwner`. */
export function resolveFolderCarnetTitleContext(vault: VaultLookup, manuscriptRoot: TFolder, projectRootPath: string, meta: ProjectMeta | undefined, file: TFile): CanonicalFolderCarnetOwner | null {
  if (!meta?.folderCarnets) return null;
  for (const relative of Object.keys(meta.folderCarnets)) {
    const registration = getFolderCarnetRegistration(meta, relative);
    if (!registration) continue;
    const path = folderCarnetCanvasPath(manuscriptRoot, registration.id);
    if (path !== file.path) continue;
    const absolute = relativeScopeToFolderPath(projectRootPath, relative);
    if (!absolute) return null;
    const node = vault.getAbstractFileByPath(absolute);
    if (!(node instanceof TFolder)) return null;
    return resolveCanonicalFolderCarnetOwner(vault, projectRootPath, meta, node);
  }
  return null;
}
