import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { buildFeuilProjectExportPlan, FeuilProjectExportError } from "../src/services/feuil-project-export.js";

function folder(path, children = []) {
  const value = new TFolder(path); value.children = children;
  for (const child of children) child.parent = value;
  return value;
}

function file(path, bytes) { const value = new TFile(path); value.bytes = bytes; return value; }

function fixture({ adopted = false } = {}) {
  const chapter = file(adopted ? "Articles/Article.md" : "Projet/Manuscrit/01.md", new Uint8Array([0, 255, 2]));
  chapter.frontmatter = { thread: "thread" };
  const empty = folder(adopted ? "Articles/Vide" : "Projet/Manuscrit/Vide");
  const manuscript = adopted ? folder("Articles", [chapter, empty]) : folder("Projet/Manuscrit", [chapter, empty]);
  const backupFile = file(adopted ? "Articles/_Backups/old.zip" : "Projet/_Feuillets/Backups/old.zip", new Uint8Array([9]));
  const backups = folder(adopted ? "Articles/_Backups" : "Projet/_Feuillets/Backups", [backupFile]);
  const ordinaryBackups = folder(adopted ? "Articles/Backups" : "Projet/Backups", [file(adopted ? "Articles/Backups/keep.md" : "Projet/Backups/keep.md", new Uint8Array([4]))]);
  const externalNote = file("Hors/Archives/note.md", new Uint8Array([7, 8]));
  const external = folder("Hors/Archives", [externalNote]);
  const externalRoot = folder("Hors", [external]);
  const project = adopted ? manuscript : folder("Projet", [manuscript, folder("Projet/_Feuillets", [backups]), ordinaryBackups]);
  if (adopted) manuscript.children.push(backups, ordinaryBackups), backups.parent = manuscript, ordinaryBackups.parent = manuscript;
  const all = [project, manuscript, chapter, empty, backups, backupFile, ordinaryBackups, ...ordinaryBackups.children, externalRoot, external, externalNote];
  const map = new Map(all.map((item) => [item.path, item]));
  const root = adopted ? "Articles" : "Projet/Manuscrit";
  const settings = {
    projectFolder: root, level1Role: "parties", projectMeta: { [root]: { title: "Meta", researchFolderLinks: { [`${root}/Lien`]: adopted ? "Articles/Recherche" : "Projet/Recherche", [`${root}/Ext`]: "Hors/Archives" } } },
    orders: { [project.path]: ["Manuscrit"], [`${project.path}/Manuscrit`]: ["01"], "Autre": ["x"] },
    folderPositions: { [project.path]: 1, "Autre": 2 }, folderGoals: { [`${project.path}/Manuscrit`]: 100, "Autre": 2 },
    filPlaceholders: { thread: chapter.path, outside: "Autre/Fichier.md" }, filOrigins: { thread: project.path }, filResolved: ["thread", "thread"],
  };
  const app = { vault: { getAbstractFileByPath: (path) => map.get(path) || null, readBinary: async (item) => item.bytes.buffer.slice(0) }, metadataCache: { getFileCache: (item) => ({ frontmatter: item.frontmatter || {} }) } };
  return { app, settings, project, manuscript, map };
}

test("construit un projet structuré portable, binaire et sans backups", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "2.6.0", "p", "2026-08-21T00:00:00Z");
  assert.equal(plan.manifest.project.rootKind, "structured"); assert.equal(plan.manifest.project.manuscriptPath, "Manuscrit");
  assert.deepEqual(plan.files["project/Manuscrit/01.md"], new Uint8Array([0, 255, 2])); assert.ok(plan.directories.includes("project/Manuscrit/Vide"));
  assert.equal("project/_Feuillets/Backups/old.zip" in plan.files, false); assert.ok("project/Backups/keep.md" in plan.files);
  assert.deepEqual(plan.manifest.project.pathSettings.orders, { ".": ["Manuscrit"], Manuscrit: ["01"] }); assert.deepEqual(plan.manifest.project.pathSettings.folderPositions, { ".": 1 });
  assert.deepEqual(plan.manifest.project.pathSettings.folderGoals, { Manuscrit: 100 }); assert.deepEqual(plan.manifest.project.narrativeState.placeholders, { thread: "Manuscrit/01.md" });
  assert.deepEqual(plan.manifest.project.narrativeState.resolved, ["thread", "thread"]); assert.equal("researchFolderLinks" in plan.manifest.project.meta, false);
});

