import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MarkdownParser } from "@lezer/markdown";
import { TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  CrossReferenceStoreCorruptedError, crossReferenceId, emptyCrossReferenceStore,
  parseCrossReferenceStore, serializeCrossReferenceStore, validateCrossReferenceStore,
} from "../src/services/cross-reference-model.js";
import { detectCrossReferenceTargets } from "../src/services/cross-reference-detection.js";
import {
  createCrossReferenceLink, resolveCrossReferenceTarget, resolveCrossReferenceOccurrence,
} from "../src/services/cross-reference-resolution.js";
import {
  addCrossReferenceLink, crossReferenceStorePath, detectProjectCrossReferenceTargets,
  loadCrossReferenceStore, saveCrossReferenceStore, remapCrossReferenceStore,
  remapCrossReferencesAfterRename, resolveCrossReferenceStore,
} from "../src/services/cross-reference-store.js";
import { createSourceAnchor, resolveSourceAnchorStrict } from "../src/services/source-anchor.js";
import { annexesFolder, annexesFiles } from "../src/services/annexes.js";
import { annexesFolder as exportedAnnexesFolder, annexesFiles as exportedAnnexesFiles } from "../src/services/compile-export.js";

const targetContent = "Introduction\n\n# Destination\n\nTexte après le titre.\n";
const occurrenceContent = "Voir cette section pour les détails.";

function linked(store = emptyCrossReferenceStore(), targetText = targetContent, occurrenceText = occurrenceContent, targetPath = "Projet/Manuscrit/A.md") {
  const detected = detectCrossReferenceTargets(targetPath, targetText).find((target) => target.type === "section");
  assert.ok(detected);
  const start = occurrenceText.indexOf("cette section");
  return createCrossReferenceLink(store, detected, targetText, "Projet/Manuscrit/B.md", occurrenceText, start, start + 13, "title");
}

function fixture(storeContent) {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const auxiliary = new TFolder("Projet/_Feuillets");
  const resources = new TFolder("Projet/_Feuillets/Ressources");
  const internal = new TFolder("Projet/_Feuillets/Ressources/Ressources internes");
  const a = new TFile("Projet/Manuscrit/A.md", targetContent);
  const b = new TFile("Projet/Manuscrit/B.md", occurrenceContent);
  const path = `${internal.path}/cross-references.json`;
  const entries = [project, manuscript, auxiliary, resources, internal, a, b];
  project.children = [manuscript, auxiliary]; manuscript.parent = project; auxiliary.parent = project;
  auxiliary.children = [resources]; resources.parent = auxiliary;
  resources.children = [internal]; internal.parent = resources;
  manuscript.children = [a, b]; a.parent = manuscript; b.parent = manuscript;
  if (storeContent !== undefined) {
    const file = new TFile(path, storeContent);
    file.parent = internal; internal.children = [file]; entries.push(file);
  }
  const { vault, fileManager, files } = createFakeVault(entries);
  const app = { vault, fileManager, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: manuscript.path, projectMeta: { [manuscript.path]: {} }, orders: {}, folderPositions: {} };
  return { app, settings, path, a, b, manuscript, files };
}

test("XRef store: empty version 1 store is valid and independent on each creation", () => {
  const a = emptyCrossReferenceStore();
  assert.deepEqual(a, { version: 1, targets: [], occurrences: [] });
  validateCrossReferenceStore(a);
  a.targets.push(linked().target);
  assert.deepEqual(emptyCrossReferenceStore(), { version: 1, targets: [], occurrences: [] });
});

test("XRef store: validates populated stores and round-trips without loss", () => {
  const { store } = linked();
  validateCrossReferenceStore(store);
  assert.deepEqual(parseCrossReferenceStore(serializeCrossReferenceStore(store)), store);
});

test("XRef store: frozen versioned empty format", () => {
  assert.equal(serializeCrossReferenceStore(emptyCrossReferenceStore()), '{\n  "version": 1,\n  "targets": [],\n  "occurrences": []\n}\n');
  assert.throws(() => parseCrossReferenceStore('{"version":2,"targets":[],"occurrences":[]}'), CrossReferenceStoreCorruptedError);
});

test("XRef store: deterministic serialization despite array and property insertion order", () => {
  const first = linked();
  const second = linked(first.store, targetContent.replace("Destination", "Other"), occurrenceContent, "Projet/Manuscrit/C.md");
  const reversed = { occurrences: [...second.store.occurrences].reverse(), targets: [...second.store.targets].reverse(), version: 1 };
  assert.equal(serializeCrossReferenceStore(reversed), serializeCrossReferenceStore(second.store));
});

