import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { compile } from "../src/services/compile-export.js";
import { resolveCompileScopeFiles } from "../src/services/compile-scope.js";
import { writeGeneratedIncluded } from "../src/services/book-composition.js";
import {
  addCitationOccurrence,
  citationRegistryPath,
  CitationRegistryCorruptedError,
  loadCitationRegistry,
  remapCitationRegistryAfterRename,
  resolveCitedSourceFilesForCompileFiles,
  resolveCitationOccurrence,
} from "../src/services/citation-registry.js";
import { createFakeVault } from "./helpers/fake-vault.js";

function fixture(registryContent) {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const resources = new TFolder("Projet/_Feuillets");
  const resourcesRoot = new TFolder("Projet/_Feuillets/Ressources");
  const internal = new TFolder("Projet/_Feuillets/Ressources/Ressources internes");
  const sheet = new TFile("Projet/Manuscrit/Chapitre.md", "Texte");
  const source = new TFile("Recherche/Sources/Dupont.md", "---\nauthor: Dupont\n---\n");
  const registry = registryContent === undefined
    ? null
    : new TFile("Projet/_Feuillets/Ressources/Ressources internes/citations.json", registryContent);
  project.children = [manuscript, resources];
  manuscript.parent = project;
  manuscript.children = [sheet];
  sheet.parent = manuscript;
  resources.parent = project;
  resources.children = [resourcesRoot];
  resourcesRoot.parent = resources;
  resourcesRoot.children = [internal];
  internal.parent = resourcesRoot;
  if (registry) internal.children = [registry];
  if (registry) registry.parent = internal;
  const entries = [project, manuscript, resources, resourcesRoot, internal, sheet, source];
  if (registry) entries.push(registry);
  const { vault } = createFakeVault(entries);
  const settings = {
    projectFolder: manuscript.path,
    projectMeta: { [manuscript.path]: {} },
    orders: {},
    folderPositions: {},
  };
  return {
    app: { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } },
    settings,
    manuscript,
    sheet,
    source,
    registry,
    path: "Projet/_Feuillets/Ressources/Ressources internes/citations.json",
  };
}

test("registre absent : lecture vide et sans création", async () => {
  const state = fixture();
  assert.deepEqual(await loadCitationRegistry(state.app, state.settings), { version: 1, citations: [] });
  assert.equal(state.app.vault.getAbstractFileByPath(state.path), null);
});

test("registre valide : lecture fidèle", async () => {
  const state = fixture(JSON.stringify({ version: 1, citations: [] }));
  assert.deepEqual(await loadCitationRegistry(state.app, state.settings), { version: 1, citations: [] });
});

test("JSON ou structure invalide : erreur dédiée sans écrasement", async () => {
  for (const content of ["{", JSON.stringify({ version: 2, citations: [] }), JSON.stringify({ version: 1, citations: [{}] })]) {
    const state = fixture(content);
    await assert.rejects(loadCitationRegistry(state.app, state.settings), CitationRegistryCorruptedError);
    assert.equal(state.registry?.content, content);
  }
});

test("ajout crée une occurrence V1 avec ancre exacte et source externe", async () => {
  const state = fixture();
  const content = "Avant (Dupont, 2025) après";
  const quote = "(Dupont, 2025)";
  const start = 6;
  const occurrence = await addCitationOccurrence(state.app, state.settings, state.sheet, state.source, content, start, start + quote.length);
  assert.equal(occurrence?.file, "Chapitre.md");
  assert.equal(occurrence?.sourcePath, state.source.path);
  assert.equal(occurrence?.quote, quote);
  assert.equal(occurrence?.id.length > 0, true);
  assert.deepEqual(await loadCitationRegistry(state.app, state.settings), { version: 1, citations: [occurrence] });
  assert.deepEqual(resolveCitationOccurrence(occurrence, `Préfixe\n${content}`), { start: start + 8, end: start + 8 + quote.length });
});

test("plage invalide refusée, suppression et ambiguïté restent non résolues", async () => {
  const state = fixture();
  assert.equal(await addCitationOccurrence(state.app, state.settings, state.sheet, state.source, "texte", 5, 5), null);
  assert.deepEqual(await loadCitationRegistry(state.app, state.settings), { version: 1, citations: [] });
  const content = "x(Ibid.)x(Ibid.)x";
  const occurrence = await addCitationOccurrence(state.app, state.settings, state.sheet, state.source, content, 1, 8);
  assert.equal(resolveCitationOccurrence({ ...occurrence, start: -1, end: 0, prefix: "", suffix: "" }, content), null);
});

