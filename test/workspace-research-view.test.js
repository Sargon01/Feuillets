import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const viewSource = readFileSync("src/views/research-view.ts", "utf8");
const baseSource = readFileSync("src/views/base-feuillets-view.ts", "utf8");

test("ResearchView garde la portée Espace/Projet en session et réutilise le résolveur 6A", () => {
  assert.match(viewSource, /researchScopeMode: ResearchScopeMode = "workspace"/);
  assert.match(viewSource, /this\.plugin\.getWorkspaceFolder\(\)/);
  assert.match(viewSource, /workspaceFolder,/);
  assert.match(viewSource, /resolveWorkspaceResearchFolder\(this\.app, this\.plugin\.settings, workspaceFolder\)/);
  assert.match(viewSource, /researchRoot: projectResearchRoot/);
  assert.match(viewSource, /associatedResearchFolder/);
  assert.match(viewSource, /sourceKind === "exact"/);
  assert.match(viewSource, /sourceKind === "ancestor"/);
  assert.match(viewSource, /this\.researchScopeMode = mode/);
  assert.doesNotMatch(viewSource, /onScopeModeChange[\s\S]{0,300}saveSettings/);
  assert.doesNotMatch(viewSource, /onScopeModeChange[\s\S]{0,300}setWorkspaceFolder/);
  assert.doesNotMatch(viewSource, /onScopeModeChange[\s\S]{0,300}clearWorkspaceFolder/);
});

test("le renderer commun affiche le sélecteur uniquement avec un workspace descendant", () => {
  assert.match(baseSource, /if \(options\.workspaceActive\)/);
  assert.match(baseSource, /shared\.research\.scopeLabel/);
  assert.match(baseSource, /shared\.research\.scopeWorkspace/);
  assert.match(baseSource, /shared\.research\.scopeProject/);
  assert.match(baseSource, /iconBtn\(toolbar, "layers-3", scopeTooltip\)/);
  assert.match(baseSource, /showAtMouseEvent\(event\)/);
  assert.match(baseSource, /scopeTooltip/);
  assert.doesNotMatch(baseSource, /text: options\.scopeMode/);
  assert.match(baseSource, /options\.researchRoot !== undefined/);
});

test("la portée Espace utilise ses Événements et masque les associations des frères", () => {
  assert.match(baseSource, /options\.workspaceActive && options\.scopeMode === "workspace"/);
  assert.match(baseSource, /findResearchCategoryFolder\(baseResearch, rf, "evenements"\)/);
  assert.match(baseSource, /const showProjectAssociations/);
  assert.match(baseSource, /this\.renderAssociatedResearchFolders\(body, baseResearchFolder\)/);
  assert.match(baseSource, /workspaceFileResearchFolders\(options\.workspaceFolder\)/);
  assert.match(baseSource, /associatedWorkspaceFolder\.name/);
  assert.match(baseSource, /this\.renderSection\(body, associatedWorkspaceFolder\.name, associatedWorkspaceFolder/);
  assert.match(baseSource, /binder\.research\.newFileDefaultName/);
  assert.match(baseSource, /associatedWorkspaceFolder \? null : this\.findResearchCategoryFolder/);
  assert.match(baseSource, /shared\.research\.workspaces/);
  assert.match(baseSource, /new Map<string, \{ folder: TFolder; binderNodes: TAbstractFile\[\] \}>/);
  assert.match(baseSource, /groupBody/);
  assert.ok(
    baseSource.indexOf("if (sourcesFolder)") < baseSource.indexOf("this.renderAssociatedResearchFolders(body, baseResearchFolder)"),
    "la rubrique Espaces est rendue après les catégories globales"
  );
});

test("les recherches d'espaces héritées restent regroupées sous Espaces", () => {
  assert.match(baseSource, /!linkedResearchPaths\.has\(child\.path\)/);
  assert.doesNotMatch(baseSource, /linkedFolderIsNaturallyVisible/);
  assert.match(baseSource, /naturallyLinkedWorkspaceFolders/);
  assert.match(baseSource, /this\.renderAssociatedResearchFolders\(\s*body,\s*baseResearchFolder,\s*\[\.\.\.naturallyLinkedWorkspaceFolders, \.\.\.this\.workspaceFileResearchFolders\(options\.workspaceFolder\)\],\s*true,\s*true\s*\)/s);
});