test("XRef store: rejects malformed fields, invalid ranges, duplicate identities and dangling relations", () => {
  const original = linked().store;
  const mutations = [
    (s) => { s.version = 0; }, (s) => { s.targets = null; }, (s) => { s.occurrences = [{}]; },
    (s) => { s.targets[0].type = "equation"; }, (s) => { s.targets[0].id = "path/title"; },
    (s) => { s.targets[0].sourceFile = "../A.md"; }, (s) => { s.targets[0].sourceFile = "/A.md"; },
    (s) => { s.targets[0].anchor.start = -1; }, (s) => { s.targets[0].anchor.end = 0; },
    (s) => { s.targets[0].anchor.end += 1; }, (s) => { s.targets[0].anchor.prefix = 4; },
    (s) => { s.targets.push(s.targets[0]); }, (s) => { s.occurrences.push(s.occurrences[0]); },
    (s) => { s.occurrences[0].id = s.targets[0].id; }, (s) => { s.occurrences[0].targetId = "xr_absent"; },
    (s) => { s.occurrences[0].displayMode = "page"; }, (s) => { s.extra = "unsupported"; },
  ];
  for (const mutate of mutations) {
    const store = structuredClone(original); mutate(store);
    assert.throws(() => validateCrossReferenceStore(store), CrossReferenceStoreCorruptedError);
  }
  for (const json of ["{", "null", "[]", "true"]) assert.throws(() => parseCrossReferenceStore(json), CrossReferenceStoreCorruptedError);
});

test("XRef store: absent store loads without writing and uses existing internal resource location", async () => {
  const state = fixture();
  assert.equal(crossReferenceStorePath(state.app, state.settings), state.path);
  assert.deepEqual(await loadCrossReferenceStore(state.app, state.settings), emptyCrossReferenceStore());
  assert.equal(state.files.has(state.path), false);
  assert.deepEqual(await loadCrossReferenceStore(state.app, {}), emptyCrossReferenceStore());
  await assert.rejects(saveCrossReferenceStore(state.app, {}, emptyCrossReferenceStore()), /active project/);
});

test("XRef store: saves and reloads sidecar without changing either Markdown file", async () => {
  const state = fixture();
  const result = linked();
  await saveCrossReferenceStore(state.app, state.settings, result.store);
  assert.deepEqual(await loadCrossReferenceStore(state.app, state.settings), result.store);
  assert.equal(state.files.get(state.path).content, serializeCrossReferenceStore(result.store));
  assert.equal(state.a.content, targetContent); assert.equal(state.b.content, occurrenceContent);
});

test("XRef store: corrupt sidecars are neither corrected nor overwritten even on explicit save", async () => {
  for (const content of ["{", '{"version":2,"targets":[],"occurrences":[]}']) {
    const state = fixture(content);
    await assert.rejects(loadCrossReferenceStore(state.app, state.settings), CrossReferenceStoreCorruptedError);
    await assert.rejects(saveCrossReferenceStore(state.app, state.settings, emptyCrossReferenceStore()), CrossReferenceStoreCorruptedError);
    await assert.rejects(remapCrossReferencesAfterRename(state.app, state.settings, state.a.path, "Moved.md"), CrossReferenceStoreCorruptedError);
    assert.equal(state.files.get(state.path).content, content);
  }
});

test("XRef store: a folder occupying the store path is explicitly invalid", async () => {
  const state = fixture(); state.files.set(state.path, new TFolder(state.path));
  await assert.rejects(loadCrossReferenceStore(state.app, state.settings), CrossReferenceStoreCorruptedError);
});

