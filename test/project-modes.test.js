import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_MODES, resolveType, applyModeDefaults } from "../src/utils/project-modes.js";
import { BOARD_MODES } from "../src/constants.js";

test("la vue centrale Carte/Plan ne propose plus le mode Lecture/Scrivening", () => {
  assert.deepEqual(
    BOARD_MODES.map(([key]) => key),
    ["board", "outline", "arcs", "timeline"]
  );
});

test("PROJECT_MODES", async (t) => {
  await t.test("les 2 modes attendus existent", () => {
    assert.deepEqual(Object.keys(PROJECT_MODES).sort(), ["fiction", "nonfiction"]);
  });

  await t.test("chaque mode a un vocabulaire et des réglages complets", () => {
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      assert.ok(mode.label, `${key}.label`);
      assert.ok(mode.yamlPreset, `${key}.yamlPreset`);
      assert.ok(mode.unit, `${key}.unit`);
      assert.equal(typeof mode.hasSources, "boolean", `${key}.hasSources`);
      assert.ok(mode.defaults, `${key}.defaults`);
      assert.ok(mode.researchFolders, `${key}.researchFolders`);
      /* rf.bibliographie est le seul rôle garanti dans les deux modes —
         personnages/lieux/codex/glossaire/evenements n'existent qu'en
         fiction, sources n'existe qu'en non-fiction (voir le test dédié
         ci-dessous : ces rubriques ne sont plus imposées d'avance en
         non-fiction, l'utilisateur crée les siennes via le bouton
         "Nouvelle rubrique"). */
      const entry = mode.researchFolders.bibliographie;
      assert.ok(entry, `${key}.researchFolders.bibliographie`);
      assert.ok(entry.label, `${key}.researchFolders.bibliographie.label`);
      assert.ok(entry.newName, `${key}.researchFolders.bibliographie.newName`);
      assert.ok(entry.tag, `${key}.researchFolders.bibliographie.tag`);
    }
  });

  await t.test("fiction garde Personnages/Lieux/Lore/Glossaire/Événements, pas de dossier Sources dédié", () => {
    const rf = PROJECT_MODES.fiction.researchFolders;
    assert.equal(rf.personnages.label, "Characters");
    assert.equal(rf.lieux.label, "Places");
    assert.equal(rf.codex.label, "Lore");
    assert.equal(rf.glossaire.label, "Glossary");
    assert.equal(rf.evenements.label, "Events");
    assert.equal(rf.sources, undefined);
  });

  await t.test("non-fiction ne garde que Sources + Bibliographie, aucune rubrique imposée", () => {
    const rf = PROJECT_MODES.nonfiction.researchFolders;
    assert.equal(rf.sources.label, "Sources");
    assert.equal(rf.bibliographie.label, "Bibliography");
    assert.equal(rf.personnages, undefined);
    assert.equal(rf.lieux, undefined);
    assert.equal(rf.codex, undefined);
    assert.equal(rf.glossaire, undefined);
    assert.equal(rf.evenements, undefined);
  });

  await t.test("Bibliographie identique dans les deux modes (seul rôle partagé)", () => {
    for (const mode of Object.values(PROJECT_MODES)) {
      assert.equal(mode.researchFolders.bibliographie.label, "Bibliography");
    }
  });
});

test("resolveType", async (t) => {
  await t.test("reconnaît fiction/nonfiction directement", () => {
    assert.equal(resolveType("fiction"), "fiction");
    assert.equal(resolveType("nonfiction"), "nonfiction");
  });

  await t.test("ramène les anciennes valeurs de type sur la bonne famille", () => {
    assert.equal(resolveType("roman"), "fiction");
    assert.equal(resolveType("nouvelle"), "fiction");
    assert.equal(resolveType("essai"), "nonfiction");
    assert.equal(resolveType("these"), "nonfiction");
    assert.equal(resolveType("thèse"), "nonfiction");
    assert.equal(resolveType("article"), "nonfiction");
  });

  await t.test("retombe sur fiction pour une valeur inconnue, absente ou vide", () => {
    assert.equal(resolveType("recueil"), "fiction");
    assert.equal(resolveType(undefined), "fiction");
    assert.equal(resolveType(""), "fiction");
  });
});

test("applyModeDefaults", async (t) => {
  await t.test("applique les réglages par défaut du mode", () => {
    const settings = { boardMode: "read", cardContent: "extrait" };
    applyModeDefaults(settings, "nonfiction");
    assert.equal(settings.boardMode, "outline");
    assert.equal(settings.cardContent, "summary");
    assert.equal(settings.mergeYamlPreset, "minimal");
  });

  await t.test("retombe sur fiction pour un type inconnu", () => {
    const settings = {};
    applyModeDefaults(settings, "recueil");
    assert.equal(settings.boardMode, "board");
    assert.equal(settings.mergeYamlPreset, "roman");
  });
});
