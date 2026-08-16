import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fr } from "../src/i18n/fr.js";
import { en } from "../src/i18n/en.js";

/* Dernier lot UX avant 2.5, §12B (point 21 des tests de non-régression) :
 * aucun nouveau libellé français hardcodé dans les nouvelles surfaces —
 * toute nouvelle clé introduite par ce chantier existe dans les DEUX
 * langues (même patron que ScenesEditor, voir scenes-editor-i18n.test.js),
 * et les anciens libellés hardcodés qu'elle remplace ont bien disparu des
 * fichiers source. */

test("dernier lot UX avant 2.5 : toutes les nouvelles clés i18n existent en FR et en EN", () => {
  const prefixes = ["compositionSummary.", "binder.quickExport.", "settings.separator.", "settings.compilePresets.groupLabel"];
  const keys = Object.keys(fr).filter((key) => prefixes.some((p) => key === p || key.startsWith(p)));
  assert.ok(keys.length >= 15, "les nouvelles clés du chantier sont bien présentes dans fr.ts");
  for (const key of keys) {
    assert.ok(en[key], `${key} manque en anglais`);
    assert.notEqual(en[key], "", `${key} ne doit pas être vide en anglais`);
  }

  for (const key of [
    "modal.layout.format", "modal.layout.orientation", "modal.layout.portrait", "modal.layout.landscape",
    "modal.layout.marginsGroup", "modal.layout.marginTop", "modal.layout.marginBottom",
    "modal.layout.marginLeft", "modal.layout.marginRight", "modal.layout.mirrorMargins",
    "modal.layout.columns", "modal.layout.gutterPt", "binder.notebookTooltip",
  ]) {
    assert.ok(fr[key], `${key} manque en français`);
    assert.ok(en[key], `${key} manque en anglais`);
  }
});

test("dernier lot UX avant 2.5 : les libellés Composition remplacés (tab labels hardcodés) ont disparu de edition-composition-content.ts", async () => {
  const source = await readFile("src/ui/edition-composition-content.ts", "utf8");
  // Les quatre anciens libellés d'onglets hardcodés ("Contenu", "Notes",
  // "Informations" et le tableau `sections` lui-même) n'existent plus tels
  // quels comme chaînes littérales de rendu.
  assert.doesNotMatch(source, /\["content", "Contenu"\]/);
  assert.doesNotMatch(source, /\["notes", "Notes"\]/);
  assert.doesNotMatch(source, /\["information", "Informations"\]/);
  assert.doesNotMatch(source, /text: "Manuscrit"/);
  assert.doesNotMatch(source, /text: "Éléments générés"/);
});

test("dernier lot UX avant 2.5 : le tooltip \"Carnet\" du Binder passe par t(), plus hardcodé", async () => {
  const source = await readFile("src/views/feuillets-view.ts", "utf8");
  assert.doesNotMatch(source, /"notebook", "Carnet"/);
  assert.match(source, /"notebook", t\("binder\.notebookTooltip"\)/);
});
