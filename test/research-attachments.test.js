import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import {
  isExcalidrawMarkdownFile,
  isResearchAttachment,
  isResearchFile,
  researchFileIcon,
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
