import { TFolder } from "obsidian";
import type { App } from "obsidian";
import { loadNativeReviewAuthorDecisionState } from "./native-review-author-decisions.js";
import { receiveNativeReviewReturnForAuthor } from "./native-review-author-return.js";
import { readNativeReviewPackage } from "./native-review-package.js";
import { receiveNativeReviewForReviewer } from "./native-review-reviewer.js";
import { currentReviewRound, loadReviewSession, saveReviewSession, type ReviewSession } from "./native-review-session.js";
import { loadNativeReviewThreads } from "./native-review-threads.js";
import { authorReviewStorageLocation, discoverNativeReviewStorageLocation, findNativeReviewSessionLocations, legacyGlobalAuthorStorageLocation, reviewerReviewStorageLocation, type NativeReviewStorageLocation } from "./native-review-storage.js";
import { getManuscriptRoot } from "./folder-structure.js";

export class NativeReviewExchangeError extends Error {
  constructor(message: string) { super(message); this.name = "NativeReviewExchangeError"; }
}

export type NativeReviewSessionEntry =
  | { reviewId: string; location: NativeReviewStorageLocation; session: ReviewSession; error?: never }
  | { reviewId: string; location: NativeReviewStorageLocation; session?: never; error: string };

function fail(message: string): never { throw new NativeReviewExchangeError(message); }
function belongsToActiveProject(app: App, settings: FeuilletsSettings | undefined, session: ReviewSession): boolean { const root = settings ? getManuscriptRoot(app, settings) : null; return !!root && session.documents.every((document) => !!document.localSourcePath && document.localSourcePath.startsWith(`${root.path}/`)); }

/** Lists only local native-review sessions; malformed folders remain visible to callers. */
export async function listNativeReviewSessions(app: App, settings?: FeuilletsSettings): Promise<NativeReviewSessionEntry[]> {
  const locations: NativeReviewStorageLocation[] = [reviewerReviewStorageLocation()];
  const author = settings ? authorReviewStorageLocation(app, settings) : null;
  if (author && author.sessionsRootPath !== locations[0].sessionsRootPath) locations.unshift(author);
  const entries: NativeReviewSessionEntry[] = [];
  for (const location of locations) {
    const root = app.vault.getAbstractFileByPath(location.sessionsRootPath);
    if (!root) continue;
    if (!(root instanceof TFolder)) fail("Le dossier des relectures est invalide");
    for (const child of root.children) {
      const reviewId = child.name;
      if (!(child instanceof TFolder)) { entries.push({ reviewId, location, error: "Entrée de session invalide" }); continue; }
      try {
        const session = await loadReviewSession(app, location, reviewId);
        if (!session) entries.push({ reviewId, location, error: "session.json absent" });
        else if ((location.kind === "author-project" && session.localRole === "author") || (location.kind === "reviewer-inbox" && (session.localRole === "reviewer" || belongsToActiveProject(app, settings, session)))) entries.push({ reviewId, location: location.kind === "reviewer-inbox" && session.localRole === "author" ? legacyGlobalAuthorStorageLocation() : location, session });
      } catch (error) { entries.push({ reviewId, location, error: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return entries.sort((left, right) => {
    const leftAt = left.session?.updatedAt || ""; const rightAt = right.session?.updatedAt || "";
    return rightAt.localeCompare(leftAt) || left.reviewId.localeCompare(right.reviewId);
  });
}

/** Reads before routing so an invalid or incompatible package is never written. */
export async function receiveNativeReviewExchange(app: App, packageData: ArrayBuffer | Uint8Array, settings?: FeuilletsSettings): Promise<ReviewSession> {
  let incoming: Awaited<ReturnType<typeof readNativeReviewPackage>>;
  try { incoming = await readNativeReviewPackage(packageData); }
  catch (error) { fail(`Paquet de relecture invalide : ${error instanceof Error ? error.message : String(error)}`); }
  const reviewId = incoming.manifest.reviewId;
  try {
    // Une relecture est toujours un aller-retour unique : un paquet auteur ne
    // peut donc ouvrir qu'une session neuve chez le relecteur.
    if (incoming.manifest.senderRole === "author") {
      const location = reviewerReviewStorageLocation(); const session = await loadReviewSession(app, location, reviewId);
      if (!session) return (await receiveNativeReviewForReviewer(app, packageData)).session;
    }
    if (incoming.manifest.senderRole === "reviewer") {
      const projectLocation = settings ? authorReviewStorageLocation(app, settings) : null;
      const projectSession = projectLocation ? await loadReviewSession(app, projectLocation, reviewId) : null;
      const legacyLocation = legacyGlobalAuthorStorageLocation();
      const legacySession = await loadReviewSession(app, legacyLocation, reviewId);
      if (projectSession && legacySession) fail(`Collision de session pour ${reviewId}`);
      const usableLegacy = legacySession?.localRole === "author" && belongsToActiveProject(app, settings, legacySession) ? legacySession : null;
      const location = projectSession ? projectLocation : usableLegacy ? legacyLocation : null;
      const session = projectSession ?? usableLegacy;
      if (!session || !location) {
        if (findNativeReviewSessionLocations(app, reviewId).length) fail("Ouvrez le projet concerné avant d’importer ce retour.");
        fail("Ouvrez le projet concerné avant d’importer ce retour.");
      }
      if (session.localRole === "author" && session.status === "active") return (await receiveNativeReviewReturnForAuthor(app, reviewId, packageData, location)).session;
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  return fail("Paquet incompatible avec la session locale (rôle, tour ou état)");
}

function copySession(session: ReviewSession): ReviewSession {
  return {
    version: session.version, reviewId: session.reviewId, localRole: session.localRole, status: session.status,
    createdAt: session.createdAt, updatedAt: session.updatedAt,
    participants: session.participants.map((item) => ({ ...item })),
    documents: session.documents.map((item) => ({ ...item })),
    rounds: session.rounds.map((item) => ({ ...item, ...(item.sent ? { sent: { ...item.sent } } : {}), ...(item.received ? { received: { ...item.received } } : {}) })),
  };
}

/**
 * Termine la relecture. `force` couvre le seul cas où HY arrête avant d'avoir
 * tout traité : les changements non décidés sont simplement laissés de côté et
 * les notes ouvertes restent dans l'historique — le manuscrit, lui, n'est
 * jamais touché ici.
 */
export async function completeNativeReviewSession(app: App, reviewId: string, options: { force?: boolean; location?: NativeReviewStorageLocation } = {}): Promise<ReviewSession> {
  const location = options.location ?? discoverNativeReviewStorageLocation(app, reviewId) ?? legacyGlobalAuthorStorageLocation();
  let session: ReviewSession | null;
  try { session = await loadReviewSession(app, location, reviewId); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  if (!session || session.status !== "active") fail("La session doit être active pour être terminée");
  if (session.localRole !== "author") fail("Seul l’auteur peut terminer la relecture");
  const round = currentReviewRound(session);
  if (!round.sent || !round.received) fail("Le retour du relecteur doit avoir été reçu");
  if (!options.force) {
    const decisions = await loadNativeReviewAuthorDecisionState(app, reviewId, location);
    if (!decisions.complete) fail(`Il reste ${decisions.unresolved.length} changement(s) non traité(s)`);
    const openThreads = (await loadNativeReviewThreads(app, reviewId, location)).threads.filter((thread) => thread.status === "open").length;
    if (openThreads) fail(`Il reste ${openThreads} note(s) non traitée(s)`);
  }
  const completed = copySession(session);
  completed.status = "completed";
  completed.updatedAt = new Date().toISOString();
  try { return await saveReviewSession(app, location, completed); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
}
