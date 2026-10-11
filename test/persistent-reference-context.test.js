import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { registerOuvrage, unregisterOuvrage } from "../src/services/editorial-roots.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { resolveResearchDocumentContext } from "../src/services/research-document-context.js";
import { resolveReferenceContextRoot, resolveReferenceDocumentContext, resolveReferenceCitationContext, resolveReferenceTargetFile, referenceBibliographyFile } from "../src/services/research-reference-search.js";
import { registerDeclaredWorkspaceRoot, isDeclaredWorkspaceRoot } from "../src/services/folder-workspaces.js";
import { resolveDocumentCitationStyleSetting } from "../src/services/document-citation-style.js";
import { resolveWorkspaceCitationResources } from "../src/services/workspace-citations.js";
import { resolvePandocCitationPreviewForFile } from "../src/services/pandoc-citation-preview.js";

function fixture() {
  const root = new TFolder("TEXTES");
  const warpi = new TFolder("TEXTES/WARPI");
  const nefes = new TFolder("TEXTES/WARPI/NEFES");
  const part = new TFolder("TEXTES/WARPI/NEFES/Partie I");
  const sibling = new TFolder("TEXTES/Article");
  const scene = new TFile(`${part.path}/Scene.md`, "See [@local].");
  const direct = new TFile(`${warpi.path}/Notes.md`, "See [@parent].");
  const other = new TFile(`${sibling.path}/Other.md`, "See [@foreign].");
  const globalResearch = new TFolder("Research");
  const localResearch = new TFolder("LocalResearch");
  const foreignResearch = new TFolder("ForeignResearch");
  const projectBib = new TFile("Research/project.bib", "@article{project,title={Project}}");
  const projectCsl = new TFile("Research/project.csl", "<style/>");
  const localBib = new TFile("LocalResearch/local.bib", "@article{local,title={Local}}");
  const localCsl = new TFile("LocalResearch/local.csl", "<style/>");
  const foreignBib = new TFile("ForeignResearch/foreign.bib", "@article{foreign,title={Foreign}}");
  const nodes = [root, warpi, nefes, part, sibling, scene, direct, other, globalResearch, localResearch, foreignResearch,
    projectBib, projectCsl, localBib, localCsl, foreignBib];
  for (const node of nodes) {
    node.parent = nodes.find((parent) => parent instanceof TFolder && parent.path === node.path.slice(0, node.path.lastIndexOf("/"))) ?? null;
    node.parent?.children.push(node);
  }
  const { vault } = createFakeVault(nodes);
  const settings = { projectFolder: root.path, orders: {}, folderPositions: {}, workspaceFolderPath: "", projectMeta: {
    TEXTES: { researchFolderLinks: { TEXTES: globalResearch.path, [warpi.path]: localResearch.path, [sibling.path]: foreignResearch.path },
      pandocCitationPreviewStyle: "csl", citekeyBibliographyPath: "project.bib", citekeyCslPath: "project.csl" },
  } };
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const base = resolveResearchDocumentContext(app, settings, root, null, "project");
  return { app, settings, root, warpi, nefes, part, sibling, scene, direct, other, projectBib, projectCsl, localBib, localCsl, foreignBib, base };
}

