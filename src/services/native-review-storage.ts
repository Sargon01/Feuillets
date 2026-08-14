import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { FEUILLETS_AUXILIARY_FOLDER_NAME, feuilletsAuxiliaryRootPath, getManuscriptRoot } from "./folder-structure.js";

export type NativeReviewStorageLocation = {
  kind: "author-project" | "reviewer-inbox" | "legacy-global-author";
  sessionsRootPath: string;
};

export interface NativeReviewSessionPaths {
  root: string;
  sessionFile: string;
  workingRoot: string;
  roundsRoot: string;
  /** Copies internes servant de colonne droite à la comparaison. Ce ne sont
   * pas des feuillets du Manuscrit : elles n'existent que pour qu'Obsidian
   * puisse afficher la version du relecteur avec son VRAI éditeur, et
   * partent avec la session (removeNativeReviewSession). */
  comparisonRoot: string;
  threadsFile: string;
  localStateFile: string;
}

const REVIEW_FOLDER = "Relectures";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const rememberedLocations = new Map<string, NativeReviewStorageLocation>();

function checkedId(reviewId: string): string {
  if (!SAFE_ID.test(reviewId)) throw new Error("reviewId invalide");
  return reviewId;
}

export function authorReviewSessionsRootPath(app: App, settings: FeuilletsSettings): string | null {
  const manuscript = getManuscriptRoot(app, settings);
  return manuscript ? normalizePath(`${feuilletsAuxiliaryRootPath(manuscript)}/${REVIEW_FOLDER}`) : null;
}

export function reviewerReviewSessionsRootPath(): string {
  return normalizePath(`${FEUILLETS_AUXILIARY_FOLDER_NAME}/${REVIEW_FOLDER}`);
}

export function authorReviewStorageLocation(app: App, settings: FeuilletsSettings): NativeReviewStorageLocation | null {
  const sessionsRootPath = authorReviewSessionsRootPath(app, settings);
  return sessionsRootPath ? { kind: "author-project", sessionsRootPath } : null;
}

export function reviewerReviewStorageLocation(): NativeReviewStorageLocation {
  return { kind: "reviewer-inbox", sessionsRootPath: reviewerReviewSessionsRootPath() };
}

/** Reconstruit une localisation à partir du seul chemin racine — utilisé quand
 * un état de vue sérialisé doit retrouver sa session. `kind` n'intervient que
 * dans le listage : les chemins, eux, ne dépendent que de sessionsRootPath. */
export function nativeReviewLocationFromRoot(sessionsRootPath: string): NativeReviewStorageLocation {
  return { kind: sessionsRootPath === reviewerReviewSessionsRootPath() ? "reviewer-inbox" : "author-project", sessionsRootPath };
}

export function legacyGlobalAuthorStorageLocation(): NativeReviewStorageLocation {
  return { kind: "legacy-global-author", sessionsRootPath: reviewerReviewSessionsRootPath() };
}

export function reviewSessionPaths(location: NativeReviewStorageLocation, reviewId: string): NativeReviewSessionPaths {
  const root = normalizePath(`${location.sessionsRootPath}/${checkedId(reviewId)}`);
  return {
    root,
    sessionFile: normalizePath(`${root}/session.json`),
    workingRoot: normalizePath(`${root}/working`),
    roundsRoot: normalizePath(`${root}/rounds`),
    comparisonRoot: normalizePath(`${root}/comparison`),
    threadsFile: normalizePath(`${root}/threads.json`),
    localStateFile: normalizePath(`${root}/local-state.json`),
  };
}

export function rememberNativeReviewStorageLocation(reviewId: string, location: NativeReviewStorageLocation): void {
  rememberedLocations.set(checkedId(reviewId), location);
}

export function rememberedNativeReviewStorageLocation(reviewId: string): NativeReviewStorageLocation | null {
  return rememberedLocations.get(checkedId(reviewId)) ?? null;
}

/** Recherche de reprise, utilisée seulement si la session n'est pas dans
 * l'inbox globale. Elle couvre les projets auteur sans imposer settings aux
 * services bas niveau historiques. */
export function discoverNativeReviewStorageLocation(app: App, reviewId: string): NativeReviewStorageLocation | null {
  const suffix = `/${FEUILLETS_AUXILIARY_FOLDER_NAME}/${REVIEW_FOLDER}/${checkedId(reviewId)}/session.json`;
  const files = typeof app.vault.getFiles === "function" ? app.vault.getFiles() : [];
  const matches = files.filter((file) => file.path === `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${REVIEW_FOLDER}/${reviewId}/session.json` || file.path.endsWith(suffix));
  if (matches.length > 1) throw new Error(`Collision de session pour ${reviewId}`);
  if (!matches.length) return null;
  const sessionFile = matches[0];
  const sessionsRootPath = sessionFile.parent?.parent?.path;
  if (!sessionsRootPath) return null;
  const location: NativeReviewStorageLocation = { kind: sessionsRootPath === reviewerReviewSessionsRootPath() ? "reviewer-inbox" : "author-project", sessionsRootPath };
  rememberNativeReviewStorageLocation(reviewId, location);
  return location;
}

export function findNativeReviewSessionLocations(app: App, reviewId: string): NativeReviewStorageLocation[] {
  checkedId(reviewId);
  const files = typeof app.vault.getFiles === "function" ? app.vault.getFiles() : [];
  const suffix = `/${REVIEW_FOLDER}/${reviewId}/session.json`;
  const roots = new Map<string, NativeReviewStorageLocation>();
  for (const file of files) {
    if (file.path !== `${FEUILLETS_AUXILIARY_FOLDER_NAME}/${REVIEW_FOLDER}/${reviewId}/session.json` && !file.path.endsWith(suffix)) continue;
    const sessionsRootPath = file.parent?.parent?.path; if (!sessionsRootPath) continue;
    roots.set(sessionsRootPath, { kind: sessionsRootPath === reviewerReviewSessionsRootPath() ? "reviewer-inbox" : "author-project", sessionsRootPath });
  }
  return [...roots.values()];
}

/**
 * Cherche uniquement les fichiers session.json ayant la forme attendue. La
 * collision est volontairement bloquante : un même reviewId ne peut jamais
 * être routé silencieusement vers un autre projet.
 */
export function locateNativeReviewSession(app: App, reviewId: string, settings?: FeuilletsSettings): NativeReviewStorageLocation | null {
  checkedId(reviewId);
  const candidates: NativeReviewStorageLocation[] = [];
  const author = settings ? authorReviewStorageLocation(app, settings) : null;
  if (author && app.vault.getAbstractFileByPath(reviewSessionPaths(author, reviewId).sessionFile) instanceof TFile) candidates.push(author);
  const inbox = reviewerReviewStorageLocation();
  if (app.vault.getAbstractFileByPath(reviewSessionPaths(inbox, reviewId).sessionFile) instanceof TFile) candidates.push(inbox);
  // Les anciennes sessions auteur restent au même emplacement que l'inbox,
  // mais leur rôle est distingué après lecture de session.json par l'appelant.
  if (candidates.length > 1) throw new Error(`Collision de session pour ${reviewId}`);
  return candidates[0] ?? null;
}

export async function removeNativeReviewSession(app: App, location: NativeReviewStorageLocation, reviewId: string): Promise<void> {
  const folder = app.vault.getAbstractFileByPath(reviewSessionPaths(location, reviewId).root);
  if (!(folder instanceof TFolder)) throw new Error("Dossier de session introuvable");
  await app.fileManager.trashFile(folder);
}
