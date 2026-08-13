import { TFile, TFolder, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { getManuscriptRoot } from "./folder-structure.js";
import { stripFrontmatter } from "./frontmatter.js";
import { createNativeReviewPackage, readNativeReviewPackage, type NativeReviewPackage } from "./native-review-package.js";
import { assertNativeReviewThreadEvolution, loadNativeReviewThreads } from "./native-review-threads.js";
import { appendReviewRound, currentReviewRound, loadReviewSession, reviewRoundsRootPath, saveReviewSession, type ReviewSession } from "./native-review-session.js";
import { loadNativeReviewAuthorDecisionState } from "./native-review-author-decisions.js";

export class NativeReviewAuthorNextRoundError extends Error { constructor(message: string) { super(message); this.name = "NativeReviewAuthorNextRoundError"; } }
export interface NativeReviewAuthorNextRoundResult { session: ReviewSession; packageData: Uint8Array; localPackagePath: string; reviewPackage: NativeReviewPackage; }
function fail(message: string): never { throw new NativeReviewAuthorNextRoundError(message); }
function copy(session: ReviewSession): ReviewSession { return JSON.parse(JSON.stringify(session)) as ReviewSession; }
function id(): string { if (!crypto?.getRandomValues) fail("Web Crypto indisponible"); const b = crypto.getRandomValues(new Uint8Array(16)); return `package-${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`; }
function under(root: TFolder, file: TFile): boolean { return file.path.startsWith(`${root.path}/`); }
export async function createNativeReviewAuthorNextRound(app: App, settings: FeuilletsSettings, reviewId: string, createdByVersion: string): Promise<NativeReviewAuthorNextRoundResult> {
  const session = await loadReviewSession(app, reviewId); if (!session || session.localRole !== "author" || session.status !== "active") fail("Session auteur active introuvable");
  const round = currentReviewRound(session); if (!round.sent || !round.received) fail("Le tour courant doit être complet");
  const state = await loadNativeReviewAuthorDecisionState(app, reviewId); if (!state.complete) fail("Toutes les décisions du tour doivent être prises");
  const receivedPath = normalizePath(`${reviewRoundsRootPath(reviewId)}/round-${round.round}-received.feuillets`); const receivedFile = app.vault.getAbstractFileByPath(receivedPath); if (!(receivedFile instanceof TFile)) fail("Archive reviewer reçue introuvable");
  const receivedPackage = await readNativeReviewPackage(new Uint8Array(await app.vault.readBinary(receivedFile)));
  const threads = await loadNativeReviewThreads(app, reviewId); assertNativeReviewThreadEvolution(receivedPackage.threads, threads.threads, session.participants, session.documents, "author");
  const root = getManuscriptRoot(app, settings); if (!(root instanceof TFolder)) fail("Manuscrit actif introuvable");
  const sources = await Promise.all(session.documents.map(async (document) => {
    const entry = document.localSourcePath ? app.vault.getAbstractFileByPath(document.localSourcePath) : null;
    if (!(entry instanceof TFile) || entry.extension !== "md" || !under(root, entry)) fail(`Source locale invalide : ${document.documentId}`);
    // Le paquet est un échange de contenu, jamais un véhicule de métadonnées
    // privées du Manuscrit.
    return { document, markdown: stripFrontmatter(await app.vault.read(entry)) };
  }));
  const sentAt = new Date().toISOString(); const packageId = id(); const nextRound = round.round + 1;
  const packageData = await createNativeReviewPackage({ packageId, createdAt: sentAt, createdByVersion, reviewId, round: nextRound, senderRole: "author", participants: session.participants }, sources.map(({ document, markdown }) => ({ documentId: document.documentId, originalPath: document.originalPath, title: document.title, baseMarkdown: markdown })), threads.threads);
  const nextSession = copy(session); appendReviewRound(nextSession, { packageId, at: sentAt }); nextSession.updatedAt = sentAt;
  const localPackagePath = normalizePath(`${reviewRoundsRootPath(reviewId)}/round-${nextRound}-sent.feuillets`); if (app.vault.getAbstractFileByPath(localPackagePath)) fail("Archive du tour suivant déjà présente");
  const bytes = new Uint8Array(packageData.byteLength); bytes.set(packageData);
  try { await app.vault.createBinary(localPackagePath, bytes.buffer); } catch (error) { throw new NativeReviewAuthorNextRoundError(`Archivage impossible : ${error instanceof Error ? error.message : String(error)}`); }
  try { await saveReviewSession(app, nextSession); } catch (error) { throw new NativeReviewAuthorNextRoundError(`Mise à jour de session impossible : ${error instanceof Error ? error.message : String(error)}`); }
  const reviewPackage = await (await import("./native-review-package.js")).readNativeReviewPackage(packageData);
  return { session: nextSession, packageData, localPackagePath, reviewPackage };
}