for (const { name, declared, file, isolated, expected } of [
  { name: "A: persistent workspace without isolation", declared: ["warpi"], file: "direct", expected: "warpi" },
  { name: "B: deepest nested workspace", declared: ["warpi", "nefes"], file: "scene", expected: "nefes" },
  { name: "C: parent workspace outside its child", declared: ["warpi", "nefes"], file: "direct", expected: "warpi" },
  { name: "D: ordinary folder falls back to project", declared: [], file: "scene", expected: "root" },
  { name: "E: deeper isolation narrows persistent context", declared: ["nefes"], file: "scene", isolated: "part", expected: "part" },
  { name: "F: wider isolation never expands persistent context", declared: ["warpi", "nefes"], file: "scene", isolated: "warpi", expected: "nefes" },
  { name: "G: isolation without declarations retains its scope", declared: [], file: "scene", isolated: "part", expected: "part" },
  { name: "foreign isolation cannot affect the target", declared: ["nefes"], file: "scene", isolated: "sibling", expected: "nefes" },
]) {
  test(`reference context ${name}`, () => {
    const f = fixture();
    for (const key of declared) registerDeclaredWorkspaceRoot(f.settings, f.root, f[key]);
    f.settings.workspaceFolderPath = isolated ? f[isolated].path : "";
    const before = structuredClone(f.settings);
    const isolation = isolated ? f[isolated] : null;
    assert.equal(resolveReferenceContextRoot(f.app, f.settings, f.root, f[file], isolation), f[expected]);
    const context = resolveReferenceDocumentContext(f.app, f.settings, f.base, f[file], isolation);
    assert.equal(context.scopeRoot, f[expected]);
    assert.equal(context.mode, expected === "root" ? "project" : "workspace");
    assert.equal(context.files.includes(f[file]), true);
    if (expected !== "root") assert.equal(context.files.includes(f.other), false);
    const citation = resolveReferenceCitationContext(f.app, f.settings, context, f[file]);
    assert.equal(citation.targetScope, f[file]);
    assert.equal(citation.scopeRoot, f[expected]);
    assert.deepEqual(f.settings, before);
    assert.equal(f.base.scopeRoot, f.root, "the general Research context remains unchanged");
  });
}

test("References normalizes a stale sibling Research context from the real project boundary", () => {
  const f = fixture();
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  const stale = resolveResearchDocumentContext(f.app, f.settings, f.root, f.sibling, "workspace");
  const normalized = resolveReferenceDocumentContext(f.app, f.settings, stale, f.scene, f.sibling);
  assert.equal(normalized.scopeRoot, f.nefes);
  assert.equal(normalized.workspaceRoot, f.nefes);
  assert.equal(normalized.mode, "workspace");
  assert.equal(normalized.files.includes(f.other), false);
  assert.equal(stale.scopeRoot, f.sibling, "general Research context is not mutated");
});

test("References normalizes workspace identity even when scopeRoot already matches", () => {
  const f = fixture();
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  const partial = { ...f.base, scopeRoot: f.nefes };
  const normalized = resolveReferenceDocumentContext(f.app, f.settings, partial, f.scene, null);
  assert.equal(normalized.workspaceRoot, f.nefes);
  assert.equal(normalized.mode, "workspace");
  assert.equal(normalized.files.includes(f.other), false);
});

test("References prefers the active document and uses a remembered editor only without an active file", () => {
  const f = fixture();
  f.app.workspace = { getActiveFile: () => f.scene };
  assert.equal(resolveReferenceTargetFile(f.app, f.root, f.other), f.scene);
  f.app.workspace.getActiveFile = () => null;
  assert.equal(resolveReferenceTargetFile(f.app, f.root, f.scene), f.scene);
  assert.equal(resolveReferenceTargetFile(f.app, f.root, f.localBib), null);
  f.app.workspace.getActiveFile = () => f.localBib;
  assert.equal(resolveReferenceTargetFile(f.app, f.root, f.scene), null, "an active foreign document must not silently restore the old context");
});

test("reference context does not infer workspaces from ordinary overrides or ouvrage", () => {
  const f = fixture();
  f.settings.projectMeta.TEXTES.folderWorkspaces = { "WARPI/NEFES/Partie I": {
    version: 1, ouvrage: { version: 1 }, wordGoal: 2000, citekeyBibliographyPath: "local.bib", citekeyCslPath: "local.csl", pandocCitationPreviewStyle: "author-date",
  } };
  const before = structuredClone(f.settings);
  assert.equal(resolveReferenceContextRoot(f.app, f.settings, f.root, f.scene, null), f.root);
  assert.equal(isDeclaredWorkspaceRoot(f.app, f.settings, f.root, f.part), false);
  assert.equal(referenceBibliographyFile(f.app, f.settings, f.base, f.scene), f.localBib);
  const resources = resolveWorkspaceCitationResources(f.app, f.settings, f.root, f.scene);
  assert.equal(resources.csl.file, f.localCsl);
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene).style, "author-date");
  assert.deepEqual(f.settings, before);
});

