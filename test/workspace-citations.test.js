import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  citationRelativePath,
  isValidCitationRelativePath,
  listWorkspaceCitationCandidates,
  remapWorkspaceCitationResourcePaths,
  resolveWorkspaceCitationResearchFolder,
  resolveWorkspaceCitationResources,
} from "../src/services/workspace-citations.js";

function createCitationFixture() {
  const project = new TFolder("PROJECT");
  const articleA = new TFolder("PROJECT/Article-A");
  const sectionA = new TFolder("PROJECT/Article-A/Section-A");
  const docA = new TFile("PROJECT/Article-A/Section-A/Document-A.md");
  const articleB = new TFolder("PROJECT/Article-B");
  const docB = new TFile("PROJECT/Article-B/Document-B.md");
  const articleAExtra = new TFolder("PROJECT/Article-A-Extra");
  const outsideDoc = new TFile("PROJECT/Article-A-Extra/Outside.md");

  sectionA.parent = articleA;
  sectionA.children = [docA];
  docA.parent = sectionA;

  articleA.parent = project;
  articleA.children = [sectionA];

  articleB.parent = project;
  articleB.children = [docB];
  docB.parent = articleB;

  articleAExtra.parent = project;
  articleAExtra.children = [outsideDoc];
  outsideDoc.parent = articleAExtra;

  project.children = [articleA, articleB, articleAExtra];

  // Research folders
  const projectResearch = new TFolder("RESEARCH/Project-Research");
  const projectBib = new TFile("RESEARCH/Project-Research/project.bib");
  projectBib.extension = "bib";
  const defaultCsl = new TFile("RESEARCH/Project-Research/default.csl");
  defaultCsl.extension = "csl";
  const noteTxt = new TFile("RESEARCH/Project-Research/note.txt");
  noteTxt.extension = "txt";
  projectResearch.children = [projectBib, defaultCsl, noteTxt];
  projectBib.parent = projectResearch;
  defaultCsl.parent = projectResearch;
  noteTxt.parent = projectResearch;

  const articleAResearch = new TFolder("RESEARCH/Article-A-Research");
  const refA = new TFile("RESEARCH/Article-A-Research/references.bib");
  refA.extension = "bib";
  const stylesFolder = new TFolder("RESEARCH/Article-A-Research/Styles");
  const articleACsl = new TFile("RESEARCH/Article-A-Research/Styles/article-a.csl");
  articleACsl.extension = "csl";
  stylesFolder.parent = articleAResearch;
  stylesFolder.children = [articleACsl];
  articleACsl.parent = stylesFolder;

  const nestedFolder = new TFolder("RESEARCH/Article-A-Research/Nested");
  const secondaryBib = new TFile("RESEARCH/Article-A-Research/Nested/secondary.BIB");
  secondaryBib.extension = "BIB";
  nestedFolder.parent = articleAResearch;
  nestedFolder.children = [secondaryBib];
  secondaryBib.parent = nestedFolder;

  articleAResearch.children = [refA, stylesFolder, nestedFolder];
  refA.parent = articleAResearch;

  const articleBResearch = new TFolder("RESEARCH/Article-B-Research");
  const refB = new TFile("RESEARCH/Article-B-Research/references.bib");
  refB.extension = "bib";
  const articleBCsl = new TFile("RESEARCH/Article-B-Research/article-b.csl");
  articleBCsl.extension = "csl";
  articleBResearch.children = [refB, articleBCsl];
  refB.parent = articleBResearch;
  articleBCsl.parent = articleBResearch;

  const unrelatedResearch = new TFolder("RESEARCH/Unrelated-Research");
  const leakedBib = new TFile("RESEARCH/Unrelated-Research/leaked.bib");
  leakedBib.extension = "bib";
  const leakedCsl = new TFile("RESEARCH/Unrelated-Research/leaked.csl");
  leakedCsl.extension = "csl";
  unrelatedResearch.children = [leakedBib, leakedCsl];
  leakedBib.parent = unrelatedResearch;
  leakedCsl.parent = unrelatedResearch;

  const { vault } = createFakeVault([
    project,
    articleA,
    sectionA,
    docA,
    articleB,
    docB,
    articleAExtra,
    outsideDoc,
    projectResearch,
    projectBib,
    defaultCsl,
    noteTxt,
    articleAResearch,
    refA,
    stylesFolder,
    articleACsl,
    nestedFolder,
    secondaryBib,
    articleBResearch,
    refB,
    articleBCsl,
    unrelatedResearch,
    leakedBib,
    leakedCsl,
  ]);

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [project.path]: projectResearch.path,
          [articleA.path]: articleAResearch.path,
          [articleB.path]: articleBResearch.path,
        },
        folderWorkspaces: {},
      },
    },
  };

  const app = { vault };

  return {
    app,
    settings,
    project,
    articleA,
    sectionA,
    docA,
    articleB,
    docB,
    articleAExtra,
    outsideDoc,
    projectResearch,
    projectBib,
    defaultCsl,
    articleAResearch,
    refA,
    stylesFolder,
    articleACsl,
    nestedFolder,
    secondaryBib,
    articleBResearch,
    refB,
    articleBCsl,
    unrelatedResearch,
    leakedBib,
    leakedCsl,
  };
}

test("1. Entire project lists only .bib from Project-Research", () => {
  const f = createCitationFixture();
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  const candidates = listWorkspaceCitationCandidates(f.app, res.selectionResearchFolder, "bib");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].relativePath, "project.bib");
  assert.equal(candidates[0].file.path, f.projectBib.path);
});

