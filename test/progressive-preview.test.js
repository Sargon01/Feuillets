import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { PreviewView } from "../src/views/preview-view.js";
import { createFakeVault } from "./helpers/fake-vault.js";

function fixture(wordCounts) {
  const root = new TFolder("Roman/Manuscrit");
  const files = wordCounts.map((count, index) => new TFile(
    `${root.path}/${index + 1}.md`,
    "mot ".repeat(count)
  ));
  root.children = files;
  for (const file of files) file.parent = root;
  const { vault } = createFakeVault([root, ...files]);
  vault.cachedRead = async (file) => file.content;
  const view = Object.create(PreviewView.prototype);
  view.app = { vault, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  view.plugin = { settings: { projectFolder: root.path, orders: {}, folderPositions: {}, compileFileName: "Manuscrit.md" } };
  const reads = [];
  view.readFileForPreview = async (file) => {
    reads.push(file.path);
    return file.content;
  };
  return { root, files, view, reads };
}

test("aperçu progressif : conserve les feuillets entiers, l'ordre et cesse de lire dès le seuil", async () => {
  const { root, files, view, reads } = fixture([20_000, 16_000, 50_000]);

  const scope = await view.progressivePreviewScope({ type: "project", projectRoot: root.path });

  assert.deepEqual(scope, { type: "selection", projectRoot: root.path, paths: [files[0].path, files[1].path] });
  assert.deepEqual(reads, [files[0].path, files[1].path]);
});

test("aperçu progressif : les petites portées et une portée file restent à une seule passe", async () => {
  const { root, files, view, reads } = fixture([20_000, 14_000]);

  assert.equal(await view.progressivePreviewScope({ type: "project", projectRoot: root.path }), null);
  assert.deepEqual(reads, [files[0].path, files[1].path]);
  assert.equal(await view.progressivePreviewScope({ type: "file", projectRoot: root.path, path: files[0].path }), null);
});
