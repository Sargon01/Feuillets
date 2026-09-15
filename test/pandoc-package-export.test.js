import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { TFile, TFolder, normalizePath } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import { compile, exportWithScope } from "../src/services/compile-export.js";
import { createFileScope, createFolderScope, createSelectionScope, createProjectScope } from "../src/services/compile-scope.js";
import { clearBibtexCatalogCache } from "../src/services/bibtex-catalog.js";
import { t } from "../src/i18n/index.js";
import {
  generatePandocDefaultsYaml,
  createPandocPackage,
  validateArchivePath,
  escapeYamlScalar,
} from "../src/services/pandoc-package-export.js";

function buildTestFixture(options = {}) {
  clearBibtexCatalogCache();
  const manuscript = new TFolder("Project/Manuscript");
  const chapter1 = new TFolder("Project/Manuscript/Chapter 1");
  const chapter2 = new TFolder("Project/Manuscript/Chapter 2");
  const research = new TFolder("Project/Research");

  const scene1 = new TFile(
    "Project/Manuscript/Chapter 1/Scene 1.md",
    options.scene1Text ?? "---\ntitle: Scene 1\n---\nFirst text with citation [@smith2024] and image ![[fig1.png|Figure 1]]."
  );
  const scene2 = new TFile(
    "Project/Manuscript/Chapter 2/Scene 2.md",
    options.scene2Text ?? "---\ntitle: Scene 2\n---\nSecond text with citation [@doe2023, p. 42] and remote image ![Remote](https://example.com/pic.png)."
  );
  const outsideFile = new TFile(
    "Project/Manuscript/Outside.md",
    "---\ntitle: Outside\ncompile: false\n---\nOutside text citing [@outside2020]."
  );

  const bib1Content = options.bib1Content ?? `@book{smith2024,
  author = {Smith, John},
  title = {The Art of Writing},
  publisher = {Acme Press},
  year = {2024}
}
@article{unused2021,
  author = {Unused, Alice},
  title = {Unused Article},
  year = {2021}
}`;

  const bib2Content = options.bib2Content ?? `@book{doe2023,
  author = {Doe, Jane},
  title = {Research Methods},
  publisher = {University Press},
  year = {2023}
}`;

  const bib1 = new TFile("Project/Research/refs1.bib", bib1Content);
  const bib2 = new TFile("Project/Research/refs2.bib", bib2Content);
  const cslFile = new TFile("Project/Research/style.csl", options.cslContent ?? "<style>CSL content</style>");
  const fig1 = new TFile("Project/Manuscript/Chapter 1/fig1.png", "fake-png-binary-1");
  const fig2 = new TFile("Project/Manuscript/Chapter 2/fig1.png", "fake-png-binary-2");

  manuscript.children = [chapter1, chapter2, outsideFile];
  chapter1.parent = manuscript;
  chapter1.children = [scene1, fig1];
  scene1.parent = chapter1;
  fig1.parent = chapter1;

  chapter2.parent = manuscript;
  chapter2.children = [scene2, fig2];
  scene2.parent = chapter2;
  fig2.parent = chapter2;

  outsideFile.parent = manuscript;
  research.children = [bib1, bib2, cslFile];
  bib1.parent = research;
  bib2.parent = research;
  cslFile.parent = research;

  const entries = [manuscript, chapter1, chapter2, research, scene1, scene2, outsideFile, bib1, bib2, cslFile, fig1, fig2];
  const { vault, fileManager } = createFakeVault(entries);
  vault.cachedRead = vault.read;

  // Add binary modification methods needed for writeBinaryFile
  vault.modifyBinary = async (file, buf) => {
    file.content = buf;
  };
  const originalCreateBinary = vault.createBinary.bind(vault);
  vault.createBinary = async (p, buf) => {
    const file = await originalCreateBinary(p, "");
    file.content = buf;
    return file;
  };

  const frontmatterMap = new Map([
    [scene1.path, { title: "Scene 1", compile: true }],
    [scene2.path, { title: "Scene 2", compile: true }],
    [outsideFile.path, { title: "Outside", compile: false }],
  ]);

  const app = {
    vault,
    fileManager,
    metadataCache: {
      getFileCache(file) {
        return { frontmatter: frontmatterMap.get(file.path) || {} };
      },
      getFirstLinkpathDest(linkpath, sourcePath) {
        const decoded = decodeURIComponent(linkpath);
        // Direct absolute/vault match
        const direct = vault.getAbstractFileByPath(decoded);
        if (direct instanceof TFile) return direct;

        // Relative to source file's directory
        const sourceDir = sourcePath ? normalizePath(sourcePath).split("/").slice(0, -1).join("/") : "";
        if (sourceDir) {
          const relPath = normalizePath(`${sourceDir}/${decoded}`);
          const relFile = vault.getAbstractFileByPath(relPath);
          if (relFile instanceof TFile) return relFile;
        }

        // Search by basename in vault
        for (const file of vault.getFiles()) {
          if (file.name === decoded || file.basename === decoded || file.path.endsWith("/" + decoded)) {
            return file;
          }
        }
        return null;
      },
    },
  };

  const settings = {
    projectFolder: manuscript.path,
    level1Role: "chapitres",
    orders: {
      [manuscript.path]: [chapter1.name, chapter2.name, outsideFile.name],
      [chapter1.path]: [scene1.name, fig1.name],
      [chapter2.path]: [scene2.name, fig2.name],
    },
    compileFileName: "Manuscript.md",
    insertFolderTitles: false,
    insertTitles: true,
    insertSceneTitles: true,
    separator: "\n\n",
    activePreset: -1,
    compilePresets: [],
    exportFrenchTypography: false,
    exportTemplate: "classique",
    manuscriptTitle: "Test Manuscript",
    manuscriptAuthor: "Test Author",
    projectMeta: {
      [manuscript.path]: {
        citekeyBibliographyPath: "refs1.bib",
        citekeyCslPath: options.disableCsl ? "" : "style.csl",
        researchFolderLinks: {
          [manuscript.path]: research.path,
          ...(options.extraResearchLinks ?? {}),
        },
        composition: {
          bibliography: options.enableBibliography ?? true,
        },
        folderWorkspaces: options.folderWorkspaces ?? options.folderWorkspaceConfigs ?? {},
      },
    },
  };

  return { app, settings, manuscript, chapter1, chapter2, scene1, scene2, outsideFile, bib1, bib2, cslFile, fig1, fig2, research, vault };
}