test("construit un projet adopté et classe les recherches sans fuite", async () => {
  const { app, settings } = fixture({ adopted: true }); const plan = await buildFeuilProjectExportPlan(app, settings, "2.6.0", "p", "2026-08-21T00:00:00Z");
  assert.equal(plan.manifest.project.rootKind, "adopted"); assert.equal(plan.manifest.project.manuscriptPath, "."); assert.ok("project/Article.md" in plan.files);
  const external = plan.manifest.project.linkedResearch.find((link) => link.target.kind === "external"); assert.equal(external.target.kind, "external"); assert.equal(external.target.id, "research-001");
  assert.equal(JSON.stringify(plan.manifest).includes("Articles/"), false);
});

test("refuse un binder externe, projet absent et racine de coffre", async () => {
  const { app, settings } = fixture(); settings.projectMeta[settings.projectFolder].researchFolderLinks = { "Autre/Lien": "Hors/Archives" };
  await assert.rejects(() => buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"), FeuilProjectExportError);
  await assert.rejects(() => buildFeuilProjectExportPlan({ vault: { getAbstractFileByPath: () => null } }, settings, "v", "p", "2026-08-21T00:00:00Z"), FeuilProjectExportError);
});

test("projet structuré préfixe le chapitre sous project", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z");
  assert.equal(plan.manifest.project.rootKind, "structured"); assert.equal(plan.manifest.project.manuscriptPath, "Manuscrit"); assert.ok("project/Manuscrit/01.md" in plan.files);
});

test("projet adopté préfixe le chapitre sous project", async () => {
  const { app, settings } = fixture({ adopted: true }); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z");
  assert.equal(plan.manifest.project.rootKind, "adopted"); assert.equal(plan.manifest.project.manuscriptPath, "."); assert.ok("project/Article.md" in plan.files);
});

test("binaire est conservé octet pour octet", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z");
  assert.deepEqual(plan.files["project/Manuscrit/01.md"], new Uint8Array([0, 255, 2]));
});

test("dossier vide est exporté", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.ok(plan.directories.includes("project/Manuscrit/Vide"));
});

test("backups résolus et descendants sont exclus", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(plan.directories.some((path) => path.includes("_Feuillets/Backups")), false); assert.equal(Object.keys(plan.files).some((path) => path.includes("old.zip")), false);
});

test("Backups ordinaire est conservé", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.ok(plan.directories.includes("project/Backups")); assert.ok("project/Backups/keep.md" in plan.files);
});

test("ProjectMeta est copié", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(plan.manifest.project.meta.title, "Meta");
});

test("ProjectMeta source reste immuable", async () => {
  const { app, settings } = fixture(); const before = JSON.stringify(settings.projectMeta); await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(JSON.stringify(settings.projectMeta), before);
});

test("researchFolderLinks est retiré des métadonnées", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal("researchFolderLinks" in plan.manifest.project.meta, false);
});

test("orders deviennent portables et sont copiés", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.pathSettings.orders, { ".": ["Manuscrit"], Manuscrit: ["01"] }); assert.notEqual(plan.manifest.project.pathSettings.orders["."], settings.orders[app.vault.getAbstractFileByPath(settings.projectFolder).parent.path]);
});

test("folderPositions deviennent portables", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.pathSettings.folderPositions, { ".": 1 });
});

test("folderGoals deviennent portables", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.pathSettings.folderGoals, { Manuscrit: 100 });
});

test("narrative placeholders deviennent portables", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.placeholders, { thread: "Manuscrit/01.md" });
});

test("narrative origins deviennent portables", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.origins, { thread: "." });
});

test("narrative resolved conserve son ordre", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.resolved, ["thread", "thread"]);
});

test("Research interne devient une cible project relative", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); const link = plan.manifest.project.linkedResearch.find((item) => item.target.kind === "project"); assert.deepEqual(link, { binderPath: "Lien", target: { kind: "project", path: "Recherche" } });
});

test("Research externe reçoit id, nom et aucun chemin Vault", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); const link = plan.manifest.project.linkedResearch.find((item) => item.target.kind === "external"); assert.deepEqual(link, { binderPath: "Ext", target: { kind: "external", id: "research-001", name: "Archives" } }); assert.equal(JSON.stringify(plan.manifest).includes("Hors/Archives"), false);
});

