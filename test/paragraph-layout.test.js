import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { createSourceAnchor, resolveParagraphSourceAnchor } from "../src/services/source-anchor.js";
import { documentLayoutBlocks, injectDocumentLayoutMarkers, isOrdinaryLayoutParagraph } from "../src/services/document-layout.js";
import { updateParagraphLayoutOverride, applyParagraphLayoutChange, documentLayoutValuesForTarget, toggleDocumentLayoutPageBreak } from "../src/services/document-layout-actions.js";
import { emptyLayoutStore, validateLayoutStore, loadLayoutStore, saveLayoutStore, layoutFilePath, duplicateLayoutForFile, splitLayoutForFiles, mergeLayoutForFiles, remapLayoutAfterRename } from "../src/services/layout-store.js";

const text = "First paragraph.\n\nSecond paragraph.";
const anchor = createSourceAnchor(text, 0, "First paragraph.".length);
const update = (store, patch) => updateParagraphLayoutOverride(store, "Chapter.md", text, anchor, patch);

test("paragraph layout: independent properties, repeat application and individual defaults", () => {
  let store = emptyLayoutStore();
  for (const patch of [{ alignment: "center" }, { firstLineIndentPt: 0 }, { spacingBeforePt: 6 }, { spacingAfterPt: 12 }, { alignment: "right" }]) store = update(store, patch);
  assert.equal(store.overrides.length, 1);
  const { alignment, firstLineIndentPt, spacingBeforePt, spacingAfterPt, id } = store.overrides[0];
  assert.deepEqual({ alignment, firstLineIndentPt, spacingBeforePt, spacingAfterPt }, { alignment: "right", firstLineIndentPt: 0, spacingBeforePt: 6, spacingAfterPt: 12 });
  store = update(store, { alignment: undefined });
  assert.equal(store.overrides[0].id, id);
  assert.equal(store.overrides[0].spacingAfterPt, 12);
  assert.equal("alignment" in store.overrides[0], false);
  store = update(store, { firstLineIndentPt: undefined, spacingBeforePt: undefined, spacingAfterPt: undefined });
  assert.deepEqual(store, emptyLayoutStore());
  assert.equal(injectDocumentLayoutMarkers(text, store.overrides), text);
});

test("paragraph layout: old stores remain valid; invalid and empty properties are rejected", () => {
  const old = { version: 2, overrides: [{ id: "b", file: "Chapter.md", kind: "page-break-before", anchor }] };
  assert.equal(validateLayoutStore(old), true);
  for (const patch of [{ alignment: "center" }, { firstLineIndentPt: 0 }, { spacingBeforePt: 0, spacingAfterPt: 0 }]) assert.equal(validateLayoutStore(update(old, patch)), true);
  for (const patch of [{ alignment: "middle" }, { spacingBeforePt: -1 }, { firstLineIndentPt: NaN }, { spacingAfterPt: Infinity }, { spacingBeforePt: "6" }]) {
    assert.equal(update(emptyLayoutStore(), patch), null);
    assert.equal(validateLayoutStore({ version: 2, overrides: [{ id: "p", file: "Chapter.md", kind: "paragraph-layout", anchor, ...patch }] }), false);
  }
  assert.equal(validateLayoutStore({ version: 2, overrides: [{ id: "p", file: "Chapter.md", kind: "paragraph-layout", anchor }] }), false);
});

test("paragraph layout: exact, moved, repeated, missing and ambiguous anchors", () => {
  assert.deepEqual(resolveParagraphSourceAnchor(anchor, text), { start: 0, end: 16 });
  const moved = `Preface.\n\n${text}`;
  assert.deepEqual(resolveParagraphSourceAnchor(anchor, moved), { start: 10, end: 26 });
  const repeated = "One.\n\nSame.\n\nTwo.\n\nSame.\n\nThree.";
  const secondStart = repeated.lastIndexOf("Same.");
  const first = createSourceAnchor(repeated, repeated.indexOf("Same."), repeated.indexOf("Same.") + 5);
  const second = createSourceAnchor(repeated, secondStart, secondStart + 5);
  let store = updateParagraphLayoutOverride(emptyLayoutStore(), "Chapter.md", repeated, first, { alignment: "left" });
  store = updateParagraphLayoutOverride(store, "Chapter.md", repeated, second, { alignment: "center" });
  assert.equal(store.overrides.length, 2);
  assert.deepEqual(resolveParagraphSourceAnchor(second, repeated), { start: secondStart, end: secondStart + 5 });
  assert.equal(resolveParagraphSourceAnchor({ ...anchor, quote: "Missing." }, text), null);
  assert.equal(resolveParagraphSourceAnchor({ ...anchor, quote: "Same.", prefix: "", suffix: "" }, "Same.\n\nSame."), null);
  const changed = text.replace("First paragraph.", "Unrelated block.");
  assert.equal(updateParagraphLayoutOverride(store, "Chapter.md", changed, anchor, { alignment: "right" }), null);
});

