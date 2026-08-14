import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { authorReviewSessionsRootPath, locateNativeReviewSession, reviewSessionPaths, reviewerReviewStorageLocation } from "../src/services/native-review-storage.js";

test("storage : inbox reviewer et chemins d'une session sont centralisés", () => {
  const location = reviewerReviewStorageLocation();
  const paths = reviewSessionPaths(location, "review-abc");
  assert.equal(location.sessionsRootPath, "_Feuillets/Relectures");
  assert.equal(paths.root, "_Feuillets/Relectures/review-abc");
  assert.equal(paths.threadsFile, "_Feuillets/Relectures/review-abc/threads.json");
  assert.equal(paths.localStateFile, "_Feuillets/Relectures/review-abc/local-state.json");
});

test("storage : projets structurés A/B et projet adopté sont isolés", () => {
  const a = new TFolder("Roman A/Manuscrit"); const b = new TFolder("Roman B/Manuscrit"); const adopted = new TFolder("Articles");
  const parentA = new TFolder("Roman A"); const parentB = new TFolder("Roman B"); a.parent = parentA; b.parent = parentB; parentA.children = [a]; parentB.children = [b];
  const state = createFakeVault([parentA, a, parentB, b, adopted]); const app = { vault: state.vault };
  assert.equal(authorReviewSessionsRootPath(app, { projectFolder: a.path }), "Roman A/_Feuillets/Relectures");
  assert.equal(authorReviewSessionsRootPath(app, { projectFolder: b.path }), "Roman B/_Feuillets/Relectures");
  assert.equal(authorReviewSessionsRootPath(app, { projectFolder: adopted.path }), "Articles/_Feuillets/Relectures");
});

test("storage : collision projet actif/inbox est contrôlée", () => {
  const project = new TFolder("Roman"); const manuscript = new TFolder("Roman/Manuscrit"); manuscript.parent = project; project.children = [manuscript];
  const projectSession = new TFile("Roman/_Feuillets/Relectures/review-same/session.json", "{}"); const inboxSession = new TFile("_Feuillets/Relectures/review-same/session.json", "{}");
  const state = createFakeVault([project, manuscript, projectSession, inboxSession]); const app = { vault: state.vault };
  assert.throws(() => locateNativeReviewSession(app, "review-same", { projectFolder: manuscript.path }), /Collision/);
});
