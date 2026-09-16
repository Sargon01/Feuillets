import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/default-settings.js";
import { fr } from "../src/i18n/fr.js";
import { en } from "../src/i18n/en.js";
import { normalizeJournalSuffix } from "../src/services/journal.js";

test("réglages : journalFileSuffix existe par défaut et vaut une chaîne vide", () => {
  assert.equal(typeof DEFAULT_SETTINGS.journalFileSuffix, "string");
  assert.equal(DEFAULT_SETTINGS.journalFileSuffix, "");
});

test("i18n : les clés du suffixe de journal existent en français et en anglais", () => {
  for (const key of [
    "settings.section.journal",
    "settings.journalFileSuffix.name",
    "settings.journalFileSuffix.desc",
    "settings.journalFileSuffix.placeholder",
  ]) {
    assert.equal(typeof fr[key], "string", `fr.${key} manquante`);
    assert.ok(fr[key].length > 0, `fr.${key} vide`);
    assert.equal(typeof en[key], "string", `en.${key} manquante`);
    assert.ok(en[key].length > 0, `en.${key} vide`);
  }
});

test("i18n : le placeholder du suffixe est bien « log »", () => {
  assert.equal(fr["settings.journalFileSuffix.placeholder"], "log");
  assert.equal(en["settings.journalFileSuffix.placeholder"], "log");
});

test("réglages : normalizeJournalSuffix est exportée et normalise une valeur brute", () => {
  assert.equal(typeof normalizeJournalSuffix, "function");
  assert.equal(normalizeJournalSuffix(" Log "), "Log");
  assert.equal(normalizeJournalSuffix(""), "");
});