test("2. Entire project lists only .csl from Project-Research", () => {
  const f = createCitationFixture();
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  const candidates = listWorkspaceCitationCandidates(f.app, res.selectionResearchFolder, "csl");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].relativePath, "default.csl");
  assert.equal(candidates[0].file.path, f.defaultCsl.path);
});

test("3. Article-A recursively lists references.bib and Nested/secondary.BIB", () => {
  const f = createCitationFixture();
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleA);
  const candidates = listWorkspaceCitationCandidates(f.app, res.selectionResearchFolder, "bib");
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].relativePath, "Nested/secondary.BIB");
  assert.equal(candidates[1].relativePath, "references.bib");
});

test("4. Article-A does not list files from Article-B-Research nor Unrelated-Research", () => {
  const f = createCitationFixture();
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleA);
  const bibs = listWorkspaceCitationCandidates(f.app, res.selectionResearchFolder, "bib");
  const csls = listWorkspaceCitationCandidates(f.app, res.selectionResearchFolder, "csl");
  assert.ok(!bibs.some((c) => c.file.path.includes("Article-B-Research") || c.file.path.includes("Unrelated-Research")));
  assert.ok(!csls.some((c) => c.file.path.includes("Article-B-Research") || c.file.path.includes("Unrelated-Research")));
});

test("5. Article-B can select its own references.bib without collision with Article-A", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-B"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };

  const resA = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleA);
  const resB = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleB);

  assert.equal(resA.bibliography.file?.path, f.refA.path);
  assert.equal(resB.bibliography.file?.path, f.refB.path);
  assert.equal(resA.bibliography.researchFolder?.path, f.articleAResearch.path);
  assert.equal(resB.bibliography.researchFolder?.path, f.articleBResearch.path);
});

test("6. Section-A inherits .bib and .csl from Article-A", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
    citekeyCslPath: "Styles/article-a.csl",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.sectionA);
  assert.equal(res.bibliography.file?.path, f.refA.path);
  assert.equal(res.bibliography.source, "ancestor");
  assert.equal(res.bibliography.sourceScope?.path, f.articleA.path);
  assert.equal(res.csl.file?.path, f.articleACsl.path);
  assert.equal(res.csl.source, "ancestor");
  assert.equal(res.csl.sourceScope?.path, f.articleA.path);
});

test("7. Local value \"\" on Section-A disables inheritance", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
    citekeyCslPath: "Styles/article-a.csl",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-A"] = {
    version: 1,
    citekeyBibliographyPath: "",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.sectionA);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.relativePath, null);
  assert.equal(res.bibliography.status, "disabled");
  assert.equal(res.bibliography.source, "none");
  assert.equal(res.bibliography.sourceScope?.path, f.sectionA.path);
  // CSL remains inherited
  assert.equal(res.csl.file?.path, f.articleACsl.path);
  assert.equal(res.csl.source, "ancestor");
});

test("8. Deleting local override restores inheritance", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-A"] = {
    version: 1,
    citekeyBibliographyPath: "",
  };

  // With override
  let res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.sectionA);
  assert.equal(res.bibliography.file, null);

  // Remove local override
  delete f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-A"].citekeyBibliographyPath;

  res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.sectionA);
  assert.equal(res.bibliography.file?.path, f.refA.path);
  assert.equal(res.bibliography.source, "ancestor");
});

test("9. Orphan selection returns null file without choosing another candidate", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "missing-ref.bib",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleA);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.relativePath, "missing-ref.bib");
  assert.equal(res.bibliography.source, "workspace");
});

test("10. Orphan research link causes no mutation", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].researchFolderLinks["PROJECT/Article-A"] = "RESEARCH/NonExistent";
  delete f.settings.projectMeta[f.project.path].researchFolderLinks[f.project.path];
  const beforeJson = JSON.stringify(f.settings);

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleA);
  // Association-based with orphan link and no parent link: yields null research folder, no mutation
  assert.equal(res.selectionResearchFolder, null);
  const afterJson = JSON.stringify(f.settings);
  assert.equal(beforeJson, afterJson);
});

test("11. Article-A-Extra is never treated as descendant of Article-A", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleAExtra);
  // Article-A-Extra is not Article-A, so it does not inherit Article-A's bibliography
  assert.notEqual(res.bibliography.sourceScope?.path, f.articleA.path);
  assert.equal(res.selectionResearchFolder?.path, f.projectResearch.path);
});

test("12. Raw path validation rejects without repairing invalid formats", () => {
  const rejectedPaths = [
    "Folder//references.bib",
    "Folder/../references.bib",
    "/Research/references.bib",
    "C:\\Research\\references.bib",
    "file://references.bib",
  ];

  for (const p of rejectedPaths) {
    assert.equal(isValidCitationRelativePath(p), false, `Should reject ${p}`);
  }
});

test("12b. Filenames containing double dots are accepted when not path traversal segments", () => {
  const allowedPaths = [
    "author..draft.bib",
    "styles/version..2.csl",
    "sub/my..custom..file.bib",
  ];
  for (const p of allowedPaths) {
    assert.equal(isValidCitationRelativePath(p), true, `Should accept ${p}`);
  }

  const rejectedTraversalPaths = [
    "../file.bib",
    "folder/../file.bib",
    "..\\file.bib",
    "folder/..",
    "folder/nested/../../file.bib",
  ];
  for (const p of rejectedTraversalPaths) {
    assert.equal(isValidCitationRelativePath(p), false, `Should reject ${p}`);
  }
});