for (const [projectStyle, workspaceStyle] of [["csl", "off"], ["off", "csl"]]) {
  test(`persistent reference style ${workspaceStyle} overrides project ${projectStyle} without isolation`, () => {
    const f = fixture();
    registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
    f.settings.projectMeta.TEXTES.pandocCitationPreviewStyle = projectStyle;
    const config = f.settings.projectMeta.TEXTES.folderWorkspaces["WARPI/NEFES"];
    Object.assign(config, { pandocCitationPreviewStyle: workspaceStyle, citekeyBibliographyPath: "local.bib", citekeyCslPath: "local.csl" });
    const context = resolveReferenceDocumentContext(f.app, f.settings, f.base, f.scene, null);
    const citation = resolveReferenceCitationContext(f.app, f.settings, context, f.scene);
    assert.equal(citation.scopeRoot, f.nefes);
    assert.equal(resolveDocumentCitationStyleSetting(f.settings, f.root.path, f.part.path).value, workspaceStyle);
    assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene).style, workspaceStyle);
    assert.equal(referenceBibliographyFile(f.app, f.settings, context, f.scene), f.localBib);
    assert.equal(resolveWorkspaceCitationResources(f.app, f.settings, f.root, citation.targetScope).csl.file, f.localCsl);
    assert.equal(f.settings.workspaceFolderPath, "");
  });
}

test("identity-only workspace inherits parent resources and style; deleting overrides restores inheritance", () => {
  const f = fixture();
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.warpi);
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  const configs = f.settings.projectMeta.TEXTES.folderWorkspaces;
  Object.assign(configs.WARPI, { pandocCitationPreviewStyle: "author-date", citekeyBibliographyPath: "local.bib", citekeyCslPath: "local.csl" });
  const context = resolveReferenceDocumentContext(f.app, f.settings, f.base, f.scene, null);
  for (const apply of [() => {}, () => {
    Object.assign(configs["WARPI/NEFES"], { pandocCitationPreviewStyle: "off", citekeyBibliographyPath: "", citekeyCslPath: "" });
    assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene).style, "off");
    for (const field of ["pandocCitationPreviewStyle", "citekeyBibliographyPath", "citekeyCslPath"]) delete configs["WARPI/NEFES"][field];
  }]) {
    apply();
    assert.equal(referenceBibliographyFile(f.app, f.settings, context, f.scene), f.localBib);
    assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene).style, "author-date");
    assert.equal(resolveWorkspaceCitationResources(f.app, f.settings, f.root, f.scene).csl.file, f.localCsl);
  }
  delete configs.WARPI.pandocCitationPreviewStyle;
  delete configs.WARPI.citekeyBibliographyPath;
  delete configs.WARPI.citekeyCslPath;
  assert.equal(referenceBibliographyFile(f.app, f.settings, context, f.scene), f.projectBib);
  assert.equal(resolveWorkspaceCitationResources(f.app, f.settings, f.root, f.scene).csl.file, f.projectCsl);
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene).style, "csl");
});

test("sibling persistent workspace never supplies another workspace's bibliography, CSL or style", () => {
  const f = fixture();
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.sibling);
  Object.assign(f.settings.projectMeta.TEXTES.folderWorkspaces.Article, { citekeyBibliographyPath: "foreign.bib", pandocCitationPreviewStyle: "off" });
  const context = resolveReferenceDocumentContext(f.app, f.settings, f.base, f.scene, f.sibling);
  assert.equal(context.scopeRoot, f.nefes);
  assert.equal(referenceBibliographyFile(f.app, f.settings, context, f.scene), f.projectBib);
  assert.equal(resolveWorkspaceCitationResources(f.app, f.settings, f.root, f.scene).csl.file, f.projectCsl);
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene).style, "csl");
});

