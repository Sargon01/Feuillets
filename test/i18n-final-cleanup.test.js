import assert from "node:assert/strict";
import test from "node:test";
import { TFolder } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { createFakeVault } from "./helpers/fake-vault.js";
import { getLocale, setLocale } from "../src/i18n/index.js";

/*
 * Final targeted i18n cleanup: generateBibliographyFile()'s output basename
 * must follow the project's STRUCTURAL language (a "Manuscrit" or
 * "Manuscript" root, detected via detectProjectStructureLocale), never the
 * momentary UI locale alone — see src/main.ts.
 */

/** getOutputFolder() may need to create the output folder (`ensureFolder`,
 * services/project-files.ts) via `app.vault.createFolder` — unlike the
 * hostile-app pattern in research-bibliography-generation.test.js, this
 * needs the fixture's full fake vault, not a read/write-only stub. */
function makeApp(fixture) {
  return {
    vault: fixture.vault,
    metadataCache: {
      getFileCache: () => ({ frontmatter: {} }),
    },
  };
}

function makeFixture(manuscriptName) {
  const parent = new TFolder("Project");
  const manuscript = new TFolder(`Project/${manuscriptName}`);
  parent.children = [manuscript];
  manuscript.parent = parent;
  const { vault } = createFakeVault([parent, manuscript]);
  const settings = { projectFolder: manuscript.path, projectMeta: { [manuscript.path]: {} } };
  return { vault, parent, manuscript, settings };
}

function makePlugin(fixture) {
  return {
    app: makeApp(fixture),
    settings: fixture.settings,
    generateBibliographyFile: FeuilletsPlugin.prototype.generateBibliographyFile,
  };
}

const bibtexEntries = [{ author: "Alpha, Ann", title: "Alpha Work", date: "2021", citekey: "onlyA2021" }];
const FR_OUTPUT_PATH = "Project/_Feuillets/Sortie/Bibliographie.md";
const EN_OUTPUT_PATH = "Project/_Feuillets/Output/Bibliography.md";

test("generateBibliographyFile: a French structural project (root 'Manuscrit') always writes Bibliographie.md, even under an English UI", async () => {
  const initial = getLocale();
  try {
    setLocale("en");
    const fixture = makeFixture("Manuscrit");
    const plugin = makePlugin(fixture);
    await plugin.generateBibliographyFile({ projectRoot: fixture.manuscript, sourceFiles: [], bibtexEntries });
    assert.ok(fixture.vault.getAbstractFileByPath(FR_OUTPUT_PATH));
    assert.equal(fixture.vault.getAbstractFileByPath(EN_OUTPUT_PATH), null);
  } finally {
    setLocale(initial);
  }
});

test("generateBibliographyFile: an English structural project (root 'Manuscript') always writes Bibliography.md, even under a French UI", async () => {
  const initial = getLocale();
  try {
    setLocale("fr");
    const fixture = makeFixture("Manuscript");
    const plugin = makePlugin(fixture);
    await plugin.generateBibliographyFile({ projectRoot: fixture.manuscript, sourceFiles: [], bibtexEntries });
    assert.ok(fixture.vault.getAbstractFileByPath(EN_OUTPUT_PATH));
    assert.equal(fixture.vault.getAbstractFileByPath(FR_OUTPUT_PATH), null);
  } finally {
    setLocale(initial);
  }
});

test("generateBibliographyFile: switching only the UI locale never renames an already-generated file", async () => {
  const initial = getLocale();
  try {
    setLocale("fr");
    const fixture = makeFixture("Manuscrit");
    const plugin = makePlugin(fixture);
    await plugin.generateBibliographyFile({ projectRoot: fixture.manuscript, sourceFiles: [], bibtexEntries });
    assert.ok(fixture.vault.getAbstractFileByPath(FR_OUTPUT_PATH));

    // UI switches to English; the project's own structure is unchanged.
    setLocale("en");
    await plugin.generateBibliographyFile({ projectRoot: fixture.manuscript, sourceFiles: [], bibtexEntries });
    assert.ok(fixture.vault.getAbstractFileByPath(FR_OUTPUT_PATH), "the original file is reused, never abandoned");
    assert.equal(fixture.vault.getAbstractFileByPath(EN_OUTPUT_PATH), null, "no duplicate is created under the other language");
  } finally {
    setLocale(initial);
  }
});

test("generateBibliographyFile: a pre-existing legacy Bibliography.md is reused in place, never duplicated, for a French-detected project", async () => {
  const initial = getLocale();
  try {
    setLocale("fr");
    const fixture = makeFixture("Manuscrit");
    // Simulate a project whose output folder already holds the legacy
    // English-named file (e.g. created by an older version of the plugin),
    // at the same canonical location the French project would use.
    await fixture.vault.createFolder("Project/_Feuillets");
    await fixture.vault.createFolder("Project/_Feuillets/Sortie");
    await fixture.vault.create("Project/_Feuillets/Sortie/Bibliography.md", "stale content");
    const plugin = makePlugin(fixture);
    await plugin.generateBibliographyFile({ projectRoot: fixture.manuscript, sourceFiles: [], bibtexEntries });

    const legacy = fixture.vault.getAbstractFileByPath("Project/_Feuillets/Sortie/Bibliography.md");
    assert.ok(legacy, "the legacy file is reused, not abandoned");
    assert.match(legacy.content, /Alpha, Ann/, "its content is regenerated in place");
    assert.equal(fixture.vault.getAbstractFileByPath(FR_OUTPUT_PATH), null, "no duplicate is created next to it");
  } finally {
    setLocale(initial);
  }
});