test("13. Absolute path is rejected", () => {
  assert.equal(isValidCitationRelativePath("/PROJECT/ref.bib"), false);
  assert.equal(isValidCitationRelativePath("\\PROJECT\\ref.bib"), false);
});

test("14. Wrong file extension is rejected", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "note.txt";
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.status, "missing_file");
});

test("15. Two resources can be inherited from two different levels", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "project.bib";
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyCslPath: "Styles/article-a.csl",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.sectionA);

  assert.equal(res.bibliography.researchFolder?.path, f.projectResearch.path);
  assert.equal(res.bibliography.file?.path, f.projectBib.path);
  assert.equal(res.bibliography.source, "project");

  assert.equal(res.csl.researchFolder?.path, f.articleAResearch.path);
  assert.equal(res.csl.file?.path, f.articleACsl.path);
  assert.equal(res.csl.source, "ancestor");
  assert.equal(res.csl.sourceScope?.path, f.articleA.path);
});

test("16. Resolution never mutates settings: strict JSON comparison before/after", () => {
  const f = createCitationFixture();
  const beforeJson = JSON.stringify(f.settings);

  resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.sectionA);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleB);

  const afterJson = JSON.stringify(f.settings);
  assert.equal(beforeJson, afterJson);
});

test("17. Absence of active workspace uses entire project", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "project.bib";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.selectionResearchFolder?.path, f.projectResearch.path);
  assert.equal(res.bibliography.file?.path, f.projectBib.path);
  assert.equal(res.bibliography.source, "project");
});

test("18. Active file under Section-A does not change selection while workspace remains Article-A", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A/Section-A"] = {
    version: 1,
    citekeyBibliographyPath: "Nested/secondary.BIB",
  };

  // When active workspace is Article-A, resolution ignores Section-A even if active file is in Section-A
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleA);
  assert.equal(res.bibliography.file?.path, f.refA.path);
  assert.equal(res.bibliography.relativePath, "references.bib");
});

test("19. Renaming selected file inside same Research updates relative path", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };

  const changed = remapWorkspaceCitationResourcePaths(
    f.app,
    f.settings,
    "RESEARCH/Article-A-Research/references.bib",
    "RESEARCH/Article-A-Research/renamed.bib",
  );

  assert.equal(changed, true);
  assert.equal(
    f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"].citekeyBibliographyPath,
    "renamed.bib",
  );
});

test("20. Moving outside Research leaves selection orphan without re-attaching", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };

  const changed = remapWorkspaceCitationResourcePaths(
    f.app,
    f.settings,
    "RESEARCH/Article-A-Research/references.bib",
    "OUTSIDE/references.bib",
  );

  assert.equal(changed, false);
  assert.equal(
    f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"].citekeyBibliographyPath,
    "references.bib",
  );
});

test("21. Renaming Research root preserves internal relative paths", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };

  const changed = remapWorkspaceCitationResourcePaths(
    f.app,
    f.settings,
    "RESEARCH/Article-A-Research",
    "RESEARCH/Article-A-Renamed",
  );

  assert.equal(changed, false);
  assert.equal(
    f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"].citekeyBibliographyPath,
    "references.bib",
  );
});

test("22. Two Research folders both containing references.bib: move does not attach to sibling homonym", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"] = {
    version: 1,
    citekeyBibliographyPath: "references.bib",
  };

  // Move Article-A's references.bib into Article-B's folder
  const changed = remapWorkspaceCitationResourcePaths(
    f.app,
    f.settings,
    "RESEARCH/Article-A-Research/references.bib",
    "RESEARCH/Article-B-Research/moved.bib",
  );

  // Must not change Article-A's selection (leaves it orphan)
  assert.equal(changed, false);
  assert.equal(
    f.settings.projectMeta[f.project.path].folderWorkspaces["Article-A"].citekeyBibliographyPath,
    "references.bib",
  );
});

test("23. Association-based project, workspace linked to Research-A: only Research-A candidates, common container absent", () => {
  const common = new TFolder("PROJECT/_Feuillets/Research");
  const resA = new TFolder("PROJECT/_Feuillets/Research/Research-A");
  const aBib = new TFile("PROJECT/_Feuillets/Research/Research-A/a.bib");
  aBib.extension = "bib";
  resA.children = [aBib];
  aBib.parent = resA;

  const resB = new TFolder("PROJECT/_Feuillets/Research/Research-B");
  const bBib = new TFile("PROJECT/_Feuillets/Research/Research-B/b.bib");
  bBib.extension = "bib";
  resB.children = [bBib];
  bBib.parent = resB;

  const soy = new TFolder("PROJECT/_Feuillets/Research/Soy");
  const soyBib = new TFile("PROJECT/_Feuillets/Research/Soy/soy.bib");
  soyBib.extension = "bib";
  soy.children = [soyBib];
  soyBib.parent = soy;

  common.children = [resA, resB, soy];

  const project = new TFolder("PROJECT");
  const wsA = new TFolder("PROJECT/Article-A");
  project.children = [wsA, common];

  const { vault } = createFakeVault([project, wsA, common, resA, aBib, resB, bBib, soy, soyBib]);
  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [wsA.path]: resA.path,
        },
      },
    },
  };
  const app = { vault };

  const res = resolveWorkspaceCitationResources(app, settings, project, wsA);
  assert.equal(res.selectionResearchFolder?.path, resA.path);

  const candidates = listWorkspaceCitationCandidates(app, res.selectionResearchFolder, "bib");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].relativePath, "a.bib");
  assert.ok(!candidates.some((c) => c.relativePath === "b.bib" || c.relativePath === "soy.bib"));
});

