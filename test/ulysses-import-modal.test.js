import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { ulyssesStyleTextFromFile } from "../src/ui/ulysses-import-modal.js";

test("UlyssesImportModal : picker et dépôt alimentent le même import explicite", () => {
  const source = readFileSync(join(process.cwd(), "src/ui/ulysses-import-modal.ts"), "utf8");
  assert.match(source, /class UlyssesImportModal/);
  assert.match(source, /feuillets-ulysses-import-modal/);
  assert.doesNotMatch(source, /feuillets-ulysses-import-modal.*feuillets-project-modal/);
  assert.match(source, /dragenter/);
  assert.match(source, /dragover/);
  assert.match(source, /dragleave/);
  assert.match(source, /drop/);
  assert.match(source, /type: "file"/);
  assert.match(source, /accept: "\.ulstyle,\.ulss"/);
  assert.match(source, /feuillets-feuil-import-file-input/);
  assert.match(source, /feuillets-feuil-import-file-row/);
  assert.match(source, /fileInput\.click\(\)/);
  assert.match(source, /this\.selectedFile = file/);
  assert.match(source, /this\.importButton.*disabled/);
  assert.match(source, /arrayBuffer\(\)/);
  assert.match(source, /JSZip\.loadAsync/);
  assert.match(source, /importUlyssesStyleText/);
  assert.match(source, /t\("shared\.cancel"\)/);
  assert.match(source, /t\("editionLayout\.ulyssesImportAction"\)/);
  assert.doesNotMatch(source, /feuillets-ulysses-drop-zone/);
});

test("UlyssesImportModal : extensions valides et double soumission sont protégées", () => {
  const source = readFileSync(join(process.cwd(), "src/ui/ulysses-import-modal.ts"), "utf8");
  assert.match(source, /\/\\\.\(ulstyle\|ulss\)\$\/i\.test\(file\.name\)/);
  assert.match(source, /if \(this\.busy \|\| !this\.selectedFile\) return/);
  assert.match(source, /this\.chooseButton\.disabled = this\.busy/);
  assert.match(source, /this\.busy = false/);
});

test("UlyssesImportModal : un .ulstyle ZIP extrait Style.ulss, ou le premier ULSS", async () => {
  const named = new JSZip();
  named.file("Style.ulss", "defaults { font-size: 12pt }");
  const namedBytes = await named.generateAsync({ type: "arraybuffer" });
  assert.equal(await ulyssesStyleTextFromFile({ name: "Style.ulstyle", text: async () => "", arrayBuffer: async () => namedBytes }), "defaults { font-size: 12pt }");

  const nested = new JSZip();
  nested.file("Contents/Other.ulss", "defaults { font-size: 13pt }");
  const nestedBytes = await nested.generateAsync({ type: "arraybuffer" });
  assert.equal(await ulyssesStyleTextFromFile({ name: "Other.ulstyle", text: async () => "", arrayBuffer: async () => nestedBytes }), "defaults { font-size: 13pt }");
});

test("UlyssesImportModal : un .ulss texte reste lu directement", async () => {
  assert.equal(await ulyssesStyleTextFromFile({ name: "Style.ulss", text: async () => "defaults { font-size: 12pt }", arrayBuffer: async () => { throw new Error("inattendu"); } }), "defaults { font-size: 12pt }");
});

test("UlyssesImportModal : une archive sans ULSS signale clairement le problème", async () => {
  const zip = new JSZip();
  zip.file("readme.txt", "sans style");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  await assert.rejects(
    ulyssesStyleTextFromFile({ name: "Sans-style.ulstyle", text: async () => "", arrayBuffer: async () => bytes }),
    /ne contient aucun fichier ULSS/
  );
});

/* §7/§12 : l'ancien lanceur latéral EditionLayoutView a été supprimé — la
 * gestion des gabarits (et donc les imports) vit dans la barre d'outils du
 * mode Mise en page d'EditionWorkspaceContent. */
test("Mise en page : Importer Ulysses ouvre la modale sans input file", () => {
  const source = readFileSync(join(process.cwd(), "src/ui/edition-workspace-content.ts"), "utf8");
  assert.match(source, /new UlyssesImportModal/);
  assert.doesNotMatch(source, /type:\s*["']file/);
  assert.doesNotMatch(source, /fileInput/);
});
