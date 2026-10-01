import test from "node:test";
import assert from "node:assert/strict";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { buildScriveningsDocument } from "../src/services/scrivenings-document.js";
import { buildScriveningsCslDocument } from "../src/services/scrivenings-csl-document.js";
import { resolveScriveningsCslResources } from "../src/services/scrivenings-csl-resources.js";

function createCitationResourcesFixture() {
  const project = new TFolder("PROJECT");

  // Workspaces / folders inside PROJECT
  const folderA = new TFolder("PROJECT/Folder-A");
  const docA1 = new TFile("PROJECT/Folder-A/Doc-A1.md");
  const docA2 = new TFile("PROJECT/Folder-A/Doc-A2.md");

  const folderB = new TFolder("PROJECT/Folder-B");
  const docB1 = new TFile("PROJECT/Folder-B/Doc-B1.md");

  const folderC = new TFolder("PROJECT/Folder-C");
  const docC1 = new TFile("PROJECT/Folder-C/Doc-C1.md");

  folderA.parent = project;
  folderA.children = [docA1, docA2];
  docA1.parent = folderA;
  docA2.parent = folderA;

  folderB.parent = project;
  folderB.children = [docB1];
  docB1.parent = folderB;

  folderC.parent = project;
  folderC.children = [docC1];
  docC1.parent = folderC;

  project.children = [folderA, folderB, folderC];

  // Research folders
  const projectResearch = new TFolder("RESEARCH/Project-Research");
  const projectBib = new TFile("RESEARCH/Project-Research/project.bib");
  projectBib.extension = "bib";
  const defaultCsl = new TFile("RESEARCH/Project-Research/default.csl");
  defaultCsl.extension = "csl";
  const alternativeCsl = new TFile("RESEARCH/Project-Research/alternative.csl");
  alternativeCsl.extension = "csl";
  projectResearch.children = [projectBib, defaultCsl, alternativeCsl];
  projectBib.parent = projectResearch;
  defaultCsl.parent = projectResearch;
  alternativeCsl.parent = projectResearch;

  const researchA = new TFolder("RESEARCH/Research-A");
  const bibA = new TFile("RESEARCH/Research-A/bibA.bib");
  bibA.extension = "bib";
  const cslA = new TFile("RESEARCH/Research-A/cslA.csl");
  cslA.extension = "csl";
  researchA.children = [bibA, cslA];
  bibA.parent = researchA;
  cslA.parent = researchA;

  const researchB = new TFolder("RESEARCH/Research-B");
  const bibB = new TFile("RESEARCH/Research-B/bibB.bib");
  bibB.extension = "bib";
  const cslB = new TFile("RESEARCH/Research-B/cslB.csl");
  cslB.extension = "csl";
  researchB.children = [bibB, cslB];
  bibB.parent = researchB;
  cslB.parent = researchB;

  const { vault } = createFakeVault([
    project,
    folderA,
    docA1,
    docA2,
    folderB,
    docB1,
    folderC,
    docC1,
    projectResearch,
    projectBib,
    defaultCsl,
    alternativeCsl,
    researchA,
    bibA,
    cslA,
    researchB,
    bibB,
    cslB,
  ]);

  const app = { vault };

  const settings = {
    projectFolder: project.path,
    projectMeta: {
      [project.path]: {
        researchFolderLinks: {
          [project.path]: projectResearch.path,
          [folderA.path]: researchA.path,
          [folderB.path]: researchB.path,
        },
        folderWorkspaces: {
          "Folder-A": {
            version: 1,
            citekeyBibliographyPath: "bibA.bib",
            citekeyCslPath: "cslA.csl",
          },
          "Folder-B": {
            version: 1,
            citekeyBibliographyPath: "bibB.bib",
            citekeyCslPath: "cslB.csl",
          },
        },
        citekeyBibliographyPath: "project.bib",
        citekeyCslPath: "default.csl",
      },
    },
  };

  return {
    app,
    settings,
    project,
    folderA,
    docA1,
    docA2,
    folderB,
    docB1,
    folderC,
    docC1,
    projectResearch,
    projectBib,
    defaultCsl,
    alternativeCsl,
    researchA,
    bibA,
    cslA,
    researchB,
    bibB,
    cslB,
  };
}

