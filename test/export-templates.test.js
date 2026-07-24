import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_TEMPLATES,
  templateFor,
  cmToPt,
  templateToCss,
  templatePrintCss,
  marginsFor,
} from "../src/utils/export-templates.js";

test("templateFor", async (t) => {
  await t.test("retourne le modèle demandé", () => {
    assert.equal(templateFor("moderne"), EXPORT_TEMPLATES.moderne);
  });

  await t.test("se replie sur classique si la clé est inconnue/absente", () => {
    assert.equal(templateFor("inexistant"), EXPORT_TEMPLATES.classique);
    assert.equal(templateFor(undefined), EXPORT_TEMPLATES.classique);
  });
});

test("cmToPt", () => {
  assert.equal(cmToPt(2.5), 71);
  assert.equal(cmToPt(0), 0);
});

test("templateToCss", async (t) => {
  await t.test("reflète la police et l'alignement du modèle", () => {
    const css = templateToCss(EXPORT_TEMPLATES.classique);
    assert.ok(css.includes("Times New Roman"));
    assert.ok(css.includes("text-align: justify"));
    assert.ok(css.includes("text-indent: 1.5em"));
  });

  await t.test("désactive le retrait de première ligne si indent est faux", () => {
    const css = templateToCss(EXPORT_TEMPLATES.moderne);
    assert.ok(css.includes("text-indent: 0"));
  });

  await t.test("classique : h1 (partie) sans style forcé, toujours en saut de page", () => {
    // h1 ne règle que pageBreakBefore (voir EXPORT_TEMPLATES) — pas de
    // gras/taille/alignement forcé qui écraserait le style par défaut du
    // navigateur/lecteur EPUB pour ce niveau (bug réel : `font-weight:
    // normal;` apparaissait alors qu'il n'était pas demandé)
    const css = templateToCss(EXPORT_TEMPLATES.classique);
    assert.ok(css.includes("h1 { font-family: 'Times New Roman', Times, serif; page-break-before: always; }"));
  });

  await t.test("classique : h2 (titre de chapitre) et h3 (son sous-titre) même taille/alignement/gras, seul h3 en italique, seul h2 en saut de page", () => {
    // titre + sous-titre (ex. import Scrivener d'un titre sur deux
    // lignes, voir compile-export.js) : visuellement de même poids, mais
    // l'italique distingue le sous-titre — et il reste collé à son titre
    // au lieu de démarrer sa propre page. marginBottomPt sur h3 seulement :
    // l'espace avant le corps vient après le sous-titre, pas un gros
    // blanc entre le titre et lui.
    const css = templateToCss(EXPORT_TEMPLATES.classique);
    assert.ok(css.includes("h2 { font-family: 'Times New Roman', Times, serif; page-break-before: always; font-size: 14pt; text-align: center; font-weight: bold; }"));
    assert.ok(css.includes("h3 { font-family: 'Times New Roman', Times, serif; page-break-before: avoid; font-size: 14pt; text-align: center; font-weight: bold; font-style: italic; margin-bottom: 36pt; }"));
  });

  await t.test("romanSimple : titre de chapitre, séparateur de scène, pas de césure", () => {
    const css = templateToCss(EXPORT_TEMPLATES.romanSimple);
    assert.ok(css.includes("Baskerville"));
    assert.ok(css.includes("hyphens: none"));
    assert.ok(css.includes("font-size: 52pt"));
    assert.ok(css.includes("page-break-before: always"));
    assert.ok(css.includes('content: "* * *"'));
  });

  await t.test("romanFrancais : police de titre distincte de la police du corps", () => {
    const css = templateToCss(EXPORT_TEMPLATES.romanFrancais);
    assert.ok(css.includes("font-family: Garamond"));
    assert.ok(css.includes("h1 { font-family: 'Helvetica Neue'"));
    assert.ok(css.includes("hyphens: auto"));
    assert.ok(css.includes('content: "***"'));
  });

  await t.test("apa : pas de saut de page systématique, 3 niveaux de titres distincts", () => {
    const css = templateToCss(EXPORT_TEMPLATES.apa);
    assert.ok(css.includes("h1 { font-family: 'Times New Roman', Times, serif; page-break-before: avoid;"));
    assert.ok(css.includes("text-align: center"));
    assert.ok(css.includes("h3 { font-family: 'Times New Roman', Times, serif; page-break-before: avoid; font-size: 12pt; text-align: left; font-weight: bold; font-style: italic;"));
  });

  await t.test("these : chapitres (h1) en saut de page, sous-sections (h2) sans", () => {
    const css = templateToCss(EXPORT_TEMPLATES.these);
    assert.ok(css.includes("h1 { font-family: 'Times New Roman', Times, serif; page-break-before: always; font-size: 20pt"));
    assert.ok(css.includes("h2 { font-family: 'Times New Roman', Times, serif; page-break-before: avoid; font-size: 16pt"));
  });
});

test("templatePrintCss", async (t) => {
  await t.test("vide quand le modèle n'a pas de colonnes", () => {
    assert.equal(templatePrintCss(EXPORT_TEMPLATES.classique), "");
  });

  await t.test("colonnes du modèle romanFrancais", () => {
    const css = templatePrintCss(EXPORT_TEMPLATES.romanFrancais);
    assert.ok(css.includes("column-count: 2"));
    assert.ok(css.includes("column-gap: 45pt"));
  });
});

test("marginsFor", async (t) => {
  await t.test("repli symétrique sur marginCm quand marginsCm est absent", () => {
    assert.deepEqual(marginsFor(EXPORT_TEMPLATES.classique), {
      top: 2.5,
      bottom: 2.5,
      left: 2.5,
      right: 2.5,
    });
  });

  await t.test("marges asymétriques quand marginsCm est présent (romanSimple)", () => {
    assert.deepEqual(marginsFor(EXPORT_TEMPLATES.romanSimple), {
      top: 2.5,
      bottom: 2.5,
      left: 3,
      right: 3.5,
    });
  });
});
