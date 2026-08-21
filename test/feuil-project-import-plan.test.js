import test from "node:test";
import assert from "node:assert/strict";
import { buildFeuilProjectImportPlan, FeuilProjectImportPlanError } from "../src/services/feuil-project-import-plan.js";
import { createFeuilProjectPackage, FeuilProjectPackageError } from "../src/services/feuil-project-package.js";

function manifest({ rootKind = "structured", manuscriptPath = "Manuscrit", linkedResearch = [] } = {}) {
  return {
    format: "feuil", version: 1, packageId: "package-1", createdAt: "2026-08-21T00:00:00.000Z", createdByVersion: "2.6.0",
    project: {
      name: "Roman", rootKind, manuscriptPath, structure: { level1Role: "parties" }, meta: {},
      pathSettings: { orders: {}, folderPositions: {}, folderGoals: {} }, narrativeState: { placeholders: {}, origins: {}, resolved: [] }, linkedResearch,
    },
  };
}

const external = (id = "research-001", name = "Archives") => ({ binderPath: "Sources", target: { kind: "external", id, name } });
const projectTarget = (path) => ({ binderPath: "Sources", target: { kind: "project", path } });

async function plan(value, files = {}, directories = []) {
  return buildFeuilProjectImportPlan(await createFeuilProjectPackage(value, files, directories));
}

test("importe un projet adopté avec fichier Markdown", async () => {
  const result = await plan(manifest({ rootKind: "adopted", manuscriptPath: "." }), { "project/01.md": new Uint8Array([1]) }); assert.ok("01.md" in result.project.files);
});

test("importe un projet structuré avec son dossier Manuscrit", async () => {
  const result = await plan(manifest(), {}, ["project/Manuscrit"]); assert.ok(result.project.directories.includes("Manuscrit"));
});

test("conserve les octets Markdown", async () => {
  const bytes = new Uint8Array([0, 255, 2]); const result = await plan(manifest(), { "project/Manuscrit/01.md": bytes }, ["project/Manuscrit"]); assert.deepEqual(result.project.files["Manuscrit/01.md"], bytes);
});

test("conserve un fichier binaire project", async () => {
  const bytes = new Uint8Array([255, 0, 4]); const result = await plan(manifest(), { "project/image.bin": bytes }, ["project/Manuscrit"]); assert.deepEqual(result.project.files["image.bin"], bytes);
});

test("conserve un dossier project vide", async () => {
  const result = await plan(manifest(), {}, ["project/Manuscrit", "project/Manuscrit/Vide"]); assert.ok(result.project.directories.includes("Manuscrit/Vide"));
});

test("accepte un projet adopté totalement vide", async () => {
  const result = await plan(manifest({ rootKind: "adopted", manuscriptPath: "." })); assert.deepEqual(result.project, { files: {}, directories: [] });
});

test("refuse un structured sans dossier manuscriptPath", async () => {
  await assert.rejects(() => plan(manifest()), FeuilProjectImportPlanError);
});

test("accepte binderPath '.'", async () => {
  const linked = [{ binderPath: ".", target: { kind: "project", path: "." } }]; await plan(manifest({ linkedResearch: linked }), {}, ["project/Manuscrit"]);
});

test("accepte binderPath vers un dossier", async () => {
  await plan(manifest({ linkedResearch: [projectTarget(".")] }), {}, ["project/Manuscrit", "project/Manuscrit/Sources"]);
});

test("refuse binderPath vers un dossier absent", async () => {
  await assert.rejects(() => plan(manifest({ linkedResearch: [projectTarget(".")] }), {}, ["project/Manuscrit"]), FeuilProjectImportPlanError);
});

test("accepte binderPath vers un fichier", async () => {
  const linked = [{ binderPath: "Chapitre/Scene.md", target: { kind: "project", path: "." } }];
  await plan(manifest({ linkedResearch: linked }), { "project/Manuscrit/Chapitre/Scene.md": new Uint8Array([1]) }, ["project/Manuscrit", "project/Manuscrit/Chapitre"]);
});

test("accepte target project '.'", async () => {
  const linked = [{ binderPath: ".", target: { kind: "project", path: "." } }]; await plan(manifest({ linkedResearch: linked }), {}, ["project/Manuscrit"]);
});

test("accepte target project vers un dossier", async () => {
  const linked = [{ binderPath: ".", target: { kind: "project", path: "Recherche" } }]; await plan(manifest({ linkedResearch: linked }), {}, ["project/Manuscrit", "project/Recherche"]);
});

test("refuse target project vers un dossier absent", async () => {
  const linked = [{ binderPath: ".", target: { kind: "project", path: "Recherche" } }]; await assert.rejects(() => plan(manifest({ linkedResearch: linked }), {}, ["project/Manuscrit"]), FeuilProjectImportPlanError);
});