test("A. single .bib and single .csl across all citing segments -> ready, 1 bibliography", () => {
  const f = createCitationResourcesFixture();
  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Premier paragraphe [@smith2024]." },
    { file: f.docA2, content: "Second paragraphe [@doe2023]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "ready");
  assert.equal(res.styleFile.path, f.cslA.path);
  assert.equal(res.bibliographyFiles.length, 1);
  assert.equal(res.bibliographyFiles[0].path, f.bibA.path);
  assert.ok(res.segmentResources.has(f.docA1.path));
  assert.ok(res.segmentResources.has(f.docA2.path));
});

test("B. two workspaces, two .bib, same .csl -> ready, bibliographies in first appearance order", () => {
  const f = createCitationResourcesFixture();
  // Align both workspaces to use the same CSL style from project
  delete f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-A"].citekeyCslPath;
  delete f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-B"].citekeyCslPath;

  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Citation A [@smith2024]." },
    { file: f.docB1, content: "Citation B [@doe2023]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "ready");
  assert.equal(res.styleFile.path, f.defaultCsl.path);
  assert.equal(res.bibliographyFiles.length, 2);
  assert.equal(res.bibliographyFiles[0].path, f.bibA.path);
  assert.equal(res.bibliographyFiles[1].path, f.bibB.path);
});

test("C. A.bib / B.bib / A.bib pattern deduplicates to [A.bib, B.bib] in first appearance order", () => {
  const f = createCitationResourcesFixture();
  delete f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-A"].citekeyCslPath;
  delete f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-B"].citekeyCslPath;

  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Segment 1 [@smith2024]." },
    { file: f.docB1, content: "Segment 2 [@doe2023]." },
    { file: f.docA2, content: "Segment 3 [@smith2024]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "ready");
  assert.equal(res.bibliographyFiles.length, 2);
  assert.equal(res.bibliographyFiles[0].path, f.bibA.path);
  assert.equal(res.bibliographyFiles[1].path, f.bibB.path);
});

test("D. two different .csl files across citing segments -> incompatible-style global fail-closed", () => {
  const f = createCitationResourcesFixture();
  // Folder-A uses cslA.csl, Folder-B uses cslB.csl
  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Citation 1 [@smith2024]." },
    { file: f.docB1, content: "Citation 2 [@doe2023]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "incompatible-style");
  assert.equal(res.conflictingStyles.length, 2);
  assert.equal(res.conflictingStyles[0].segmentPath, f.docA1.path);
  assert.equal(res.conflictingStyles[0].stylePath, f.cslA.path);
  assert.equal(res.conflictingStyles[1].segmentPath, f.docB1.path);
  assert.equal(res.conflictingStyles[1].stylePath, f.cslB.path);
  assert.ok(res.reason.includes("Conflicting CSL styles"));
});

test("E. missing .bib for a citing segment -> unavailable fail-closed", () => {
  const f = createCitationResourcesFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-A"].citekeyBibliographyPath =
    "missing-references.bib";

  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Citation [@smith2024]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "unavailable");
  assert.equal(res.resourceType, "bibliography");
  assert.equal(res.segmentPath, f.docA1.path);
  assert.equal(res.resourceStatus, "missing_file");
});

test("F. missing .csl for a citing segment -> unavailable fail-closed", () => {
  const f = createCitationResourcesFixture();
  f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-A"].citekeyCslPath =
    "missing-style.csl";

  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Citation [@smith2024]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "unavailable");
  assert.equal(res.resourceType, "csl");
  assert.equal(res.segmentPath, f.docA1.path);
  assert.equal(res.resourceStatus, "missing_file");
});

test("G. segment WITHOUT citation with different or broken config does NOT invalidate CSL", () => {
  const f = createCitationResourcesFixture();
  // Folder-B has a broken bibliography and a conflicting CSL style
  f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-B"].citekeyBibliographyPath =
    "nonexistent.bib";
  f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-B"].citekeyCslPath =
    "nonexistent.csl";

  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Citing text [@smith2024]." },
    { file: f.docB1, content: "Just plain prose without any citations at all." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  // Folder-B segment is non-citing, so it is never resolved or evaluated
  assert.equal(res.status, "ready");
  assert.equal(res.styleFile.path, f.cslA.path);
  assert.equal(res.bibliographyFiles.length, 1);
  assert.equal(res.bibliographyFiles[0].path, f.bibA.path);
  assert.ok(res.segmentResources.has(f.docA1.path));
  assert.ok(!res.segmentResources.has(f.docB1.path));
});

test("H. two citing files in the same workspace deduplicate resources cleanly", () => {
  const f = createCitationResourcesFixture();
  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Doc A1 [@smith2024]." },
    { file: f.docA2, content: "Doc A2 [@smith2024; @doe2023]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "ready");
  assert.equal(res.bibliographyFiles.length, 1);
  assert.equal(res.bibliographyFiles[0].path, f.bibA.path);
  assert.equal(res.styleFile.path, f.cslA.path);
});

test("I. inherited research association delegates to resolveWorkspaceCitationResources", () => {
  const f = createCitationResourcesFixture();
  // Folder-C has no workspace config and no explicit link, inherits project research
  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docC1, content: "Inherited cite [@smith2024]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "ready");
  assert.equal(res.styleFile.path, f.defaultCsl.path);
  assert.equal(res.bibliographyFiles.length, 1);
  assert.equal(res.bibliographyFiles[0].path, f.projectBib.path);
});

test("J. document with zero citations returns no-citations status", () => {
  const f = createCitationResourcesFixture();
  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Premier texte sans citation." },
    { file: f.docB1, content: "Second texte sans citation." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "no-citations");
  assert.equal(res.bibliographyFiles.length, 0);
  assert.equal(res.segmentResources.size, 0);
});

test("K. duplicate citekeys across distinct .bib files preserve both bibliographies without alteration", () => {
  const f = createCitationResourcesFixture();
  delete f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-A"].citekeyCslPath;
  delete f.settings.projectMeta[f.project.path].folderWorkspaces["Folder-B"].citekeyCslPath;

  // Both segments cite @smith2024, but resolve to bibA and bibB respectively
  const scriveningsDoc = buildScriveningsDocument([
    { file: f.docA1, content: "Citing smith in A [@smith2024]." },
    { file: f.docB1, content: "Citing smith in B [@smith2024]." },
  ]);
  const cslDoc = buildScriveningsCslDocument(scriveningsDoc);

  const res = resolveScriveningsCslResources(
    f.app,
    f.settings,
    f.project,
    scriveningsDoc,
    cslDoc
  );

  assert.equal(res.status, "ready");
  assert.equal(res.bibliographyFiles.length, 2);
  assert.equal(res.bibliographyFiles[0].path, f.bibA.path);
  assert.equal(res.bibliographyFiles[1].path, f.bibB.path);
});
