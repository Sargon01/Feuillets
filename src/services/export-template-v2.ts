/**
 * Adaptateur temporaire des gabarits historiques vers le modèle V2.
 * Aucun exporteur ne le consomme encore : cette couche pure prépare la
 * migration sans modifier les comportements actuels.
 */

const DEFAULT_MARGINS: Margins = { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 };

function cloneMargins(margins: Margins): Margins {
  return { top: margins.top, bottom: margins.bottom, left: margins.left, right: margins.right };
}

function legacyMargins(tpl: ExportTemplate): Margins {
  if (tpl.marginsCm) return cloneMargins(tpl.marginsCm);
  if (typeof tpl.marginCm === "number") {
    return { top: tpl.marginCm, bottom: tpl.marginCm, left: tpl.marginCm, right: tpl.marginCm };
  }
  return cloneMargins(DEFAULT_MARGINS);
}

function profileFor(key: string): ExportTemplateV2["profile"] {
  if (key === "classique") return "manuscript";
  if (key === "apa" || key === "these") return "academic";
  return "document";
}

function normalizedPageSize(value: string | undefined): TemplatePageSize {
  if (value === "A4" || value === "A5" || value === "Letter" || value === "letter") return value;
  return "A4";
}

function normalizedAlign(value: string | undefined): TemplateAlign {
  if (value === "left" || value === "center" || value === "right" || value === "justify") return value;
  return "left";
}

const HEADING_LEVELS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function cloneStyle(style: HeadingStyle | HeadingStyleV2 | undefined): HeadingStyleV2 {
  if (!style) return {};
  const { align, ...rest } = style;
  return align === undefined ? rest : { ...rest, align: normalizedAlign(align) };
}

function normalizedHeadings(tpl: ExportTemplate): ExportTemplateV2["headings"] {
  const source = tpl.headings || (tpl.chapterTitle ? { h1: tpl.chapterTitle } : null);
  const defaults = source ? {} : { h1: { pageBreakBefore: true }, h2: { pageBreakBefore: true } };
  return Object.fromEntries(HEADING_LEVELS.map((level) => [level, cloneStyle(source?.[level as keyof typeof source] || defaults[level as keyof typeof defaults])])) as ExportTemplateV2["headings"];
}

function cloneTitlePage(titlePage: ExportTemplate["titlePage"] | ExportTemplateV2["titlePage"] | undefined): ExportTemplateV2["titlePage"] {
  return { styles: Object.fromEntries(Object.entries(titlePage?.styles ?? {}).map(([role, style]) => [role, { ...style }])) };
}

/** Rend un V2 existant complet, même s'il provient d'une première version
 * partielle du format. Cette normalisation est pure et ne relit jamais un
 * gabarit intégré. */
export function normalizeV2Template(tpl: ExportTemplateV2): ExportTemplateV2 {
  const page = tpl.page || {} as ExportTemplateV2["page"];
  const body = tpl.body || {} as ExportTemplateV2["body"];
  const suppliedHeadings = tpl.headings || {};
  return {
    version: 2,
    profile: tpl.profile || "document",
    page: {
      size: normalizedPageSize(page.size),
      orientation: page.orientation === "landscape" ? "landscape" : "portrait",
      marginsCm: cloneMargins(page.marginsCm || DEFAULT_MARGINS),
      mirrorMargins: !!page.mirrorMargins,
      columns: { count: page.columns?.count ?? 1, gutterPt: page.columns?.gutterPt ?? 0 },
    },
    body: {
      fontFamily: body.fontFamily || "'Times New Roman', Times, serif",
      fontSizePt: body.fontSizePt ?? 12,
      lineHeight: body.lineHeight ?? 1.5,
      align: normalizedAlign(body.align),
      firstLineIndentPt: body.firstLineIndentPt ?? 0,
      paragraphSpacingBeforePt: body.paragraphSpacingBeforePt ?? 0,
      paragraphSpacingAfterPt: body.paragraphSpacingAfterPt ?? 0,
      hyphenation: !!body.hyphenation,
    },
    headings: Object.fromEntries(HEADING_LEVELS.map((level) => [level, cloneStyle(suppliedHeadings[level])])) as ExportTemplateV2["headings"],
    blockquote: tpl.blockquote ? { ...tpl.blockquote } : {},
    sceneDivider: tpl.sceneDivider ?? "",
    header: {
      enabled: tpl.header?.enabled !== false, left: tpl.header?.left ?? "{title}", center: tpl.header?.center ?? "", right: tpl.header?.right ?? "{author}",
      distanceCm: tpl.header?.distanceCm ?? 0.75, bodyGapPt: tpl.header?.bodyGapPt ?? 3, differentOddEven: !!tpl.header?.differentOddEven,
    },
    footer: {
      enabled: tpl.footer?.enabled !== false, left: tpl.footer?.left ?? "", center: tpl.footer?.center ?? "", right: tpl.footer?.right ?? "Page {page} sur {pages}",
      distanceCm: tpl.footer?.distanceCm ?? 0.75, bodyGapPt: tpl.footer?.bodyGapPt ?? 3,
    },
    firstPage: { hideHeader: tpl.firstPage?.hideHeader !== false, pageNumberPosition: tpl.firstPage?.pageNumberPosition ?? "right" },
    titlePage: cloneTitlePage(tpl.titlePage),
  };
}