test("24. Association-based project, only sibling workspace is linked: current workspace has no candidates and no fallback", () => {
  const common = new TFolder("PROJECT/_Feuillets/Research");
  const resB = new TFolder("PROJECT/_Feuillets/Research/Research-B");
  const bBib = new TFile("PROJECT/_Feuillets/Research/Research-B/b.bib");
  bBib.extension = "bib";
  resB.children = [bBib];
  bBib.parent = resB;
  common.children = [resB];

  const project = new TFolder("PROJECT");
  const wsA = new TFolder("PROJECT/Article-A");
  const wsB = new TFolder("PROJECT/Article-B");
  project.children = [wsA, wsB, common];

  const { vault } = createFakeVault([project, wsA, wsB, common, resB, bBib]);
  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [wsB.path]: resB.path,
        },
      },
    },
  };
  const app = { vault };

  // wsA has no link and project has no link
  const res = resolveWorkspaceCitationResources(app, settings, project, wsA);
  assert.equal(res.selectionResearchFolder, null);
  const candidates = listWorkspaceCitationCandidates(app, res.selectionResearchFolder, "bib");
  assert.equal(candidates.length, 0);
});

test("25. Association-based project, workspace association is orphan: no candidates, no historical fallback", () => {
  const project = new TFolder("PROJECT");
  const wsA = new TFolder("PROJECT/Article-A");
  const canonicalResearch = new TFolder("PROJECT/_Feuillets/Research");
  const fallbackBib = new TFile("PROJECT/_Feuillets/Research/fallback.bib");
  fallbackBib.extension = "bib";
  canonicalResearch.children = [fallbackBib];
  fallbackBib.parent = canonicalResearch;
  project.children = [wsA, canonicalResearch];

  const { vault } = createFakeVault([project, wsA, canonicalResearch, fallbackBib]);
  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [wsA.path]: "NON_EXISTENT_FOLDER",
        },
      },
    },
  };
  const app = { vault };

  const res = resolveWorkspaceCitationResources(app, settings, project, wsA);
  assert.equal(res.selectionResearchFolder, null);
  const candidates = listWorkspaceCitationCandidates(app, res.selectionResearchFolder, "bib");
  assert.equal(candidates.length, 0);
});

test("26. Association-based project with explicit link on projectRoot: linked research available, parent container not", () => {
  const common = new TFolder("PROJECT/_Feuillets/Research");
  const projectRes = new TFolder("PROJECT/_Feuillets/Research/Main");
  const mainBib = new TFile("PROJECT/_Feuillets/Research/Main/main.bib");
  mainBib.extension = "bib";
  projectRes.children = [mainBib];
  mainBib.parent = projectRes;

  const otherRes = new TFolder("PROJECT/_Feuillets/Research/Other");
  const otherBib = new TFile("PROJECT/_Feuillets/Research/Other/other.bib");
  otherBib.extension = "bib";
  otherRes.children = [otherBib];
  otherBib.parent = otherRes;

  common.children = [projectRes, otherRes];

  const project = new TFolder("PROJECT");
  project.children = [common];

  const { vault } = createFakeVault([project, common, projectRes, mainBib, otherRes, otherBib]);
  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [project.path]: projectRes.path,
        },
      },
    },
  };
  const app = { vault };

  const res = resolveWorkspaceCitationResources(app, settings, project, null);
  assert.equal(res.selectionResearchFolder?.path, projectRes.path);
  const candidates = listWorkspaceCitationCandidates(app, res.selectionResearchFolder, "bib");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].relativePath, "main.bib");
});

test("27. Historical project without any association: historical behavior preserved, no settings mutation", () => {
  const project = new TFolder("PROJECT");
  const canonicalResearch = new TFolder("PROJECT/_Recherche");
  const histBib = new TFile("PROJECT/_Recherche/hist.bib");
  histBib.extension = "bib";
  canonicalResearch.children = [histBib];
  histBib.parent = canonicalResearch;
  project.children = [canonicalResearch];

  const { vault } = createFakeVault([project, canonicalResearch, histBib]);
  const settings = {
    projectFolder: project.path,
    projectMeta: {},
  };
  const app = { vault };

  const beforeJson = JSON.stringify(settings);
  const res = resolveWorkspaceCitationResources(app, settings, project, null);
  assert.equal(res.selectionResearchFolder?.path, canonicalResearch.path);
  const afterJson = JSON.stringify(settings);
  assert.equal(beforeJson, afterJson);
});

test("28. Valid legacy pandocBibliographyPath in association mode resolves with project source", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].pandocBibliographyPath = f.projectBib.path;
  const beforeJson = JSON.stringify(f.settings);

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.file?.path, f.projectBib.path);
  assert.equal(res.bibliography.relativePath, "project.bib");
  assert.equal(res.bibliography.source, "project");

  const afterJson = JSON.stringify(f.settings);
  assert.equal(beforeJson, afterJson);
  assert.equal(f.settings.projectMeta[f.project.path].citekeyBibliographyPath, undefined);
});

