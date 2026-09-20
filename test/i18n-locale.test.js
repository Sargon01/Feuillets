import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getLocale, setLocale, detectLocale, translate, t } from "../src/i18n/index.js";
import { fr } from "../src/i18n/fr.js";
import { en } from "../src/i18n/en.js";
import { languageStub } from "obsidian";

/* i18n foundation: English is the deterministic technical fallback locale.
   Every test below sets whatever locale it needs explicitly and restores
   the previous value afterward — never relying on the shared test-only
   bootstrap (test/i18n-test-bootstrap.js) that sets French once per test
   file for the many pre-existing, unrelated tests that still assert
   French UI strings without calling setLocale("fr") themselves. */

test("the module's own initial in-memory locale is English — source-level check (the shared test bootstrap intentionally sets French before this file's own tests run, so it cannot be observed at runtime here)", () => {
  const source = readFileSync(join(process.cwd(), "src/i18n/index.ts"), "utf8");
  assert.match(source, /const FALLBACK_LOCALE: Locale = "en";/, "English must be the fallback locale constant");
  assert.match(source, /let currentLocale: Locale = FALLBACK_LOCALE;/, "the in-memory locale must start out as the fallback (English)");
});

/* ==================== exact key parity between en and fr ==================== */

test("en.ts and fr.ts have exactly the same set of keys", () => {
  const frKeys = Object.keys(fr).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, frKeys);
});

test("every projectCreation.* key introduced by this batch exists in both dictionaries with a non-empty value", () => {
  const projectCreationKeys = Object.keys(fr).filter((key) => key.startsWith("projectCreation."));
  assert.ok(projectCreationKeys.length >= 29, "the full catalogue key set must be present");
  for (const key of projectCreationKeys) {
    assert.equal(typeof fr[key], "string");
    assert.notEqual(fr[key], "");
    assert.equal(typeof en[key], "string");
    assert.notEqual(en[key], "");
  }
});

/* ==================== setLocale: English fallback for an unsupported code ==================== */

test("setLocale falls back to English for an unrecognized locale code", () => {
  const previous = getLocale();
  try {
    setLocale("es");
    assert.equal(getLocale(), "en");
  } finally {
    setLocale(previous);
  }
});

test("setLocale keeps explicit \"fr\" and explicit \"en\" unchanged", () => {
  const previous = getLocale();
  try {
    setLocale("fr");
    assert.equal(getLocale(), "fr");
    setLocale("en");
    assert.equal(getLocale(), "en");
  } finally {
    setLocale(previous);
  }
});

/* ==================== detectLocale: English fallback rules ==================== */

test("detectLocale falls back to English when Obsidian's language is unsupported", () => {
  const previousLanguage = languageStub.value;
  try {
    languageStub.value = "es";
    assert.equal(detectLocale(), "en");
    assert.equal(detectLocale({}), "en");
    assert.equal(detectLocale({ language: "auto" }), "en");
  } finally {
    languageStub.value = previousLanguage;
  }
});

test("detectLocale falls back to English when Obsidian's language is empty/unavailable", () => {
  const previousLanguage = languageStub.value;
  try {
    languageStub.value = "";
    assert.equal(detectLocale({ language: "auto" }), "en");
  } finally {
    languageStub.value = previousLanguage;
  }
});

test("detectLocale preserves an explicit, non-\"auto\" setting regardless of Obsidian's own language", () => {
  const previousLanguage = languageStub.value;
  try {
    languageStub.value = "fr";
    assert.equal(detectLocale({ language: "en" }), "en", "explicit \"en\" is never overridden by Obsidian's language");
    languageStub.value = "en";
    assert.equal(detectLocale({ language: "fr" }), "fr", "explicit \"fr\" is never overridden by Obsidian's language");
  } finally {
    languageStub.value = previousLanguage;
  }
});

test("detectLocale uses Obsidian's language for \"auto\" or an unset setting, when it is supported", () => {
  const previousLanguage = languageStub.value;
  try {
    languageStub.value = "fr";
    assert.equal(detectLocale({ language: "auto" }), "fr");
    assert.equal(detectLocale(undefined), "fr");
    languageStub.value = "en";
    assert.equal(detectLocale({ language: "auto" }), "en");
  } finally {
    languageStub.value = previousLanguage;
  }
});

/* ==================== t()/translate(): English fallback for a missing key ==================== */

test("translate falls back to English when the key is missing from the selected locale's own dictionary", () => {
  const key = "shared.research.moveUp";
  assert.ok(Object.prototype.hasOwnProperty.call(fr, key), "fixture key must really exist in fr.ts");
  assert.ok(Object.prototype.hasOwnProperty.call(en, key), "fixture key must really exist in en.ts");
  const originalFrValue = fr[key];
  delete fr[key];
  try {
    assert.equal(translate("fr", key), en[key]);
  } finally {
    fr[key] = originalFrValue;
  }
});

test("t() (the active-locale wrapper) falls back to English the same way translate() does", () => {
  const previous = getLocale();
  const key = "shared.research.moveDown";
  const originalFrValue = fr[key];
  delete fr[key];
  try {
    setLocale("fr");
    assert.equal(t(key), en[key]);
  } finally {
    fr[key] = originalFrValue;
    setLocale(previous);
  }
});

test("the absolute last resort is the key itself — never a French string", () => {
  const missingKey = "this.key.does.not.exist.anywhere";
  assert.equal(Object.prototype.hasOwnProperty.call(fr, missingKey), false);
  assert.equal(Object.prototype.hasOwnProperty.call(en, missingKey), false);
  assert.equal(translate("fr", missingKey), missingKey);
  assert.equal(translate("en", missingKey), missingKey);

  const previous = getLocale();
  try {
    setLocale("fr");
    assert.equal(t(missingKey), missingKey);
  } finally {
    setLocale(previous);
  }
});

test("translate() reads an explicit locale without depending on the active global locale", () => {
  const previous = getLocale();
  try {
    setLocale("en");
    // Even though the active locale is "en", an explicit "fr" lookup must
    // still return the French value — translate() never reads currentLocale.
    assert.equal(translate("fr", "shared.research.moveUp"), fr["shared.research.moveUp"]);
    assert.equal(translate("en", "shared.research.moveUp"), en["shared.research.moveUp"]);
  } finally {
    setLocale(previous);
  }
});

test("translate() substitutes {name} parameters the same way t() does", () => {
  const key = "shared.duplicated";
  assert.ok(Object.prototype.hasOwnProperty.call(fr, key));
  const params = { name: "Chapitre 12" };
  const direct = translate("fr", key, params);
  assert.ok(direct.includes("Chapitre 12"));
  assert.equal(direct.includes("{name}"), false);
});
