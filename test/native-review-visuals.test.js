import test from "node:test";
import assert from "node:assert/strict";
import { applyNativeReviewThreadHighlights, clearNativeReviewThreadHighlights, nativeReviewThreadHighlightField, resolveNativeReviewThreadAnchor, setNativeReviewThreadsEffect } from "../src/utils/cm-native-review-highlighter.js";

test("native review: seules les notes sont décorées dans l'éditeur", () => {
  const dispatched = [];
  const view = { state: { doc: { length: 20 } }, dispatch: (spec) => dispatched.push(spec.effects) };
  applyNativeReviewThreadHighlights(view, [{ threadId: "thread", reviewId: "review", documentId: "doc", anchor: { start: 1, end: 2, quote: "b", prefix: "", suffix: "" } }], "abc");
  clearNativeReviewThreadHighlights(view);
  assert.equal(dispatched.length, 2);
  for (const effect of dispatched) assert.ok("value" in effect);
  const unrelated = { is: () => false, value: [] };
  assert.doesNotThrow(() => nativeReviewThreadHighlightField.update({ map: () => [] }, { docChanged: false, changes: null, effects: [unrelated] }));
  assert.deepEqual(nativeReviewThreadHighlightField.update([], { docChanged: false, changes: null, effects: [{ is: (type) => type === setNativeReviewThreadsEffect, value: ["next"] }] }), ["next"]);
});

test("native review: une note dont l'ancre a bougé n'est jamais placée au hasard", () => {
  assert.deepEqual(resolveNativeReviewThreadAnchor({ start: 6, end: 22, quote: "passage commenté", prefix: "Avant ", suffix: " après" }, "Avant passage commenté après"), { start: 6, end: 22 });
  assert.deepEqual(resolveNativeReviewThreadAnchor({ start: 0, end: 8, quote: "passage commenté", prefix: "Avant ", suffix: " après" }, "Décalé Avant passage commenté après"), { start: 13, end: 29 });
  assert.equal(resolveNativeReviewThreadAnchor({ start: 0, end: 5, quote: "absent", prefix: "", suffix: "" }, "Aucun rapport"), null);
});
