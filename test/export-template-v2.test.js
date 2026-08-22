import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_TEMPLATES } from "../src/utils/export-templates.js";
import { createDefaultExportTemplateV2, normalizeLegacyTemplate, normalizeV2Template, shouldGenerateGenericTitlePage } from "../src/services/export-template-v2.js";

test("shouldGenerateGenericTitlePage : respecte le profil explicite et la page Front", () => {
  assert.equal(shouldGenerateGenericTitlePage("document", false), false);
  assert.equal(shouldGenerateGenericTitlePage("document", true), false);
  assert.equal(shouldGenerateGenericTitlePage("manuscript", false), true);
  assert.equal(shouldGenerateGenericTitlePage("academic", false), true);
  assert.equal(shouldGenerateGenericTitlePage(undefined, false), true);
  assert.equal(shouldGenerateGenericTitlePage(undefined, true), false);
});

test("createDefaultExportTemplateV2 : produit le gabarit document neutre complet", () => {
  const result = createDefaultExportTemplateV2();

  assert.equal(result.version, 2);
  assert.equal(result.profile, "document");
  assert.deepEqual(result.page, {
    size: "A4", orientation: "portrait", marginsCm: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
    mirrorMargins: false, columns: { count: 1, gutterPt: 0 },
  });
  assert.deepEqual(result.body, {
    fontFamily: "'Times New Roman', Times, serif", fontSizePt: 12, lineHeight: 1.5, align: "left",
    firstLineIndentPt: 0, paragraphSpacingBeforePt: 0, paragraphSpacingAfterPt: 0, hyphenation: false,
  });
  assert.deepEqual(result.headings, { h1: {}, h2: {}, h3: {}, h4: {}, h5: {}, h6: {} });
});

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
  assert.deepEqual(result.page.columns, { count: 1, gutterPt: 0 });
  assert.deepEqual(Object.keys(result.headings), ["h1", "h2", "h3", "h4", "h5", "h6"]);
  assert.deepEqual(result.headings.h4, {});
  assert.deepEqual(result.header, { enabled: true, left: "{title}", center: "", right: "{author}", distanceCm: 0.75, bodyGapPt: 3, differentOddEven: false });
  assert.deepEqual(result.footer, { enabled: true, left: "", center: "", right: "Page {page} sur {pages}", distanceCm: 0.75, bodyGapPt: 3 });
  assert.deepEqual(result.firstPage, { hideHeader: true, pageNumberPosition: "right" });
  assert.deepEqual(result.titlePage, { styles: EXPORT_TEMPLATES.classique.titlePage.styles });
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

  assert.deepEqual(chapterOnly.headings, { h1: { fontSizePt: 24, align: "center" }, h2: {}, h3: {}, h4: {}, h5: {}, h6: {} });
  assert.deepEqual(headingsWin.headings, { h1: { fontSizePt: 18 }, h2: { bold: true }, h3: {}, h4: {}, h5: {}, h6: {} });
});

test("normalizeLegacyTemplate : conserve les titres H1-H3 existants", () => {
  const result = normalizeLegacyTemplate(EXPORT_TEMPLATES.these);

  assert.deepEqual(result.headings.h1, EXPORT_TEMPLATES.these.headings.h1);
  assert.deepEqual(result.headings.h2, EXPORT_TEMPLATES.these.headings.h2);
  assert.deepEqual(result.headings.h3, EXPORT_TEMPLATES.these.headings.h3);
  assert.deepEqual(result.headings.h4, {});
});

test("normalizeLegacyTemplate : la sortie V2 ne contient aucun champ legacy", () => {
  const result = normalizeLegacyTemplate({
    key: "ancien", label: "Ancien", marginCm: 2, indent: true, indentPt: 24,
    paragraphSpacing: true, paragraphSpacingPt: 8, pageOrientation: "landscape", columns: { count: 2, gutterPt: 12 },
  });
  const serialized = JSON.stringify(result);

  for (const field of ["indent", "indentPt", "paragraphSpacing", "paragraphSpacingPt", "marginCm", "pageOrientation", "chapterTitle"]) {
    assert.equal(serialized.includes(`\"${field}\"`), false, `${field} ne doit jamais sortir en V2`);
  }
  assert.equal(result.body.firstLineIndentPt, 24);
  assert.equal(result.body.paragraphSpacingBeforePt, 8);
  assert.equal(result.body.paragraphSpacingAfterPt, 12);
  assert.deepEqual(result.page.columns, { count: 2, gutterPt: 12 });
});

test("normalizeV2Template : un V2 existant est complété sans perte ni mutation", () => {
  const input = {
    version: 2, profile: "manuscript", page: { size: "A5", orientation: "landscape", marginsCm: { top: 1, bottom: 2, left: 3, right: 4 }, mirrorMargins: true, columns: { count: 2, gutterPt: 18 } },
    body: { fontFamily: "Georgia", fontSizePt: 13, lineHeight: 1.4, align: "justify", firstLineIndentPt: 20, paragraphSpacingBeforePt: 2, paragraphSpacingAfterPt: 4, hyphenation: true },
    headings: { h1: { bold: true }, h2: {}, h3: {}, h4: {}, h5: {}, h6: { italic: true } },
    blockquote: { italic: true, colorHex: "#123456" }, sceneDivider: "***",
    header: { enabled: true, left: "L", center: "C", right: "R", distanceCm: 1, bodyGapPt: 4, differentOddEven: true },
    footer: { enabled: false, left: "", center: "", right: "F", distanceCm: 2, bodyGapPt: 5 },
    firstPage: { hideHeader: false, pageNumberPosition: "center" }, titlePage: { styles: { titre: { fontSizePt: 30 } } },
  };
  const before = structuredClone(input);
  const result = normalizeV2Template(input);
  result.page.marginsCm.left = 99;
  result.headings.h1.bold = false;
  result.titlePage.styles.titre.fontSizePt = 10;

  assert.equal(result.version, 2);
  assert.equal(result.profile, "manuscript");
  assert.equal(result.page.size, "A5");
  assert.equal(result.body.fontFamily, "Georgia");
  assert.equal(result.headings.h6.italic, true);
  assert.deepEqual(input, before);
});

