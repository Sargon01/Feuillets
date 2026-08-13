import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { readNativeReviewPackage, type NativeReviewPackage } from "./native-review-package.js";
import {
  createReviewSession,
  reviewRoundsRootPath,
  reviewSessionRootPath,
  reviewSessionsRootPath,
  reviewWorkingRootPath,
  type ReviewSession,
} from "./native-review-session.js";

export interface NativeReviewReviewerResult {
  session: ReviewSession;
  reviewPackage: NativeReviewPackage;
  localPackagePath: string;
  workingFiles: TFile[];
}

export class NativeReviewReviewerError extends Error {
  constructor(message: string) { super(message); this.name = "NativeReviewReviewerError"; }
}

function fail(message: string): never { throw new NativeReviewReviewerError(message); }

/**
 * Reject filesystem collisions before the session helper gets a chance to
 * write. This keeps a received package entirely in memory until all local
 * preconditions have been checked.
 */
function assertLocalDestinationAvailable(app: App, reviewId: string): void {
  const auxiliary = "_Feuillets";
  const reviews = reviewSessionsRootPath();
  const root = reviewSessionRootPath(reviewId);
  const auxiliaryEntry = app.vault.getAbstractFileByPath(auxiliary);
  if (auxiliaryEntry instanceof TFile) fail(`Un fichier bloque le dossier ${auxiliary}`);
  const reviewsEntry = app.vault.getAbstractFileByPath(reviews);
  if (reviewsEntry instanceof TFile) fail(`Un fichier bloque le dossier ${reviews}`);
  const rootEntry = app.vault.getAbstractFileByPath(root);
  if (rootEntry instanceof TFolder) fail(`Session existante : ${reviewId}`);
  if (rootEntry instanceof TFile) fail(`Un fichier bloque la session ${reviewId}`);
}

function archiveBytes(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
  }
  return data.slice(0);
}

function reviewerSession(reviewPackage: NativeReviewPackage, receivedAt: string): ReviewSession {
  const { manifest, documents } = reviewPackage;
  return {
    version: 1,
    reviewId: manifest.reviewId,
    localRole: "reviewer",
    status: "active",
    createdAt: manifest.createdAt,
    updatedAt: receivedAt,
    participants: manifest.participants.map(({ id, name, role }) => ({ id, name, role })),
    documents: documents.map(({ documentId, originalPath, title }) => ({
      documentId,
      originalPath,
      title,
      localSourcePath: normalizePath(`${reviewWorkingRootPath(manifest.reviewId)}/${documentId}.md`),
    })),
    rounds: [{
      round: 1,
      createdAt: manifest.createdAt,
      received: { packageId: manifest.packageId, at: receivedAt },
    }],
  };
}

/** Receives the author's first native-review package into an isolated reviewer session. */
export async function receiveNativeReviewForReviewer(
  app: App,
  packageData: ArrayBuffer | Uint8Array,
): Promise<NativeReviewReviewerResult> {
  let reviewPackage: NativeReviewPackage;
  try {
    reviewPackage = await readNativeReviewPackage(packageData);
  } catch (error) {
    throw new NativeReviewReviewerError(`Paquet de relecture invalide : ${error instanceof Error ? error.message : String(error)}`);
  }

  const { manifest } = reviewPackage;
  if (manifest.senderRole !== "author") fail("Seul le premier paquet d’un auteur peut être reçu");
  if (manifest.round !== 1) fail("Seul le tour 1 peut être reçu");
  assertLocalDestinationAvailable(app, manifest.reviewId);
  // Snapshot only after a fully valid package has been read, but before the
  // first write: subsequent async Vault work cannot change the archived bytes.
  const receivedBytes = archiveBytes(packageData);

  const receivedAt = new Date().toISOString();
  const session = reviewerSession(reviewPackage, receivedAt);
  const localPackagePath = normalizePath(`${reviewRoundsRootPath(manifest.reviewId)}/round-1-received.feuillets`);

  try {
    await createReviewSession(app, session);
  } catch (error) {
    throw new NativeReviewReviewerError(`Création de session impossible : ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await app.vault.createBinary(localPackagePath, receivedBytes);
  } catch (error) {
    throw new NativeReviewReviewerError(`Archivage local du paquet impossible : ${error instanceof Error ? error.message : String(error)}`);
  }

  const workingFiles: TFile[] = [];
  try {
    for (const document of reviewPackage.documents) {
      const path = normalizePath(`${reviewWorkingRootPath(manifest.reviewId)}/${document.documentId}.md`);
      workingFiles.push(await app.vault.create(path, document.workingMarkdown));
    }
  } catch (error) {
    throw new NativeReviewReviewerError(`Création des fichiers de travail impossible : ${error instanceof Error ? error.message : String(error)}`);
  }

  return { session, reviewPackage, localPackagePath, workingFiles };
}