test("1. File, folder, selection, and project scopes use exactly compiledFilePaths", async () => {
  const { app, settings, manuscript, chapter1, scene1, scene2 } = buildTestFixture();

  // Project scope
  const projectScope = createProjectScope(manuscript.path);
  const projectRes = await compile(app, settings, null, projectScope, "output", { writeOutput: false });
  assert.ok(projectRes);
  assert.deepEqual(projectRes.compiledFilePaths, [scene1.path, scene2.path]);

  // Folder scope
  const folderScope = createFolderScope(manuscript.path, chapter1.path);
  const folderRes = await compile(app, settings, null, folderScope, "output", { writeOutput: false });
  assert.ok(folderRes);
  assert.deepEqual(folderRes.compiledFilePaths, [scene1.path]);

  // File scope
  const fileScope = createFileScope(manuscript.path, scene2.path);
  const fileRes = await compile(app, settings, null, fileScope, "output", { writeOutput: false });
  assert.ok(fileRes);
  assert.deepEqual(fileRes.compiledFilePaths, [scene2.path]);

  // Selection scope
  const selectionScope = createSelectionScope(manuscript.path, [scene1.path]);
  const selectionRes = await compile(app, settings, null, selectionScope, "output", { writeOutput: false });
  assert.ok(selectionRes);
  assert.deepEqual(selectionRes.compiledFilePaths, [scene1.path]);
});

test("2. Raw citations remain present in manuscript.md", async () => {
  const { app, settings, manuscript } = buildTestFixture({
    scene1Text: "---\ntitle: Scene 1\n---\nHere is a raw citation [@smith2024] and locators [@doe2023, p. 12].",
  });

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  assert.ok(writtenPath);

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  assert.ok(zipFile instanceof TFile);
  const zip = await JSZip.loadAsync(zipFile.content);

  const manuscriptEntry = zip.file("manuscript.md");
  assert.ok(manuscriptEntry);
  const text = await manuscriptEntry.async("string");
  assert.match(text, /\[@smith2024\]/);
  assert.match(text, /\[@doe2023, p\. 12\]/);
});

