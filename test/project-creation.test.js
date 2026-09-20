import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectCreationNames } from "../src/i18n/project-creation.js";

/* Pure, locale-aware catalogue for future project-creation lots. This
   batch only builds the catalogue — it is not wired to any creation path,
   so these tests exercise it in complete isolation: no fake app, no fake
   vault, no settings object anywhere in this file. */

const EXPECTED_EN = {
  manuscript: "Manuscript",
  frontMatter: "Front",
  research: "Research",
  resources: "Resources",
  feuilletsRoot: "_Feuillets",
  auxiliary: {
    research: "Research",
    resources: "Resources",
    edition: "Edition",
    journal: "Journal",
    snapshots: "Snapshots",
    backups: "Backups",
    output: "Output",
    versions: "Versions",
    drafts: "Drafts",
  },
  resourceSubfolders: {
    images: "Images",
    templates: "Templates",
    layouts: "Layouts",
    exports: "Exports",
    assets: "Internal resources",
  },
  researchSections: {
    bibliography: "Bibliography",
    glossary: "Glossary",
    events: "Events",
    characters: "Characters",
    places: "Places",
    lore: "Lore",
    notes: "Notes",
    sources: "Sources",
  },
  notebook: "Notebook",
  draftStem: "Untitled",
};

const EXPECTED_FR = {
  manuscript: "Manuscrit",
  frontMatter: "Front",
  research: "Recherche",
  resources: "Ressources",
  feuilletsRoot: "_Feuillets",
  auxiliary: {
    research: "Recherche",
    resources: "Ressources",
    edition: "Edition",
    journal: "Journal",
    snapshots: "Snapshots",
    backups: "Backups",
    output: "Sortie",
    versions: "Versions",
    drafts: "Drafts",
  },
  resourceSubfolders: {
    images: "Images",
    templates: "Modèles",
    layouts: "Mises en page",
    exports: "Exports",
    assets: "Ressources internes",
  },
  researchSections: {
    bibliography: "Bibliographie",
    glossary: "Glossaire",
    events: "Événements",
    characters: "Personnages",
    places: "Lieux",
    lore: "Lore",
    notes: "Notes",
    sources: "Sources",
  },
  notebook: "Carnet",
  draftStem: "Sans titre",
};

test("projectCreationNames(\"en\") returns the complete expected English catalogue", () => {
  assert.deepEqual(projectCreationNames("en"), EXPECTED_EN);
});

test("projectCreationNames(\"fr\") returns the complete expected French catalogue", () => {
  assert.deepEqual(projectCreationNames("fr"), EXPECTED_FR);
});

test("English and French catalogues are distinct overall, even though a few individual names coincide", () => {
  const en = projectCreationNames("en");
  const fr = projectCreationNames("fr");
  assert.notDeepEqual(en, fr);
  // Concrete, individually distinct examples (never both catalogues sharing
  // every value by accident).
  assert.notEqual(en.manuscript, fr.manuscript);
  assert.notEqual(en.research, fr.research);
  assert.notEqual(en.resources, fr.resources);
  assert.notEqual(en.notebook, fr.notebook);
  assert.notEqual(en.draftStem, fr.draftStem);
  assert.notEqual(en.auxiliary.output, fr.auxiliary.output);
  assert.notEqual(en.resourceSubfolders.templates, fr.resourceSubfolders.templates);
  assert.notEqual(en.researchSections.characters, fr.researchSections.characters);
});

test("every top-level and nested field is present and a non-empty string, for both locales", () => {
  for (const locale of ["en", "fr"]) {
    const names = projectCreationNames(locale);
    assert.equal(typeof names.manuscript, "string");
    assert.notEqual(names.manuscript, "");
    assert.equal(typeof names.frontMatter, "string");
    assert.notEqual(names.frontMatter, "");
    assert.equal(typeof names.research, "string");
    assert.notEqual(names.research, "");
    assert.equal(typeof names.resources, "string");
    assert.notEqual(names.resources, "");
    assert.equal(typeof names.feuilletsRoot, "string");
    assert.notEqual(names.feuilletsRoot, "");
    for (const value of Object.values(names.auxiliary)) {
      assert.equal(typeof value, "string");
      assert.notEqual(value, "");
    }
    for (const value of Object.values(names.resourceSubfolders)) {
      assert.equal(typeof value, "string");
      assert.notEqual(value, "");
    }
    for (const value of Object.values(names.researchSections)) {
      assert.equal(typeof value, "string");
      assert.notEqual(value, "");
    }
    assert.equal(typeof names.notebook, "string");
    assert.notEqual(names.notebook, "");
    assert.equal(typeof names.draftStem, "string");
    assert.notEqual(names.draftStem, "");
  }
});

test("the plugin's auxiliary root name (\"_Feuillets\") is identical across locales — a technical, non-translated identifier", () => {
  assert.equal(projectCreationNames("en").feuilletsRoot, "_Feuillets");
  assert.equal(projectCreationNames("fr").feuilletsRoot, "_Feuillets");
});

test("calling projectCreationNames repeatedly is deterministic and side-effect free", () => {
  const first = projectCreationNames("en");
  const second = projectCreationNames("en");
  assert.deepEqual(first, second);
  assert.notEqual(first, second, "each call returns a fresh object, never a shared mutable reference");
});

/* ==================== purity: no Obsidian/Vault/settings dependency ==================== */

test("project-creation.ts is pure — no Obsidian import, no Vault/app/settings reference, no forbidden TypeScript escapes", () => {
  const raw = readFileSync(join(process.cwd(), "src/i18n/project-creation.ts"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  assert.doesNotMatch(code, /from\s+["']obsidian["']/, "must never import the Obsidian API");
  assert.doesNotMatch(code, /\bVault\b/);
  assert.doesNotMatch(code, /\bTFile\b/);
  assert.doesNotMatch(code, /\bTFolder\b/);
  assert.doesNotMatch(code, /\bapp\./);
  assert.doesNotMatch(code, /\bsettings\b/i);
  assert.doesNotMatch(code, /processFrontMatter/);
  assert.doesNotMatch(code, /createFolder|createBinary|\.create\(|\.modify\(|\.rename/);
  assert.doesNotMatch(code, /:\s*any\b/, "no `: any` type annotation");
  assert.doesNotMatch(code, /as\s+any\b/);
  assert.doesNotMatch(code, /@ts-ignore/);
  assert.doesNotMatch(code, /@ts-expect-error/);
  assert.doesNotMatch(code, /eslint-disable/);
  assert.doesNotMatch(code, /\S!(?:\.|;|,|\)|\s)/, "no non-null assertion operator");
  assert.match(code, /translate\(/, "every value must be resolved through the locale-explicit helper");
});

test("project-creation.ts never hardcodes a French or English display value directly — everything goes through translate()", () => {
  const raw = readFileSync(join(process.cwd(), "src/i18n/project-creation.ts"), "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  // Only string literal allowed outside translate(...) calls is the
  // "projectCreation." key-name prefix itself and the import specifier.
  const stringLiterals = [...code.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  for (const literal of stringLiterals) {
    const isKeyName = literal.startsWith("projectCreation.");
    const isImportPath = literal.startsWith("./");
    assert.ok(isKeyName || isImportPath, `unexpected hardcoded string literal: "${literal}"`);
  }
});
