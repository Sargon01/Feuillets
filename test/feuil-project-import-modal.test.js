import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = process.cwd();
const source = fs.readFileSync(`${root}/src/ui/feuil-project-import-modal.ts`, "utf8");
const styles = fs.readFileSync(`${root}/styles.css`, "utf8");
const fr = fs.readFileSync(`${root}/src/i18n/fr.ts`, "utf8");
const en = fs.readFileSync(`${root}/src/i18n/en.ts`, "utf8");

test("la modale d'import .feuil utilise une structure dédiée et verticale", () => {
  assert.match(source, /feuillets-feuil-import-modal/);
  assert.match(source, /feuillets-feuil-import-form/);
  assert.equal((source.match(/feuillets-feuil-import-field/g) || []).length, 3);
  assert.doesNotMatch(source, /feuillets-properties-row|feuillets-properties-key/);
  assert.match(source, /type: "file"[\s\S]*?accept: "\.feuil"/);
  assert.match(source, /feuillets-feuil-import-file-input/);
  assert.match(source, /type: "button", text: t\("feuil\.import\.chooseFile"\)/);
  assert.match(source, /fileNameEl\.setText\(t\("feuil\.import\.noFile"\)\)/);
});

test("les états du bouton Import et le libellé Annuler sont protégés", () => {
  assert.match(source, /t\("shared\.cancel"\)/);
  assert.doesNotMatch(source, /t\("common\.cancel"\)/);
  assert.match(source, /this\.busy \|\| this\.plan === null \|\| !this\.folderInput/);
  assert.match(source, /this\.folderInput\.addEventListener\("input", \(\) => this\.updateSubmitState\(\)\)/);
  assert.match(source, /detected\.setText\(""\)/);
});

test("l'UI du sélecteur de fichier reste strictement scoped", () => {
  assert.match(styles, /\.feuillets-feuil-import-modal(?:\s*,|\s*\{)/);
  assert.match(styles, /\.feuillets-feuil-import-file-input \{[\s\S]*?display: none;/);
  assert.match(styles, /\.feuillets-feuil-import-file-name \{[\s\S]*?text-overflow: ellipsis;/);
  assert.doesNotMatch(styles, /(?<!feuillets-feuil-import-)input\[type="file"\]/);
  assert.match(fr, /"feuil\.import\.chooseFile": "Choisir un fichier…"/);
  assert.match(en, /"feuil\.import\.chooseFile": "Choose a file…"/);
});
