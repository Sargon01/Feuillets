import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile } from "../src/services/compile-export.js";
import { detectCrossReferenceTargets } from "../src/services/cross-reference-detection.js";
import { createCrossReferenceLink } from "../src/services/cross-reference-resolution.js";
import { emptyCrossReferenceStore, serializeCrossReferenceStore } from "../src/services/cross-reference-model.js";
import { crossReferenceStorePath } from "../src/services/cross-reference-store.js";
import { writeGeneratedIncluded } from "../src/services/book-composition.js";
import { PreviewView } from "../src/views/preview-view.js";
import { injectDocumentLayoutMarkers } from "../src/services/document-layout.js";
import { createSourceAnchor } from "../src/services/source-anchor.js";

function fixture() {
  const root = new TFolder("Book/Manuscript");
  const first = new TFolder(`${root.path}/First`);
  const second = new TFolder(`${root.path}/Second`);
  const appendices = new TFolder(`${root.path}/Appendices`);
  const reference = new TFile(`${first.path}/Reference.md`, '---\ntitle: Generated title\n---\n\nBefore [[Elsewhere|alias]]... See old section, old figure, old table, old appendix [@known; @other].[^1]\n\n[^1]: Note old caption with @known and [@missing].\n');
  const a = new TFile(`${first.path}/A.md`, '# First section\n\n![First image](a.png)\n\n| First | Value |\n| --- | --- |\n| A | 1 |\n');
  const b = new TFile(`${second.path}/B.md`, '# Destination\n\nStable surrounding paragraph with enough unchanged context to keep independent structural edits attached to their persistent identities.\n\n![Second image](b.png)\n\n| Second | Value |\n| --- | --- |\n| B | 2 |\n\nStable ending.');
  const appendix = new TFile(`${appendices.path}/Details.md`, '# Appendix details\n\nSupplement.');
  root.children = [first, second, appendices];
  first.children = [reference, a]; second.children = [b]; appendices.children = [appendix];
  for (const folder of root.children) { folder.parent = root; for (const file of folder.children) file.parent = folder; }
  const { vault, files } = createFakeVault([root, first, second, appendices, reference, a, b, appendix]);
  vault.cachedRead = vault.read;
  const app = { vault, metadataCache: { getFileCache: (file) => ({ frontmatter: file === reference ? { title: "Generated title" } : {} }) } };
  const settings = { projectFolder: root.path, level1Role: "chapitres", folderPositions: {}, orders: { [first.path]: [reference.name, a.name] }, projectMeta: { [root.path]: {} }, insertTitles: true, insertSceneTitles: true, activePreset: -1, separator: "***", exportFrenchTypography: true, footnoteRenumberOnCompile: true };
  let store = emptyCrossReferenceStore();
  for (const [type, targetFile, human, mode] of [
    ["section", b, "old section", "title"], ["figure", b, "old figure", "type-number"],
    ["table", b, "old table", "number"], ["appendix", appendix, "old appendix", "type-number"],
    ["figure", b, "old caption", "title"],
  ]) {
    const target = detectCrossReferenceTargets(targetFile.path, targetFile.content, type === "appendix" ? { appendixTitle: targetFile.basename } : {}).find((entry) => entry.type === type);
    const start = reference.content.indexOf(human);
    store = createCrossReferenceLink(store, target, targetFile.content, reference.path, reference.content, start, start + human.length, mode).store;
  }
  const storeFile = new TFile(crossReferenceStorePath(app, settings), serializeCrossReferenceStore(store)); files.set(storeFile.path, storeFile);
  const run = (scope = { type: "project", projectRoot: root.path }, options = {}) => compile(app, settings, null, scope, undefined, { writeOutput: false, ...options });
  return { app, settings, root, first, second, reference, a, b, appendix, storeFile, store, run };
}

