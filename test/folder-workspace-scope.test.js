import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = fs.existsSync(path.resolve(testDir, "../src/main.ts"))
  ? path.resolve(testDir, "../src")
  : path.resolve(testDir, "../../src");
const readSource = (relativePath) => fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");

test("le scope de travail est partagé et session-only", () => {
  const main = readSource("main.ts");
  const binder = readSource("views/feuillets-view.ts");
  const board = readSource("views/board-view.ts");

  assert.match(main, /workspaceFolderPath\?: string;/);
  assert.match(main, /getWorkspaceFolder\(\): TFolder \| null/);
  assert.match(main, /setWorkspaceFolder\(folder: TFolder\): void/);
  assert.match(main, /clearWorkspaceFolder\(\): void/);
  assert.match(main, /this\.workspaceFolderPath = undefined;\n    S\.projectFolder = path/);

  assert.doesNotMatch(binder, /_binderWorkingRootPath/);
  assert.match(binder, /this\.plugin\.getWorkspaceFolder\(\)/);
  assert.match(binder, /this\.plugin\.setWorkspaceFolder\(folder\)/);
  assert.match(binder, /this\.plugin\.clearWorkspaceFolder\(\)/);

  assert.doesNotMatch(board, /focusedFolderPath/);
  assert.match(board, /this\.plugin\.getWorkspaceFolder\(\)/);
  assert.match(board, /this\.plugin\.setWorkspaceFolder\(folder\)/);
  assert.match(board, /this\.plugin\.clearWorkspaceFolder\(\)/);
  assert.match(board, /meta\.boardWholeManuscript !== undefined/);
});

test("le setter rejette implicitement un dossier hors projet et ne persiste pas le scope", () => {
  const main = readSource("main.ts");
  const setterStart = main.indexOf("  setWorkspaceFolder(folder: TFolder): void {");
  const setterEnd = main.indexOf("\n  clearWorkspaceFolder(): void", setterStart);
  const setter = main.slice(setterStart, setterEnd);

  assert.notEqual(setterStart, -1);
  assert.notEqual(setterEnd, -1);
  assert.match(setter, /folder\.path\.startsWith\(`\$\{projectRoot\.path\}\/`\)/);
  assert.match(setter, /this\.workspaceFolderPath = inProject \? folder\.path : undefined/);
  assert.doesNotMatch(setter, /saveSettings|saveData|settings\./);
});