test("IDs externes restent déterministes quel que soit l’ordre source", async () => {
  const first = fixture(); const second = fixture(); const root = first.settings.projectFolder;
  for (const current of [first, second]) {
    const a = folder("Hors/A", [file("Hors/A/a.md", new Uint8Array([1]))]); const z = folder("Hors/Z", [file("Hors/Z/z.md", new Uint8Array([2]))]);
    current.map.set(a.path, a), current.map.set(a.children[0].path, a.children[0]), current.map.set(z.path, z), current.map.set(z.children[0].path, z.children[0]);
  }
  first.settings.projectMeta[root].researchFolderLinks = { [`${root}/B`]: "Hors/Z", [`${root}/A`]: "Hors/A" };
  second.settings.projectMeta[root].researchFolderLinks = { [`${root}/A`]: "Hors/A", [`${root}/B`]: "Hors/Z" };
  const [a, b] = await Promise.all([buildFeuilProjectExportPlan(first.app, first.settings, "v", "p", "2026-08-21T00:00:00Z"), buildFeuilProjectExportPlan(second.app, second.settings, "v", "p", "2026-08-21T00:00:00Z")]); assert.deepEqual(a.manifest.project.linkedResearch, b.manifest.project.linkedResearch); assert.equal(a.manifest.project.linkedResearch[0].target.id, "research-001");
});

test("anti-fuite retire les chemins projet et recherche externe", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); const json = JSON.stringify(plan.manifest); assert.equal(json.includes("Projet/Manuscrit"), false); assert.equal(json.includes("Hors/Archives"), false);
});

test("projet top-level Projet exporte sans faux positif anti-fuite", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(app.vault.getAbstractFileByPath("Projet").path, "Projet"); assert.equal(plan.manifest.project.name, "Projet");
});

test("deux liens vers une même Research externe partagent le même id", async () => {
  const { app, settings } = fixture(); const root = settings.projectFolder; settings.projectMeta[root].researchFolderLinks = { [`${root}/A`]: "Hors/Archives", [`${root}/B`]: "Hors/Archives" }; const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.linkedResearch.map((item) => item.target.id), ["research-001", "research-001"]);
});

test("Manuscrit directement à la racine est adopté", async () => {
  const chapter = file("Manuscrit/01.md", new Uint8Array([1, 2]));
  const root = folder("", []); const manuscript = folder("Manuscrit", [chapter]); manuscript.parent = root;
  const map = new Map([["Manuscrit", manuscript], ["Manuscrit/01.md", chapter]]);
  const app = { vault: { getAbstractFileByPath: (path) => map.get(path) || null, readBinary: async (item) => item.bytes.buffer.slice(0) }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  const settings = { projectFolder: "Manuscrit", level1Role: "parties", projectMeta: { Manuscrit: {} }, orders: {}, folderPositions: {}, folderGoals: {}, filPlaceholders: {}, filOrigins: {}, filResolved: [] };
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z");
  assert.equal(plan.manifest.project.rootKind, "adopted"); assert.equal(plan.manifest.project.manuscriptPath, "."); assert.ok("project/01.md" in plan.files);
});

test("Research interne ciblant projectRoot devient la cible project '.'", async () => {
  const { app, settings } = fixture(); const root = settings.projectFolder; settings.projectMeta[root].researchFolderLinks = { [`${root}/Lien`]: "Projet" };
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.linkedResearch[0], { binderPath: "Lien", target: { kind: "project", path: "." } });
});

test("racine du coffre est refusée explicitement", async () => {
  const root = new TFolder("/"); const app = { vault: { getAbstractFileByPath: () => root } };
  const settings = { projectFolder: "/", level1Role: "parties", projectMeta: {}, orders: {}, folderPositions: {}, folderGoals: {}, filPlaceholders: {}, filOrigins: {}, filResolved: [] };
  await assert.rejects(() => buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"), FeuilProjectExportError);
});

test("Research externe copie un fichier Markdown", async () => {
  const { app, settings } = fixture(); const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z");
  assert.deepEqual(plan.files["external/research/research-001/note.md"], new Uint8Array([7, 8]));
});

test("Research externe conserve les binaires octet pour octet", async () => {
  const { app, settings, map } = fixture(); const image = file("Hors/Archives/map.png", new Uint8Array([0, 255, 17])); map.get("Hors/Archives").children.push(image), image.parent = map.get("Hors/Archives"), map.set(image.path, image);
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.files["external/research/research-001/map.png"], new Uint8Array([0, 255, 17]));
});

test("Research externe copie récursivement les sous-dossiers", async () => {
  const { app, settings, map } = fixture(); const child = file("Hors/Archives/Images/map.png", new Uint8Array([5])); const images = folder("Hors/Archives/Images", [child]); map.get("Hors/Archives").children.push(images), images.parent = map.get("Hors/Archives"), map.set(images.path, images), map.set(child.path, child);
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.ok(plan.directories.includes("external/research/research-001/Images")); assert.ok("external/research/research-001/Images/map.png" in plan.files);
});

