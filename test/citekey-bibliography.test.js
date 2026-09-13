import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  extractPandocCitekeys,
  extractCitekeysCached,
  clearCitekeyAnalysisCache,
  resolveBibliographicScope,
  findFilesSharingBibliographicScope,
  collectScopeCitedBibtexEntries,
  bibtexEntryToBibliographyEntry,
} from "../src/services/citekey-bibliography.js";

test("extractPandocCitekeys: extracts single, suppressed author, locator, and grouped citations", () => {
  const markdown = `
Here is a single citation [@smith2024].
A citation with suppressed author [-@brown2021].
A citation with locator [@smith2024, p. 42] and range [@doe2023, pp. 10-15].
Grouped citations [@alpha2020; @beta2022, ch. 3].
Prefix and suffix [see @gamma2019, p. 5; also @delta2018].
`;

  const counts = extractPandocCitekeys(markdown);
  assert.equal(counts.get("smith2024"), 2);
  assert.equal(counts.get("brown2021"), 1);
  assert.equal(counts.get("doe2023"), 1);
  assert.equal(counts.get("alpha2020"), 1);
  assert.equal(counts.get("beta2022"), 1);
  assert.equal(counts.get("gamma2019"), 1);
  assert.equal(counts.get("delta2018"), 1);
});

test("extractPandocCitekeys: extracts citations inside inline and block footnotes", () => {
  const markdown = `
Main body text^[An inline footnote citing [@inlineNote2024, p. 12]].
Another paragraph[^fn1].

[^fn1]: Footnote definition citing [@blockNote2023] and [@blockNote2023, p. 99].
`;

  const counts = extractPandocCitekeys(markdown);
  assert.equal(counts.get("inlineNote2024"), 1);
  assert.equal(counts.get("blockNote2023"), 2);
});

test("extractPandocCitekeys: ignores syntactic exclusions (code, frontmatter, links, escaped, comments, html)", () => {
  const markdown = `---
title: "Ignored Frontmatter"
citations: [@frontmatterKey]
---

<!-- HTML comment with [@commentKey] -->

Fenced code blocks:
\`\`\`markdown
[@fencedKey1]
\`\`\`

~~~
[@fencedKey2]
~~~

Inline code \`[@inlineKey]\` and \`\`[@inlineKey2]\`\`.

HTML code and pre:
<code>[@codeTagKey]</code>
<pre>
[@preTagKey]
</pre>

Escaped brackets:
\\[@escapedKey\\]
\\[@escapedGroup; @escapedKey2\\]

Links:
[Link description](@linkUrlKey)
[Reference link][@refLinkKey]
[[@wikilinkKey]]

Narrative citation (not in brackets):
@narrativeKey was not cited in brackets.

Valid citekey in body:
[@validKey]
`;

  const counts = extractPandocCitekeys(markdown);
  assert.equal(counts.size, 1);
  assert.equal(counts.get("validKey"), 1);
  assert.equal(counts.has("frontmatterKey"), false);
  assert.equal(counts.has("commentKey"), false);
  assert.equal(counts.has("fencedKey1"), false);
  assert.equal(counts.has("fencedKey2"), false);
  assert.equal(counts.has("inlineKey"), false);
  assert.equal(counts.has("codeTagKey"), false);
  assert.equal(counts.has("preTagKey"), false);
  assert.equal(counts.has("escapedKey"), false);
  assert.equal(counts.has("linkUrlKey"), false);
  assert.equal(counts.has("refLinkKey"), false);
  assert.equal(counts.has("wikilinkKey"), false);
  assert.equal(counts.has("narrativeKey"), false);
});

test("extractCitekeysCached: reuses cache on identical path, mtime and size", () => {
  clearCitekeyAnalysisCache();
  const file = new TFile("Chapter/Scene.md", "[@cachedKey]");
  file.stat = { mtime: 1000, size: 12, ctime: 500 };

  const first = extractCitekeysCached(file, "[@cachedKey]");
  assert.equal(first.get("cachedKey"), 1);

  // Second read with altered content string but identical stat should return cached
  const second = extractCitekeysCached(file, "[@differentKey]");
  assert.equal(second.get("cachedKey"), 1);
  assert.equal(second.has("differentKey"), false);

  // Modifying mtime causes re-analysis
  file.stat.mtime = 2000;
  const third = extractCitekeysCached(file, "[@differentKey]");
  assert.equal(third.get("differentKey"), 1);
  assert.equal(third.has("cachedKey"), false);
});

