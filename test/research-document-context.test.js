import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { resolveResearchDocumentContext } from "../src/services/research-document-context.js";
import { flattenFiles } from "../src/services/folder-structure.js";
import { ResearchView } from "../src/views/research-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";

function makeFixture() {
  const projectRoot = new TFolder("Project/Manuscript");
  const partOne = new TFolder("Project/Manuscript/Part One");
  const partOneSub = new TFolder("Project/Manuscript/Part One/Sub");
  const hiddenFolder = new TFolder("Project/Manuscript/Part One/_Hidden");
  const partOneExtra = new TFolder("Project/Manuscript/Part One-Extra");
  const partTwo = new TFolder("Project/Manuscript/Part Two");
  const externalFolder = new TFolder("Other/External");
  const researchFolder = new TFolder("Project/Manuscript/_Research");

  const sceneOne = new TFile("Project/Manuscript/Part One/Scene One.md", "# One");
  const sceneSub = new TFile("Project/Manuscript/Part One/Sub/Scene Sub.md", "# Sub");
  const hiddenScene = new TFile("Project/Manuscript/Part One/_Hidden/Hidden Scene.md", "# Hidden");
  const sceneExtra = new TFile("Project/Manuscript/Part One-Extra/Scene Extra.md", "# Extra");
  const sceneTwo = new TFile("Project/Manuscript/Part Two/Scene Two.md", "# Two");
  const externalScene = new TFile("Other/External/External Scene.md", "# External");
  const researchNote = new TFile("Project/Manuscript/_Research/Note.md", "# Note");
  const attachmentPdf = new TFile("Project/Manuscript/Part One/Attachment.pdf", "binary");

  projectRoot.children = [partOne, partOneExtra, partTwo, researchFolder];
  partOne.parent = projectRoot;
  partOneExtra.parent = projectRoot;
  partTwo.parent = projectRoot;
  researchFolder.parent = projectRoot;

  partOne.children = [partOneSub, hiddenFolder, sceneOne, attachmentPdf];
  partOneSub.parent = partOne;
  hiddenFolder.parent = partOne;
  sceneOne.parent = partOne;
  attachmentPdf.parent = partOne;

  partOneSub.children = [sceneSub];
  sceneSub.parent = partOneSub;

  hiddenFolder.children = [hiddenScene];
  hiddenScene.parent = hiddenFolder;

  partOneExtra.children = [sceneExtra];
  sceneExtra.parent = partOneExtra;

  partTwo.children = [sceneTwo];
  sceneTwo.parent = partTwo;

  externalFolder.children = [externalScene];
  externalScene.parent = externalFolder;

  researchFolder.children = [researchNote];
  researchNote.parent = researchFolder;

  const { vault } = createFakeVault([
    projectRoot, partOne, partOneSub, hiddenFolder, partOneExtra, partTwo, externalFolder, researchFolder,
    sceneOne, sceneSub, hiddenScene, sceneExtra, sceneTwo, externalScene, researchNote, attachmentPdf,
  ]);

  const settings = {
    projectFolder: projectRoot.path,
    projectMeta: { [projectRoot.path]: {} },
    orders: {},
    folderPositions: {},
  };

  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };

  return {
    app, settings,
    projectRoot, partOne, partOneSub, hiddenFolder, partOneExtra, partTwo, externalFolder, researchFolder,
    sceneOne, sceneSub, hiddenScene, sceneExtra, sceneTwo, externalScene, researchNote, attachmentPdf,
  };
}

/* --- Fundamental resolution --- */

test("the Project scope returns every feuillet of the project", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, null, "project");
  assert.equal(ctx.mode, "project");
  assert.equal(ctx.projectRoot, f.projectRoot);
  assert.equal(ctx.scopeRoot, f.projectRoot);
  assert.equal(ctx.workspaceRoot, null);
  const paths = ctx.files.map((file) => file.path);
  assert.ok(paths.includes(f.sceneOne.path));
  assert.ok(paths.includes(f.sceneSub.path));
  assert.ok(paths.includes(f.sceneExtra.path));
  assert.ok(paths.includes(f.sceneTwo.path));
});