test("Research externe vide conserve sa racine d’archive", async () => {
  const { app, settings, map } = fixture(); const empty = folder("Hors/Vide"); map.set(empty.path, empty); settings.projectMeta[settings.projectFolder].researchFolderLinks = { [`${settings.projectFolder}/Ext`]: empty.path };
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.ok(plan.directories.includes("external/research/research-001"));
});

test("deux liens externes identiques ne copient la source qu’une fois", async () => {
  const { app, settings } = fixture(); const root = settings.projectFolder; settings.projectMeta[root].researchFolderLinks = { [`${root}/A`]: "Hors/Archives", [`${root}/B`]: "Hors/Archives" };
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.linkedResearch.map((link) => link.target.id), ["research-001", "research-001"]); assert.equal(Object.keys(plan.files).filter((path) => path === "external/research/research-001/note.md").length, 1);
});

test("deux Research externes distinctes sont copiées sous leurs IDs", async () => {
  const { app, settings, map } = fixture(); const other = folder("Hors/Autre", [file("Hors/Autre/a.md", new Uint8Array([3]))]); map.set(other.path, other), map.set(other.children[0].path, other.children[0]); const root = settings.projectFolder; settings.projectMeta[root].researchFolderLinks = { [`${root}/A`]: "Hors/Archives", [`${root}/B`]: other.path };
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.ok("external/research/research-001/note.md" in plan.files); assert.ok("external/research/research-002/a.md" in plan.files);
});

test("copie externe reste déterministe quel que soit l’ordre des liens", async () => {
  const first = fixture(); const second = fixture(); const root = first.settings.projectFolder;
  for (const current of [first, second]) { const a = folder("Hors/A", [file("Hors/A/a.md", new Uint8Array([1]))]); const z = folder("Hors/Z", [file("Hors/Z/z.md", new Uint8Array([2]))]); current.map.set(a.path, a), current.map.set(a.children[0].path, a.children[0]), current.map.set(z.path, z), current.map.set(z.children[0].path, z.children[0]); }
  first.settings.projectMeta[root].researchFolderLinks = { [`${root}/Z`]: "Hors/Z", [`${root}/A`]: "Hors/A" }; second.settings.projectMeta[root].researchFolderLinks = { [`${root}/A`]: "Hors/A", [`${root}/Z`]: "Hors/Z" };
  const [a, b] = await Promise.all([buildFeuilProjectExportPlan(first.app, first.settings, "v", "p", "2026-08-21T00:00:00Z"), buildFeuilProjectExportPlan(second.app, second.settings, "v", "p", "2026-08-21T00:00:00Z")]); assert.deepEqual(a.files, b.files); assert.deepEqual(a.directories, b.directories);
});

test("Research interne ne crée aucune archive externe", async () => {
  const { app, settings } = fixture(); settings.projectMeta[settings.projectFolder].researchFolderLinks = { [`${settings.projectFolder}/Lien`]: "Projet/Recherche" };
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(Object.keys(plan.files).some((path) => path.startsWith("external/research/")), false); assert.equal(plan.directories.some((path) => path.startsWith("external/research/")), false);
});

test("Research externe introuvable est refusée", async () => {
  const { app, settings } = fixture(); settings.projectMeta[settings.projectFolder].researchFolderLinks = { [`${settings.projectFolder}/Ext`]: "Hors/Absente" };
  await assert.rejects(() => buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"), FeuilProjectExportError);
});

test("Research externe qui cible un fichier est refusée", async () => {
  const { app, settings } = fixture(); settings.projectMeta[settings.projectFolder].researchFolderLinks = { [`${settings.projectFolder}/Ext`]: "Hors/Archives/note.md" };
  await assert.rejects(() => buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"), FeuilProjectExportError);
});

test("Research externe qui cible la racine du coffre est refusée", async () => {
  const { app, settings, map } = fixture(); map.set("", folder("")); settings.projectMeta[settings.projectFolder].researchFolderLinks = { [`${settings.projectFolder}/Ext`]: "" };
  await assert.rejects(() => buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"), FeuilProjectExportError);
});

test("la construction ne déclenche aucune écriture Vault", async () => {
  const { app, settings } = fixture(); let writes = 0; for (const method of ["create", "createBinary", "modify", "rename", "delete", "trashFile", "createFolder"]) app.vault[method] = () => { writes += 1; };
  await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(writes, 0);
});

test("resolved présent dans le manuscrit est exporté", async () => {
  const { app, settings } = fixture(); settings.filResolved = ["thread"];
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.resolved, ["thread"]);
});

test("resolved absent du manuscrit n’est pas exporté", async () => {
  const { app, settings } = fixture(); settings.filResolved = ["fil-autre-projet"];
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.resolved, []);
});

test("resolved global mélange projet courant et autre projet", async () => {
  const { app, settings } = fixture(); settings.filResolved = ["thread", "fil-autre-projet"];
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.resolved, ["thread"]);
});

