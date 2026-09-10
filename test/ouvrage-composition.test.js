import assert from "node:assert/strict";
import test from "node:test";
import { TFolder } from "obsidian";
import {
  resolveOuvrageComposition,
  materializeOuvrageComposition,
  updateOuvrageComposition,
  clearOuvrageComposition,
} from "../src/services/ouvrage-composition.js";
import { registerOuvrage } from "../src/services/editorial-roots.js";

/* LOT 5A — fondations de la composition propre à chaque ouvrage. Ces tests
 * exercent les quatre fonctions PURES de services/ouvrage-composition.ts,
 * indépendamment de compile-export.ts (voir compile-export.test.js pour
 * l'intégration réelle dans compile()/exportWithScope). */

function baseGlobalComposition(overrides = {}) {
  return {
    fileName: "Manuscrit.md",
    level1Role: "parties",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    autoRename: true,
    renamePrefix: "chapitre",
    folderTitles: true,
    chapterTitles: true,
    sceneTitles: false,
    separator: "\n\n",
    footnoteRenumberOnCompile: true,
    summary: false,
    tables: false,
    toc: false,
    bibliography: false,
    annexes: false,
    ...overrides,
  };
}

function warpiWithNefes() {
  const warpi = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const settings = { projectMeta: {} };
  registerOuvrage(settings, warpi, nefes);
  return { warpi, nefes, settings };
}

test("resolveOuvrageComposition : absence de composition locale = héritage exact, sans mutation", () => {
  const { warpi, nefes, settings } = warpiWithNefes();
  const global = baseGlobalComposition();

  const resolved = resolveOuvrageComposition(settings, warpi, nefes, global);

  assert.deepEqual(resolved, global);
  // Lecture pure : aucune composition locale n'a été créée.
  assert.equal(settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage.composition, undefined);
  // Le résultat est une copie neuve : le muter ne doit jamais atteindre la
  // composition globale transmise par l'appelant.
  resolved.folderTitles = false;
  assert.equal(global.folderTitles, true, "muter le résultat ne doit jamais affecter la composition globale");
});

test("resolveOuvrageComposition : un ouvrage inconnu ou hors projet retombe aussi sur l'héritage global", () => {
  const warpi = new TFolder("WARPI");
  const settings = { projectMeta: {} };
  const global = baseGlobalComposition();

  // La racine globale elle-même : toujours la composition globale.
  assert.deepEqual(resolveOuvrageComposition(settings, warpi, warpi, global), global);

  // Un dossier hors du projet : repli défensif sur la composition globale.
  const ailleurs = new TFolder("AILLEURS");
  assert.deepEqual(resolveOuvrageComposition(settings, warpi, ailleurs, global), global);
});

test("materializeOuvrageComposition : copie complète et indépendante", () => {
  const global = baseGlobalComposition({ separator: "***" });
  const copy = materializeOuvrageComposition(global);

  assert.deepEqual(copy, global);
  assert.notEqual(copy, global);
  copy.separator = "\n\n---\n\n";
  assert.equal(global.separator, "***", "la copie matérialisée ne doit jamais être une référence vers l'original");
});

test("updateOuvrageComposition : première modification = copie complète de la composition globale, puis patch", () => {
  const { warpi, nefes, settings } = warpiWithNefes();
  const global = baseGlobalComposition({ chapterTitles: true, separator: "\n\n", annexes: false });

  const changed = updateOuvrageComposition(settings, warpi, nefes, global, { separator: "\n\n***\n\n" });
  assert.equal(changed, true);

  const stored = settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage.composition;
  // La composition stockée est une copie COMPLÈTE : tous les champs de la
  // composition globale sont présents, pas seulement celui modifié.
  assert.deepEqual(stored, { ...global, separator: "\n\n***\n\n" });

  // Après cette première écriture, NEFES est indépendant : une modification
  // globale ultérieure ne doit jamais atteindre sa composition stockée.
  global.chapterTitles = false;
  assert.equal(settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage.composition.chapterTitles, true);
});

