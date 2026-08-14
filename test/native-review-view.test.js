import test from "node:test";
import assert from "node:assert/strict";
import { MarkdownView, TFile } from "obsidian";
import { focusNativeReviewThreadCard, handleNativeReviewImportBuffer, nativeReviewDocumentForPath, nativeReviewReviewerActions, nativeReviewStage, nativeReviewWorkingSelection } from "../src/views/native-review-view.js";
import { nativeReviewThreadActions, renderNativeReviewThreadControls } from "../src/ui/native-review-thread-popover.js";

class FakeElement {
  constructor(tag = "div", options = {}) { this.tag = tag; this.text = options.text ?? ""; this.attributes = options.attr ?? {}; this.children = []; this.listeners = new Map(); this.value = ""; }
  createDiv(options = {}) { const child = new FakeElement("div", options); this.children.push(child); return child; }
  createEl(tag, options = {}) { const child = new FakeElement(tag, options); this.children.push(child); return child; }
  empty() { this.children = []; }
  addClass() {}
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  focus() {}
  click() { this.listeners.get("click")?.({ stopPropagation() {} }); }
}
const renderedActions = (root) => {
  const result = [];
  const visit = (node) => { if (node.attributes["data-native-review-action"]) result.push(node.attributes["data-native-review-action"]); for (const child of node.children) visit(child); };
  visit(root); return result;
};
const renderNote = (status, readOnly = false) => {
  const root = new FakeElement();
  renderNativeReviewThreadControls(root, { status, readOnly, onHandled: async () => {} }); return root;
};

const makeView = (path, from, to) => Object.assign(new MarkdownView(), {
  file: new TFile(path, "texte"),
  editor: { getCursor: (side) => side === "from" ? from : to, posToOffset: (position) => position.offset },
});

const session = {
  version: 1, reviewId: "review", localRole: "reviewer", status: "active", createdAt: "2026-08-13T10:00:00.000Z", updatedAt: "2026-08-13T10:00:00.000Z",
  participants: [{ id: "hy", name: "HY", role: "author" }, { id: "pierre", name: "Pierre", role: "reviewer" }], documents: [
    { documentId: "working", originalPath: "Original.md", title: "Working", localSourcePath: "_Feuillets/Relectures/review/working/working.md" },
    { documentId: "other", originalPath: "Other.md", title: "Other", localSourcePath: "_Feuillets/Relectures/review/working/other.md" },
  ], rounds: [{ round: 1, createdAt: "2026-08-13T10:00:00.000Z", received: { packageId: "received", at: "2026-08-13T10:00:00.000Z" } }],
};
const authorSession = (extra = {}) => ({
  ...session, localRole: "author",
  rounds: [{ round: 1, createdAt: session.createdAt, sent: { packageId: "sent", at: session.createdAt } }], ...extra,
});

test("relecture : l'auteur ne connaît que trois moments, jamais un tour", () => {
  const sent = authorSession();
  assert.equal(nativeReviewStage(sent), "sent");
  const returned = authorSession({ rounds: [{ ...authorSession().rounds[0], received: { packageId: "back", at: session.updatedAt } }] });
  assert.equal(nativeReviewStage(returned), "toHandle");
  assert.equal(nativeReviewStage({ ...returned, status: "completed" }), "finished");
});

test("relecture : le relecteur relit puis retourne, sans jamais importer de nouvelle version", () => {
  assert.deepEqual(nativeReviewReviewerActions(session), ["return"]);
  const returned = { ...session, rounds: [{ ...session.rounds[0], sent: { packageId: "return", at: "2026-08-13T11:00:00.000Z" } }] };
  assert.deepEqual(nativeReviewReviewerActions(returned), ["resend", "archive"]);
  assert.deepEqual(nativeReviewReviewerActions(returned, true), []);
  assert.deepEqual(nativeReviewReviewerActions({ ...returned, status: "completed" }), []);
});

