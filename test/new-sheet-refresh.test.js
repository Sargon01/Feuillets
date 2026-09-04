import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { newSheet } from "../src/services/project-files.js";
import { NewSheetModal } from "../src/ui/basic-modals.js";

function setup(entries = []) {
  const folder = new TFolder("Projet/Manuscrit");
  folder.children = entries;
  const files = new Map(entries.map((entry) => [entry.path, entry]));
  const vault = {
    getAbstractFileByPath: (path) => files.get(path) || null,
    async create(path, content) {
      const file = new TFile(path);
      file.content = content;
      files.set(path, file);
      folder.children.push(file);
      return file;
    },
  };
  const opened = [];
  const app = {
    vault,
    workspace: {
      getLeaf: () => ({ openFile: async (file) => opened.push(file) }),
      setActiveLeaf: () => {},
    },
  };
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.projectFolder = "Projet";
  settings.projectMeta = { [folder.path]: { type: "fiction" } };
  return { app, folder, settings, opened };
}

async function submitNewSheet(fixture, onDone) {
  const originalOpen = NewSheetModal.prototype.open;
  let submit;
  NewSheetModal.prototype.open = function open() {
    submit = this.onSubmit;
    return this;
  };
  try {
    newSheet(fixture.app, fixture.settings, fixture.folder, onDone ? { onDone } : undefined);
    await submit("created", "Created");
  } finally {
    NewSheetModal.prototype.open = originalOpen;
  }
}

test("newSheet — création réussie rafraîchit une seule fois et ouvre le fichier", async () => {
  const fixture = setup();
  let refreshes = 0;
  await submitNewSheet(fixture, () => { refreshes += 1; });
  assert.equal(refreshes, 1);
  assert.equal(fixture.opened.length, 1);
  assert.equal(fixture.opened[0].path, "Projet/Manuscrit/created.md");
});

test("newSheet — fichier déjà existant ne rafraîchit ni n'ouvre", async () => {
  const existing = new TFile("Projet/Manuscrit/created.md");
  const fixture = setup([existing]);
  let refreshes = 0;
  await submitNewSheet(fixture, () => { refreshes += 1; });
  assert.equal(refreshes, 0);
  assert.equal(fixture.opened.length, 0);
});

test("newSheet — fonctionne sans callback de rafraîchissement", async () => {
  const fixture = setup();
  await submitNewSheet(fixture);
  assert.equal(fixture.opened.length, 1);
  assert.ok(fixture.opened[0] instanceof TFile);
});

test("newSheet — openCreatedFile false conserve le callback sans ouvrir", async () => {
  const fixture = setup();
  let refreshes = 0;
  const originalOpen = NewSheetModal.prototype.open;
  let submit;
  NewSheetModal.prototype.open = function open() {
    submit = this.onSubmit;
    return this;
  };
  try {
    newSheet(fixture.app, fixture.settings, fixture.folder, {
      onDone: () => { refreshes += 1; },
      openCreatedFile: false,
    });
    await submit("created", "Created");
  } finally {
    NewSheetModal.prototype.open = originalOpen;
  }
  assert.equal(refreshes, 1);
  assert.equal(fixture.opened.length, 0);
});
