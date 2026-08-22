import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFeuilletsDirective,
  prepareFeuilletsDirectives,
  parseImageDirectiveLine,
  parseFeuilletsImageDirective,
  parseColumnsDirectiveLine,
  parseFeuilletsColumnsDirective,
} from "../src/utils/feuillets-directives.js";

test("détecte les deux formes exactes de dessous", () => {
  assert.match(prepareFeuilletsDirectives("%% dessous %%"), /FEUILLETS-DIRECTIVE:dessous/); assert.match(prepareFeuilletsDirectives("%%dessous%%"), /FEUILLETS-DIRECTIVE:dessous/);
});
test("parse ligne et espace relatifs ou physiques", () => {
  assert.deepEqual(parseFeuilletsDirective("FEUILLETS-DIRECTIVE:ligne:3"), { directive: "ligne", value: 3, unit: "lh" });
  assert.deepEqual(parseFeuilletsDirective("FEUILLETS-DIRECTIVE:espace:6"), { directive: "espace", value: 6, unit: "lh" });
  assert.deepEqual(parseFeuilletsDirective("FEUILLETS-DIRECTIVE:espace:55 mm"), { directive: "espace", value: 55, unit: "mm" });
  assert.match(prepareFeuilletsDirectives(">    %% ligne : 3 %%"), /FEUILLETS-DIRECTIVE:ligne:3/);
});
test("les valeurs invalides restent silencieuses", () => {
  for (const value of ["0", "-1", "abc"]) assert.equal(parseFeuilletsDirective(`FEUILLETS-DIRECTIVE:ligne:${value}`), null);
  for (const value of ["0", "-3", "abc", "mm"]) assert.equal(parseFeuilletsDirective(`FEUILLETS-DIRECTIVE:espace:${value}`), null);
});
test("ne détecte pas une directive au milieu du texte", () => { const source = "Texte %% dessous %% texte"; assert.equal(prepareFeuilletsDirectives(source), source); });
test("ignore les fenced code et le frontmatter initial", () => {
  const source = "---\nexemple: \"%% dessous %%\"\n---\n```md\n%% dessous %%\n```\n~~~\n%% dessous %%\n~~~"; assert.equal(prepareFeuilletsDirectives(source), source);
});
test("préserve strictement le texte ordinaire", () => {
  const source = "Avant\n\n%% dessous %%\n\nAprès"; assert.equal(prepareFeuilletsDirectives(source), "Avant\n\nFEUILLETS-DIRECTIVE:dessous\n\nAprès");
});

/* ===== LOT 3A — directive `%% image: … %%` ===== */

test("image : formes valides (§21)", () => {
  const cases = [
    ["%% image: auto %%", "FEUILLETS-IMAGE-DIRECTIVE:auto"],
    ["%% image: gauche %%", "FEUILLETS-IMAGE-DIRECTIVE:gauche"],
    ["%% image: centre %%", "FEUILLETS-IMAGE-DIRECTIVE:centre"],
    ["%% image: droite %%", "FEUILLETS-IMAGE-DIRECTIVE:droite"],
    ["%% image: pleine-largeur %%", "FEUILLETS-IMAGE-DIRECTIVE:pleine-largeur"],
    ["%% image: gauche 25% %%", "FEUILLETS-IMAGE-DIRECTIVE:gauche-25"],
    ["%% image: centre 40% %%", "FEUILLETS-IMAGE-DIRECTIVE:centre-40"],
    ["%% image: droite 75% %%", "FEUILLETS-IMAGE-DIRECTIVE:droite-75"],
    ["%% image: droite 100% %%", "FEUILLETS-IMAGE-DIRECTIVE:droite-100"],
  ];
  for (const [line, marker] of cases) assert.equal(prepareFeuilletsDirectives(line), marker, line);
});

test("image : formes invalides restent inchangées (§21)", () => {
  const lines = [
    "%% image: gauche 37% %%",
    "%% image: droite 500px %%",
    "%% image: centre 4cm %%",
    "%% image: pleine-largeur 50% %%",
    "%% image: auto 40% %%",
    "%% image: %%",
    "%% image: flottante %%",
    "%% IMAGE: droite %%",
  ];
  for (const line of lines) assert.equal(prepareFeuilletsDirectives(line), line, line);
});

test("parseImageDirectiveLine partage la même grammaire (utilisée par le Live Preview)", () => {
  assert.deepEqual(parseImageDirectiveLine("%% image: droite 40% %%"), { placement: "droite", width: 40 });
  assert.deepEqual(parseImageDirectiveLine("%% image: pleine-largeur %%"), { placement: "pleine-largeur" });
  assert.equal(parseImageDirectiveLine("%% image: droite 37% %%"), null);
  assert.equal(parseImageDirectiveLine("%% dessous %%"), null);
});

