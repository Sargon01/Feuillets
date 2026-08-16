import assert from "node:assert/strict";
import test from "node:test";
import { TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  activeProjectMeta,
  projectStatuses,
  projectFavoriteTags,
  projectWordGoalDefault,
  projectTolerance,
  projectTotalWordGoal,
  projectDeadline,
  projectSessionGoal,
} from "../src/services/project-settings.js";
import { getProjectStatuses, getStatusColor } from "../src/constants.js";

/* Chantier « panneau Projet + métadonnées + mapping YAML », Phase A — §34
 * du chantier : deux projets actifs successivement ne doivent JAMAIS se
 * mélanger, et un projet sans surcharge doit retomber sur le réglage
 * global historique, à l'identique du comportement d'avant ce chantier. */

function fakeApp(vault) {
  return { vault };
}

function baseSettings() {
  return {
    projectFolder: "",
    projectMeta: {},
    statuses: [{ name: "Idée", color: "#111111" }, { name: "Brouillon", color: "#222222" }],
    favoriteTags: ["global-tag"],
    wordGoal: 1500,
    tolerance: 50,
    projectWordGoal: 80000,
    deadlineDate: "2027-01-01",
    sessionGoal: 500,
  };
}

test("activeProjectMeta", async (t) => {
  await t.test("aucun projet actif -> null, jamais d'exception", () => {
    const { vault } = createFakeVault();
    const settings = baseSettings();
    assert.equal(activeProjectMeta(fakeApp(vault), settings), null);
  });

  await t.test("projet actif sans fiche ProjectMeta -> null (pas de création silencieuse)", () => {
    const folder = new TFolder("Roman1");
    const { vault } = createFakeVault([folder]);
    const settings = baseSettings();
    settings.projectFolder = "Roman1";
    assert.equal(activeProjectMeta(fakeApp(vault), settings), null);
    // La simple LECTURE ne doit jamais faire apparaître de fiche dans data.json.
    assert.equal(settings.projectMeta["Roman1"], undefined);
  });
});

test("Projet A / Projet B : aucun mélange (§34)", () => {
  const folderA = new TFolder("RomanA");
  const folderB = new TFolder("RomanB");
  const { vault } = createFakeVault([folderA, folderB]);
  const app = fakeApp(vault);

  const settings = baseSettings();
  settings.projectMeta = {
    RomanA: {
      statuses: [{ name: "A-Statut", color: "#aaaaaa" }],
      favoriteTags: ["tag-a"],
      wordGoal: 1000,
      tolerance: 10,
      projectWordGoal: 40000,
      deadlineDate: "2026-06-01",
      sessionGoal: 300,
    },
    RomanB: {
      statuses: [{ name: "B-Statut", color: "#bbbbbb" }],
      favoriteTags: ["tag-b"],
      wordGoal: 2000,
      tolerance: 20,
      projectWordGoal: 60000,
      deadlineDate: "2026-12-31",
      sessionGoal: 700,
    },
  };

  settings.projectFolder = "RomanA";
  assert.deepEqual(projectStatuses(app, settings), [{ name: "A-Statut", color: "#aaaaaa" }]);
  assert.deepEqual(projectFavoriteTags(app, settings), ["tag-a"]);
  assert.equal(projectWordGoalDefault(app, settings), 1000);
  assert.equal(projectTolerance(app, settings), 10);
  assert.equal(projectTotalWordGoal(app, settings), 40000);
  assert.equal(projectDeadline(app, settings), "2026-06-01");
  assert.equal(projectSessionGoal(app, settings), 300);

  settings.projectFolder = "RomanB";
  assert.deepEqual(projectStatuses(app, settings), [{ name: "B-Statut", color: "#bbbbbb" }]);
  assert.deepEqual(projectFavoriteTags(app, settings), ["tag-b"]);
  assert.equal(projectWordGoalDefault(app, settings), 2000);
  assert.equal(projectTolerance(app, settings), 20);
  assert.equal(projectTotalWordGoal(app, settings), 60000);
  assert.equal(projectDeadline(app, settings), "2026-12-31");
  assert.equal(projectSessionGoal(app, settings), 700);
});

test("projet sans surcharge -> repli sur le réglage global historique", () => {
  const folder = new TFolder("SansSurcharge");
  const { vault } = createFakeVault([folder]);
  const app = fakeApp(vault);
  const settings = baseSettings();
  settings.projectFolder = "SansSurcharge";
  settings.projectMeta = { SansSurcharge: {} };

  assert.deepEqual(projectStatuses(app, settings), settings.statuses);
  assert.deepEqual(projectFavoriteTags(app, settings), settings.favoriteTags);
  assert.equal(projectWordGoalDefault(app, settings), settings.wordGoal);
  assert.equal(projectTolerance(app, settings), settings.tolerance);
  assert.equal(projectTotalWordGoal(app, settings), settings.projectWordGoal);
  assert.equal(projectDeadline(app, settings), settings.deadlineDate);
  assert.equal(projectSessionGoal(app, settings), settings.sessionGoal);
});

test("surcharge partielle : seuls les champs renseignés priment, le reste reste global", () => {
  const folder = new TFolder("Partiel");
  const { vault } = createFakeVault([folder]);
  const app = fakeApp(vault);
  const settings = baseSettings();
  settings.projectFolder = "Partiel";
  settings.projectMeta = { Partiel: { wordGoal: 999 } };

  assert.equal(projectWordGoalDefault(app, settings), 999);
  // tolerance non surchargée : repli sur le réglage global.
  assert.equal(projectTolerance(app, settings), settings.tolerance);
  assert.deepEqual(projectStatuses(app, settings), settings.statuses);
});

test("getProjectStatuses/getStatusColor (constants.ts) suivent la même surcharge projet", () => {
  const folder = new TFolder("StatutsProjet");
  const { vault } = createFakeVault([folder]);
  const app = fakeApp(vault);
  const settings = baseSettings();
  settings.projectFolder = "StatutsProjet";
  settings.projectMeta = {
    StatutsProjet: { statuses: [{ name: "Custom", color: "#ff00ff" }] },
  };

  assert.deepEqual(getProjectStatuses(app, settings), ["", "Custom"]);
  assert.equal(getStatusColor(app, settings, "Custom"), "#ff00ff");
  // Le statut global "Idée" n'existe plus dans ce projet : pas de repli partiel.
  assert.equal(getStatusColor(app, settings, "Idée"), null);

  // Sans app/settings (repli historique brut) : toujours fonctionnel.
  assert.deepEqual(getProjectStatuses(null, settings), ["", "Idée", "Brouillon"]);
});
