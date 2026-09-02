import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = fs.existsSync(new URL("../src/ui/word-template-import-modal.ts", import.meta.url))
  ? new URL("..", import.meta.url).pathname.replace(/\/$/, "")
  : new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const source = fs.readFileSync(`${root}/src/ui/word-template-import-modal.ts`, "utf8");
const styles = fs.readFileSync(`${root}/styles.css`, "utf8");
const fr = fs.readFileSync(`${root}/src/i18n/fr.ts`, "utf8");
const en = fs.readFileSync(`${root}/src/i18n/en.ts`, "utf8");

test("la modale Word utilise le shell et les contrôles communs", () => {
  assert.match(source, /feuillets-word-template-import-modal/);
  assert.doesNotMatch(source, /feuillets-ulysses-import-modal|feuillets-ulysses-drop-zone/);
  assert.match(source, /feuillets-feuil-import-intro/);
  assert.match(source, /feuillets-feuil-import-form/);
  assert.match(source, /type: "file"[\s\S]*?accept: "\.docx,\.dotx,/);
  assert.match(source, /feuillets-feuil-import-file-input/);
  assert.match(source, /feuillets-feuil-import-file-row/);
  assert.match(source, /type: "button", text: t\("editionLayout\.wordChooseFile"\)/);
  assert.match(source, /t\("shared\.cancel"\)/);
  assert.match(source, /cls: "mod-cta"/);
});

test("la sélection et le drop ne lancent pas l'import automatiquement", () => {
  assert.match(source, /dropArea\.addEventListener\("dragover"/);
  assert.match(source, /dropArea\.addEventListener\("dragleave"/);
  assert.match(source, /dropArea\.addEventListener\("drop"/);
  assert.match(source, /void this\.selectFile\(event\.dataTransfer\?\.files\?\.\[0\] \|\| null\)/);
  assert.match(source, /fileInput\.addEventListener\("change", \(\) => \{ void this\.selectFile/);
  assert.match(source, /this\.selectedFile = file;/);
  const dropHandler = source.slice(source.indexOf('dropArea.addEventListener("drop"'), source.indexOf("const fileRow"));
  assert.doesNotMatch(dropHandler, /void this\.submit\(\)/);
});

test("le bouton Import est protégé contre les fichiers invalides et la double soumission", () => {
  assert.match(source, /!\/\\\.\(docx\|dotx\)\$\/i\.test\(file\.name\)/);
  assert.match(source, /this\.busy \|\| this\.selectedFile === null/);
  assert.match(source, /if \(this\.busy \|\| !this\.selectedFile\) return;/);
  assert.match(source, /this\.chooseButton\.disabled = this\.busy/);
  assert.match(source, /importWordTemplate\(/);
  assert.match(source, /await this\.plugin\.saveSettings\(\)/);
});

test("les styles Word restent scoped et les textes sont bilingues", () => {
  const wordStyles = styles.slice(styles.indexOf(".feuillets-word-template-import-modal"));
  assert.match(wordStyles, /\.feuillets-word-template-import-modal/);
  assert.match(fr, /"editionLayout\.wordChooseFile": "Choisir un fichier Word"/);
  assert.match(en, /"editionLayout\.wordChooseFile": "Choose a Word file"/);
});
