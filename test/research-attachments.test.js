import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TFile } from "obsidian";
import {
  isExcalidrawMarkdownFile,
  isResearchAttachment,
  isResearchExtension,
  isResearchFile,
  isResearchPreviewable,
  researchAcceptedExtensions,
  researchFileIcon,
  researchFileTypeLabel,
} from "../src/services/research.js";

const supportedAttachments = [
  "reference.pdf",
  "manuscript.doc",
  "manuscript.docx",
  "manuscript.odt",
  "notes.rtf",
  "data.xls",
  "data.xlsx",
  "data.ods",
  "data.csv",
  "data.tsv",
  "slides.ppt",
  "slides.pptx",
  "slides.odp",
  "book.epub",
  "cover.png",
  "sources.bib",
];

test("Research accepts common office, OpenDocument, ebook, PDF, and image attachments", () => {
  for (const name of supportedAttachments) {
    const file = new TFile(`Research/${name}`);
    assert.equal(isResearchFile(file), true, `${name} must be listed in Research`);
    assert.equal(isResearchAttachment(file), true, `${name} must open through an Obsidian viewer`);
  }
});

test("Markdown remains an editable Research sheet", () => {
  const file = new TFile("Research/Notes.md");
  assert.equal(isResearchFile(file), true);
  assert.equal(isResearchAttachment(file), false);
});

test("Research attachment icons identify document families", () => {
  assert.equal(researchFileIcon(new TFile("Research/Data.xlsx")), "table-2");
  assert.equal(researchFileIcon(new TFile("Research/Slides.pptx")), "presentation");
  assert.equal(researchFileIcon(new TFile("Research/Book.epub")), "book-open");
  assert.equal(researchFileIcon(new TFile("Research/Reference.docx")), "file-text");
});

test("isExcalidrawMarkdownFile : reconnaît un \"*.excalidraw.md\", jamais une note Markdown ordinaire", () => {
  assert.equal(isExcalidrawMarkdownFile(new TFile("Research/Croquis.excalidraw.md")), true);
  assert.equal(isExcalidrawMarkdownFile(new TFile("Research/Notes.md")), false);
  assert.equal(isExcalidrawMarkdownFile(new TFile("Research/excalidraw.md")), false, "un simple fichier nommé \"excalidraw.md\" n'est pas un dessin");
  assert.equal(isExcalidrawMarkdownFile(new TFile("Research/Drawing.excalidraw")), false);
  assert.equal(isExcalidrawMarkdownFile({}), false);
});

test("researchFileIcon : \"pencil\" (icône Obsidian sûre, jamais \"pencil-ruler\") pour un dessin Excalidraw, non-régression d'une note Markdown ordinaire", () => {
  assert.equal(researchFileIcon(new TFile("Research/Croquis.excalidraw.md")), "pencil");
  assert.equal(researchFileIcon(new TFile("Research/Croquis.excalidraw 1.md")), "pencil");
  assert.equal(researchFileIcon(new TFile("Research/Notes.md")), "file-text");
});

test("Unrelated binary files stay out of Research surfaces", () => {
  assert.equal(isResearchFile(new TFile("Research/Archive.zip")), false);
  assert.equal(isResearchFile(new TFile("Research/Application.exe")), false);
});

/* ===== BibTeX (.bib) : reconnu comme n'importe quelle pièce jointe
   documentaire, jamais analysé ni ouvert par un lecteur dédié — voir
   src/services/research.ts (RESEARCH_DOCUMENT_EXTS). ===== */

test("isResearchExtension recognizes \"bib\" (case-insensitive)", () => {
  assert.equal(isResearchExtension("bib"), true);
  assert.equal(isResearchExtension("BIB"), true);
});

test("isResearchFile recognizes a .bib file", () => {
  const file = new TFile("Research/Sources.bib");
  assert.equal(isResearchFile(file), true);
  assert.equal(isResearchAttachment(file), true, ".bib must open through Obsidian's generic attachment mechanism, never an embedded editor");
});

test("researchAcceptedExtensions lists \"bib\" — feeds the import picker's accept attribute", () => {
  assert.ok(researchAcceptedExtensions().includes("bib"));
});

test("researchFileTypeLabel : \"BIB\" indicator for a .bib file, same convention as PDF/DOCX", () => {
  assert.equal(researchFileTypeLabel(new TFile("Research/Sources.bib")), "BIB");
});

test("isResearchPreviewable : no eye button for .bib — Obsidian has no native preview for BibTeX", () => {
  assert.equal(isResearchPreviewable(new TFile("Research/Sources.bib")), false);
});

test("no BibTeX reader, bibliography manager, or third-party plugin detection was introduced anywhere in Research", () => {
  const sources = [
    "src/services/research.ts",
    "src/services/research-import.ts",
    "src/views/base-feuillets-view.ts",
  ].map((path) => readFileSync(join(process.cwd(), path), "utf8"));
  const forbidden = [/Zotero/i, /Better\s?BibTeX/i, /Citations?\s?plugin/i, /BibTeX(?:Parser|Reader|Editor)/i];
  for (const source of sources) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern);
    }
  }
});
