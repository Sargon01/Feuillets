import {
  createFeuilletsPackage,
  readFeuilletsPackage,
  validateFeuilletsManifest,
  type FeuilletsManifest,
} from "./feuillets-package.js";
import { stripFrontmatter } from "./frontmatter.js";
import type { ReviewParticipant, ReviewParticipantRole } from "./native-review-session.js";
import { validateNativeReviewThreads, type NativeReviewThread } from "./native-review-threads.js";

export interface NativeReviewManifestDocument {
  documentId: string;
  originalPath: string;
  title: string;
  baseHash: string;
}

export interface NativeReviewManifest extends FeuilletsManifest {
  kind: "review";
  reviewId: string;
  round: number;
  senderRole: ReviewParticipantRole;
  participants: ReviewParticipant[];
  documents: NativeReviewManifestDocument[];
}

export interface NativeReviewSourceDocument {
  documentId: string;
  originalPath: string;
  title: string;
  baseMarkdown: string;
  workingMarkdown?: string;
}

export interface NativeReviewPackageInput {
  packageId: string;
  createdAt: string;
  createdByVersion: string;
  reviewId: string;
  round: number;
  senderRole: ReviewParticipantRole;
  participants: ReviewParticipant[];
}

export interface NativeReviewPackageDocument extends NativeReviewManifestDocument {
  baseMarkdown: string;
  workingMarkdown: string;
}

export interface NativeReviewPackage {
  manifest: NativeReviewManifest;
  documents: NativeReviewPackageDocument[];
  threads: NativeReviewThread[];
}