test("updateOuvrageComposition : une modification suivante ne fait que fusionner, sans re-matérialiser", () => {
  const { warpi, nefes, settings } = warpiWithNefes();
  const global = baseGlobalComposition();

  updateOuvrageComposition(settings, warpi, nefes, global, { separator: "***" });
  updateOuvrageComposition(settings, warpi, nefes, global, { folderTitles: false });

  const stored = settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage.composition;
  // Les deux modifications successives cohabitent : la seconde n'a pas
  // écrasé la première en repartant de `global`.
  assert.equal(stored.separator, "***");
  assert.equal(stored.folderTitles, false);
});

test("updateOuvrageComposition : refuse d'écrire sur un dossier qui n'est pas déjà un ouvrage enregistré", () => {
  const warpi = new TFolder("WARPI");
  const dossierOrdinaire = new TFolder("WARPI/Dossier");
  const settings = { projectMeta: {} };
  const global = baseGlobalComposition();

  const changed = updateOuvrageComposition(settings, warpi, dossierOrdinaire, global, { separator: "***" });

  assert.equal(changed, false);
  assert.deepEqual(settings.projectMeta, {}, "aucune entrée ne doit être créée pour un dossier non-ouvrage");
});

test("updateOuvrageComposition : WARPI, NEFES et un second ouvrage restent indépendants", () => {
  const warpi = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const tome2 = new TFolder("WARPI/Tome 2");
  const settings = { projectMeta: {} };
  registerOuvrage(settings, warpi, nefes);
  registerOuvrage(settings, warpi, tome2);

  const global = baseGlobalComposition();
  updateOuvrageComposition(settings, warpi, nefes, global, { separator: "NEFES-SEP" });
  updateOuvrageComposition(settings, warpi, tome2, global, { separator: "TOME2-SEP" });

  const workspaces = settings.projectMeta["WARPI"].folderWorkspaces;
  assert.equal(workspaces["NEFES"].ouvrage.composition.separator, "NEFES-SEP");
  assert.equal(workspaces["Tome 2"].ouvrage.composition.separator, "TOME2-SEP");
  // La composition globale transmise reste, elle, absolument intacte.
  assert.equal(global.separator, "\n\n");
  // Et la résolution de chacun ne voit jamais la composition de l'autre.
  assert.equal(resolveOuvrageComposition(settings, warpi, nefes, global).separator, "NEFES-SEP");
  assert.equal(resolveOuvrageComposition(settings, warpi, tome2, global).separator, "TOME2-SEP");
  assert.equal(resolveOuvrageComposition(settings, warpi, warpi, global).separator, "\n\n");
});

test("clearOuvrageComposition : retour immédiat à l'héritage global, ne touche à rien d'autre", () => {
  const { warpi, nefes, settings } = warpiWithNefes();
  const global = baseGlobalComposition();
  updateOuvrageComposition(settings, warpi, nefes, global, { separator: "***" });

  const removed = clearOuvrageComposition(settings, warpi, nefes);
  assert.equal(removed, true);

  const config = settings.projectMeta["WARPI"].folderWorkspaces["NEFES"];
  assert.equal("composition" in config.ouvrage, false);
  // Le statut d'ouvrage lui-même est préservé : ce n'est PAS un
  // désenregistrement (voir unregisterOuvrage, editorial-roots.ts).
  assert.deepEqual(config.ouvrage, { version: 1 });
  // La résolution retombe immédiatement sur la composition globale.
  assert.deepEqual(resolveOuvrageComposition(settings, warpi, nefes, global), global);
});

test("clearOuvrageComposition : préserve les autres réglages de l'espace de travail de l'ouvrage", () => {
  const { warpi, nefes, settings } = warpiWithNefes();
  settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].preset = "fiction";
  settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].wordGoal = 50000;
  const global = baseGlobalComposition();
  updateOuvrageComposition(settings, warpi, nefes, global, { separator: "***" });

  clearOuvrageComposition(settings, warpi, nefes);

  assert.deepEqual(settings.projectMeta["WARPI"].folderWorkspaces["NEFES"], {
    version: 1,
    ouvrage: { version: 1 },
    preset: "fiction",
    wordGoal: 50000,
  });
});

test("clearOuvrageComposition : sans composition locale, renvoie false et ne modifie rien", () => {
  const { warpi, nefes, settings } = warpiWithNefes();
  const removed = clearOuvrageComposition(settings, warpi, nefes);
  assert.equal(removed, false);
  assert.deepEqual(settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage, { version: 1 });
});
