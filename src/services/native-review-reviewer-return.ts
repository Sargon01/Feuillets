import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { createNativeReviewPackage, readNativeReviewPackage } from "./native-review-package.js";
import { assertNativeReviewThreadEvolution, loadNativeReviewThreads } from "./native-review-threads.js";
import {
  currentReviewRound,
  loadReviewSession,
  recordReviewRoundPackage,
  saveReviewSession,
  type ReviewSession,
} from "./native-review-session.js";
import { reviewSessionPaths, reviewerReviewStorageLocation } from "./native-review-storage.js";

export interface NativeReviewReviewerReturnResult {
  session: ReviewSession;
  packageData: Uint8Array;
  localPackagePath: string;
  workingFiles: TFile[];
}

export class NativeReviewReviewerReturnError extends Error {
  constructor(message: string) { super(message); this.name = "NativeReviewReviewerReturnError"; }
}

function fail(message: string): never { throw new NativeReviewReviewerReturnError(message); }
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

function packageId(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") fail("Web Crypto indisponible");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `package-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Copies only the ReviewSession contract, keeping the loaded object untouched during preparation. */
function sessionCopy(session: ReviewSession): ReviewSession {
  return {
    version: 1,
    reviewId: session.reviewId,
    localRole: session.localRole,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    participants: session.participants.map(({ id, name, role }) => ({ id, name, role })),
    documents: session.documents.map(({ documentId, originalPath, title, localSourcePath }) => ({ documentId, originalPath, title, localSourcePath })),
    rounds: session.rounds.map(({ round, createdAt, sent, received }) => ({
      round,
      createdAt,
      ...(sent ? { sent: { packageId: sent.packageId, at: sent.at } } : {}),
      ...(received ? { received: { packageId: received.packageId, at: received.at } } : {}),
    })),
  };
}

function assertReceivedPackage(session: ReviewSession, round: ReturnType<typeof currentReviewRound>, receivedPackage: Awaited<ReturnType<typeof readNativeReviewPackage>>): void {
  const { manifest } = receivedPackage;
  if (manifest.senderRole !== "author") fail("Le paquet reçu doit provenir de l’auteur");
  if (manifest.reviewId !== session.reviewId || manifest.round !== round.round) fail("Paquet reçu incohérent avec la session");
  if (!round.received || manifest.packageId !== round.received.packageId) fail("packageId reçu incohérent avec la session");
  if (round.round === 1 && manifest.createdAt !== session.createdAt) fail("createdAt du premier tour incohérent");
  const participants = manifest.participants.map(({ id, name, role }) => ({ id, name, role }));
  const documents = manifest.documents.map(({ documentId, originalPath, title }) => ({ documentId, originalPath, title }));
  if (!sameJson(participants, session.participants) || !sameJson(documents, session.documents.map(({ documentId, originalPath, title }) => ({ documentId, originalPath, title })))) {
    fail("Participants ou documents incohérents avec la session");
  }
}

/** Creates the reviewer’s reply for the current received round. */
export async function createNativeReviewReviewerReturn(
  app: App,
  reviewId: string,
  createdByVersion: string,
): Promise<NativeReviewReviewerReturnResult> {
  const location = reviewerReviewStorageLocation(); const paths = reviewSessionPaths(location, reviewId);
  let session: ReviewSession | null;
  try { session = await loadReviewSession(app, location, reviewId); } catch (error) {
    throw new NativeReviewReviewerReturnError(`Session de relecture illisible : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!session) fail(`Session introuvable : ${reviewId}`);
  if (session.localRole !== "reviewer" || session.status !== "active") fail("La session relecteur doit être active");
  let round: ReturnType<typeof currentReviewRound>;
  try { round = currentReviewRound(session); } catch (error) {
    throw new NativeReviewReviewerReturnError(`Tour de relecture invalide : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!round.received || round.sent) fail("Le tour courant doit être reçu et non encore envoyé");

  const receivedPath = normalizePath(`${paths.roundsRoot}/round-${round.round}-received.feuillets`);
  const receivedEntry = app.vault.getAbstractFileByPath(receivedPath);
  if (!(receivedEntry instanceof TFile)) fail(`Archive reçue absente : ${receivedPath}`);
  let receivedPackage: Awaited<ReturnType<typeof readNativeReviewPackage>>;
  try { receivedPackage = await readNativeReviewPackage(await app.vault.readBinary(receivedEntry)); } catch (error) {
    throw new NativeReviewReviewerReturnError(`Archive reçue invalide : ${error instanceof Error ? error.message : String(error)}`);
  }
  assertReceivedPackage(session, round, receivedPackage);
  const threads = await loadNativeReviewThreads(app, reviewId, location);
  assertNativeReviewThreadEvolution(receivedPackage.threads, threads.threads, session.participants, session.documents, "reviewer");

  const workingFiles: TFile[] = [];
  const workingMarkdown: string[] = [];
  for (const document of session.documents) {
    const path = normalizePath(`${paths.workingRoot}/${document.documentId}.md`);
    if (document.localSourcePath !== path) fail(`localSourcePath incohérent : ${document.documentId}`);
    const entry = app.vault.getAbstractFileByPath(path);
    if (!(entry instanceof TFile) || entry.extension !== "md") fail(`Fichier working absent ou invalide : ${path}`);
    workingFiles.push(entry);
    try { workingMarkdown.push(await app.vault.read(entry)); } catch (error) {
      throw new NativeReviewReviewerReturnError(`Lecture du working impossible : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const sentAt = new Date().toISOString();
  let packageData: Uint8Array;
  try {
    packageData = await createNativeReviewPackage({
      packageId: packageId(), createdAt: sentAt, createdByVersion, reviewId: session.reviewId, round: round.round,
      senderRole: "reviewer", participants: session.participants.map(({ id, name, role }) => ({ id, name, role })),
    }, session.documents.map((document, index) => ({
      documentId: document.documentId, originalPath: document.originalPath, title: document.title,
      baseMarkdown: receivedPackage.documents[index].baseMarkdown, workingMarkdown: workingMarkdown[index],
    })), threads.threads);
  } catch (error) {
    if (error instanceof NativeReviewReviewerReturnError) throw error;
    throw new NativeReviewReviewerReturnError(`Création du paquet retour impossible : ${error instanceof Error ? error.message : String(error)}`);
  }

  const localPackagePath = normalizePath(`${paths.roundsRoot}/round-${round.round}-sent.feuillets`);
  if (app.vault.getAbstractFileByPath(localPackagePath)) fail(`Le paquet retour existe déjà : ${localPackagePath}`);
  const nextSession = sessionCopy(session);
  nextSession.updatedAt = sentAt;
  try { recordReviewRoundPackage(nextSession, { packageId: (await readNativeReviewPackage(packageData)).manifest.packageId, at: sentAt }); } catch (error) {
    throw new NativeReviewReviewerReturnError(`Préparation de session impossible : ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const archive = new Uint8Array(packageData.byteLength); archive.set(packageData);
    await app.vault.createBinary(localPackagePath, archive.buffer);
  } catch (error) {
    throw new NativeReviewReviewerReturnError(`Archivage du paquet retour impossible : ${error instanceof Error ? error.message : String(error)}`);
  }
  try { await saveReviewSession(app, location, nextSession); } catch (error) {
    throw new NativeReviewReviewerReturnError(`Mise à jour de session impossible : ${error instanceof Error ? error.message : String(error)}`);
  }
  return { session: nextSession, packageData, localPackagePath, workingFiles };
}
