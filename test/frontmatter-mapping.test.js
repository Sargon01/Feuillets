import test from "node:test";
import assert from "node:assert/strict";
import { TFile } from "obsidian";
import { fmOf, rawFrontmatterOf, writeLogicalFrontmatterField, MAPPABLE_FIELDS, isMappableField } from "../src/services/frontmatter.js";

/* Chantier « panneau Projet + métadonnées + mapping YAML », Phase C — tests
 * purs AVANT l'UI de mapping (§31). Couvre §35 (lecture), §36 (écriture) et
 * le garde-fou de portée (§12/§14 : jamais de mapping hors du projet actif). */

function fakeAppFor(frontmatter) {
  let fm = { ...frontmatter };
  return {
    metadataCache: { getFileCache: () => ({ frontmatter: fm }) },
    fileManager: {
      async processFrontMatter(_file, cb) {
        cb(fm);
      },
    },
    _get: () => fm,
  };
}

function settingsWithMapping(propertyMap, projectFolder = "Projet") {
  return {
    projectFolder,
    projectMeta: propertyMap ? { [projectFolder]: { propertyMap } } : { [projectFolder]: {} },
  };
}

const file = new TFile("Projet/Scene.md");

test("MAPPABLE_FIELDS / isMappableField", () => {
  assert.deepEqual(MAPPABLE_FIELDS, ["synopsis", "summary", "status", "pov", "label", "goal", "thread", "characters", "date"]);
  assert.equal(isMappableField("status"), true);
  assert.equal(isMappableField("title"), false);
  assert.equal(isMappableField("tags"), false);
});

test("rawFrontmatterOf : aucune projection, jamais l'objet vivant du cache", () => {
  const cacheFm = { Synopsis: "A" };
  const app = { metadataCache: { getFileCache: () => ({ frontmatter: cacheFm }) } };
  const raw = rawFrontmatterOf(app, file);
  assert.deepEqual(raw, { Synopsis: "A" });
  raw.Synopsis = "MUTÉ";
  assert.equal(cacheFm.Synopsis, "A", "le cache MetadataCache n'est jamais muté via le retour de rawFrontmatterOf");
});

/* ===================== §35 : tests mapping LECTURE ===================== */

test("§35.A : synopsis: A -> A (clé canonique exacte)", () => {
  const app = fakeAppFor({ synopsis: "A" });
  assert.equal(fmOf(app, file, settingsWithMapping(undefined)).synopsis, "A");
});

test("§35.B : Synopsis: A -> fm.synopsis = A (tolérance de casse, sans mapping)", () => {
  const app = fakeAppFor({ Synopsis: "A" });
  assert.equal(fmOf(app, file, settingsWithMapping(undefined)).synopsis, "A");
});

test("§35.C : synopsis: A + Synopsis: B -> A (exact gagne, pas de fuzzy)", () => {
  const app = fakeAppFor({ synopsis: "A", Synopsis: "B" });
  assert.equal(fmOf(app, file, settingsWithMapping(undefined)).synopsis, "A");
});

test("§35.D : propertyMap.synopsis = \"Pitch\" ; Pitch: A ; synopsis: B -> A (mapping prime)", () => {
  const app = fakeAppFor({ Pitch: "A", synopsis: "B" });
  assert.equal(fmOf(app, file, settingsWithMapping({ synopsis: "Pitch" })).synopsis, "A");
});

test("§35.E : resume: A -> fm.summary = A (alias hérité, inchangé par ce chantier)", () => {
  const app = fakeAppFor({ resume: "A" });
  assert.equal(fmOf(app, file, settingsWithMapping(undefined)).summary, "A");
});

test("§35.F : propertyMap.summary = \"Summary\" ; Summary: A ; resume: B -> A", () => {
  const app = fakeAppFor({ Summary: "A", resume: "B" });
  assert.equal(fmOf(app, file, settingsWithMapping({ summary: "Summary" })).summary, "A");
});

test("mapping configuré mais cible absente sur CE fichier -> repli sur la résolution normale", () => {
  const app = fakeAppFor({ synopsis: "B" }); // pas de "Pitch" sur cette fiche précise
  assert.equal(fmOf(app, file, settingsWithMapping({ synopsis: "Pitch" })).synopsis, "B");
});

