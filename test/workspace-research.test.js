import assert from "node:assert/strict";
import test from "node:test";
import { TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { resolveWorkspaceResearchFolder } from "../src/services/workspace-research.js";

function fixture() {
  const project = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const romans = new TFolder("Projet/Manuscrit/Romans");
  const bozlak = new TFolder("Projet/Manuscrit/Romans/Bozlak");
  const suvasa = new TFolder("Projet/Manuscrit/Romans/Suvasa");
  const globalResearch = new TFolder("Projet/Recherche");
  const anatolie = new TFolder("Documentation/Anatolie");
  const suvasaResearch = new TFolder("Documentation/Suvasa");
  project.children = [manuscript, globalResearch];
  manuscript.parent = project;
  manuscript.children = [romans];
  romans.parent = manuscript;
  romans.children = [bozlak, suvasa];
  bozlak.parent = romans;
  suvasa.parent = romans;
  const { vault } = createFakeVault([project, manuscript, romans, bozlak, suvasa, globalResearch, anatolie, suvasaResearch]);
  const settings = {
    projectFolder: manuscript.path,
    projectMeta: { [manuscript.path]: { researchFolderLinks: {} } },
  };
  return { app: { vault }, settings, manuscript, romans, bozlak, suvasa, anatolie, suvasaResearch, globalResearch };
}

test("résout le lien exact puis l'héritage parent", () => {
  const state = fixture();
  state.settings.projectMeta[state.manuscript.path].researchFolderLinks[state.romans.path] = state.anatolie.path;
  assert.deepEqual(resolveWorkspaceResearchFolder(state.app, state.settings, state.romans), {
    folder: state.anatolie,
    sourceKind: "exact",
    sourceBinderPath: state.romans.path,
  });
  assert.deepEqual(resolveWorkspaceResearchFolder(state.app, state.settings, state.bozlak), {
    folder: state.anatolie,
    sourceKind: "ancestor",
    sourceBinderPath: state.romans.path,
  });
});

test("le lien exact prime et deux clés peuvent partager une même Recherche", () => {
  const state = fixture();
  const links = state.settings.projectMeta[state.manuscript.path].researchFolderLinks;
  links[state.bozlak.path] = state.anatolie.path;
  links[state.suvasa.path] = state.anatolie.path;
  const bozlak = resolveWorkspaceResearchFolder(state.app, state.settings, state.bozlak);
  const suvasa = resolveWorkspaceResearchFolder(state.app, state.settings, state.suvasa);
  assert.equal(bozlak.folder, state.anatolie);
  assert.equal(suvasa.folder, state.anatolie);
  assert.equal(bozlak.sourceKind, "exact");
  assert.equal(suvasa.sourceKind, "exact");
  links[state.suvasa.path] = state.suvasaResearch.path;
  assert.equal(resolveWorkspaceResearchFolder(state.app, state.settings, state.suvasa).folder, state.suvasaResearch);
  assert.equal(resolveWorkspaceResearchFolder(state.app, state.settings, state.bozlak).folder, state.anatolie);
});

test("la Recherche globale est le dernier repli, sans workspace local", () => {
  const state = fixture();
  assert.deepEqual(resolveWorkspaceResearchFolder(state.app, state.settings, null), {
    folder: state.globalResearch,
    sourceKind: "project",
    sourceBinderPath: null,
  });
  assert.deepEqual(resolveWorkspaceResearchFolder(state.app, state.settings, state.manuscript), {
    folder: state.globalResearch,
    sourceKind: "project",
    sourceBinderPath: null,
  });
});

test("un lien orphelin est ignoré et la résolution reste pure", () => {
  const state = fixture();
  const meta = state.settings.projectMeta[state.manuscript.path];
  meta.researchFolderLinks[state.romans.path] = "Documentation/Disparue";
  const before = JSON.stringify(state.settings);
  const result = resolveWorkspaceResearchFolder(state.app, state.settings, state.bozlak);
  assert.equal(result.folder, state.globalResearch);
  assert.equal(result.sourceKind, "project");
  assert.equal(JSON.stringify(state.settings), before);
});