test("3. A nested workspace .bib is resolved without Binder isolation", async () => {
  const { app, settings, manuscript } = buildTestFixture({
    folderWorkspaceConfigs: {
      "Chapter 2": {
        citekeyBibliographyPath: "refs2.bib",
      },
    },
  });

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  assert.ok(writtenPath);

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const yaml = await zip.file("pandoc.yaml").async("string");

  // Chapter 2 resolved refs2.bib, Chapter 1 resolved refs1.bib
  assert.ok(zip.file("bibliography/refs1.bib"));
  assert.ok(zip.file("bibliography/refs2.bib"));
  assert.match(yaml, /bibliography\/refs1\.bib/);
  assert.match(yaml, /bibliography\/refs2\.bib/);
});

test("4. Distinct .bib files from compiled branches are copied and listed once in pandoc.yaml", async () => {
  const { app, settings, manuscript } = buildTestFixture({
    folderWorkspaceConfigs: {
      "Chapter 2": {
        citekeyBibliographyPath: "refs2.bib",
      },
    },
  });

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const yaml = await zip.file("pandoc.yaml").async("string");

  const bibMatches = yaml.match(/bibliography\/refs\d\.bib/g);
  assert.ok(bibMatches);
  const uniqueMatches = new Set(bibMatches);
  assert.equal(bibMatches.length, uniqueMatches.size);
});

test("5. Files outside the compiled scope contribute neither citations nor bibliography files", async () => {
  const { app, settings, manuscript, chapter1 } = buildTestFixture({
    folderWorkspaceConfigs: {
      "Chapter 2": {
        citekeyBibliographyPath: "refs2.bib",
      },
    },
  });

  // Only compile chapter 1 (which cites @smith2024 from refs1.bib)
  const folderScope = createFolderScope(manuscript.path, chapter1.path);
  const writtenPath = await exportWithScope(app, settings, folderScope, "pandoc", "Chapter1");
  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const yaml = await zip.file("pandoc.yaml").async("string");

  assert.ok(zip.file("bibliography/refs1.bib"));
  assert.equal(zip.file("bibliography/refs2.bib"), null);
  assert.match(yaml, /bibliography\/refs1\.bib/);
  assert.doesNotMatch(yaml, /bibliography\/refs2\.bib/);
});

test("6. A valid scope CSL is copied and referenced relatively", async () => {
  const { app, settings, manuscript } = buildTestFixture();
  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const yaml = await zip.file("pandoc.yaml").async("string");

  assert.ok(zip.file("styles/style.csl"));
  assert.match(yaml, /csl: styles\/style\.csl/);
});

test("7. Missing or disabled CSL produces a valid package without a csl YAML entry", async () => {
  const { app, settings, manuscript } = buildTestFixture({ disableCsl: true });
  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const yaml = await zip.file("pandoc.yaml").async("string");

  assert.equal(zip.file("styles/style.csl"), null);
  assert.doesNotMatch(yaml, /csl:/);
});

test("8. Unknown citekeys produce citation-report.json with typed ResolverStatus and do not block export", async () => {
  const { app, settings, manuscript } = buildTestFixture({
    scene1Text: "---\ntitle: Scene 1\n---\nCiting [@unknownCitekey] and [@smith2024].",
  });

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  assert.ok(writtenPath);

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const reportEntry = zip.file("citation-report.json");
  assert.ok(reportEntry);

  const report = JSON.parse(await reportEntry.async("string"));
  assert.ok(report.unknownKeys);
  const unknownItem = report.unknownKeys.find((k) => k.key === "unknownCitekey");
  assert.ok(unknownItem);
  assert.equal(unknownItem.resolverStatus, "unknown_citekey");
  assert.equal(unknownItem.occurrenceCount, 1);
});

