import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("UlyssesImportModal : import exclusivement par dépôt HTML5, sans picker système", () => {
  const source = readFileSync(join(process.cwd(), "src/ui/ulysses-import-modal.ts"), "utf8");
  assert.match(source, /class UlyssesImportModal/);
  assert.match(source, /dragenter/);
  assert.match(source, /dragover/);
  assert.match(source, /dragleave/);
  assert.match(source, /drop/);
  assert.match(source, /file\.text\(\)/);
  assert.match(source, /importUlyssesStyleText/);
  assert.doesNotMatch(source, /type:\s*["']file/);
  assert.doesNotMatch(source, /\.click\(\)/);
});

test("EditionLayoutView : Importer Ulysses ouvre la modale sans input file", () => {
  const source = readFileSync(join(process.cwd(), "src/views/edition-layout-view.ts"), "utf8");
  assert.match(source, /new UlyssesImportModal/);
  assert.doesNotMatch(source, /type:\s*["']file/);
  assert.doesNotMatch(source, /fileInput/);
});
