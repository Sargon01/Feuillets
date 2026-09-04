import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = fs.existsSync(path.join(testDir, "../src/views/base-feuillets-view.ts"))
  ? path.join(testDir, "../src/views/base-feuillets-view.ts")
  : path.join(testDir, "../../src/views/base-feuillets-view.ts");
const source = fs.readFileSync(sourcePath, "utf8");

test("Ajouter une rubrique propose les catégories Research absentes dans un ordre fixe", () => {
  const menuBlock = source.slice(source.indexOf('const newFolderBtn = this.iconBtn(toolbar, "folder-plus"'), source.indexOf("    const sourcesFolder =", source.indexOf('const newFolderBtn = this.iconBtn(toolbar, "folder-plus"')));
  assert.match(menuBlock, /const standardKeys = \[\s*"personnages",\s*"lieux",\s*"evenements",\s*"codex",\s*"glossaire",\s*"notes",\s*"sources",\s*"bibliographie",\s*\]/s);
  assert.match(source, /const rf = RESEARCH_FOLDERS;/);
  assert.match(menuBlock, /researchFolderLabel\(rf, key\)/);
  assert.match(menuBlock, /findResearchCategoryFolder\(baseResearch, rf, key\)/);
  assert.match(menuBlock, /ensureResearchCategoryFolder\(baseResearch, rf, key\)/);
  assert.match(menuBlock, /menu\.addSeparator\(\)/);
  assert.match(menuBlock, /shared\.research\.customSection/);
  assert.match(menuBlock, /this\.plugin\.newFolder\(folder\)/);
  assert.doesNotMatch(menuBlock, /fiction|nonfiction|free/);
});
