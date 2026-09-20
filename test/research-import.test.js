import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TFile, TFolder } from "obsidian";
import {
  importFilesIntoResearchFolder,
  splitImportedFileName,
  researchImportAccept,
} from "../src/services/research-import.js";
import { researchAcceptedExtensions, isExcalidrawMarkdownFile } from "../src/services/research.js";

/* Local fake app/vault, byte-exact — same convention as
   feuil-project-import.test.js: createBinary captures `data` as a real
   Uint8Array copy on a fake TFile, so tests can assert on exact bytes
   instead of trusting a lossy string-based stand-in. */
function createFakeApp() {
  const entries = new Map();
  const createBinaryCalls = [];
  const deletions = [];
  const trashed = [];
  const app = {
    vault: {
      getAbstractFileByPath(path) {
        return entries.has(path) ? entries.get(path) : null;
      },
      async createBinary(path, data) {
        if (entries.has(path)) throw new Error(`Fake vault: path already exists: ${path}`);
        const bytes = new Uint8Array(data);
        const file = { path, bytes };
        entries.set(path, file);
        createBinaryCalls.push(path);
        return file;
      },
      async delete(file) {
        deletions.push(file.path);
        entries.delete(file.path);
      },
      async trashFile(file) {
        trashed.push(file.path);
        entries.delete(file.path);
      },
    },
  };
  return { app, entries, createBinaryCalls, deletions, trashed };
}

function toArrayBuffer(byteValues) {
  return new Uint8Array(byteValues).buffer;
}

/** Fake selected file — the structural subset of the DOM File type
   ImportableFile actually needs, plus instrumentation for the sequential-
   processing test below. */
function fakeSelectedFile(name, byteValues, options = {}) {
  const { onRead, delayMs = 0 } = options;
  return {
    name,
    async arrayBuffer() {
      onRead?.("start");
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      onRead?.("end");
      return toArrayBuffer(byteValues);
    },
  };
}

/* ==================== 1. exact byte preservation ==================== */

test("imports a binary file with the exact original bytes, unchanged", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  const bytes = [0, 255, 4, 128, 1, 254];
  const summary = await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("photo.png", bytes)]);

  assert.equal(summary.imported, 1);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.failed, 0);
  const written = entries.get("Research/Documents/photo.png");
  assert.ok(written);
  assert.deepEqual([...written.bytes], bytes);
});

/* ==================== 2/3. multiple files, sequential ==================== */

test("imports several files in one call", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  const summary = await importFilesIntoResearchFolder(app, folder, [
    fakeSelectedFile("a.pdf", [1]),
    fakeSelectedFile("b.docx", [2]),
    fakeSelectedFile("c.md", [3]),
  ]);

  assert.equal(summary.imported, 3);
  assert.ok(entries.has("Research/Documents/a.pdf"));
  assert.ok(entries.has("Research/Documents/b.docx"));
  assert.ok(entries.has("Research/Documents/c.md"));
});

test("processes files strictly sequentially — never more than one arrayBuffer() read in flight at once", async () => {
  const { app } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  let active = 0;
  let maxActive = 0;
  const onRead = (phase) => {
    if (phase === "start") {
      active++;
      maxActive = Math.max(maxActive, active);
    } else {
      active--;
    }
  };
  const files = [
    fakeSelectedFile("a.pdf", [1], { onRead, delayMs: 5 }),
    fakeSelectedFile("b.pdf", [2], { onRead, delayMs: 5 }),
    fakeSelectedFile("c.pdf", [3], { onRead, delayMs: 5 }),
  ];

  const summary = await importFilesIntoResearchFolder(app, folder, files);

  assert.equal(summary.imported, 3);
  assert.equal(maxActive, 1, "at most one file must be read into memory at a time");
});

/* ==================== 4. every supported extension ==================== */

test("accepts every extension Research recognizes (researchAcceptedExtensions)", async () => {
  const extensions = researchAcceptedExtensions();
  assert.ok(extensions.length > 0);
  for (const extension of extensions) {
    const { app, entries } = createFakeApp();
    const folder = new TFolder("Research/Documents");
    const name = `sample.${extension}`;
    const summary = await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile(name, [7])]);
    assert.equal(summary.imported, 1, `.${extension} must be imported`);
    assert.equal(summary.skipped, 0, `.${extension} must not be skipped`);
    assert.ok(entries.has(`Research/Documents/${name}`), `.${extension} must land at the expected path`);
  }
});

