import JSZip from "jszip";
import type { App } from "obsidian";
import { extractAllTags, extractTag, getAttr } from "../utils/xml.js";
import { createCustomTemplateFromV2 } from "./export-templates-custom.js";

type StyleDefinition = { id: string; basedOn?: string; rPr: string; pPr: string };
type StyleValues = {
  fontFamily?: string;
  fontSizePt?: number;
  align?: TemplateAlign;
  firstLineIndentPt?: number;
  paragraphSpacingBeforePt?: number;
  paragraphSpacingAfterPt?: number;
  lineHeight?: number;
  bold?: boolean;
  italic?: boolean;
  marginTopPt?: number;
  marginBottomPt?: number;
  pageBreakBefore?: boolean;
};
type ThemeFonts = { minor?: string; major?: string };

const HEADING_LEVELS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const WORD_TRUE = new Set(["1", "true", "on"]);
const WORD_FALSE = new Set(["0", "false", "off"]);

function finiteNumber(value: string | undefined, minimum = 0): number | undefined {
  if (!value || !/^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : undefined;
}

function twipsToPoints(value: string | undefined, minimum = 0): number | undefined {
  const twips = finiteNumber(value, minimum);
  return twips === undefined ? undefined : twips / 20;
}

function twipsToCentimeters(value: string | undefined): number | undefined {
  const twips = finiteNumber(value);
  return twips === undefined ? undefined : Math.round(twips / 1440 * 2.54 * 100) / 100;
}

function firstAttrs(xml: string, tag: string): string {
  return extractAllTags(xml, tag)[0]?.attrs ?? "";
}

function onOff(xml: string, tag: string): boolean | undefined {
  const element = extractAllTags(xml, tag)[0];
  if (!element) return undefined;
  const attrs = element.attrs;
  const value = getAttr(attrs, "w:val").toLowerCase();
  if (!value || WORD_TRUE.has(value)) return true;
  if (WORD_FALSE.has(value)) return false;
  return undefined;
}

function wordAlign(value: string): TemplateAlign | undefined {
  if (value === "both" || value === "distribute") return "justify";
  if (value === "left" || value === "center" || value === "right" || value === "justify") return value;
  return undefined;
}

function styleDefinitions(stylesXml: string): { styles: Map<string, StyleDefinition>; defaultId?: string } {
  const styles = new Map<string, StyleDefinition>();
  let defaultId: string | undefined;
  for (const style of extractAllTags(stylesXml, "w:style")) {
    if (getAttr(style.attrs, "w:type") !== "paragraph") continue;
    const id = getAttr(style.attrs, "w:styleId");
    if (!id) continue;
    styles.set(id, {
      id,
      basedOn: getAttr(firstAttrs(style.body, "w:basedOn"), "w:val") || undefined,
      rPr: extractTag(style.body, "w:rPr"),
      pPr: extractTag(style.body, "w:pPr"),
    });
    if (WORD_TRUE.has(getAttr(style.attrs, "w:default").toLowerCase())) defaultId = id;
  }
  return { styles, defaultId };
}

function defaultStyleFragments(stylesXml: string): StyleDefinition {
  const defaults = extractTag(stylesXml, "w:docDefaults");
  return {
    id: "docDefaults",
    rPr: extractTag(extractTag(defaults, "w:rPrDefault"), "w:rPr"),
    pPr: extractTag(extractTag(defaults, "w:pPrDefault"), "w:pPr"),
  };
}

function styleCascade(
  definitions: Map<string, StyleDefinition>,
  defaults: StyleDefinition,
  requestedId: string
): StyleDefinition[] {
  const visited = new Set<string>();
  const chain: StyleDefinition[] = [];
  const visit = (id: string | undefined): void => {
    if (!id || visited.has(id)) return;
    visited.add(id);
    const current = definitions.get(id);
    if (!current) return;
    visit(current.basedOn);
    chain.push(current);
  };
  visit(requestedId);
  return [defaults, ...chain];
}

function latestAttr(styles: StyleDefinition[], property: "rPr" | "pPr", tag: string, attr: string): string | undefined {
  let result: string | undefined;
  for (const style of styles) {
    const value = getAttr(firstAttrs(style[property], tag), attr);
    if (value) result = value;
  }
  return result;
}

function latestOnOff(styles: StyleDefinition[], property: "rPr" | "pPr", tag: string): boolean | undefined {
  let result: boolean | undefined;
  for (const style of styles) {
    const value = onOff(style[property], tag);
    if (value !== undefined) result = value;
  }
  return result;
}

function themeFonts(themeXml: string): ThemeFonts {
  const scheme = extractTag(themeXml, "a:fontScheme");
  const fontFor = (kind: "a:minorFont" | "a:majorFont"): string | undefined => {
    const typeface = getAttr(firstAttrs(extractTag(scheme, kind), "a:latin"), "typeface");
    return typeface || undefined;
  };
  return { minor: fontFor("a:minorFont"), major: fontFor("a:majorFont") };
}

function resolvedFont(styles: StyleDefinition[], theme: ThemeFonts): string | undefined {
  for (let index = styles.length - 1; index >= 0; index--) {
    const fonts = firstAttrs(styles[index].rPr, "w:rFonts");
    const ascii = getAttr(fonts, "w:ascii");
    const hAnsi = getAttr(fonts, "w:hAnsi");
    if (ascii || hAnsi) return ascii || hAnsi;
    const themeName = getAttr(fonts, "w:asciiTheme") || getAttr(fonts, "w:hAnsiTheme");
    if (themeName) {
      const font = themeName.startsWith("minor") ? theme.minor : themeName.startsWith("major") ? theme.major : undefined;
      if (font) return font;
    }
  }
  return undefined;
}

function styleValues(styles: StyleDefinition[], theme: ThemeFonts): StyleValues {
  const values: StyleValues = {};
  const fontFamily = resolvedFont(styles, theme);
  if (fontFamily) values.fontFamily = fontFamily;
  const halfPoints = finiteNumber(latestAttr(styles, "rPr", "w:sz", "w:val"), 0.5);
  if (halfPoints !== undefined) values.fontSizePt = halfPoints / 2;
  const align = wordAlign(latestAttr(styles, "pPr", "w:jc", "w:val") || "");
  if (align) values.align = align;
  const firstLineIndentPt = twipsToPoints(latestAttr(styles, "pPr", "w:ind", "w:firstLine"));
  if (firstLineIndentPt !== undefined) values.firstLineIndentPt = firstLineIndentPt;
  const paragraphSpacingBeforePt = twipsToPoints(latestAttr(styles, "pPr", "w:spacing", "w:before"));
  if (paragraphSpacingBeforePt !== undefined) values.paragraphSpacingBeforePt = paragraphSpacingBeforePt;
  const paragraphSpacingAfterPt = twipsToPoints(latestAttr(styles, "pPr", "w:spacing", "w:after"));
  if (paragraphSpacingAfterPt !== undefined) values.paragraphSpacingAfterPt = paragraphSpacingAfterPt;
  const line = finiteNumber(latestAttr(styles, "pPr", "w:spacing", "w:line"), 0.0001);
  if (line !== undefined && latestAttr(styles, "pPr", "w:spacing", "w:lineRule") === "auto") values.lineHeight = line / 240;
  values.bold = latestOnOff(styles, "rPr", "w:b");
  values.italic = latestOnOff(styles, "rPr", "w:i");
  values.marginTopPt = paragraphSpacingBeforePt;
  values.marginBottomPt = paragraphSpacingAfterPt;
  values.pageBreakBefore = latestOnOff(styles, "pPr", "w:pageBreakBefore");
  return values;
}

function defaultTemplate(): ExportTemplateV2 {
  return {
    version: 2,
    profile: "document",
    page: {
      size: "A4",
      orientation: "portrait",
      marginsCm: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 },
      mirrorMargins: false,
      columns: { count: 1, gutterPt: 0 },
    },
    body: {
      fontFamily: "'Times New Roman', Times, serif",
      fontSizePt: 12,
      lineHeight: 1.5,
      align: "left",
      firstLineIndentPt: 0,
      paragraphSpacingBeforePt: 0,
      paragraphSpacingAfterPt: 0,
      hyphenation: false,
    },
    headings: { h1: {}, h2: {}, h3: {}, h4: {}, h5: {}, h6: {} },
    blockquote: {},
    sceneDivider: "",
    header: { enabled: true, left: "{title}", center: "", right: "{author}", distanceCm: 0.75, bodyGapPt: 3, differentOddEven: false },
    footer: { enabled: true, left: "", center: "", right: "Page {page} sur {pages}", distanceCm: 0.75, bodyGapPt: 3 },
    firstPage: { hideHeader: true, pageNumberPosition: "right" },
    titlePage: { styles: {} },
  };
}

