import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import {
  resolveContextualResearchCategory,
  resolveWorkspaceResearchContext,
} from "../src/services/workspace-research-context.js";
import { resolveBibliographySourceInResearchRoot } from "../src/services/bibliography-generator.js";
import FeuilletsPlugin from "../src/main.js";
import { createFakeVault } from "./helpers/fake-vault.js";

function makeFixture() {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const workspace = new TFolder("Projet/Manuscrit/Partie 1");
  const sibling = new TFolder("Projet/Manuscrit/Partie 2");
  const childWorkspace = new TFolder("Projet/Manuscrit/Partie 1/Sous-espace");
  const projectResearch = new TFolder("Projet/Recherche");
  const projectSources = new TFolder("Projet/Recherche/Sources");
  const localResearch = new TFolder("Documentation/Partie 1");
  const localSources = new TFolder("Documentation/Partie 1/Sources");
  const externalResearch = new TFolder("Documentation/Notes externes");
  const externalSources = new TFolder("Documentation/Notes externes/Sources");
  const nestedResearch = new TFolder("Documentation/Partie 1/Feuille 3");
  const scene = new TFile("Projet/Manuscrit/Partie 1/Scene.md", "# Scène");
  const nestedFile = new TFile("Projet/Manuscrit/Partie 1/Feuille 3.md", "# Feuille");
  const siblingScene = new TFile("Projet/Manuscrit/Partie 2/Scene.md", "# Scène");
  project.children = [manuscript, projectResearch];
  manuscript.parent = project;
  manuscript.children = [workspace, sibling];
  workspace.parent = manuscript;
  sibling.parent = manuscript;
  workspace.children = [childWorkspace, scene, nestedFile];
  sibling.children = [siblingScene];
  scene.parent = workspace;
  childWorkspace.parent = workspace;
  nestedFile.parent = workspace;
  siblingScene.parent = sibling;
  projectResearch.parent = project;
  projectResearch.children = [projectSources];
  projectSources.parent = projectResearch;
  localResearch.children = [localSources];
  localSources.parent = localResearch;
  externalResearch.children = [externalSources];
  externalSources.parent = externalResearch;
  const { vault } = createFakeVault([
    project, manuscript, workspace, childWorkspace, sibling, projectResearch, projectSources,
    localResearch, localSources, externalResearch, externalSources, nestedResearch, scene, nestedFile, siblingScene,
  ]);
  const settings = {
    projectFolder: manuscript.path,
    projectMeta: { [manuscript.path]: { researchFolderLinks: {} } },
    orders: {},
    folderPositions: {},
  };
  const app = {
    vault,
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
  };
  return {
    app,
    settings,
    manuscript,
    workspace,
    childWorkspace,
    sibling,
    projectResearch,
    projectSources,
    localResearch,
    localSources,
    externalResearch,
    externalSources,
    nestedResearch,
    scene,
    nestedFile,
    siblingScene,
  };
}

test("sans workspace, le contexte ne contient que la Recherche Projet", () => {
  const state = makeFixture();
  const roots = resolveWorkspaceResearchContext(state.app, state.settings, null);
  assert.deepEqual(roots.map((root) => [root.folder.path, root.origin]), [["Projet/Recherche", "project"]]);
});

test("workspace exact puis association TFile, dans l'ordre et sans mutation", () => {
  const state = makeFixture();
  const links = state.settings.projectMeta[state.manuscript.path].researchFolderLinks;
  links[state.workspace.path] = state.localResearch.path;
  links[state.scene.path] = state.externalResearch.path;
  const before = JSON.stringify(state.settings);
  const roots = resolveWorkspaceResearchContext(state.app, state.settings, state.workspace);
  assert.deepEqual(roots.map((root) => [root.folder.path, root.origin, root.sourceBinderPath]), [
    ["Projet/Recherche", "project", null],
    ["Documentation/Partie 1", "workspace", state.workspace.path],
    ["Documentation/Notes externes", "file", state.scene.path],
  ]);
  assert.equal(JSON.stringify(state.settings), before);
});

