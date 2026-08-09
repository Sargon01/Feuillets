import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { ExportModal } from "../src/ui/export-modal.js";

function createModal(exportFormat, exportScope) {
  return new ExportModal(
    {},
    {
      settings: { exportFormat },
      getProjectFolder: () => null,
      titleFor: () => "",
    },
    exportScope
  );
}

test("ExportModal initialise le format depuis les réglages", () => {
  const docxModal = createModal("docx", { type: "project" });
  const pdfModal = createModal("pdf", { type: "project" });

  assert.equal(docxModal.selectedFormat, "docx");
  assert.equal(pdfModal.selectedFormat, "pdf");
});

test("ExportModal initialise le nom d'une portée fichier sans extension", () => {
  const file = new TFile("Projet/Chapitre.md");
  const modal = createModal("docx", { type: "file", files: [file] });

  assert.equal(modal.outputName, "Chapitre");
});

test("ExportModal conserve Recueil pour une portée sélection", () => {
  const modal = createModal("docx", { type: "selection" });

  assert.equal(modal.outputName, "Recueil");
});