test("paragraph layout: only ordinary top-level paragraphs accept properties", () => {
  for (const source of ["# Heading", "    code", "Text\n===", "- Item\ncontinuation", "> Quotation", "<div>HTML</div>", "```\ncode\n```", "![[image.png]]", "| A | B |\n|---|---|", "[^1]: A note.", "$$\nx + y\n$$", "%% Hidden comment %%"]) {
    for (const block of documentLayoutBlocks(source)) {
      assert.equal(isOrdinaryLayoutParagraph(source, block), false, source);
      const target = createSourceAnchor(source, block.startOffset, block.endOffset);
      assert.equal(updateParagraphLayoutOverride(emptyLayoutStore(), "Chapter.md", source, target, { alignment: "center" }), null, source);
    }
  }
  for (const source of ["Paragraph.", "  Paragraph.", "Paragraph.\r\n\r\nNext.", "Ordinary text | with a pipe."]) assert.equal(isOrdinaryLayoutParagraph(source, documentLayoutBlocks(source)[0]), true);
});

function fixture() {
  const volume = new TFolder("Project");
  const root = new TFolder("Project/Manuscript");
  const markdown = "---\ntitle: Chapter\n---\n\nFirst paragraph.  \n\nSecond paragraph.\n";
  const file = new TFile(`${root.path}/Chapter.md`, markdown);
  volume.children = [root]; root.parent = volume; root.children = [file]; file.parent = root;
  const { vault } = createFakeVault([volume, root, file]);
  return { app: { vault }, settings: { projectFolder: root.path }, root, file, markdown };
}

test("paragraph layout: menu actions only write layout.json, and page breaks coexist", async () => {
  const { app, settings, root, file, markdown } = fixture();
  const before = Buffer.from(markdown);
  const block = documentLayoutBlocks(markdown)[0];
  const target = createSourceAnchor(markdown, block.startOffset, block.endOffset);
  const writes = [];
  const modify = app.vault.modify.bind(app.vault);
  app.vault.modify = async (changed, content) => { writes.push(changed.path); return modify(changed, content); };
  for (const patch of [{ alignment: "center" }, { firstLineIndentPt: 0 }, { spacingBeforePt: 0 }, { spacingAfterPt: 12 }]) assert.equal(await applyParagraphLayoutChange(app, settings, root.path, file, markdown, target, patch), true);
  await toggleDocumentLayoutPageBreak(app, settings, root.path, file, markdown, target);
  let values = await documentLayoutValuesForTarget(app, settings, root.path, file, markdown, { paragraphAnchor: target, paginationAnchor: target });
  assert.equal(values.pagination, true);
  assert.equal(values.paragraph.alignment, "center");
  assert.equal((await loadLayoutStore(app, settings)).overrides.length, 2);
  await applyParagraphLayoutChange(app, settings, root.path, file, markdown, target, { alignment: undefined });
  values = await documentLayoutValuesForTarget(app, settings, root.path, file, markdown, { paragraphAnchor: target, paginationAnchor: target });
  assert.equal(values.pagination, true);
  assert.equal(values.paragraph.spacingAfterPt, 12);
  await toggleDocumentLayoutPageBreak(app, settings, root.path, file, markdown, target);
  assert.equal((await loadLayoutStore(app, settings)).overrides.length, 1);
  assert.ok(writes.every((path) => path === layoutFilePath(app, settings)));
  assert.deepEqual(Buffer.from(await app.vault.read(file)), before);
});

test("paragraph layout: duplication, splitting, merging, rename and folder move preserve properties", async () => {
  const store = update(emptyLayoutStore(), { alignment: "justify", firstLineIndentPt: 18, spacingBeforePt: 0, spacingAfterPt: 6 });
  const copy = duplicateLayoutForFile(store, "Chapter.md", "Copy.md", text);
  assert.equal(copy.overrides.length, 2);
  assert.equal(copy.overrides[1].alignment, "justify");
  assert.notEqual(copy.overrides[0].id, copy.overrides[1].id);
  const split = splitLayoutForFiles(store, "Chapter.md", "A.md", "First paragraph.", "B.md", "Second paragraph.");
  assert.equal(split.overrides[0].file, "A.md");
  assert.equal(split.overrides[0].spacingBeforePt, 0);
  const merged = mergeLayoutForFiles(split, ["A.md", "B.md"], "Merged.md", text);
  assert.equal(merged.overrides[0].firstLineIndentPt, 18);
  assert.equal(merged.overrides[0].file, "Merged.md");
  const { app, settings, root } = fixture();
  await saveLayoutStore(app, settings, store);
  await remapLayoutAfterRename(app, settings, `${root.path}/Chapter.md`, `${root.path}/Folder/Renamed.md`);
  const renamed = await loadLayoutStore(app, settings);
  assert.equal(renamed.overrides[0].file, "Folder/Renamed.md");
  await remapLayoutAfterRename(app, settings, `${root.path}/Folder`, `${root.path}/Moved`);
  assert.equal((await loadLayoutStore(app, settings)).overrides[0].file, "Moved/Renamed.md");
});
