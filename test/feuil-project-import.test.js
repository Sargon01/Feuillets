import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { FeuilProjectImportError, materializeFeuilProjectImport } from "../src/services/feuil-project-import.js";

function tree(files = {}, directories = []) { return { files, directories }; }

function plan({ adopted = false, project = tree({ "Manuscrit/01.md": new Uint8Array([1, 2]) }, ["Manuscrit", "Manuscrit/Vide"]), externalResearch = [], linkedResearch = [] } = {}) {
  return {
    manifest: {
      project: {
        manuscriptPath: adopted ? "." : "Manuscrit", meta: { title: "Meta" }, structure: { level1Role: "parties" }, linkedResearch,
        pathSettings: { orders: { ".": ["Manuscrit"], Chapitre: ["Scene"] }, folderPositions: { Chapitre: 1 }, folderGoals: { Chapitre: 100 } },
        narrativeState: { placeholders: { fil: "Manuscrit/01.md" }, origins: { fil: "." }, resolved: ["fil"] },
      },
    },
    project,
    externalResearch,
  };
}

function vaultFixture({ parents = ["Imports"], failBinary = false, failTrash = false } = {}) {
  const entries = new Map(); const writes = []; const trashed = [];
  const root = new TFolder(""); entries.set("", root);
  const createFolder = async (path) => {
    if (entries.has(path)) throw new Error(`collision ${path}`);
    const parentPath = path.split("/").slice(0, -1).join("/"); const parent = entries.get(parentPath);
    if (!(parent instanceof TFolder)) throw new Error(`parent ${parentPath}`);
    const value = new TFolder(path); value.parent = parent; parent.children.push(value); entries.set(path, value); writes.push(["folder", path]); return value;
  };
  for (const path of parents) {
    const segments = path.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      const current = segments.slice(0, index).join("/");
      if (!entries.has(current)) {
        const parentPath = current.split("/").slice(0, -1).join("/"); const parent = entries.get(parentPath);
        const value = new TFolder(current); value.parent = parent; parent.children.push(value); entries.set(current, value);
      }
    }
  }
  const vault = {
    getAbstractFileByPath: (path) => entries.get(path) || null,
    createFolder,
    createBinary: async (path, data) => {
      if (failBinary) throw new Error("binary failure");
      const parentPath = path.split("/").slice(0, -1).join("/"); const parent = entries.get(parentPath);
      if (!(parent instanceof TFolder)) throw new Error(`parent ${parentPath}`);
      const value = new TFile(path); value.bytes = new Uint8Array(data); value.parent = parent; parent.children.push(value); entries.set(path, value); writes.push(["binary", path, value.bytes]); return value;
    },
  };
  const app = { vault, fileManager: { trashFile: async (folder) => { trashed.push(folder.path); if (failTrash) throw new Error("trash failure"); for (const path of [...entries.keys()]) if (path === folder.path || path.startsWith(`${folder.path}/`)) entries.delete(path); } } };
  return { app, entries, writes, trashed };
}

const external = (id = "research-001", name = "Archives", contents = tree({ "note.md": new Uint8Array([3]) }, [])) => ({ id, name, tree: contents });

