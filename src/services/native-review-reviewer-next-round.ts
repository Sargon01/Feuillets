import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { readNativeReviewPackage, type NativeReviewPackage } from "./native-review-package.js";
import { assertNativeReviewThreadEvolution, loadNativeReviewThreads, nativeReviewThreadsPath } from "./native-review-threads.js";
import { appendReviewRound, currentReviewRound, loadReviewSession, reviewRoundsRootPath, saveReviewSession, type ReviewSession } from "./native-review-session.js";

export class NativeReviewReviewerNextRoundError extends Error {
  constructor(message: string) { super(message); this.name = "NativeReviewReviewerNextRoundError"; }
}
export interface NativeReviewReviewerNextRoundResult {
  session: ReviewSession;
  reviewPackage: NativeReviewPackage;
  localPackagePath: string;
  workingFiles: TFile[];
}
function fail(message: string): never { throw new NativeReviewReviewerNextRoundError(message); }
function samePeople(a: Array<{ id: string; name: string; role: string }>, b: Array<{ id: string; name: string; role: string }>): boolean {
  return a.length === b.length && a.every((item, index) => item.id === b[index].id && item.name === b[index].name && item.role === b[index].role);
}
function sameDocuments(a: Array<{ documentId: string; originalPath: string; title: string }>, b: Array<{ documentId: string; originalPath: string; title: string }>): boolean {
  return a.length === b.length && a.every((item, index) => item.documentId === b[index].documentId && item.originalPath === b[index].originalPath && item.title === b[index].title);
}
function workingPath(reviewId: string, documentId: string): string { return normalizePath(`_Feuillets/Relectures/${reviewId}/working/${documentId}.md`); }
function archivePath(reviewId: string, round: number): string { return normalizePath(`${reviewRoundsRootPath(reviewId)}/round-${round}-received.feuillets`); }
function equalBytes(a: Uint8Array, b: Uint8Array): boolean { return a.byteLength === b.byteLength && a.every((value, index) => value === b[index]); }
function sameThreads(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function usedPackageId(session: ReviewSession, packageId: string): boolean {
  return session.rounds.some((round) => round.sent?.packageId === packageId || round.received?.packageId === packageId);
}
function copySession(session: ReviewSession): ReviewSession {
  return {
    version: session.version,
    reviewId: session.reviewId,
    localRole: session.localRole,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    participants: session.participants.map((item) => ({ id: item.id, name: item.name, role: item.role })),
    documents: session.documents.map((item) => ({ documentId: item.documentId, originalPath: item.originalPath, title: item.title, localSourcePath: item.localSourcePath })),
    rounds: session.rounds.map((round) => ({
      round: round.round,
      createdAt: round.createdAt,
      ...(round.sent ? { sent: { packageId: round.sent.packageId, at: round.sent.at } } : {}),
      ...(round.received ? { received: { packageId: round.received.packageId, at: round.received.at } } : {}),
    })),
  };
}

export async function receiveNativeReviewNextRoundForReviewer(app: App, packageData: Uint8Array): Promise<NativeReviewReviewerNextRoundResult> {
  try {
    const incoming = await readNativeReviewPackage(packageData);
    if (incoming.manifest.senderRole !== "author" || incoming.manifest.round < 2) fail("Paquet auteur de tour suivant invalide");
    if (!incoming.documents.every((document) => document.baseMarkdown === document.workingMarkdown)) fail("Paquet auteur incohérent");
    const session = await loadReviewSession(app, incoming.manifest.reviewId);
    if (!session || session.reviewId !== incoming.manifest.reviewId || session.localRole !== "reviewer" || session.status !== "active") fail("Session relecteur active introuvable");
    const current = currentReviewRound(session);
    if (!current.received || !current.sent || incoming.manifest.round !== current.round + 1) fail("Tour entrant incohérent");
    if (!samePeople(session.participants, incoming.manifest.participants) || !sameDocuments(session.documents, incoming.documents)) fail("Participants ou documents incohérents");
    if (usedPackageId(session, incoming.manifest.packageId)) fail("Package déjà utilisé");

    const previousPath = normalizePath(`${reviewRoundsRootPath(session.reviewId)}/round-${current.round}-sent.feuillets`);
    const previousFile = app.vault.getAbstractFileByPath(previousPath);
    if (!(previousFile instanceof TFile)) fail("Archive d'envoi reviewer introuvable");
    const previous = await readNativeReviewPackage(new Uint8Array(await app.vault.readBinary(previousFile)));
    if (previous.manifest.senderRole !== "reviewer" || previous.manifest.reviewId !== session.reviewId || previous.manifest.round !== current.round || previous.manifest.packageId !== current.sent.packageId || !samePeople(previous.manifest.participants, session.participants) || !sameDocuments(previous.documents, session.documents)) fail("Archive d'envoi reviewer incohérente");
    assertNativeReviewThreadEvolution(previous.threads, incoming.threads, session.participants, session.documents, "author");
    const localThreads = await loadNativeReviewThreads(app, session.reviewId);

    const workingFiles: TFile[] = [];
    const workingContents: string[] = [];
    for (const document of session.documents) {
      const path = workingPath(session.reviewId, document.documentId);
      if (document.localSourcePath !== path) fail("Chemin working incohérent");
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.path !== path || file.extension !== "md") fail("Working reviewer introuvable");
      workingFiles.push(file); workingContents.push(await app.vault.read(file));
    }

    const localPackagePath = archivePath(session.reviewId, incoming.manifest.round);
    const existing = app.vault.getAbstractFileByPath(localPackagePath);
    const resuming = existing !== null;
    if (existing && (!(existing instanceof TFile) || !equalBytes(new Uint8Array(await app.vault.readBinary(existing)), new Uint8Array(packageData)))) fail("Archive entrante existante différente");
    for (let index = 0; index < session.documents.length; index += 1) {
      const prior = previous.documents[index]?.workingMarkdown;
      const next = incoming.documents[index]?.workingMarkdown;
      if (prior === undefined || next === undefined || (resuming ? workingContents[index] !== prior && workingContents[index] !== next : workingContents[index] !== prior)) fail("Working local non archivé");
    }
    if (resuming ? !sameThreads(localThreads.threads, previous.threads) && !sameThreads(localThreads.threads, incoming.threads) : !sameThreads(localThreads.threads, previous.threads)) fail("Fils locaux non archivés");

    const receivedAt = new Date().toISOString();
    const nextSession = copySession(session);
    appendReviewRound(nextSession, { packageId: incoming.manifest.packageId, at: receivedAt });
    nextSession.updatedAt = receivedAt;

    if (!existing) {
      const bytes = new Uint8Array(packageData.byteLength); bytes.set(packageData);
      await app.vault.createBinary(localPackagePath, bytes.buffer);
    }
    for (let index = 0; index < workingFiles.length; index += 1) await app.vault.modify(workingFiles[index], incoming.documents[index].workingMarkdown);
    const threadsPath = nativeReviewThreadsPath(session.reviewId); const threadsFile = app.vault.getAbstractFileByPath(threadsPath); const threadsJson = JSON.stringify({ version: 1, threads: incoming.threads }, null, 2);
    if (threadsFile instanceof TFile) await app.vault.modify(threadsFile, threadsJson); else if (threadsFile) fail("threads.json local invalide"); else await app.vault.create(threadsPath, threadsJson);
    await saveReviewSession(app, nextSession);
    return { session: nextSession, reviewPackage: incoming, localPackagePath, workingFiles };
  } catch (error) {
    if (error instanceof NativeReviewReviewerNextRoundError) throw error;
    throw new NativeReviewReviewerNextRoundError(error instanceof Error ? error.message : String(error));
  }
}