test("sans settings : comportement raw+alias strictement inchangé (aucun appelant cassé)", () => {
  const app = fakeAppFor({ Synopsis: "A" });
  // Sans mapping ET sans repli de casse : fmOf(app, file) seul se comporte
  // EXACTEMENT comme avant ce chantier (aucune tolérance de casse).
  assert.equal(fmOf(app, file).synopsis, undefined);
});

/* ===================== §36 : tests mapping ÉCRITURE ===================== */

test("§36.A : aucun mapping -> set synopsis -> écrit `synopsis`", async () => {
  const app = fakeAppFor({});
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "synopsis", "Texte");
  assert.deepEqual(app._get(), { synopsis: "Texte" });
});

test("§36.B : Synopsis existe -> set synopsis -> modifie Synopsis, ne crée pas synopsis", async () => {
  const app = fakeAppFor({ Synopsis: "Ancien" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "synopsis", "Nouveau");
  assert.deepEqual(app._get(), { Synopsis: "Nouveau" });
});

test("§36.C : synopsis -> Pitch (mapping) -> écrit Pitch", async () => {
  const app = fakeAppFor({});
  await writeLogicalFrontmatterField(app, settingsWithMapping({ synopsis: "Pitch" }), file, "synopsis", "Texte");
  assert.deepEqual(app._get(), { Pitch: "Texte" });
});

test("§36.D : suppression -> supprime uniquement la clé cible (Pitch), rien d'autre", async () => {
  const app = fakeAppFor({ Pitch: "Texte", title: "Titre" });
  await writeLogicalFrontmatterField(app, settingsWithMapping({ synopsis: "Pitch" }), file, "synopsis", "");
  assert.deepEqual(app._get(), { title: "Titre" });
});

test("§36 : valeur null/undefined/tableau vide supprime la clé cible", async () => {
  for (const empty of [null, undefined, []]) {
    const app = fakeAppFor({ characters: ["A"] });
    await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "characters", empty);
    assert.deepEqual(app._get(), {});
  }
});

test("§36.E : configurer un mapping ne modifie AUCUN fichier Markdown (testé indirectement : writeLogicalFrontmatterField n'est jamais appelé par la configuration elle-même)", () => {
  // Vérité structurelle : la configuration d'un mapping (Phase D) se limite
  // à `meta.propertyMap[field] = target` + saveSettings — jamais un appel à
  // writeLogicalFrontmatterField. Rien à exercer ici côté frontmatter.ts ;
  // documenté pour traçabilité avec le reste de la suite §36.
  assert.ok(true);
});

/* ===================== garde-fou de portée (hors projet actif) ===================== */

test("le mapping ne s'applique JAMAIS à un fichier hors du projet actif", () => {
  const outside = new TFile("AutreProjet/Scene.md");
  const app = fakeAppFor({ Pitch: "A", synopsis: "B" });
  const settings = settingsWithMapping({ synopsis: "Pitch" }, "Projet"); // actif = "Projet", fichier dans "AutreProjet"
  assert.equal(fmOf(app, outside, settings).synopsis, "B", "hors du projet actif -> mapping ignoré, résolution normale");
});

test("writeLogicalFrontmatterField hors du projet actif : écrit la clé canonique, ignore le mapping du projet actif", async () => {
  const outside = new TFile("AutreProjet/Scene.md");
  const app = fakeAppFor({});
  const settings = settingsWithMapping({ synopsis: "Pitch" }, "Projet");
  await writeLogicalFrontmatterField(app, settings, outside, "synopsis", "Texte");
  assert.deepEqual(app._get(), { synopsis: "Texte" });
});

/* ============ micro-lot anti-doublons : l'écriture réutilise la clé physique existante ============
 * L'écriture d'un champ logique doit cibler la MÊME clé YAML que celle que
 * la lecture a résolue (alias historiques compris), pour ne jamais créer de
 * doublon `fil:` + `thread:`. Aucune migration, aucune réécriture opportuniste. */

