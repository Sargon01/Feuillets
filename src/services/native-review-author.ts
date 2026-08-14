import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { resolveCompileScopeFiles, type CompileScope } from "./compile-scope.js";
import { getManuscriptRoot } from "./folder-structure.js";
import { titleFor } from "./frontmatter.js";
import { createNativeReviewPackage } from "./native-review-package.js";
import { createReviewSession, type ReviewParticipant, type ReviewSession } from "./native-review-session.js";
import { authorReviewStorageLocation, reviewSessionPaths } from "./native-review-storage.js";

/** A review scope deliberately has no projectRoot: it always targets the active manuscript. */
export type AuthorReviewScope =
  | { type: "file"; path: string }
  | { type: "folder"; path: string }
  | { type: "selection"; paths: string[] }
  | { type: "project" };

export interface NativeReviewAuthorInput {
  scope: AuthorReviewScope;
  authorName: string;
  reviewerName: string;
  createdByVersion: string;
}

export interface NativeReviewAuthorResult {
  session: ReviewSession;
  packageData: Uint8Array;
  localPackagePath: string;
  files: TFile[];
}

export class NativeReviewAuthorError extends Error {
  constructor(message: string) { super(message); this.name = "NativeReviewAuthorError"; }
}

function fail(message: string): never { throw new NativeReviewAuthorError(message); }

function isAtOrBelow(root: TFolder, entry: TFile | TFolder): boolean {
  return entry.path === root.path || entry.path.startsWith(`${root.path}/`);
}

function requestedEntry(app: App, path: unknown): TFile | TFolder {
  if (typeof path !== "string" || path.trim() === "") fail("Chemin de portée invalide");
  const entry = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!(entry instanceof TFile) && !(entry instanceof TFolder)) fail(`Chemin introuvable : ${path}`);
  return entry;
}

function validateRequestedScope(app: App, root: TFolder, scope: AuthorReviewScope): CompileScope {
  if (!scope || typeof scope !== "object") fail("Portée de relecture invalide");
  const projectRoot = root.path;
  switch (scope.type) {
    case "project":
      return { type: "project", projectRoot };
    case "file": {
      const entry = requestedEntry(app, scope.path);
      if (!isAtOrBelow(root, entry)) fail(`Le fichier demandé sort du Manuscrit : ${scope.path}`);
      if (!(entry instanceof TFile) || entry.extension !== "md") fail(`Le fichier demandé n’est pas un Markdown : ${scope.path}`);
      return { type: "file", projectRoot, path: entry.path };
    }
    case "folder": {
      const entry = requestedEntry(app, scope.path);
      if (!isAtOrBelow(root, entry)) fail(`Le dossier demandé sort du Manuscrit : ${scope.path}`);
      if (!(entry instanceof TFolder)) fail(`Le dossier demandé est invalide : ${scope.path}`);
      return { type: "folder", projectRoot, path: entry.path };
    }
    case "selection": {
      if (!Array.isArray(scope.paths) || scope.paths.length === 0) fail("La sélection de relecture est vide");
      const paths: string[] = [];
      for (const path of scope.paths) {
        const entry = requestedEntry(app, path);
        if (!isAtOrBelow(root, entry)) fail(`La sélection sort du Manuscrit : ${path}`);
        if (entry instanceof TFile && entry.extension !== "md") fail(`Le fichier demandé n’est pas un Markdown : ${path}`);
        paths.push(entry.path);
      }
      return { type: "selection", projectRoot, paths };
    }
    default:
      return fail("Type de portée de relecture invalide");
  }
}

function newId(prefix: "doc" | "review" | "package" | "author" | "reviewer"): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") fail("Web Crypto indisponible");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} est requis`);
  return value.trim();
}

/**
 * Creates the first, author-originated native review exchange. All content is
 * prepared in memory before the local session is created.
 */
export async function createNativeReviewAuthor(
  app: App,
  settings: FeuilletsSettings,
  input: NativeReviewAuthorInput,
): Promise<NativeReviewAuthorResult> {
  const root = getManuscriptRoot(app, settings);
  if (!(root instanceof TFolder)) fail("Manuscrit actif introuvable ou invalide");
  const compileScope = validateRequestedScope(app, root, input?.scope);
  const authorName = nonEmpty(input?.authorName, "Le nom de l’auteur");
  const reviewerName = nonEmpty(input?.reviewerName, "Le nom du relecteur");
  const createdByVersion = nonEmpty(input?.createdByVersion, "createdByVersion");

  // resolveCompileScopeFiles owns Binder order; this service must never sort it.
  const files = resolveCompileScopeFiles(app, settings, compileScope);
  if (files.length === 0) fail("La portée de relecture ne contient aucun fichier Markdown");
  for (const file of files) {
    if (!(file instanceof TFile) || file.extension !== "md") fail("La portée contient un fichier non Markdown");
    if (!isAtOrBelow(root, file)) fail(`Le fichier résolu sort du Manuscrit : ${file.path}`);
  }

  const createdAt = new Date().toISOString();
  const reviewId = newId("review");
  const packageId = newId("package");
  const participants: ReviewParticipant[] = [
    { id: newId("author"), name: authorName, role: "author" },
    { id: newId("reviewer"), name: reviewerName, role: "reviewer" },
  ];
  const documents = await Promise.all(files.map(async (file) => ({
    documentId: newId("doc"),
    originalPath: file.path.slice(root.path.length + 1),
    localSourcePath: file.path,
    title: titleFor(app, file),
    baseMarkdown: await app.vault.read(file),
  })));

  // This is deliberately the only call that cleans frontmatter/private fields.
  const packageData = await createNativeReviewPackage({
    packageId, createdAt, createdByVersion, reviewId, round: 1, senderRole: "author", participants,
  }, documents);
  const session: ReviewSession = {
    version: 1, reviewId, localRole: "author", status: "active", createdAt, updatedAt: createdAt, participants,
    documents: documents.map(({ documentId, originalPath, title, localSourcePath }) => ({ documentId, originalPath, title, localSourcePath })),
    rounds: [{ round: 1, createdAt, sent: { packageId, at: createdAt } }],
  };
  const location = authorReviewStorageLocation(app, settings);
  if (!location) fail("Emplacement de relecture du projet introuvable");
  const localPackagePath = normalizePath(`${reviewSessionPaths(location, reviewId).roundsRoot}/round-1-sent.feuillets`);
  if (app.vault.getAbstractFileByPath(localPackagePath)) fail(`Le paquet local existe déjà : ${localPackagePath}`);

  await createReviewSession(app, session, location);
  try {
    // Copy into a fresh ArrayBuffer so the Vault receives the exact package bytes
    // without relying on a potentially shared backing buffer.
    const archiveData = new Uint8Array(packageData.byteLength);
    archiveData.set(packageData);
    await app.vault.createBinary(localPackagePath, archiveData.buffer);
  } catch (error) {
    throw new NativeReviewAuthorError(`Archivage local du paquet impossible : ${error instanceof Error ? error.message : String(error)}`);
  }
  return { session, packageData, localPackagePath, files };
}

/** Short alias for callers that name the workflow rather than its transport. */
export const createAuthorReview = createNativeReviewAuthor;