test("a valid isolated workspace returns only its own feuillets", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOne, "workspace");
  assert.equal(ctx.mode, "workspace");
  assert.equal(ctx.scopeRoot, f.partOne);
  assert.equal(ctx.workspaceRoot, f.partOne);
  assert.deepEqual(
    ctx.files.map((file) => file.path),
    flattenFiles(f.app, f.settings, f.partOne).map((file) => file.path)
  );
});

test("sibling spaces are excluded from an isolated workspace", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOne, "workspace");
  const paths = ctx.files.map((file) => file.path);
  assert.ok(!paths.includes(f.sceneExtra.path));
  assert.ok(!paths.includes(f.sceneTwo.path));
});

test("files nested inside the isolated workspace are included", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOne, "workspace");
  const paths = ctx.files.map((file) => file.path);
  assert.ok(paths.includes(f.sceneSub.path));
});

test("a nested workspace excludes the other files of its parent folder", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOneSub, "workspace");
  const paths = ctx.files.map((file) => file.path);
  assert.deepEqual(paths, [f.sceneSub.path]);
  assert.ok(!paths.includes(f.sceneOne.path));
});

test("a null workspace folder falls back to the Project scope", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, null, "workspace");
  assert.equal(ctx.mode, "project");
  assert.equal(ctx.scopeRoot, f.projectRoot);
  assert.equal(ctx.workspaceRoot, null);
});

test("a folder outside the project falls back to the Project scope", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.externalFolder, "workspace");
  assert.equal(ctx.mode, "project");
  assert.equal(ctx.scopeRoot, f.projectRoot);
  assert.equal(ctx.workspaceRoot, null);
});

test("the project root passed as the workspace folder stays a Project scope", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.projectRoot, "workspace");
  assert.equal(ctx.mode, "project");
  assert.equal(ctx.scopeRoot, f.projectRoot);
  assert.equal(ctx.workspaceRoot, null);
});

test("Part One and Part One-Extra are never confused", () => {
  const f = makeFixture();
  const partOneCtx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOne, "workspace");
  const partOneExtraCtx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOneExtra, "workspace");
  assert.ok(!partOneCtx.files.map((file) => file.path).includes(f.sceneExtra.path));
  assert.ok(!partOneExtraCtx.files.map((file) => file.path).includes(f.sceneOne.path));
  assert.deepEqual(partOneExtraCtx.files.map((file) => file.path), [f.sceneExtra.path]);
});

test("the existing Binder order is preserved", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, null, "project");
  const expected = flattenFiles(f.app, f.settings, f.projectRoot).map((file) => file.path);
  assert.deepEqual(ctx.files.map((file) => file.path), expected);
});

test("auxiliary folders already excluded by flattenFiles stay excluded", () => {
  const f = makeFixture();
  const ctx = resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOne, "workspace");
  const paths = ctx.files.map((file) => file.path);
  assert.ok(!paths.includes(f.hiddenScene.path));
});

/* --- Purity --- */

test("settings are strictly identical before and after resolution", () => {
  const f = makeFixture();
  const before = JSON.stringify(f.settings);
  resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOne, "workspace");
  assert.equal(JSON.stringify(f.settings), before);
});

test("no folder or file is created by the resolver", () => {
  const f = makeFixture();
  const before = f.app.vault.getFiles().length;
  resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOne, "workspace");
  resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, null, "project");
  assert.equal(f.app.vault.getFiles().length, before);
});

test("no object given to the resolver is mutated", () => {
  const f = makeFixture();
  const projectChildrenBefore = [...f.projectRoot.children];
  const partOneChildrenBefore = [...f.partOne.children];
  resolveResearchDocumentContext(f.app, f.settings, f.projectRoot, f.partOne, "workspace");
  assert.deepEqual(f.projectRoot.children, projectChildrenBefore);
  assert.deepEqual(f.partOne.children, partOneChildrenBefore);
});

/* --- Integration with ResearchView --- */

function stubContainer() {
  return {
    addClass() {},
    removeClass() {},
    empty() {},
  };
}

function createIntegrationView(f, { workspaceFolder, scopeMode = "workspace", activeFile = null } = {}) {
  const activeFileHolder = { current: activeFile };
  const app = {
    vault: f.app.vault,
    metadataCache: f.app.metadataCache,
    workspace: { getActiveFile: () => activeFileHolder.current },
  };
  const plugin = {
    settings: f.settings,
    getProjectFolder: () => f.projectRoot,
    getWorkspaceFolder: () => workspaceFolder,
    getResearchRoot: () => null,
  };
  const leaf = { app, contentEl: stubContainer() };
  const view = new ResearchView(leaf, plugin);
  view.researchScopeMode = scopeMode;
  return { view, activeFileHolder };
}

