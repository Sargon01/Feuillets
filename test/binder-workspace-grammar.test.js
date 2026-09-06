import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const viewSource = fs.readFileSync(`${process.cwd()}/src/views/feuillets-view.ts`, "utf8");
const stylesSource = fs.readFileSync(`${process.cwd()}/styles.css`, "utf8");

test("la graisse Binder dépend uniquement de l'état aperçu", () => {
  assert.match(viewSource, /const previewExpanded\s*=\s*[\s\S]*?effectiveField !== "none"/);
  assert.match(viewSource, /item\.toggleClass\("feuillets-item-has-preview", previewExpanded\)/);
  assert.match(stylesSource, /\.feuillets-item\.feuillets-item-has-preview \.feuillets-item-name\s*\{[\s\S]*?font-weight:\s*var\(--font-semibold/);
  assert.doesNotMatch(stylesSource, /\.feuillets-binder-isolated \.feuillets-item-name\s*\{[\s\S]*?font-weight/);
  assert.match(stylesSource, /\.feuillets-list-pane \.feuillets-item \.feuillets-item-name\s*\{[\s\S]*?font-weight:\s*var\(--font-normal/);
});

test("l'en-tête isolé conserve le vrai nom et la capitalisation reste CSS", () => {
  assert.match(viewSource, /nameEl\.setText\(treeRoot\.name\)/);
  assert.doesNotMatch(viewSource, /treeRoot\.name\.toUpperCase\(\)/);
  assert.doesNotMatch(stylesSource, /\.feuillets-list > \.feuillets-tree-root \.feuillets-folder-name\.feuillets-isolation-current\s*\{[^}]*text-transform:\s*none/);
});

test("les recherches associées sont regroupées sous Espaces dans la double vue", () => {
  assert.match(viewSource, /t\("shared\.research\.workspaces"\)/);
  assert.match(viewSource, /renderRow\(container, t\("shared\.research\.workspaces"\), 0, true, "layers-3"\)/);
  assert.match(viewSource, /S\.collapsed\["binder:research-spaces"\]/);
  assert.match(viewSource, /const spacesBody = container\.createDiv\(\{ cls: "feuillets-binder-research-spaces-body" \}\)/);
  assert.match(viewSource, /renderLinkedFolder\(folder, spacesBody, 1\)/);
  assert.match(viewSource, /if \(!isCollapsed\) renderChildren\(folder, depth \+ 1, host\)/);
});

test("les racines liées à des dossiers Binder sortent du parcours naturel", () => {
  assert.match(viewSource, /node instanceof TFolder && node\.path\.startsWith\(`\$\{projectRoot\.path\}\/`\)/);
  assert.match(viewSource, /const workspaceResearchPaths = new Set\(/);
  assert.match(viewSource, /excludedRootPaths\.has\(child\.path\)/);
  assert.match(viewSource, /renderResearchSection\([\s\S]*workspaceResearchPaths,\s*workspaceResearchPaths\s*\)/);
  assert.match(viewSource, /if \(!workspaceResearchPaths\.has\(folder\.path\)\s*\|\|\s*folder\.path === researchRoot\.path\) return false/);
});

test("le groupe Espaces reste virtuel et conserve l'anti-doublon physique", () => {
  assert.match(viewSource, /const linkedPaths = new Set<string>\(\)/);
  assert.match(viewSource, /if \(linkedPaths\.has\(folder\.path\)\) return false/);
  assert.doesNotMatch(viewSource, /vault\.create\([^\n]*Espaces/);
  assert.doesNotMatch(viewSource, /folderManager\.rename[^\n]*Espaces/);
});