test("scope resolution: multiple files inheriting the same .bib are included", () => {
  const project = new TFolder("Project");
  const manuscript = new TFolder("Project/Manuscrit");
  const chapter1 = new TFolder("Project/Manuscrit/Chapter 1");
  const scene1 = new TFile("Project/Manuscrit/Chapter 1/Scene 1.md", "[@keyA]");
  const scene2 = new TFile("Project/Manuscrit/Chapter 1/Scene 2.md", "[@keyB]");
  chapter1.children = [scene1, scene2];
  scene1.parent = chapter1;
  scene2.parent = chapter1;
  manuscript.children = [chapter1];
  chapter1.parent = manuscript;
  project.children = [manuscript];
  manuscript.parent = project;

  const projectResearch = new TFolder("Project/Research");
  const bibFile = new TFile("Project/Research/refs.bib", "@article{keyA, author={Smith}, year={2020}}\n@article{keyB, author={Jones}, year={2021}}");
  projectResearch.children = [bibFile];
  bibFile.parent = projectResearch;

  const { vault } = createFakeVault([project, manuscript, chapter1, scene1, scene2, projectResearch, bibFile]);
  const app = { vault };
  const settings = {
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project": projectResearch.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
  };

  const { bibFile: resolvedBib, definingScope } = resolveBibliographicScope(app, settings, project, scene1);
  assert.ok(resolvedBib);
  assert.equal(resolvedBib.path, "Project/Research/refs.bib");
  assert.ok(definingScope);

  const sharedFiles = findFilesSharingBibliographicScope(app, settings, project, definingScope, resolvedBib.path);
  assert.equal(sharedFiles.length, 2);
  assert.ok(sharedFiles.some((f) => f.path === scene1.path));
  assert.ok(sharedFiles.some((f) => f.path === scene2.path));
});

test("scope resolution: excludes sibling branches not sharing the scope", () => {
  const project = new TFolder("Project");
  const workA = new TFolder("Project/Work-A");
  const sceneA = new TFile("Project/Work-A/SceneA.md", "[@keyA]");
  const resA = new TFolder("Project/Work-A/Research");
  const bibA = new TFile("Project/Work-A/Research/refsA.bib", "@article{keyA, author={AuthorA}, year={2020}}");
  resA.children = [bibA];
  bibA.parent = resA;
  workA.children = [sceneA, resA];
  sceneA.parent = workA;
  resA.parent = workA;

  const workB = new TFolder("Project/Work-B");
  const sceneB = new TFile("Project/Work-B/SceneB.md", "[@keyB]");
  const resB = new TFolder("Project/Work-B/Research");
  const bibB = new TFile("Project/Work-B/Research/refsB.bib", "@article{keyB, author={AuthorB}, year={2021}}");
  resB.children = [bibB];
  bibB.parent = resB;
  workB.children = [sceneB, resB];
  sceneB.parent = workB;
  resB.parent = workB;

  project.children = [workA, workB];
  workA.parent = project;
  workB.parent = project;

  const { vault } = createFakeVault([project, workA, workB, sceneA, sceneB, resA, resB, bibA, bibB]);
  const app = { vault };
  const settings = {
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project/Work-A": resA.path,
          "Project/Work-B": resB.path,
        },
        folderWorkspaces: {
          "Work-A": { citekeyBibliographyPath: "refsA.bib" },
          "Work-B": { citekeyBibliographyPath: "refsB.bib" },
        },
      },
    },
  };

  const { bibFile, definingScope } = resolveBibliographicScope(app, settings, project, sceneA);
  assert.ok(bibFile);
  assert.equal(bibFile.path, "Project/Work-A/Research/refsA.bib");
  assert.equal(definingScope.path, "Project/Work-A");

  const sharedFiles = findFilesSharingBibliographicScope(app, settings, project, definingScope, bibFile.path);
  assert.equal(sharedFiles.length, 1);
  assert.equal(sharedFiles[0].path, "Project/Work-A/SceneA.md");
  assert.ok(!sharedFiles.some((f) => f.path.includes("Work-B")));
});