test("28b. Association mode pandocBibliographyPath with no project-root research association returns unbound_research", () => {
  const f = createCitationFixture();
  delete f.settings.projectMeta[f.project.path].researchFolderLinks[f.project.path];
  f.settings.projectMeta[f.project.path].pandocBibliographyPath = f.projectBib.path;

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.status, "unbound_research");
  assert.equal(res.bibliography.source, "project");
});

test("28c. Legacy mode pandocBibliographyPath resolves with legacy source when researchFolderLinks is absent", () => {
  const f = createCitationFixture();
  delete f.settings.projectMeta[f.project.path].researchFolderLinks;

  const projectRecherche = new TFolder("PROJECT/_Recherche");
  projectRecherche.parent = f.project;
  const legacyBib = new TFile("PROJECT/_Recherche/legacy.bib");
  legacyBib.extension = "bib";
  legacyBib.parent = projectRecherche;
  projectRecherche.children = [legacyBib];
  f.project.children.push(projectRecherche);

  const { vault } = createFakeVault([
    f.project,
    projectRecherche,
    legacyBib,
  ]);
  const app = { vault };

  f.settings.projectMeta[f.project.path].pandocBibliographyPath = "legacy.bib";

  const res = resolveWorkspaceCitationResources(app, f.settings, f.project, null);
  assert.equal(res.bibliography.file?.path, "PROJECT/_Recherche/legacy.bib");
  assert.equal(res.bibliography.relativePath, "legacy.bib");
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "legacy");
});

test("28d. Legacy mode pandocBibliographyPath returns unbound_research when no research folder found", () => {
  const f = createCitationFixture();
  delete f.settings.projectMeta[f.project.path].researchFolderLinks;
  f.settings.projectMeta[f.project.path].pandocBibliographyPath = "missing.bib";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.status, "unbound_research");
  assert.equal(res.bibliography.source, "legacy");
});

test("29. Legacy pandocBibliographyPath outside project Research is rejected", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].pandocBibliographyPath = f.leakedBib.path;

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.file, null);
});

test("29b. Invalid legacy pandocBibliographyPath that would normalize to a real file is rejected", () => {
  const f = createCitationFixture();
  const rawInvalid = "RESEARCH/Project-Research/../Project-Research/project.bib";
  f.settings.projectMeta[f.project.path].pandocBibliographyPath = rawInvalid;

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.relativePath, null);
  assert.equal(res.bibliography.status, "invalid_path");
  assert.equal(res.bibliography.configuredPath, rawInvalid);
});

test("29c. Leading slash legacy pandocBibliographyPath is rejected as invalid_path", () => {
  const f = createCitationFixture();
  const rawInvalid = `/${f.projectBib.path}`;
  f.settings.projectMeta[f.project.path].pandocBibliographyPath = rawInvalid;

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.relativePath, null);
  assert.equal(res.bibliography.status, "invalid_path");
  assert.equal(res.bibliography.configuredPath, rawInvalid);
});

test("30. Canonical field, including \"\", takes precedence over legacy field", () => {
  const f = createCitationFixture();
  f.settings.projectMeta[f.project.path].pandocBibliographyPath = f.projectBib.path;
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.status, "disabled");
  assert.equal(res.bibliography.source, "none");
});

test("31. Candidates are sorted deterministically", () => {
  const f = createCitationFixture();
  const c1 = new TFile("RESEARCH/Project-Research/z.bib");
  c1.extension = "bib";
  const c2 = new TFile("RESEARCH/Project-Research/a.bib");
  c2.extension = "bib";
  const c3 = new TFile("RESEARCH/Project-Research/m.bib");
  c3.extension = "bib";
  f.projectResearch.children.push(c1, c2, c3);

  const candidates = listWorkspaceCitationCandidates(f.app, f.projectResearch, "bib");
  const rels = candidates.map((c) => c.relativePath);
  const sorted = [...rels].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(rels, sorted);
});

test("32. No sibling or external Research leaks into candidates", () => {
  const f = createCitationFixture();
  const resA = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.articleA);
  const candidatesA = listWorkspaceCitationCandidates(f.app, resA.selectionResearchFolder, "bib");
  for (const c of candidatesA) {
    assert.ok(c.file.path.startsWith("RESEARCH/Article-A-Research/"));
  }
});

test("33. citationRelativePath returns relative path within root folder or null", () => {
  const f = createCitationFixture();
  assert.equal(citationRelativePath(f.projectResearch, f.projectBib), "project.bib");
  assert.equal(citationRelativePath(f.articleAResearch, f.secondaryBib), "Nested/secondary.BIB");
  assert.equal(citationRelativePath(f.projectResearch, f.refA), null);
});

test("34. resolveWorkspaceCitationResearchFolder resolves matching research folder", () => {
  const f = createCitationFixture();
  const folderA = resolveWorkspaceCitationResearchFolder(f.app, f.settings, f.project, f.articleA);
  assert.equal(folderA?.path, f.articleAResearch.path);

  const folderProject = resolveWorkspaceCitationResearchFolder(f.app, f.settings, f.project, null);
  assert.equal(folderProject?.path, f.projectResearch.path);
});

/* =========================================================================
   HIERARCHICAL INHERITANCE SUITE (18 TESTS)
   Hierarchy:
   PROJECT
   ├── Work-A
   │   └── Section-A
   │       └── Chapter-A
   │           └── Document-A.md
   ├── Work-B
   │   └── Document-B.md
   └── Work-A-Extra
       └── Document-Extra.md

   RESEARCH
   ├── Project-Research
   ├── Work-A-Research
   ├── Section-A-Research
   ├── Chapter-A-Research
   ├── Work-B-Research
   └── Extra-Research
   ========================================================================= */