test("workspace héritant, fallback projet et frère TFile sont distingués", () => {
  const state = makeFixture();
  const links = state.settings.projectMeta[state.manuscript.path].researchFolderLinks;
  links[state.workspace.path] = state.localResearch.path;
  links[state.siblingScene.path] = state.externalResearch.path;
  const inherited = resolveWorkspaceResearchContext(state.app, state.settings, state.childWorkspace);
  assert.deepEqual(inherited.map((root) => root.origin), ["project", "workspace"]);
  assert.equal(inherited[1].workspaceSourceKind, "ancestor");

  delete links[state.workspace.path];
  const fallback = resolveWorkspaceResearchContext(state.app, state.settings, state.childWorkspace);
  assert.deepEqual(fallback.map((root) => root.origin), ["project"]);
});

test("les liens TFile identiques sont dédupliqués, même si le lien est descendant", () => {
  const state = makeFixture();
  const links = state.settings.projectMeta[state.manuscript.path].researchFolderLinks;
  links[state.workspace.path] = state.localResearch.path;
  links[state.scene.path] = state.nestedResearch.path;
  links[state.nestedFile.path] = state.nestedResearch.path;
  const roots = resolveWorkspaceResearchContext(state.app, state.settings, state.workspace);
  assert.deepEqual(roots.map((root) => root.folder.path), ["Projet/Recherche", "Documentation/Partie 1", "Documentation/Partie 1/Feuille 3"]);
});

test("les catégories globales et locales gardent leur provenance", () => {
  const state = makeFixture();
  const links = state.settings.projectMeta[state.manuscript.path].researchFolderLinks;
  links[state.workspace.path] = state.localResearch.path;
  const sources = resolveContextualResearchCategory(state.app, state.settings, state.workspace, "sources");
  assert.deepEqual(sources.map((entry) => [entry.folder.path, entry.origin]), [
    ["Projet/Recherche/Sources", "project"],
    ["Documentation/Partie 1/Sources", "workspace"],
  ]);
});

test("les catégories ne sont cherchées qu'à la racine ou parmi ses enfants directs", () => {
  const state = makeFixture();
  const direct = resolveContextualResearchCategory(state.app, state.settings, null, "sources");
  assert.deepEqual(direct.map((entry) => [entry.folder.path, entry.origin]), [["Projet/Recherche/Sources", "project"]]);
  const hidden = new TFolder("Projet/Recherche/Partie 1");
  hidden.children = [new TFolder("Projet/Recherche/Partie 1/Sources")];
  hidden.children[0].parent = hidden;
  state.projectResearch.children.push(hidden);
  const stillDirect = resolveContextualResearchCategory(state.app, state.settings, null, "sources");
  assert.deepEqual(stillDirect.map((entry) => entry.folder.path), ["Projet/Recherche/Sources"]);
});

test("une racine Sources gagne sur Bibliographie legacy", () => {
  const state = makeFixture();
  const bibliography = new TFolder("Projet/Recherche/Bibliographie");
  bibliography.parent = state.projectResearch;
  state.projectResearch.children.push(bibliography);
  const resolved = resolveBibliographySourceInResearchRoot(state.app, state.projectResearch);
  assert.equal(resolved?.folder, state.projectSources);
  assert.equal(resolved?.canonical, true);
  const legacy = resolveBibliographySourceInResearchRoot(state.app, bibliography);
  assert.equal(legacy?.folder, bibliography);
  assert.equal(legacy?.canonical, false);
});

test("getCitationFolders conserve le projet seul sans workspace et agrège le workspace actif", () => {
  const state = makeFixture();
  const plugin = {
    app: state.app,
    settings: state.settings,
    getWorkspaceFolder: () => null,
  };
  const projectOnly = FeuilletsPlugin.prototype.getCitationFolders.call(plugin);
  assert.deepEqual(projectOnly.map((folder) => folder.path), ["Projet/Recherche/Sources"]);

  const links = state.settings.projectMeta[state.manuscript.path].researchFolderLinks;
  links[state.workspace.path] = state.localResearch.path;
  plugin.getWorkspaceFolder = () => state.workspace;
  const contextual = FeuilletsPlugin.prototype.getCitationFolders.call(plugin);
  assert.deepEqual(contextual.map((folder) => folder.path), [
    "Projet/Recherche/Sources",
    "Documentation/Partie 1/Sources",
  ]);

  links[state.scene.path] = state.externalResearch.path;
  const withFile = FeuilletsPlugin.prototype.getCitationFolders.call(plugin);
  assert.deepEqual(withFile.map((folder) => folder.path), [
    "Projet/Recherche/Sources",
    "Documentation/Partie 1/Sources",
    "Documentation/Notes externes/Sources",
  ]);
});