function pageSize(width: string | undefined, height: string | undefined): TemplatePageSize | undefined {
  const w = finiteNumber(width);
  const h = finiteNumber(height);
  if (w === undefined || h === undefined) return undefined;
  const small = Math.min(w, h);
  const large = Math.max(w, h);
  const close = (a: number, b: number) => Math.abs(a - b) <= 20;
  if (close(small, 11906) && close(large, 16838)) return "A4";
  if (close(small, 8391) && close(large, 11906)) return "A5";
  if (close(small, 12240) && close(large, 15840)) return "Letter";
  return undefined;
}

function applyFinalSection(template: ExportTemplateV2, documentXml: string): void {
  const sections = extractAllTags(documentXml, "w:sectPr");
  const section = sections[sections.length - 1];
  if (!section) return;
  const pageSizeAttrs = firstAttrs(section.body, "w:pgSz");
  const width = getAttr(pageSizeAttrs, "w:w");
  const height = getAttr(pageSizeAttrs, "w:h");
  const size = pageSize(width, height);
  if (size) template.page.size = size;
  const orientation = getAttr(pageSizeAttrs, "w:orient");
  if (orientation === "landscape" || orientation === "portrait") template.page.orientation = orientation;
  else {
    const w = finiteNumber(width);
    const h = finiteNumber(height);
    if (w !== undefined && h !== undefined) template.page.orientation = w > h ? "landscape" : "portrait";
  }
  const margins = firstAttrs(section.body, "w:pgMar");
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const value = twipsToCentimeters(getAttr(margins, `w:${side}`));
    if (value !== undefined) template.page.marginsCm[side] = value;
  }
  const columns = firstAttrs(section.body, "w:cols");
  const count = finiteNumber(getAttr(columns, "w:num"), 1);
  if (count !== undefined) template.page.columns.count = Math.round(count);
  const gutterPt = twipsToPoints(getAttr(columns, "w:space"));
  if (gutterPt !== undefined) template.page.columns.gutterPt = gutterPt;
}