export class NativeReviewPackageError extends Error {
  constructor(message: string) { super(message); this.name = "NativeReviewPackageError"; }
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;

function fail(message: string): never { throw new NativeReviewPackageError(message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail(`${label} invalide`);
}
function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || Number.isNaN(Date.parse(value))) fail(`${label} invalide`);
}
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function safePath(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.startsWith("/") || /^[A-Za-z]:/.test(value)
    || value.includes("\\") || hasControlCharacter(value) || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail(`${label} invalide`);
  }
}
function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} invalide`);
}
function validateParticipants(value: unknown): asserts value is ReviewParticipant[] {
  if (!Array.isArray(value) || value.length !== 2) fail("Il faut exactement deux participants");
  const ids = new Set<string>(); const roles = new Set<string>();
  for (const participant of value) {
    if (!isRecord(participant)) fail("Participant invalide");
    safeId(participant.id, "participant.id"); nonEmptyString(participant.name, "participant.name");
    if (participant.role !== "author" && participant.role !== "reviewer") fail("participant.role invalide");
    if (ids.has(participant.id)) fail("IDs participants dupliqués");
    ids.add(participant.id); roles.add(participant.role);
  }
  if (!roles.has("author") || !roles.has("reviewer")) fail("Un auteur et un relecteur sont requis");
}

export function reviewBaseEntryPath(documentId: string): string { safeId(documentId, "documentId"); return `review/base/${documentId}.md`; }
export function reviewWorkingEntryPath(documentId: string): string { safeId(documentId, "documentId"); return `review/working/${documentId}.md`; }
export function reviewThreadsEntryPath(): string { return "review/threads.json"; }

export function validateNativeReviewManifest(value: unknown): asserts value is NativeReviewManifest {
  try { validateFeuilletsManifest(value); } catch { fail("Manifest de relecture invalide"); }
  if (!isRecord(value) || value.kind !== "review") fail("Kind de relecture invalide");
  safeId(value.packageId, "packageId"); safeId(value.reviewId, "reviewId");
  timestamp(value.createdAt, "createdAt"); nonEmptyString(value.createdByVersion, "createdByVersion");
  if (typeof value.round !== "number" || !Number.isInteger(value.round) || value.round < 1) fail("round invalide");
  if (value.senderRole !== "author" && value.senderRole !== "reviewer") fail("senderRole invalide");
  validateParticipants(value.participants);
  if (!Array.isArray(value.documents) || value.documents.length === 0 || value.documents.length > 400) fail("documents invalides");
  const documentIds = new Set<string>(); const originalPaths = new Set<string>();
  for (const document of value.documents) {
    if (!isRecord(document)) fail("Document manifest invalide");
    safeId(document.documentId, "documentId"); safePath(document.originalPath, "originalPath"); nonEmptyString(document.title, "title");
    if (typeof document.baseHash !== "string" || !HASH.test(document.baseHash)) fail("baseHash invalide");
    if (documentIds.has(document.documentId) || originalPaths.has(document.originalPath)) fail("Documents dupliqués");
    documentIds.add(document.documentId); originalPaths.add(document.originalPath);
  }
}

export async function hashReviewText(text: string): Promise<string> {
  if (typeof text !== "string") fail("Texte à hacher invalide");
  const subtle = typeof crypto === "undefined" ? undefined : crypto.subtle;
  if (!subtle) fail("Web Crypto indisponible");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function createNativeReviewPackage(
  input: NativeReviewPackageInput,
  sourceDocuments: NativeReviewSourceDocument[],
  threads: NativeReviewThread[] = [],
): Promise<Uint8Array> {
  if (!isRecord(input)) fail("Entrée de paquet invalide");
  validateParticipants(input.participants);
  if (!Array.isArray(sourceDocuments) || sourceDocuments.length === 0 || sourceDocuments.length > 400) fail("documents invalides");
  const documents: NativeReviewManifestDocument[] = [];
  const files: Record<string, string> = {};
  const documentIds = new Set<string>(); const originalPaths = new Set<string>();
  for (const source of sourceDocuments) {
    if (!isRecord(source)) fail("Document source invalide");
    safeId(source.documentId, "documentId"); safePath(source.originalPath, "originalPath"); nonEmptyString(source.title, "title");
    if (typeof source.baseMarkdown !== "string" || source.workingMarkdown !== undefined && typeof source.workingMarkdown !== "string") fail("Markdown source invalide");
    if (documentIds.has(source.documentId) || originalPaths.has(source.originalPath)) fail("Documents dupliqués");
    documentIds.add(source.documentId); originalPaths.add(source.originalPath);
    const baseMarkdown = stripFrontmatter(source.baseMarkdown);
    const workingMarkdown = stripFrontmatter(source.workingMarkdown === undefined ? source.baseMarkdown : source.workingMarkdown);
    documents.push({ documentId: source.documentId, originalPath: source.originalPath, title: source.title, baseHash: await hashReviewText(baseMarkdown) });
    files[reviewBaseEntryPath(source.documentId)] = baseMarkdown;
    files[reviewWorkingEntryPath(source.documentId)] = workingMarkdown;
  }
  const manifest: NativeReviewManifest = {
    format: "feuillets",
    version: 1,
    kind: "review",
    packageId: input.packageId,
    createdAt: input.createdAt,
    createdByVersion: input.createdByVersion,
    reviewId: input.reviewId,
    round: input.round,
    senderRole: input.senderRole,
    participants: input.participants.map(({ id, name, role }) => ({ id, name, role })),
    documents,
  };
  validateNativeReviewManifest(manifest);
  validateNativeReviewThreads({ version: 1, threads }, manifest.participants, manifest.documents);
  if (threads.length > 0) files[reviewThreadsEntryPath()] = JSON.stringify({ version: 1, threads: threads.map((thread) => ({ threadId: thread.threadId, documentId: thread.documentId, anchor: { start: thread.anchor.start, end: thread.anchor.end, quote: thread.anchor.quote, prefix: thread.anchor.prefix, suffix: thread.anchor.suffix }, createdByParticipantId: thread.createdByParticipantId, createdAt: thread.createdAt, status: thread.status, ...(thread.status === "resolved" ? { resolvedAt: thread.resolvedAt, resolvedByParticipantId: thread.resolvedByParticipantId } : {}), messages: thread.messages.map((message) => ({ messageId: message.messageId, participantId: message.participantId, text: message.text, createdAt: message.createdAt })) })) });
  if (manifest.senderRole === "author" && documents.some((document) => files[reviewBaseEntryPath(document.documentId)] !== files[reviewWorkingEntryPath(document.documentId)])) {
    fail("Le working d’un paquet auteur doit être identique à base");
  }
  try { return await createFeuilletsPackage(manifest, files); } catch (error) {
    if (error instanceof NativeReviewPackageError) throw error;
    fail("Création du paquet de relecture impossible");
  }
}

function decodeUtf8(data: Uint8Array, path: string): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { return fail(`UTF-8 invalide : ${path}`); }
}

export async function readNativeReviewPackage(data: ArrayBuffer | Uint8Array): Promise<NativeReviewPackage> {
  let packageData: Awaited<ReturnType<typeof readFeuilletsPackage>>;
  try { packageData = await readFeuilletsPackage(data); } catch { fail("Paquet de relecture invalide"); }
  validateNativeReviewManifest(packageData.manifest);
  const manifest = packageData.manifest;
  const expected = new Set<string>();
  for (const document of manifest.documents) {
    expected.add(reviewBaseEntryPath(document.documentId)); expected.add(reviewWorkingEntryPath(document.documentId));
  }
  const hasThreads = packageData.entries.some((entry) => entry.path === reviewThreadsEntryPath()); if (hasThreads) expected.add(reviewThreadsEntryPath());
  if (packageData.entries.length !== expected.size || packageData.entries.some((entry) => !expected.has(entry.path))) fail("Entrées ZIP de relecture invalides");
  const byPath = new Map(packageData.entries.map((entry) => [entry.path, entry.data]));
  const documents: NativeReviewPackageDocument[] = [];
  for (const document of manifest.documents) {
    const basePath = reviewBaseEntryPath(document.documentId); const workingPath = reviewWorkingEntryPath(document.documentId);
    const baseData = byPath.get(basePath); const workingData = byPath.get(workingPath);
    if (!baseData) fail(`Base absente : ${document.documentId}`);
    if (!workingData) fail(`Working absent : ${document.documentId}`);
    const baseMarkdown = decodeUtf8(baseData, basePath); const workingMarkdown = decodeUtf8(workingData, workingPath);
    if (await hashReviewText(baseMarkdown) !== document.baseHash) fail(`baseHash invalide : ${document.documentId}`);
    if (manifest.senderRole === "author" && workingMarkdown !== baseMarkdown) fail("Le working d’un paquet auteur doit être identique à base");
    documents.push({ ...document, baseMarkdown, workingMarkdown });
  }
  let threads: NativeReviewThread[] = [];
  if (hasThreads) { const raw = byPath.get(reviewThreadsEntryPath()); if (!raw) fail("threads.json absent"); let parsed: unknown; try { parsed = JSON.parse(decodeUtf8(raw, reviewThreadsEntryPath())); } catch { fail("threads.json corrompu"); } try { validateNativeReviewThreads(parsed, manifest.participants, manifest.documents); } catch (error) { fail(`threads.json invalide : ${error instanceof Error ? error.message : String(error)}`); } threads = parsed.threads; }
  return { manifest, documents, threads };
}