test("XRef identity: UUID-based opaque IDs do not take type, path or title as input", () => {
  const ids = Array.from({ length: 30 }, () => crossReferenceId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^xr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const section = linked().target;
  const figureText = "Before\n![Map](map.png)\nAfter";
  const figure = createCrossReferenceLink(emptyCrossReferenceStore(), detectCrossReferenceTargets("Other.md", figureText)[0], figureText, "Body.md", "see map", 4, 7).target;
  for (const target of [section, figure]) {
    assert.equal(target.id.includes(target.type), false); assert.equal(target.id.includes(target.sourceFile), false);
  }
});

test("XRef identity: deterministic clock-and-sequence fallback is unique without crypto", (t) => {
  t.mock.method(Date, "now", () => 123456);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  try {
    const first = crossReferenceId(); const second = crossReferenceId();
    assert.match(first, /^xr_1e240-[0-9a-f]+$/);
    assert.notEqual(first, second);
    assert.equal(Number.parseInt(second.split("-").at(-1), 16), Number.parseInt(first.split("-").at(-1), 16) + 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else Reflect.deleteProperty(globalThis, "crypto");
  }
});

test("XRef identity: no detected IDs and only linked targets are persisted", () => {
  const text = "# First\n\n# Second\n\n![Map](a.png)\n";
  const detected = detectCrossReferenceTargets("A.md", text);
  assert.equal(detected.length, 3); assert.equal(detected.every((target) => !("id" in target)), true);
  const store = emptyCrossReferenceStore();
  const result = createCrossReferenceLink(store, detected[1], text, "B.md", "See section", 4, 11);
  assert.equal(result.store.targets.length, 1); assert.equal(result.store.occurrences.length, 1);
  assert.deepEqual(store, emptyCrossReferenceStore());
});

test("XRef identity: repeated linking reuses target identity including after a title change", () => {
  const first = linked(); const second = linked(first.store);
  assert.equal(second.target.id, first.target.id); assert.equal(second.store.targets.length, 1);
  const changed = targetContent.replace("Destination", "Renamed destination");
  const third = linked(second.store, changed);
  assert.equal(third.target.id, first.target.id); assert.equal(third.store.targets.length, 1);
});

test("XRef target: resolves original, shifted and changed surrounding context", () => {
  const { target } = linked();
  assert.deepEqual(resolveCrossReferenceTarget(target, targetContent), {
    status: "resolved", range: { start: 14, end: 27 }, detectedTarget: detectCrossReferenceTargets(target.sourceFile, targetContent)[0],
  });
  assert.equal(resolveCrossReferenceTarget(target, "Inserted paragraph.\n\n" + targetContent).status, "resolved");
  assert.equal(resolveCrossReferenceTarget(target, targetContent.replace("Introduction", "New introduction").replace("Texte après", "Contexte après")).status, "resolved");
});

test("XRef target: edited title and figure caption remain anchored without changing identity", () => {
  const { target } = linked();
  assert.equal(resolveCrossReferenceTarget(target, targetContent.replace("Destination", "Changed title")).status, "resolved");
  const text = "Before the illustration.\n\n![Original caption](map.png)\n\nAfter the illustration.";
  const result = createCrossReferenceLink(emptyCrossReferenceStore(), detectCrossReferenceTargets("Map.md", text)[0], text, "Body.md", "see map", 4, 7);
  assert.equal(resolveCrossReferenceTarget(result.target, text.replace("Original caption", "New caption")).status, "resolved");
  assert.equal(result.target.id, result.store.targets[0].id);
});

test("XRef target: missing file, deleted heading and text moved into a code block are missing", () => {
  const { target } = linked();
  for (const content of [null, "Unrelated content", targetContent.replace("# Destination", "Destination"), "```md\n" + targetContent + "```\n"]) {
    assert.equal(resolveCrossReferenceTarget(target, content).status, "missing");
  }
});

test("XRef target: identical duplicated locations are ambiguous even at the original offset", () => {
  const { target } = linked();
  assert.equal(resolveCrossReferenceTarget(target, targetContent + "\n" + targetContent).status, "ambiguous");
  const contextFree = { ...target, anchor: { ...target.anchor, prefix: "", suffix: "" } };
  assert.equal(resolveCrossReferenceTarget(contextFree, targetContent + targetContent).status, "ambiguous");
});

test("XRef anchors: exact contexts distinguish repeated text without preferring an offset", () => {
  const text = "First quote context.\nSecond quote other context.";
  const anchor = createSourceAnchor(text, 6, 11);
  const moved = "New introduction\n" + text;
  assert.deepEqual(resolveSourceAnchorStrict(anchor, moved), { status: "resolved", range: { start: 23, end: 28 } });
  const changed = { ...anchor, quote: "absent", end: anchor.start + 6, prefix: "a", suffix: "z" };
  assert.equal(resolveSourceAnchorStrict(changed, "a one z a two z").status, "ambiguous");
});

test("XRef occurrence: attaches after movement and detaches on deletion, missing file or duplication", () => {
  const { occurrence } = linked();
  assert.deepEqual(resolveCrossReferenceOccurrence(occurrence, occurrenceContent), { status: "attached", range: { start: 5, end: 18 } });
  assert.equal(resolveCrossReferenceOccurrence(occurrence, "Prefix\n" + occurrenceContent).status, "attached");
  for (const content of [null, "Other text", occurrenceContent + "\n" + occurrenceContent]) {
    assert.deepEqual(resolveCrossReferenceOccurrence(occurrence, content), { status: "detached" });
  }
});

test("XRef occurrence: footnote-definition text uses the same real-file anchor", () => {
  const text = "Body.[^a]\n\n[^a]: Voir cette section dans cette note.\n";
  const { occurrence } = linked(emptyCrossReferenceStore(), targetContent, text);
  assert.equal(occurrence.sourceFile, "Projet/Manuscrit/B.md");
  assert.equal(occurrence.anchor.quote, "cette section");
  assert.equal(resolveCrossReferenceOccurrence(occurrence, "Added\n" + text).status, "attached");
});

test("XRef pure data creation: target and occurrence produce no Markdown or source marker", () => {
  const beforeTarget = targetContent; const beforeOccurrence = occurrenceContent;
  const { store, target, occurrence } = linked();
  assert.deepEqual(Object.keys(target), ["id", "type", "sourceFile", "anchor", "titleOrCaption"]);
  assert.deepEqual(Object.keys(occurrence), ["id", "targetId", "sourceFile", "anchor", "displayMode"]);
  assert.equal(targetContent, beforeTarget); assert.equal(occurrenceContent, beforeOccurrence);
  assert.equal(targetContent.includes(target.id), false); assert.equal(occurrenceContent.includes(occurrence.id), false);
  assert.equal("markdown" in store, false);
});

test("XRef link: rejects invalid or uncertain anchors and obsolete target syntax", () => {
  const detected = detectCrossReferenceTargets("A.md", targetContent)[0];
  for (const text of ["Deleted", targetContent + "\n" + targetContent, targetContent.replace("# Destination", "Destination")]) {
    assert.throws(() => createCrossReferenceLink(emptyCrossReferenceStore(), detected, text, "B.md", "see", 0, 3));
  }
  assert.throws(() => createCrossReferenceLink(emptyCrossReferenceStore(), detected, targetContent, "B.md", "see", 3, 3));
});

test("XRef detection: ATX and Setext headings reuse Markdown grammar and preserve offsets", () => {
  const text = "---\r\ntitle: Metadata\r\n---\r\n\r\n# Title #\r\n\r\nSubtitle\r\n--------\r\n";
  const targets = detectCrossReferenceTargets("A.md", text);
  assert.deepEqual(targets.map((target) => [target.type, target.titleOrCaption]), [["section", "Title"], ["section", "Subtitle"]]);
  for (const target of targets) assert.equal(text.slice(target.anchor.start, target.anchor.end), target.anchor.quote);
});

test("XRef detection: real captions use the shared image parser, excluding empty and wikilink size aliases", () => {
  const text = '![](ornament.png)\n![Map](map.png)\n![[image.png|300]]\n![ ](blank.png)\n![Escaped \\] caption](<my image.png>)\n';
  const targets = detectCrossReferenceTargets("A.md", text);
  assert.deepEqual(targets.map((target) => target.titleOrCaption), ["Map", "Escaped ] caption"]);
  assert.equal(targets.every((target) => target.type === "figure"), true);
});

test("XRef detection: Markdown tables use Lezer Table nodes, without implicit numbering", () => {
  const text = "| Name | Value |\n| --- | ---: |\n| A | 2 |\n";
  const targets = detectCrossReferenceTargets("A.md", text, { fileOrder: 7 });
  assert.equal(targets.length, 1); assert.equal(targets[0].type, "table");
  assert.deepEqual(targets[0].sourceOrder, { fileOrder: 7, offset: 0 });
  assert.equal(targets[0].anchor.quote, text.trimEnd());
  assert.equal("number" in targets[0], false);
});

test("XRef detection: excludes fenced, indented and inline code, comments and existing YAML", () => {
  const text = '---\nvalue: "![Fake](a.png)"\n---\n\n````md\n# Hidden\n~~~\n![Hidden](a.png)\n| A | B |\n| --- | --- |\n````\n\n    # Indented\n    ![Indented](a.png)\n\n`![Inline](a.png)`\n\n<!--\n# Comment\n![Comment](a.png)\n-->\n\n# Visible\n';
  assert.deepEqual(detectCrossReferenceTargets("A.md", text).map((target) => target.titleOrCaption), ["Visible"]);
});

test("XRef detection: never modifies supplied content and does not recognize arbitrary paths as appendices", () => {
  const text = "# Title\n\n![Caption](map.png)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
  const snapshot = text;
  const targets = detectCrossReferenceTargets("Annexes/Example.md", text);
  assert.equal(text, snapshot); assert.equal(targets.some((target) => target.type === "appendix"), false);
});

test("XRef detection: appendix uses supplied structural recognition and first heading or content block", () => {
  const targets = detectCrossReferenceTargets("A.md", "# Appendix title\n\nText", { appendixTitle: "A" });
  assert.equal(targets.filter((target) => target.type === "appendix").length, 1);
  assert.equal(targets.find((target) => target.type === "appendix").titleOrCaption, "Appendix title");
  const plain = detectCrossReferenceTargets("A.md", "Appendix body", { appendixTitle: "A" });
  assert.equal(plain[0].type, "appendix"); assert.equal(plain[0].titleOrCaption, "A");
});

test("XRef project detection: reuses Annexes/Appendices recognition and Binder ordering without saving", async () => {
  for (const name of ["Annexes", "Appendices"]) {
    const state = fixture();
    const folder = await state.app.vault.createFolder(`${state.manuscript.path}/${name}`);
    await state.app.vault.create(`${folder.path}/First.md`, "# First appendix");
    await state.app.vault.create(`${folder.path}/Second.md`, "# Second appendix");
    state.settings.orders[folder.path] = ["Second.md", "First.md"];
    const detected = await detectProjectCrossReferenceTargets(state.app, state.settings);
    assert.deepEqual(detected.filter((target) => target.type === "appendix").map((target) => target.titleOrCaption), ["Second appendix", "First appendix"]);
    assert.equal(state.files.has(state.path), false);
    assert.equal(detected.every((target) => !("id" in target)), true);
  }
});

test("XRef project detection: recognizes appendices inside existing registered editorial roots", async () => {
  const state = fixture();
  const volume = await state.app.vault.createFolder(`${state.manuscript.path}/Volume`);
  const folder = await state.app.vault.createFolder(`${volume.path}/Appendices`);
  await state.app.vault.create(`${folder.path}/A.md`, "# Volume appendix");
  state.settings.projectMeta[state.manuscript.path].folderWorkspaces = { Volume: { version: 1, ouvrage: { version: 1 } } };
  const detected = await detectProjectCrossReferenceTargets(state.app, state.settings);
  assert.equal(detected.find((target) => target.type === "appendix").titleOrCaption, "Volume appendix");
});

test("XRef renames: pure file and folder remapping preserves IDs and neighboring paths", () => {
  const first = linked();
  const remapped = remapCrossReferenceStore(first.store, "Projet/Manuscrit", "Projet/Book");
  assert.equal(remapped.targets[0].id, first.target.id); assert.equal(remapped.occurrences[0].id, first.occurrence.id);
  assert.equal(remapped.targets[0].sourceFile, "Projet/Book/A.md"); assert.equal(remapped.occurrences[0].sourceFile, "Projet/Book/B.md");
  const neighbor = remapCrossReferenceStore(first.store, "Projet/Manuscri", "Other");
  assert.deepEqual(neighbor, first.store);
  assert.equal(first.target.sourceFile, "Projet/Manuscrit/A.md");
});

test("XRef renames: persisted target and occurrence file moves retain identity and remain resolved", async () => {
  const state = fixture(); const first = linked();
  await saveCrossReferenceStore(state.app, state.settings, first.store);
  const oldA = state.a.path; await state.app.fileManager.renameFile(state.a, "Projet/Manuscrit/Renamed.md");
  assert.equal(await remapCrossReferencesAfterRename(state.app, state.settings, oldA, state.a.path), true);
  const oldB = state.b.path; await state.app.fileManager.renameFile(state.b, "Other/B.md");
  assert.equal(await remapCrossReferencesAfterRename(state.app, state.settings, oldB, state.b.path), true);
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.targets[0].id, first.target.id); assert.equal(store.occurrences[0].targetId, first.target.id);
  assert.equal(store.targets[0].sourceFile, state.a.path); assert.equal(store.occurrences[0].sourceFile, state.b.path);
  const resolution = await resolveCrossReferenceStore(state.app, store);
  assert.equal(resolution.targets.get(first.target.id).status, "resolved");
  assert.equal(resolution.occurrences.get(first.occurrence.id).status, "attached");
});

test("XRef renames: folder rename updates multiple targets and occurrences with stable IDs", async () => {
  const state = fixture(); const first = linked();
  const second = linked(first.store, targetContent.replace("Destination", "Other"), occurrenceContent, "Projet/Manuscrit/C.md");
  await saveCrossReferenceStore(state.app, state.settings, second.store);
  assert.equal(await remapCrossReferencesAfterRename(state.app, state.settings, "Projet/Manuscrit", "Elsewhere"), true);
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.targets.length, 2); assert.equal(store.occurrences.length, 2);
  assert.deepEqual(new Set(store.targets.map((target) => target.id)), new Set(second.store.targets.map((target) => target.id)));
  assert.deepEqual(new Set(store.targets.map((target) => target.sourceFile)), new Set(["Elsewhere/A.md", "Elsewhere/C.md"]));
  assert.equal(store.occurrences.every((occurrence) => occurrence.sourceFile === "Elsewhere/B.md"), true);
});

