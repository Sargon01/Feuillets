import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(`${process.cwd()}/src/ui/project-modals.ts`, "utf8");

test("le formulaire principal ne contient plus les réglages de citation ni de type", () => {
  const row = source.slice(source.indexOf("renderProjectRow("), source.indexOf("private renderProjectCitationsPage"));
  const description = row.indexOf('t("modal.manageProjects.descriptionField")');
  const type = row.indexOf('t("modal.manageProjects.typeField")');
  assert.equal(type, -1, "Le gestionnaire n'affiche plus de sélecteur de type");
  assert.ok(description >= 0, "Description reste présente");
  assert.doesNotMatch(row, /pandocCitationPreview|citationStyle\.name/);
});

test("Configuration route Objectifs et Citations avant Métadonnées", () => {
  const nav = source.slice(source.indexOf("private renderProjectNavRows"));
  const configuration = nav.indexOf('t("modal.manageProjects.configurationHeader")');
  const goals = nav.indexOf('t("sidebar.project.rowGoals")'), citations = nav.indexOf('t("modal.manageProjects.citationsAndBibliography")');
  const metadata = nav.indexOf('t("sidebar.project.metadataHeader")');
  assert.ok(configuration < goals && goals < citations && citations < metadata);
  assert.match(source, /mkNavRow\("quote", t\("modal\.manageProjects\.citationsAndBibliography"\), "citations"\)/);
});

test("la sous-page Citations conserve les propriétés métier existantes", () => {
  const page = source.slice(source.indexOf("private renderProjectCitationsPage"), source.indexOf("private renderProjectNavRows"));
  assert.match(page, /citationStyle/);
  assert.match(page, /pandocCitationPreviewStyle/);
  assert.match(page, /pandocBibliographyPath/);
  assert.doesNotMatch(page, /resolveType\(meta\(\)\?\.type\) === "nonfiction"/);
  assert.match(page, /settings\.citationStyle\.name/);
  assert.doesNotMatch(page, /this\.render\(|this\.renderCurrentDetailContent\(|this\.requestRender\(/);
});

test("le choix d'un dossier existant est un champ local avec une action partagée", () => {
  assert.match(source, /feuillets-project-existing-folder/);
  assert.match(source, /t\("binder\.projectManager\.addExisting"\)/);
  assert.match(source, /type: "text"/);
  assert.match(source, /new FolderSuggest\(this\.app, input\)/);
  assert.match(source, /const useExistingFolder = async \(\): Promise<void> =>/);
  assert.match(source, /void useExistingFolder\(\)/);
  assert.match(source, /t\("modal\.openFolder\.pickBtn"\)/);
  assert.doesNotMatch(source, /feuillets-properties-add-row/);
});

test("les quatre actions de la toolbar du gestionnaire sont conservées", () => {
  const render = source.slice(source.indexOf("render(): void"), source.indexOf("private renderCurrentDetailContent"));
  assert.equal((render.match(/this\.iconBtn\(actions/g) || []).length, 4);
});
