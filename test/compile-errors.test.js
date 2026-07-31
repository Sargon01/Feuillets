import { test } from "node:test";
import assert from "node:assert/strict";
import { CompileError, toCompileError } from "../src/services/compile-errors.js";

test("CompileError : describe() inclut étape, format et fichier quand connus", () => {
  const err = new CompileError("lecture du feuillet", "Fichier introuvable", {
    filePath: "Chapitre 1/Scène 2.md",
    format: "docx",
  });
  assert.equal(err.describe(), "lecture du feuillet (docx) — Chapitre 1/Scène 2.md : Fichier introuvable");
});

test("CompileError : describe() reste clair sans fichier ni format", () => {
  const err = new CompileError("compilation", "Dossier projet introuvable");
  assert.equal(err.describe(), "compilation : Dossier projet introuvable");
});

test("CompileError : jamais juste \"Échec\" — le message complet mentionne toujours l'étape", () => {
  const err = new CompileError("export docx", "Erreur inattendue");
  assert.notEqual(err.describe(), "Échec de l'export");
  assert.match(err.describe(), /export docx/);
});

test("toCompileError : enveloppe une Error ordinaire avec l'étape et le fichier fournis", () => {
  const original = new Error("ENOENT");
  const wrapped = toCompileError(original, "lecture du feuillet", { filePath: "a.md", format: "pdf" });
  assert.ok(wrapped instanceof CompileError);
  assert.equal(wrapped.step, "lecture du feuillet");
  assert.equal(wrapped.filePath, "a.md");
  assert.equal(wrapped.format, "pdf");
  assert.equal(wrapped.sourceError, original);
});

test("toCompileError : enveloppe une valeur jetée non-Error", () => {
  const wrapped = toCompileError("chaîne brute", "rendu Markdown");
  assert.ok(wrapped instanceof CompileError);
  assert.equal(wrapped.message, "chaîne brute");
});

test("toCompileError : une CompileError déjà précise garde SON fichier, pas celui de l'appelant", () => {
  const inner = new CompileError("lecture du feuillet", "Illisible", { filePath: "Scène A.md" });
  const wrapped = toCompileError(inner, "compilation", { filePath: "devrait-etre-ignore.md", format: "epub" });
  assert.equal(wrapped.filePath, "Scène A.md");
  assert.equal(wrapped.step, "lecture du feuillet");
  // Le format, lui, n'était pas connu de l'erreur d'origine : celui de
  // l'appelant est utilisé comme complément, pas comme remplacement.
  assert.equal(wrapped.format, "epub");
});

test("toCompileError : ne modifie pas le format déjà connu d'une CompileError interne", () => {
  const inner = new CompileError("export", "Erreur", { format: "pdf" });
  const wrapped = toCompileError(inner, "compilation", { format: "docx" });
  assert.equal(wrapped.format, "pdf");
});
