import assert from "node:assert/strict";
import test from "node:test";
import { TFile, MarkdownView } from "obsidian";
import FeuilletsPlugin from "../src/main.js";
import { t } from "../src/i18n/index.js";

/**
 * registerCoreCommands() enregistre BEAUCOUP de commandes (binder, board,
 * annotations…) — mais toute leur logique vit dans des callbacks jamais
 * invoqués ici : seul l'enregistrement lui-même (ids/noms) est exercé, ce
 * qui rend une instance FeuilletsPlugin minimale (Object.create) sûre, comme
 * dans test/main-auto-open-panels.test.js.
 */
function createPlugin(app) {
  const commands = [];
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.app = app;
  plugin.addCommand = (command) => commands.push(command);
  plugin.registerCoreCommands();
  return commands;
}

function markdownFile(path = "Cours.md") {
  return new TFile(path, "");
}

function appWithActiveMarkdownFile(file) {
  const leaf = { view: { file } };
  return {
    workspace: {
      getActiveViewOfType: (type) => (type === MarkdownView ? { file, leaf } : null),
      getActiveFile: () => file,
      getLeavesOfType: () => [leaf],
    },
  };
}

function appWithNoActiveFile() {
  return {
    workspace: {
      getActiveViewOfType: () => null,
      getActiveFile: () => null,
      getLeavesOfType: () => [],
    },
  };
}

test("registerCoreCommands : les deux commandes Présentation sont enregistrées, noms FR commençant par « Présentation : »", () => {
  const commands = createPlugin(appWithNoActiveFile());
  const byId = new Map(commands.map((c) => [c.id, c]));

  assert.ok(byId.has("present-current-file-preview"));
  assert.ok(byId.has("presentation-export-pdf"));

  assert.equal(byId.get("present-current-file-preview").name, t("presentation.preview.command"));
  assert.equal(byId.get("presentation-export-pdf").name, t("presentation.export.pdf.command"));

  for (const id of ["present-current-file-preview", "presentation-export-pdf"]) {
    assert.ok(byId.get(id).name.startsWith("Présentation : "), `${id} : nom commence par « Présentation : »`);
  }
});

test("registerCoreCommands : la projection n'a plus de commande propre — elle se lance depuis l'aperçu", () => {
  // Deux commandes « Présentation… » ouvrant deux onglets quasi identiques
  // faisaient doublon : l'aperçu est le point d'entrée unique, et le bouton
  // « Lancer la présentation » ouvre la projection (voir
  // views/presentation-preview-view.ts).
  const ids = createPlugin(appWithNoActiveFile()).map((c) => c.id);
  assert.equal(ids.includes("present-current-file"), false);
  assert.equal(ids.filter((id) => id.startsWith("present-current-file")).length, 1, "une seule commande d'ouverture Présentation");
});

test("registerCoreCommands : l'ancienne commande « Support papier / aperçu papier Présentation » n'est plus enregistrée", () => {
  const commands = createPlugin(appWithNoActiveFile());
  const ids = commands.map((c) => c.id);
  assert.equal(ids.includes("present-current-file-paper-preview"), false);
});

test("registerCoreCommands : checkCallback des commandes Présentation résolu via le contexte partagé (aucun fichier actif => indisponibles)", () => {
  const commands = createPlugin(appWithNoActiveFile());
  const byId = new Map(commands.map((c) => [c.id, c]));
  for (const id of ["present-current-file-preview", "presentation-export-pdf"]) {
    assert.equal(byId.get(id).checkCallback(true), false, `${id} indisponible sans fichier actif`);
  }
});

test("registerCoreCommands : checkCallback des commandes Présentation disponible avec un fichier Markdown actif", () => {
  const file = markdownFile();
  const commands = createPlugin(appWithActiveMarkdownFile(file));
  const byId = new Map(commands.map((c) => [c.id, c]));
  for (const id of ["present-current-file-preview", "presentation-export-pdf"]) {
    assert.equal(byId.get(id).checkCallback(true), true, `${id} disponible avec un fichier Markdown actif`);
  }
});

test("registerCoreCommands : la commande d'export PDF ouvre TOUJOURS le choix de format (16:9 / A4), jamais un format silencieux", async () => {
  const { PresentationPdfExportModal } = await import("../src/ui/presentation-pdf-export-modal.js");
  const previousOpen = PresentationPdfExportModal.prototype.open;
  let opened = null;
  PresentationPdfExportModal.prototype.open = function () { opened = this; };
  try {
    const file = markdownFile();
    const commands = createPlugin(appWithActiveMarkdownFile(file));
    const command = commands.find((c) => c.id === "presentation-export-pdf");

    command.checkCallback(false);

    assert.ok(opened instanceof PresentationPdfExportModal, "la modale de choix de format est ouverte, jamais un export direct");
    // exportPresentationPdf retombe tôt sans effet de bord (`document` non
    // défini ici) : suffit à prouver que le choix atteint la vraie fonction.
    assert.doesNotThrow(() => opened.onChoose("16:9"));
    assert.doesNotThrow(() => opened.onChoose("a4-landscape"));
  } finally { PresentationPdfExportModal.prototype.open = previousOpen; }
});