test("XRef persistence: concurrent links and consecutive renames do not lose sidecar updates", async () => {
  const state = fixture(); const detected = detectCrossReferenceTargets(state.a.path, state.a.content)[0];
  await Promise.all([
    addCrossReferenceLink(state.app, state.settings, detected, state.b, 5, 18, "title"),
    addCrossReferenceLink(state.app, state.settings, detected, state.b, 5, 18, "type-number"),
  ]);
  let store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.targets.length, 1); assert.equal(store.occurrences.length, 2);
  await Promise.all([
    remapCrossReferencesAfterRename(state.app, state.settings, state.a.path, "Moved.md"),
    remapCrossReferencesAfterRename(state.app, state.settings, "Moved.md", "Final.md"),
  ]);
  store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.targets[0].sourceFile, "Final.md");
  assert.equal(state.a.content, targetContent); assert.equal(state.b.content, occurrenceContent);
});

test("XRef persistence: unrelated rename never creates a store", async () => {
  const state = fixture();
  assert.equal(await remapCrossReferencesAfterRename(state.app, state.settings, "Other.md", "Moved.md"), false);
  assert.equal(state.files.has(state.path), false);
});

test("XRef store resolution: missing target and occurrence files have explicit independent states", async () => {
  const state = fixture(); const first = linked();
  await state.app.vault.delete(state.a); await state.app.vault.delete(state.b);
  const result = await resolveCrossReferenceStore(state.app, first.store);
  assert.deepEqual(result.targets.get(first.target.id), { status: "missing" });
  assert.deepEqual(result.occurrences.get(first.occurrence.id), { status: "detached" });
});

