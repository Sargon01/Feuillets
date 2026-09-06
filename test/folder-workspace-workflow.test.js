import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const baseSource = read("src/views/base-feuillets-view.ts");
const binderSource = read("src/views/feuillets-view.ts");
const boardSource = read("src/views/board-view.ts");
const tagsSource = read("src/ui/entity-modals.ts");
const mainSource = read("src/main.ts");

test("les contrôles fichier utilisent le dossier parent réel", () => {
  assert.match(baseSource, /workspaceStatuses\(this\.app, this\.plugin\.settings, file\.parent\)/);
  assert.match(baseSource, /this\.plugin\.labelColor\(current, file\.parent\)/);
  assert.match(tagsSource, /workspaceFavoriteTags\(this\.app, this\.plugin\.settings, this\.file\.parent\)/);
  assert.match(boardSource, /workspaceStatuses\(this\.app, S, file\.parent\)/);
  assert.match(boardSource, /this\.plugin\.labelColor\(label, file\.parent\)/);
});

test("les vues entières utilisent le workspace actif ou le manuscript root", () => {
  assert.match(binderSource, /workspaceStatuses\(this\.app, S, folder\)/);
  assert.match(binderSource, /workspaceLabels\(this\.app, S, folder\)/);
  assert.match(boardSource, /const workflowFolder = focusedFolder \|\| manuscriptRoot/);
  assert.match(boardSource, /workspaceStatuses\(this\.app, S, workflowFolder\)/);
  assert.match(boardSource, /workspaceLabels\(this\.app, S, workflowFolder\)/);
});

test("les couleurs de workflow passent par les palettes effectives", () => {
  assert.match(mainSource, /labelColor\(name: string, folder\?: TFolder \| null\)/);
  assert.match(mainSource, /getStatusColor\(name: string, folder\?: TFolder \| null\)/);
  assert.match(binderSource, /this\.plugin\.labelColor\(labelName, labelFolder\)/);
  assert.match(boardSource, /this\.plugin\.getStatusColor\(toValue\(fm\.status\), file\.parent\)/);
});
