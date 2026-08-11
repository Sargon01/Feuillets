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

function cloneHeadings(tpl: ExportTemplate): ExportTemplateV2["headings"] {
  if (tpl.headings) {
    return Object.fromEntries(
      Object.entries(tpl.headings).map(([level, style]) => [level, style ? { ...style } : style])
    ) as ExportTemplateV2["headings"];
  }
  return tpl.chapterTitle ? { h1: { ...tpl.chapterTitle } } : {};
}

function hasAny(settings: Partial<FeuilletsSettings> | undefined, keys: Array<keyof FeuilletsSettings>): boolean {
  return !!settings && keys.some((key) => settings[key] !== undefined);
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

  const headerKeys: Array<keyof FeuilletsSettings> = [
    "pdfEnableHeaders", "pdfHeaderLeft", "pdfHeaderCenter", "pdfHeaderRight",
    "pdfHeaderDistanceCm", "pdfHeaderBodyGapPt", "pdfDiffHeaders",
  ];
  const footerKeys: Array<keyof FeuilletsSettings> = [
    "pdfEnableFooters", "pdfFooterLeft", "pdfFooterCenter", "pdfFooterRight",
    "pdfFooterDistanceCm", "pdfFooterBodyGapPt",
  ];
  const firstPageKeys: Array<keyof FeuilletsSettings> = ["pdfHideFirstPageHeader", "pdfPageNumberPosition"];

  return {
    version: 2,
    profile: profileFor(tpl.key),
    page: {
      size: legacySettings.pdfPageSize ?? "A4",
      orientation: legacySettings.pdfOrientation ?? (tpl.pageOrientation === "landscape" ? "landscape" : "portrait"),
      marginsCm,
      mirrorMargins: legacySettings.pdfMirrorMargins ?? false,
      ...(tpl.columns ? { columns: { ...tpl.columns } } : {}),
    },
    body: {
      fontFamily: tpl.fontFamily ?? "'Times New Roman', Times, serif",
      fontSizePt,
      lineHeight: tpl.lineHeight ?? 1.5,
      align: tpl.align ?? "left",
      firstLineIndentPt: tpl.indent ? (tpl.indentPt ?? fontSizePt * 1.5) : 0,
      paragraphSpacingBeforePt: tpl.paragraphSpacingPt ?? 0,
      paragraphSpacingAfterPt: tpl.paragraphSpacing ? fontSizePt : 0,
      hyphenation: !!tpl.hyphenation,
    },
    headings: cloneHeadings(tpl),
    ...(tpl.blockquote ? { blockquote: { ...tpl.blockquote } } : {}),
    ...(tpl.sceneDivider !== undefined ? { sceneDivider: tpl.sceneDivider } : {}),
    ...(hasAny(legacySettings, headerKeys) ? {
      header: {
        enabled: legacySettings.pdfEnableHeaders,
        left: legacySettings.pdfHeaderLeft,
        center: legacySettings.pdfHeaderCenter,
        right: legacySettings.pdfHeaderRight,
        distanceCm: legacySettings.pdfHeaderDistanceCm,
        bodyGapPt: legacySettings.pdfHeaderBodyGapPt,
        differentOddEven: legacySettings.pdfDiffHeaders,
      },
    } : {}),
    ...(hasAny(legacySettings, footerKeys) ? {
      footer: {
        enabled: legacySettings.pdfEnableFooters,
        left: legacySettings.pdfFooterLeft,
        center: legacySettings.pdfFooterCenter,
        right: legacySettings.pdfFooterRight,
        distanceCm: legacySettings.pdfFooterDistanceCm,
        bodyGapPt: legacySettings.pdfFooterBodyGapPt,
      },
    } : {}),
    ...(hasAny(legacySettings, firstPageKeys) ? {
      firstPage: {
        hideHeader: legacySettings.pdfHideFirstPageHeader,
        pageNumberPosition: legacySettings.pdfPageNumberPosition,
      },
    } : {}),
    ...(tpl.titlePage ? { titlePage: { styles: Object.fromEntries(Object.entries(tpl.titlePage.styles ?? {}).map(([role, style]) => [role, { ...style }])) } } : {}),
  };
}