test("XRef rename event: existing plugin Vault listener remaps persistent records", async () => {
  const state = fixture(); const first = linked();
  await saveCrossReferenceStore(state.app, state.settings, first.store);
  const handlers = new Map();
  state.app.vault.on = (name, callback) => { handlers.set(name, callback); return {}; };
  state.app.metadataCache.on = () => ({});
  state.app.workspace = { on: () => ({}) };
  const plugin = {
    app: state.app, settings: state.settings, isLayoutReady: false,
    registerEvent() {}, async maybeAutoInitializeResearchFile() {},
    async saveSettings() {}, refreshCitationRendering() {},
  };
  FeuilletsPlugin.prototype.registerVaultEvents.call(plugin);
  const oldPath = state.a.path;
  await state.app.fileManager.renameFile(state.a, "Projet/Manuscrit/Renamed.md");
  handlers.get("rename")(state.a, oldPath);
  const store = await loadCrossReferenceStore(state.app, state.settings);
  assert.equal(store.targets[0].sourceFile, state.a.path);
  assert.equal(store.targets[0].id, first.target.id);
});

test("XRef store: save creates only existing-architecture internal folders when absent", async () => {
  const state = fixture();
  for (const path of [...state.files.keys()]) {
    if (path.startsWith("Projet/_Feuillets")) state.files.delete(path);
  }
  state.files.get("Projet").children = [state.manuscript];
  const storePath = crossReferenceStorePath(state.app, state.settings);
  await saveCrossReferenceStore(state.app, state.settings, emptyCrossReferenceStore());
  assert.equal(storePath, state.path);
  assert.deepEqual(await loadCrossReferenceStore(state.app, state.settings), emptyCrossReferenceStore());
});

