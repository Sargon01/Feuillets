import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import {
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

test("Unrelated binary files stay out of Research surfaces", () => {
  assert.equal(isResearchFile(new TFile("Research/Archive.zip")), false);
  assert.equal(isResearchFile(new TFile("Research/Application.exe")), false);
});