test("resolved conserve l’ordre et les doublons du projet", async () => {
  const { app, settings, manuscript } = fixture(); const second = file("Projet/Manuscrit/02.md", new Uint8Array([1])); second.frontmatter = { thread: "second" }; manuscript.children.push(second), second.parent = manuscript;
  settings.filResolved = ["second", "thread", "second"];
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.resolved, ["second", "thread", "second"]);
});

test("resolved présent uniquement dans Front n’est pas exporté", async () => {
  const { app, settings, manuscript } = fixture(); const frontFile = file("Projet/Manuscrit/Front/Avant.md", new Uint8Array([1])); frontFile.frontmatter = { thread: "front-only" }; const front = folder("Projet/Manuscrit/Front", [frontFile]); manuscript.children.push(front), front.parent = manuscript;
  settings.filResolved = ["front-only"];
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.resolved, []);
});

test("filResolved source reste strictement inchangé après filtrage", async () => {
  const { app, settings } = fixture(); settings.filResolved = ["thread", "fil-autre-projet", "thread"]; const before = [...settings.filResolved];
  await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(settings.filResolved, before);
});

test("exporte level1Role 'parties'", async () => {
  const { app, settings } = fixture(); settings.level1Role = "parties";
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(plan.manifest.project.structure.level1Role, "parties");
});

test("exporte level1Role 'chapitres'", async () => {
  const { app, settings } = fixture(); settings.level1Role = "chapitres";
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(plan.manifest.project.structure.level1Role, "chapitres");
});

test("level1Role source reste inchangé après export", async () => {
  const { app, settings } = fixture(); settings.level1Role = "chapitres";
  await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(settings.level1Role, "chapitres");
});

test("exporte l’état narratif propre au ProjectMeta", async () => {
  const { app, settings } = fixture(); settings.filResolved = ["autre"]; settings.projectMeta[settings.projectFolder].narrativeState = { placeholders: { thread: "Projet/Manuscrit/01.md" }, origins: { thread: "Projet" }, resolved: ["thread"] };
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.deepEqual(plan.manifest.project.narrativeState.resolved, ["thread"]);
});

test("retire level1Role et narrativeState des meta exportées", async () => {
  const { app, settings } = fixture(); settings.projectMeta[settings.projectFolder].level1Role = "chapitres"; settings.projectMeta[settings.projectFolder].narrativeState = { placeholders: {}, origins: {}, resolved: [] };
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal("level1Role" in plan.manifest.project.meta, false); assert.equal("narrativeState" in plan.manifest.project.meta, false); assert.equal(plan.manifest.project.structure.level1Role, "chapitres");
});

test("level1Role du ProjectMeta prime sur le fallback global", async () => {
  const first = fixture(); first.settings.level1Role = "parties"; first.settings.projectMeta[first.settings.projectFolder].level1Role = "chapitres";
  const second = fixture(); second.settings.level1Role = "chapitres"; second.settings.projectMeta[second.settings.projectFolder].level1Role = "parties";
  const [a, b] = await Promise.all([buildFeuilProjectExportPlan(first.app, first.settings, "v", "p", "2026-08-21T00:00:00Z"), buildFeuilProjectExportPlan(second.app, second.settings, "v", "p", "2026-08-21T00:00:00Z")]); assert.equal(a.manifest.project.structure.level1Role, "chapitres"); assert.equal(b.manifest.project.structure.level1Role, "parties");
});

test("level1Role global reste le fallback legacy sans ProjectMeta", async () => {
  const { app, settings } = fixture(); delete settings.projectMeta[settings.projectFolder].level1Role; settings.level1Role = "chapitres";
  const plan = await buildFeuilProjectExportPlan(app, settings, "v", "p", "2026-08-21T00:00:00Z"); assert.equal(plan.manifest.project.structure.level1Role, "chapitres");
});
