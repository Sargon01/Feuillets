import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { generateCanvasBoard } from "../src/services/canvas-board.js";

test("generateCanvasBoard : crée les cartes de scènes et préserve leur position", async () => {
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const first = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md", "Première scène");
  const second = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md", "Seconde scène");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [first, second];
  first.parent = chapter;
  second.parent = chapter;

  const { vault } = createFakeVault([volume, manuscript, chapter, first, second]);
  const frontmatter = new Map([
    [first.path, { label: "Rouge", thread: "Intrigue" }],
    [second.path, { label: "Rouge", thread: "Intrigue" }],
  ]);
  const app = {
    vault,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatter.get(file.path) || {} };
      },
    },
  };
  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {},
    labels: [{ name: "Rouge", color: "#ff0000" }],
  };

  const firstRun = await generateCanvasBoard(app, settings);
  assert.equal(firstRun.added, 2);
  assert.equal(firstRun.edgesAdded, 1);

  const before = JSON.parse(await vault.read(firstRun.file));
  before.nodes[0].x = 777;
  await vault.modify(firstRun.file, JSON.stringify(before));

  const secondRun = await generateCanvasBoard(app, settings);
  const after = JSON.parse(await vault.read(secondRun.file));
  assert.equal(secondRun.added, 0);
  assert.equal(secondRun.edgesAdded, 1);
  assert.equal(after.nodes[0].x, 777);
});