/** Lit un DOCX/DOTX uniquement à partir de son archive OOXML ; aucun accès à
 * Obsidian n'est requis pour extraire le modèle. */
export async function parseWordTemplate(data: ArrayBuffer | Uint8Array): Promise<ExportTemplateV2> {
  const zip = await JSZip.loadAsync(data);
  const read = async (path: string): Promise<string> => {
    const file = zip.file(path);
    return file ? file.async("string") : "";
  };
  const [stylesXml, documentXml, settingsXml, themeXml] = await Promise.all([
    read("word/styles.xml"), read("word/document.xml"), read("word/settings.xml"), read("word/theme/theme1.xml"),
  ]);
  if (!stylesXml || !documentXml) throw new Error("Le fichier Word ne contient pas les parties obligatoires word/styles.xml et word/document.xml.");

  const template = defaultTemplate();
  const { styles, defaultId } = styleDefinitions(stylesXml);
  const defaults = defaultStyleFragments(stylesXml);
  const theme = themeFonts(themeXml);
  const normalId = defaultId ?? (styles.has("Normal") ? "Normal" : "Normal");
  const bodyValues = styleValues(styleCascade(styles, defaults, normalId), theme);
  if (bodyValues.fontFamily) template.body.fontFamily = bodyValues.fontFamily;
  if (bodyValues.fontSizePt !== undefined) template.body.fontSizePt = bodyValues.fontSizePt;
  if (bodyValues.align) template.body.align = bodyValues.align;
  if (bodyValues.firstLineIndentPt !== undefined) template.body.firstLineIndentPt = bodyValues.firstLineIndentPt;
  if (bodyValues.paragraphSpacingBeforePt !== undefined) template.body.paragraphSpacingBeforePt = bodyValues.paragraphSpacingBeforePt;
  if (bodyValues.paragraphSpacingAfterPt !== undefined) template.body.paragraphSpacingAfterPt = bodyValues.paragraphSpacingAfterPt;
  if (bodyValues.lineHeight !== undefined) template.body.lineHeight = bodyValues.lineHeight;

  template.body.hyphenation = onOff(settingsXml, "w:autoHyphenation") ?? template.body.hyphenation;
  template.page.mirrorMargins = onOff(settingsXml, "w:mirrorMargins") ?? template.page.mirrorMargins;
  applyFinalSection(template, documentXml);

  for (let index = 0; index < HEADING_LEVELS.length; index++) {
    const heading = template.headings[HEADING_LEVELS[index]];
    const values = styleValues(styleCascade(styles, defaults, `Heading${index + 1}`), theme);
    if (values.fontFamily) heading.fontFamily = values.fontFamily;
    if (values.fontSizePt !== undefined) heading.fontSizePt = values.fontSizePt;
    if (values.align) heading.align = values.align;
    if (values.bold !== undefined) heading.bold = values.bold;
    if (values.italic !== undefined) heading.italic = values.italic;
    if (values.marginTopPt !== undefined) heading.marginTopPt = values.marginTopPt;
    if (values.marginBottomPt !== undefined) heading.marginBottomPt = values.marginBottomPt;
    if (values.pageBreakBefore !== undefined) heading.pageBreakBefore = values.pageBreakBefore;
  }
  return template;
}

export async function importWordTemplate(app: App, settings: FeuilletsSettings, fileName: string, data: ArrayBuffer | Uint8Array) {
  const label = fileName.replace(/\.(docx|dotx)$/i, "") || "Word";
  const key = label.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "word";
  return createCustomTemplateFromV2(app, settings, key, label, await parseWordTemplate(data));
}