test("ordinary descendant overrides still supply actual document values inside a declared workspace", () => {
  const f = fixture();
  registerDeclaredWorkspaceRoot(f.settings, f.root, f.nefes);
  f.settings.projectMeta.TEXTES.folderWorkspaces["WARPI/NEFES/Partie I"] = {
    version: 1, pandocCitationPreviewStyle: "off", citekeyBibliographyPath: "local.bib", citekeyCslPath: "local.csl",
  };
  const context = resolveReferenceDocumentContext(f.app, f.settings, f.base, f.scene, null);
  const citation = resolveReferenceCitationContext(f.app, f.settings, context, f.scene);
  assert.equal(citation.scopeRoot, f.nefes, "settings write scope remains explicit");
  assert.equal(citation.targetScope, f.scene, "reads follow the actual document");
  assert.equal(referenceBibliographyFile(f.app, f.settings, context, f.scene), f.localBib);
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.scene).style, "off");
});


function independentWorkspaceFixture() {
  const root = new TFolder("Project");
  const nodes = [root];
  const folders = {};
  const scenes = {};
  const bibliographies = {};
  const styles = {};
  const researchLinks = {};
  for (const name of ["general", "A", "B", "C"]) {
    const folder = name === "general" ? root : new TFolder(`${root.path}/${name}`);
    const research = new TFolder(`Research-${name}`);
    const key = name === "general" ? "general" : name.toLowerCase();
    const bib = new TFile(`${research.path}/${key}.bib`, `@article{${key},title={${name}}}`);
    const csl = new TFile(`${research.path}/${key}.csl`, "<style/>");
    const scene = new TFile(`${folder.path}/Scene.md`, `---\ntitle: ${name}\n---\n*Original* [@${key}]  \n`);
    nodes.push(...(folder === root ? [] : [folder]), research, bib, csl, scene);
    folders[name] = folder; scenes[name] = scene;
    bibliographies[name] = bib; styles[name] = csl;
    if (name !== "C") researchLinks[folder.path] = research.path;
  }
  const child = new TFolder("Project/A/Child");
  const childScene = new TFile(`${child.path}/Scene.md`, "Original child [@child].\n");
  const childBib = new TFile("Research-A/child.bib", "@article{child,title={Child}}");
  nodes.push(child, childScene, childBib);
  for (const node of nodes) {
    node.parent = nodes.find((parent) => parent instanceof TFolder && parent.path === node.path.slice(0, node.path.lastIndexOf("/"))) ?? null;
    node.parent?.children.push(node);
  }
  const { vault } = createFakeVault(nodes);
  const settings = { projectFolder: root.path, projectMeta: { [root.path]: {
    type: "fiction",
    researchFolderLinks: researchLinks, citekeyBibliographyPath: "general.bib", citekeyCslPath: "general.csl", pandocCitationPreviewStyle: "csl",
    folderWorkspaces: {
      A: { version: 1, workspaceRoot: true, ouvrage: { version: 1, composition: { outputBasename: "Work A" } },
        citekeyBibliographyPath: "a.bib", citekeyCslPath: "a.csl", pandocCitationPreviewStyle: "author-date", wordGoal: 2000 },
      B: { version: 1, workspaceRoot: true, citekeyBibliographyPath: "b.bib", citekeyCslPath: "b.csl", pandocCitationPreviewStyle: "off" },
      "A/Child": { version: 1, citekeyBibliographyPath: "child.bib" },
    },
  } } };
  const app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const originals = new Map(nodes.filter((node) => node instanceof TFile && node.extension === "md")
    .map((file) => [file, Buffer.from(file.content)]));
  return { app, settings, root, folders, scenes, bibliographies, styles, child, childScene, childBib, originals };
}

