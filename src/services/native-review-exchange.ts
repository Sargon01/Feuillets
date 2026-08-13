import { TFolder } from "obsidian";
import type { App } from "obsidian";
import { loadNativeReviewAuthorDecisionState } from "./native-review-author-decisions.js";
import { receiveNativeReviewReturnForAuthor } from "./native-review-author-return.js";
import { readNativeReviewPackage } from "./native-review-package.js";
import { receiveNativeReviewNextRoundForReviewer } from "./native-review-reviewer-next-round.js";
import { receiveNativeReviewForReviewer } from "./native-review-reviewer.js";
import { currentReviewRound, loadReviewSession, reviewSessionsRootPath, saveReviewSession, type ReviewSession } from "./native-review-session.js";

export class NativeReviewExchangeError extends Error {
  constructor(message: string) { super(message); this.name = "NativeReviewExchangeError"; }
}

export type NativeReviewSessionEntry =
  | { reviewId: string; session: ReviewSession; error?: never }
  | { reviewId: string; session?: never; error: string };

function fail(message: string): never { throw new NativeReviewExchangeError(message); }

/** Lists only local native-review sessions; malformed folders remain visible to callers. */
export async function listNativeReviewSessions(app: App): Promise<NativeReviewSessionEntry[]> {
  const root = app.vault.getAbstractFileByPath(reviewSessionsRootPath());
  if (!root) return [];
  if (!(root instanceof TFolder)) fail("Le dossier des relectures est invalide");
  const entries = await Promise.all(root.children.map(async (child) => {
    if (!(child instanceof TFolder)) return { reviewId: child.path.split("/").pop() || child.path, error: "Entrée de session invalide" };
    const reviewId = child.name;
    try {
      const session = await loadReviewSession(app, reviewId);
      return session ? { reviewId, session } : { reviewId, error: "session.json absent" };
    }
    catch (error) { return { reviewId, error: error instanceof Error ? error.message : String(error) }; }
  }));
  return entries.sort((left, right) => {
    const leftAt = left.session?.updatedAt || ""; const rightAt = right.session?.updatedAt || "";
    return rightAt.localeCompare(leftAt) || left.reviewId.localeCompare(right.reviewId);
  });
}

/** Reads before routing so an invalid or incompatible package is never written. */
export async function receiveNativeReviewExchange(app: App, packageData: ArrayBuffer | Uint8Array): Promise<ReviewSession> {
  let incoming: Awaited<ReturnType<typeof readNativeReviewPackage>>;
  try { incoming = await readNativeReviewPackage(packageData); }
  catch (error) { fail(`Paquet de relecture invalide : ${error instanceof Error ? error.message : String(error)}`); }
  let session: ReviewSession | null;
  try { session = await loadReviewSession(app, incoming.manifest.reviewId); }
  catch (error) { fail(`Session locale illisible : ${error instanceof Error ? error.message : String(error)}`); }
  try {
    if (incoming.manifest.senderRole === "author" && incoming.manifest.round === 1 && !session) {
      return (await receiveNativeReviewForReviewer(app, packageData)).session;
    }
    if (incoming.manifest.senderRole === "author" && incoming.manifest.round >= 2 && session?.localRole === "reviewer" && session.status === "active") {
      return (await receiveNativeReviewNextRoundForReviewer(app, new Uint8Array(packageData))).session;
    }
    if (incoming.manifest.senderRole === "reviewer" && session?.localRole === "author" && session.status === "active") {
      return (await receiveNativeReviewReturnForAuthor(app, incoming.manifest.reviewId, packageData)).session;
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

export async function completeNativeReviewSession(app: App, reviewId: string): Promise<ReviewSession> {
  let session: ReviewSession | null;
  try { session = await loadReviewSession(app, reviewId); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  if (!session || session.status !== "active") fail("La session doit être active pour être terminée");
  const round = currentReviewRound(session);
  if (!round.sent || !round.received) fail("Le tour courant doit être envoyé et reçu");
  if (session.localRole === "author") {
    const decisions = await loadNativeReviewAuthorDecisionState(app, reviewId);
    if (!decisions.complete) fail("Toutes les décisions auteur doivent être prises");
  }
  const completed = copySession(session);
  completed.status = "completed";
  completed.updatedAt = new Date().toISOString();
  try { return await saveReviewSession(app, completed); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
}