test("XRef model: all declared target types and display modes survive persistence", () => {
  const first = linked();
  for (const type of ["section", "figure", "table", "appendix"]) {
    for (const displayMode of ["number", "title", "type-number"]) {
      const store = structuredClone(first.store);
      store.targets[0].type = type; store.occurrences[0].displayMode = displayMode;
      assert.deepEqual(parseCrossReferenceStore(serializeCrossReferenceStore(store)), store);
    }
  }
});

test("XRef target: whole-file heading rename preserves identity and exposes the current title", () => {
  const original = "# Ancien titre";
  const current = "# Nouveau titre";
  const first = linked(emptyCrossReferenceStore(), original);
  const snapshot = serializeCrossReferenceStore(first.store);
  assert.equal(first.target.anchor.prefix, ""); assert.equal(first.target.anchor.suffix, "");
  assert.equal(resolveSourceAnchorStrict(first.target.anchor, current).status, "missing");
  const result = resolveCrossReferenceTarget(first.target, current);
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.range, { start: 0, end: current.length });
  assert.equal(result.detectedTarget.titleOrCaption, "Nouveau titre");
  assert.equal(first.target.titleOrCaption, "Ancien titre");
  assert.equal(serializeCrossReferenceStore(first.store), snapshot);
  const relinked = linked(first.store, current);
  assert.equal(relinked.target.id, first.target.id);
  assert.equal(relinked.store.targets.length, 1);
});

