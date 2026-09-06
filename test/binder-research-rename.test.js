import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const baseSource = readFileSync("src/views/base-feuillets-view.ts", "utf8");
const binderSource = readFileSync("src/views/feuillets-view.ts", "utf8");
const boardSource = readFileSync("src/views/board-view.ts", "utf8");
const modalSource = readFileSync("src/ui/basic-modals.ts", "utf8");

test("Recherche expose une création et un renommage pour les vrais dossiers", () => {
  assert.match(baseSource, /promptCreateResearchFileInFolder\(folder\)/);
  assert.match(baseSource, /promptRenameResearchFolder\(folder\)/);
  assert.match(baseSource, /setTitle\(t\("shared\.contextMenu\.rename"\)\)/);
  assert.match(baseSource, /renderSection\(\s*groupBody[\s\S]*?promptCreateResearchFileInFolder\(folder\)/);
  assert.match(baseSource, /renderResearchSubfolder[\s\S]*?iconBtn\(header, "plus"/);
});

test("le renommage Binder TFile est explicitement réservé à FeuilletsView", () => {
  assert.match(modalSource, /class RenameBinderItemModal extends Modal/);
  assert.match(modalSource, /feuillets-project-modal/);
  assert.match(modalSource, /feuillets-modal-title-row/);
  assert.match(modalSource, /new Setting\(parent\)/);
  assert.match(modalSource, /cls: "mod-cta"/);
  assert.match(modalSource, /modal\.renameBinder\.titleLabel/);
  assert.match(modalSource, /modal\.renameBinder\.binderTitleLabel/);
  assert.match(modalSource, /modal\.renameBinder\.fileNameLabel/);
  assert.match(baseSource, /showFileContextMenu\([^\n]+binderRename = false/);
  assert.match(binderSource, /showFileContextMenu\(e, file, parent, i, siblings, true\)/);
  assert.doesNotMatch(boardSource, /showFileContextMenu\([^\n]+, true\)/);
});

test("le renommage Binder écrit les clés canoniques sans toucher à la compilation", () => {
  assert.match(baseSource, /fm\.title = values\.title\.trim\(\)/);
  assert.match(baseSource, /fm\.short_title = values\.binderTitle\.trim\(\)/);
  assert.match(baseSource, /delete fm\.titre_binder/);
  assert.match(baseSource, /fileManager\.renameFile\(file, nextPath\)/);
  assert.match(baseSource, /shortTitleFor\(file\)/);
  assert.doesNotMatch(baseSource, /compiledTitleFor\(file\)/);
});
