import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { isEligibleTypographyTarget } from "../src/services/typography-scope.js";
import { isEligiblePasteTarget } from "../src/services/image-resources.js";
import { createFakeVault } from "./helpers/fake-vault.js";

for (const name of ["", "Manuscrit", "Manuscript"]) {
  test(`typography scope: ordinary sheets and quick drafts in ${name || "a free project"}`, () => {
    const project = new TFolder("Projet");
    const root = name ? new TFolder(`Projet/${name}`) : project;
    if (root !== project) root.parent = project;
    const sheet = new TFile(`${root.path}/Chapitre.md`);
    sheet.parent = root;
    const drafts = new TFolder("Projet/_Feuillets/Drafts");
    const draft = new TFile(`${drafts.path}/Sans titre.md`);
    draft.parent = drafts;
    const { vault } = createFakeVault([project, root, drafts, sheet, draft]);
    const settings = { projectFolder: root.path };

    assert.equal(isEligibleTypographyTarget(root, sheet), true);
    assert.equal(isEligibleTypographyTarget(root, draft), true);
    assert.equal(isEligibleTypographyTarget(root, new TFile(`${drafts.path}/Notes/Idée.md`)), true);
    for (const path of [
      "Projet/_Feuillets/Versions/note.md", "Projet/_Feuillets/Drafts-old/note.md",
      "Projet/_Feuillets/config.md", "Autre/_Feuillets/Drafts/Sans titre.md",
      "Projet-voisin/Chapitre.md", "Autre/Chapitre.md", `${drafts.path}/image.png`,
    ]) assert.equal(isEligibleTypographyTarget(root, new TFile(path)), false, path);
    assert.equal(isEligibleTypographyTarget(null, draft), false);
    assert.equal(isEligibleTypographyTarget(root, null), false);
    assert.equal(isEligiblePasteTarget({ vault }, settings, sheet), true);
    assert.equal(isEligiblePasteTarget({ vault }, settings, draft), false, "image eligibility stays unchanged");
  });
}
