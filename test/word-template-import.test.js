import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseWordTemplate } from "../src/services/word-template-import.js";

const section = (extra = "") => `<w:sectPr>${extra}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/><w:cols w:num="2" w:space="240"/></w:sectPr>`;
const documentWith = (sections = section()) => `<w:document><w:body><w:p/>${sections}</w:body></w:document>`;
const normal = (extra = "") => `<w:style w:type="paragraph" w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr><w:pPr><w:jc w:val="both"/><w:ind w:firstLine="240"/><w:spacing w:before="40" w:after="60"/></w:pPr></w:style>${extra}`;

async function word({ styles = normal(), document = documentWith(), settings = "", theme = "" } = {}) {
  const zip = new JSZip();
  if (styles !== null) zip.file("word/styles.xml", `<w:styles>${styles}</w:styles>`);
  if (document !== null) zip.file("word/document.xml", document);
  if (settings) zip.file("word/settings.xml", `<w:settings>${settings}</w:settings>`);
  if (theme) zip.file("word/theme/theme1.xml", theme);
  return zip.generateAsync({ type: "uint8array" });
}

test("Word : document OOXML minimal réaliste avec body devient un V2 complet", async () => {
  const template = await parseWordTemplate(await word({ settings: "<w:autoHyphenation/><w:mirrorMargins/>" }));

  assert.equal(template.version, 2);
  assert.equal(template.profile, "document");
  assert.equal(template.body.fontFamily, "Arial");
  assert.equal(template.body.fontSizePt, 12);
  assert.equal(template.body.align, "justify");
  assert.equal(template.body.firstLineIndentPt, 12);
  assert.equal(template.body.paragraphSpacingBeforePt, 2);
  assert.equal(template.body.paragraphSpacingAfterPt, 3);
  assert.equal(template.body.hyphenation, true);
  assert.equal(template.page.mirrorMargins, true);
  assert.equal(template.page.size, "A4");
  assert.equal(template.page.columns.count, 2);
  assert.equal(template.page.columns.gutterPt, 12);
});

test("Word : docDefaults est hérité par le style de paragraphe par défaut", async () => {
  const styles = `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:hAnsi="Cambria"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Base" w:default="1"><w:pPr><w:spacing w:before="80"/></w:pPr></w:style>`;
  const template = await parseWordTemplate(await word({ styles }));

  assert.equal(template.body.fontFamily, "Cambria");
  assert.equal(template.body.fontSizePt, 11);
  assert.equal(template.body.align, "center");
  assert.equal(template.body.paragraphSpacingBeforePt, 4);
});

test("Word : l'attribut w:default sélectionne Normal, jamais le dernier Heading", async () => {
  const styles = `<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:rFonts w:ascii="Normal Font"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:rFonts w:ascii="Heading One"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:rPr><w:rFonts w:ascii="Heading Two"/></w:rPr></w:style>`;
  const template = await parseWordTemplate(await word({ styles }));

  assert.equal(template.body.fontFamily, "Normal Font");
});

test("Word : Heading2 sans basedOn n'hérite pas artificiellement de Normal", async () => {
  const styles = `<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:rPr><w:b/></w:rPr></w:style>`;
  const template = await parseWordTemplate(await word({ styles }));

  assert.equal(template.headings.h2.bold, true);
  assert.equal(template.headings.h2.fontFamily, undefined);
  assert.equal(template.headings.h2.fontSizePt, undefined);
});

test("Word : Heading2 suit basedOn et les surcharges locales priment", async () => {
  const styles = `${normal()}<w:style w:type="paragraph" w:styleId="TitreBase"><w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="28"/><w:b/></w:rPr><w:pPr><w:spacing w:before="120" w:after="40"/><w:pageBreakBefore/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:basedOn w:val="TitreBase"/><w:rPr><w:rFonts w:hAnsi="Garamond"/><w:b w:val="0"/><w:i/></w:rPr><w:pPr><w:jc w:val="right"/><w:spacing w:after="60"/><w:pageBreakBefore w:val="false"/></w:pPr></w:style>`;
  const template = await parseWordTemplate(await word({ styles }));
  const heading = template.headings.h2;

  assert.equal(heading.fontFamily, "Garamond");
  assert.equal(heading.fontSizePt, 14);
  assert.equal(heading.align, "right");
  assert.equal(heading.bold, false);
  assert.equal(heading.italic, true);
  assert.equal(heading.marginTopPt, 6);
  assert.equal(heading.marginBottomPt, 3);
  assert.equal(heading.pageBreakBefore, false);
});

test("Word : les polices de thème minorAscii et minorHAnsi sont résolues", async () => {
  const styles = `<w:style w:type="paragraph" w:styleId="Normal"><w:rPr><w:rFonts w:asciiTheme="minorAscii"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:rFonts w:hAnsiTheme="minorHAnsi"/></w:rPr></w:style>`;
  const theme = `<a:theme><a:themeElements><a:fontScheme><a:minorFont><a:latin typeface="Aptos"/></a:minorFont><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>`;
  const template = await parseWordTemplate(await word({ styles, theme }));

  assert.equal(template.body.fontFamily, "Aptos");
  assert.equal(template.headings.h1.fontFamily, "Aptos");
});

test("Word : un thème du style enfant prime sur la police explicite du parent", async () => {
  const styles = `<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/></w:rPr></w:style>`;
  const theme = `<a:theme><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>`;
  const template = await parseWordTemplate(await word({ styles, theme }));

  assert.equal(template.headings.h1.fontFamily, "Aptos Display");
});