test("scope resolution: sub-branch with its own .bib is excluded from parent scope", () => {
  const project = new TFolder("Project");
  const workA = new TFolder("Project/Work-A");
  const parentScene = new TFile("Project/Work-A/Intro.md", "[@parentKey]");
  const parentRes = new TFolder("Project/Work-A/Research");
  const parentBib = new TFile("Project/Work-A/Research/parent.bib", "@article{parentKey, author={ParentAuthor}, year={2020}}");
  parentRes.children = [parentBib];
  parentBib.parent = parentRes;

  const chapterA = new TFolder("Project/Work-A/Chapter-A");
  const childScene = new TFile("Project/Work-A/Chapter-A/Detail.md", "[@childKey]");
  const childRes = new TFolder("Project/Work-A/Chapter-A/Research");
  const childBib = new TFile("Project/Work-A/Chapter-A/Research/child.bib", "@article{childKey, author={ChildAuthor}, year={2022}}");
  childRes.children = [childBib];
  childBib.parent = childRes;

  chapterA.children = [childScene, childRes];
  childScene.parent = chapterA;
  childRes.parent = chapterA;

  workA.children = [parentScene, parentRes, chapterA];
  parentScene.parent = workA;
  parentRes.parent = workA;
  chapterA.parent = workA;

  project.children = [workA];
  workA.parent = project;

  const { vault } = createFakeVault([project, workA, parentScene, parentRes, parentBib, chapterA, childScene, childRes, childBib]);
  const app = { vault };
  const settings = {
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project/Work-A": parentRes.path,
          "Project/Work-A/Chapter-A": childRes.path,
        },
        folderWorkspaces: {
          "Work-A": { citekeyBibliographyPath: "parent.bib" },
          "Work-A/Chapter-A": { citekeyBibliographyPath: "child.bib" },
        },
      },
    },
  };

  // Resolving parent file scope: Intro.md
  const { bibFile: parentBibFile, definingScope: parentScope } = resolveBibliographicScope(app, settings, project, parentScene);
  assert.ok(parentBibFile);
  assert.equal(parentBibFile.path, "Project/Work-A/Research/parent.bib");
  assert.equal(parentScope.path, "Project/Work-A");

  const parentSharedFiles = findFilesSharingBibliographicScope(app, settings, project, parentScope, parentBibFile.path);
  assert.equal(parentSharedFiles.length, 1);
  assert.equal(parentSharedFiles[0].path, "Project/Work-A/Intro.md");

  // Resolving child file scope: Detail.md
  const { bibFile: childBibFile, definingScope: childScope } = resolveBibliographicScope(app, settings, project, childScene);
  assert.ok(childBibFile);
  assert.equal(childBibFile.path, "Project/Work-A/Chapter-A/Research/child.bib");
  assert.equal(childScope.path, "Project/Work-A/Chapter-A");

  const childSharedFiles = findFilesSharingBibliographicScope(app, settings, project, childScope, childBibFile.path);
  assert.equal(childSharedFiles.length, 1);
  assert.equal(childSharedFiles[0].path, "Project/Work-A/Chapter-A/Detail.md");
});

test("scope resolution: never mutates settings", () => {
  const project = new TFolder("Project");
  const file = new TFile("Project/Document.md", "[@key]");
  const projectResearch = new TFolder("Project/Research");
  const bib = new TFile("Project/Research/refs.bib", "@article{key, author={Smith}, year={2020}}");
  projectResearch.children = [bib];
  bib.parent = projectResearch;
  project.children = [file, projectResearch];
  file.parent = project;
  projectResearch.parent = project;

  const { vault } = createFakeVault([project, file, projectResearch, bib]);
  const app = { vault };
  const settings = {
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project": projectResearch.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
  };

  const snapshot = JSON.stringify(settings);
  resolveBibliographicScope(app, settings, project, file);
  assert.equal(JSON.stringify(settings), snapshot);
});