function createHierarchicalFixture() {
  const project = new TFolder("PROJECT");
  const workA = new TFolder("PROJECT/Work-A");
  const sectionA = new TFolder("PROJECT/Work-A/Section-A");
  const chapterA = new TFolder("PROJECT/Work-A/Section-A/Chapter-A");
  const docA = new TFile("PROJECT/Work-A/Section-A/Chapter-A/Document-A.md");

  const workB = new TFolder("PROJECT/Work-B");
  const docB = new TFile("PROJECT/Work-B/Document-B.md");

  const workAExtra = new TFolder("PROJECT/Work-A-Extra");
  const docExtra = new TFile("PROJECT/Work-A-Extra/Document-Extra.md");

  chapterA.parent = sectionA;
  chapterA.children = [docA];
  docA.parent = chapterA;

  sectionA.parent = workA;
  sectionA.children = [chapterA];

  workA.parent = project;
  workA.children = [sectionA];

  workB.parent = project;
  workB.children = [docB];
  docB.parent = workB;

  workAExtra.parent = project;
  workAExtra.children = [docExtra];
  docExtra.parent = workAExtra;

  project.children = [workA, workB, workAExtra];

  // Research roots
  const research = new TFolder("RESEARCH");

  const projectResearch = new TFolder("RESEARCH/Project-Research");
  const projectBib = new TFile("RESEARCH/Project-Research/project.bib");
  projectBib.extension = "bib";
  projectResearch.children = [projectBib];
  projectBib.parent = projectResearch;

  const workAResearch = new TFolder("RESEARCH/Work-A-Research");
  const workBib = new TFile("RESEARCH/Work-A-Research/work.bib");
  workBib.extension = "bib";
  workAResearch.children = [workBib];
  workBib.parent = workAResearch;

  const sectionAResearch = new TFolder("RESEARCH/Section-A-Research");
  const sectionBib = new TFile("RESEARCH/Section-A-Research/section.bib");
  sectionBib.extension = "bib";
  const sectionCsl = new TFile("RESEARCH/Section-A-Research/section.csl");
  sectionCsl.extension = "csl";
  sectionAResearch.children = [sectionBib, sectionCsl];
  sectionBib.parent = sectionAResearch;
  sectionCsl.parent = sectionAResearch;

  const chapterAResearch = new TFolder("RESEARCH/Chapter-A-Research");
  const chapterBib = new TFile("RESEARCH/Chapter-A-Research/chapter.bib");
  chapterBib.extension = "bib";
  chapterAResearch.children = [chapterBib];
  chapterBib.parent = chapterAResearch;

  const workBResearch = new TFolder("RESEARCH/Work-B-Research");
  const workBBib = new TFile("RESEARCH/Work-B-Research/work-b.bib");
  workBBib.extension = "bib";
  const workBCsl = new TFile("RESEARCH/Work-B-Research/work-b.csl");
  workBCsl.extension = "csl";
  workBResearch.children = [workBBib, workBCsl];
  workBBib.parent = workBResearch;
  workBCsl.parent = workBResearch;

  const extraResearch = new TFolder("RESEARCH/Extra-Research");
  const extraBib = new TFile("RESEARCH/Extra-Research/extra.bib");
  extraBib.extension = "bib";
  const extraCsl = new TFile("RESEARCH/Extra-Research/extra.csl");
  extraCsl.extension = "csl";
  extraResearch.children = [extraBib, extraCsl];
  extraBib.parent = extraResearch;
  extraCsl.parent = extraResearch;

  // Historical research root in project for legacy fallback testing
  const histFolder = new TFolder("PROJECT/_Recherche");
  const histBib = new TFile("PROJECT/_Recherche/historical.bib");
  histBib.extension = "bib";
  histFolder.children = [histBib];
  histBib.parent = histFolder;
  histFolder.parent = project;
  project.children.push(histFolder);

  research.children = [
    projectResearch,
    workAResearch,
    sectionAResearch,
    chapterAResearch,
    workBResearch,
    extraResearch,
  ];

  const allFiles = [
    project,
    workA,
    sectionA,
    chapterA,
    docA,
    workB,
    docB,
    workAExtra,
    docExtra,
    histFolder,
    histBib,
    research,
    projectResearch,
    projectBib,
    workAResearch,
    workBib,
    sectionAResearch,
    sectionBib,
    sectionCsl,
    chapterAResearch,
    chapterBib,
    workBResearch,
    workBBib,
    workBCsl,
    extraResearch,
    extraBib,
    extraCsl,
  ];

  const { vault } = createFakeVault(allFiles);

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [project.path]: projectResearch.path,
          [workA.path]: workAResearch.path,
          [sectionA.path]: sectionAResearch.path,
          [chapterA.path]: chapterAResearch.path,
          [workB.path]: workBResearch.path,
          [workAExtra.path]: extraResearch.path,
        },
        folderWorkspaces: {},
      },
    },
  };

  const app = { vault };

  return {
    app,
    settings,
    project,
    workA,
    sectionA,
    chapterA,
    docA,
    workB,
    docB,
    workAExtra,
    docExtra,
    research,
    projectResearch,
    projectBib,
    workAResearch,
    workBib,
    sectionAResearch,
    sectionBib,
    sectionCsl,
    chapterAResearch,
    chapterBib,
    workBResearch,
    workBBib,
    workBCsl,
    extraResearch,
    extraBib,
    extraCsl,
    histFolder,
    histBib,
  };
}

