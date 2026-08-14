import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { stripFrontmatter } from "./frontmatter.js";
import { getManuscriptRoot } from "./folder-structure.js";
import { snapshotFile } from "./project-files.js";
import { loadNativeReviewAuthorAnalysis, type NativeReviewAuthorChange } from "./native-review-author-return.js";
import { discoverNativeReviewStorageLocation, legacyGlobalAuthorStorageLocation, rememberedNativeReviewStorageLocation, reviewSessionPaths, type NativeReviewStorageLocation } from "./native-review-storage.js";

type Decision = "accepted" | "rejected";
interface StoredDecision { changeIndex: number; baseStart: number; baseEnd: number; oldText: string; newText: string; decision: Decision; applied: boolean; decidedAt: string; }
interface StoredDocument { documentId: string; snapshotStamp?: string; decisions: StoredDecision[]; }
interface DecisionStore { version: 1; documents: StoredDocument[]; }
export interface NativeReviewAuthorDecisionState { round: number; store: DecisionStore; complete: boolean; unresolved: Array<{ documentId: string; changeIndex: number }>; }
export class NativeReviewAuthorDecisionError extends Error { constructor(message: string) { super(message); this.name = "NativeReviewAuthorDecisionError"; } }
function fail(message: string): never { throw new NativeReviewAuthorDecisionError(message); }
function resolvedLocation(app: App, reviewId: string, location?: NativeReviewStorageLocation): NativeReviewStorageLocation { return location ?? discoverNativeReviewStorageLocation(app, reviewId) ?? rememberedNativeReviewStorageLocation(reviewId) ?? legacyGlobalAuthorStorageLocation(); }
function pathFor(location: NativeReviewStorageLocation, reviewId: string, round: number): string { return normalizePath(`${reviewSessionPaths(location, reviewId).roundsRoot}/round-${round}-decisions.json`); }
function signature(change: NativeReviewAuthorChange, index: number): Pick<StoredDecision, "changeIndex" | "baseStart" | "baseEnd" | "oldText" | "newText"> { return { changeIndex: index, baseStart: change.baseStart, baseEnd: change.baseEnd, oldText: change.oldText, newText: change.newText }; }
function validStore(value: unknown): value is DecisionStore {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { documents?: unknown }).documents)) return false;
  const ids = new Set<string>();
  return (value as DecisionStore).documents.every((doc) => doc && typeof doc.documentId === "string" && doc.documentId.trim() !== "" && !ids.has(doc.documentId) && (ids.add(doc.documentId), true)
    && (doc.snapshotStamp === undefined || typeof doc.snapshotStamp === "string" && doc.snapshotStamp.trim() !== "") && Array.isArray(doc.decisions) && (() => {
      const indexes = new Set<number>(); return doc.decisions.every((d) => Number.isSafeInteger(d.changeIndex) && d.changeIndex >= 0 && !indexes.has(d.changeIndex) && (indexes.add(d.changeIndex), true)
        && Number.isSafeInteger(d.baseStart) && d.baseStart >= 0 && Number.isSafeInteger(d.baseEnd) && d.baseEnd >= d.baseStart && typeof d.oldText === "string" && typeof d.newText === "string"
        && (d.decision === "accepted" || d.decision === "rejected") && typeof d.applied === "boolean" && (d.decision === "accepted" ? d.applied : !d.applied)
        && typeof d.decidedAt === "string" && d.decidedAt.trim() !== "" && !Number.isNaN(Date.parse(d.decidedAt)));
    })());
}
async function loadStore(app: App, location: NativeReviewStorageLocation, reviewId: string, round: number): Promise<{ store: DecisionStore; file: TFile | null; path: string }> {
  const path = pathFor(location, reviewId, round); const entry = app.vault.getAbstractFileByPath(path);
  if (!entry) return { store: { version: 1, documents: [] }, file: null, path };
  if (!(entry instanceof TFile)) fail("Store de décisions invalide");
  let value: unknown; try { value = JSON.parse(await app.vault.read(entry)); } catch { fail("Store de décisions corrompu"); }
  if (!validStore(value)) fail("Store de décisions incohérent"); return { store: value, file: entry, path };
}
async function saveStore(app: App, loaded: Awaited<ReturnType<typeof loadStore>>): Promise<void> {
  const text = JSON.stringify(loaded.store, null, 2);
  if (loaded.file) await app.vault.modify(loaded.file, text); else await app.vault.create(loaded.path, text);
}
export async function loadNativeReviewAuthorDecisionState(app: App, reviewId: string, location?: NativeReviewStorageLocation): Promise<NativeReviewAuthorDecisionState> {
  const resolved = resolvedLocation(app, reviewId, location); const analysis = await loadNativeReviewAuthorAnalysis(app, reviewId, resolved); const loaded = await loadStore(app, resolved, reviewId, analysis.round.round);
  const unresolved: Array<{ documentId: string; changeIndex: number }> = [];
  for (const document of analysis.analyses) for (let index = 0; index < document.changes.length; index += 1) {
    const found = loaded.store.documents.find((item) => item.documentId === document.documentId)?.decisions.find((item) => item.changeIndex === index);
    if (found && !same(found, signature(document.changes[index], index))) fail("Signature de décision incohérente");
    if (!found) unresolved.push({ documentId: document.documentId, changeIndex: index });
  }
  for (const doc of loaded.store.documents) for (const decision of doc.decisions) {
    const analysisDoc = analysis.analyses.find((item) => item.documentId === doc.documentId); if (!analysisDoc || !analysisDoc.changes[decision.changeIndex]) fail("Décision orpheline");
  }
  return { round: analysis.round.round, store: loaded.store, complete: unresolved.length === 0, unresolved };
}
function same(a: StoredDecision, b: ReturnType<typeof signature>): boolean { return a.changeIndex === b.changeIndex && a.baseStart === b.baseStart && a.baseEnd === b.baseEnd && a.oldText === b.oldText && a.newText === b.newText; }
function under(root: TFolder, file: TFile): boolean { return file.path.startsWith(`${root.path}/`); }

