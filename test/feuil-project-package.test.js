import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  FeuilProjectPackageError, createFeuilProjectPackage, readFeuilProjectPackage, validateFeuilProjectManifest,
} from "../src/services/feuil-project-package.js";

const manifest = (overrides = {}) => ({
  format: "feuil", version: 1, packageId: "project-1", createdAt: "2026-08-21T10:00:00.000Z", createdByVersion: "2.6.0",
  project: {
    name: "Mon roman", rootKind: "structured", manuscriptPath: "Manuscrit", structure: { level1Role: "parties" }, meta: { genre: "roman" },
    pathSettings: { orders: { Manuscrit: ["Chapitre 1"] }, folderPositions: { Manuscrit: 1 }, folderGoals: { Manuscrit: 2000 } },
    narrativeState: { placeholders: {}, origins: {}, resolved: [] },
    linkedResearch: [],
  },
  ...overrides,
});

async function rejects(action) { await assert.rejects(action, FeuilProjectPackageError); }

async function archive(entries) {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(entries)) zip.file(path, value);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function topologyArchive(files, directories = []) {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest()));
  for (const [path, value] of Object.entries(files)) zip.file(path, value, { createFolders: false });
  for (const path of directories) zip.file(`${path}/`, "", { createFolders: false, dir: true });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

test("round-trip texte et binaire conserve manifest et octets", async () => {
  const image = new Uint8Array([0, 255, 4, 128, 17]);
  const data = await createFeuilProjectPackage(manifest(), {
    "project/Manuscrit/Chapitre 1/Scene.md": "Scène inchangée.",
    "project/_Feuillets/Ressources/Images/image.png": image,
  });
  const parsed = await readFeuilProjectPackage(data);
  assert.equal(parsed.manifest.project.name, "Mon roman");
  assert.equal(new TextDecoder().decode(parsed.entries[0].data), "Scène inchangée.");
  assert.deepEqual(parsed.entries[1].data, image);
});

test("manuscriptPath accepte les projets adopté et structuré", () => {
  const adopted = manifest({ project: { ...manifest().project, rootKind: "adopted", manuscriptPath: ".", pathSettings: { ...manifest().project.pathSettings, orders: { ".": ["Chapitre 1"] } } } });
  assert.equal(validateFeuilProjectManifest(adopted).project.manuscriptPath, ".");
  assert.equal(validateFeuilProjectManifest(manifest()).project.manuscriptPath, "Manuscrit");
  for (const project of [
    { ...manifest().project, rootKind: "adopted", manuscriptPath: "Manuscrit" },
    { ...manifest().project, rootKind: "structured", manuscriptPath: "." },
  ]) assert.throws(() => validateFeuilProjectManifest(manifest({ project })), FeuilProjectPackageError);
});

test("structure level1Role 'parties' est acceptée", () => {
  const project = { ...manifest().project, structure: { level1Role: "parties" } }; assert.equal(validateFeuilProjectManifest(manifest({ project })).project.structure.level1Role, "parties");
});

test("structure level1Role 'chapitres' est acceptée", () => {
  const project = { ...manifest().project, structure: { level1Role: "chapitres" } }; assert.equal(validateFeuilProjectManifest(manifest({ project })).project.structure.level1Role, "chapitres");
});

test("structure absente est refusée", () => {
  const project = { ...manifest().project }; delete project.structure; assert.throws(() => validateFeuilProjectManifest(manifest({ project })), FeuilProjectPackageError);
});

test("level1Role invalide est refusé", () => {
  const project = { ...manifest().project, structure: { level1Role: "autre" } }; assert.throws(() => validateFeuilProjectManifest(manifest({ project })), FeuilProjectPackageError);
});

test("linkedResearch project et external valides", () => {
  const linkedResearch = [
    { binderPath: "Sources/Notes", target: { kind: "project", path: "Recherche/Notes" } },
    { binderPath: "Sources/Archives", target: { kind: "external", id: "research-42", name: "Archives" } },
  ];
  assert.equal(validateFeuilProjectManifest(manifest({ project: { ...manifest().project, linkedResearch } })).project.linkedResearch.length, 2);
});

