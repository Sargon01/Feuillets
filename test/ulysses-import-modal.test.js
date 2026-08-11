import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { ulyssesStyleTextFromFile } from "../src/ui/ulysses-import-modal.js";

test("UlyssesImportModal : import exclusivement par dépôt HTML5, sans picker système", () => {
  const source = readFileSync(join(process.cwd(), "src/ui/ulysses-import-modal.ts"), "utf8");
  assert.match(source, /class UlyssesImportModal/);
  assert.match(source, /dragenter/);
  assert.match(source, /dragover/);
  assert.match(source, /dragleave/);
  assert.match(source, /drop/);
  assert.match(source, /arrayBuffer\(\)/);
  assert.match(source, /JSZip\.loadAsync/);
  assert.match(source, /importUlyssesStyleText/);
  assert.doesNotMatch(source, /type:\s*["']file/);
  assert.doesNotMatch(source, /\.click\(\)/);
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

test("EditionLayoutView : Importer Ulysses ouvre la modale sans input file", () => {
  const source = readFileSync(join(process.cwd(), "src/views/edition-layout-view.ts"), "utf8");
  assert.match(source, /new UlyssesImportModal/);
  assert.doesNotMatch(source, /type:\s*["']file/);
  assert.doesNotMatch(source, /fileInput/);
});
