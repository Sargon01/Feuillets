import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import * as Diff from "diff";
import { stripFrontmatter } from "./frontmatter.js";
import { readNativeReviewPackage, type NativeReviewPackage } from "./native-review-package.js";
import {
  currentReviewRound,
  loadReviewSession,
  recordReviewRoundPackage,
  reviewRoundsRootPath,
  saveReviewSession,
  type ReviewSession,
} from "./native-review-session.js";
import type { ReviewConfidence } from "./docx-review-import.js";

export interface NativeReviewEdit {
  baseStart: number;
  baseEnd: number;
  oldText: string;
  newText: string;
}

export interface NativeReviewAuthorChange extends NativeReviewEdit {
  confidence: ReviewConfidence;
  reason: "non-overlapping" | "already-applied" | "overlap" | "mapping-failed" | "source-missing";
  currentStart?: number;
  currentEnd?: number;
}

export interface NativeReviewAuthorAnalysis {
  documentId: string;
  originalPath: string;
  title: string;
  localSourcePath?: string;
  confidence: ReviewConfidence;
  baseMarkdown: string;
  authorMarkdown?: string;
  reviewerMarkdown: string;
  changes: NativeReviewAuthorChange[];
}

export interface NativeReviewAuthorReturnResult {
  session: ReviewSession;
  reviewPackage: NativeReviewPackage;
  localPackagePath: string;
  analyses: NativeReviewAuthorAnalysis[];
}
export interface NativeReviewAuthorLoadedAnalysis {
  session: ReviewSession;
  round: ReturnType<typeof currentReviewRound>;
  sentPackage: NativeReviewPackage;
  reviewPackage: NativeReviewPackage;
  analyses: NativeReviewAuthorAnalysis[];
}

export class NativeReviewAuthorReturnError extends Error {
  constructor(message: string) { super(message); this.name = "NativeReviewAuthorReturnError"; }
}

function fail(message: string): never { throw new NativeReviewAuthorReturnError(message); }
function sameJson(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

/** Produces base-coordinate replacements, without attempting any fuzzy matching. */
export function nativeReviewEdits(base: string, changed: string): NativeReviewEdit[] {
  const edits: NativeReviewEdit[] = [];
  let baseOffset = 0;
  let pending: NativeReviewEdit | null = null;
  for (const part of Diff.diffWordsWithSpace(base, changed)) {
    if (!part.added && !part.removed) {
      if (pending) { edits.push(pending); pending = null; }
      baseOffset += part.value.length;
      continue;
    }
    if (!pending) pending = { baseStart: baseOffset, baseEnd: baseOffset, oldText: "", newText: "" };
    if (part.removed) {
      pending.oldText += part.value;
      pending.baseEnd += part.value.length;
      baseOffset += part.value.length;
    } else {
      pending.newText += part.value;
    }
  }
  if (pending) edits.push(pending);
  return edits;
}

function overlaps(left: NativeReviewEdit, right: NativeReviewEdit): boolean {
  const leftEmpty = left.baseStart === left.baseEnd;
  const rightEmpty = right.baseStart === right.baseEnd;
  if (!leftEmpty && !rightEmpty) return left.baseStart < right.baseEnd && left.baseEnd > right.baseStart;
  if (leftEmpty && rightEmpty) return left.baseStart === right.baseStart;
  if (leftEmpty) return left.baseStart >= right.baseStart && left.baseStart <= right.baseEnd;
  return right.baseStart >= left.baseStart && right.baseStart <= left.baseEnd;
}

function sessionCopy(session: ReviewSession): ReviewSession {
  return {
    version: 1, reviewId: session.reviewId, localRole: session.localRole, status: session.status,
    createdAt: session.createdAt, updatedAt: session.updatedAt,
    participants: session.participants.map(({ id, name, role }) => ({ id, name, role })),
    documents: session.documents.map(({ documentId, originalPath, title, localSourcePath }) => ({ documentId, originalPath, title, localSourcePath })),
    rounds: session.rounds.map(({ round, createdAt, sent, received }) => ({
      round, createdAt,
      ...(sent ? { sent: { packageId: sent.packageId, at: sent.at } } : {}),
      ...(received ? { received: { packageId: received.packageId, at: received.at } } : {}),
    })),
  };
}

function archiveBytes(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength); copy.set(data); return copy.buffer;
  }
  return data.slice(0);
}

function assertReturnPackage(session: ReviewSession, round: ReturnType<typeof currentReviewRound>, returned: NativeReviewPackage): void {
  const { manifest } = returned;
  if (manifest.senderRole !== "reviewer") fail("Le paquet retour doit provenir du relecteur");
  if (manifest.reviewId !== session.reviewId || manifest.round !== round.round) fail("Paquet retour incohérent avec la session");
}

