import test from "node:test";
import assert from "node:assert/strict";
import { applyFeuilProjectImportSettings } from "../src/services/feuil-project-import-settings.js";

function settings() {
  return { projectFolder: "Ancien/Manuscrit", projects: [], projectMeta: {}, orders: { "Projet/old": ["x"], "Projet-ancien/x": ["keep"], "Autre/x": ["keep"] }, folderPositions: { "Projet/old": 1, "Projet-ancien/x": 2 }, folderGoals: { "Projet/old": 1, "Projet-ancien/x": 2 }, filPlaceholders: { legacy: "Ancien/a.md" }, filOrigins: { legacy: "Ancien/a.md" }, filResolved: ["legacy"], level1Role: "parties" };
}

function result(role = "chapitres", type) {
  return { projectRootPath: "Projet", manuscriptRootPath: "Projet/Manuscrit", externalResearchPaths: {}, settingsPatch: { projectRootPath: "Projet", manuscriptRootPath: "Projet/Manuscrit", projectMeta: { ...(type === undefined ? {} : { type }), title: "Import", researchFolderLinks: { "Projet/Manuscrit/A": "Projet/Recherche" } }, pathSettings: { orders: { Projet: ["Manuscrit"], "Projet/Chapitre": ["Scene"] }, folderPositions: { "Projet/Chapitre": 3 }, folderGoals: { "Projet/Chapitre": 500 } }, narrativeState: { placeholders: { fil: "Projet/Manuscrit/01.md" }, origins: { fil: "Projet/Manuscrit/01.md" }, resolved: ["fil"] }, structure: { level1Role: role } } };
}

test("ajoute le projet importé à projects", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.ok(value.projects.includes("Projet/Manuscrit")); });
test("n’ajoute aucun doublon projects", () => { const value = settings(); value.projects.push("Projet/Manuscrit"); applyFeuilProjectImportSettings(value, result()); assert.equal(value.projects.filter((path) => path === "Projet/Manuscrit").length, 1); });
test("conserve le projet actif précédent dans projects", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.ok(value.projects.includes("Ancien/Manuscrit")); });
test("ne modifie pas projectFolder", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.equal(value.projectFolder, "Ancien/Manuscrit"); });
test("stocke ProjectMeta sous manuscriptRootPath", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.equal(value.projectMeta["Projet/Manuscrit"].title, "Import"); });
test("importe un ProjectMeta legacy sans type comme Fiction", () => { const value = settings(); applyFeuilProjectImportSettings(value, result("chapitres")); assert.equal(value.projectMeta["Projet/Manuscrit"].type, "fiction"); });
test("préserve les types importés reconnus", () => { for (const type of ["free", "nonfiction"]) { const value = settings(); applyFeuilProjectImportSettings(value, result("chapitres", type)); assert.equal(value.projectMeta["Projet/Manuscrit"].type, type); } });
test("ne conserve pas de référence ProjectMeta du patch", () => { const value = settings(); const patch = result(); applyFeuilProjectImportSettings(value, patch); patch.settingsPatch.projectMeta.title = "Muté"; assert.equal(value.projectMeta["Projet/Manuscrit"].title, "Import"); });
test("stocke level1Role parties", () => { const value = settings(); applyFeuilProjectImportSettings(value, result("parties")); assert.equal(value.projectMeta["Projet/Manuscrit"].level1Role, "parties"); });
test("stocke level1Role chapitres", () => { const value = settings(); applyFeuilProjectImportSettings(value, result("chapitres")); assert.equal(value.projectMeta["Projet/Manuscrit"].level1Role, "chapitres"); });
test("la valeur globale level1Role reste inchangée", () => { const value = settings(); applyFeuilProjectImportSettings(value, result("chapitres")); assert.equal(value.level1Role, "parties"); });
test("stocke les placeholders narratifs dans ProjectMeta", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.equal(value.projectMeta["Projet/Manuscrit"].narrativeState.placeholders.fil, "Projet/Manuscrit/01.md"); });
test("stocke les origins narratifs dans ProjectMeta", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.equal(value.projectMeta["Projet/Manuscrit"].narrativeState.origins.fil, "Projet/Manuscrit/01.md"); });
test("copie les resolved narratifs", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.deepEqual(value.projectMeta["Projet/Manuscrit"].narrativeState.resolved, ["fil"]); });
test("laisse les globals narratifs inchangés", () => { const value = settings(); const before = JSON.stringify([value.filPlaceholders, value.filOrigins, value.filResolved]); applyFeuilProjectImportSettings(value, result()); assert.equal(JSON.stringify([value.filPlaceholders, value.filOrigins, value.filResolved]), before); });
test("applique les orders importés", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.deepEqual(value.orders.Projet, ["Manuscrit"]); });
test("applique les folderPositions importées", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.equal(value.folderPositions["Projet/Chapitre"], 3); });
test("applique les folderGoals importés", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.equal(value.folderGoals["Projet/Chapitre"], 500); });
test("supprime les anciennes clés du même projectRoot", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.equal("Projet/old" in value.orders, false); });
test("ne supprime pas la clé voisine Projet-ancien", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.deepEqual(value.orders["Projet-ancien/x"], ["keep"]); });
test("laisse les réglages d’un autre projet inchangés", () => { const value = settings(); applyFeuilProjectImportSettings(value, result()); assert.deepEqual(value.orders["Autre/x"], ["keep"]); });
test("les mutations ultérieures du patch n’affectent pas settings", () => { const value = settings(); const patch = result(); applyFeuilProjectImportSettings(value, patch); patch.settingsPatch.pathSettings.orders.Projet.push("Autre"); patch.settingsPatch.narrativeState.resolved.push("Autre"); assert.deepEqual(value.orders.Projet, ["Manuscrit"]); assert.deepEqual(value.projectMeta["Projet/Manuscrit"].narrativeState.resolved, ["fil"]); });