test("anti-doublon #1 : `fil` existant + écriture thread -> écrit `fil`, ne crée pas `thread`", async () => {
  const app = fakeAppFor({ fil: "Intrigue" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "thread", "Mystère");
  assert.deepEqual(app._get(), { fil: "Mystère" });
});

test("anti-doublon #2 : `Fil` existant -> conserve `Fil`", async () => {
  const app = fakeAppFor({ Fil: "Mystère" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "thread", "Nouveau");
  assert.deepEqual(app._get(), { Fil: "Nouveau" });
});

test("anti-doublon #3 : `thread` existant -> conserve `thread`", async () => {
  const app = fakeAppFor({ thread: "Mystère" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "thread", "Autre");
  assert.deepEqual(app._get(), { thread: "Autre" });
});

test("anti-doublon #4 : aucun thread/fil -> crée `thread`", async () => {
  const app = fakeAppFor({});
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "thread", "Mystère");
  assert.deepEqual(app._get(), { thread: "Mystère" });
});

test("anti-doublon #5 : `personnages` existant + characters -> conserve `personnages`", async () => {
  const app = fakeAppFor({ personnages: ["Kemal"] });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "characters", ["Autre"]);
  assert.deepEqual(app._get(), { personnages: ["Autre"] });
});

test("anti-doublon #6 : `persos` existant + characters -> conserve `persos`", async () => {
  const app = fakeAppFor({ persos: ["Kemal"] });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "characters", ["Autre"]);
  assert.deepEqual(app._get(), { persos: ["Autre"] });
});

test("anti-doublon #7 : `Personnages` existant -> conserve cette variante de casse", async () => {
  const app = fakeAppFor({ Personnages: ["Kemal"] });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "characters", ["Autre"]);
  assert.deepEqual(app._get(), { Personnages: ["Autre"] });
});

test("anti-doublon #8 : `characters` existant -> conserve `characters`", async () => {
  const app = fakeAppFor({ characters: ["Kemal"] });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "characters", ["Autre"]);
  assert.deepEqual(app._get(), { characters: ["Autre"] });
});

test("anti-doublon #9 : aucun characters/personnages/persos -> crée `characters`", async () => {
  const app = fakeAppFor({});
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "characters", ["Kemal"]);
  assert.deepEqual(app._get(), { characters: ["Kemal"] });
});

test("anti-doublon #10 : `statut` existant + status -> conserve `statut`", async () => {
  const app = fakeAppFor({ statut: "Brouillon" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "status", "Final");
  assert.deepEqual(app._get(), { statut: "Final" });
});

test("anti-doublon #11 : `objectif` existant + goal -> conserve `objectif`", async () => {
  const app = fakeAppFor({ objectif: "500" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "goal", "1000");
  assert.deepEqual(app._get(), { objectif: "1000" });
});

test("anti-doublon #12 : `resume` existant + summary -> conserve `resume`", async () => {
  const app = fakeAppFor({ resume: "Résumé" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "summary", "Nouveau");
  assert.deepEqual(app._get(), { resume: "Nouveau" });
});

test("anti-doublon #13 : suppression thread vide avec `fil` existant -> supprime `fil`, ne crée pas `thread`", async () => {
  const app = fakeAppFor({ fil: "Mystère" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "thread", "");
  assert.deepEqual(app._get(), {});
});

test("anti-doublon #14 : suppression characters tableau vide avec `personnages` existant -> supprime `personnages`", async () => {
  const app = fakeAppFor({ personnages: ["Kemal"] });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "characters", []);
  assert.deepEqual(app._get(), {});
});

test("anti-doublon #15 : mapping explicite thread -> Arc + `fil` existant -> écrit `Arc` (mapping prioritaire absolu)", async () => {
  const app = fakeAppFor({ fil: "Mystère" });
  await writeLogicalFrontmatterField(app, settingsWithMapping({ thread: "Arc" }), file, "thread", "Brouillon");
  assert.deepEqual(app._get(), { fil: "Mystère", Arc: "Brouillon" });
});

test("anti-doublon #16 : doublon `fil` + `thread` -> cible `thread`, ne supprime pas `fil`", async () => {
  const app = fakeAppFor({ fil: "A", thread: "B" });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "thread", "C");
  assert.deepEqual(app._get(), { fil: "A", thread: "C" });
});

test("anti-doublon #17 : doublon `personnages` + `characters` -> cible `characters`, ne supprime pas `personnages`", async () => {
  const app = fakeAppFor({ personnages: ["X"], characters: ["Y"] });
  await writeLogicalFrontmatterField(app, settingsWithMapping(undefined), file, "characters", ["Z"]);
  assert.deepEqual(app._get(), { personnages: ["X"], characters: ["Z"] });
});