function assertSameBase(session: ReviewSession, round: ReturnType<typeof currentReviewRound>, sent: NativeReviewPackage, returned: NativeReviewPackage): void {
  if (sent.manifest.senderRole !== "author" || sent.manifest.reviewId !== session.reviewId || sent.manifest.round !== round.round
    || !round.sent || sent.manifest.packageId !== round.sent.packageId) fail("Archive auteur incohérente avec la session");
  const sentParticipants = sent.manifest.participants.map(({ id, name, role }) => ({ id, name, role }));
  const sessionParticipants = session.participants.map(({ id, name, role }) => ({ id, name, role }));
  if (!sameJson(sessionParticipants, sentParticipants)) fail("Participants de session incohérents avec la base auteur");
  const returnedParticipants = returned.manifest.participants.map(({ id, name, role }) => ({ id, name, role }));
  if (!sameJson(sentParticipants, returnedParticipants)) fail("Participants du retour incohérents avec la base auteur");
  const sessionDocuments = session.documents.map(({ documentId, originalPath, title }) => ({ documentId, originalPath, title }));
  const sentSessionDocuments = sent.documents.map(({ documentId, originalPath, title }) => ({ documentId, originalPath, title }));
  if (!sameJson(sessionDocuments, sentSessionDocuments)) fail("Documents de session incohérents avec la base auteur");
  const sentDocuments = sent.documents.map(({ documentId, originalPath, title, baseHash }) => ({ documentId, originalPath, title, baseHash }));
  const returnedDocuments = returned.documents.map(({ documentId, originalPath, title, baseHash }) => ({ documentId, originalPath, title, baseHash }));
  if (!sameJson(sentDocuments, returnedDocuments)) fail("Documents du retour incohérents avec la base auteur");
  for (let index = 0; index < sent.documents.length; index += 1) {
    if (sent.documents[index].baseMarkdown !== returned.documents[index].baseMarkdown) fail("Base Markdown substituée par le relecteur");
  }
}

async function authorMarkdown(app: App, path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  const entry = app.vault.getAbstractFileByPath(path);
  if (!(entry instanceof TFile) || entry.extension !== "md") return undefined;
  try { return stripFrontmatter(await app.vault.read(entry)); } catch { return undefined; }
}

async function readAuthorAnalysis(app: App, reviewId: string, requireReceived: boolean): Promise<NativeReviewAuthorLoadedAnalysis> {
  let session: ReviewSession | null;
  try { session = await loadReviewSession(app, reviewId); } catch (error) { throw new NativeReviewAuthorReturnError(`Session de relecture illisible : ${error instanceof Error ? error.message : String(error)}`); }
  if (!session) fail(`Session introuvable : ${reviewId}`);
  if (session.localRole !== "author" || session.status !== "active") fail("La session auteur doit être active");
  let round: ReturnType<typeof currentReviewRound>;
  try { round = currentReviewRound(session); } catch (error) { throw new NativeReviewAuthorReturnError(`Tour de relecture invalide : ${error instanceof Error ? error.message : String(error)}`); }
  if (!round.sent || (requireReceived && !round.received)) fail("Le tour courant doit être envoyé et reçu");
  const readArchive = async (path: string, label: string): Promise<NativeReviewPackage> => {
    const entry = app.vault.getAbstractFileByPath(path);
    if (!(entry instanceof TFile)) fail(`${label} absente : ${path}`);
    try { return await readNativeReviewPackage(await app.vault.readBinary(entry)); } catch (error) { throw new NativeReviewAuthorReturnError(`${label} invalide : ${error instanceof Error ? error.message : String(error)}`); }
  };
  const sentPackage = await readArchive(normalizePath(`${reviewRoundsRootPath(reviewId)}/round-${round.round}-sent.feuillets`), "Archive auteur");
  const reviewPackage = await readArchive(normalizePath(`${reviewRoundsRootPath(reviewId)}/round-${round.round}-received.feuillets`), "Archive retour");
  assertReturnPackage(session, round, reviewPackage); assertSameBase(session, round, sentPackage, reviewPackage);
  const analyses: NativeReviewAuthorAnalysis[] = [];
  for (const document of reviewPackage.documents) {
    const local = session.documents.find((item) => item.documentId === document.documentId);
    if (!local) fail(`Document de session absent : ${document.documentId}`);
    analyses.push(analyseDocument(document, local.localSourcePath, await authorMarkdown(app, local.localSourcePath)));
  }
  return { session, round, sentPackage, reviewPackage, analyses };
}

/** Reloads the archived exchange and current local sources without writing. */
export async function loadNativeReviewAuthorAnalysis(app: App, reviewId: string): Promise<NativeReviewAuthorLoadedAnalysis> {
  return readAuthorAnalysis(app, reviewId, true);
}

