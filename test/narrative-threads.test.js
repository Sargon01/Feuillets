import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { handleFilChanged } from "../src/services/narrative-threads.js";

test("handleFilChanged : plante puis résout un fil narratif", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout };
  test.after(() => {
    globalThis.window = previousWindow;
  });
  const volume = new TFolder("Projet");
  const manuscript = new TFolder("Projet/Manuscrit");
  const chapter = new TFolder("Projet/Manuscrit/Chapitre 1");
  const origin = new TFile("Projet/Manuscrit/Chapitre 1/Scène 1.md");
  const resolution = new TFile("Projet/Manuscrit/Chapitre 1/Scène 2.md");
  const last = new TFile("Projet/Manuscrit/Chapitre 1/Scène 3.md");
  volume.children = [manuscript];
  manuscript.parent = volume;
  manuscript.children = [chapter];
  chapter.parent = manuscript;
  chapter.children = [origin, resolution, last];
  origin.parent = chapter;
  resolution.parent = chapter;
  last.parent = chapter;

  const { vault, fileManager } = createFakeVault([volume, manuscript, chapter, origin, resolution, last]);
  const frontmatter = new Map([
    [origin.path, { thread: ["Intrigue"] }],
    [resolution.path, {}],
    [last.path, {}],
  ]);
  fileManager.processFrontMatter = async (file, callback) => callback(frontmatter.get(file.path));
  const app = {
    vault,
    fileManager,
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
    filPlaceholders: {},
    filOrigins: {},
    filResolved: [],
  };
  const plugin = { saveSettings: async () => {} };

  await handleFilChanged(app, settings, plugin, origin);
  assert.deepEqual(frontmatter.get(last.path).thread, ["Intrigue"]);
  assert.equal(settings.filPlaceholders.Intrigue, last.path);

  frontmatter.set(resolution.path, { thread: ["Intrigue"] });
  await handleFilChanged(app, settings, plugin, resolution);
  assert.equal(frontmatter.get(last.path).thread, undefined);
  assert.deepEqual(settings.filResolved, ["Intrigue"]);
});
