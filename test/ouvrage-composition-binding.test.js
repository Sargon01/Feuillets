import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TFolder } from "obsidian";
import { createCompositionBinding, effectiveComposition } from "../src/services/ouvrage-composition.js";
import { registerOuvrage } from "../src/services/editorial-roots.js";

/* LOT 5B — binding commun transmis aux six panneaux de Composition. Ces
 * tests exercent createCompositionBinding() directement (sans DOM ni
 * EditionCompositionContent) : les tests spécifiques à chaque panneau
 * (test/contents-panel.test.js, tables-panel.test.js,
 * bibliography-panel.test.js, annexes-panel.test.js,
 * front-matter-panel.test.js, edition-composition-content.test.js)
 * couvrent déjà le câblage DOM des 16 champs avec ce même binding. */

function warpiWithNefes(nefesFolderWorkspaces) {
  const warpi = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  nefes.parent = warpi;
  warpi.children = [nefes];
  const settings = {
    projectFolder: "WARPI",
    insertFolderTitles: true,
    insertTitles: true,
    insertSceneTitles: false,
    separator: "\n\n",
    footnoteRenumberOnCompile: true,
    level1Role: "parties",
    chapterNumbering: "continu",
    sceneNumbering: "hier",
    autoRename: true,
    renamePrefix: "chapitre",
    compileFileName: "Manuscrit.md",
    activePreset: -1,
    compilePresets: [],
    projectMeta: {},
  };
  registerOuvrage(settings, warpi, nefes);
  if (nefesFolderWorkspaces) {
    settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage.composition = nefesFolderWorkspaces;
  }
  let saveCount = 0;
  let refreshCount = 0;
  const host = {
    settings,
    saveSettings: async () => { saveCount++; },
    refreshBinderViews: () => { refreshCount++; },
  };
  return { warpi, nefes, settings, host, saveCount: () => saveCount, refreshCount: () => refreshCount };
}

test("createCompositionBinding : WARPI n'est jamais un ouvrage, sa composition vient directement des réglages globaux", () => {
  const { warpi, host } = warpiWithNefes();
  const binding = createCompositionBinding(host, warpi, warpi);
  assert.equal(binding.isOuvrage, false);
  assert.equal(binding.isInherited, false);
  assert.deepEqual(binding.value, effectiveComposition(host.settings, warpi, warpi));
});

test("createCompositionBinding : NEFES sans composition locale = ouvrage hérité, valeurs de WARPI", () => {
  const { warpi, nefes, host } = warpiWithNefes();
  const binding = createCompositionBinding(host, warpi, nefes);
  assert.equal(binding.isOuvrage, true);
  assert.equal(binding.isInherited, true);
  assert.deepEqual(binding.value, effectiveComposition(host.settings, warpi, warpi));
});

test("1. Les 16 contrôles affichent les valeurs de NEFES quand une composition locale existe", () => {
  const local = {
    fileName: "Nefes.md", level1Role: "chapitres", chapterNumbering: "parPartie", sceneNumbering: "continue",
    autoRename: false, renamePrefix: "partie", folderTitles: false, chapterTitles: false, sceneTitles: true,
    separator: "***", footnoteRenumberOnCompile: false, summary: true, tables: true, toc: true,
    bibliography: true, annexes: true,
  };
  const { warpi, nefes, host } = warpiWithNefes(local);
  const binding = createCompositionBinding(host, warpi, nefes);
  assert.equal(binding.isOuvrage, true);
  assert.equal(binding.isInherited, false);
  assert.deepEqual(binding.value, local);
});

test("2. Modifier NEFES via update() ne modifie jamais WARPI", async () => {
  const { warpi, nefes, host, settings } = warpiWithNefes();
  const globalBefore = effectiveComposition(settings, warpi, warpi);
  const binding = createCompositionBinding(host, warpi, nefes);

  await binding.update({ folderTitles: false, separator: "***" });

  assert.deepEqual(effectiveComposition(settings, warpi, warpi), globalBefore, "WARPI reste rigoureusement inchangé");
});

test("3. La première modification de NEFES matérialise une copie COMPLÈTE de la composition globale", async () => {
  const { warpi, nefes, host, settings } = warpiWithNefes();
  const binding = createCompositionBinding(host, warpi, nefes);

  await binding.update({ separator: "***" });

  const stored = settings.projectMeta["WARPI"].folderWorkspaces["NEFES"].ouvrage.composition;
  assert.deepEqual(stored, { ...effectiveComposition(settings, warpi, warpi), separator: "***" });
  // Tous les 16 champs sont présents, pas seulement celui modifié.
  assert.equal(Object.keys(stored).length, 16);
});