export async function decideNativeReviewAuthorChange(app: App, settings: FeuilletsSettings, reviewId: string, documentId: string, changeIndex: number, decision: Decision, location?: NativeReviewStorageLocation): Promise<void> {
  if (decision !== "accepted" && decision !== "rejected") fail("Décision invalide");
  let analysis: Awaited<ReturnType<typeof loadNativeReviewAuthorAnalysis>>;
  const resolved = resolvedLocation(app, reviewId, location);
  try { analysis = await loadNativeReviewAuthorAnalysis(app, reviewId, resolved); } catch (error) { throw new NativeReviewAuthorDecisionError(error instanceof Error ? error.message : String(error)); }
  const document = analysis.analyses.find((item) => item.documentId === documentId); const change = document?.changes[changeIndex];
  if (!document || !change) fail("Modification introuvable");
  const loaded = await loadStore(app, resolved, reviewId, analysis.round.round); let record = loaded.store.documents.find((item) => item.documentId === documentId);
  if (!record) { record = { documentId, decisions: [] }; loaded.store.documents.push(record); }
  const control = signature(change, changeIndex); const existing = record.decisions.find((item) => item.changeIndex === changeIndex);
  if (existing && !same(existing, control)) fail("Signature de décision incohérente");
  if (change.reason === "already-applied") {
    if (decision === "rejected") fail("Une modification déjà appliquée ne peut pas être rejetée");
    if (existing?.decision === "accepted" && existing.applied) return;
    record.decisions = record.decisions.filter((item) => item.changeIndex !== changeIndex);
    record.decisions.push({ ...control, decision: "accepted", applied: true, decidedAt: new Date().toISOString() });
    try { await saveStore(app, loaded); } catch (error) { throw new NativeReviewAuthorDecisionError(`Enregistrement décision impossible : ${error instanceof Error ? error.message : String(error)}`); }
    return;
  }
  if (existing?.decision === "accepted" && existing.applied) {
    if (decision === "rejected") fail("Une modification déjà appliquée ne peut pas être rejetée");
    return;
  }
  const now = new Date().toISOString();
  if (decision === "rejected") { if (existing?.decision === "rejected") return; record.decisions = record.decisions.filter((item) => item.changeIndex !== changeIndex); record.decisions.push({ ...control, decision, applied: false, decidedAt: now }); await saveStore(app, loaded); return; }
  if (change.confidence !== "safe" || change.reason !== "non-overlapping") fail("Modification non applicable automatiquement");
  if (change.currentStart === undefined || change.currentEnd === undefined || document.authorMarkdown === undefined) fail("Coordonnées d’application absentes");
  const root = getManuscriptRoot(app, settings); if (!(root instanceof TFolder)) fail("Manuscrit actif introuvable");
  const source = document.localSourcePath ? app.vault.getAbstractFileByPath(document.localSourcePath) : null;
  if (!(source instanceof TFile) || source.extension !== "md" || !under(root, source)) fail("Source locale hors Manuscrit actif");
  const raw = await app.vault.read(source); const body = stripFrontmatter(raw);
  if (body !== document.authorMarkdown || body.slice(change.currentStart, change.currentEnd) !== change.oldText) fail("Source modifiée depuis l’analyse");
  if (!record.snapshotStamp) {
    try { record.snapshotStamp = await snapshotFile(app, source, root); } catch (error) { throw new NativeReviewAuthorDecisionError(`Snapshot impossible : ${error instanceof Error ? error.message : String(error)}`); }
    try { await saveStore(app, loaded); } catch (error) { throw new NativeReviewAuthorDecisionError(`Enregistrement du snapshot impossible : ${error instanceof Error ? error.message : String(error)}`); }
  }
  const beforeWrite = await app.vault.read(source); if (beforeWrite !== raw) fail("Source modifiée depuis l’analyse");
  const prefix = raw.slice(0, raw.length - body.length); const newRaw = prefix + body.slice(0, change.currentStart) + change.newText + body.slice(change.currentEnd);
  try { await app.vault.modify(source, newRaw); } catch (error) { throw new NativeReviewAuthorDecisionError(`Écriture Manuscrit impossible : ${error instanceof Error ? error.message : String(error)}`); }
  record.decisions = record.decisions.filter((item) => item.changeIndex !== changeIndex); record.decisions.push({ ...control, decision, applied: true, decidedAt: now });
  try { await saveStore(app, loaded); } catch (error) { throw new NativeReviewAuthorDecisionError(`Enregistrement décision impossible : ${error instanceof Error ? error.message : String(error)}`); }
}