test("linkedResearch accepte la racine projet et un id externe partagé cohérent", () => {
  const linkedResearch = [{ binderPath: "A", target: { kind: "project", path: "." } }, { binderPath: "B", target: { kind: "external", id: "research-001", name: "Archives" } }, { binderPath: "C", target: { kind: "external", id: "research-001", name: "Archives" } }];
  assert.equal(validateFeuilProjectManifest(manifest({ project: { ...manifest().project, linkedResearch } })).project.linkedResearch.length, 3);
  linkedResearch[2].target.name = "Autre"; assert.throws(() => validateFeuilProjectManifest(manifest({ project: { ...manifest().project, linkedResearch } })), FeuilProjectPackageError);
});

test("rejette formats, versions et champs de manifeste invalides", () => {
  for (const value of [
    manifest({ format: "feuillets" }), manifest({ version: 2 }), manifest({ createdAt: "pas une date" }),
    manifest({ project: { ...manifest().project, manuscriptPath: "/absolute" } }),
    manifest({ project: { ...manifest().project, rootKind: "other" } }),
  ]) assert.throws(() => validateFeuilProjectManifest(value), FeuilProjectPackageError);
});

test("rejette clés dangereuses, doublons et nombres non finis", () => {
  const dangerous = JSON.parse(JSON.stringify(manifest())); dangerous.project.meta.constructor = { bad: true };
  const duplicate = manifest({ project: { ...manifest().project, linkedResearch: [
    { binderPath: "A", target: { kind: "project", path: "Recherche/A" } }, { binderPath: "A", target: { kind: "external", id: "x", name: "X" } },
  ] } });
  const infinite = manifest({ project: { ...manifest().project, pathSettings: { ...manifest().project.pathSettings, folderGoals: { A: Infinity } } } });
  const nan = manifest({ project: { ...manifest().project, pathSettings: { ...manifest().project.pathSettings, folderPositions: { A: NaN } } } });
  for (const value of [dangerous, duplicate, infinite, nan]) assert.throws(() => validateFeuilProjectManifest(value), FeuilProjectPackageError);
});

test("création refuse manifest réservé et chemins hors espaces sûrs", async () => {
  await rejects(() => createFeuilProjectPackage(manifest(), { "manifest.json": "{}" }));
  for (const path of ["evil.txt", "../evil", "project/../evil", "/project/a", "C:/evil", "project\\evil", "project//evil", "project/./evil", "project/a:b"]) {
    await rejects(() => createFeuilProjectPackage(manifest(), { [path]: "evil" }));
  }
});

test("lecture refuse manifest absent, ZIP corrompu et fichier top-level", async () => {
  const missingManifest = await archive({ "project/a.md": "x" });
  const unexpectedTopLevel = await archive({ "manifest.json": JSON.stringify(manifest()), "evil.txt": "x" });
  await rejects(() => readFeuilProjectPackage(missingManifest));
  await rejects(() => readFeuilProjectPackage(new Uint8Array([1, 2, 3])));
  await rejects(() => readFeuilProjectPackage(unexpectedTopLevel));
});

test("lecture refuse traversées, absolus, backslashes et segments dangereux", async () => {
  for (const path of ["../evil", "project/../evil", "/project/a", "C:/evil", "project\\evil", "project//evil", "project/./evil"]) {
    const maliciousArchive = await archive({ "manifest.json": JSON.stringify(manifest()), [path]: "x" });
    await rejects(() => readFeuilProjectPackage(maliciousArchive));
  }
});

test("les dossiers ZIP explicites sûrs ne sont pas retournés", async () => {
  const zip = new JSZip();
  zip.folder("project/Manuscrit");
  zip.file("manifest.json", JSON.stringify(manifest()));
  const parsed = await readFeuilProjectPackage(await zip.generateAsync({ type: "uint8array" }));
  assert.deepEqual(parsed.entries, []);
  assert.deepEqual(parsed.directories, ["project/Manuscrit"]);
});