test("4. Deux ouvrages restent indépendants l'un de l'autre", async () => {
  const warpi = new TFolder("WARPI");
  const nefes = new TFolder("WARPI/NEFES");
  const tome2 = new TFolder("WARPI/Tome 2");
  nefes.parent = warpi;
  tome2.parent = warpi;
  warpi.children = [nefes, tome2];
  const settings = {
    projectFolder: "WARPI", insertFolderTitles: true, insertTitles: true, insertSceneTitles: false,
    separator: "\n\n", footnoteRenumberOnCompile: true, level1Role: "parties", chapterNumbering: "continu",
    sceneNumbering: "hier", autoRename: true, renamePrefix: "chapitre", compileFileName: "Manuscrit.md",
    activePreset: -1, compilePresets: [], projectMeta: {},
  };
  registerOuvrage(settings, warpi, nefes);
  registerOuvrage(settings, warpi, tome2);
  const host = { settings, saveSettings: async () => {}, refreshBinderViews: () => {} };

  const nefesBinding = createCompositionBinding(host, warpi, nefes);
  await nefesBinding.update({ separator: "NEFES" });
  const tome2Binding = createCompositionBinding(host, warpi, tome2);
  await tome2Binding.update({ separator: "TOME2" });

  assert.equal(createCompositionBinding(host, warpi, nefes).value.separator, "NEFES");
  assert.equal(createCompositionBinding(host, warpi, tome2).value.separator, "TOME2");
  assert.equal(createCompositionBinding(host, warpi, warpi).value.separator, "\n\n");
});

test("2bis. update() effectue une seule sauvegarde et un seul rafraîchissement des vues par appel", async () => {
  const { warpi, nefes, host, saveCount, refreshCount } = warpiWithNefes();
  const binding = createCompositionBinding(host, warpi, nefes);
  await binding.update({ separator: "***" });
  assert.equal(saveCount(), 1);
  assert.equal(refreshCount(), 1);
});

test("7. « Utiliser les réglages du projet » (resetToProject) restaure l'héritage, une seule sauvegarde", async () => {
  const { warpi, nefes, host, settings, saveCount, refreshCount } = warpiWithNefes();
  const binding = createCompositionBinding(host, warpi, nefes);
  await binding.update({ separator: "***" });
  assert.equal(createCompositionBinding(host, warpi, nefes).isInherited, false);

  await binding.resetToProject();

  const after = createCompositionBinding(host, warpi, nefes);
  assert.equal(after.isInherited, true);
  assert.deepEqual(after.value, effectiveComposition(settings, warpi, warpi));
  assert.equal(saveCount(), 2, "une sauvegarde pour la modification, une pour le retour à l'héritage");
  assert.equal(refreshCount(), 2);
});

test("resetToProject() sur WARPI (jamais un ouvrage) ne fait rien", async () => {
  const { warpi, host, saveCount } = warpiWithNefes();
  const binding = createCompositionBinding(host, warpi, warpi);
  await binding.resetToProject();
  assert.equal(saveCount(), 0);
});

/* ===================== 12. Aucune seconde résolution manuelle dans les panneaux ===================== */

test("12. Les six panneaux de Composition n'ont plus de résolution manuelle des 16 champs (ProjectMeta direct)", () => {
  const panels = [
    "src/ui/contents-panel.ts",
    "src/ui/tables-panel.ts",
    "src/ui/bibliography-panel.ts",
    "src/ui/annexes-panel.ts",
  ];
  for (const path of panels) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /readGeneratedIncluded/, `${path} ne doit plus lire ProjectMeta.composition directement`);
    assert.doesNotMatch(source, /writeGeneratedIncluded/, `${path} ne doit plus écrire ProjectMeta.composition directement`);
    assert.match(source, /binding\.value/, `${path} doit lire le binding`);
    assert.match(source, /binding\.update/, `${path} doit écrire via le binding`);
  }
  const editionComposition = readFileSync("src/ui/edition-composition-content.ts", "utf8");
  assert.doesNotMatch(editionComposition, /S\.insertFolderTitles\s*=/, "Structure ne doit plus écrire directement les réglages globaux");
  assert.doesNotMatch(editionComposition, /S\.level1Role\s*=/);
  assert.match(editionComposition, /createCompositionBinding/);
});

test("compile-export.ts et l'UI importent le même effectiveComposition() — aucune seconde copie", () => {
  const ouvrageComposition = readFileSync("src/services/ouvrage-composition.ts", "utf8");
  assert.match(ouvrageComposition, /export function effectiveComposition/);
  const compileExport = readFileSync("src/services/compile-export.ts", "utf8");
  assert.doesNotMatch(compileExport, /export function effectiveComposition/, "effectiveComposition() doit vivre exclusivement dans ouvrage-composition.ts");
  assert.match(compileExport, /import \{ effectiveComposition \} from "\.\/ouvrage-composition\.js";/);
  const editionComposition = readFileSync("src/ui/edition-composition-content.ts", "utf8");
  assert.match(editionComposition, /from "\.\.\/services\/ouvrage-composition\.js"/);
});
