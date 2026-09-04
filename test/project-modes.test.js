import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_MODES,
  projectCreationStyle,
  resolveType,
  applyModeDefaults,
  semanticPlanningField,
  resolveBoardCardContent,
  resolveBoardOutlineColumns,
} from "../src/utils/project-modes.js";
import { BOARD_MODES } from "../src/constants.js";

test("la vue centrale propose exactement 4 modes : Couloirs est une sous-vue de arcs, jamais un mode", () => {
  /* LOT 5C §2 : l'architecture impose EXACTEMENT board / outline / arcs /
     timeline — Couloirs n'est PAS un mode mais une sous-vue de l'espace
     narratif (arcs). */
  assert.deepEqual(
    BOARD_MODES.map(([key]) => key),
    ["board", "outline", "arcs", "timeline"]
  );
});

test("PROJECT_MODES", async (t) => {
  await t.test("les 3 modes attendus existent", () => {
    assert.deepEqual(Object.keys(PROJECT_MODES).sort(), ["fiction", "free", "nonfiction"]);
  });

  await t.test("chaque mode a un vocabulaire et des réglages complets", () => {
    for (const [key, mode] of Object.entries(PROJECT_MODES)) {
      assert.ok(mode.label, `${key}.label`);
      assert.ok(mode.yamlPreset, `${key}.yamlPreset`);
      assert.ok(mode.unit, `${key}.unit`);
      assert.equal(typeof mode.hasSources, "boolean", `${key}.hasSources`);
      assert.ok(mode.defaults, `${key}.defaults`);
      assert.ok(mode.boardDefaults, `${key}.boardDefaults`);
      assert.ok(mode.researchFolders, `${key}.researchFolders`);
      /* rf.bibliographie existe en fiction et non-fiction uniquement —
         en libre, aucun dossier n'est imposé, l'utilisateur les crée
         via le bouton "Nouvelle rubrique". */
      if (key !== "free") {
        const entry = mode.researchFolders.bibliographie;
        assert.ok(entry, `${key}.researchFolders.bibliographie`);
        assert.ok(entry.label, `${key}.researchFolders.bibliographie.label`);
        assert.ok(entry.newName, `${key}.researchFolders.bibliographie.newName`);
        assert.ok(entry.tag, `${key}.researchFolders.bibliographie.tag`);
      }
    }
  });

  await t.test("les defaults centraux gardent Cartes et Plan visibles selon le type", () => {
    /* LOT 5C §2 : Couloirs n'est PAS un mode — il ne figure donc JAMAIS dans
       hiddenBoardModes. Non-fiction/Libre masquent l'espace narratif entier
       (arcs + timeline) dès la création ; Fiction ne masque que timeline. */
    assert.deepEqual(PROJECT_MODES.fiction.boardDefaults.hiddenBoardModes, ["timeline"]);
    assert.deepEqual(PROJECT_MODES.nonfiction.boardDefaults.hiddenBoardModes, ["arcs", "timeline"]);
    assert.deepEqual(PROJECT_MODES.free.boardDefaults.hiddenBoardModes, ["arcs", "timeline"]);
  });

  await t.test("les colonnes du Plan initiales restent adaptées au type", () => {
    const fiction = PROJECT_MODES.fiction.boardDefaults.outlineCols;
    const nonfiction = PROJECT_MODES.nonfiction.boardDefaults.outlineCols;
    const free = PROJECT_MODES.free.boardDefaults.outlineCols;
    assert.deepEqual(
      Object.keys(fiction).filter((key) => fiction[key]),
      ["synopsis", "pov", "status"]
    );
    assert.deepEqual(
      Object.keys(nonfiction).filter((key) => nonfiction[key]),
      ["summary"]
    );
    // §7 : corrige l'incohérence historique — Libre planifie avec le résumé
    // long (sémantique Non-fiction/Libre), jamais le synopsis (Fiction).
    assert.deepEqual(
      Object.keys(free).filter((key) => free[key]),
      ["summary"]
    );
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

  await t.test("non-fiction ne garde que Notes + Sources + Bibliographie, aucune rubrique imposée", () => {
    const rf = PROJECT_MODES.nonfiction.researchFolders;
    assert.equal(rf.notes.label, "Notes");
    assert.equal(rf.sources.label, "Sources");
    assert.equal(rf.bibliographie.label, "Bibliography");
    assert.equal(rf.personnages, undefined);
    assert.equal(rf.lieux, undefined);
    assert.equal(rf.codex, undefined);
    assert.equal(rf.glossaire, undefined);
    assert.equal(rf.evenements, undefined);
  });

  await t.test("Bibliographie identique dans fiction et non-fiction (seul rôle partagé)", () => {
    assert.equal(PROJECT_MODES.fiction.researchFolders.bibliographie?.label, "Bibliography");
    assert.equal(PROJECT_MODES.nonfiction.researchFolders.bibliographie?.label, "Bibliography");
    assert.equal(PROJECT_MODES.free.researchFolders.bibliographie, undefined, "pas de bibliographie en mode libre");
  });
});

test("resolveType", async (t) => {
  await t.test("reconnaît fiction/nonfiction/free directement", () => {
    assert.equal(resolveType("fiction"), "fiction");
    assert.equal(resolveType("nonfiction"), "nonfiction");
    assert.equal(resolveType("free"), "free");
    assert.equal(resolveType("libre"), "free");
  });

  await t.test("« structured » n'est plus reconnu comme mode canonique : retombe sur fiction", () => {
    assert.equal(resolveType("structured"), "fiction");
    assert.equal(resolveType("structure"), "fiction");
    assert.equal(resolveType("document-structure"), "fiction");
    assert.equal(resolveType("Document structuré"), "fiction");
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

test("projectCreationStyle : chaque mode canonique conserve sa propre structure physique", () => {
  assert.equal(projectCreationStyle("fiction"), "fiction");
  assert.equal(projectCreationStyle("nonfiction"), "nonfiction");
  assert.equal(projectCreationStyle("free"), "free");
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

test("semanticPlanningField — LOT binder isolé/cartes/plan §5", async (t) => {
  await t.test("fiction/roman → synopsis", () => {
    assert.equal(semanticPlanningField("fiction"), "synopsis");
    assert.equal(semanticPlanningField("roman"), "synopsis");
  });

  await t.test("nonfiction/essai → summary", () => {
    assert.equal(semanticPlanningField("nonfiction"), "summary");
    assert.equal(semanticPlanningField("essai"), "summary");
  });

  await t.test("free/libre → summary", () => {
    assert.equal(semanticPlanningField("free"), "summary");
    assert.equal(semanticPlanningField("libre"), "summary");
  });
});

test("resolveBoardCardContent — LOT binder isolé/cartes/plan §5", async (t) => {
  await t.test("fiction + synopsis stocké → synopsis", () => {
    assert.equal(resolveBoardCardContent("fiction", "synopsis"), "synopsis");
  });

  await t.test("fiction + ancien summary stocké → synopsis (champ sémantique du mode)", () => {
    assert.equal(resolveBoardCardContent("fiction", "summary"), "synopsis");
  });

  await t.test("nonfiction + ancien synopsis stocké → summary (champ sémantique du mode)", () => {
    assert.equal(resolveBoardCardContent("nonfiction", "synopsis"), "summary");
  });

  await t.test("free + ancien synopsis stocké → summary (champ sémantique du mode)", () => {
    assert.equal(resolveBoardCardContent("free", "synopsis"), "summary");
  });

  await t.test("extrait reste extrait, quel que soit le mode", () => {
    assert.equal(resolveBoardCardContent("fiction", "extrait"), "extrait");
    assert.equal(resolveBoardCardContent("nonfiction", "extrait"), "extrait");
    assert.equal(resolveBoardCardContent("free", "extrait"), "extrait");
  });
});

test("resolveBoardOutlineColumns — LOT binder isolé/cartes/plan §6", async (t) => {
  await t.test("synopsis/summary ne sont jamais activés ensemble", () => {
    for (const type of ["fiction", "nonfiction", "free"]) {
      const cols = resolveBoardOutlineColumns(type, { synopsis: true, summary: true });
      assert.ok(!(cols.synopsis && cols.summary), `${type} : synopsis et summary ensemble`);
    }
  });

  await t.test("Fiction : POV par défaut true quand rien n'est stocké", () => {
    const cols = resolveBoardOutlineColumns("fiction", null);
    assert.equal(cols.pov, true);
  });

  await t.test("Fiction : POV stocké à false est respecté", () => {
    const cols = resolveBoardOutlineColumns("fiction", { pov: false });
    assert.equal(cols.pov, false);
  });

  await t.test("Non-fiction/Libre : POV stocké à true est respecté", () => {
    assert.equal(resolveBoardOutlineColumns("nonfiction", { pov: true }).pov, true);
    assert.equal(resolveBoardOutlineColumns("free", { pov: true }).pov, true);
  });

  await t.test("ancien synopsis stocké en Libre est relu comme summary (champ sémantique du mode)", () => {
    const cols = resolveBoardOutlineColumns("free", { synopsis: true });
    assert.equal(cols.summary, true);
    assert.equal(cols.synopsis, false);
  });

  await t.test("aucune des deux clés stockée : utilise le défaut du mode", () => {
    assert.equal(resolveBoardOutlineColumns("fiction", { label: true }).synopsis, true);
    assert.equal(resolveBoardOutlineColumns("nonfiction", { label: true }).summary, true);
  });

  await t.test("anciennes notes/filename/progress/compile n'apparaissent jamais effectivement, même stockées à true", () => {
    const stored = { notes: true, filename: true, progress: true, compile: true, compiler: true };
    for (const type of ["fiction", "nonfiction", "free"]) {
      const cols = resolveBoardOutlineColumns(type, stored);
      assert.equal(cols.notes, false, type);
      assert.equal(cols.filename, false, type);
      assert.equal(cols.progress, false, type);
      assert.equal(cols.compile, false, type);
      assert.equal(cols.compiler, false, type);
    }
  });

  await t.test("Fiction : Personnages/Fil optionnels, OFF par défaut quand rien n'est stocké", () => {
    const cols = resolveBoardOutlineColumns("fiction", null);
    assert.equal(cols.characters, false);
    assert.equal(cols.thread, false);
  });

  await t.test("Fiction : Personnages/Fil stockés à true sont respectés", () => {
    const cols = resolveBoardOutlineColumns("fiction", { characters: true, thread: true });
    assert.equal(cols.characters, true);
    assert.equal(cols.thread, true);
  });

  await t.test("Fiction : Personnages/Fil stockés à false restent OFF", () => {
    const cols = resolveBoardOutlineColumns("fiction", { characters: false, thread: false });
    assert.equal(cols.characters, false);
    assert.equal(cols.thread, false);
  });

  await t.test("Non-fiction/Libre : Personnages/Fil stockés à true sont respectés", () => {
    for (const type of ["nonfiction", "free"]) {
      const cols = resolveBoardOutlineColumns(type, { characters: true, thread: true });
      assert.equal(cols.characters, true, type);
      assert.equal(cols.thread, true, type);
    }
  });
});