/** Transforme une définition legacy et, facultativement, ses réglages PDF
 * en V2. Les deux entrées sont seulement lues ; tous les objets retournés
 * sont des copies indépendantes. */
export function normalizeLegacyTemplate(
  tpl: ExportTemplate,
  legacySettings: Partial<FeuilletsSettings> = {}
): ExportTemplateV2 {
  const fontSizePt = tpl.fontSizePt ?? 12;
  const settingsMargins = legacySettings.pdfMarginTop !== undefined
    || legacySettings.pdfMarginBottom !== undefined
    || legacySettings.pdfMarginLeft !== undefined
    || legacySettings.pdfMarginRight !== undefined;
  const baseMargins = legacyMargins(tpl);
  const marginsCm: Margins = settingsMargins
    ? {
      top: legacySettings.pdfMarginTop ?? baseMargins.top,
      bottom: legacySettings.pdfMarginBottom ?? baseMargins.bottom,
      left: legacySettings.pdfMarginLeft ?? baseMargins.left,
      right: legacySettings.pdfMarginRight ?? baseMargins.right,
    }
    : baseMargins;

  return normalizeV2Template({
    version: 2,
    profile: profileFor(tpl.key),
    page: {
      size: normalizedPageSize(legacySettings.pdfPageSize),
      orientation: legacySettings.pdfOrientation ?? (tpl.pageOrientation === "landscape" ? "landscape" : "portrait"),
      marginsCm,
      mirrorMargins: legacySettings.pdfMirrorMargins ?? false,
      columns: tpl.columns ? { ...tpl.columns } : { count: 1, gutterPt: 0 },
    },
    body: {
      fontFamily: tpl.fontFamily ?? "'Times New Roman', Times, serif",
      fontSizePt,
      lineHeight: tpl.lineHeight ?? 1.5,
      align: normalizedAlign(tpl.align),
      firstLineIndentPt: tpl.indent ? (tpl.indentPt ?? fontSizePt * 1.5) : 0,
      paragraphSpacingBeforePt: tpl.paragraphSpacingPt ?? 0,
      paragraphSpacingAfterPt: tpl.paragraphSpacing ? fontSizePt : 0,
      hyphenation: !!tpl.hyphenation,
    },
    headings: normalizedHeadings(tpl),
    blockquote: tpl.blockquote ? { ...tpl.blockquote } : {},
    sceneDivider: tpl.sceneDivider ?? "",
    header: {
      enabled: legacySettings.pdfEnableHeaders !== false, left: legacySettings.pdfHeaderLeft ?? "{title}", center: legacySettings.pdfHeaderCenter ?? "", right: legacySettings.pdfHeaderRight ?? "{author}",
      distanceCm: legacySettings.pdfHeaderDistanceCm ?? 0.75, bodyGapPt: legacySettings.pdfHeaderBodyGapPt ?? 3, differentOddEven: !!legacySettings.pdfDiffHeaders,
    },
    footer: {
      enabled: legacySettings.pdfEnableFooters !== false, left: legacySettings.pdfFooterLeft ?? "", center: legacySettings.pdfFooterCenter ?? "", right: legacySettings.pdfFooterRight ?? "Page {page} sur {pages}",
      distanceCm: legacySettings.pdfFooterDistanceCm ?? 0.75, bodyGapPt: legacySettings.pdfFooterBodyGapPt ?? 3,
    },
    firstPage: { hideHeader: legacySettings.pdfHideFirstPageHeader !== false, pageNumberPosition: legacySettings.pdfPageNumberPosition ?? "right" },
    titlePage: cloneTitlePage(tpl.titlePage),
  });
}