test("collectScopeCitedBibtexEntries: collects known entries and reports unknown keys", async () => {
  const project = new TFolder("Project");
  const scene = new TFile("Project/Scene.md", "Here is [@knownKey] and another [@knownKey], plus [@unknownKey].");
  scene.stat = { mtime: 1000, size: scene.content.length, ctime: 500 };
  const projectResearch = new TFolder("Project/Research");
  const bib = new TFile("Project/Research/refs.bib", `@article{knownKey,
    author = {Knuth, Donald},
    title = {The Art of Computer Programming},
    year = {1968}
  }`);
  bib.stat = { mtime: 1000, size: bib.content.length, ctime: 500 };
  projectResearch.children = [bib];
  bib.parent = projectResearch;

  project.children = [scene, projectResearch];
  scene.parent = project;
  projectResearch.parent = project;

  const { vault } = createFakeVault([project, scene, projectResearch, bib]);
  const app = { vault };
  const settings = {
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project": projectResearch.path,
        },
        citekeyBibliographyPath: "refs.bib",
      },
    },
  };

  const result = await collectScopeCitedBibtexEntries(app, settings, project, scene);
  assert.ok(result.bibFile);
  assert.equal(result.bibFile.path, "Project/Research/refs.bib");
  assert.equal(result.knownEntries.length, 1);
  assert.equal(result.knownEntries[0].citekey, "knownKey");
  assert.equal(result.knownEntries[0].count, 2);
  assert.equal(result.knownEntries[0].entry.author, "Knuth, Donald");
  assert.equal(result.unknownKeys.length, 1);
  assert.equal(result.unknownKeys[0].citekey, "unknownKey");
  assert.equal(result.unknownKeys[0].count, 1);
  assert.equal(result.allBibliographyEntries.length, 1);
  assert.equal(result.allBibliographyEntries[0].citekey, "knownKey");
  assert.equal(result.allBibliographyEntries[0].bibliographyFilePath, "Project/Research/refs.bib");
});

test("bibtexEntryToBibliographyEntry: maps fields and provenance accurately", () => {
  const entry = {
    key: "shannon1948",
    type: "article",
    title: "A Mathematical Theory of Communication",
    authors: ["Shannon"],
    year: "1948",
    author: "Shannon, Claude",
    journal: "Bell System Technical Journal",
    volume: "27",
    number: "3",
    pages: "379-423",
    date: "1948",
    doi: "10.1002/j.1538-7305.1948.tb01338.x",
    url: "https://example.org/shannon",
  };

  const bib = bibtexEntryToBibliographyEntry(entry, "Vault/refs.bib");
  assert.equal(bib.citekey, "shannon1948");
  assert.equal(bib.bibliographyFilePath, "Vault/refs.bib");
  assert.equal(bib.author, "Shannon, Claude");
  assert.equal(bib.title, "A Mathematical Theory of Communication");
  assert.equal(bib.journal, "Bell System Technical Journal");
  assert.equal(bib.volume, "27");
  assert.equal(bib.number, "3");
  assert.equal(bib.pages, "379-423");
  assert.equal(bib.date, "1948");
  assert.equal(bib.doi, "10.1002/j.1538-7305.1948.tb01338.x");
  assert.equal(bib.url, "https://example.org/shannon");
});