function assertIndependentResources(f, settings = f.settings) {
  for (const [name, expected, mode] of [["A", "A", "author-date"], ["B", "B", "off"], ["C", "general", "csl"]]) {
    const resource = resolveWorkspaceCitationResources(f.app, settings, f.root, f.scenes[name]);
    assert.equal(resource.bibliography.file, f.bibliographies[expected]);
    assert.equal(resource.csl.file, f.styles[expected]);
    assert.equal(resolvePandocCitationPreviewForFile(f.app, settings, f.scenes[name]).style, mode);
  }
  const child = resolveWorkspaceCitationResources(f.app, settings, f.root, f.childScene);
  assert.equal(child.bibliography.file, f.childBib);
  assert.equal(child.csl.file, f.styles.A);
  assert.equal(resolvePandocCitationPreviewForFile(f.app, settings, f.childScene).style, "author-date");
  for (const [file, bytes] of f.originals) assert.deepEqual(Buffer.from(file.content), bytes);
}

test("A, B and C resolve independent resources, including ordinary descendants, under every temporary isolation", () => {
  const f = independentWorkspaceFixture();
  for (const isolated of [null, f.folders.A, f.folders.B, f.folders.C, f.child]) {
    f.settings.workspaceFolderPath = isolated?.path ?? "";
    assertIndependentResources(f);
  }
  const preferences = structuredClone(f.settings.projectMeta.Project.folderWorkspaces.A);
  unregisterOuvrage(f.settings, f.root, f.folders.A);
  assertIndependentResources(f);
  registerOuvrage(f.settings, f.root, f.folders.A);
  const current = f.settings.projectMeta.Project.folderWorkspaces.A;
  for (const field of ["workspaceRoot", "citekeyBibliographyPath", "citekeyCslPath", "pandocCitationPreviewStyle", "wordGoal"]) {
    assert.deepEqual(current[field], preferences[field]);
  }
});

test("A/B bibliographic resources, ordinary overrides and identities survive actual plugin save/load", async () => {
  const f = independentWorkspaceFixture();
  const before = structuredClone(f.settings.projectMeta.Project);
  let persisted;
  const plugin = Object.assign(Object.create(FeuilletsPlugin.prototype), {
    app: f.app, settings: f.settings, saveData: async (value) => { persisted = JSON.stringify(value); },
  });
  await plugin.saveSettings();
  const reloaded = Object.assign(Object.create(FeuilletsPlugin.prototype), {
    app: f.app, loadData: async () => JSON.parse(persisted), saveData: plugin.saveData,
  });
  await reloaded.loadSettings();
  assert.deepEqual(reloaded.settings.projectMeta.Project, before);
  assertIndependentResources(f, reloaded.settings);
});

test("deleting only bibliography overrides restores parent then project resources independently", () => {
  const f = independentWorkspaceFixture();
  const configs = f.settings.projectMeta.Project.folderWorkspaces;
  delete configs["A/Child"].citekeyBibliographyPath;
  assert.equal(resolveWorkspaceCitationResources(f.app, f.settings, f.root, f.childScene).bibliography.file, f.bibliographies.A);
  const identities = { version: 1, workspaceRoot: true, ouvrage: structuredClone(configs.A.ouvrage), wordGoal: 2000 };
  for (const field of ["citekeyBibliographyPath", "citekeyCslPath", "pandocCitationPreviewStyle"]) delete configs.A[field];
  assert.deepEqual(configs.A, identities);
  const restored = resolveWorkspaceCitationResources(f.app, f.settings, f.root, f.childScene);
  assert.equal(restored.bibliography.file, f.bibliographies.general);
  assert.equal(restored.csl.file, f.styles.general);
  assert.equal(resolvePandocCitationPreviewForFile(f.app, f.settings, f.childScene).style, "csl");
  assert.equal(resolveWorkspaceCitationResources(f.app, f.settings, f.root, f.scenes.B).bibliography.file, f.bibliographies.B);
  for (const [file, bytes] of f.originals) assert.deepEqual(Buffer.from(file.content), bytes);
});