test("parseFeuilletsImageDirective décode le marqueur retrouvé dans le DOM rendu", () => {
  assert.deepEqual(parseFeuilletsImageDirective("FEUILLETS-IMAGE-DIRECTIVE:droite-40"), { placement: "droite", width: 40 });
  assert.deepEqual(parseFeuilletsImageDirective("FEUILLETS-IMAGE-DIRECTIVE:centre"), { placement: "centre" });
  assert.deepEqual(parseFeuilletsImageDirective("FEUILLETS-IMAGE-DIRECTIVE:pleine-largeur"), { placement: "pleine-largeur" });
  assert.deepEqual(parseFeuilletsImageDirective("FEUILLETS-IMAGE-DIRECTIVE:auto"), { placement: "auto" });
  assert.equal(parseFeuilletsImageDirective("FEUILLETS-DIRECTIVE:dessous"), null);
});

test("image : ignore les fenced code et le frontmatter initial", () => {
  const source = "---\nexemple: \"%% image: droite %%\"\n---\n```md\n%% image: droite %%\n```";
  assert.equal(prepareFeuilletsDirectives(source), source);
});

/* ===== LOT 3B — directive `%% colonnes: … %%` (§34) ===== */

test("colonnes : formes valides — les 9 compositions × ratios", () => {
  const cases = [
    ["%% colonnes: image-texte 40/60 %%", "FEUILLETS-COLUMNS-DIRECTIVE:image-texte:40-60"],
    ["%% colonnes: image-texte 50/50 %%", "FEUILLETS-COLUMNS-DIRECTIVE:image-texte:50-50"],
    ["%% colonnes: image-texte 60/40 %%", "FEUILLETS-COLUMNS-DIRECTIVE:image-texte:60-40"],
    ["%% colonnes: texte-image 40/60 %%", "FEUILLETS-COLUMNS-DIRECTIVE:texte-image:40-60"],
    ["%% colonnes: texte-image 50/50 %%", "FEUILLETS-COLUMNS-DIRECTIVE:texte-image:50-50"],
    ["%% colonnes: texte-image 60/40 %%", "FEUILLETS-COLUMNS-DIRECTIVE:texte-image:60-40"],
    ["%% colonnes: image-image 40/60 %%", "FEUILLETS-COLUMNS-DIRECTIVE:image-image:40-60"],
    ["%% colonnes: image-image 50/50 %%", "FEUILLETS-COLUMNS-DIRECTIVE:image-image:50-50"],
    ["%% colonnes: image-image 60/40 %%", "FEUILLETS-COLUMNS-DIRECTIVE:image-image:60-40"],
  ];
  for (const [line, marker] of cases) assert.equal(prepareFeuilletsDirectives(line), marker, line);
});

test("colonnes : formes invalides restent inchangées (§3/§34)", () => {
  const lines = [
    "%% colonnes: image-image 30/70 %%",
    "%% colonnes: image-image 33/67 %%",
    "%% colonnes: image-image 25/75 %%",
    "%% colonnes: image-texte 70/30 %%",
    "%% colonnes: texte-texte 50/50 %%",
    "%% colonnes: image 50/50 %%",
    "%% colonnes: deux-images 50/50 %%",
    "%% colonnes: image-texte %%",
    "%% colonnes: image-texte 40% %%",
    "%% colonnes: auto %%",
    "%% colonnes: %%",
    "%% COLUMNS: image-image 50/50 %%",
    "%% COLONNES: image-image 50/50 %%",
  ];
  for (const line of lines) assert.equal(prepareFeuilletsDirectives(line), line, line);
});

test("parseColumnsDirectiveLine partage la même grammaire (utilisée par le Live Preview)", () => {
  assert.deepEqual(parseColumnsDirectiveLine("%% colonnes: image-image 50/50 %%"), { composition: "image-image", ratio: "50/50" });
  assert.deepEqual(parseColumnsDirectiveLine("%% colonnes: texte-image 60/40 %%"), { composition: "texte-image", ratio: "60/40" });
  assert.equal(parseColumnsDirectiveLine("%% colonnes: image-image 30/70 %%"), null);
  assert.equal(parseColumnsDirectiveLine("%% image: droite %%"), null);
});

test("parseFeuilletsColumnsDirective décode le marqueur retrouvé dans le DOM rendu", () => {
  assert.deepEqual(parseFeuilletsColumnsDirective("FEUILLETS-COLUMNS-DIRECTIVE:image-image:50-50"), { composition: "image-image", ratio: "50/50" });
  assert.deepEqual(parseFeuilletsColumnsDirective("FEUILLETS-COLUMNS-DIRECTIVE:texte-image:60-40"), { composition: "texte-image", ratio: "60/40" });
  assert.equal(parseFeuilletsColumnsDirective("FEUILLETS-COLUMNS-DIRECTIVE:image-image:30-70"), null);
  assert.equal(parseFeuilletsColumnsDirective("FEUILLETS-IMAGE-DIRECTIVE:droite"), null);
});

test("colonnes : ignore les fenced code et le frontmatter initial", () => {
  const source = "---\nexemple: \"%% colonnes: image-image 50/50 %%\"\n---\n```md\n%% colonnes: image-image 50/50 %%\n```";
  assert.equal(prepareFeuilletsDirectives(source), source);
});
