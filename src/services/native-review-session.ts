import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { FEUILLETS_AUXILIARY_FOLDER_NAME } from "./folder-structure.js";

export type ReviewParticipantRole = "author" | "reviewer";
export interface ReviewParticipant { id: string; name: string; role: ReviewParticipantRole; }
export interface ReviewDocument { documentId: string; originalPath: string; localSourcePath?: string; }
export interface ReviewPackageRef { packageId: string; at: string; }
export interface ReviewRound { round: number; createdAt: string; sent?: ReviewPackageRef; received?: ReviewPackageRef; }
export interface ReviewSession {
  version: 1;
  reviewId: string;
  localRole: ReviewParticipantRole;
  status: "active" | "completed";
  createdAt: string;
  updatedAt: string;
  participants: ReviewParticipant[];
  documents: ReviewDocument[];
  rounds: ReviewRound[];
}

/** Une session illisible ou qui ne respecte plus le contrat n'est jamais réparée silencieusement. */
export class InvalidReviewSessionError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidReviewSessionError"; }
}

const REVIEWS_FOLDER_NAME = "Relectures";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function invalid(message: string): never { throw new InvalidReviewSessionError(message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) invalid(`${label} invalide`);
}
function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || Number.isNaN(Date.parse(value))) invalid(`${label} invalide`);
}
function safeRelativePath(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.startsWith("/") || /^[A-Za-z]:/.test(value)
    || value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    invalid(`${label} invalide`);
  }
}
function packageRef(value: unknown, label: string): asserts value is ReviewPackageRef {
  if (!isRecord(value)) invalid(`${label} invalide`);
  safeId(value.packageId, `${label}.packageId`);
  timestamp(value.at, `${label}.at`);
}

export function validateReviewSession(value: unknown): asserts value is ReviewSession {
  if (!isRecord(value)) invalid("Session invalide");
  if (value.version !== 1) invalid("Version de session invalide");
  safeId(value.reviewId, "reviewId");
  if (value.localRole !== "author" && value.localRole !== "reviewer") invalid("localRole invalide");
  if (value.status !== "active" && value.status !== "completed") invalid("status invalide");
  timestamp(value.createdAt, "createdAt"); timestamp(value.updatedAt, "updatedAt");
  if (!Array.isArray(value.participants) || value.participants.length !== 2) invalid("Il faut exactement deux participants");
  const participantIds = new Set<string>(); const roles = new Set<string>();
  for (const participant of value.participants) {
    if (!isRecord(participant)) invalid("Participant invalide");
    safeId(participant.id, "participant.id");
    if (typeof participant.name !== "string" || participant.name.trim() === "") invalid("participant.name invalide");
    if (participant.role !== "author" && participant.role !== "reviewer") invalid("participant.role invalide");
    if (participantIds.has(participant.id)) invalid("IDs participants dupliqués");
    participantIds.add(participant.id); roles.add(participant.role);
  }
  if (!roles.has("author") || !roles.has("reviewer")) invalid("Un auteur et un relecteur sont requis");
  if (!Array.isArray(value.documents) || value.documents.length === 0) invalid("Au moins un document est requis");
  const documentIds = new Set<string>();
  for (const document of value.documents) {
    if (!isRecord(document)) invalid("Document invalide");
    safeId(document.documentId, "documentId"); safeRelativePath(document.originalPath, "originalPath");
    if (document.localSourcePath !== undefined) safeRelativePath(document.localSourcePath, "localSourcePath");
    if (documentIds.has(document.documentId)) invalid("documentId dupliqué");
    documentIds.add(document.documentId);
  }
  if (!Array.isArray(value.rounds) || value.rounds.length === 0) invalid("Au moins un tour est requis");
  const rounds = value.rounds;
  const packageIds = new Set<string>();
  rounds.forEach((round, index) => {
    if (!isRecord(round) || round.round !== index + 1) invalid("Les tours doivent être continus à partir de 1");
    timestamp(round.createdAt, "round.createdAt");
    if (round.sent === undefined && round.received === undefined) invalid("Chaque tour doit contenir un échange");
    const firstDirection = value.localRole === "author" ? "sent" : "received";
    if (round[firstDirection] === undefined) invalid(`Le tour doit commencer par ${firstDirection}`);
    if (index < rounds.length - 1 && (round.sent === undefined || round.received === undefined)) {
      invalid("Tous les tours antérieurs au dernier doivent être complets");
    }
    if (value.status === "completed" && index === rounds.length - 1 && (round.sent === undefined || round.received === undefined)) {
      invalid("Une session terminée doit avoir un dernier tour complet");
    }
    for (const direction of ["sent", "received"] as const) {
      if (round[direction] === undefined) continue;
      packageRef(round[direction], `round.${direction}`);
      if (packageIds.has(round[direction].packageId)) invalid("packageId réutilisé");
      packageIds.add(round[direction].packageId);
    }
  });
}

function checkedReviewId(reviewId: string): string { safeId(reviewId, "reviewId"); return reviewId; }
export function reviewSessionsRootPath(): string { return normalizePath(`${FEUILLETS_AUXILIARY_FOLDER_NAME}/${REVIEWS_FOLDER_NAME}`); }
export function reviewSessionRootPath(reviewId: string): string { return normalizePath(`${reviewSessionsRootPath()}/${checkedReviewId(reviewId)}`); }
export function reviewSessionFilePath(reviewId: string): string { return normalizePath(`${reviewSessionRootPath(reviewId)}/session.json`); }
export function reviewWorkingRootPath(reviewId: string): string { return normalizePath(`${reviewSessionRootPath(reviewId)}/working`); }
export function reviewRoundsRootPath(reviewId: string): string { return normalizePath(`${reviewSessionRootPath(reviewId)}/rounds`); }

