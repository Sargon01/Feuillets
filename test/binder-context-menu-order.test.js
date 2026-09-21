import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/views/base-feuillets-view.ts"), "utf8");
const binderSource = readFileSync(resolve(process.cwd(), "src/views/feuillets-view.ts"), "utf8");

function methodBody(sourceText, signature, nextSignature) {
  const start = sourceText.indexOf(signature);
  const end = sourceText.indexOf(nextSignature, start);
  assert.notEqual(start, -1, `${signature} must exist`);
  assert.notEqual(end, -1, `${nextSignature} must exist`);
  return sourceText.slice(start, end);
}

function assertOrder(body, markers) {
  let previous = -1;
  for (const marker of markers) {
    const position = body.indexOf(marker);
    assert.notEqual(position, -1, `missing menu marker: ${marker}`);
    assert.ok(position > previous, `${marker} must follow the previous menu item`);
    previous = position;
  }
}

test("Binder file context menu keeps the requested functional order", () => {
  const body = methodBody(source, "showFileContextMenu(", "showFolderContextMenu(");
  assertOrder(body, [
    't("shared.openNewTab")',
    't("shared.contextMenu.openWithPreview")',
    't("binder.research.openSplit")',
    't("binder.research.compareWith")',
    't("shared.contextMenu.addToNotebook")',
    't("shared.contextMenu.newSheetMenu")',
    't("shared.contextMenu.changeStatusMenu")',
    't("shared.contextMenu.changeLabelMenu")',
    't("binder.research.associatedResearchMenu")',
    't("shared.contextMenu.rename")',
    't("shared.contextMenu.move")',
    't("shared.duplicate")',
    't("shared.contextMenu.versions")',
    't("binder.compileFile")',
    't("shared.trash")',
  ]);
  assert.match(body, /promptRenameBinderFile\(file\)/);
  assert.match(body, /addFileToNotebook\(file\)/);
  assert.match(body, /moveSceneFile\(file\)/);
});

test("Binder folder context menu keeps workspace, metadata and destructive groups ordered", () => {
  const body = methodBody(source, "showFolderContextMenu(", "constructor(leaf");
  assertOrder(body, [
    't("shared.contextMenu.openWithPreview")',
    'extraItems?.(menu)',
    'this.addFolderCarnetMenuItem(menu, folder)',
    't("shared.contextMenu.openFolderNote")',
    't("shared.contextMenu.newMenu")',
    't("shared.contextMenu.changeStatusMenu")',
    't("shared.contextMenu.changeLabelMenu")',
    't("binder.research.associatedResearchMenu")',
    't("shared.contextMenu.renameFolder")',
    't("shared.contextMenu.organizationMenu")',
    't("shared.contextMenu.compilationMenu")',
    't("shared.contextMenu.trashFolder")',
  ]);
  assert.match(body, /promptRenameBinderFolder\(folder\)/);
  assert.match(binderSource, /this\.continuExtras\(child\)\(menu\);\s*menu\.addSeparator\(\);\s*this\.binderIsolateExtras\(child\)\(menu\)/s);
});

test("Binder menu labels use the normalized compilation and trash vocabulary", () => {
  const fr = readFileSync(resolve(process.cwd(), "src/i18n/fr.ts"), "utf8");
  const en = readFileSync(resolve(process.cwd(), "src/i18n/en.ts"), "utf8");
  assert.match(fr, /"binder\.compileFile": "Compiler ce feuillet…"/);
  assert.match(en, /"binder\.compileFile": "Compile this sheet…"/);
  assert.match(fr, /"shared\.contextMenu\.trashFolder": "Mettre à la corbeille"/);
  assert.match(en, /"shared\.contextMenu\.trashFolder": "Move to trash"/);
});

/* Le statut d'ouvrage n'est plus une entrée du menu contextuel Binder — voir
 * test/folder-workspace-modal.test.js pour son option dans la modale
 * « Configurer cet espace de travail… » (services/editorial-roots.ts). */
test("Binder folder context menu : le menu contextuel ne propose plus d'entrée ouvrage", () => {
  assert.doesNotMatch(binderSource, /binderOuvrageExtras/);
  assert.doesNotMatch(binderSource, /binder\.defineAsOuvrage/);
  assert.doesNotMatch(binderSource, /binder\.removeOuvrageStatus/);
});
