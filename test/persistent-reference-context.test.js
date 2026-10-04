import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { resolveResearchDocumentContext } from "../src/services/research-document-context.js";
import { resolveReferenceContextRoot, resolveReferenceDocumentContext, resolveReferenceCitationContext, referenceBibliographyFile } from "../src/services/research-reference-search.js";
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