/** Décide un groupe en une seule opération de document. Toutes les
 * validations précèdent le snapshot, l'écriture Markdown et la persistance
 * du store ; les changements sont ensuite appliqués en mémoire de droite à
 * gauche et la source n'est écrite qu'une fois. */
export async function decideNativeReviewAuthorGroup(
  app: App, settings: FeuilletsSettings, reviewId: string, documentId: string,
  changeIndexes: number[], decision: Decision, location?: NativeReviewStorageLocation
): Promise<void> {
  if (decision !== "accepted" && decision !== "rejected") fail("Décision invalide");
  if (!Array.isArray(changeIndexes) || changeIndexes.length === 0 || new Set(changeIndexes).size !== changeIndexes.length || changeIndexes.some((index) => !Number.isSafeInteger(index) || index < 0)) fail("Groupe invalide");
  const resolved = resolvedLocation(app, reviewId, location);
  const analysis = await loadNativeReviewAuthorAnalysis(app, reviewId, resolved);
  const document = analysis.analyses.find((item) => item.documentId === documentId);
  if (!document) fail("Document introuvable");
  const changes = changeIndexes.map((index) => {
    const change = document.changes[index]; if (!change) fail("Modification introuvable"); return { index, change, control: signature(change, index) };
  });
  const loaded = await loadStore(app, resolved, reviewId, analysis.round.round);
  let record = loaded.store.documents.find((item) => item.documentId === documentId);
  if (!record) { record = { documentId, decisions: [] }; loaded.store.documents.push(record); }
  for (const item of changes) {
    const existing = record.decisions.find((stored) => stored.changeIndex === item.index);
    if (existing && !same(existing, item.control)) fail("Signature de décision incohérente");
    if (existing && existing.decision !== decision) fail("Décision déjà enregistrée différemment");
  }
  if (changes.every((item) => record.decisions.some((stored) => stored.changeIndex === item.index && stored.decision === decision))) return;
  if (changes.some((item) => record.decisions.some((stored) => stored.changeIndex === item.index))) fail("Groupe partiellement décidé");
  const now = new Date().toISOString();
  if (decision === "rejected") {
    if (changes.some((item) => item.change.reason === "already-applied")) fail("Une modification déjà appliquée ne peut pas être rejetée");
    record.decisions.push(...changes.map((item) => ({ ...item.control, decision: "rejected" as const, applied: false, decidedAt: now })));
    await saveStore(app, loaded); return;
  }
  if (changes.some((item) => item.change.reason !== "already-applied" && (item.change.confidence !== "safe" || item.change.reason !== "non-overlapping"))) fail("Le groupe contient une modification non applicable automatiquement");
  const applicable = changes.filter((item) => item.change.reason !== "already-applied");
  let source: TFile | null = null; let manuscriptRoot: TFolder | null = null; let raw = ""; let body = ""; let nextRaw: string | null = null;
  if (applicable.length) {
    const root = getManuscriptRoot(app, settings); if (!(root instanceof TFolder)) fail("Manuscrit actif introuvable"); manuscriptRoot = root;
    const sourceEntry = document.localSourcePath ? app.vault.getAbstractFileByPath(document.localSourcePath) : null; source = sourceEntry instanceof TFile ? sourceEntry : null;
    if (!(source instanceof TFile) || source.extension !== "md" || !under(root, source)) fail("Source locale hors Manuscrit actif");
    raw = await app.vault.read(source); body = stripFrontmatter(raw);
    if (body !== document.authorMarkdown) fail("Source modifiée depuis l’analyse");
    const ordered = [...applicable].sort((a, b) => (b.change.currentStart ?? -1) - (a.change.currentStart ?? -1));
    let previousStart = Number.POSITIVE_INFINITY; let nextBody = body;
    for (const item of ordered) {
      const { currentStart, currentEnd, oldText, newText } = item.change;
      if (currentStart === undefined || currentEnd === undefined || currentStart < 0 || currentEnd < currentStart || currentEnd > previousStart || body.slice(currentStart, currentEnd) !== oldText) fail("Plages du groupe invalides");
      nextBody = nextBody.slice(0, currentStart) + newText + nextBody.slice(currentEnd); previousStart = currentStart;
    }
    nextRaw = raw.slice(0, raw.length - body.length) + nextBody;
  }
  if (source && manuscriptRoot && !record.snapshotStamp) record.snapshotStamp = await snapshotFile(app, source, manuscriptRoot);
  if (source && nextRaw !== null) {
    if (await app.vault.read(source) !== raw) fail("Source modifiée depuis l’analyse");
    await app.vault.modify(source, nextRaw);
  }
  record.decisions.push(...changes.map((item) => ({ ...item.control, decision: "accepted" as const, applied: true, decidedAt: now })));
  await saveStore(app, loaded);
}
