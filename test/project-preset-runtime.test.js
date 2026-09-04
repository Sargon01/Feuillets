import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getResearchTemplate } from "../src/services/research-templates.js";

const sourceRoot = process.cwd();

function readSource(relativePath) {
  return fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");
}

function methodBody(source, methodStart, nextMethod) {
  const start = source.indexOf(methodStart);
  assert.notEqual(start, -1, `Méthode absente: ${methodStart}`);
  const end = source.indexOf(nextMethod, start + methodStart.length);
  return source.slice(start, end === -1 ? source.length : end);
}

function fallbackApp() {
  return { vault: { getAbstractFileByPath: () => null } };
}

test("G5 : les templates Research utilisent une signature sans type", async () => {
  const app = fallbackApp();
  const settings = { projectFolder: "" };

  const character = await getResearchTemplate(app, settings, "personnages", "Nouveau personnage");
  for (const field of ["last_name:", "first_name:", "birth:", "death:", "role:", "synopsis:"]) {
    assert.equal(character.split(field).length - 1, 1, field);
  }
  assert.match(character, /- personnage/);

  const place = await getResearchTemplate(app, settings, "lieux", "Nouveau lieu");
  assert.match(place, /title: "Nouveau lieu"/);
  assert.match(place, /description:/);
  assert.match(place, /- lieu/);

  const codex = await getResearchTemplate(app, settings, "codex", "Nouvel élément");
  assert.match(codex, /title: "Nouvel élément"/);
  assert.match(codex, /description:/);
  assert.match(codex, /- codex/);

  const event = await getResearchTemplate(app, settings, "evenements", "Nouvel événement");
  assert.match(event, /date:/);
  assert.match(event, /end_date:/);
  assert.match(event, /synopsis:/);
  assert.match(event, /- evenement/);
});

test("G5 : les templates Research n'ont plus de gate de preset", () => {
  const source = readSource("src/services/research-templates.ts");
  assert.doesNotMatch(source, /ResearchMode|yamlPreset|isFiction|mode\./);
  assert.match(source, /personnages:\s*\["Characters\.md", "Personnages\.md", "Acteurs\.md"\]/s);
  assert.match(source, /lieux:\s*\["Places\.md", "Lieux\.md", "Geographie\.md"\]/s);
  assert.match(source, /codex:\s*\["Lore\.md", "Concepts\.md"\]/s);
});

test("G5 : newSheetAt délègue le frontmatter à sheetFrontmatter", () => {
  const source = readSource("src/main.ts");
  const body = methodBody(source, "newSheetAt(", "  async activateSidebar");
  assert.match(body, /sheetFrontmatter\(\s*this\.app,\s*this\.settings,\s*chapTitle \|\| "",\s*0/s);
  assert.doesNotMatch(body, /getProjectMode|yamlPreset|isFiction|"synopsis: "|"summary: "/);
});

test("G5 : le gestionnaire ne modifie plus le preset du projet", () => {
  const source = readSource("src/ui/project-modals.ts");
  const manage = source.slice(source.indexOf("export class ManageProjectsModal"));
  assert.doesNotMatch(manage, /modal\.manageProjects\.typeField|S\.projectMeta\[path\]\.type\s*=|typeSelect\.value\s*=\s*resolveType\(meta\.type\)|resolveType\(/);

  const creation = source.slice(0, source.indexOf("export class ManageProjectsModal"));
  assert.match(creation, /modal\.newProject\.typeLabel/);
  assert.match(creation, /Object\.entries\(PROJECT_MODES\)/);
  const transform = source.slice(source.indexOf("export class TransformToProjectModal"), source.indexOf("export class ManageProjectsModal"));
  for (const expression of [
    "chosenMode",
    "planningFieldForProjectType(chosenMode)",
    "newSheetIncludeSourcesForProjectType(chosenMode)",
    "projectBoardDefaults(chosenMode)",
  ]) {
    assert.ok(transform.includes(expression), expression);
  }
});

test("G5 : le style de citation est disponible pour tous les projets", () => {
  const source = readSource("src/ui/project-modals.ts");
  const citations = methodBody(source, "private renderProjectCitationsPage(", "  private renderProjectNavRows(");
  for (const expression of [
    "settings.citationStyle.name",
    'addOption("footnote"',
    'addOption("parenthetical"',
    'citationStyle || "footnote"',
  ]) {
    assert.ok(citations.includes(expression), expression);
  }
  assert.doesNotMatch(citations, /resolveType|nonfiction/);
});
