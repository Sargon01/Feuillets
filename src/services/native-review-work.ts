import type { App } from "obsidian";
import { comparisonRightAnchor, comparisonRightOffsets, type ComparisonChange } from "./comparison-model.js";
import { loadNativeReviewAuthorAnalysis } from "./native-review-author-return.js";
import { loadNativeReviewAuthorDecisionState } from "./native-review-author-decisions.js";
import { groupNativeReviewChanges } from "./native-review-change-groups.js";
import { loadNativeReviewThreads, type NativeReviewThread } from "./native-review-threads.js";
import type { NativeReviewStorageLocation } from "./native-review-storage.js";
import type { ReviewSession } from "./native-review-session.js";

/**
 * Projection unique du retour du relecteur vers ce que l'auteur doit traiter :
 * des changements (Appliquer / Ignorer) et des notes (Traité). Le panneau et la
 * comparaison côte à côte lisent tous les deux ce même objet, pour qu'ils ne
 * puissent jamais raconter deux histoires différentes.
 */
export interface NativeReviewWorkChange extends ComparisonChange {
  /** Le relecteur propose ce que l'auteur a déjà écrit de son côté. */
  alreadyApplied: boolean;
  decision: "accepted" | "rejected" | null;
}

export interface NativeReviewWorkNote {
  threadId: string;
  /** Ancre complète : le contexte est nécessaire pour retrouver le passage
   * quand la citation apparaît plusieurs fois. */
  anchor: NativeReviewThread["anchor"];
  quote: string;
  author: string;
  messages: Array<{ author: string; text: string }>;
  resolved: boolean;
}

export interface NativeReviewWorkDocument {
  documentId: string;
  title: string;
  localSourcePath?: string;
  /** Texte actuel de l'auteur, sans frontmatter. Absent si le feuillet a disparu. */
  authorMarkdown?: string;
  /** Texte tel que le relecteur l'a retourné. */
  reviewerMarkdown: string;
  changes: NativeReviewWorkChange[];
  notes: NativeReviewWorkNote[];
}

export interface NativeReviewWork {
  session: ReviewSession;
  documents: NativeReviewWorkDocument[];
  pendingChanges: number;
  pendingNotes: number;
}

function noteFor(thread: NativeReviewThread, names: Map<string, string>): NativeReviewWorkNote {
  return {
    threadId: thread.threadId,
    anchor: thread.anchor,
    quote: thread.anchor.quote,
    author: names.get(thread.createdByParticipantId) || thread.createdByParticipantId,
    messages: thread.messages.map((message) => ({ author: names.get(message.participantId) || message.participantId, text: message.text })),
    resolved: thread.status === "resolved",
  };
}

export async function loadNativeReviewWork(app: App, reviewId: string, location?: NativeReviewStorageLocation): Promise<NativeReviewWork> {
  const analysis = await loadNativeReviewAuthorAnalysis(app, reviewId, location);
  const decisions = await loadNativeReviewAuthorDecisionState(app, reviewId, location);
  let threads: NativeReviewThread[];
  try { threads = (await loadNativeReviewThreads(app, reviewId, location)).threads; } catch { threads = []; }
  const names = new Map(analysis.session.participants.map((person) => [person.id, person.name]));

  const documents = analysis.analyses.map((document): NativeReviewWorkDocument => {
    const stored = decisions.store.documents.find((item) => item.documentId === document.documentId)?.decisions ?? [];
    const offsets = comparisonRightOffsets(document.changes);
    const changes = groupNativeReviewChanges(document.documentId, document.changes, document.baseMarkdown, document.authorMarkdown).map((group, index): NativeReviewWorkChange => {
      const members = group.changeIndexes.map((position) => document.changes[position]);
      const found = group.changeIndexes.map((position) => stored.find((item) => item.changeIndex === position));
      const decision = found.some((item) => !item) ? null : found.every((item) => item?.decision === "accepted") ? "accepted" as const : "rejected" as const;
      const rightStart = comparisonRightAnchor(group, document.changes, offsets);
      const alreadyApplied = members.every((change) => change.reason === "already-applied");
      return {
        index, changeIndexes: group.changeIndexes,
        kind: group.kind, oldText: group.oldText, newText: group.newText,
        ...(group.currentStart !== undefined && group.currentEnd !== undefined ? { leftStart: group.currentStart, leftEnd: group.currentEnd } : {}),
        rightStart, rightEnd: rightStart + group.newText.length,
        applicable: members.every((change) => change.reason === "already-applied" || (change.confidence === "safe" && change.reason === "non-overlapping")),
        handled: decision !== null,
        alreadyApplied, decision,
      };
    });
    return {
      documentId: document.documentId, title: document.title, localSourcePath: document.localSourcePath,
      authorMarkdown: document.authorMarkdown, reviewerMarkdown: document.reviewerMarkdown, changes,
      notes: threads.filter((thread) => thread.documentId === document.documentId)
        .sort((left, right) => left.anchor.start - right.anchor.start || left.threadId.localeCompare(right.threadId))
        .map((thread) => noteFor(thread, names)),
    };
  });

  return {
    session: analysis.session, documents,
    pendingChanges: documents.reduce((total, document) => total + document.changes.filter((change) => !change.handled).length, 0),
    pendingNotes: documents.reduce((total, document) => total + document.notes.filter((note) => !note.resolved).length, 0),
  };
}