test("Composition cross-references use current titles and Binder numbers before Markdown transformations without source writes", async () => {
  const f = fixture();
  const before = [f.reference, f.a, f.b, f.appendix, f.storeFile].map((file) => file.content);
  f.b.content = f.b.content.replace("Destination", "Renamed destination").replace("Second image", "Current caption");
  before[2] = f.b.content;
  const result = await f.run();
  assert.match(result.manuscript, /alias… See Renamed destination, image 2, 2, old appendix \[@known\s*; @other\]/);
  assert.match(result.manuscript, /\[\^1\]: Note Current caption with @known and \[@missing\]/);
  assert.match(result.manuscript, /#### Generated title/);
  assert.ok(!result.manuscript.includes("title: Generated title"));
  assert.equal(result.segments.find((segment) => segment.path === f.reference.path).renderText, result.segments.find((segment) => segment.path === f.reference.path).text);
  assert.deepEqual([f.reference, f.a, f.b, f.appendix, f.storeFile].map((file) => file.content), before);
  f.settings.orders[f.root.path] = [f.second.name, f.first.name, "Appendices"];
  const reordered = await f.run();
  assert.match(reordered.manuscript, /See Renamed destination, image 1, 1, old appendix/);
  writeGeneratedIncluded(f.settings.projectMeta[f.root.path], "annexes", true);
  assert.match((await f.run()).manuscript, /image 1, 1, annexe 1/);
});

test("Composition cross-references retain human text for omitted, missing and ambiguous targets", async () => {
  const f = fixture();
  const scoped = await f.run({ type: "folder", projectRoot: f.root.path, path: f.first.path });
  assert.match(scoped.manuscript, /old section, old figure, old table, old appendix/);
  f.b.content = '# Unrelated\n\nNo destination.';
  assert.match((await f.run()).manuscript, /old section, old figure, old table/);
  f.b.content = '# Destination\n\n# Destination';
  assert.match((await f.run()).manuscript, /old section, old figure, old table/);
});

test("Preview local and compiled modes resolve the actual scope and refresh after source and Binder edits", async () => {
  const f = fixture();
  f.app.workspace = { getActiveFile: () => f.reference, getLeavesOfType: () => [], getActiveViewOfType: () => null };
  const view = new PreviewView({ app: f.app }, { settings: f.settings, getProjectFolder: () => f.root });
  view.readFileForPreview = (file) => f.app.vault.read(file);
  for (const mode of ["scene", "chapter"]) {
    f.settings.previewMode = mode;
    const source = await view.collectSource(0);
    assert.match(source.markdown, /old section, old figure, old table, old appendix/);
  }
  f.settings.previewMode = "manuscript";
  assert.match((await view.collectSource(0)).markdown, /Destination, image 2, 2, old appendix/);
  f.settings.orders[f.root.path] = [f.second.name, f.first.name, "Appendices"];
  f.b.content = f.b.content.replace("Destination", "Updated destination");
  const source = await view.collectSource(0);
  assert.match(source.markdown, /Updated destination, image 1, 1, old appendix/);
  const compiled = await f.run();
  assert.equal(source.markdown, compiled.manuscript);
  const fileSource = await view.collectSource(0, { type: "file", projectRoot: f.root.path, path: f.reference.path });
  assert.match(fileSource.markdown, /old section, old figure, old table/);
  // A local chapter containing the target also resolves without compile().
  f.second.children = []; f.first.children.push(f.b); f.b.parent = f.first;
  f.settings.previewMode = "chapter";
  let targetReads = 0;
  view.readFileForPreview = async (file) => file === f.b && ++targetReads > 1 ? file.content.replace("Updated destination", "Never rendered") : file.content;
  assert.match((await view.collectSource(0)).markdown, /Updated destination, image 2, 2/);
});

test("Extraction numbers only retained targets and substitutes references using original YAML offsets", async () => {
  const f = fixture();
  f.reference.content = '---\ntitle: Extract\n---\n\n# References\n\n> [!questions]\n> See retained figure and omitted section.\n';
  f.b.content = '# Omitted\n\n![Omitted](omit.png)\n\n# Retained\n\n> [!questions]\n> Included activity.\n\n![Retained caption](kept.png)\n';
  let store = emptyCrossReferenceStore();
  const targets = detectCrossReferenceTargets(f.b.path, f.b.content);
  for (const [title, human, mode] of [["Retained caption", "retained figure", "type-number"], ["Omitted", "omitted section", "title"]]) {
    const target = targets.find((entry) => entry.titleOrCaption === title);
    const from = f.reference.content.indexOf(human);
    store = createCrossReferenceLink(store, target, f.b.content, f.reference.path, f.reference.content, from, from + human.length, mode).store;
  }
  f.storeFile.content = serializeCrossReferenceStore(store);
  const result = await f.run(undefined, { contentExtraction: { triggerRoles: ["questions"] } });
  assert.match(result.manuscript, /See image 1 and omitted section/);
  assert.doesNotMatch(result.manuscript, /omit.png|# Omitted/);
});

test("Collections keep current heading identities and omit targets outside their retained source ranges", async () => {
  const f = fixture();
  f.reference.content = '# References\n\n> [!questions]\n> See kept title and old image.\n';
  f.b.content = '# Retained\n\n> [!questions]\n> Activity.\n\n![Outside collection](outside.png)\n';
  let store = emptyCrossReferenceStore();
  const targets = detectCrossReferenceTargets(f.b.path, f.b.content);
  for (const [type, human] of [["section", "kept title"], ["figure", "old image"]]) {
    const from = f.reference.content.indexOf(human);
    store = createCrossReferenceLink(store, targets.find((entry) => entry.type === type), f.b.content, f.reference.path, f.reference.content, from, from + human.length, "title").store;
  }
  f.storeFile.content = serializeCrossReferenceStore(store);
  const result = await f.run(undefined, { contentCollection: { roles: ["questions"] } });
  assert.match(result.manuscript, /See Retained and old image/);
  assert.doesNotMatch(result.manuscript, /outside.png/);
});

test("Layout anchors in a reference paragraph resolve against original text before substitution", () => {
  const source = "Before.\n\nSee the old figure.\n\nAfter.";
  const from = source.indexOf("old figure");
  const override = { id: "layout-test", file: "Scene.md", kind: "page-break-before", anchor: createSourceAnchor(source, source.indexOf("See"), source.indexOf(".\n\nAfter") + 1) };
  assert.equal(injectDocumentLayoutMarkers(source, [override], [{ from, to: from + 10, text: "image 123" }]), "Before.\n\nFEUILLETS_LAYOUT_PAGE_BREAK_BEFORE\n\nSee the image 123.\n\nAfter.");
});

test("Moving figure and table blocks within one file changes their contextual numbers without changing identities", async () => {
  const f = fixture();
  const block = (label, target) => `${label} before ${"stable context ".repeat(8)}\n\n${target}\n\n${label} after ${"stable ending ".repeat(8)}\n\n`;
  const first = block("First figure", "![Earlier image](early.png)") + block("First table", "| Earlier | Value |\n| --- | --- |\n| A | 1 |");
  const second = block("Second figure", "![Moving image](moving.png)") + block("Second table", "| Moving | Value |\n| --- | --- |\n| B | 2 |");
  f.b.content = first + second;
  let store = emptyCrossReferenceStore();
  const targets = detectCrossReferenceTargets(f.b.path, f.b.content);
  for (const [type, human, title] of [["figure", "old figure", "Moving image"], ["table", "old table", "| Moving | Value |"]]) {
    const from = f.reference.content.indexOf(human);
    store = createCrossReferenceLink(store, targets.find((target) => target.type === type && target.titleOrCaption === title), f.b.content,
      f.reference.path, f.reference.content, from, from + human.length, "number").store;
  }
  f.storeFile.content = serializeCrossReferenceStore(store);
  const json = f.storeFile.content;
  assert.match((await f.run()).manuscript, /old section, 3, 3, old appendix/);
  f.b.content = second + first;
  f.settings.separator = "— — —";
  assert.match((await f.run()).manuscript, /old section, 2, 2, old appendix/);
  assert.equal(f.storeFile.content, json);
});

test("Compilation resolves identities against the content snapshot actually used rather than rereading persisted source", async () => {
  const f = fixture();
  f.app.vault.cachedRead = async (file) => file === f.b ? file.content.replace("Destination", "Live destination") : file.content;
  assert.match((await f.run()).manuscript, /See Live destination, image 2, 2/);
  assert.ok(f.b.content.startsWith("# Destination"));
});

test("Local chapter preview keeps references in distinct notes when several source files use the same note label", async () => {
  const f = fixture();
  f.a.content += '\nAnother note.[^1]\n\n[^1]: Independent note [@other].\n';
  f.app.workspace = { getActiveFile: () => f.reference, getLeavesOfType: () => [], getActiveViewOfType: () => null };
  f.settings.previewMode = "chapter";
  const view = new PreviewView({ app: f.app }, { settings: f.settings, getProjectFolder: () => f.root });
  view.readFileForPreview = (file) => f.app.vault.read(file);
  const preview = await view.collectSource(0);
  assert.match(preview.markdown, /\[\^1\]: Note old caption with @known and \[@missing\]/);
  assert.match(preview.markdown, /Another note\.\[\^2\]/);
  assert.match(preview.markdown, /\[\^2\]: Independent note \[@other\]/);
  const compiled = await f.run({ type: "folder", projectRoot: f.root.path, path: f.first.path });
  assert.equal(preview.markdown.match(/\[\^\d+\]:[^\n]+/g).join("\n"), compiled.manuscript.match(/\[\^\d+\]:[^\n]+/g).join("\n"));
});
