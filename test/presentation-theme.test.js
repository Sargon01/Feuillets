import assert from "node:assert/strict";
import test from "node:test";
import { SEMANTIC_ROLES } from "../src/utils/semantic-roles.js";
import {
  PRESENTATION_THEME_IDS,
  presentationThemeForFile,
  resetPresentationThemeCustomization,
  resolvePresentationTheme,
  validatePresentationThemeName,
} from "../src/services/presentation-theme.js";

test("thèmes builtin et grammaire Course", () => {
  assert.deepEqual(PRESENTATION_THEME_IDS, ["classic", "course", "ivory", "slate", "dark"]);
  const course = resolvePresentationTheme("course");
  assert.deepEqual([course.colors.h1, course.colors.h2, course.colors.h3, course.colors.h4, course.colors.strong], ["#B42318", "#B42318", "#2E7D32", "#1F5EA8", "#B42318"]);
  assert.deepEqual([course.callouts.synthese.accent, course.callouts.synthese.body], ["#B42318", "#1F5EA8"]);
  assert.equal(resolvePresentationTheme("invalid").id, "classic");
  assert.equal(Object.keys(course.callouts).length, SEMANTIC_ROLES.length);
});

test("thème Dark : palette, callouts sémantiques et reset builtin", () => {
  const dark = resolvePresentationTheme("dark");
  assert.deepEqual(dark.colors, {
    background: "#171A1F", text: "#F2F4F7", muted: "#B8C0CC", h1: "#FF7B72", h2: "#FF7B72",
    h3: "#7EE787", h4: "#79C0FF", strong: "#FF7B72",
  });
  assert.deepEqual(dark.neutralCallout, { background: "#20252D", border: "#3A424E", borderLeft: "#3A424E" });
  assert.equal(dark.callouts.synthese.accent, "#FF7B72");
  assert.equal(dark.callouts.synthese.body, "#79C0FF");
  assert.equal(dark.callouts.citation.accent, "#D2A8FF");
  assert.equal(dark.callouts.citation.body, "#F2F4F7");
  for (const role of SEMANTIC_ROLES) {
    assert.match(dark.callouts[role].accent, /^#[0-9A-F]{6}$/);
    assert.match(dark.callouts[role].body, /^#[0-9A-F]{6}$/);
  }
  const customizations = { dark: { name: "Nuit", colors: { h3: "#123456" } } };
  assert.equal(resolvePresentationTheme("dark", customizations).name, "Nuit");
  assert.equal(resolvePresentationTheme("dark", resetPresentationThemeCustomization(customizations, "dark")).name, "Sombre");
  assert.equal(resolvePresentationTheme("dark", resetPresentationThemeCustomization(customizations, "dark")).colors.h3, "#7EE787");
});

test("personnalisation valide, invalide, noms et reset", () => {
  const customizations = { course: { name: " Histoire collège ", colors: { h3: "#abcdef", strong: "not-a-color" }, callouts: { citation: { accent: "#123456" } } }, ivory: { name: "Autre" } };
  const course = resolvePresentationTheme("course", customizations);
  assert.equal(course.name, "Histoire collège");
  assert.equal(course.colors.h3, "#ABCDEF");
  assert.equal(course.colors.strong, "#B42318");
  assert.equal(course.callouts.citation.accent, "#123456");
  assert.equal(validatePresentationThemeName("Autre", "course", customizations), "Nom déjà utilisé");
  assert.equal(validatePresentationThemeName(" ", "course", customizations), "Nom invalide");
  assert.equal(resetPresentationThemeCustomization(customizations, "course").course, undefined);
});

test("résolution projet sans mutation", () => {
  const settings = { presentationTheme: "classic", presentationThemes: {}, projectFolder: "Cours", projectMeta: {} };
  assert.equal(presentationThemeForFile(settings, "Cours/Lecon.md").id, "classic");
  assert.deepEqual(settings.projectMeta, {});
  settings.projectMeta.Cours = { presentationTheme: "slate" };
  assert.equal(presentationThemeForFile(settings, "Cours/Lecon.md").id, "slate");
});