test("H1. Exact workspace value: Chapter-A defines chapter.bib", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A/Chapter-A"] = {
    version: 1,
    citekeyBibliographyPath: "chapter.bib",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "workspace");
  assert.equal(res.bibliography.sourceScope?.path, f.chapterA.path);
  assert.equal(res.bibliography.researchFolder?.path, f.chapterAResearch.path);
  assert.equal(res.bibliography.file?.path, f.chapterBib.path);
});

test("H2. Direct parent inheritance: Chapter-A undefined, Section-A defines section.bib", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A"] = {
    version: 1,
    citekeyBibliographyPath: "section.bib",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "ancestor");
  assert.equal(res.bibliography.sourceScope?.path, f.sectionA.path);
  assert.equal(res.bibliography.researchFolder?.path, f.sectionAResearch.path);
  assert.equal(res.bibliography.file?.path, f.sectionBib.path);
});

test("H3. Multiple parent levels: Chapter-A and Section-A undefined, Work-A defines work.bib", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "project.bib";
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"] = {
    version: 1,
    citekeyBibliographyPath: "work.bib",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "ancestor");
  assert.equal(res.bibliography.sourceScope?.path, f.workA.path);
  assert.equal(res.bibliography.researchFolder?.path, f.workAResearch.path);
  assert.equal(res.bibliography.file?.path, f.workBib.path);
  assert.notEqual(res.bibliography.sourceScope?.path, f.project.path);
});

test("H4. Project inheritance: No folder workspace defines resource, Project defines project.bib", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "project.bib";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "project");
  assert.equal(res.bibliography.sourceScope?.path, f.project.path);
  assert.equal(res.bibliography.researchFolder?.path, f.projectResearch.path);
  assert.equal(res.bibliography.file?.path, f.projectBib.path);
});

test("H5. Independent bibliography and CSL origins: Work-A defines bib, Section-A defines csl", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"] = {
    version: 1,
    citekeyBibliographyPath: "work.bib",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A"] = {
    version: 1,
    citekeyCslPath: "section.csl",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "ancestor");
  assert.equal(res.bibliography.sourceScope?.path, f.workA.path);
  assert.equal(res.bibliography.researchFolder?.path, f.workAResearch.path);
  assert.equal(res.bibliography.file?.path, f.workBib.path);

  assert.equal(res.csl.status, "valid");
  assert.equal(res.csl.source, "ancestor");
  assert.equal(res.csl.sourceScope?.path, f.sectionA.path);
  assert.equal(res.csl.researchFolder?.path, f.sectionAResearch.path);
  assert.equal(res.csl.file?.path, f.sectionCsl.path);
});

test("H6. Explicit disablement: Chapter-A sets bibliography to \"\", Section-A and Project valid", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "project.bib";
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A"] = {
    version: 1,
    citekeyBibliographyPath: "section.bib",
    citekeyCslPath: "section.csl",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A/Chapter-A"] = {
    version: 1,
    citekeyBibliographyPath: "",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "disabled");
  assert.equal(res.bibliography.source, "none");
  assert.equal(res.bibliography.sourceScope?.path, f.chapterA.path);
  assert.equal(res.bibliography.configuredPath, "");
  assert.equal(res.bibliography.relativePath, null);
  assert.equal(res.bibliography.researchFolder, null);
  assert.equal(res.bibliography.file, null);

  // CSL inheritance remains unaffected
  assert.equal(res.csl.status, "valid");
  assert.equal(res.csl.source, "ancestor");
  assert.equal(res.csl.sourceScope?.path, f.sectionA.path);
  assert.equal(res.csl.file?.path, f.sectionCsl.path);
});

test("H7. Missing configured file: Section-A explicitly configures non-empty missing .bib", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "project.bib";
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"] = {
    version: 1,
    citekeyBibliographyPath: "work.bib",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A"] = {
    version: 1,
    citekeyBibliographyPath: "missing.bib",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "missing_file");
  assert.equal(res.bibliography.source, "ancestor");
  assert.equal(res.bibliography.sourceScope?.path, f.sectionA.path);
  assert.equal(res.bibliography.researchFolder?.path, f.sectionAResearch.path);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.relativePath, "missing.bib");
});

test("H8. Invalid path: relative path attempts to escape associated Research folder", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "project.bib";
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A"] = {
    version: 1,
    citekeyBibliographyPath: "../work.bib",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "invalid_path");
  assert.equal(res.bibliography.source, "ancestor");
  assert.equal(res.bibliography.sourceScope?.path, f.sectionA.path);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.bibliography.relativePath, null);
});

test("H9. Orphan child association with valid parent: Chapter-A orphan, Section-A valid", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].researchFolderLinks[f.chapterA.path] = "RESEARCH/Orphan-Target";
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A"] = {
    version: 1,
    citekeyBibliographyPath: "section.bib",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "ancestor");
  assert.equal(res.bibliography.sourceScope?.path, f.sectionA.path);
  assert.equal(res.bibliography.researchFolder?.path, f.sectionAResearch.path);
  assert.equal(res.bibliography.file?.path, f.sectionBib.path);
});