test("remap suit le feuillet relatif et la Source physique", async () => {
  const state = fixture();
  const content = "Texte";
  await addCitationOccurrence(state.app, state.settings, state.sheet, state.source, content, 0, 5);
  const changed = await remapCitationRegistryAfterRename(
    state.app,
    state.settings,
    state.sheet.path,
    "Projet/Manuscrit/Partie A/Chapitre.md"
  );
  assert.equal(changed, true);
  const sourceChanged = await remapCitationRegistryAfterRename(
    state.app,
    state.settings,
    "Recherche/Sources",
    "Recherche/Bibliographie"
  );
  assert.equal(sourceChanged, true);
  const registry = await loadCitationRegistry(state.app, state.settings);
  assert.equal(registry.citations[0].file, "Partie A/Chapitre.md");
  assert.equal(registry.citations[0].sourcePath, "Recherche/Bibliographie/Dupont.md");
});

test("insertCitationFor conserve l'insertion parenthétique et enregistre la cible capturée", async () => {
  const state = fixture();
  const editor = {
    value: "Avant ",
    getValue() { return this.value; },
    getCursor() { return { line: 0, ch: 6 }; },
    posToOffset(position) { return position.ch; },
    replaceRange(text, from) { this.value = `${this.value.slice(0, from.ch)}${text}${this.value.slice(from.ch)}`; },
    setCursor() {},
    focus() {},
  };
  const plugin = {
    app: state.app,
    settings: state.settings,
    _lastCitedSourceByFile: new Map(),
    fmOf: () => ({ author: "Dupont", title: "Titre", date: "2025", publisher: "Éditeur" }),
    citationStyleFor: () => "parenthetical",
    markSourceCited: () => {},
    recordCitationOccurrence: FeuilletsPlugin.prototype.recordCitationOccurrence,
  };
  FeuilletsPlugin.prototype.insertCitationFor.call(plugin, state.source, "", editor, state.sheet);
  assert.equal(editor.getValue(), "Avant (Dupont, 2025)");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const registry = await loadCitationRegistry(state.app, state.settings);
  assert.equal(registry.citations[0].file, "Chapitre.md");
  assert.equal(registry.citations[0].quote, "(Dupont, 2025)");
});

test("note de bas de page et Ibid. enregistrent le corps de citation", async () => {
  const state = fixture();
  const editor = {
    value: "Avant ",
    getValue() { return this.value; },
    getCursor() { return { line: 0, ch: this.value.length }; },
    posToOffset(position) { return position.ch; },
    replaceRange(text, from) { this.value = `${this.value.slice(0, from.ch)}${text}${this.value.slice(from.ch)}`; },
    lastLine() { return this.value.split("\n").length - 1; },
    getLine(line) { return this.value.split("\n")[line]; },
    setCursor() {},
    focus() {},
  };
  const plugin = {
    app: state.app,
    settings: state.settings,
    _lastCitedSourceByFile: new Map(),
    fmOf: () => ({ author: "Dupont", title: "Titre", date: "2025", publisher: "Éditeur" }),
    citationStyleFor: () => "footnote",
    markSourceCited: () => {},
    recordCitationOccurrence: FeuilletsPlugin.prototype.recordCitationOccurrence,
  };
  FeuilletsPlugin.prototype.insertCitationFor.call(plugin, state.source, "12", editor, state.sheet);
  await new Promise((resolve) => setTimeout(resolve, 0));
  FeuilletsPlugin.prototype.insertCitationFor.call(plugin, state.source, "13", editor, state.sheet);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const registry = await loadCitationRegistry(state.app, state.settings);
  assert.equal(registry.citations.length, 2);
  assert.equal(registry.citations[0].quote.includes("Dupont"), true);
  assert.equal(registry.citations[0].quote.startsWith("[^"), false);
  assert.equal(registry.citations[1].quote.startsWith("Ibid."), true);
  assert.equal(editor.getValue().includes("<!--"), false);
});

test("le chemin public réutilise l'emplacement sidecar existant", () => {
  const state = fixture();
  assert.equal(citationRegistryPath(state.app, state.settings), state.path);
});

