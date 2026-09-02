import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("src/ui/project-modals.ts", `file://${process.cwd()}/`), "utf8");

test("ManageProjectsModal conserve le DOM pour les éditions simples", () => {
  assert.match(source, /private detailContentEl: HTMLElement \| null = null;/);
  assert.match(source, /\(\) => this\.renderCurrentDetailContent\(\)/);
  assert.match(source, /private renderCurrentDetailContent\(\): void/);
  assert.match(source, /this\.detailContentEl = content;\s+this\.renderCurrentDetailContent\(\);/);
  assert.match(source, /S\.projectMeta\[path\]\.name = nameInput\.value\.trim\(\);[\s\S]*?this\.plugin\.renderAllViews\(true\);\s+name\.setText\(/);
  assert.match(source, /S\.projectMeta\[path\]\.type = typeSelect\.value;[\s\S]*?await this\.plugin\.saveSettings\(\);\s+renderCitationStyle\(\);/);
  assert.doesNotMatch(source, /this\.plugin\.renderAllViews\(true\);\s+this\.render\(\);/);
  assert.doesNotMatch(source, /await this\.plugin\.saveSettings\(\);\s+this\.render\(\);/);
});

test("Le changement de type ne reconstruit que le host du style de citation", () => {
  assert.match(source, /cls: "feuillets-project-grid feuillets-grid-full-row"/);
  assert.match(source, /citationStyleHost\.empty\(\);/);
  assert.match(source, /resolveType\(S\.projectMeta\[path\]\?\.type\) !== "nonfiction"/);
});
