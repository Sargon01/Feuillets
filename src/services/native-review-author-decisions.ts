import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { stripFrontmatter } from "./frontmatter.js";
import { getManuscriptRoot } from "./folder-structure.js";
import { snapshotFile } from "./project-files.js";
import { reviewRoundsRootPath } from "./native-review-session.js";
import { loadNativeReviewAuthorAnalysis, type NativeReviewAuthorChange } from "./native-review-author-return.js";

type Decision = "accepted" | "rejected";
interface StoredDecision { changeIndex: number; baseStart: number; baseEnd: number; oldText: string; newText: string; decision: Decision; applied: boolean; decidedAt: string; }
interface StoredDocument { documentId: string; snapshotStamp?: string; decisions: StoredDecision[]; }
interface DecisionStore { version: 1; documents: StoredDocument[]; }
export class NativeReviewAuthorDecisionError extends Error { constructor(message: string) { super(message); this.name = "NativeReviewAuthorDecisionError"; } }
function fail(message: string): never { throw new NativeReviewAuthorDecisionError(message); }
function pathFor(reviewId: string, round: number): string { return normalizePath(`${reviewRoundsRootPath(reviewId)}/round-${round}-decisions.json`); }
function signature(change: NativeReviewAuthorChange, index: number): Pick<StoredDecision, "changeIndex" | "baseStart" | "baseEnd" | "oldText" | "newText"> { return { changeIndex: index, baseStart: change.baseStart, baseEnd: change.baseEnd, oldText: change.oldText, newText: change.newText }; }
function validStore(value: unknown): value is DecisionStore {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { documents?: unknown }).documents)) return false;
  return (value as DecisionStore).documents.every((doc) => doc && typeof doc.documentId === "string" && Array.isArray(doc.decisions)
    && doc.decisions.every((d) => Number.isInteger(d.changeIndex) && typeof d.baseStart === "number" && typeof d.baseEnd === "number" && typeof d.oldText === "string" && typeof d.newText === "string" && (d.decision === "accepted" || d.decision === "rejected") && typeof d.applied === "boolean" && typeof d.decidedAt === "string"));
}
async function loadStore(app: App, reviewId: string, round: number): Promise<{ store: DecisionStore; file: TFile | null; path: string }> {
  const path = pathFor(reviewId, round); const entry = app.vault.getAbstractFileByPath(path);
  if (!entry) return { store: { version: 1, documents: [] }, file: null, path };
  if (!(entry instanceof TFile)) fail("Store de décisions invalide");
  let value: unknown; try { value = JSON.parse(await app.vault.read(entry)); } catch { fail("Store de décisions corrompu"); }
  if (!validStore(value)) fail("Store de décisions incohérent"); return { store: value, file: entry, path };
}
async function saveStore(app: App, loaded: Awaited<ReturnType<typeof loadStore>>): Promise<void> {
  const text = JSON.stringify(loaded.store, null, 2);
  if (loaded.file) await app.vault.modify(loaded.file, text); else await app.vault.create(loaded.path, text);
}
function same(a: StoredDecision, b: ReturnType<typeof signature>): boolean { return a.changeIndex === b.changeIndex && a.baseStart === b.baseStart && a.baseEnd === b.baseEnd && a.oldText === b.oldText && a.newText === b.newText; }
function under(root: TFolder, file: TFile): boolean { return file.path.startsWith(`${root.path}/`); }

export async function decideNativeReviewAuthorChange(app: App, settings: FeuilletsSettings, reviewId: string, documentId: string, changeIndex: number, decision: Decision): Promise<void> {
  if (decision !== "accepted" && decision !== "rejected") fail("Décision invalide");
  let analysis: Awaited<ReturnType<typeof loadNativeReviewAuthorAnalysis>>;
  try { analysis = await loadNativeReviewAuthorAnalysis(app, reviewId); } catch (error) { throw new NativeReviewAuthorDecisionError(error instanceof Error ? error.message : String(error)); }
  const document = analysis.analyses.find((item) => item.documentId === documentId); const change = document?.changes[changeIndex];
  if (!document || !change) fail("Modification introuvable");
  const loaded = await loadStore(app, reviewId, analysis.round.round); let record = loaded.store.documents.find((item) => item.documentId === documentId);
  if (!record) { record = { documentId, decisions: [] }; loaded.store.documents.push(record); }
  const control = signature(change, changeIndex); const existing = record.decisions.find((item) => item.changeIndex === changeIndex);
  if (existing && !same(existing, control)) fail("Signature de décision incohérente");
  const now = new Date().toISOString();
  if (decision === "rejected") { if (existing?.decision === "rejected") return; record.decisions = record.decisions.filter((item) => item.changeIndex !== changeIndex); record.decisions.push({ ...control, decision, applied: false, decidedAt: now }); await saveStore(app, loaded); return; }
  if (change.confidence !== "safe" || (change.reason !== "already-applied" && change.reason !== "non-overlapping")) fail("Modification non applicable automatiquement");
  if (change.reason === "already-applied") { record.decisions = record.decisions.filter((item) => item.changeIndex !== changeIndex); record.decisions.push({ ...control, decision, applied: true, decidedAt: now }); await saveStore(app, loaded); return; }
  if (change.currentStart === undefined || change.currentEnd === undefined || document.authorMarkdown === undefined) fail("Coordonnées d’application absentes");
  const root = getManuscriptRoot(app, settings); if (!(root instanceof TFolder)) fail("Manuscrit actif introuvable");
  const source = document.localSourcePath ? app.vault.getAbstractFileByPath(document.localSourcePath) : null;
  if (!(source instanceof TFile) || source.extension !== "md" || !under(root, source)) fail("Source locale hors Manuscrit actif");
  const raw = await app.vault.read(source); const body = stripFrontmatter(raw);
  if (body !== document.authorMarkdown || body.slice(change.currentStart, change.currentEnd) !== change.oldText) fail("Source modifiée depuis l’analyse");
  if (!record.snapshotStamp) { try { record.snapshotStamp = await snapshotFile(app, source, root); await saveStore(app, loaded); } catch (error) { throw new NativeReviewAuthorDecisionError(`Snapshot impossible : ${error instanceof Error ? error.message : String(error)}`); } }
  const beforeWrite = await app.vault.read(source); if (beforeWrite !== raw) fail("Source modifiée depuis l’analyse");
  const prefix = raw.slice(0, raw.length - body.length); const newRaw = prefix + body.slice(0, change.currentStart) + change.newText + body.slice(change.currentEnd);
  try { await app.vault.modify(source, newRaw); } catch (error) { throw new NativeReviewAuthorDecisionError(`Écriture Manuscrit impossible : ${error instanceof Error ? error.message : String(error)}`); }
  record.decisions = record.decisions.filter((item) => item.changeIndex !== changeIndex); record.decisions.push({ ...control, decision, applied: true, decidedAt: now });
  try { await saveStore(app, loaded); } catch (error) { throw new NativeReviewAuthorDecisionError(`Enregistrement décision impossible : ${error instanceof Error ? error.message : String(error)}`); }
}
