import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_TEMPLATES } from "../src/utils/export-templates.js";
import { normalizeLegacyTemplate } from "../src/services/export-template-v2.js";

test("normalizeLegacyTemplate : classique devient un manuscrit V2", () => {
  const result = normalizeLegacyTemplate(EXPORT_TEMPLATES.classique);

  assert.equal(result.version, 2);
  assert.equal(result.profile, "manuscript");
  assert.deepEqual(result.page.marginsCm, { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 });
  assert.deepEqual(result.body, {
    fontFamily: "'Times New Roman', Times, serif", fontSizePt: 12, lineHeight: 2,
    align: "justify", firstLineIndentPt: 18, paragraphSpacingBeforePt: 0,
    paragraphSpacingAfterPt: 0, hyphenation: true,
  });
});

test("normalizeLegacyTemplate : APA et Thèse deviennent des profils académiques", () => {
  const apa = normalizeLegacyTemplate(EXPORT_TEMPLATES.apa);
  const these = normalizeLegacyTemplate(EXPORT_TEMPLATES.these);

  assert.equal(apa.profile, "academic");
  assert.equal(apa.page.marginsCm.left, 2.54);
  assert.equal(apa.body.firstLineIndentPt, 36);
  assert.equal(these.profile, "academic");
  assert.deepEqual(these.page.marginsCm, { top: 2.5, bottom: 2.5, left: 3.5, right: 2.5 });
  assert.equal(these.body.lineHeight, 1.5);
});

test("normalizeLegacyTemplate : chapterTitle ne devient h1 que sans headings", () => {
  const chapterOnly = normalizeLegacyTemplate({ key: "roman", label: "Roman", chapterTitle: { fontSizePt: 24, align: "center" } });
  const headingsWin = normalizeLegacyTemplate({
    key: "roman", label: "Roman", chapterTitle: { fontSizePt: 24 }, headings: { h1: { fontSizePt: 18 }, h2: { bold: true } },
  });

  assert.deepEqual(chapterOnly.headings, { h1: { fontSizePt: 24, align: "center" } });
  assert.deepEqual(headingsWin.headings, { h1: { fontSizePt: 18 }, h2: { bold: true } });
});

test("normalizeLegacyTemplate : conserve les titres H1-H3 existants", () => {
  const result = normalizeLegacyTemplate(EXPORT_TEMPLATES.these);

  assert.deepEqual(result.headings, EXPORT_TEMPLATES.these.headings);
});

test("normalizeLegacyTemplate : intègre les réglages legacy de page, en-tête et pied", () => {
  const result = normalizeLegacyTemplate(EXPORT_TEMPLATES.romanFrancais, {
    pdfPageSize: "letter", pdfOrientation: "portrait", pdfMarginTop: 1, pdfMarginBottom: 2,
    pdfMarginLeft: 3, pdfMarginRight: 4, pdfMirrorMargins: true, pdfEnableHeaders: true,
    pdfDiffHeaders: true, pdfHeaderLeft: "{title}", pdfHeaderCenter: "", pdfHeaderRight: "{author}",
    pdfHeaderDistanceCm: 1.1, pdfHeaderBodyGapPt: 7, pdfEnableFooters: false,
    pdfFooterLeft: "", pdfFooterCenter: "", pdfFooterRight: "Page {page}",
    pdfFooterDistanceCm: 0.8, pdfFooterBodyGapPt: 5, pdfHideFirstPageHeader: true, pdfPageNumberPosition: "center",
  });

  assert.deepEqual(result.page, {
    size: "letter", orientation: "portrait", marginsCm: { top: 1, bottom: 2, left: 3, right: 4 },
    mirrorMargins: true, columns: { count: 2, gutterPt: 45 },
  });
  assert.deepEqual(result.header, { enabled: true, left: "{title}", center: "", right: "{author}", distanceCm: 1.1, bodyGapPt: 7, differentOddEven: true });
  assert.deepEqual(result.footer, { enabled: false, left: "", center: "", right: "Page {page}", distanceCm: 0.8, bodyGapPt: 5 });
  assert.deepEqual(result.firstPage, { hideHeader: true, pageNumberPosition: "center" });
});

test("normalizeLegacyTemplate : ne mute jamais le modèle ni les réglages legacy", () => {
  const tpl = {
    key: "personnalise", label: "Personnalisé", marginCm: 2, indent: true,
    headings: { h1: { fontSizePt: 20 } }, blockquote: { italic: true }, sceneDivider: "***",
    titlePage: { styles: { titre: { fontSizePt: 24 } } },
  };
  const settings = { pdfMarginLeft: 4, pdfHeaderLeft: "Titre" };
  const beforeTpl = structuredClone(tpl);
  const beforeSettings = structuredClone(settings);

  const result = normalizeLegacyTemplate(tpl, settings);
  result.page.marginsCm.left = 9;
  result.headings.h1.fontSizePt = 9;
  result.blockquote.italic = false;
  result.titlePage.styles.titre.fontSizePt = 9;

  assert.deepEqual(tpl, beforeTpl);
  assert.deepEqual(settings, beforeSettings);
});