test("the file-picker accept attribute lists every recognized extension with a leading dot", () => {
  const accept = researchImportAccept();
  const parts = accept.split(",");
  for (const extension of researchAcceptedExtensions()) {
    assert.ok(parts.includes(`.${extension}`), `accept must include .${extension}`);
  }
});

/* ==================== 5. clean rejection of unsupported extensions ==================== */

test("ignores unsupported extensions and counts them as skipped, never imported or failed", async () => {
  const { app, entries, createBinaryCalls } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  const summary = await importFilesIntoResearchFolder(app, folder, [
    fakeSelectedFile("archive.zip", [1]),
    fakeSelectedFile("app.exe", [2]),
    fakeSelectedFile("no-extension", [3]),
  ]);

  assert.equal(summary.imported, 0);
  assert.equal(summary.skipped, 3);
  assert.equal(summary.failed, 0);
  assert.equal(createBinaryCalls.length, 0, "an unsupported file must never reach vault.createBinary");
  assert.equal(entries.size, 0);
});

/* ==================== 6. collision without overwrite ==================== */

test("never overwrites an existing file — numbers the collision instead", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  entries.set("Research/Documents/Rapport.docx", { path: "Research/Documents/Rapport.docx", bytes: new Uint8Array([9, 9, 9]) });

  const summary = await importFilesIntoResearchFolder(app, folder, [
    fakeSelectedFile("Rapport.docx", [1, 1, 1]),
    fakeSelectedFile("Rapport.docx", [2, 2, 2]),
  ]);

  assert.equal(summary.imported, 2);
  assert.deepEqual([...entries.get("Research/Documents/Rapport.docx").bytes], [9, 9, 9], "the pre-existing file must never be overwritten");
  assert.ok(entries.has("Research/Documents/Rapport 2.docx"));
  assert.deepEqual([...entries.get("Research/Documents/Rapport 2.docx").bytes], [1, 1, 1]);
  assert.ok(entries.has("Research/Documents/Rapport 3.docx"));
  assert.deepEqual([...entries.get("Research/Documents/Rapport 3.docx").bytes], [2, 2, 2]);
});

/* ==================== BibTeX (.bib) : byte-exact import + collision ==================== */

test("imports a .bib file with the exact original bytes, unchanged", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  const bytes = [37, 64, 97, 114, 116, 105, 99, 108, 101]; // "%@article" as raw bytes
  const summary = await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("Bibliographie.bib", bytes)]);

  assert.equal(summary.imported, 1);
  const written = entries.get("Research/Documents/Bibliographie.bib");
  assert.ok(written);
  assert.deepEqual([...written.bytes], bytes);
});

test("a colliding Bibliographie.bib numbers the collision without overwriting the original", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  entries.set("Research/Documents/Bibliographie.bib", { path: "Research/Documents/Bibliographie.bib", bytes: new Uint8Array([9, 9]) });

  const summary = await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("Bibliographie.bib", [1, 2])]);

  assert.equal(summary.imported, 1);
  assert.deepEqual([...entries.get("Research/Documents/Bibliographie.bib").bytes], [9, 9], "the pre-existing .bib file must never be overwritten");
  assert.ok(entries.has("Research/Documents/Bibliographie 2.bib"));
  assert.deepEqual([...entries.get("Research/Documents/Bibliographie 2.bib").bytes], [1, 2]);
});

/* ==================== 7. .excalidraw.md collision ==================== */

test("a colliding Dessin.excalidraw.md still resolves to a name recognized as an Excalidraw drawing", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  entries.set("Research/Documents/Dessin.excalidraw.md", { path: "Research/Documents/Dessin.excalidraw.md", bytes: new Uint8Array([0]) });

  const summary = await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("Dessin.excalidraw.md", [1, 2, 3])]);

  assert.equal(summary.imported, 1);
  const createdPath = [...entries.keys()].find((path) => path !== "Research/Documents/Dessin.excalidraw.md");
  assert.equal(createdPath, "Research/Documents/Dessin.excalidraw 2.md");
  assert.equal(isExcalidrawMarkdownFile(new TFile(createdPath)), true);
});

/* ==================== 8. name and extension preservation ==================== */

test("preserves the original name and extension exactly when there is no collision", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("Notes de terrain.PDF", [1])]);
  assert.ok(entries.has("Research/Documents/Notes de terrain.PDF"), "case and spacing of the extension must be preserved as-is");
});