test("XRef target: first heading rename uses the exact remaining suffix after movement", () => {
  const original = "# Ancien titre\n\nUnchanged body.";
  const first = linked(emptyCrossReferenceStore(), original);
  const current = "Inserted introduction.\n\n# Nouveau titre\n\nUnchanged body.";
  assert.equal(first.target.anchor.prefix, "");
  const result = resolveCrossReferenceTarget(first.target, current);
  assert.equal(result.status, "resolved");
  assert.equal(result.detectedTarget.titleOrCaption, "Nouveau titre");
  assert.equal(result.range.start, current.indexOf("# Nouveau titre"));
  assert.equal(linked(first.store, current).target.id, first.target.id);
});

test("XRef target: last figure caption change uses the exact remaining prefix and preserves identity", () => {
  const original = "Unchanged introduction.\n\n![Ancienne légende](map.png)";
  const current = original.replace("Ancienne légende", "Nouvelle légende");
  const detected = detectCrossReferenceTargets("Map.md", original)[0];
  const first = createCrossReferenceLink(emptyCrossReferenceStore(), detected, original, "Body.md", "see map", 4, 7);
  assert.equal(first.target.anchor.suffix, "");
  assert.equal(resolveSourceAnchorStrict(first.target.anchor, current).status, "missing");
  const result = resolveCrossReferenceTarget(first.target, current);
  assert.equal(result.status, "resolved");
  assert.equal(result.detectedTarget.titleOrCaption, "Nouvelle légende");
  assert.equal(result.range.end, current.length);
  assert.equal(first.target.titleOrCaption, "Ancienne légende");
  const relinked = createCrossReferenceLink(first.store, detectCrossReferenceTargets("Map.md", current)[0], current, "Body.md", "see map", 4, 7);
  assert.equal(relinked.target.id, first.target.id); assert.equal(relinked.store.targets.length, 1);
});

test("XRef target: changed title and caption with both contexts expose current document metadata", () => {
  const first = linked();
  const heading = resolveCrossReferenceTarget(first.target, targetContent.replace("Destination", "Current heading"));
  assert.equal(heading.status, "resolved"); assert.equal(heading.detectedTarget.titleOrCaption, "Current heading");
  const original = "Before.\n\n![Old caption](map.png)\n\nAfter.";
  const figure = createCrossReferenceLink(emptyCrossReferenceStore(), detectCrossReferenceTargets("Map.md", original)[0], original, "Body.md", "see map", 4, 7).target;
  const result = resolveCrossReferenceTarget(figure, original.replace("Old caption", "Current caption"));
  assert.equal(result.status, "resolved"); assert.equal(result.detectedTarget.titleOrCaption, "Current caption");
});

test("XRef target: multiple compatible changed headings are ambiguous even at the former offset", () => {
  const first = linked(emptyCrossReferenceStore(), "# Old heading");
  const current = "# First replacement\n\n# Second replacement";
  assert.equal(detectCrossReferenceTargets(first.target.sourceFile, current)[0].anchor.start, first.target.anchor.start);
  assert.deepEqual(resolveCrossReferenceTarget(first.target, current), { status: "ambiguous" });
  assert.deepEqual(resolveCrossReferenceTarget(first.target, "Body without headings"), { status: "missing" });
});

test("XRef target: repeated remaining suffixes produce ambiguity without an offset preference", () => {
  const suffix = "\n\n" + "Unchanged context. ".repeat(8);
  const first = linked(emptyCrossReferenceStore(), "# Old heading" + suffix);
  const current = "# First replacement" + suffix + "\n\n# Second replacement" + suffix;
  assert.deepEqual(resolveCrossReferenceTarget(first.target, current), { status: "ambiguous" });
});

test("XRef target: a unique target with changed remaining context is still missing", () => {
  const first = linked(emptyCrossReferenceStore(), "# Old heading\n\nOriginal body.");
  assert.deepEqual(resolveCrossReferenceTarget(first.target, "# Replacement\n\nDifferent body."), { status: "missing" });
});

test("XRef occurrence: file-edge text changes remain detached without structural fallback", () => {
  const anchor = createSourceAnchor("# Old heading", 0, 13);
  const occurrence = { id: "xr_occurrence", targetId: "xr_target", sourceFile: "Body.md", anchor, displayMode: "title" };
  assert.deepEqual(resolveSourceAnchorStrict(anchor, "# Replacement"), { status: "missing" });
  assert.deepEqual(resolveCrossReferenceOccurrence(occurrence, "# Replacement"), { status: "detached" });
});

