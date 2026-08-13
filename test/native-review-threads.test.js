import test from "node:test";
import assert from "node:assert/strict";
import { assertNativeReviewThreadEvolution, validateNativeReviewThreads } from "../src/services/native-review-threads.js";

const people = [{ id: "alice", role: "author" }, { id: "bob", role: "reviewer" }];
const docs = [{ documentId: "chapter-1" }];
const thread = () => ({ threadId: `thread-${"a".repeat(32)}`, documentId: "chapter-1", anchor: { start: 1, end: 4, quote: "ext", prefix: "T", suffix: "e" }, createdByParticipantId: "bob", createdAt: "2026-08-13T10:00:00.000Z", status: "open", messages: [{ messageId: `message-${"b".repeat(32)}`, participantId: "bob", text: "Commentaire", createdAt: "2026-08-13T10:00:00.000Z" }] });

test("valide le store strict et l’append-only", () => {
  const initial = thread(); validateNativeReviewThreads({ version: 1, threads: [initial] }, people, docs);
  const next = JSON.parse(JSON.stringify(initial)); next.messages.push({ messageId: `message-${"c".repeat(32)}`, participantId: "alice", text: "Réponse", createdAt: "2026-08-13T10:01:00.000Z" });
  assert.doesNotThrow(() => assertNativeReviewThreadEvolution([initial], [next], people, docs, "author"));
  const modified = JSON.parse(JSON.stringify(next)); modified.messages[0].text = "altéré";
  assert.throws(() => assertNativeReviewThreadEvolution([initial], [modified], people, docs, "author"));
  assert.throws(() => validateNativeReviewThreads({ version: 1, threads: [{ ...initial, documentId: "unknown" }] }, people, docs));
});