test("H10. Stale association never activates legacy fallback when researchFolderLinks is non-empty", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].researchFolderLinks = {
    [f.chapterA.path]: "RESEARCH/Missing-A",
    [f.sectionA.path]: "RESEARCH/Missing-B",
    [f.workA.path]: "RESEARCH/Missing-C",
    [f.project.path]: "RESEARCH/Missing-D",
  };
  const canonicalFolder = new TFolder("PROJECT/_Feuillets/Research");
  const canonicalBib = new TFile("PROJECT/_Feuillets/Research/canonical.bib");
  canonicalBib.extension = "bib";
  canonicalFolder.children = [canonicalBib];
  canonicalBib.parent = canonicalFolder;
  f.project.children.push(canonicalFolder);
  canonicalFolder.parent = f.project;

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.notEqual(res.bibliography.source, "legacy");
  assert.equal(res.selectionResearchFolder, null);
  assert.equal(res.bibliography.file, null);
});

test("H11. Sibling exclusion: Chapter-A never resolves files from Work-B-Research", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-B"] = {
    version: 1,
    citekeyBibliographyPath: "work-b.bib",
    citekeyCslPath: "work-b.csl",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.notEqual(res.bibliography.researchFolder?.path, f.workBResearch.path);
  assert.notEqual(res.csl.researchFolder?.path, f.workBResearch.path);
  assert.equal(res.bibliography.file, null);
  assert.equal(res.csl.file, null);
});

test("H12. Strict path boundary: Work-A-Extra is never treated as Work-A or ancestor of Chapter-A", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A-Extra"] = {
    version: 1,
    citekeyBibliographyPath: "extra.bib",
    citekeyCslPath: "extra.csl",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.notEqual(res.bibliography.sourceScope?.path, f.workAExtra.path);
  assert.notEqual(res.bibliography.researchFolder?.path, f.extraResearch.path);
  assert.notEqual(res.csl.sourceScope?.path, f.workAExtra.path);
  assert.notEqual(res.csl.researchFolder?.path, f.extraResearch.path);
});

test("H13. Selection research folder: nearest valid explicit association on ancestor chain", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].researchFolderLinks[f.chapterA.path] = "RESEARCH/Stale-Target";

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.selectionResearchFolder?.path, f.sectionAResearch.path);
});

test("H14. Legacy mode: researchFolderLinks absent and empty resolves historical fallback as legacy", () => {
  const f = createHierarchicalFixture();
  delete f.settings.projectMeta[f.project.path].researchFolderLinks;
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "historical.bib";

  const beforeJson = JSON.stringify(f.settings);
  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  const afterJson = JSON.stringify(f.settings);

  assert.equal(res.bibliography.status, "valid");
  assert.equal(res.bibliography.source, "legacy");
  assert.equal(res.bibliography.sourceScope?.path, f.project.path);
  assert.equal(res.bibliography.researchFolder?.path, f.histFolder.path);
  assert.equal(res.bibliography.file?.path, f.histBib.path);
  assert.equal(beforeJson, afterJson);

  // Test empty researchFolderLinks
  f.settings.projectMeta[f.project.path].researchFolderLinks = {};
  const resEmpty = resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  assert.equal(resEmpty.bibliography.source, "legacy");
});

test("H15. Zero mutation in normal operation: settings object unchanged byte-for-byte", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].citekeyBibliographyPath = "project.bib";
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"] = {
    version: 1,
    citekeyBibliographyPath: "work.bib",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A"] = {
    version: 1,
    citekeyCslPath: "section.csl",
  };

  const beforeJson = JSON.stringify(f.settings);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.sectionA);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.workA);
  resolveWorkspaceCitationResources(f.app, f.settings, f.project, null);
  const afterJson = JSON.stringify(f.settings);

  assert.equal(beforeJson, afterJson);
});

test("H16. Resolver provenance: inherited from Work-A returned as ancestor, disabled returned as disabled", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"] = {
    version: 1,
    citekeyBibliographyPath: "work.bib",
  };

  // Chapter-A inherits from Work-A (outside Chapter-A-Research)
  const resInherited = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(resInherited.bibliography.status, "valid");
  assert.equal(resInherited.bibliography.source, "ancestor");
  assert.equal(resInherited.bibliography.sourceScope?.name, "Work-A");
  assert.notEqual(resInherited.bibliography.status, "missing_file");

  // Chapter-A disabled
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A/Chapter-A"] = {
    version: 1,
    citekeyBibliographyPath: "",
  };
  const resDisabled = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(resDisabled.bibliography.status, "disabled");
  assert.equal(resDisabled.bibliography.source, "none");
  assert.equal(resDisabled.bibliography.sourceScope?.name, "Chapter-A");
});

test("H17. Distinct ancestor research folders: distinct research roots resolved for bibliography and csl", () => {
  const f = createHierarchicalFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A"] = {
    version: 1,
    citekeyBibliographyPath: "work.bib",
  };
  f.settings.projectMeta[f.project.path].folderWorkspaces["Work-A/Section-A"] = {
    version: 1,
    citekeyCslPath: "section.csl",
  };

  const res = resolveWorkspaceCitationResources(f.app, f.settings, f.project, f.chapterA);
  assert.equal(res.bibliography.file?.path, f.workBib.path);
  assert.equal(res.csl.file?.path, f.sectionCsl.path);

  assert.notEqual(res.selectionResearchFolder?.path, res.bibliography.researchFolder?.path);
  assert.equal(res.selectionResearchFolder?.path, f.chapterAResearch.path);
});