test("matérialise un projet adopté", async () => {
  const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan({ adopted: true, project: tree({ "01.md": new Uint8Array([1]) }) }), "Imports/Article"); assert.equal(result.manuscriptRootPath, "Imports/Article"); assert.ok(state.entries.has("Imports/Article/01.md"));
});
test("matérialise un projet structured avec Manuscrit", async () => { const state = vaultFixture(); await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.ok(state.entries.has("Imports/Roman/Manuscrit")); });
test("conserve le Markdown octet pour octet", async () => { const state = vaultFixture(); const bytes = new Uint8Array([0, 255, 4]); await materializeFeuilProjectImport(state.app, plan({ project: tree({ "Manuscrit/a.md": bytes }, ["Manuscrit"]) }), "Imports/Roman"); assert.deepEqual(state.entries.get("Imports/Roman/Manuscrit/a.md").bytes, bytes); });
test("conserve un binaire octet pour octet", async () => { const state = vaultFixture(); const bytes = new Uint8Array([9, 0, 255]); await materializeFeuilProjectImport(state.app, plan({ project: tree({ "image.bin": bytes }, ["Manuscrit"]) }), "Imports/Roman"); assert.deepEqual(state.entries.get("Imports/Roman/image.bin").bytes, bytes); });
test("conserve un dossier project vide", async () => { const state = vaultFixture(); await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.ok(state.entries.has("Imports/Roman/Manuscrit/Vide")); });
test("accepte un projet vide", async () => { const state = vaultFixture(); await materializeFeuilProjectImport(state.app, plan({ adopted: true, project: tree() }), "Imports/Vide"); assert.ok(state.entries.has("Imports/Vide")); });
test("refuse une destination existante sans écriture", async () => { const state = vaultFixture(); await state.app.vault.createFolder("Imports/Pris"); const before = state.writes.length; await assert.rejects(() => materializeFeuilProjectImport(state.app, plan(), "Imports/Pris"), FeuilProjectImportError); assert.equal(state.writes.length, before); });
test("refuse un parent absent sans écriture", async () => { const state = vaultFixture(); const before = state.writes.length; await assert.rejects(() => materializeFeuilProjectImport(state.app, plan(), "Absent/Roman"), FeuilProjectImportError); assert.equal(state.writes.length, before); });
test("accepte une destination top-level", async () => { const state = vaultFixture({ parents: [] }); await materializeFeuilProjectImport(state.app, plan({ adopted: true, project: tree() }), "Roman"); assert.ok(state.entries.has("Roman")); });
test("matérialise une Research externe avec fichier", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan({ externalResearch: [external()] }), "Imports/Roman"); assert.ok(state.entries.has(`${result.externalResearchPaths["research-001"]}/note.md`)); });
test("conserve un binaire Research externe", async () => { const state = vaultFixture(); const bytes = new Uint8Array([4, 255]); const result = await materializeFeuilProjectImport(state.app, plan({ externalResearch: [external("research-001", "Archives", tree({ "x.bin": bytes }))] }), "Imports/Roman"); assert.deepEqual(state.entries.get(`${result.externalResearchPaths["research-001"]}/x.bin`).bytes, bytes); });
test("crée le dossier final d’une Research externe vide", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan({ externalResearch: [external("research-001", "Archives", tree())] }), "Imports/Roman"); assert.ok(state.entries.has(result.externalResearchPaths["research-001"])); });
test("deux IDs de même nom ne collisionnent pas", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan({ externalResearch: [external("research-001"), external("research-002")] }), "Imports/Roman"); assert.notEqual(result.externalResearchPaths["research-001"], result.externalResearchPaths["research-002"]); });
test("deux binder links vers le même ID visent le même dossier", async () => { const state = vaultFixture(); const links = [{ binderPath: "A", target: { kind: "external", id: "research-001", name: "Archives" } }, { binderPath: "B", target: { kind: "external", id: "research-001", name: "Archives" } }]; const result = await materializeFeuilProjectImport(state.app, plan({ externalResearch: [external()], linkedResearch: links }), "Imports/Roman"); assert.equal(result.settingsPatch.projectMeta.researchFolderLinks["Imports/Roman/Manuscrit/A"], result.settingsPatch.projectMeta.researchFolderLinks["Imports/Roman/Manuscrit/B"]); });
test("sans Research externe ne crée aucun dossier technique", async () => { const state = vaultFixture(); await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.equal([...state.entries.keys()].some((path) => path.includes("Recherche liée importée")), false); });
test("choisit le suffixe 2 si l’emplacement technique est occupé", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan({ project: tree({}, ["Manuscrit", "_Feuillets/Recherche liée importée"]), externalResearch: [external()] }), "Imports/Roman"); assert.ok(result.externalResearchPaths["research-001"].includes("Recherche liée importée 2")); });
test("refuse _Feuillets fichier avant écriture", async () => { const state = vaultFixture(); const before = state.writes.length; await assert.rejects(() => materializeFeuilProjectImport(state.app, plan({ project: tree({ "_Feuillets": new Uint8Array([1]) }, ["Manuscrit"]), externalResearch: [external()] }), "Imports/Roman"), FeuilProjectImportError); assert.equal(state.writes.length, before); });
test("refuse un nom Research externe invalide avant écriture", async () => { const state = vaultFixture(); const before = state.writes.length; await assert.rejects(() => materializeFeuilProjectImport(state.app, plan({ externalResearch: [external("research-001", "CON")] }), "Imports/Roman"), FeuilProjectImportError); assert.equal(state.writes.length, before); });
test("remappe binderPath '.' vers manuscriptRootPath", async () => { const state = vaultFixture(); const links = [{ binderPath: ".", target: { kind: "project", path: "." } }]; const result = await materializeFeuilProjectImport(state.app, plan({ linkedResearch: links }), "Imports/Roman"); assert.equal(result.settingsPatch.projectMeta.researchFolderLinks["Imports/Roman/Manuscrit"], "Imports/Roman"); });
test("remappe binderPath fichier", async () => { const state = vaultFixture(); const links = [{ binderPath: "Scene.md", target: { kind: "project", path: "." } }]; const result = await materializeFeuilProjectImport(state.app, plan({ linkedResearch: links }), "Imports/Roman"); assert.equal(result.settingsPatch.projectMeta.researchFolderLinks["Imports/Roman/Manuscrit/Scene.md"], "Imports/Roman"); });
test("remappe target project '.'", async () => { const state = vaultFixture(); const links = [{ binderPath: ".", target: { kind: "project", path: "." } }]; const result = await materializeFeuilProjectImport(state.app, plan({ linkedResearch: links }), "Imports/Roman"); assert.equal(result.settingsPatch.projectMeta.researchFolderLinks["Imports/Roman/Manuscrit"], "Imports/Roman"); });
test("remappe target project descendant", async () => { const state = vaultFixture(); const links = [{ binderPath: ".", target: { kind: "project", path: "Recherche" } }]; const result = await materializeFeuilProjectImport(state.app, plan({ linkedResearch: links }), "Imports/Roman"); assert.equal(result.settingsPatch.projectMeta.researchFolderLinks["Imports/Roman/Manuscrit"], "Imports/Roman/Recherche"); });
test("reconstruit researchFolderLinks dans projectMeta", async () => { const state = vaultFixture(); const links = [{ binderPath: ".", target: { kind: "project", path: "." } }]; const result = await materializeFeuilProjectImport(state.app, plan({ linkedResearch: links }), "Imports/Roman"); assert.ok("researchFolderLinks" in result.settingsPatch.projectMeta); });
test("remappe orders '.'", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.deepEqual(result.settingsPatch.pathSettings.orders["Imports/Roman"], ["Manuscrit"]); });
test("remappe orders descendant", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.deepEqual(result.settingsPatch.pathSettings.orders["Imports/Roman/Chapitre"], ["Scene"]); });
test("remappe folderPositions", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.equal(result.settingsPatch.pathSettings.folderPositions["Imports/Roman/Chapitre"], 1); });
test("remappe folderGoals", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.equal(result.settingsPatch.pathSettings.folderGoals["Imports/Roman/Chapitre"], 100); });
test("remappe narrative placeholders", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.equal(result.settingsPatch.narrativeState.placeholders.fil, "Imports/Roman/Manuscrit/01.md"); });
test("remappe narrative origins", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.equal(result.settingsPatch.narrativeState.origins.fil, "Imports/Roman"); });
test("copie narrative resolved sans modification", async () => { const state = vaultFixture(); const value = plan(); value.manifest.project.narrativeState.resolved = ["a", "a"]; const result = await materializeFeuilProjectImport(state.app, value, "Imports/Roman"); assert.deepEqual(result.settingsPatch.narrativeState.resolved, ["a", "a"]); });
test("retourne level1Role parties exactement", async () => { const state = vaultFixture(); const result = await materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"); assert.equal(result.settingsPatch.structure.level1Role, "parties"); });
test("retourne level1Role chapitres exactement", async () => { const state = vaultFixture(); const value = plan(); value.manifest.project.structure.level1Role = "chapitres"; const result = await materializeFeuilProjectImport(state.app, value, "Imports/Roman"); assert.equal(result.settingsPatch.structure.level1Role, "chapitres"); });
test("ne mute pas le plan après succès", async () => { const state = vaultFixture(); const value = plan({ externalResearch: [external()] }); const before = JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item); await materializeFeuilProjectImport(state.app, value, "Imports/Roman"); assert.equal(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? [...item] : item), before); });
test("échec createBinary envoie la destination à trashFile", async () => { const state = vaultFixture({ failBinary: true }); await assert.rejects(() => materializeFeuilProjectImport(state.app, plan(), "Imports/Roman")); assert.deepEqual(state.trashed, ["Imports/Roman"]); });
test("propage l’erreur d’écriture si le rollback réussit", async () => { const state = vaultFixture({ failBinary: true }); await assert.rejects(() => materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"), /binary failure/); });
test("signale explicitement un rollback en échec", async () => { const state = vaultFixture({ failBinary: true, failTrash: true }); await assert.rejects(() => materializeFeuilProjectImport(state.app, plan(), "Imports/Roman"), (error) => error instanceof FeuilProjectImportError && error.message.includes("Imports/Roman") && error.originalError instanceof Error); });
