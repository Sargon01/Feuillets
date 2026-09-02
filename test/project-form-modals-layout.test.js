import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const root = process.cwd();
const projectSource = fs.readFileSync(`${root}/src/ui/project-modals.ts`, "utf8");
const scrivenerSource = fs.readFileSync(`${root}/src/ui/scrivener-import-modal.ts`, "utf8");
const styles = fs.readFileSync(`${root}/styles.css`, "utf8");

function methodSource(source, start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

test("NewProjectModal utilise la grammaire verticale commune", () => {
  const modal = methodSource(projectSource, "export class NewProjectModal", "export class OpenExistingFolderModal");
  assert.match(modal, /feuillets-new-project-modal/);
  assert.doesNotMatch(modal, /feuillets-project-modal/);
  assert.match(modal, /feuillets-feuil-import-intro/);
  assert.match(modal, /feuillets-feuil-import-form/);
  assert.equal((modal.match(/createField\(t\("modal\.newProject\.(?:nameLabel|authorLabel|parentFolderLabel|typeLabel)"\)\)/g) || []).length, 4);
  assert.match(modal, /t\("shared\.cancel"\)/);
  assert.match(modal, /t\("modal\.newProject\.createAndActivate"\)/);
  assert.match(modal, /nameInput\.focus\(\)/);
});

test("Scrivener conserve le drop, le ZIP et le workflow d'analyse", () => {
  const form = methodSource(scrivenerSource, "showForm(): void", "showPreview(ctx: ImportContext)");
  assert.match(form, /feuillets-scrivener-import-modal/);
  assert.doesNotMatch(form, /contentEl\.addClass\("feuillets-project-modal"\)/);
  assert.match(form, /feuillets-feuil-import-intro/);
  assert.match(form, /feuillets-feuil-import-form/);
  assert.match(form, /feuillets-drop-target/);
  assert.match(form, /dragover/);
  assert.match(form, /dragleave/);
  assert.match(form, /drop/);
  assert.match(form, /accept: "\.zip,\.scriv\.zip"/);
  assert.match(form, /feuillets-feuil-import-file-input/);
  assert.match(form, /zipInput\.click\(\)/);
  assert.match(form, /buildScrivenerImportPlan|showPreview\(/);
  assert.match(form, /t\("shared\.cancel"\)/);
});

test("les petites modales partagent uniquement la largeur et les champs validés", () => {
  const importStyles = styles.slice(styles.indexOf("/* ===== Import projet .feuil ===== */"));
  assert.match(importStyles, /\.feuillets-feuil-import-modal,\s*\.feuillets-new-project-modal,\s*\.feuillets-scrivener-import-modal/);
  assert.match(importStyles, /\.feuillets-feuil-import-field > input\[type="text"\],\s*\.feuillets-feuil-import-field > select/);
  assert.doesNotMatch(importStyles, /\.theme-light|\.theme-dark|\.minimal-theme/);
});
