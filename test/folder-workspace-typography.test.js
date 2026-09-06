import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const workspaceSource = read("src/services/folder-workspaces.ts");
const mainSource = read("src/main.ts");
const modalSource = read("src/ui/folder-workspace-modal.ts");
const continuSource = read("src/views/scrivenings-view.ts");

test("les sept réglages typographiques ont un résolveur workspace", () => {
  for (const name of [
    "workspaceIndentParagraphs",
    "workspaceLiveJustify",
    "workspaceLiveEmptyLines",
    "workspaceLiveHyphenation",
    "workspaceReadingFontSize",
    "workspaceLineHeight",
    "workspaceTextWidth",
  ]) assert.match(workspaceSource, new RegExp("export function " + name));
});

test("Markdown actif et Continu réappliquent la typographie effective", () => {
  assert.match(mainSource, /workspaceLiveEmptyLines\(this\.app, S, folder\)/);
  assert.match(mainSource, /workspaceLiveHyphenation\(this\.app, S, folder\)/);
  assert.match(mainSource, /workspaceLiveJustify\(this\.app, S, folder\)/);
  assert.match(mainSource, /workspaceReadingFontSize\(this\.app, S, folder\)/);
  assert.match(mainSource, /workspaceLineHeight\(this\.app, S, folder\)/);
  assert.match(mainSource, /workspaceTextWidth\(this\.app, S, folder\)/);
  assert.match(mainSource, /workspaceIndentParagraphs\(this\.app, this\.settings, folder\)/);
  assert.match(continuSource, /refreshHostTypography/);
});

test("la modale expose une section Typographie avec reset local", () => {
  assert.match(modalSource, /modal\.folderWorkspace\.typography/);
  assert.match(modalSource, /renderTypographyToggle/);
  assert.match(modalSource, /renderTypographyNumber/);
  assert.match(modalSource, /addResetButton/);
});