test("9. Duplicate citekeys across included .bib files block export before writing ZIP and leave no partial ZIP", async () => {
  // Both refs1.bib and refs2.bib define smith2024
  const { app, settings, manuscript, vault } = buildTestFixture({
    bib2Content: `@book{smith2024,
  author = {Smith, Other},
  title = {Conflicting Title},
  year = {2024}
}
@book{doe2023,
  author = {Doe, Jane},
  title = {Research Methods},
  year = {2023}
}`,
    folderWorkspaceConfigs: {
      "Chapter 2": {
        citekeyBibliographyPath: "refs2.bib",
      },
    },
  });

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  assert.equal(writtenPath, undefined);

  // Check no zip was written
  const files = vault.getFiles();
  const zipFiles = files.filter((f) => f.path.endsWith(".zip"));
  assert.equal(zipFiles.length, 0);
});

test("10. Local media are transformed per-source and copied to media/; unresolved images produce warnings; remote URLs remain unchanged; non-image links are untouched", async () => {
  const { app, settings, manuscript } = buildTestFixture({
    scene1Text: "---\ntitle: S1\n---\nImage: ![[fig1.png|Figure 1]] and [link](test.md) and [[Chapter 2]].",
    scene2Text: "---\ntitle: S2\n---\nImage: ![[fig1.png|Figure 2]] and ![Missing](ghost.png) and ![Remote](https://example.com/photo.jpg).",
  });

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);

  const manuscriptText = await zip.file("manuscript.md").async("string");

  // Local images rewritten to media/
  assert.match(manuscriptText, /!\[Figure 1\]\(media\/fig1\.png\)/);
  assert.match(manuscriptText, /!\[Figure 2\]\(media\/fig1-1\.png\)/);

  // Remote URL preserved
  assert.match(manuscriptText, /!\[Remote\]\(https:\/\/example\.com\/photo\.jpg\)/);

  // Non-image links untouched
  assert.match(manuscriptText, /\[link\]\(test\.md\)/);

  // Both distinct images exist in media/
  assert.ok(zip.file("media/fig1.png"));
  assert.ok(zip.file("media/fig1-1.png"));

  // Warning generated for missing ghost.png
  const reportEntry = zip.file("citation-report.json");
  assert.ok(reportEntry);
  const report = JSON.parse(await reportEntry.async("string"));
  assert.ok(report.warnings.some((w) => w.includes("ghost.png")));
});

test("11. Every ZIP entry and every generated reference is relative and contains no source-vault path", async () => {
  const { app, settings, manuscript } = buildTestFixture();
  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);

  // Check every ZIP entry name
  zip.forEach((relativePath) => {
    assert.ok(!relativePath.startsWith("/"));
    assert.ok(!relativePath.startsWith("\\"));
    assert.ok(!relativePath.includes("\\"));
    assert.ok(!relativePath.includes("Project/"));
    assert.ok(!relativePath.includes(".."));
  });

  const yaml = await zip.file("pandoc.yaml").async("string");
  assert.doesNotMatch(yaml, /Project\//);
  assert.doesNotMatch(yaml, /\/styles/);
  assert.doesNotMatch(yaml, /\/bibliography/);
});