test("splitImportedFileName splits on the last dot, like Obsidian's own basename/extension convention", () => {
  assert.deepEqual(splitImportedFileName("Report.docx"), { baseName: "Report", extension: "docx" });
  assert.deepEqual(splitImportedFileName("Dessin.excalidraw.md"), { baseName: "Dessin.excalidraw", extension: "md" });
  assert.deepEqual(splitImportedFileName("no-extension"), { baseName: "no-extension", extension: "" });
  assert.deepEqual(splitImportedFileName(".hidden"), { baseName: ".hidden", extension: "" });
});

/* ==================== 9/10/11. correct destination per surface ==================== */

test("copies into the exact folder that was clicked — main Research section", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research");
  await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("note.md", [1])]);
  assert.ok(entries.has("Research/note.md"));
});

test("copies into the exact folder that was clicked — a Research subfolder", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Characters/Main");
  await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("note.md", [1])]);
  assert.ok(entries.has("Research/Characters/Main/note.md"));
});

test("copies into the exact folder that was clicked — a linked external Research folder", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Elsewhere/Documentary Folder");
  await importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("note.md", [1])]);
  assert.ok(entries.has("Elsewhere/Documentary Folder/note.md"));
});

/* ==================== 13. partial success on a per-file failure ==================== */

test("a failure on one file never cancels already-succeeded imports, and later files are still attempted", async () => {
  const { app, entries } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  const failing = {
    name: "broken.pdf",
    arrayBuffer: async () => { throw new Error("read failed"); },
  };

  const summary = await importFilesIntoResearchFolder(app, folder, [
    fakeSelectedFile("first.pdf", [1]),
    failing,
    fakeSelectedFile("third.pdf", [3]),
  ]);

  assert.equal(summary.imported, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skipped, 0);
  assert.ok(entries.has("Research/Documents/first.pdf"));
  assert.ok(entries.has("Research/Documents/third.pdf"));
  assert.equal(entries.has("Research/Documents/broken.pdf"), false);
});

/* ==================== 15/16. no auto-open, no touching the source ==================== */

test("never opens a leaf or workspace API — the fake app has none and nothing throws", async () => {
  const { app } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  // `app` above deliberately exposes only `vault`: any attempt to open a
  // file (which would need `app.workspace`) would throw immediately.
  await assert.doesNotReject(() => importFilesIntoResearchFolder(app, folder, [fakeSelectedFile("a.pdf", [1])]));
});

test("never deletes, trashes, or otherwise mutates the source file objects", async () => {
  const { app, deletions, trashed } = createFakeApp();
  const folder = new TFolder("Research/Documents");
  const source = fakeSelectedFile("a.pdf", [1, 2, 3]);
  const nameBefore = source.name;

  await importFilesIntoResearchFolder(app, folder, [source]);

  assert.equal(source.name, nameBefore, "the source object must be left untouched");
  assert.equal(deletions.length, 0);
  assert.equal(trashed.length, 0);
});

/* ==================== 18. no Node/Electron/FileSystemAdapter API ==================== */

test("research-import.ts uses only browser-safe Vault/File APIs — no Node fs, Electron, or FileSystemAdapter", () => {
  const raw = readFileSync(join(process.cwd(), "src/services/research-import.ts"), "utf8");
  // Audit real CODE, never prose: this file's own header comment names
  // every forbidden API on purpose, to explain why they are absent.
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  assert.doesNotMatch(code, /require\(\s*["']fs["']\s*\)/);
  assert.doesNotMatch(code, /from\s+["']fs["']/);
  assert.doesNotMatch(code, /from\s+["']node:fs["']/);
  assert.doesNotMatch(code, /from\s+["']electron["']/);
  assert.doesNotMatch(code, /require\(\s*["']electron["']\s*\)/);
  assert.doesNotMatch(code, /FileSystemAdapter/);
  assert.doesNotMatch(code, /:\s*any\b/, "no `: any` type annotation in this module");
  assert.doesNotMatch(code, /as\s+any\b/);
  assert.doesNotMatch(code, /@ts-ignore/);
  assert.doesNotMatch(code, /@ts-expect-error/);
  assert.doesNotMatch(code, /eslint-disable/);
  assert.match(code, /vault\.createBinary/, "must write through the high-level Vault API");
  assert.match(code, /arrayBuffer\(\)/, "must read through the standard File API");
});