test("round-trip préserve les dossiers vides projet et recherche externe", async () => {
  const parsed = await readFeuilProjectPackage(await createFeuilProjectPackage(manifest(), {}, [
    "project/Manuscrit/Partie vide", "external/research/research-42/Dossier vide",
  ]));
  assert.deepEqual(parsed.entries, []);
  assert.deepEqual(parsed.directories.sort(), [
    "external/research/research-42/Dossier vide", "project/Manuscrit/Partie vide",
  ]);
});

test("création refuse les collisions et doublons de dossiers", async () => {
  await rejects(() => createFeuilProjectPackage(manifest(), { "project/Manuscrit/Fichier.md": "x" }, ["project/Manuscrit/Fichier.md"]));
  await rejects(() => createFeuilProjectPackage(manifest(), {}, ["project/Manuscrit/Vide", "project/Manuscrit/Vide"]));
});

test("création refuse les topologies impossibles et accepte un parent dossier", async () => {
  await rejects(() => createFeuilProjectPackage(manifest(), { "project/A": "x" }, ["project/A"]));
  await rejects(() => createFeuilProjectPackage(manifest(), { "project/A": "x", "project/A/B.md": "x" }));
  await rejects(() => createFeuilProjectPackage(manifest(), { "project/A": "x" }, ["project/A/B"]));
  const parsed = await readFeuilProjectPackage(await createFeuilProjectPackage(manifest(), { "project/A/B.md": "ok" }, ["project/A"]));
  assert.deepEqual(parsed.directories, ["project/A"]);
  assert.equal(new TextDecoder().decode(parsed.entries[0].data), "ok");
});

test("lecture refuse les topologies impossibles et accepte un parent dossier", async () => {
  const fileAndDirectory = await topologyArchive({ "project/A": "x" }, ["project/A"]);
  const fileAncestorFile = await topologyArchive({ "project/A": "x", "project/A/B.md": "x" });
  const fileAncestorDirectory = await topologyArchive({ "project/A": "x" }, ["project/A/B"]);
  await rejects(() => readFeuilProjectPackage(fileAndDirectory));
  await rejects(() => readFeuilProjectPackage(fileAncestorFile));
  await rejects(() => readFeuilProjectPackage(fileAncestorDirectory));
  const parsed = await readFeuilProjectPackage(await topologyArchive({ "project/A/B.md": "ok" }, ["project/A"]));
  assert.deepEqual(parsed.directories, ["project/A"]);
  assert.equal(new TextDecoder().decode(parsed.entries[0].data), "ok");
});

test("rejette les segments Windows non portables à la création et à la lecture", async () => {
  for (const path of ["project/CON/file.md", "project/NUL.txt", "project/Chapitre.", "project/Chapitre ", "external/research/COM1/test.md", "project/a\u0000b.md"]) {
    await rejects(() => createFeuilProjectPackage(manifest(), { [path]: "x" }));
    const maliciousArchive = await archive({ "manifest.json": JSON.stringify(manifest()), [path]: "x" });
    await rejects(() => readFeuilProjectPackage(maliciousArchive));
  }
});

test("rejette les noms d’enfants orders dangereux", () => {
  for (const order of ["../evil", "A/B", "CON"]) {
    const project = { ...manifest().project, pathSettings: { ...manifest().project.pathSettings, orders: { ".": [order] } } };
    assert.throws(() => validateFeuilProjectManifest(manifest({ project })), FeuilProjectPackageError);
  }
});

test("rejette les IDs de recherche externe qui ne sont pas atomiques", () => {
  const project = { ...manifest().project, linkedResearch: [{ binderPath: "Sources", target: { kind: "external", id: "foo/bar", name: "Archives" } }] };
  assert.throws(() => validateFeuilProjectManifest(manifest({ project })), FeuilProjectPackageError);
});

test("le service .feuil est autonome des API .feuillets", async () => {
  const parsed = await readFeuilProjectPackage(await createFeuilProjectPackage(manifest(), { "external/research/archive.txt": "ok" }));
  assert.equal(new TextDecoder().decode(parsed.entries[0].data), "ok");
});
