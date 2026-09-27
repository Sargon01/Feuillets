import test from "node:test";
import assert from "node:assert/strict";
import { translate } from "../src/i18n/index.js";

/*
 * Targeted FR/EN i18n fixes: a handful of remaining paths that could still
 * show or create French text under an English UI. Not a general i18n
 * refresh — just these specific dictionary values and how the two locales'
 * dictionaries must never accidentally leak each other's language.
 */

test("preview.export.defaultFileName: English is 'Manuscript', French stays 'Manuscrit'", () => {
  assert.equal(translate("en", "preview.export.defaultFileName"), "Manuscript");
  assert.equal(translate("fr", "preview.export.defaultFileName"), "Manuscrit");
});

test("settings.dimTabActions.desc: the English description says 'Research', never the French 'Recherche'", () => {
  const value = translate("en", "settings.dimTabActions.desc");
  assert.match(value, /\bResearch\b/);
  assert.doesNotMatch(value, /\bRecherche\b/);
});

test("settings.dimTabActions.desc: the French description still says 'Recherche'", () => {
  const value = translate("fr", "settings.dimTabActions.desc");
  assert.match(value, /\bRecherche\b/);
});