test("Word : les valeurs OOXML false, off et 0 désactivent réellement les propriétés", async () => {
  const styles = `${normal()}<w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:b w:val="false"/><w:i w:val="off"/></w:rPr><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr></w:style>`;
  const template = await parseWordTemplate(await word({ styles, settings: "<w:autoHyphenation w:val=\"false\"/><w:mirrorMargins w:val=\"off\"/>" }));

  assert.equal(template.body.hyphenation, false);
  assert.equal(template.page.mirrorMargins, false);
  assert.equal(template.headings.h1.bold, false);
  assert.equal(template.headings.h1.italic, false);
  assert.equal(template.headings.h1.pageBreakBefore, false);
});

test("Word : interligne auto OOXML est converti en multiplicateur", async () => {
  const styles = `<w:style w:type="paragraph" w:styleId="Normal"><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:style>`;
  const template = await parseWordTemplate(await word({ styles }));
  assert.equal(template.body.lineHeight, 1.15);
});

test("Word : A4, A5 et Letter sont reconnus indépendamment de l'orientation", async () => {
  const cases = [
    ["A4", "11906", "16838", "portrait"],
    ["A5", "11906", "8391", "landscape"],
    ["Letter", "15840", "12240", "landscape"],
  ];
  for (const [size, width, height, orientation] of cases) {
    const document = documentWith(`<w:sectPr><w:pgSz w:w="${width}" w:h="${height}" w:orient="${orientation}"/></w:sectPr>`);
    const template = await parseWordTemplate(await word({ document }));
    assert.equal(template.page.size, size);
    assert.equal(template.page.orientation, orientation);
  }
});

test("Word : la section finale est la seule prise en compte", async () => {
  const first = `<w:p><w:pPr>${section("<w:pgSz w:w=\"8391\" w:h=\"11906\"/>")}</w:pPr></w:p>`;
  const final = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720"/><w:cols w:num="3" w:space="120"/></w:sectPr>`;
  const template = await parseWordTemplate(await word({ document: documentWith(`${first}${final}`) }));

  assert.equal(template.page.size, "Letter");
  assert.equal(template.page.marginsCm.top, 1.27);
  assert.equal(template.page.columns.count, 3);
  assert.equal(template.page.columns.gutterPt, 6);
});

test("Word : les nombres OOXML invalides sont ignorés sans NaN", async () => {
  const styles = `<w:style w:type="paragraph" w:styleId="Normal"><w:rPr><w:sz w:val="NaN"/></w:rPr><w:pPr><w:ind w:firstLine="-20"/><w:spacing w:before="Infinity" w:line="0" w:lineRule="auto"/></w:pPr></w:style>`;
  const document = documentWith(`<w:sectPr><w:pgSz w:w="invalid" w:h="NaN"/><w:pgMar w:top="-10" w:bottom="Infinity"/><w:cols w:num="-2" w:space="bad"/></w:sectPr>`);
  const template = await parseWordTemplate(await word({ styles, document }));

  assert.equal(template.body.fontSizePt, 12);
  assert.equal(template.body.firstLineIndentPt, 0);
  assert.equal(template.body.lineHeight, 1.5);
  assert.equal(template.page.columns.count, 1);
  for (const value of [template.body.fontSizePt, template.body.firstLineIndentPt, template.body.lineHeight, template.page.marginsCm.top, template.page.columns.gutterPt]) assert.equal(Number.isFinite(value), true);
});

test("Word : H1 à H6 importent la cascade complète représentable par V2", async () => {
  const headings = Array.from({ length: 6 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:rPr><w:rFonts w:ascii="Heading ${index + 1}"/><w:sz w:val="${30 + index * 2}"/><w:b w:val="${index % 2}"/><w:i w:val="${index % 2 ? "on" : "off"}"/></w:rPr><w:pPr><w:jc w:val="${index % 2 ? "center" : "both"}"/><w:spacing w:before="${20 + index}" w:after="${40 + index}"/><w:pageBreakBefore w:val="${index % 2 ? "1" : "0"}"/></w:pPr></w:style>`).join("");
  const template = await parseWordTemplate(await word({ styles: `${normal()}${headings}` }));
  for (let index = 0; index < 6; index++) {
    const heading = template.headings[`h${index + 1}`];
    assert.equal(heading.fontFamily, `Heading ${index + 1}`);
    assert.equal(heading.fontSizePt, (30 + index * 2) / 2);
    assert.equal(heading.align, index % 2 ? "center" : "justify");
    assert.equal(heading.bold, Boolean(index % 2));
    assert.equal(heading.italic, Boolean(index % 2));
    assert.equal(heading.marginTopPt, (20 + index) / 20);
    assert.equal(heading.marginBottomPt, (40 + index) / 20);
    assert.equal(heading.pageBreakBefore, Boolean(index % 2));
  }
});

test("Word : boucle basedOn et parties obligatoires absentes restent sûres", async () => {
  const styles = `<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:basedOn w:val="Loop"/></w:style><w:style w:type="paragraph" w:styleId="Loop"><w:basedOn w:val="Normal"/></w:style>`;
  const template = await parseWordTemplate(await word({ styles }));
  assert.equal(template.profile, "document");

  await assert.rejects(() => word({ styles: null }).then(parseWordTemplate), /word\/styles.xml.*word\/document.xml/);
  await assert.rejects(() => word({ document: null }).then(parseWordTemplate), /word\/styles.xml.*word\/document.xml/);
});