async function renderAndCapture(view) {
  let captured;
  view.renderResearchBody = async (container, currentRoot, generation, options) => {
    captured = options;
  };
  await view.render(true);
  return captured;
}

test("ResearchView transmits the resolved document context to renderResearchBody", async () => {
  const f = makeFixture();
  const { view } = createIntegrationView(f, { workspaceFolder: f.partOne });
  const options = await renderAndCapture(view);
  assert.ok(options.documentContext);
  assert.equal(options.documentContext.mode, "workspace");
  assert.equal(options.documentContext.scopeRoot, f.partOne);
  assert.deepEqual(
    options.documentContext.files.map((file) => file.path),
    flattenFiles(f.app, f.settings, f.partOne).map((file) => file.path)
  );
});

test("the context stays grounded on the isolated workspace when the active file is a Research note", async () => {
  const f = makeFixture();
  const { view } = createIntegrationView(f, { workspaceFolder: f.partOne, activeFile: f.researchNote });
  const options = await renderAndCapture(view);
  assert.equal(options.documentContext.scopeRoot, f.partOne);
  assert.deepEqual(
    options.documentContext.files.map((file) => file.path),
    flattenFiles(f.app, f.settings, f.partOne).map((file) => file.path)
  );
});

test("the context stays grounded on the isolated workspace when the active file is an imported PDF", async () => {
  const f = makeFixture();
  const { view } = createIntegrationView(f, { workspaceFolder: f.partOne, activeFile: f.attachmentPdf });
  const options = await renderAndCapture(view);
  assert.equal(options.documentContext.scopeRoot, f.partOne);
  assert.deepEqual(
    options.documentContext.files.map((file) => file.path),
    flattenFiles(f.app, f.settings, f.partOne).map((file) => file.path)
  );
});

test("the context stays grounded on the isolated workspace when the active file is outside it", async () => {
  const f = makeFixture();
  const { view } = createIntegrationView(f, { workspaceFolder: f.partOne, activeFile: f.sceneTwo });
  const options = await renderAndCapture(view);
  assert.equal(options.documentContext.scopeRoot, f.partOne);
  assert.deepEqual(
    options.documentContext.files.map((file) => file.path),
    flattenFiles(f.app, f.settings, f.partOne).map((file) => file.path)
  );
});

test("changing only the active file never changes scopeRoot nor files", async () => {
  const f = makeFixture();
  const { view, activeFileHolder } = createIntegrationView(f, { workspaceFolder: f.partOne, activeFile: f.sceneOne });
  const first = await renderAndCapture(view);
  activeFileHolder.current = f.researchNote;
  const second = await renderAndCapture(view);
  activeFileHolder.current = f.attachmentPdf;
  const third = await renderAndCapture(view);

  assert.equal(first.documentContext.scopeRoot, f.partOne);
  assert.equal(second.documentContext.scopeRoot, f.partOne);
  assert.equal(third.documentContext.scopeRoot, f.partOne);
  const firstPaths = first.documentContext.files.map((file) => file.path);
  assert.deepEqual(second.documentContext.files.map((file) => file.path), firstPaths);
  assert.deepEqual(third.documentContext.files.map((file) => file.path), firstPaths);
});

test("switching from the Workspace scope to the Project scope produces the expected new context", async () => {
  const f = makeFixture();
  const { view } = createIntegrationView(f, { workspaceFolder: f.partOne, scopeMode: "workspace" });
  const workspaceOptions = await renderAndCapture(view);
  assert.equal(workspaceOptions.documentContext.mode, "workspace");
  assert.equal(workspaceOptions.documentContext.scopeRoot, f.partOne);

  view.researchScopeMode = "project";
  const projectOptions = await renderAndCapture(view);
  assert.equal(projectOptions.documentContext.mode, "project");
  assert.equal(projectOptions.documentContext.scopeRoot, f.projectRoot);
  assert.deepEqual(
    projectOptions.documentContext.files.map((file) => file.path),
    flattenFiles(f.app, f.settings, f.projectRoot).map((file) => file.path)
  );
});
