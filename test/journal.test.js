import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { getDayEntry, journalEntryKeys, listDayEntries } from "../src/services/journal.js";

test("journal : liste et lit les notes quotidiennes", async () => {
  const root = new TFolder("Projet/Manuscrit");
  root.parent = new TFolder("Projet");
  const journal = new TFolder("Projet/Journal", [
    new TFile("Projet/Journal/2026-01-03.md", "---\ndate: 2026-01-03\n---\nTroisième."),
    new TFile("Projet/Journal/2026-01-01.md", "---\ndate: 2026-01-01\n---\nPremier."),
    new TFile("Projet/Journal/Notes.md", "hors journal"),
  ]);
  const files = new Map([[root.path, root], [journal.path, journal], ...journal.children.map((file) => [file.path, file])]);
  const app = { vault: { getAbstractFileByPath: (path) => files.get(path) || null, read: async (file) => file.content } };
  const settings = { projectFolder: root.path, journalFolder: "Journal" };
  assert.deepEqual(listDayEntries(app, settings).map((file) => file.basename), ["2026-01-01", "2026-01-03"]);
  assert.deepEqual([...journalEntryKeys(app, settings)], ["2026-01-01", "2026-01-03"]);
  assert.deepEqual(await getDayEntry(app, settings, new Date(2026, 0, 3)), { file: journal.children[0], key: "2026-01-03", body: "Troisième." });
});
