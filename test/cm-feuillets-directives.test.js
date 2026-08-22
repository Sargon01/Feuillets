import assert from "node:assert/strict";
import test from "node:test";
import { isFeuilletsDessousDirective, isFeuilletsImageDirective, isFeuilletsColumnsDirective } from "../src/utils/cm-feuillets-directives.js";

test("isFeuilletsDessousDirective reconnaît uniquement la directive dessous autonome", () => {
  for (const line of ["%% dessous %%", "%%dessous%%", "%%  dessous  %%", "  %% dessous %%  "]) {
    assert.equal(isFeuilletsDessousDirective(line), true, line);
  }
  for (const line of ["%% ligne: 4 %%", "%% espace: 6 %%", "%% commentaire %%", "texte %% dessous %%", "%% dessous %% texte"]) {
    assert.equal(isFeuilletsDessousDirective(line), false, line);
  }
});

/* ===== LOT 3A §30 — Live Preview de la directive image ===== */

test("isFeuilletsImageDirective masque uniquement les formes VALIDES", () => {
  for (const line of ["%% image: droite %%", "%% image: droite 40% %%", "%% image: centre 60% %%", "%% image: pleine-largeur %%", "%% image: auto %%"]) {
    assert.equal(isFeuilletsImageDirective(line), true, line);
  }
});

test("isFeuilletsImageDirective laisse visible une forme INVALIDE (largeur hors liste)", () => {
  for (const line of ["%% image: droite 37% %%", "%% image: droite 500px %%", "%% image: IMAGE: droite %%", "texte %% image: droite %%"]) {
    assert.equal(isFeuilletsImageDirective(line), false, line);
  }
});

/* ===== LOT 3B §44 — Live Preview de la directive colonnes ===== */

test("isFeuilletsColumnsDirective masque uniquement les formes VALIDES", () => {
  for (const line of ["%% colonnes: image-image 50/50 %%", "%% colonnes: image-texte 40/60 %%", "%% colonnes: texte-image 60/40 %%"]) {
    assert.equal(isFeuilletsColumnsDirective(line), true, line);
  }
});

test("isFeuilletsColumnsDirective laisse visible une forme INVALIDE", () => {
  for (const line of ["%% colonnes: image-image 30/70 %%", "%% colonnes: texte-texte 50/50 %%", "%% colonnes: image-texte %%", "%% COLONNES: image-image 50/50 %%"]) {
    assert.equal(isFeuilletsColumnsDirective(line), false, line);
  }
});
