import assert from "node:assert/strict";
import test from "node:test";
import FeuilletsPlugin from "../src/main.js";

/* Dernier lot UX avant 2.5, §12A — point 20 des tests de non-régression :
 * "Ouvrir Révision DOCX" doit ouvrir Relecture, pas Projet. Même patron
 * d'instanciation minimale que test/settings-legacy-migration.test.js
 * (Object.create(FeuilletsPlugin.prototype)) : pas besoin d'un vrai Obsidian. */

function buildPlugin(hiddenPanels = []) {
  const plugin = Object.create(FeuilletsPlugin.prototype);
  plugin.settings = { hiddenPanels };
  const view = { activeTab: null, render: async () => {} };
  const leaf = { setViewState: async () => {}, view };
  const workspace = {
    getLeavesOfType: () => [leaf],
    getRightLeaf: () => leaf,
    revealLeaf: () => {},
  };
  plugin.app = { workspace };
  return { plugin, view };
}

test("activateDocxReview() ouvre l'onglet Relecture, pas Projet", async () => {
  const { plugin, view } = buildPlugin();
  await plugin.activateDocxReview();
  assert.equal(view.activeTab, "relecture");
});

test("open-docx-review : la clé de panneau masqué vérifiée est \"relecture\", plus l'ancienne \"docxReview\"", async () => {
  // "docxReview" masqué (ancienne clé, VIEW_DOCX_REVIEW autonome) ne doit
  // PLUS bloquer l'ouverture de Relecture : elles sont désormais
  // dissociées.
  const { plugin: pluginA, view: viewA } = buildPlugin(["docxReview"]);
  assert.equal(pluginA.isPanelHidden("relecture"), false);
  await pluginA.activateDocxReview();
  assert.equal(viewA.activeTab, "relecture", "docxReview masqué n'empêche plus Relecture de s'ouvrir");

  // "relecture" masqué (nouvelle clé, onglet réel) doit bloquer l'ouverture.
  const { plugin: pluginB } = buildPlugin(["relecture"]);
  assert.equal(pluginB.isPanelHidden("relecture"), true);
});