test("annexes: folder recognition preserves precedence, direct-root lookup and folder-only matching", async () => {
  const state = fixture();
  assert.equal(annexesFolder(state.app, null), null);
  assert.equal(annexesFolder(state.app, state.manuscript), null);
  const appendices = await state.app.vault.createFolder(`${state.manuscript.path}/Appendices`);
  assert.equal(annexesFolder(state.app, state.manuscript), appendices);
  const annexes = await state.app.vault.createFolder(`${state.manuscript.path}/Annexes`);
  assert.equal(annexesFolder(state.app, state.manuscript), annexes);
  state.files.set(annexes.path, new TFile(annexes.path, "Text"));
  assert.equal(annexesFolder(state.app, state.manuscript), appendices);
  state.files.delete(appendices.path);
  const nested = await state.app.vault.createFolder(`${state.manuscript.path}/Part`);
  await state.app.vault.createFolder(`${nested.path}/Annexes`);
  assert.equal(annexesFolder(state.app, state.manuscript), null);
  assert.equal(exportedAnnexesFolder, annexesFolder); assert.equal(exportedAnnexesFiles, annexesFiles);
});

test("annexes: direct Markdown children retain Binder order and compile-independent inclusion", async () => {
  const state = fixture();
  const folder = await state.app.vault.createFolder(`${state.manuscript.path}/Annexes`);
  const first = await state.app.vault.create(`${folder.path}/First.md`, "# First");
  const second = await state.app.vault.create(`${folder.path}/Second.md`, "# Second");
  await state.app.vault.create(`${folder.path}/image.png`, "image");
  const nested = await state.app.vault.createFolder(`${folder.path}/Nested`);
  await state.app.vault.create(`${nested.path}/Child.md`, "# Child");
  state.app.metadataCache.getFileCache = () => ({ frontmatter: { compile: false } });
  state.settings.orders[folder.path] = ["Second.md", "Nested", "First.md"];
  assert.deepEqual(annexesFiles(state.app, state.settings, state.manuscript), [second, first]);
  assert.deepEqual(annexesFiles(state.app, state.settings, null), []);
});

test("XRef architecture: appendix consumers import the neutral service and XRef has no compile-export import", () => {
  for (const module of ["model", "detection", "resolution", "store"]) {
    const source = readFileSync(join(process.cwd(), `src/services/cross-reference-${module}.ts`), "utf8");
    assert.doesNotMatch(source, /compile-export/);
  }
  for (const file of ["src/services/cross-reference-store.ts", "src/services/compile-export.ts", "src/ui/annexes-panel.ts"]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(source, /import\s+\{[^}]*annexes(?:Folder|Files)[^}]*\}\s+from\s+"(?:\.\/|\.\.\/services\/)annexes\.js"/);
  }
});

test("XRef store resolution: one read per file and one Markdown parse for all target types in a file", async (t) => {
  const state = fixture();
  const content = "# Heading\n\n![Caption](map.png)\n\n| Name | Value |\n| --- | --- |\n| A | B |\n";
  await state.app.vault.modify(state.a, content);
  const detected = detectCrossReferenceTargets(state.a.path, content, { appendixTitle: state.a.basename });
  let store = emptyCrossReferenceStore();
  for (const target of detected) {
    store = createCrossReferenceLink(store, target, content, state.b.path, state.b.content, 5, 18).store;
  }
  const parse = t.mock.method(MarkdownParser.prototype, "parse");
  const read = t.mock.method(state.app.vault, "read");
  const resolution = await resolveCrossReferenceStore(state.app, store);
  assert.equal(parse.mock.callCount(), 1);
  assert.equal(read.mock.callCount(), 2);
  assert.equal(store.targets.length, 4);
  for (const target of store.targets) {
    const result = resolution.targets.get(target.id);
    assert.equal(result.status, "resolved");
    assert.equal(result.detectedTarget.type, target.type);
    assert.equal(result.detectedTarget.titleOrCaption, target.titleOrCaption);
  }
});

test("XRef store resolution: current title is returned while the sidecar snapshot remains unchanged", async () => {
  const state = fixture();
  const first = linked(emptyCrossReferenceStore(), "# Old heading");
  await saveCrossReferenceStore(state.app, state.settings, first.store);
  const saved = state.files.get(state.path).content;
  await state.app.vault.modify(state.a, "# Current heading");
  const result = await resolveCrossReferenceStore(state.app, first.store);
  assert.equal(result.targets.get(first.target.id).status, "resolved");
  assert.equal(result.targets.get(first.target.id).detectedTarget.titleOrCaption, "Current heading");
  assert.equal(first.store.targets[0].id, first.target.id);
  assert.equal(state.files.get(state.path).content, saved);
});
