import assert from "node:assert/strict";
import test from "node:test";
import { TFile, TFolder, Menu, Notice } from "obsidian";
import { createFakeVault } from "./helpers/fake-vault.js";
import {
  collectCitationFiles,
  parseAttachmentLinks,
  resolveAttachmentLink,
  resolveCitationCandidates,
  resolveAttachmentCandidate,
  buildSourceSheetContent,
} from "../src/services/citation-candidates.js";
import { formatCitation } from "../src/services/citations.js";
import { loadCitationRegistry } from "../src/services/citation-registry.js";
import { CitationSourceModal, CitationAmbiguousSheetModal } from "../src/ui/citation-modal.js";
import { ConfirmModal } from "../src/ui/basic-modals.js";
import { TextInputModal } from "../src/scenes-editor.js";
import { analyzeResearchCitations } from "../src/services/research-citation-analysis.js";
import { isGenuineSourcesFolder, getGenuineSourcesRoots } from "../src/services/workspace-research-context.js";
import { ResearchView } from "../src/views/research-view.js";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";

class FakeElement {
  constructor(options = {}) {
    this.children = [];
    this.classes = new Set();
    this.text = options.text ?? "";
    this.attrs = new Map();
  }
  addClass(cn) {
    for (const p of String(cn).split(/\s+/)) if (p) this.classes.add(p);
  }
  removeClass(cn) {
    for (const p of String(cn).split(/\s+/)) if (p) this.classes.delete(p);
  }
  empty() {
    this.children = [];
  }
  createDiv(options = {}) {
    const child = new FakeElement(options);
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }
  createEl(tag, options = {}) {
    const child = new FakeElement(options);
    child.tag = tag;
    if (options.cls) child.addClass(options.cls);
    this.children.push(child);
    return child;
  }
  createSpan(options = {}) {
    return this.createEl("span", options);
  }
  setText(t) {
    this.text = String(t);
  }
  setAttr(k, v) {
    this.attrs.set(k, v);
  }
  getAttr(k) {
    return this.attrs.get(k);
  }
  addEventListener() {}
  focus() {}
}