test("relecture : une note n'a qu'une issue, traitée, et jamais de réponse", () => {
  assert.deepEqual(nativeReviewThreadActions("open"), ["handled"]);
  assert.deepEqual(nativeReviewThreadActions("resolved"), []);
  assert.deepEqual(nativeReviewThreadActions("open", true), []);
  assert.deepEqual(renderedActions(renderNote("open")), ["handled"]);
  assert.deepEqual(renderedActions(renderNote("resolved")), []);
  assert.deepEqual(renderedActions(renderNote("open", true)), []);
});

test("relecture : un fichier extérieur ne produit aucun contexte document", () => {
  assert.equal(nativeReviewDocumentForPath(session.documents, "Hors-session.md"), undefined);
});

test("relecture : un import illisible n'entre jamais dans l'interface", async () => {
  const events = [];
  const bridge = {
    receive: async () => { throw new Error("paquet cassé"); },
    select: () => events.push("select"), refreshEditor: async () => events.push("refresh"), render: async () => events.push("render"),
    openWorking: async () => events.push("open"), notice: (message) => events.push(message), diagnostic: () => events.push("diagnostic"),
  };
  assert.equal(await handleNativeReviewImportBuffer(new ArrayBuffer(4), bridge), null);
  assert.deepEqual(events, ["diagnostic", "Impossible d’importer ce paquet : il ne correspond pas à l’état actuel de la relecture."]);
});

test("relecture : clic note ouvre le bon document, résout l’ancre et demande un seul popover", async () => {
  const calls = []; const target = {}; const contentEl = { querySelector: (selector) => selector.includes("thread-a") ? target : null };
  const editor = { getValue: () => "Avant passage commenté après", offsetToPos: (offset) => ({ offset }), setSelection: (from, to) => calls.push(["selection", from.offset, to.offset]), scrollIntoView: ({ from, to }) => calls.push(["scroll", from.offset, to.offset]) };
  const thread = { threadId: "thread-a", anchor: { start: 6, end: 22, quote: "passage commenté", prefix: "Avant ", suffix: " après" } };
  let active = null; const bridge = { openDocument: async (path) => { calls.push(["open", path]); return { editor, contentEl }; }, refresh: async () => { calls.push(["refresh"]); }, openPopover: async (threadId, anchor) => { active = threadId; calls.push(["popover", threadId, anchor === target]); } };
  assert.equal(await focusNativeReviewThreadCard(thread, "working.md", bridge), true);
  assert.deepEqual(calls, [["open", "working.md"], ["selection", 6, 22], ["scroll", 6, 22], ["refresh"], ["popover", "thread-a", true]]); assert.equal(active, "thread-a");
});

test("relecture : retrouve la sélection working depuis les leaves Markdown malgré le focus sidebar", () => {
  const selected = makeView("_Feuillets/Relectures/review/working/working.md", { offset: 3 }, { offset: 9 });
  const foreign = makeView("_Feuillets/Relectures/other/working/working.md", { offset: 1 }, { offset: 8 });
  const app = { workspace: { getActiveFile: () => null, getLeavesOfType: () => [{ view: foreign }, { view: selected }] } };
  const found = nativeReviewWorkingSelection(app, session);
  assert.equal(found?.document.documentId, "working"); assert.equal(found?.start, 3); assert.equal(found?.end, 9);
});

test("relecture : une sélection vide est retrouvée, mais les autres workings sont ignorés", () => {
  const empty = makeView("_Feuillets/Relectures/review/working/working.md", { offset: 4 }, { offset: 4 });
  const otherSession = makeView("_Feuillets/Relectures/else/working/other.md", { offset: 1 }, { offset: 7 });
  const app = { workspace: { getActiveFile: () => empty.file, getLeavesOfType: () => [{ view: otherSession }, { view: empty }] } };
  const found = nativeReviewWorkingSelection(app, session);
  assert.equal(found?.document.documentId, "working"); assert.equal(found?.start, found?.end);
});