test("normalizeV2Template : conserve toutes les surcharges locales de citation", () => {
  const base = createDefaultExportTemplateV2();
  base.blockquote = { fontFamily: "Futura", fontSizePt: 13, lineHeight: 1.2, align: "center", firstLineIndentPt: 8, marginTopPt: 10, marginBottomPt: 11, marginLeftPt: 12, marginRightPt: 13, italic: false, colorHex: "#112233" };
  assert.deepEqual(normalizeV2Template(base).blockquote, base.blockquote);
  assert.deepEqual(normalizeLegacyTemplate({ key: "x", label: "X", blockquote: base.blockquote }).blockquote, base.blockquote);
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

// ---------- semanticRoleMarkers : legacy / show / hide ----------

test("semanticRoleMarkers : valeur absente => legacy (createDefaultExportTemplateV2 et normalizeV2Template)", () => {
  assert.equal(createDefaultExportTemplateV2().semanticRoleMarkers, "legacy");
  assert.equal(normalizeV2Template({}).semanticRoleMarkers, "legacy");
  assert.equal(normalizeLegacyTemplate({ key: "x", label: "X" }).semanticRoleMarkers, "legacy");
});

test("semanticRoleMarkers : sélection \"show\" persistée par normalizeV2Template", () => {
  const result = normalizeV2Template({ semanticRoleMarkers: "show" });
  assert.equal(result.semanticRoleMarkers, "show");
});

// ---------- couleur du corps / couleur et soulignement des titres ----------

test("body.colorHex / heading.colorHex / heading.underline : absents => repli historique (aucune valeur matérialisée)", () => {
  const result = createDefaultExportTemplateV2();
  assert.equal(result.body.colorHex, undefined);
  for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    assert.equal(result.headings[level].colorHex, undefined);
    assert.equal(result.headings[level].underline, undefined);
  }
  // normalizeV2Template ne les injecte pas non plus pour un V2 minimal.
  const minimal = normalizeV2Template({});
  assert.equal(minimal.body.colorHex, undefined);
  assert.equal(minimal.headings.h1.underline, undefined);
});

test("normalizeV2Template : conserve body.colorHex, heading.colorHex et heading.underline (true et false) sans mutation", () => {
  const input = {
    version: 2, profile: "document",
    body: { fontFamily: "Georgia", fontSizePt: 12, lineHeight: 1.5, align: "left", firstLineIndentPt: 0, paragraphSpacingBeforePt: 0, paragraphSpacingAfterPt: 0, hyphenation: false, colorHex: "#223344" },
    headings: { h1: { colorHex: "#AA1122", underline: true }, h2: {}, h3: {}, h4: {}, h5: {}, h6: { colorHex: "#334455", underline: false } },
  };
  const before = JSON.parse(JSON.stringify(input));
  const result = normalizeV2Template(input);

  assert.equal(result.body.colorHex, "#223344");
  assert.equal(result.headings.h1.colorHex, "#AA1122");
  assert.equal(result.headings.h1.underline, true);
  assert.equal(result.headings.h6.colorHex, "#334455");
  assert.equal(result.headings.h6.underline, false);
  assert.equal(result.headings.h2.colorHex, undefined);
  assert.deepEqual(input, before);
});

test("normalizeLegacyTemplate : projette ExportTemplate.colorHex (corps) vers body.colorHex", () => {
  const withColor = normalizeLegacyTemplate({ key: "x", label: "X", colorHex: "#555555" });
  const withoutColor = normalizeLegacyTemplate({ key: "x", label: "X" });
  assert.equal(withColor.body.colorHex, "#555555");
  assert.equal(withoutColor.body.colorHex, undefined);
});

test("semanticRoleMarkers : sélection \"hide\" persistée par normalizeV2Template", () => {
  const result = normalizeV2Template({ semanticRoleMarkers: "hide" });
  assert.equal(result.semanticRoleMarkers, "hide");
});

test("semanticRoleMarkers : une valeur inconnue retombe sur legacy (jamais de valeur invalide propagée)", () => {
  const result = normalizeV2Template({ semanticRoleMarkers: "n-importe-quoi" });
  assert.equal(result.semanticRoleMarkers, "legacy");
});

test("semanticRoleMarkers : rechargement du gabarit restitue la valeur (double normalisation stable)", () => {
  const saved = normalizeV2Template({ semanticRoleMarkers: "show" });
  const reloaded = normalizeV2Template(JSON.parse(JSON.stringify(saved)));
  assert.equal(reloaded.semanticRoleMarkers, "show");
});

test("semanticRoleMarkers : normalizeLegacyTemplate propage la valeur d'un ancien champ legacy", () => {
  assert.equal(normalizeLegacyTemplate({ key: "x", label: "X", semanticRoleMarkers: "show" }).semanticRoleMarkers, "show");
  assert.equal(normalizeLegacyTemplate({ key: "x", label: "X", semanticRoleMarkers: "hide" }).semanticRoleMarkers, "hide");
});
