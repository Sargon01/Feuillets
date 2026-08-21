import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { buildFeuilProjectArchive } from "../src/services/feuil-project-archive.js";
import { FeuilProjectExportError } from "../src/services/feuil-project-export.js";
import { readFeuilProjectPackage } from "../src/services/feuil-project-package.js";

function folder(path, children = []) {
  const value = new TFolder(path); value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function file(path, bytes) { const value = new TFile(path); value.bytes = bytes; return value; }

function fixture({ adopted = false } = {}) {
  const root = adopted ? "Articles" : "Projet/Manuscrit";
  const chapter = file(adopted ? "Articles/Article.md" : "Projet/Manuscrit/01.md", new Uint8Array([0, 255, 2]));
  const empty = folder(adopted ? "Articles/Vide" : "Projet/Manuscrit/Vide");
  const manuscript = adopted ? folder("Articles", [chapter, empty]) : folder("Projet/Manuscrit", [chapter, empty]);
  const backup = folder(adopted ? "Articles/_Backups" : "Projet/_Feuillets/Backups", [file(adopted ? "Articles/_Backups/old.zip" : "Projet/_Feuillets/Backups/old.zip", new Uint8Array([9]))]);
  const external = folder("Hors/Archives", [file("Hors/Archives/note.md", new Uint8Array([5, 250]))]);
  const project = adopted ? manuscript : folder("Projet", [manuscript, folder("Projet/_Feuillets", [backup])]);
  if (adopted) manuscript.children.push(backup), backup.parent = manuscript;
  const all = [project, manuscript, chapter, empty, backup, ...backup.children, external, ...external.children];
  const map = new Map(all.map((item) => [item.path, item]));
  const settings = {
    projectFolder: root, level1Role: "parties",
    projectMeta: { [root]: { title: "Meta", researchFolderLinks: { [`${root}/Interne`]: adopted ? "Articles/Recherche" : "Projet/Recherche", [`${root}/Externe`]: "Hors/Archives" } } },
    orders: { [project.path]: [adopted ? "Article" : "Manuscrit"] }, folderPositions: { [project.path]: 1 }, folderGoals: { [manuscript.path]: 10 },
    filPlaceholders: { item: chapter.path }, filOrigins: { item: project.path }, filResolved: ["item"],
  };
  const app = { vault: { getAbstractFileByPath: (path) => map.get(path) || null, readBinary: async (item) => item.bytes.buffer.slice(0) } };
  return { app, settings, map, root };
}

const options = { createdByVersion: "2.6.0", packageId: "package-exact", createdAt: "2026-08-21T00:00:00.000Z" };

async function archive(fixtureValue = fixture()) { return buildFeuilProjectArchive(fixtureValue.app, fixtureValue.settings, options); }
async function parsed(fixtureValue = fixture()) { return readFeuilProjectPackage((await archive(fixtureValue)).data); }
function entry(packageData, path) { return packageData.entries.find((item) => item.path === path); }

test("crée une archive Uint8Array non vide", async () => {
  const result = await archive(); assert.ok(result.data instanceof Uint8Array); assert.ok(result.data.byteLength > 0);
});

test("round-trip réel conserve format et version", async () => {
  const result = await parsed(); assert.equal(result.manifest.format, "feuil"); assert.equal(result.manifest.version, 1);
});

test("conserve packageId exactement", async () => { assert.equal((await parsed()).manifest.packageId, options.packageId); });
test("conserve createdAt exactement", async () => { assert.equal((await parsed()).manifest.createdAt, options.createdAt); });
test("conserve createdByVersion exactement", async () => { assert.equal((await parsed()).manifest.createdByVersion, options.createdByVersion); });

test("conserve le fichier Markdown project", async () => {
  assert.ok(entry(await parsed(), "project/Manuscrit/01.md"));
});

test("conserve les octets Markdown project", async () => {
  assert.deepEqual(entry(await parsed(), "project/Manuscrit/01.md").data, new Uint8Array([0, 255, 2]));
});

test("conserve un binaire project octet pour octet", async () => {
  const current = fixture(); const image = file("Projet/image.bin", new Uint8Array([1, 0, 255, 2])); current.map.get("Projet").children.push(image), image.parent = current.map.get("Projet"), current.map.set(image.path, image);
  assert.deepEqual(entry(await parsed(current), "project/image.bin").data, new Uint8Array([1, 0, 255, 2]));
});

test("conserve un dossier project vide", async () => {
  assert.ok((await parsed()).directories.includes("project/Manuscrit/Vide"));
});

test("conserve le fichier Research externe", async () => {
  assert.ok(entry(await parsed(), "external/research/research-001/note.md"));
});

test("conserve un dossier Research externe vide", async () => {
  const current = fixture(); const empty = folder("Hors/Vide"); current.map.set(empty.path, empty); current.settings.projectMeta[current.root].researchFolderLinks = { [`${current.root}/Externe`]: empty.path };
  assert.ok((await parsed(current)).directories.includes("external/research/research-001"));
});

test("conserve linkedResearch", async () => {
  const current = fixture(); const result = await archive(current); assert.deepEqual((await readFeuilProjectPackage(result.data)).manifest.project.linkedResearch, result.manifest.project.linkedResearch);
});

test("conserve pathSettings", async () => {
  const current = fixture(); const result = await archive(current); assert.deepEqual((await readFeuilProjectPackage(result.data)).manifest.project.pathSettings, result.manifest.project.pathSettings);
});

test("conserve narrativeState", async () => {
  const current = fixture(); const result = await archive(current); assert.deepEqual((await readFeuilProjectPackage(result.data)).manifest.project.narrativeState, result.manifest.project.narrativeState);
});

test("ne duplique pas la Research interne sous external", async () => {
  const result = await parsed(); assert.equal(result.entries.some((item) => item.path.includes("Recherche")), false);
});

test("exclut les backups de l’archive finale", async () => {
  const result = await parsed(); assert.equal(result.entries.some((item) => item.path.includes("old.zip")), false);
});

test("deux liens vers une même Research externe créent une seule copie", async () => {
  const current = fixture(); current.settings.projectMeta[current.root].researchFolderLinks = { [`${current.root}/A`]: "Hors/Archives", [`${current.root}/B`]: "Hors/Archives" };
  const result = await parsed(current); assert.equal(result.entries.filter((item) => item.path === "external/research/research-001/note.md").length, 1);
});

test("projet structuré conserve manuscriptPath et ses fichiers", async () => {
  const result = await parsed(); assert.equal(result.manifest.project.manuscriptPath, "Manuscrit"); assert.ok(entry(result, "project/Manuscrit/01.md"));
});

test("projet adopté conserve manuscriptPath '.' et ses fichiers", async () => {
  const result = await parsed(fixture({ adopted: true })); assert.equal(result.manifest.project.manuscriptPath, "."); assert.ok(entry(result, "project/Article.md"));
});

test("n’effectue aucune écriture Vault", async () => {
  const current = fixture(); let writes = 0; for (const method of ["create", "createBinary", "modify", "rename", "delete", "trashFile", "createFolder"]) current.app.vault[method] = () => { writes += 1; };
  await archive(current); assert.equal(writes, 0);
});

test("propage sans transformation une erreur du plan d’export", async () => {
  const current = fixture(); current.settings.projectMeta[current.root].researchFolderLinks = { [`${current.root}/Externe`]: "Hors/Absente" };
  await assert.rejects(() => archive(current), FeuilProjectExportError);
});

test("round-trip archive préserve level1Role", async () => {
  const current = fixture(); current.settings.level1Role = "chapitres";
  const result = await archive(current); assert.equal((await readFeuilProjectPackage(result.data)).manifest.project.structure.level1Role, "chapitres");
});