test("le resolver de compilation déduplique, exclut les ancres mortes et signale les records indexés", async () => {
  const state = fixture();
  const content = "Avant (Dupont, 2025) après";
  await state.app.vault.modify(state.sheet, content);
  await addCitationOccurrence(state.app, state.settings, state.sheet, state.source, content, 6, 20);
  const first = await resolveCitedSourceFilesForCompileFiles(state.app, state.settings, [state.sheet]);
  assert.equal(first.hasIndexedOccurrences, true);
  assert.deepEqual(first.sourceFiles.map((file) => file.path), [state.source.path]);

  await state.app.vault.modify(state.sheet, "Citation supprimée");
  const dead = await resolveCitedSourceFilesForCompileFiles(state.app, state.settings, [state.sheet]);
  assert.equal(dead.hasIndexedOccurrences, true);
  assert.deepEqual(dead.sourceFiles, []);

  const outside = new TFile("Projet/Manuscrit/Hors-scope.md", content);
  outside.parent = state.manuscript;
  state.manuscript.children.push(outside);
  const noApplicableRecord = await resolveCitedSourceFilesForCompileFiles(state.app, state.settings, [outside]);
  assert.equal(noApplicableRecord.hasIndexedOccurrences, false);
});

test("la compilation utilise les citations du CompileScope et ignore cite_count hors scope", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const part1 = new TFolder("Projet/Manuscrit/Partie 1");
  const part2 = new TFolder("Projet/Manuscrit/Partie 2");
  const research = new TFolder("Projet/_Recherche");
  const sources = new TFolder("Projet/_Recherche/Sources");
  const internalRoot = new TFolder("Projet/_Feuillets");
  const internalResources = new TFolder("Projet/_Feuillets/Ressources");
  const internal = new TFolder("Projet/_Feuillets/Ressources/Ressources internes");
  const file1 = new TFile("Projet/Manuscrit/Partie 1/A.md", "Texte A");
  const file2 = new TFile("Projet/Manuscrit/Partie 2/B.md", "Texte B");
  const source1 = new TFile("Projet/_Recherche/Sources/Source A.md", "---\nauthor: Auteur A\ntitle: Titre A\n---\n");
  const source2 = new TFile("Projet/_Recherche/Sources/Source B.md", "---\nauthor: Auteur B\ntitle: Titre B\n---\n");
  const legacyOnly = new TFile("Projet/_Recherche/Sources/Legacy.md", "---\nauthor: Legacy\ntitle: Ancienne\ncite_count: 1\n---\n");
  volume.children = [manuscript, research, internalRoot];
  manuscript.parent = volume;
  manuscript.children = [part1, part2];
  part1.parent = manuscript;
  part2.parent = manuscript;
  part1.children = [file1];
  part2.children = [file2];
  file1.parent = part1;
  file2.parent = part2;
  research.parent = volume;
  research.children = [sources];
  sources.parent = research;
  sources.children = [source1, source2, legacyOnly];
  source1.parent = sources;
  source2.parent = sources;
  legacyOnly.parent = sources;
  internalRoot.parent = volume;
  internalRoot.children = [internalResources];
  internalResources.parent = internalRoot;
  internalResources.children = [internal];
  internal.parent = internalResources;
  const { vault } = createFakeVault([
    volume, manuscript, part1, part2, research, sources, internalRoot,
    internalResources, internal, file1, file2, source1, source2, legacyOnly,
  ]);
  vault.cachedRead = vault.read;
  const frontmatter = new Map([
    [file1.path, {}],
    [file2.path, {}],
    [source1.path, { author: "Auteur A", title: "Titre A" }],
    [source2.path, { author: "Auteur B", title: "Titre B" }],
    [legacyOnly.path, { author: "Legacy", title: "Ancienne", cite_count: 1 }],
  ]);
  const app = {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) || {} }) },
  };
  const settings = {
    projectFolder: manuscript.path,
    projectMeta: {},
    level1Role: "parties",
    orders: {},
    folderPositions: {},
    compileFileName: "Manuscrit.md",
    insertFolderTitles: false,
    insertTitles: false,
    insertSceneTitles: false,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
  };
  const meta = settings.projectMeta[manuscript.path] = {};
  writeGeneratedIncluded(meta, "bibliography", true);
  await addCitationOccurrence(app, settings, file1, source1, file1.content, 0, file1.content.length);
  await addCitationOccurrence(app, settings, file2, source2, file2.content, 0, file2.content.length);

  const part2Files = resolveCompileScopeFiles(app, settings, { type: "folder", projectRoot: manuscript.path, path: part2.path });
  const part2Resolution = await resolveCitedSourceFilesForCompileFiles(app, settings, part2Files);
  assert.deepEqual(part2Resolution.sourceFiles.map((file) => file.path), [source2.path]);

  const result = await compile(app, settings, null, { type: "project", projectRoot: manuscript.path }, null, { writeOutput: false });
  assert.ok(result);
  assert.match(result.manuscript, /Auteur A/);
  assert.match(result.manuscript, /Auteur B/);
  assert.doesNotMatch(result.manuscript, /Legacy/);
});