function analyseDocument(
  document: NativeReviewPackage["documents"][number],
  localSourcePath: string | undefined,
  current: string | undefined,
): NativeReviewAuthorAnalysis {
  const reviewerEdits = nativeReviewEdits(document.baseMarkdown, document.workingMarkdown);
  if (current === undefined) return {
    documentId: document.documentId, originalPath: document.originalPath, title: document.title, localSourcePath,
    confidence: "ambiguous", baseMarkdown: document.baseMarkdown, reviewerMarkdown: document.workingMarkdown,
    changes: reviewerEdits.map((edit) => ({ ...edit, confidence: "ambiguous", reason: "source-missing" })),
  };
  const authorEdits = nativeReviewEdits(document.baseMarkdown, current);
  let mappingFailed = false;
  const changes = reviewerEdits.map((reviewer): NativeReviewAuthorChange => {
    const identical = authorEdits.some((author) => author.baseStart === reviewer.baseStart && author.baseEnd === reviewer.baseEnd && author.newText === reviewer.newText);
    if (identical) return { ...reviewer, confidence: "safe", reason: "already-applied" };
    if (authorEdits.some((author) => overlaps(reviewer, author))) return { ...reviewer, confidence: "review", reason: "overlap" };
    const delta = authorEdits
      .filter((author) => author.baseEnd <= reviewer.baseStart)
      .reduce((total, author) => total + author.newText.length - author.oldText.length, 0);
    const currentStart = reviewer.baseStart + delta;
    const currentEnd = reviewer.baseEnd + delta;
    if (current.slice(currentStart, currentEnd) !== reviewer.oldText) {
      mappingFailed = true;
      return { ...reviewer, confidence: "ambiguous", reason: "mapping-failed" };
    }
    return { ...reviewer, confidence: "safe", reason: "non-overlapping", currentStart, currentEnd };
  });
  return {
    documentId: document.documentId, originalPath: document.originalPath, title: document.title, localSourcePath,
    confidence: mappingFailed ? "ambiguous" : changes.some((change) => change.confidence === "review") ? "review" : "safe",
    baseMarkdown: document.baseMarkdown, authorMarkdown: current, reviewerMarkdown: document.workingMarkdown, changes,
  };
}

/** Receives a reviewer return, preserving the author manuscript and preparing only a 3-way analysis. */
export async function receiveNativeReviewReturnForAuthor(
  app: App,
  reviewId: string,
  packageData: ArrayBuffer | Uint8Array,
): Promise<NativeReviewAuthorReturnResult> {
  let session: ReviewSession | null;
  try { session = await loadReviewSession(app, reviewId); } catch (error) {
    throw new NativeReviewAuthorReturnError(`Session de relecture illisible : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!session) fail(`Session introuvable : ${reviewId}`);
  if (session.localRole !== "author" || session.status !== "active") fail("La session auteur doit être active");
  let round: ReturnType<typeof currentReviewRound>;
  try { round = currentReviewRound(session); } catch (error) {
    throw new NativeReviewAuthorReturnError(`Tour de relecture invalide : ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!round.sent || round.received) fail("Le tour courant doit être envoyé et non encore reçu");

  let reviewPackage: NativeReviewPackage;
  try { reviewPackage = await readNativeReviewPackage(packageData); } catch (error) {
    throw new NativeReviewAuthorReturnError(`Paquet retour invalide : ${error instanceof Error ? error.message : String(error)}`);
  }
  assertReturnPackage(session, round, reviewPackage);
  const sentPath = normalizePath(`${reviewRoundsRootPath(reviewId)}/round-${round.round}-sent.feuillets`);
  const sentEntry = app.vault.getAbstractFileByPath(sentPath);
  if (!(sentEntry instanceof TFile)) fail(`Archive auteur absente : ${sentPath}`);
  let sentPackage: NativeReviewPackage;
  try { sentPackage = await readNativeReviewPackage(await app.vault.readBinary(sentEntry)); } catch (error) {
    throw new NativeReviewAuthorReturnError(`Archive auteur invalide : ${error instanceof Error ? error.message : String(error)}`);
  }
  assertSameBase(session, round, sentPackage, reviewPackage);

  const analyses: NativeReviewAuthorAnalysis[] = [];
  for (const document of reviewPackage.documents) {
    const local = session.documents.find((item) => item.documentId === document.documentId);
    if (!local) fail(`Document de session absent : ${document.documentId}`);
    analyses.push(analyseDocument(document, local.localSourcePath, await authorMarkdown(app, local.localSourcePath)));
  }

  const localPackagePath = normalizePath(`${reviewRoundsRootPath(reviewId)}/round-${round.round}-received.feuillets`);
  if (app.vault.getAbstractFileByPath(localPackagePath)) fail(`Le paquet retour existe déjà : ${localPackagePath}`);
  const receivedAt = new Date().toISOString();
  const nextSession = sessionCopy(session);
  nextSession.updatedAt = receivedAt;
  try { recordReviewRoundPackage(nextSession, { packageId: reviewPackage.manifest.packageId, at: receivedAt }); } catch (error) {
    throw new NativeReviewAuthorReturnError(`Préparation de session impossible : ${error instanceof Error ? error.message : String(error)}`);
  }
  try { await app.vault.createBinary(localPackagePath, archiveBytes(packageData)); } catch (error) {
    throw new NativeReviewAuthorReturnError(`Archivage du paquet retour impossible : ${error instanceof Error ? error.message : String(error)}`);
  }
  try { await saveReviewSession(app, nextSession); } catch (error) {
    throw new NativeReviewAuthorReturnError(`Mise à jour de session impossible : ${error instanceof Error ? error.message : String(error)}`);
  }
  return { session: nextSession, reviewPackage, localPackagePath, analyses };
}