/** Crée chaque niveau séparément et refuse explicitement toute collision avec un fichier. */
async function ensureFolderPath(app: App, path: string): Promise<TFolder> {
  const levels = normalizePath(path).split("/");
  let current = "";
  for (const level of levels) {
    current = current ? `${current}/${level}` : level;
    const entry = app.vault.getAbstractFileByPath(current);
    if (entry instanceof TFile) invalid(`Un fichier bloque le dossier ${current}`);
    if (entry instanceof TFolder) continue;
    await app.vault.createFolder(current);
  }
  const result = app.vault.getAbstractFileByPath(path);
  if (!(result instanceof TFolder)) invalid(`Dossier introuvable après création : ${path}`);
  return result;
}

export async function createReviewSession(app: App, session: ReviewSession): Promise<ReviewSession> {
  validateReviewSession(session);
  const root = reviewSessionRootPath(session.reviewId);
  if (app.vault.getAbstractFileByPath(root)) invalid(`Session existante : ${session.reviewId}`);
  await ensureFolderPath(app, root);
  await ensureFolderPath(app, reviewWorkingRootPath(session.reviewId));
  await ensureFolderPath(app, reviewRoundsRootPath(session.reviewId));
  await app.vault.create(reviewSessionFilePath(session.reviewId), JSON.stringify(session, null, 2));
  return session;
}

export async function loadReviewSession(app: App, reviewId: string): Promise<ReviewSession | null> {
  const root = reviewSessionRootPath(reviewId); const rootEntry = app.vault.getAbstractFileByPath(root);
  if (!rootEntry) return null;
  if (!(rootEntry instanceof TFolder)) invalid(`Un fichier bloque la session ${reviewId}`);
  const entry = app.vault.getAbstractFileByPath(reviewSessionFilePath(reviewId));
  if (!(entry instanceof TFile)) invalid(`session.json absent pour ${reviewId}`);
  let parsed: unknown;
  try { parsed = JSON.parse(await app.vault.read(entry)); } catch { invalid(`session.json corrompu pour ${reviewId}`); }
  validateReviewSession(parsed);
  if (parsed.reviewId !== reviewId) invalid("reviewId du fichier session.json incohérent avec le dossier");
  return parsed;
}

export async function saveReviewSession(app: App, session: ReviewSession): Promise<ReviewSession> {
  validateReviewSession(session);
  const existing = await loadReviewSession(app, session.reviewId);
  if (!existing) invalid(`Session absente : ${session.reviewId}`);
  const file = app.vault.getAbstractFileByPath(reviewSessionFilePath(session.reviewId));
  if (!(file instanceof TFile)) invalid(`session.json absent pour ${session.reviewId}`);
  await app.vault.modify(file, JSON.stringify(session, null, 2));
  return session;
}

export function currentReviewRound(session: ReviewSession): ReviewRound {
  validateReviewSession(session); return session.rounds[session.rounds.length - 1];
}

export function appendReviewRound(session: ReviewSession, firstPackage: ReviewPackageRef): ReviewRound {
  validateReviewSession(session); packageRef(firstPackage, "package");
  if (session.status !== "active") invalid("Une session terminée ne peut pas être modifiée");
  const current = currentReviewRound(session);
  if (current.sent === undefined || current.received === undefined) invalid("Le tour courant doit être complet avant d'en créer un autre");
  if (session.rounds.some((round) => round.sent?.packageId === firstPackage.packageId || round.received?.packageId === firstPackage.packageId)) invalid("packageId réutilisé");
  const direction = session.localRole === "author" ? "sent" : "received";
  const round: ReviewRound = { round: session.rounds.length + 1, createdAt: firstPackage.at, [direction]: firstPackage };
  session.rounds.push(round); validateReviewSession(session); return round;
}

export function recordReviewRoundPackage(session: ReviewSession, reference: ReviewPackageRef): ReviewRound {
  validateReviewSession(session); packageRef(reference, "package");
  if (session.status !== "active") invalid("Une session terminée ne peut pas être modifiée");
  const round = currentReviewRound(session);
  const direction = session.localRole === "author" ? "received" : "sent";
  const existing = round[direction];
  if (existing) {
    if (existing.packageId === reference.packageId) return round;
    invalid(`Le package ${direction} du tour ${round.round} ne peut pas être remplacé`);
  }
  if (session.rounds.some((item) => item.sent?.packageId === reference.packageId || item.received?.packageId === reference.packageId)) invalid("packageId réutilisé");
  round[direction] = reference; validateReviewSession(session); return round;
}

export function isNativeReviewPath(path: string): boolean { return reviewIdFromNativeReviewPath(path) !== null; }
export function reviewIdFromNativeReviewPath(path: string): string | null {
  if (typeof path !== "string" || path.startsWith("/") || path.includes("\\")) return null;
  const rawParts = path.split("/");
  if (rawParts.some((part) => part === "" || part === "." || part === "..")) return null;
  const parts = normalizePath(path).split("/");
  if (parts[0] !== FEUILLETS_AUXILIARY_FOLDER_NAME || parts[1] !== REVIEWS_FOLDER_NAME || parts.length < 4 || !SAFE_ID.test(parts[2])) return null;
  return parts[2];
}