test("Citation candidates and attachment resolution", async (suite) => {
  // Helper to build folders and files in memory
  function setupTestSources() {
    const { vault, fileManager, files } = createFakeVault();
    const recherche = new TFolder("Recherche", []);
    const sourcesFolder = new TFolder("Recherche/Sources", []);
    recherche.children = [sourcesFolder];
    sourcesFolder.parent = recherche;
    files.set(recherche.path, recherche);
    files.set(sourcesFolder.path, sourcesFolder);

    const subFolder = new TFolder("Recherche/Sources/Archives", []);
    subFolder.parent = sourcesFolder;
    sourcesFolder.children.push(subFolder);
    files.set(subFolder.path, subFolder);

    const outsideFolder = new TFolder("Manuscrit", []);
    files.set(outsideFolder.path, outsideFolder);

    return { vault, fileManager, files, recherche, sourcesFolder, subFolder, outsideFolder };
  }

  await suite.test("1. A markdown sheet alone remains offered as a candidate", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/SheetOnly.md");
    sheet.parent = sourcesFolder;
    sourcesFolder.children.push(sheet);

    const candidates = resolveCitationCandidates([sourcesFolder], () => ({}));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    if (candidates[0].kind === "source-sheet") {
      assert.equal(candidates[0].sourceFile.path, "Recherche/Sources/SheetOnly.md");
      assert.equal(candidates[0].attachmentFiles.length, 0);
    }
  });

  await suite.test("2. An associated PDF resolves its markdown sheet", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/History.md");
    sheet.parent = sourcesFolder;
    const pdf = new TFile("Recherche/Sources/History.pdf");
    pdf.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, pdf);

    const candidates = resolveCitationCandidates([sourcesFolder], (file) => {
      if (file.path === sheet.path) return { attachments: ["[[History.pdf]]"] };
      return {};
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    if (candidates[0].kind === "source-sheet") {
      assert.equal(candidates[0].sourceFile.path, sheet.path);
      assert.equal(candidates[0].attachmentFiles.length, 1);
      assert.equal(candidates[0].attachmentFiles[0].path, pdf.path);
    }
  });

  await suite.test("3. An associated DOCX resolves its markdown sheet", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Article.md");
    sheet.parent = sourcesFolder;
    const docx = new TFile("Recherche/Sources/Article.docx");
    docx.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, docx);

    const candidates = resolveCitationCandidates([sourcesFolder], (file) => {
      if (file.path === sheet.path) return { attachments: ["[[Article.docx]]"] };
      return {};
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    if (candidates[0].kind === "source-sheet") {
      assert.equal(candidates[0].sourceFile.path, sheet.path);
      assert.equal(candidates[0].attachmentFiles.length, 1);
      assert.equal(candidates[0].attachmentFiles[0].path, docx.path);
    }
  });

  await suite.test("4. An associated EPUB resolves its markdown sheet", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Book.md");
    sheet.parent = sourcesFolder;
    const epub = new TFile("Recherche/Sources/Book.epub");
    epub.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, epub);

    const candidates = resolveCitationCandidates([sourcesFolder], (file) => {
      if (file.path === sheet.path) return { attachments: ["[[Book.epub]]"] };
      return {};
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    if (candidates[0].kind === "source-sheet") {
      assert.equal(candidates[0].sourceFile.path, sheet.path);
      assert.equal(candidates[0].attachmentFiles.length, 1);
      assert.equal(candidates[0].attachmentFiles[0].path, epub.path);
    }
  });

  await suite.test("5. Association by simple path (exact Vault path and relative to sheet folder)", () => {
    const { sourcesFolder, subFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Work.md");
    sheet.parent = sourcesFolder;
    const pdf1 = new TFile("Recherche/Sources/Work.pdf");
    pdf1.parent = sourcesFolder;
    const pdf2 = new TFile("Recherche/Sources/Archives/Extra.pdf");
    pdf2.parent = subFolder;
    sourcesFolder.children.push(sheet, pdf1);
    subFolder.children.push(pdf2);

    // Exact Vault path
    const resolvedVault = resolveAttachmentLink("Recherche/Sources/Archives/Extra.pdf", sheet, [pdf1, pdf2]);
    assert.equal(resolvedVault?.path, pdf2.path);

    // Relative to sheet folder
    const resolvedRel = resolveAttachmentLink("Archives/Extra.pdf", sheet, [pdf1, pdf2]);
    assert.equal(resolvedRel?.path, pdf2.path);

    const resolvedSameFolder = resolveAttachmentLink("Work.pdf", sheet, [pdf1, pdf2]);
    assert.equal(resolvedSameFolder?.path, pdf1.path);

    // Prohibited: simple filename without relative path to a different subfolder must NOT match
    const prohibitedMatch = resolveAttachmentLink("Extra.pdf", sheet, [pdf1, pdf2]);
    assert.equal(prohibitedMatch, null);
  });

  await suite.test("6. Association by wikilink", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Thesis.md");
    sheet.parent = sourcesFolder;
    const pdf = new TFile("Recherche/Sources/Thesis.pdf");
    pdf.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, pdf);

    const links = parseAttachmentLinks("[[Thesis.pdf]]");
    assert.deepEqual(links, ["Thesis.pdf"]);
    const resolved = resolveAttachmentLink(links[0], sheet, [pdf]);
    assert.equal(resolved?.path, pdf.path);
  });

  await suite.test("7. Association by wikilink with alias or fragment", () => {
    const links = parseAttachmentLinks([
      "[[Recherche/Sources/Thesis.pdf#page=12]]",
      "[[Thesis.pdf|Document Title]]",
      "[[Thesis.pdf#p. 15|Custom Alias]]",
    ]);
    assert.deepEqual(links, [
      "Recherche/Sources/Thesis.pdf",
      "Thesis.pdf",
      "Thesis.pdf",
    ]);
  });

  await suite.test("8. `attachments` as single string", () => {
    const links = parseAttachmentLinks("[[Document.pdf]]");
    assert.deepEqual(links, ["Document.pdf"]);
  });

  await suite.test("9. `attachments` as array of strings", () => {
    const links = parseAttachmentLinks(["[[DocA.pdf]]", "[[DocB.docx]]"]);
    assert.deepEqual(links, ["DocA.pdf", "DocB.docx"]);
  });

  await suite.test("10. Compatibility fallback: exact same basename in the exact same folder", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Report.md");
    sheet.parent = sourcesFolder;
    const pdf = new TFile("Recherche/Sources/Report.pdf");
    pdf.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, pdf);

    // No explicit attachments in frontmatter
    const candidates = resolveCitationCandidates([sourcesFolder], () => ({}));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    if (candidates[0].kind === "source-sheet") {
      assert.equal(candidates[0].sourceFile.path, sheet.path);
      assert.equal(candidates[0].attachmentFiles.length, 1);
      assert.equal(candidates[0].attachmentFiles[0].path, pdf.path);
    }
  });

  await suite.test("11. No fallback on near/similar names", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Report_Notes.md");
    sheet.parent = sourcesFolder;
    const pdf = new TFile("Recherche/Sources/Report.pdf");
    pdf.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, pdf);

    const candidates = resolveCitationCandidates([sourcesFolder], () => ({}));
    assert.equal(candidates.length, 2);
    const sheetCandidate = candidates.find((c) => c.kind === "source-sheet");
    const unlinkedCandidate = candidates.find((c) => c.kind === "unlinked-attachment");

    assert.ok(sheetCandidate);
    assert.ok(unlinkedCandidate);
    if (sheetCandidate && sheetCandidate.kind === "source-sheet") {
      assert.equal(sheetCandidate.attachmentFiles.length, 0);
    }
    if (unlinkedCandidate && unlinkedCandidate.kind === "unlinked-attachment") {
      assert.equal(unlinkedCandidate.attachmentFile.path, pdf.path);
    }
  });

  await suite.test("12. No confusion between Work-A and Work-A-Extra", () => {
    const { sourcesFolder } = setupTestSources();
    const sheetA = new TFile("Recherche/Sources/Work-A.md");
    sheetA.parent = sourcesFolder;
    const pdfA = new TFile("Recherche/Sources/Work-A.pdf");
    pdfA.parent = sourcesFolder;

    const sheetExtra = new TFile("Recherche/Sources/Work-A-Extra.md");
    sheetExtra.parent = sourcesFolder;
    const pdfExtra = new TFile("Recherche/Sources/Work-A-Extra.pdf");
    pdfExtra.parent = sourcesFolder;

    sourcesFolder.children.push(sheetA, pdfA, sheetExtra, pdfExtra);

    const candidates = resolveCitationCandidates([sourcesFolder], () => ({}));
    assert.equal(candidates.length, 2);

    const candidateA = candidates.find(
      (c) => c.kind === "source-sheet" && c.sourceFile.path === sheetA.path
    );
    const candidateExtra = candidates.find(
      (c) => c.kind === "source-sheet" && c.sourceFile.path === sheetExtra.path
    );

    assert.ok(candidateA && candidateA.kind === "source-sheet");
    assert.equal(candidateA.attachmentFiles.length, 1);
    assert.equal(candidateA.attachmentFiles[0].path, pdfA.path);

    assert.ok(candidateExtra && candidateExtra.kind === "source-sheet");
    assert.equal(candidateExtra.attachmentFiles.length, 1);
    assert.equal(candidateExtra.attachmentFiles[0].path, pdfExtra.path);
  });

  await suite.test("13. Files outside scope are excluded", () => {
    const { sourcesFolder, outsideFolder } = setupTestSources();
    const insideSheet = new TFile("Recherche/Sources/Inside.md");
    insideSheet.parent = sourcesFolder;
    sourcesFolder.children.push(insideSheet);

    const outsidePdf = new TFile("Manuscrit/Outside.pdf");
    outsidePdf.parent = outsideFolder;
    outsideFolder.children.push(outsidePdf);

    const candidates = resolveCitationCandidates([sourcesFolder], () => ({}));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    if (candidates[0].kind === "source-sheet") {
      assert.equal(candidates[0].sourceFile.path, insideSheet.path);
    }
  });

  await suite.test("14. Subfolders inside Sources are included", () => {
    const { sourcesFolder, subFolder } = setupTestSources();
    const subSheet = new TFile("Recherche/Sources/Archives/SubSheet.md");
    subSheet.parent = subFolder;
    const subPdf = new TFile("Recherche/Sources/Archives/SubPdf.pdf");
    subPdf.parent = subFolder;
    subFolder.children.push(subSheet, subPdf);

    const candidates = resolveCitationCandidates([sourcesFolder], (f) => {
      if (f.path === subSheet.path) return { attachments: ["[[SubPdf.pdf]]"] };
      return {};
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    if (candidates[0].kind === "source-sheet") {
      assert.equal(candidates[0].sourceFile.path, subSheet.path);
      assert.equal(candidates[0].attachmentFiles.length, 1);
      assert.equal(candidates[0].attachmentFiles[0].path, subPdf.path);
    }
  });

  await suite.test("15. .bib and .csl are never treated as citable attachments", () => {
    const { sourcesFolder } = setupTestSources();
    const bibFile = new TFile("Recherche/Sources/refs.bib");
    bibFile.parent = sourcesFolder;
    const cslFile = new TFile("Recherche/Sources/style.csl");
    cslFile.parent = sourcesFolder;
    sourcesFolder.children.push(bibFile, cslFile);

    const { attachmentFiles, markdownFiles } = collectCitationFiles([sourcesFolder]);
    assert.equal(attachmentFiles.length, 0);
    assert.equal(markdownFiles.length, 0);

    const candidates = resolveCitationCandidates([sourcesFolder], () => ({}));
    assert.equal(candidates.length, 0);
  });

  await suite.test("16. Binary files are never read", () => {
    let readCalled = false;
    let readBinaryCalled = false;

    const { sourcesFolder } = setupTestSources();
    const pdf = new TFile("Recherche/Sources/BinaryDoc.pdf");
    pdf.parent = sourcesFolder;
    pdf.vault = {
      read() {
        readCalled = true;
        return Promise.resolve("");
      },
      readBinary() {
        readBinaryCalled = true;
        return Promise.resolve("");
      },
    };
    sourcesFolder.children.push(pdf);

    resolveCitationCandidates([sourcesFolder], () => ({}));

    assert.equal(readCalled, false);
    assert.equal(readBinaryCalled, false);
  });

  await suite.test("17. A sheet and its associated attachment produce only one candidate", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Unique.md");
    sheet.parent = sourcesFolder;
    const pdf = new TFile("Recherche/Sources/Unique.pdf");
    pdf.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, pdf);

    const candidates = resolveCitationCandidates([sourcesFolder], () => ({
      attachments: ["[[Unique.pdf]]"],
    }));

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
  });

  await suite.test("18. Multiple claiming sheets are never resolved arbitrarily", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet1 = new TFile("Recherche/Sources/Claimant1.md");
    sheet1.parent = sourcesFolder;
    const sheet2 = new TFile("Recherche/Sources/Claimant2.md");
    sheet2.parent = sourcesFolder;
    const sharedPdf = new TFile("Recherche/Sources/Shared.pdf");
    sharedPdf.parent = sourcesFolder;
    sourcesFolder.children.push(sheet1, sheet2, sharedPdf);

    const candidates = resolveCitationCandidates([sourcesFolder], (file) => {
      if (file.path === sheet1.path || file.path === sheet2.path) {
        return { attachments: ["[[Shared.pdf]]"] };
      }
      return {};
    });

    // Neither sheet arbitrarily claims the shared attachment exclusively
    const s1Candidate = candidates.find(
      (c) => c.kind === "source-sheet" && c.sourceFile.path === sheet1.path
    );
    const s2Candidate = candidates.find(
      (c) => c.kind === "source-sheet" && c.sourceFile.path === sheet2.path
    );
    const ambCandidate = candidates.find(
      (c) => c.kind === "ambiguous-attachment"
    );

    assert.ok(s1Candidate && s1Candidate.kind === "source-sheet");
    assert.equal(s1Candidate.attachmentFiles.length, 0);

    assert.ok(s2Candidate && s2Candidate.kind === "source-sheet");
    assert.equal(s2Candidate.attachmentFiles.length, 0);

    assert.ok(ambCandidate && ambCandidate.kind === "ambiguous-attachment");
    assert.equal(ambCandidate.attachmentFile.path, sharedPdf.path);
    assert.equal(ambCandidate.sourceFiles.length, 2);
  });

  await suite.test("19. Selecting an associated attachment calls insertCitationFor with the Markdown sheet", async () => {
    const { vault, fileManager, sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/SourceEntry.md");
    sheet.parent = sourcesFolder;
    const docx = new TFile("Recherche/Sources/Document.docx");
    docx.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, docx);

    const app = {
      vault,
      fileManager,
      workspace: { getActiveFile: () => null, getLeaf: () => ({ openFile: async () => {} }) },
      metadataCache: { getFileCache: () => ({ frontmatter: { title: "Entry Title", author: "Entry Author" } }) },
    };
    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.settings = { projectFolder: "Recherche" };

    const candidates = resolveCitationCandidates([sourcesFolder], (file) => {
      if (file.path === sheet.path) return { title: "Entry Title", author: "Entry Author", attachments: ["[[Document.docx]]"] };
      return {};
    });
    assert.equal(candidates.length, 1);
    const candidate = candidates[0];
    assert.equal(candidate.kind, "source-sheet");

    let chosenFile = null;
    let chosenPage = "";
    const onChoose = (file, page) => {
      chosenFile = file;
      chosenPage = page;
    };
    const onCreateSheet = async () => {};

    const modal = new CitationSourceModal(app, plugin, candidates, onChoose, onCreateSheet);
    const itemText = modal.getItemText(candidate);
    assert.ok(itemText.includes("Entry Title"));
    assert.ok(itemText.includes("Entry Author"));
    assert.ok(itemText.includes("Document.docx"));

    const origOpen = TextInputModal.prototype.open;
    TextInputModal.prototype.open = function () {
      void this.onSubmit({ page: "42" });
    };
    try {
      modal.onChooseItem(candidate);
    } finally {
      TextInputModal.prototype.open = origOpen;
    }

    assert.equal(chosenFile?.path, sheet.path);
    assert.equal(chosenPage, "42");
    assert.notEqual(chosenFile?.path, docx.path);
  });

  await suite.test("20. The citation registry records the Markdown sheet path, never the binary path", async () => {
    const { vault, fileManager, files } = createFakeVault();
    const projectFolder = new TFolder("Projet", []);
    const recherche = new TFolder("Projet/Recherche", []);
    const sourcesFolder = new TFolder("Projet/Recherche/Sources", []);
    const manuscrit = new TFolder("Projet/Manuscrit", []);
    projectFolder.children = [recherche, manuscrit];
    recherche.parent = projectFolder;
    recherche.children = [sourcesFolder];
    sourcesFolder.parent = recherche;
    manuscrit.parent = projectFolder;

    const sheet = new TFile("Projet/Recherche/Sources/Notice.md", "---\nauthor: \"Albert Camus\"\ntitle: \"L'Étranger\"\ndate: 1942\n---\n");
    sheet.parent = sourcesFolder;
    sourcesFolder.children.push(sheet);

    const pdf = new TFile("Projet/Recherche/Sources/Notice.pdf", "");
    pdf.parent = sourcesFolder;
    sourcesFolder.children.push(pdf);

    const targetFile = new TFile("Projet/Manuscrit/Chapitre.md", "Chapitre introductif.");
    targetFile.parent = manuscrit;
    manuscrit.children.push(targetFile);

    for (const f of [projectFolder, recherche, sourcesFolder, manuscrit, sheet, pdf, targetFile]) {
      files.set(f.path, f);
    }

    const app = {
      vault,
      fileManager,
      workspace: { getActiveFile: () => targetFile, getLeaf: () => ({ openFile: async () => {} }) },
      metadataCache: {
        getFileCache: (f) => {
          if (f.path === sheet.path) return { frontmatter: { author: "Albert Camus", title: "L'Étranger", date: 1942 } };
          return { frontmatter: {} };
        },
      },
    };
    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.settings = { projectFolder: "Projet", projectMeta: { "Projet": { citationStyle: "parenthetical" } } };

    let editorValue = "Chapitre introductif.";
    let cursorPos = { line: 0, ch: editorValue.length };
    const editor = {
      getValue: () => editorValue,
      getCursor: () => cursorPos,
      posToOffset: (pos) => pos.ch,
      replaceRange: (text, from, to) => {
        editorValue = editorValue.slice(0, from.ch) + text + editorValue.slice(to.ch);
      },
      lastLine: () => 0,
      getLine: () => editorValue,
      setCursor: (pos) => { cursorPos = pos; },
      focus: () => {},
    };

    // 1. Direct binary citation is blocked
    const prevOnCreate = Notice.onCreate;
    let noticeMessage = "";
    Notice.onCreate = (msg) => {
      noticeMessage = String(msg);
    };
    try {
      plugin.insertCitationFor(pdf, "10", editor, targetFile);
      assert.equal(editorValue, "Chapitre introductif.", "Editor was not modified for binary file");
      assert.equal(noticeMessage, t("main.notice.cannotCiteDirectlyBinary"));

      // 2. Markdown sheet citation succeeds and records in registry
      plugin.insertCitationFor(sheet, "25", editor, targetFile);
      assert.ok(editorValue.includes("(Albert Camus, 1942, p. 25)"));

      await new Promise((resolve) => setTimeout(resolve, 10));
      const loaded = await loadCitationRegistry(app, plugin.settings);
      assert.equal(loaded.citations.length, 1);
      assert.equal(loaded.citations[0].sourcePath, sheet.path);
      assert.ok(!loaded.citations[0].sourcePath.endsWith(".pdf"));
      assert.equal(loaded.citations[0].file, "Manuscrit/Chapitre.md");
    } finally {
      Notice.onCreate = prevOnCreate;
    }
  });

  await suite.test("21. Cancelling creation writes 0 files/folders and touches 0 settings", async () => {
    const { vault, fileManager, files, sourcesFolder } = setupTestSources();
    const initialFiles = new Set(files.keys());

    const unlinkedPdf = new TFile("Recherche/Sources/Solo.pdf");
    unlinkedPdf.parent = sourcesFolder;
    sourcesFolder.children.push(unlinkedPdf);

    const app = {
      vault,
      fileManager,
      workspace: { getActiveFile: () => null, getLeaf: () => ({ openFile: async () => {} }) },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    };
    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.settings = { projectFolder: "Recherche" };

    const candidates = resolveCitationCandidates([sourcesFolder], () => ({}));
    const unlinkedCandidate = candidates.find((c) => c.kind === "unlinked-attachment");
    assert.ok(unlinkedCandidate);

    let createCalled = false;
    const onCreateSheet = async () => {
      createCalled = true;
    };
    const modal = new CitationSourceModal(app, plugin, candidates, () => {}, onCreateSheet);

    let confirmOpened = false;
    let confirmBtnClass = "";
    const origOpen = ConfirmModal.prototype.open;
    ConfirmModal.prototype.open = function () {
      confirmOpened = true;
      confirmBtnClass = this.buttonClass;
      // User cancels dialog -> do not call this.onConfirm()
    };

    try {
      modal.onChooseItem(unlinkedCandidate);
    } finally {
      ConfirmModal.prototype.open = origOpen;
    }

    assert.ok(confirmOpened, "ConfirmModal was opened");
    assert.equal(confirmBtnClass, "mod-cta", "ConfirmModal uses mod-cta");
    assert.equal(createCalled, false, "onCreateSheet was not called on cancel");

    for (const path of files.keys()) {
      if (path !== unlinkedPdf.path) {
        assert.ok(initialFiles.has(path), `Unexpected file created: ${path}`);
      }
    }
  });

  await suite.test("22. Confirming creates a source sheet with title and attachments wikilink", async () => {
    const { vault, fileManager, files, sourcesFolder } = setupTestSources();
    const unlinkedPdf = new TFile("Recherche/Sources/ArchiveReport.pdf");
    unlinkedPdf.parent = sourcesFolder;
    sourcesFolder.children.push(unlinkedPdf);
    files.set(unlinkedPdf.path, unlinkedPdf);

    // Pre-create ArchiveReport.md to verify collision handling produces "ArchiveReport 2.md"
    const existingSheet = new TFile("Recherche/Sources/ArchiveReport.md", "---\ntitle: \"Existing\"\n---\n");
    existingSheet.parent = sourcesFolder;
    sourcesFolder.children.push(existingSheet);
    files.set(existingSheet.path, existingSheet);

    let openedFile = null;
    const leaf = {
      openFile: async (file) => {
        openedFile = file;
      },
    };
    const app = {
      vault,
      fileManager,
      workspace: {
        getActiveFile: () => null,
        getLeaf: () => leaf,
        setActiveLeaf: () => {},
      },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    };
    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.settings = { projectFolder: "Recherche" };

    const prevOnCreate = Notice.onCreate;
    let noticeMessage = "";
    Notice.onCreate = (msg) => {
      noticeMessage = String(msg);
    };

    try {
      await plugin.createSourceSheetForAttachment(unlinkedPdf);
    } finally {
      Notice.onCreate = prevOnCreate;
    }

    const created = vault.getAbstractFileByPath("Recherche/Sources/ArchiveReport 2.md");
    assert.ok(created instanceof TFile, "Created unique file with collision suffix");
    assert.equal(openedFile?.path, "Recherche/Sources/ArchiveReport 2.md", "Opened and activated the created sheet");
    assert.equal(noticeMessage, t("modal.citation.sourceSheetCreatedNotice"));

    const content = created.content;
    assert.ok(content.includes('title: "ArchiveReport 2"'), "Contains collision-adjusted title");
    assert.ok(content.includes('attachments:\n  - "[[Recherche/Sources/ArchiveReport.pdf]]"'), "Contains attachment wikilink");
  });

  await suite.test("23. Complete footnote citation remains unchanged", () => {
    const completeSource = {
      author: "Antoine Prost",
      title: "Douze leçons sur l'histoire",
      date: "1996",
      publisher: "Seuil",
    };
    const formatted = formatCitation(completeSource, "45", "footnote");
    assert.equal(formatted, "Antoine Prost, *Douze leçons sur l'histoire*, Seuil, 1996, p. 45.");
  });

  await suite.test("24. A sheet without author uses its title in parenthetical style", () => {
    const withDate = { title: "Rapport Annuel", date: "2024" };
    assert.equal(formatCitation(withDate, "12", "parenthetical"), "(Rapport Annuel, 2024, p. 12)");

    const withoutDate = { title: "Rapport Annuel" };
    assert.equal(formatCitation(withoutDate, "12", "parenthetical"), "(Rapport Annuel, p. 12)");
  });

  await suite.test("25. Citation `(p. 12)` is never produced", () => {
    assert.equal(formatCitation({}, "12", "parenthetical"), "");
    assert.equal(formatCitation({ date: "2025" }, "12", "parenthetical"), "");
    assert.equal(formatCitation(undefined, "12", "parenthetical"), "");
    assert.equal(formatCitation({}, "12", "footnote"), "");
  });

  await suite.test("26. Zero regressions on Project and Espace modes: getCitationFolders and sibling boundaries", () => {
    const { vault, fileManager, files } = createFakeVault();
    const project = new TFolder("PROJET", []);
    const projResearch = new TFolder("PROJET/_Recherche", []);
    const projSources = new TFolder("PROJET/_Recherche/Sources", []);
    project.children = [projResearch];
    projResearch.parent = project;
    projResearch.children = [projSources];
    projSources.parent = projResearch;

    const workA = new TFolder("PROJET/Work-A", []);
    const workAResearch = new TFolder("PROJET/Work-A-Research", []);
    const workASources = new TFolder("PROJET/Work-A-Research/Sources", []);
    workAResearch.children = [workASources];
    workASources.parent = workAResearch;

    const workAExtra = new TFolder("PROJET/Work-A-Extra", []);
    const workAExtraResearch = new TFolder("PROJET/Work-A-Extra-Research", []);
    const workAExtraSources = new TFolder("PROJET/Work-A-Extra-Research/Sources", []);
    workAExtraResearch.children = [workAExtraSources];
    workAExtraSources.parent = workAExtraResearch;

    project.children.push(workA, workAResearch, workAExtra, workAExtraResearch);
    for (const c of project.children) c.parent = project;

    for (const f of [
      project, projResearch, projSources,
      workA, workAResearch, workASources,
      workAExtra, workAExtraResearch, workAExtraSources,
    ]) {
      files.set(f.path, f);
    }

    const app = {
      vault,
      fileManager,
      workspace: { getActiveFile: () => null, getLeaf: () => ({ openFile: async () => {} }) },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    };
    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.settings = {
      projectFolder: "PROJET",
      orders: {},
      folderPositions: {},
      projectMeta: {
        "PROJET": {
          researchFolderLinks: {
            "PROJET/Work-A": "PROJET/Work-A-Research",
            "PROJET/Work-A-Extra": "PROJET/Work-A-Extra-Research",
          },
        },
      },
    };

    // 1. In Project mode: returns project Sources folder
    plugin.getWorkspaceFolder = () => null;
    const projFolders = plugin.getCitationFolders();
    assert.equal(projFolders.length, 1);
    assert.equal(projFolders[0].path, "PROJET/_Recherche/Sources");

    // 2. In Workspace mode for Work-A: returns Work-A Sources folder (never Work-A-Extra)
    plugin.getWorkspaceFolder = () => workA;
    const workAFolders = plugin.getCitationFolders();
    const workAPaths = workAFolders.map((f) => f.path);
    assert.ok(workAPaths.includes("PROJET/Work-A-Research/Sources"));
    assert.ok(!workAPaths.includes("PROJET/Work-A-Extra-Research/Sources"));

    // 3. In Workspace mode for Work-A-Extra: returns Work-A-Extra Sources folder (never Work-A)
    plugin.getWorkspaceFolder = () => workAExtra;
    const workAExtraFolders = plugin.getCitationFolders();
    const workAExtraPaths = workAExtraFolders.map((f) => f.path);
    assert.ok(workAExtraPaths.includes("PROJET/Work-A-Extra-Research/Sources"));
    assert.ok(!workAExtraPaths.includes("PROJET/Work-A-Research/Sources"));

    // Sibling boundary: Work-A and Work-A-Extra never see each other's Sources folder
    assert.notDeepEqual(workAPaths, workAExtraPaths);
  });

  await suite.test("27. End-to-end integration: attachment -> sheet created -> cited in text -> bibliography analyzed", async () => {
    const { vault, fileManager, files } = createFakeVault();
    const project = new TFolder("PROJET", []);
    const research = new TFolder("PROJET/_Recherche", []);
    const sources = new TFolder("PROJET/_Recherche/Sources", []);
    const manuscript = new TFolder("PROJET/Manuscrit", []);
    project.children = [research, manuscript];
    research.parent = project;
    research.children = [sources];
    sources.parent = research;
    manuscript.parent = project;

    const attachment = new TFile("PROJET/_Recherche/Sources/HistoryDoc.pdf", "");
    attachment.parent = sources;
    sources.children.push(attachment);

    const chapter = new TFile("PROJET/Manuscrit/Chapter.md", "Historical analysis.");
    chapter.parent = manuscript;
    manuscript.children.push(chapter);

    for (const f of [project, research, sources, manuscript, attachment, chapter]) {
      files.set(f.path, f);
    }

    const app = {
      vault,
      fileManager,
      workspace: { getActiveFile: () => chapter, getLeaf: () => ({ openFile: async () => {} }), setActiveLeaf: () => {} },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    };
    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.settings = { projectFolder: "PROJET", orders: {}, folderPositions: {}, projectMeta: { "PROJET": { citationStyle: "parenthetical" } } };

    // 1. Create source sheet for unlinked attachment
    await plugin.createSourceSheetForAttachment(attachment);
    const createdSheet = vault.getAbstractFileByPath("PROJET/_Recherche/Sources/HistoryDoc.md");
    assert.ok(createdSheet instanceof TFile);

    // Populate sheet frontmatter with author and title
    createdSheet.content = [
      "---",
      'title: "History Document"',
      'author: "Marc Bloch"',
      "date: 1949",
      "attachments:",
      '  - "[[PROJET/_Recherche/Sources/HistoryDoc.pdf]]"',
      "---",
    ].join("\n");

    app.metadataCache.getFileCache = (f) => {
      if (f.path === createdSheet.path) {
        return { frontmatter: { title: "History Document", author: "Marc Bloch", date: 1949 } };
      }
      return { frontmatter: {} };
    };

    // 2. Candidate resolution: uniquely resolved to the markdown sheet
    const candidates = resolveCitationCandidates([sources], (f) => {
      if (f.path === createdSheet.path) {
        return {
          title: "History Document",
          author: "Marc Bloch",
          date: 1949,
          attachments: ["[[PROJET/_Recherche/Sources/HistoryDoc.pdf]]"],
        };
      }
      return {};
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    assert.equal(candidates[0].sourceFile.path, createdSheet.path);
    assert.equal(candidates[0].attachmentFiles.length, 1);

    // 3. Insert citation in editor
    let editorValue = "Historical analysis.";
    const editor = {
      getValue: () => editorValue,
      getCursor: () => ({ line: 0, ch: editorValue.length }),
      posToOffset: (pos) => pos.ch,
      replaceRange: (text, from, to) => {
        editorValue = editorValue.slice(0, from.ch) + text + editorValue.slice(to.ch);
      },
      lastLine: () => 0,
      getLine: () => editorValue,
      setCursor: () => {},
      focus: () => {},
    };

    plugin.insertCitationFor(candidates[0].sourceFile, "55", editor, chapter);
    assert.ok(editorValue.includes("(Marc Bloch, 1949, p. 55)"));

    // 4. Citation registry has occurrence pointing to Markdown sheet
    await new Promise((resolve) => setTimeout(resolve, 10));
    const registry = await loadCitationRegistry(app, plugin.settings);
    assert.equal(registry.citations.length, 1);
    assert.equal(registry.citations[0].sourcePath, createdSheet.path);

    // 5. Research citation analysis reflects occurrence
    chapter.content = editorValue;
    chapter.stat = { mtime: Date.now(), size: chapter.content.length };
    const docContext = {
      mode: "project",
      projectRoot: project,
      scopeRoot: project,
      workspaceRoot: null,
      files: [chapter],
    };
    const analysis = await analyzeResearchCitations(app, plugin.settings, docContext);
    assert.equal(analysis.sourceCitationCounts.get(createdSheet.path), 1);
  });

  // Additional hardening tests for buildSourceSheetContent()
  await suite.test("buildSourceSheetContent hardening: inline array normalization and comment preservation", () => {
    const template = [
      "---",
      "# Bibliographic entry",
      'title: "Notice"',
      'author: "Victor Hugo"',
      'attachments: ["[[ancien.pdf]]", "[[annexe.pdf]]"]',
      "tags:",
      "  - roman",
      "---",
      "Corpus du document.",
    ].join("\n");

    const result = buildSourceSheetContent(template, "Notice", "Notice", "Recherche/Sources/troisieme.pdf");
    assert.ok(result.includes("# Bibliographic entry"));
    assert.ok(result.includes('author: "Victor Hugo"'));
    assert.ok(result.includes("tags:\n  - roman"));
    assert.ok(result.includes('attachments:\n  - "[[ancien.pdf]]"\n  - "[[annexe.pdf]]"\n  - "[[Recherche/Sources/troisieme.pdf]]"'));
    assert.ok(!result.includes("[[ancien.pdf]]\", \"[[annexe.pdf]]\""));
    assert.ok(!result.includes("- ["));
    assert.ok(result.includes("Corpus du document."));
    const delimiterCount = (result.match(/---/g) || []).length;
    assert.equal(delimiterCount, 2);
  });

  await suite.test("buildSourceSheetContent hardening: empty array normalization", () => {
    const template = [
      "---",
      'title: "Notice"',
      "attachments: []",
      "---",
    ].join("\n");

    const result = buildSourceSheetContent(template, "Notice", "Notice", "Recherche/Sources/nouveau.pdf");
    assert.ok(result.includes('attachments:\n  - "[[Recherche/Sources/nouveau.pdf]]"'));
    assert.ok(!result.includes("[]"));
  });

  await suite.test("buildSourceSheetContent hardening: scalar normalization", () => {
    const template = [
      "---",
      'title: "Notice"',
      'attachments: "[[seul.pdf]]"',
      "---",
    ].join("\n");

    const result = buildSourceSheetContent(template, "Notice", "Notice", "Recherche/Sources/deuxieme.pdf");
    assert.ok(result.includes('attachments:\n  - "[[seul.pdf]]"\n  - "[[Recherche/Sources/deuxieme.pdf]]"'));
  });

  await suite.test("buildSourceSheetContent hardening: template without frontmatter", () => {
    const template = "# Document content without frontmatter";
    const result = buildSourceSheetContent(template, "Default", "Sample", "Sources/Sample.pdf");
    assert.ok(result.startsWith("---\ntitle: \"Sample\"\nattachments:\n  - \"[[Sources/Sample.pdf]]\"\n---"));
    assert.ok(result.includes("# Document content without frontmatter"));
  });

  await suite.test("buildSourceSheetContent hardening: special characters with quotes and backslashes", () => {
    const template = [
      "---",
      'title: "Default"',
      "---",
    ].join("\n");

    const specialBase = 'Special "Quoted" & Backslash \\ Test';
    const result = buildSourceSheetContent(template, "Default", specialBase, 'Sources/Doc "1" \\ test.pdf');
    assert.ok(result.includes('title: "Special \\"Quoted\\" & Backslash \\\\ Test"'));
    assert.ok(result.includes('attachments:\n  - "[[Sources/Doc \\"1\\" \\\\ test.pdf]]"'));
  });

  await suite.test("buildSourceSheetContent hardening: deduplication of existing attachment", () => {
    const template = [
      "---",
      'title: "Notice"',
      'attachments: ["[[Recherche/Sources/same.pdf]]"]',
      "---",
    ].join("\n");

    const result = buildSourceSheetContent(template, "Notice", "Notice", "Recherche/Sources/same.pdf");
    const count = (result.match(/same\.pdf/g) || []).length;
    assert.equal(count, 1, "Attachment link is deduplicated");
  });

  await suite.test("resolveCitationCandidates: attachments: [] is explicit empty and disables basename fallback", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Livre.md");
    sheet.parent = sourcesFolder;
    const pdf = new TFile("Recherche/Sources/Livre.pdf");
    pdf.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, pdf);

    const candidates = resolveCitationCandidates([sourcesFolder], (file) => {
      if (file.path === sheet.path) return { attachments: [] };
      return {};
    });

    const sheetCandidate = candidates.find((c) => c.kind === "source-sheet");
    assert.ok(sheetCandidate);
    assert.equal(sheetCandidate.attachmentFiles.length, 0, "Explicit empty attachments array disables fallback");

    const unlinkedCandidate = candidates.find((c) => c.kind === "unlinked-attachment");
    assert.ok(unlinkedCandidate);
    assert.equal(unlinkedCandidate.attachmentFile.path, pdf.path);
  });

  await suite.test("resolveCitationCandidates: absent attachments property falls back to all matching files by basename", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/MultiFormat.md");
    sheet.parent = sourcesFolder;
    const pdf = new TFile("Recherche/Sources/MultiFormat.pdf");
    pdf.parent = sourcesFolder;
    const epub = new TFile("Recherche/Sources/MultiFormat.epub");
    epub.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, pdf, epub);

    const candidates = resolveCitationCandidates([sourcesFolder], () => ({}));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].kind, "source-sheet");
    if (candidates[0].kind === "source-sheet") {
      assert.equal(candidates[0].attachmentFiles.length, 2);
      const paths = candidates[0].attachmentFiles.map((f) => f.path);
      assert.ok(paths.includes(pdf.path));
      assert.ok(paths.includes(epub.path));
    }
  });

  await suite.test("resolveCitationCandidates: deduplicates attachmentFiles on candidates", () => {
    const { sourcesFolder } = setupTestSources();
    const sheet = new TFile("Recherche/Sources/Dupe.md");
    sheet.parent = sourcesFolder;
    const pdf = new TFile("Recherche/Sources/Dupe.pdf");
    pdf.parent = sourcesFolder;
    sourcesFolder.children.push(sheet, pdf);

    const candidates = resolveCitationCandidates([sourcesFolder], (file) => {
      if (file.path === sheet.path) {
        return { attachments: ["[[Dupe.pdf]]", "[[Recherche/Sources/Dupe.pdf]]"] };
      }
      return {};
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].attachmentFiles.length, 1);
  });

  await suite.test("DOM ergonomics: Sources folder context menu prepends 3 actions followed by separator", () => {
    const { vault, fileManager, recherche, sourcesFolder } = setupTestSources();
    const app = {
      vault,
      fileManager,
      workspace: { getActiveFile: () => null, getLeaf: () => ({ openFile: async () => {} }) },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    };
    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.settings = { projectFolder: "PROJET", orders: {}, folderPositions: {}, projectMeta: {} };
    plugin.getCitationFolders = () => [sourcesFolder];
    plugin.getLinkedResearchFolders = () => [{ folder: recherche }];

    const leaf = { app, contentEl: new FakeElement() };
    const view = new ResearchView(leaf, plugin);

    let shownMenu = null;
    const origShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
    Menu.prototype.showAtMouseEvent = function () {
      shownMenu = this;
      return this;
    };

    try {
      view["showResearchFolderContextMenu"]({ clientX: 0, clientY: 0 }, sourcesFolder);
    } finally {
      Menu.prototype.showAtMouseEvent = origShowAtMouseEvent;
    }

    assert.ok(shownMenu, "Context menu was opened");
    assert.equal(shownMenu.items[0].title, t("shared.research.newSourceSheet"));
    assert.equal(shownMenu.items[0].icon, "file-plus");
    assert.equal(shownMenu.items[1].title, t("main.cmd.insertCitation"));
    assert.equal(shownMenu.items[1].icon, "quote");
    assert.equal(shownMenu.items[2].title, t("shared.research.importDocuments"));
    assert.equal(shownMenu.items[2].icon, "upload");
    assert.equal(shownMenu.items[3].separator, true);
  });

  await suite.test("quickCiteAttachment: ambiguous attachment opens CitationAmbiguousSheetModal, never creates file or cites binary", async () => {
    const { vault, fileManager, files, sourcesFolder } = setupTestSources();

    const pdf = new TFile("Recherche/Sources/Shared.pdf");
    pdf.parent = sourcesFolder;
    const sheet1 = new TFile("Recherche/Sources/Sheet1.md", "---\nauthor: \"Author 1\"\ntitle: \"Title 1\"\nattachments:\n  - \"[[Shared.pdf]]\"\n---\n");
    sheet1.parent = sourcesFolder;
    const sheet2 = new TFile("Recherche/Sources/Sheet2.md", "---\nauthor: \"Author 2\"\ntitle: \"Title 2\"\nattachments:\n  - \"[[Shared.pdf]]\"\n---\n");
    sheet2.parent = sourcesFolder;

    sourcesFolder.children.push(pdf, sheet1, sheet2);
    files.set(pdf.path, pdf);
    files.set(sheet1.path, sheet1);
    files.set(sheet2.path, sheet2);

    const initialFileCount = files.size;

    const targetFile = new TFile("Recherche/Target.md");
    files.set(targetFile.path, targetFile);

    const app = {
      vault,
      fileManager,
      workspace: {
        getActiveFile: () => targetFile,
        getLeaf: () => ({ openFile: async () => {} }),
      },
      metadataCache: {
        getFileCache: (file) => {
          if (file.path === sheet1.path) return { frontmatter: { author: "Author 1", title: "Title 1", attachments: ["[[Shared.pdf]]"] } };
          if (file.path === sheet2.path) return { frontmatter: { author: "Author 2", title: "Title 2", attachments: ["[[Shared.pdf]]"] } };
          return { frontmatter: {} };
        },
      },
    };

    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.getCitationFolders = () => [sourcesFolder];
    plugin.settings = { projectFolder: "Recherche" };

    const fakeEditor = {
      getValue: () => "Text",
      getCursor: () => ({ line: 0, ch: 4 }),
      posToOffset: (pos) => pos.ch,
      replaceRange: () => {},
      lastLine: () => 0,
      getLine: () => "Text",
      setCursor: () => {},
      focus: () => {},
    };
    plugin.activeEditorAnywhere = () => fakeEditor;

    let confirmOpened = false;
    const origConfirmOpen = ConfirmModal.prototype.open;
    ConfirmModal.prototype.open = function () {
      confirmOpened = true;
    };

    let ambiguousModalOpened = false;
    let ambiguousCandidateFiles = [];
    let textInputModalOpened = false;

    const candidateResolution = resolveAttachmentCandidate(
      resolveCitationCandidates([sourcesFolder], (f) => app.metadataCache.getFileCache(f)?.frontmatter ?? null),
      pdf
    );
    assert.equal(candidateResolution?.kind, "ambiguous");
    let citedFile = null;
    let citedPage = null;

    const origAmbiguousOpen = CitationAmbiguousSheetModal.prototype.open;
    CitationAmbiguousSheetModal.prototype.open = function () {
      ambiguousModalOpened = true;
      ambiguousCandidateFiles = [...this.sourceFiles];
      // Simulate user choosing sheet2
      this.onChoose(sheet2);
    };

    const origTextInputOpen = TextInputModal.prototype.open;
    TextInputModal.prototype.open = function () {
      textInputModalOpened = true;
      // Simulate user entering page 42
      void this.onSubmit({ page: "42" });
    };

    const origInsertCitationFor = plugin.insertCitationFor;
    plugin.insertCitationFor = function (file, page) {
      citedFile = file;
      citedPage = page;
    };

    try {
      plugin.quickCiteAttachment(pdf);
    } finally {
      ConfirmModal.prototype.open = origConfirmOpen;
      CitationAmbiguousSheetModal.prototype.open = origAmbiguousOpen;
      TextInputModal.prototype.open = origTextInputOpen;
      plugin.insertCitationFor = origInsertCitationFor;
    }

    assert.equal(confirmOpened, false, "ConfirmModal is NEVER opened for ambiguous attachment");
    assert.equal(ambiguousModalOpened, true, "CitationAmbiguousSheetModal was opened");
    assert.equal(ambiguousCandidateFiles.length, 2, "Both claiming sheets are offered");
    assert.ok(ambiguousCandidateFiles.some((f) => f.path === sheet1.path));
    assert.ok(ambiguousCandidateFiles.some((f) => f.path === sheet2.path));
    assert.equal(textInputModalOpened, true, "Page prompt was opened after choosing sheet");
    assert.equal(citedFile?.path, sheet2.path, "insertCitationFor received the chosen markdown sheet");
    assert.notEqual(citedFile?.path, pdf.path, "insertCitationFor NEVER received the binary PDF path");
    assert.equal(citedPage, "42", "the page entered by the user was transmitted to insertCitationFor");
    assert.equal(files.size, initialFileCount + 1, "Zero new files were created");
  });

  await suite.test("Genuine Sources folders recognition: project, linked research, isolated space, subfolders, homonyms, boundaries", async () => {
    const { vault, fileManager, files } = createFakeVault();
    const settings = {
      projectFolder: "PROJET",
      orders: {},
      folderPositions: {},
      projectMeta: {
        "PROJET": {
          researchFolderLinks: {
            "PROJET/Chapitre1": "EXTERNE/RechercheLiee",
          },
        },
      },
    };

    // 1. Global Project Sources
    const project = new TFolder("PROJET", []);
    const projResearch = new TFolder("PROJET/_Recherche", []);
    const projSources = new TFolder("PROJET/_Recherche/Sources", []);
    const projSourcesSub = new TFolder("PROJET/_Recherche/Sources/Archives", []);
    const projSourcesExtra = new TFolder("PROJET/_Recherche/Sources-Extra", []);
    const projNotes = new TFolder("PROJET/_Recherche/Notes", []);
    const projBiblio = new TFolder("PROJET/_Recherche/Bibliographie", []);
    const projSibling = new TFolder("PROJET/_Recherche/AutreDossier", []);

    project.children = [projResearch];
    projResearch.parent = project;
    projResearch.children = [projSources, projSourcesExtra, projNotes, projBiblio, projSibling];
    for (const c of projResearch.children) c.parent = projResearch;
    projSources.children = [projSourcesSub];
    projSourcesSub.parent = projSources;

    // 2. Linked Research Sources
    const extRoot = new TFolder("EXTERNE", []);
    const extResearch = new TFolder("EXTERNE/RechercheLiee", []);
    const extSources = new TFolder("EXTERNE/RechercheLiee/Sources", []);
    const extOther = new TFolder("EXTERNE/RechercheLiee/Docs", []);
    extRoot.children = [extResearch];
    extResearch.parent = extRoot;
    extResearch.children = [extSources, extOther];
    extSources.parent = extResearch;
    extOther.parent = extResearch;

    // 3. Isolated space workspace research
    const spaceFolder = new TFolder("PROJET/EspaceIsole", []);
    project.children.push(spaceFolder);
    spaceFolder.parent = project;
    const spaceResearch = new TFolder("PROJET/EspaceIsole-Recherche", []);
    const spaceSources = new TFolder("PROJET/EspaceIsole-Recherche/Sources", []);
    spaceResearch.children = [spaceSources];
    spaceSources.parent = spaceResearch;
    project.children.push(spaceResearch);
    spaceResearch.parent = project;
    settings.projectMeta["PROJET"].researchFolderLinks["PROJET/EspaceIsole"] = "PROJET/EspaceIsole-Recherche";

    // 3bis. A sibling isolated space (Work-A-Extra-style boundary), linked independently
    const spaceFolderBis = new TFolder("PROJET/EspaceIsoleBis", []);
    project.children.push(spaceFolderBis);
    spaceFolderBis.parent = project;
    const spaceResearchBis = new TFolder("PROJET/EspaceIsoleBis-Recherche", []);
    const spaceSourcesBis = new TFolder("PROJET/EspaceIsoleBis-Recherche/Sources", []);
    spaceResearchBis.children = [spaceSourcesBis];
    spaceSourcesBis.parent = spaceResearchBis;
    project.children.push(spaceResearchBis);
    spaceResearchBis.parent = project;
    settings.projectMeta["PROJET"].researchFolderLinks["PROJET/EspaceIsoleBis"] = "PROJET/EspaceIsoleBis-Recherche";

    // 4. Custom folder named Sources outside research roots
    const outsideFolder = new TFolder("AUTRE/Sources", []);

    for (const f of [
      project, projResearch, projSources, projSourcesSub, projSourcesExtra, projNotes, projBiblio, projSibling,
      extRoot, extResearch, extSources, extOther,
      spaceFolder, spaceResearch, spaceSources,
      spaceFolderBis, spaceResearchBis, spaceSourcesBis,
      outsideFolder,
    ]) {
      files.set(f.path, f);
    }

    const app = {
      vault,
      fileManager,
      workspace: { getActiveFile: () => null, getLeaf: () => ({ openFile: async () => {} }) },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    };

    // `linked` deliberately contains only the research folder actually linked via a
    // manuscript file/folder link (extResearch). Isolated-space research folders are
    // never part of getLinkedResearchFolders(); they are only reachable through
    // resolveWorkspaceResearchContext() when activeWorkspaceFolder is passed. Keeping
    // spaceResearch out of `linked` is required for Test 3 below to actually exercise
    // that branch instead of trivially passing via the linked-folders loop.
    const linked = [{ folder: extResearch }];

    const genuineRoots = getGenuineSourcesRoots(app, settings, linked, null);
    assert.ok(genuineRoots.some((r) => r.path === projSources.path));
    assert.ok(genuineRoots.some((r) => r.path === extSources.path));
    assert.ok(
      !genuineRoots.some((r) => r.path === spaceSources.path),
      "Isolated space Sources is not resolved without an active workspace folder"
    );

    // Test 1: Global Sources in Project mode
    assert.equal(isGenuineSourcesFolder(app, settings, projSources, linked, null), true);

    // Test 2: Sources of a linked research visible in Project mode
    assert.equal(isGenuineSourcesFolder(app, settings, extSources, linked, null), true);

    // Test 3a: without an active workspace folder, the isolated space's Sources is NOT
    // discovered (it is neither the global project Sources nor a manuscript-linked one)
    assert.equal(isGenuineSourcesFolder(app, settings, spaceSources, linked, null), false);

    // Test 3b: with the matching active workspace folder, the isolated space's Sources
    // is discovered strictly through resolveWorkspaceResearchContext()
    assert.equal(isGenuineSourcesFolder(app, settings, spaceSources, linked, spaceFolder), true);

    // Test 3c: strict separation between two sibling isolated spaces (Work-A vs
    // Work-A-Extra style boundary) — each workspace folder resolves only its own
    // linked research Sources, never its sibling's
    assert.equal(isGenuineSourcesFolder(app, settings, spaceSourcesBis, linked, spaceFolder), false);
    assert.equal(isGenuineSourcesFolder(app, settings, spaceSources, linked, spaceFolderBis), false);
    assert.equal(isGenuineSourcesFolder(app, settings, spaceSourcesBis, linked, spaceFolderBis), true);

    // Test 4: Subfolder of genuine Sources
    assert.equal(isGenuineSourcesFolder(app, settings, projSourcesSub, linked, null), true);

    // Test 5: Custom homonym folder outside research
    assert.equal(isGenuineSourcesFolder(app, settings, outsideFolder, linked, null), false);

    // Test 6: Boundary Sources vs Sources-Extra
    assert.equal(isGenuineSourcesFolder(app, settings, projSourcesExtra, linked, null), false);

    // Non-sources folders in research
    assert.equal(isGenuineSourcesFolder(app, settings, projBiblio, linked, null), false);
    assert.equal(isGenuineSourcesFolder(app, settings, projNotes, linked, null), false);
    assert.equal(isGenuineSourcesFolder(app, settings, projSibling, linked, null), false);
    assert.equal(isGenuineSourcesFolder(app, settings, extOther, linked, null), false);

    // DOM & Callbacks: Test that context menu on linked sources folder has 3 actions and passes exact folder
    const plugin = new FeuilletsPlugin(app, { id: "feuillets" });
    plugin.settings = settings;
    plugin.getLinkedResearchFolders = () => linked;
    plugin.getWorkspaceFolder = () => null;
    // In Project mode, getCitationFolders returns ONLY global sources
    plugin.getCitationFolders = () => [projSources];

    const leaf = { app, contentEl: new FakeElement() };
    const view = new ResearchView(leaf, plugin);

    let createdTargetFolder = null;
    view["promptCreateResearchFile"] = (target) => {
      createdTargetFolder = target;
    };

    let citedTargetFolder = null;
    plugin.openInsertCitation = (editor, target) => {
      citedTargetFolder = target;
    };

    let importedTargetFolder = null;
    view["promptImportFilesIntoResearchFolder"] = (target) => {
      importedTargetFolder = target;
    };

    let shownMenu = null;
    const origShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
    Menu.prototype.showAtMouseEvent = function () {
      shownMenu = this;
      return this;
    };

    try {
      // Open menu on linked research sources folder (not global sources)
      view["showResearchFolderContextMenu"]({ clientX: 0, clientY: 0 }, extSources);
    } finally {
      Menu.prototype.showAtMouseEvent = origShowAtMouseEvent;
    }

    assert.ok(shownMenu, "Menu was opened on linked research Sources folder");
    assert.equal(shownMenu.items[0].title, t("shared.research.newSourceSheet"));
    assert.equal(shownMenu.items[1].title, t("main.cmd.insertCitation"));
    assert.equal(shownMenu.items[2].title, t("shared.research.importDocuments"));
    // Test 8: 3 actions followed by separator
    assert.equal(shownMenu.items[3].separator, true);

    // Test 7: Each callback receives exact clicked folder
    await shownMenu.items[0].click();
    assert.equal(createdTargetFolder?.path, extSources.path, "New source sheet callback received exact folder");

    shownMenu.items[1].click();
    assert.equal(citedTargetFolder?.path, extSources.path, "Insert citation callback received exact folder");

    shownMenu.items[2].click();
    assert.equal(importedTargetFolder?.path, extSources.path, "Import callback received exact folder");

    // Test 9: Non-sources folder (e.g. Sources-Extra) does NOT receive the 3 actions
    let nonSourcesMenu = null;
    Menu.prototype.showAtMouseEvent = function () {
      nonSourcesMenu = this;
      return this;
    };
    try {
      view["showResearchFolderContextMenu"]({ clientX: 0, clientY: 0 }, projSourcesExtra);
    } finally {
      Menu.prototype.showAtMouseEvent = origShowAtMouseEvent;
    }
    assert.ok(nonSourcesMenu);
    assert.notEqual(nonSourcesMenu.items[0]?.title, t("shared.research.newSourceSheet"));
    assert.notEqual(nonSourcesMenu.items[1]?.title, t("main.cmd.insertCitation"));
    assert.notEqual(nonSourcesMenu.items[2]?.title, t("shared.research.importDocuments"));
  });

  await suite.test("buildSourceSheetContent: comprehensive frontmatter hardening (12 requirements)", () => {
    // 1. Root attachments updated
    const t1 = "---\ntitle: \"Existing\"\nattachments:\n  - \"[[old.pdf]]\"\n---\nBody";
    const res1 = buildSourceSheetContent(t1, "Default", "Existing", "new.pdf");
    assert.ok(res1.includes('- "[[old.pdf]]"'));
    assert.ok(res1.includes('- "[[new.pdf]]"'));

    // 2. Nested attachments without root property: nested remains strictly unchanged, root property added
    const t2 = "---\ntitle: \"Notice\"\nzotero:\n  attachments:\n    - \"[[zotero.pdf]]\"\ntags:\n  - archive\n---\nBody";
    const res2 = buildSourceSheetContent(t2, "Default", "Notice", "root.pdf");
    assert.ok(res2.includes('zotero:\n  attachments:\n    - "[[zotero.pdf]]"'), "Nested attachments block is strictly unchanged");
    assert.ok(res2.includes('attachments:\n  - "[[root.pdf]]"'), "Root attachments property added");
    assert.ok(res2.includes('tags:\n  - archive'), "Tags preserved");

    // 3. Simultaneous presence of root and nested attachments: only root property changes
    const t3 = "---\ntitle: \"Notice\"\nattachments:\n  - \"[[doc1.pdf]]\"\nzotero:\n  attachments:\n    - \"[[zotero.pdf]]\"\n---\nBody";
    const res3 = buildSourceSheetContent(t3, "Default", "Notice", "doc2.pdf");
    assert.ok(res3.includes('attachments:\n  - "[[doc1.pdf]]"\n  - "[[doc2.pdf]]"'), "Root attachments received doc2.pdf");
    assert.ok(res3.includes('zotero:\n  attachments:\n    - "[[zotero.pdf]]"'), "Nested attachments remained unchanged");

    // 4. Comment placed between attachments: and a list item
    const t4 = "---\ntitle: \"Notice\"\nattachments:\n  # comment before items\n  - \"[[doc1.pdf]]\"\n---\n";
    const res4 = buildSourceSheetContent(t4, "Default", "Notice", "doc2.pdf");
    assert.ok(res4.includes('# comment before items'), "Comment between attachments: and list item is preserved");
    assert.ok(res4.includes('- "[[doc1.pdf]]"'));
    assert.ok(res4.includes('- "[[doc2.pdf]]"'));

    // 5. Comment placed after an item
    const t5 = "---\ntitle: \"Notice\"\nattachments:\n  - \"[[doc1.pdf]]\"\n  # comment after doc1\n---\n";
    const res5 = buildSourceSheetContent(t5, "Default", "Notice", "doc2.pdf");
    assert.ok(res5.includes('# comment after doc1'), "Comment after item is preserved");
    assert.ok(res5.includes('- "[[doc2.pdf]]"'));

    // 6. Property following immediately after attachments block
    const t6 = "---\ntitle: \"Notice\"\nattachments:\n  - \"[[doc1.pdf]]\"\nauthor: \"Marc Bloch\"\n---\n";
    const res6 = buildSourceSheetContent(t6, "Default", "Notice", "doc2.pdf");
    assert.ok(res6.includes('attachments:\n  - "[[doc1.pdf]]"\n  - "[[doc2.pdf]]"\nauthor: "Marc Bloch"'), "Following property remains immediately after");

    // 7. Inline array
    const t7 = "---\ntitle: \"Notice\"\nattachments: [\"[[doc1.pdf]]\"]\n---\n";
    const res7 = buildSourceSheetContent(t7, "Default", "Notice", "doc2.pdf");
    assert.ok(!res7.includes('attachments: ['), "Inline array cleanly converted to block");
    assert.ok(res7.includes('- "[[doc1.pdf]]"'));
    assert.ok(res7.includes('- "[[doc2.pdf]]"'));

    // 8. Empty array
    const t8 = "---\ntitle: \"Notice\"\nattachments: []\n---\n";
    const res8 = buildSourceSheetContent(t8, "Default", "Notice", "doc1.pdf");
    assert.ok(!res8.includes('[]'));
    assert.ok(res8.includes('attachments:\n  - "[[doc1.pdf]]"'));

    // 9. Scalar value
    const t9 = "---\ntitle: \"Notice\"\nattachments: \"[[doc1.pdf]]\"\n---\n";
    const res9 = buildSourceSheetContent(t9, "Default", "Notice", "doc2.pdf");
    assert.ok(res9.includes('- "[[doc1.pdf]]"'));
    assert.ok(res9.includes('- "[[doc2.pdf]]"'));

    // 10. Link already present under another equivalent form
    const t10 = "---\ntitle: \"Notice\"\nattachments:\n  - \"doc1.pdf\"\n---\n";
    const res10 = buildSourceSheetContent(t10, "Default", "Notice", "[[doc1.pdf]]");
    const countDoc1 = (res10.match(/doc1\.pdf/g) || []).length;
    assert.equal(countDoc1, 1, "Already present equivalent link is not duplicated");

    // 11. Path containing quotes and backslashes
    const trickyPath = 'folder\\"sub\\archive "test".pdf';
    const res11 = buildSourceSheetContent("---\ntitle: \"Test\"\n---\n", "Default", "Test", trickyPath);
    assert.ok(res11.includes('\\"'));
    assert.ok(res11.includes('\\\\'));

    // 12. Exactly two frontmatter delimiters and a single root attachments key
    const delimiterCount = (res2.match(/^---$/gm) || []).length;
    assert.equal(delimiterCount, 2, "Exactly two frontmatter delimiters");
    const rootAttachmentsCount = (res2.match(/^attachments:/gm) || []).length;
    assert.equal(rootAttachmentsCount, 1, "Exactly one root attachments property");
  });

  // 1. Inline bracketed array with a trailing end-of-line comment
  await suite.test("buildSourceSheetContent: inline array with trailing comment is preserved and not corrupted", () => {
    const template = "---\ntitle: \"Notice\"\nattachments: [\"[[doc.pdf]]\"] # commentaire\n---\n";
    const result = buildSourceSheetContent(template, "Default", "Notice", "nouveau.pdf");
    assert.ok(result.includes("# commentaire"), "Trailing comment text is preserved");
    assert.ok(result.includes('- "[[doc.pdf]]"'));
    assert.ok(result.includes('- "[[nouveau.pdf]]"'));
    assert.ok(!result.includes('# commentaire"'), "Comment is never merged into a quoted link value");
    const delimiterCount = (result.match(/^---$/gm) || []).length;
    assert.equal(delimiterCount, 2);
  });

  // 2. Inline scalar with a trailing end-of-line comment
  await suite.test("buildSourceSheetContent: scalar with trailing comment is preserved and not corrupted", () => {
    const template = "---\ntitle: \"Notice\"\nattachments: \"[[doc.pdf]]\" # commentaire\n---\n";
    const result = buildSourceSheetContent(template, "Default", "Notice", "nouveau.pdf");
    assert.ok(result.includes("# commentaire"));
    assert.ok(result.includes('- "[[doc.pdf]]"'));
    assert.ok(result.includes('- "[[nouveau.pdf]]"'));
    const docCount = (result.match(/doc\.pdf/g) || []).length;
    assert.equal(docCount, 1, "The commented scalar link is not duplicated");
  });

  // 3. Block list item with a trailing end-of-line comment
  await suite.test("buildSourceSheetContent: block list item with trailing comment is preserved and not duplicated", () => {
    const template = "---\ntitle: \"Notice\"\nattachments:\n  - \"[[doc.pdf]]\" # document principal\n---\n";
    const result = buildSourceSheetContent(template, "Default", "Notice", "nouveau.pdf");
    assert.ok(result.includes("# document principal"));
    assert.ok(result.includes('- "[[nouveau.pdf]]"'));
    const docCount = (result.match(/doc\.pdf/g) || []).length;
    assert.equal(docCount, 1, "The commented item is never duplicated");
  });

  // 4. Adding the same link as an already-commented item never duplicates it
  await suite.test("buildSourceSheetContent: adding the same link as a commented item causes no duplication", () => {
    const template = "---\ntitle: \"Notice\"\nattachments:\n  - \"[[doc.pdf]]\" # document principal\n---\n";
    const result = buildSourceSheetContent(template, "Default", "Notice", "doc.pdf");
    const docCount = (result.match(/doc\.pdf/g) || []).length;
    assert.equal(docCount, 1, "Re-adding the exact same commented link does not duplicate it");
    assert.ok(result.includes("# document principal"), "Comment remains present");
  });

  // 5. Two root attachments properties are merged into one
  await suite.test("buildSourceSheetContent: two root attachments properties are merged into one", () => {
    const template = "---\ntitle: \"Notice\"\nattachments:\n  - \"[[first.pdf]]\"\nattachments:\n  - \"[[second.pdf]]\"\n---\n";
    const result = buildSourceSheetContent(template, "Default", "Notice", "third.pdf");
    assert.ok(result.includes('- "[[first.pdf]]"'));
    assert.ok(result.includes('- "[[second.pdf]]"'));
    assert.ok(result.includes('- "[[third.pdf]]"'));
    const rootAttachmentsCount = (result.match(/^attachments:/gm) || []).length;
    assert.equal(rootAttachmentsCount, 1, "Exactly one root attachments key remains");
  });

  // 6. Two root attachments properties holding the same link under different forms
  await suite.test("buildSourceSheetContent: two root attachments properties with the same link in different forms are deduplicated on merge", () => {
    const template = "---\ntitle: \"Notice\"\nattachments:\n  - \"[[doc.pdf]]\"\nattachments: [\"doc.pdf\"]\n---\n";
    const result = buildSourceSheetContent(template, "Default", "Notice", "new.pdf");
    const docCount = (result.match(/doc\.pdf/g) || []).length;
    assert.equal(docCount, 1, "The equivalent link across both root properties is merged without duplication");
    assert.ok(result.includes('- "[[new.pdf]]"'));
    const rootAttachmentsCount = (result.match(/^attachments:/gm) || []).length;
    assert.equal(rootAttachmentsCount, 1);
  });

  // 7. Comments present in both merged blocks are preserved
  await suite.test("buildSourceSheetContent: comments from both merged root attachments blocks are preserved", () => {
    const template = "---\ntitle: \"Notice\"\nattachments: [\"[[first.pdf]]\"] # premier bloc\nattachments:\n  - \"[[second.pdf]]\" # second bloc\n---\n";
    const result = buildSourceSheetContent(template, "Default", "Notice", "third.pdf");
    assert.ok(result.includes("# premier bloc"), "First block's comment is preserved");
    assert.ok(result.includes("# second bloc"), "Second block's comment is preserved");
    assert.ok(result.includes('- "[[first.pdf]]"'));
    assert.ok(result.includes('- "[[second.pdf]]"'));
    assert.ok(result.includes('- "[[third.pdf]]"'));
  });

  // 8. A nested attachments property is strictly unchanged when root properties merge
  await suite.test("buildSourceSheetContent: a nested attachments property is strictly unchanged when root properties are merged", () => {
    const template = "---\ntitle: \"Notice\"\nattachments:\n  - \"[[first.pdf]]\"\nzotero:\n  attachments:\n    - \"[[zotero.pdf]]\"\nattachments:\n  - \"[[second.pdf]]\"\n---\n";
    const result = buildSourceSheetContent(template, "Default", "Notice", "third.pdf");
    assert.ok(result.includes('zotero:\n  attachments:\n    - "[[zotero.pdf]]"'), "Nested attachments property is untouched");
    assert.ok(result.includes('- "[[first.pdf]]"'));
    assert.ok(result.includes('- "[[second.pdf]]"'));
    assert.ok(result.includes('- "[[third.pdf]]"'));
    const rootAttachmentsCount = (result.match(/^attachments:/gm) || []).length;
    assert.equal(rootAttachmentsCount, 1, "Exactly one root attachments key remains; the nested one is not counted");
  });

  // 9 & 10. A single root key remains and the frontmatter stays valid YAML, even
  // with a property sitting between the two duplicated root keys and comments on both.
  await suite.test("buildSourceSheetContent: merged result always has a single root attachments key and exactly two frontmatter delimiters", () => {
    const template = [
      "---",
      "title: \"Notice\"",
      "attachments: [\"[[first.pdf]]\"] # premier",
      "tags:",
      "  - roman",
      "attachments:",
      "  - \"[[second.pdf]]\" # second",
      "---",
      "Body text.",
    ].join("\n");
    const result = buildSourceSheetContent(template, "Default", "Notice", "third.pdf");
    const delimiterCount = (result.match(/^---$/gm) || []).length;
    assert.equal(delimiterCount, 2, "Exactly two frontmatter delimiters");
    const rootAttachmentsCount = (result.match(/^attachments:/gm) || []).length;
    assert.equal(rootAttachmentsCount, 1, "Exactly one root attachments property remains");
    assert.ok(result.includes("tags:\n  - roman"), "A property sitting between the two root attachments keys is preserved");
    assert.ok(result.includes("Body text."));
  });
});