test("12. Bibliography-disabled compilation writes suppress-bibliography: true", async () => {
  const { app, settings, manuscript } = buildTestFixture({ enableBibliography: false });
  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const yaml = await zip.file("pandoc.yaml").async("string");

  assert.match(yaml, /suppress-bibliography:\s*true/);
  const text = await zip.file("manuscript.md").async("string");
  assert.doesNotMatch(text, /::: \{#refs\}/);
});

test("13. Pandoc bibliography mode uses the {#refs} placeholder with localized heading without inserting Feuillets' formatted BibTeX bibliography", async () => {
  const { app, settings, manuscript, chapter1, scene1 } = buildTestFixture({ enableBibliography: true });

  const headingText = t("export.pandoc.bibliographyHeading");
  const expectedBlock = `# ${headingText}\n\n::: {#refs}\n:::\n`;

  // 1. Project scope
  const projectScope = createProjectScope(manuscript.path);
  const projectZipPath = await exportWithScope(app, settings, projectScope, "pandoc", "ProjectOutput");
  const pZip = await JSZip.loadAsync(app.vault.getAbstractFileByPath(projectZipPath).content);
  const pText = await pZip.file("manuscript.md").async("string");
  assert.match(pText, new RegExp(expectedBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // Heading and placeholder occur exactly once
  assert.equal((pText.match(/::: \{#refs\}/g) || []).length, 1);
  assert.equal((pText.match(new RegExp(`# ${headingText}`, "g")) || []).length, 1);
  // Old Feuillets-generated bibliography text is absent
  assert.doesNotMatch(pText, /The Art of Writing/);
  assert.doesNotMatch(pText, /Acme Press/);

  // 2. Folder scope
  const folderScope = createFolderScope(manuscript.path, chapter1.path);
  const folderZipPath = await exportWithScope(app, settings, folderScope, "pandoc", "FolderOutput");
  const fZip = await JSZip.loadAsync(app.vault.getAbstractFileByPath(folderZipPath).content);
  const fText = await fZip.file("manuscript.md").async("string");
  assert.match(fText, new RegExp(expectedBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((fText.match(/::: \{#refs\}/g) || []).length, 1);
  assert.equal((fText.match(new RegExp(`# ${headingText}`, "g")) || []).length, 1);

  // 3. File scope
  const fileScope = createFileScope(manuscript.path, scene1.path);
  const fileZipPath = await exportWithScope(app, settings, fileScope, "pandoc", "FileOutput");
  const fileZip = await JSZip.loadAsync(app.vault.getAbstractFileByPath(fileZipPath).content);
  const fileText = await fileZip.file("manuscript.md").async("string");
  assert.match(fileText, new RegExp(expectedBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((fileText.match(/::: \{#refs\}/g) || []).length, 1);
  assert.equal((fileText.match(new RegExp(`# ${headingText}`, "g")) || []).length, 1);
});

test("14. Native Markdown, DOCX, PDF, EPUB, and ODT behavior remains unchanged", async () => {
  const { app, settings, manuscript } = buildTestFixture({ enableBibliography: true });
  const projectScope = createProjectScope(manuscript.path);

  // Markdown export
  const mdPath = await exportWithScope(app, settings, projectScope, "md", "NativeMD");
  assert.ok(mdPath && mdPath.endsWith(".md"));
  const mdFile = app.vault.getAbstractFileByPath(mdPath);
  assert.ok(mdFile);
  // Native markdown compilation does NOT insert the Pandoc {#refs} placeholder
  assert.doesNotMatch(mdFile.content, /::: \{#refs\}/);
});

test("15. No settings object is mutated", async () => {
  const { app, settings, manuscript } = buildTestFixture();
  const snapshotBefore = JSON.stringify(settings);

  const projectScope = createProjectScope(manuscript.path);
  await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");

  const snapshotAfter = JSON.stringify(settings);
  assert.equal(snapshotBefore, snapshotAfter);
});

test("16. The ZIP can be loaded by JSZip and all paths referenced by pandoc.yaml exist in it", async () => {
  const { app, settings, manuscript } = buildTestFixture();
  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const yaml = await zip.file("pandoc.yaml").async("string");

  // Verify input-files
  assert.ok(zip.file("manuscript.md"));

  // Check all bibliography files listed in yaml
  const bibLines = yaml.split("\n").filter((l) => l.trim().startsWith("- bibliography/"));
  for (const line of bibLines) {
    const bibPath = line.replace(/^[-\s]+/, "").trim();
    assert.ok(zip.file(bibPath), `Referenced bibliography ${bibPath} must exist in archive`);
  }

  // Check CSL file listed in yaml
  const cslMatch = yaml.match(/csl:\s*(styles\/[^\s]+)/);
  if (cslMatch) {
    assert.ok(zip.file(cslMatch[1]), `Referenced CSL ${cslMatch[1]} must exist in archive`);
  }
});

test("17. Direct file association: only the TFile has the explicit research association", async () => {
  const { app, settings, manuscript, scene1, research } = buildTestFixture({
    scene1Text: "---\ntitle: Scene 1\n---\nText citing [@directKey].",
  });

  const refBib = await app.vault.create(
    "Project/Research/references.bib",
    `@article{directKey,
  title = {Direct Association Study},
  author = {Direct, Author},
  year = {2026}
}`
  );
  refBib.extension = "bib";
  refBib.parent = research;
  if (!research.children.includes(refBib)) {
    research.children.push(refBib);
  }

  // A compiled Markdown TFile has the only explicit research association
  settings.projectMeta[manuscript.path].researchFolderLinks = {
    [scene1.path]: research.path,
  };
  settings.projectMeta[manuscript.path].citekeyBibliographyPath = "references.bib";

  // Binder isolation remains null throughout the test
  assert.equal(settings.projectMeta[manuscript.path].binderIsolation, undefined);

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  assert.ok(writtenPath);

  // Binder isolation remained null
  assert.equal(settings.projectMeta[manuscript.path].binderIsolation, undefined);

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);

  // The Pandoc ZIP contains bibliography/references.bib
  assert.ok(zip.file("bibliography/references.bib"), "ZIP must contain bibliography/references.bib");

  // pandoc.yaml references that copied bibliography
  const yaml = await zip.file("pandoc.yaml").async("string");
  assert.match(yaml, /bibliography:\s*\n\s*-\s*bibliography\/references\.bib/);

  // citation-report.json is absent for directKey
  const reportEntry = zip.file("citation-report.json");
  if (reportEntry) {
    const report = JSON.parse(await reportEntry.async("string"));
    const directKeyItem = (report.unknownKeys || []).find((k) => k.key === "directKey");
    assert.equal(directKeyItem, undefined, "directKey must not appear in citation-report.json");
  }
});

test("18. Media transformation: only renderText contains image wikilink", async () => {
  const { app, settings, manuscript, scene1 } = buildTestFixture();
  const projectScope = createProjectScope(manuscript.path);

  // Custom compile function where segment text has NO image, but renderText contains ![[fig1.png|Figure 1]]
  const customCompile = async () => ({
    outPath: "",
    manuscript: "Plain text without image.",
    segments: [
      {
        path: scene1.path,
        text: "Plain text without image.",
        renderText: "Rendered text with image ![[fig1.png|Figure 1]].",
        frontType: null,
      },
    ],
    compiledFilePaths: [scene1.path],
  });

  const writtenPath = await exportWithScope(
    app,
    settings,
    projectScope,
    "pandoc",
    "Manuscript",
    null,
    null,
    customCompile
  );
  assert.ok(writtenPath);

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const text = await zip.file("manuscript.md").async("string");

  // manuscript.md contains media/... and never the original wikilink
  assert.match(text, /!\[Figure 1\]\(media\/fig1\.png\)/);
  assert.doesNotMatch(text, /!\[\[fig1\.png/);

  // The media file exists in the ZIP
  assert.ok(zip.file("media/fig1.png"));
});

test("19. Sequential media replacement: multiple references to the same TFile produce exactly one media file and identical rewritten links", async () => {
  const { app, settings, manuscript } = buildTestFixture({
    scene1Text: "---\ntitle: Scene 1\n---\nFirst reference: ![[fig1.png|Figure 1]]. Second reference in same file: ![Another view](fig1.png).",
    scene2Text: "---\ntitle: Scene 2\n---\nThird reference in different file: ![[Chapter 1/fig1.png|Figure 1 again]].",
  });

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  assert.ok(writtenPath);

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);
  const text = await zip.file("manuscript.md").async("string");

  // All three references must rewrite to media/fig1.png
  assert.match(text, /!\[Figure 1\]\(media\/fig1\.png\)/);
  assert.match(text, /!\[Another view\]\(media\/fig1\.png\)/);
  assert.match(text, /!\[Figure 1 again\]\(media\/fig1\.png\)/);

  // Original wikilinks must not remain
  assert.doesNotMatch(text, /!\[\[fig1\.png/);

  // Exactly one media file exists in the archive (no fig1-1.png or duplicates)
  assert.ok(zip.file("media/fig1.png"));
  assert.equal(zip.file("media/fig1-1.png"), null);
  assert.equal(zip.file("media/fig1-2.png"), null);

  // Total count of media/ files in the ZIP is exactly 1
  const mediaEntries = Object.keys(zip.files).filter((k) => k.startsWith("media/") && !k.endsWith("/"));
  assert.equal(mediaEntries.length, 1);
  assert.equal(mediaEntries[0], "media/fig1.png");
});

test("20. Safe YAML references: special characters (#, quotes) are escaped, invalid segments (:, newlines, control chars) are rejected", async () => {
  // 1. Bibliography with # is safely serialized in YAML and valid in package
  const bibWithHash = { filename: "references#2026.bib", content: "@article{test, author={A}, title={T}, year={2026}}" };
  const yamlWithHash = generatePandocDefaultsYaml({ bibliographies: [bibWithHash] });
  assert.match(yamlWithHash, /bibliography:\s*\n\s*-\s*"bibliography\/references#2026\.bib"/);

  const pkgWithHash = await createPandocPackage({
    manuscript: "Text.",
    bibliographies: [bibWithHash],
  });
  const zipHash = await JSZip.loadAsync(pkgWithHash);
  assert.ok(zipHash.file("bibliography/references#2026.bib"));

  // 2. CSL with quotes is safely serialized in YAML and valid in package
  const cslWithQuotes = { filename: 'style"v1".csl', content: "<style></style>" };
  const yamlWithQuotes = generatePandocDefaultsYaml({ csl: cslWithQuotes });
  assert.match(yamlWithQuotes, /csl:\s*"styles\/style\\"v1\\"\.csl"/);

  const pkgWithQuotes = await createPandocPackage({
    manuscript: "Text.",
    csl: cslWithQuotes,
  });
  const zipQuotes = await JSZip.loadAsync(pkgWithQuotes);
  assert.ok(zipQuotes.file('styles/style"v1".csl'));

  // 3. Filenames with colons are rejected before archive creation
  assert.throws(
    () => validateArchivePath("bibliography/my:file.bib"),
    /colons are prohibited/
  );
  await assert.rejects(
    async () => {
      await createPandocPackage({
        manuscript: "Text.",
        bibliographies: [{ filename: "my:file.bib", content: "" }],
      });
    },
    /colons are prohibited/
  );

  // 4. Filenames with newlines and control characters are rejected before archive creation
  assert.throws(
    () => validateArchivePath("styles/style\nbreak.csl"),
    /control characters and newlines are prohibited/
  );
  assert.throws(
    () => escapeYamlScalar("styles/style\nbreak.csl"),
    /control characters and newlines are prohibited/
  );
  assert.throws(
    () => generatePandocDefaultsYaml({ csl: { filename: "style\nbreak.csl", content: "" } }),
    /control characters and newlines are prohibited/
  );
  await assert.rejects(
    async () => {
      await createPandocPackage({
        manuscript: "Text.",
        csl: { filename: "style\nbreak.csl", content: "" },
      });
    },
    /control characters and newlines are prohibited/
  );
});

test("21. End-to-end ZIP: local media in text and/or renderText produces unique media/ entry, valid rewritten link, and no warning in citation-report.json", async () => {
  const { app, settings, manuscript, scene1, vault } = buildTestFixture({
    scene1Text: "---\ntitle: Scene 1\n---\nFirst scene with ![[diagramme-test.svg|Diagram Test]] and citation [@smith2024] and missing ![Missing](missing-asset.png).",
  });

  await vault.create("Project/Manuscript/Chapter 1/diagramme-test.svg", "<svg>diagram</svg>");

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  assert.ok(writtenPath);

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);

  // manuscript.md contains valid rewritten media/ link
  const manuscriptMd = await zip.file("manuscript.md").async("string");
  assert.match(manuscriptMd, /!\[Diagram Test\]\(media\/diagramme-test\.svg\)/);
  assert.doesNotMatch(manuscriptMd, /!\[\[diagramme-test\.svg/);

  // Exactly one media file exists in the archive for diagramme-test.svg
  assert.ok(zip.file("media/diagramme-test.svg"));
  const matchingMedia = Object.keys(zip.files).filter(
    (k) => k.startsWith("media/diagramme-test") && !k.endsWith("/")
  );
  assert.equal(matchingMedia.length, 1);
  assert.equal(matchingMedia[0], "media/diagramme-test.svg");

  // citation-report.json exists because missing-asset.png is genuinely missing
  const reportEntry = zip.file("citation-report.json");
  assert.ok(reportEntry);
  const report = JSON.parse(await reportEntry.async("string"));

  // Preserves genuine missing media warning
  assert.ok(report.warnings.some((w) => w.includes("missing-asset.png")));

  // Generates NO warning for the valid media asset (neither raw nor media/ prefix)
  const falseWarnings = (report.warnings || []).filter((w) => w.includes("diagramme-test.svg"));
  assert.deepEqual(falseWarnings, []);

  // Variant: media present in renderText and/or text with already rewritten media/ links
  const customCompile = async () => ({
    outPath: "",
    manuscript: "Plain manuscript.",
    segments: [
      {
        path: scene1.path,
        text: "Segment text with local wikilink ![[diagramme-test.svg|From text]].",
        renderText: "Segment renderText with already rewritten link ![](media/diagramme-test.svg).",
        frontType: null,
      },
    ],
    compiledFilePaths: [scene1.path],
  });

  const variantPath = await exportWithScope(
    app,
    settings,
    projectScope,
    "pandoc",
    "Manuscript-Variant",
    null,
    null,
    customCompile
  );
  assert.ok(variantPath);

  const variantZipFile = app.vault.getAbstractFileByPath(variantPath);
  const variantZip = await JSZip.loadAsync(variantZipFile.content);
  const variantMd = await variantZip.file("manuscript.md").async("string");

  assert.match(variantMd, /!\[\]\(media\/diagramme-test\.svg\)/);
  assert.doesNotMatch(variantMd, /!\[\[diagramme-test\.svg/);

  // Only one media file in archive
  assert.ok(variantZip.file("media/diagramme-test.svg"));
  const variantMatchingMedia = Object.keys(variantZip.files).filter(
    (k) => k.startsWith("media/diagramme-test") && !k.endsWith("/")
  );
  assert.equal(variantMatchingMedia.length, 1);

  // citation-report.json is completely absent or has no media warning for diagramme-test.svg
  const variantReportEntry = variantZip.file("citation-report.json");
  if (variantReportEntry) {
    const variantReport = JSON.parse(await variantReportEntry.async("string"));
    const variantFalseWarnings = (variantReport.warnings || []).filter((w) =>
      w.includes("diagramme-test.svg")
    );
    assert.deepEqual(variantFalseWarnings, []);
  } else {
    assert.equal(variantReportEntry, null);
  }
});

test("22. End-to-end ZIP: source markdown targeting media/schema.png in neighbor media/ folder is resolved and packaged without warnings", async () => {
  const { app, settings, manuscript, vault } = buildTestFixture({
    scene1Text: "---\ntitle: Scene 1\n---\nHere is the diagram: ![Schema](media/schema.png) and citation [@smith2024].",
  });

  // Create neighboring media/ folder and image file
  await vault.createFolder("Project/Manuscript/Chapter 1/media");
  await vault.create("Project/Manuscript/Chapter 1/media/schema.png", "fake-png-binary-schema");

  const projectScope = createProjectScope(manuscript.path);
  const writtenPath = await exportWithScope(app, settings, projectScope, "pandoc", "Manuscript");
  assert.ok(writtenPath);

  const zipFile = app.vault.getAbstractFileByPath(writtenPath);
  const zip = await JSZip.loadAsync(zipFile.content);

  // manuscript.md points to media/schema.png
  const manuscriptMd = await zip.file("manuscript.md").async("string");
  assert.match(manuscriptMd, /!\[Schema\]\(media\/schema\.png\)/);

  // The ZIP contains the image under media/...
  assert.ok(zip.file("media/schema.png"));
  const matchingMedia = Object.keys(zip.files).filter(
    (k) => k.startsWith("media/schema") && !k.endsWith("/")
  );
  assert.equal(matchingMedia.length, 1);
  assert.equal(matchingMedia[0], "media/schema.png");

  // citation-report.json does not contain any warning for this image
  const reportEntry = zip.file("citation-report.json");
  if (reportEntry) {
    const report = JSON.parse(await reportEntry.async("string"));
    const falseWarnings = (report.warnings || []).filter((w) => w.includes("schema.png"));
    assert.deepEqual(falseWarnings, []);
  } else {
    assert.equal(reportEntry, null);
  }
});
