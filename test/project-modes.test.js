import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_MODES, resolveType, applyModeDefaults } from "../src/utils/project-modes.js";

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
      for (const role of ["bibliographie", "personnages", "lieux", "codex", "glossaire", "evenements"]) {
        const entry = mode.researchFolders[role];
        assert.ok(entry, `${key}.researchFolders.${role}`);
        assert.ok(entry.label, `${key}.researchFolders.${role}.label`);
        assert.ok(entry.newName, `${key}.researchFolders.${role}.newName`);
        assert.ok(entry.tag, `${key}.researchFolders.${role}.tag`);
      }
    }
  });

  await t.test("fiction garde Personnages/Lieux/Lore, pas de dossier Sources dédié", () => {
    const rf = PROJECT_MODES.fiction.researchFolders;
    assert.equal(rf.personnages.label, "Personnages");
    assert.equal(rf.lieux.label, "Lieux");
    assert.equal(rf.codex.label, "Lore");
    assert.equal(rf.sources, undefined);
  });

  await t.test("non-fiction utilise Acteurs/Géographie/Concepts + Sources", () => {
    const rf = PROJECT_MODES.nonfiction.researchFolders;
    assert.equal(rf.personnages.label, "Acteurs");
    assert.equal(rf.lieux.label, "Géographie");
    assert.equal(rf.codex.label, "Concepts");
    assert.equal(rf.sources.label, "Sources");
  });

  await t.test("Bibliographie/Glossaire/Événements identiques dans les deux modes", () => {
    for (const mode of Object.values(PROJECT_MODES)) {
      const rf = mode.researchFolders;
      assert.equal(rf.bibliographie.label, "Bibliographie");
      assert.equal(rf.glossaire.label, "Glossaire");
      assert.equal(rf.evenements.label, "Événements");
    }
  });

  await t.test("le tag structurel des rôles partagés ne varie jamais selon le mode", () => {
    for (const role of ["personnages", "lieux", "codex", "bibliographie", "glossaire", "evenements"]) {
      assert.equal(
        PROJECT_MODES.fiction.researchFolders[role].tag,
        PROJECT_MODES.nonfiction.researchFolders[role].tag
      );
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
    assert.equal(settings.cardContent, "resume");
    assert.equal(settings.mergeYamlPreset, "minimal");
  });

  await t.test("retombe sur fiction pour un type inconnu", () => {
    const settings = {};
    applyModeDefaults(settings, "recueil");
    assert.equal(settings.boardMode, "board");
    assert.equal(settings.mergeYamlPreset, "roman");
  });
});