test("refuse target project vers un fichier", async () => {
  const linked = [{ binderPath: ".", target: { kind: "project", path: "Recherche" } }]; await assert.rejects(() => plan(manifest({ linkedResearch: linked }), { "project/Recherche": new Uint8Array([1]) }, ["project/Manuscrit"]), FeuilProjectImportPlanError);
});

test("importe une Research externe sans préfixe technique", async () => {
  const result = await plan(manifest({ linkedResearch: [external()] }), { "external/research/research-001/A.md": new Uint8Array([1]) }, ["project/Manuscrit", "project/Manuscrit/Sources", "external/research/research-001"]); assert.ok("A.md" in result.externalResearch[0].tree.files);
});

test("conserve les binaires Research externes", async () => {
  const bytes = new Uint8Array([0, 200, 255]); const result = await plan(manifest({ linkedResearch: [external()] }), { "external/research/research-001/a.bin": bytes }, ["project/Manuscrit", "project/Manuscrit/Sources", "external/research/research-001"]); assert.deepEqual(result.externalResearch[0].tree.files["a.bin"], bytes);
});

test("conserve les sous-dossiers Research externes", async () => {
  const result = await plan(manifest({ linkedResearch: [external()] }), { "external/research/research-001/Images/x.png": new Uint8Array([1]) }, ["project/Manuscrit", "project/Manuscrit/Sources", "external/research/research-001", "external/research/research-001/Images"]); assert.deepEqual(result.externalResearch[0].tree.directories, ["Images"]);
});

test("conserve une Research externe vide", async () => {
  const result = await plan(manifest({ linkedResearch: [external()] }), {}, ["project/Manuscrit", "project/Manuscrit/Sources", "external/research/research-001"]); assert.deepEqual(result.externalResearch[0].tree, { files: {}, directories: [] });
});

test("déduplique deux liens utilisant le même ID externe", async () => {
  const links = [external(), { binderPath: "Autres", target: { kind: "external", id: "research-001", name: "Archives" } }]; const result = await plan(manifest({ linkedResearch: links }), {}, ["project/Manuscrit", "project/Manuscrit/Sources", "project/Manuscrit/Autres", "external/research/research-001"]); assert.equal(result.externalResearch.length, 1);
});

test("importe deux IDs externes dans deux arbres", async () => {
  const links = [external("research-001"), { binderPath: "Autres", target: { kind: "external", id: "research-002", name: "Images" } }]; const result = await plan(manifest({ linkedResearch: links }), { "external/research/research-001/a.md": new Uint8Array([1]), "external/research/research-002/b.md": new Uint8Array([2]) }, ["project/Manuscrit", "project/Manuscrit/Sources", "project/Manuscrit/Autres", "external/research/research-001", "external/research/research-002"]); assert.equal(result.externalResearch.length, 2); assert.ok("b.md" in result.externalResearch[1].tree.files);
});

test("trie externalResearch par ID ordinal", async () => {
  const links = [external("research-010", "Z"), { binderPath: "Autres", target: { kind: "external", id: "research-002", name: "A" } }]; const result = await plan(manifest({ linkedResearch: links }), {}, ["project/Manuscrit", "project/Manuscrit/Sources", "project/Manuscrit/Autres", "external/research/research-010", "external/research/research-002"]); assert.deepEqual(result.externalResearch.map((item) => item.id), ["research-002", "research-010"]);
});

test("refuse un ID externe référencé sans dossier racine", async () => {
  await assert.rejects(() => plan(manifest({ linkedResearch: [external()] }), {}, ["project/Manuscrit", "project/Manuscrit/Sources"]), FeuilProjectImportPlanError);
});

test("refuse du contenu externe orphelin", async () => {
  await assert.rejects(() => plan(manifest(), { "external/research/research-999/a.md": new Uint8Array([1]) }, ["project/Manuscrit", "external/research/research-999"]), FeuilProjectImportPlanError);
});

test("refuse un fichier utilisé comme racine externe", async () => {
  await assert.rejects(() => plan(manifest({ linkedResearch: [external()] }), { "external/research/research-001": new Uint8Array([1]) }, ["project/Manuscrit", "project/Manuscrit/Sources"]), FeuilProjectImportPlanError);
});

test("propage FeuilProjectPackageError pour une archive invalide", async () => {
  await assert.rejects(() => buildFeuilProjectImportPlan(new Uint8Array([1, 2, 3])), FeuilProjectPackageError);
});

test("import-plan conserve level1Role sans transformation", async () => {
  const value = manifest(); value.project.structure.level1Role = "chapitres";
  const result = await plan(value, {}, ["project/Manuscrit"]); assert.equal(result.manifest.project.structure.level1Role, "chapitres");
});