test("project scope: .bib defined at project root covers inheriting branches and excludes sub-branches with their own .bib", async () => {
  const project = new TFolder("Project");
  const resProject = new TFolder("Project/_Research");
  const bibRoot = new TFile("Project/_Research/root.bib", `@article{rootKey,
    author = {Root, Rebecca},
    title = {Root Scope Study},
    year = {2020}
  }`);
  bibRoot.extension = "bib";
  bibRoot.stat = { mtime: 1000, size: bibRoot.content.length };
  resProject.children = [bibRoot];
  bibRoot.parent = resProject;

  // Inheriting branch 1
  const chapter1 = new TFolder("Project/Chapter1");
  const scene1 = new TFile("Project/Chapter1/Scene1.md", "Scene 1 citing [@rootKey].");
  scene1.extension = "md";
  scene1.stat = { mtime: 1000, size: scene1.content.length };
  chapter1.children = [scene1];
  scene1.parent = chapter1;

  // Inheriting branch 2
  const chapter2 = new TFolder("Project/Chapter2");
  const scene2 = new TFile("Project/Chapter2/Scene2.md", "Scene 2 citing [@rootKey].");
  scene2.extension = "md";
  scene2.stat = { mtime: 1000, size: scene2.content.length };
  chapter2.children = [scene2];
  scene2.parent = chapter2;

  // Sub-branch with its own .bib
  const subBranch = new TFolder("Project/SubBranch");
  const resSub = new TFolder("Project/SubBranch/Research");
  const bibSub = new TFile("Project/SubBranch/Research/sub.bib", `@article{subKey,
    author = {Sub, Sam},
    title = {Sub Branch Study},
    year = {2023}
  }`);
  bibSub.extension = "bib";
  bibSub.stat = { mtime: 1000, size: bibSub.content.length };
  resSub.children = [bibSub];
  bibSub.parent = resSub;
  const subScene = new TFile("Project/SubBranch/Detail.md", "Sub detail citing [@subKey].");
  subScene.extension = "md";
  subScene.stat = { mtime: 1000, size: subScene.content.length };
  subBranch.children = [resSub, subScene];
  resSub.parent = subBranch;
  subScene.parent = subBranch;

  project.children = [resProject, chapter1, chapter2, subBranch];
  resProject.parent = project;
  chapter1.parent = project;
  chapter2.parent = project;
  subBranch.parent = project;

  const { vault } = createFakeVault([
    project, resProject, bibRoot,
    chapter1, scene1,
    chapter2, scene2,
    subBranch, resSub, bibSub, subScene,
  ]);
  vault.cachedRead = vault.read;
  const app = { vault };
  const settings = {
    projectMeta: {
      "Project": {
        researchFolderLinks: {
          "Project": resProject.path,
          "Project/SubBranch": resSub.path,
        },
        citekeyBibliographyPath: "root.bib",
        folderWorkspaces: {
          "SubBranch": { citekeyBibliographyPath: "sub.bib" },
        },
      },
    },
  };

  // 1. Resolve scope from an inheriting file (Scene 1)
  const { bibFile, definingScope } = resolveBibliographicScope(app, settings, project, scene1);
  assert.ok(bibFile, "Root .bib must be resolved");
  assert.equal(bibFile.path, "Project/_Research/root.bib");
  assert.equal(definingScope.path, "Project", "Defining scope is project root");

  // 2. Find files sharing root scope: must include chapter1 and chapter2, must exclude subBranch
  const sharedFiles = findFilesSharingBibliographicScope(app, settings, project, definingScope, bibFile.path);
  assert.equal(sharedFiles.length, 2, "Should include both inheriting scenes");
  const paths = sharedFiles.map((f) => f.path);
  assert.ok(paths.includes("Project/Chapter1/Scene1.md"), "Includes Scene 1");
  assert.ok(paths.includes("Project/Chapter2/Scene2.md"), "Includes Scene 2");
  assert.ok(!paths.includes("Project/SubBranch/Detail.md"), "Excludes SubBranch file with its own .bib");

  // 3. Collect cited entries across root scope
  const result = await collectScopeCitedBibtexEntries(app, settings, project, scene1);
  assert.equal(result.knownEntries.length, 1);
  assert.equal(result.knownEntries[0].citekey, "rootKey");
  assert.equal(result.knownEntries[0].count, 2, "Aggregates counts across all inheriting branches");
  assert.equal(result.knownEntries[0].entry.author, "Root, Rebecca");
  assert.ok(!result.knownEntries.some((e) => e.citekey === "subKey"), "Sub-branch citekey is excluded");
});
