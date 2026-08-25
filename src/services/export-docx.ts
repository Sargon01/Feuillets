import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Footer,
  Header,
  PageNumber,
  PageOrientation,
  BookmarkStart,
  BookmarkEnd,
  bookmarkUniqueNumericIdGen,
  SectionType,
  SimpleField,
  PageBreak,
  TableOfContents,
  VerticalAlignSection,
  LineRuleType,
} from "docx";
import type { App } from "obsidian";
import type { IParagraphStyleOptions, ISectionOptions, IStylesOptions } from "docx";
import { renderManuscriptHtml } from "./export-render.js";

import { resolveExportTemplate, resolveExportTemplateV2 } from "./export-templates-custom.js";
import { shouldGenerateGenericTitlePage } from "./export-template-v2.js";
import { markedMarkdownFor, bookmarkMarkerInfoOf, bookmarkIdFor } from "../utils/docx-bookmarks.js";
import {
  FRONT_PAGE_LINE_SPACING,
  alignmentFor,
  wordLocale,
  titleRoleOf,
} from "./export-docx-style.js";
import { blockToParagraphs } from "./docx-blocks.js";
import { generatedContentsDescriptor, type GeneratedContentsKind } from "./generated-contents.js";
import type { ContentVariant } from "./content-variants.js";

type ExportSegment = {
  path?: string | null;
  text: string;
  renderText?: string;
  frontType?: string;
  generatedType?: GeneratedContentsKind;
  sourceTitle?: string | null;
  sourceSubtitle?: string | null;
  startsWithGeneratedTitle?: boolean;
  structuralType?: "part";
};

const headingLevelForTag: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3, H4: HeadingLevel.HEADING_4, H5: HeadingLevel.HEADING_5, H6: HeadingLevel.HEADING_6 };
const normalized = (value: string) => value.trim().replace(/\s+/g, " ");
const firstFontFamily = (value?: string) => value?.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") || undefined;
export const FEUILLETS_CITATION_STYLE = "FeuilletsCitation";

/** Style Word stable appliqué aux paragraphes Markdown `>` exportés. */
export function citationParagraphStyle(template: Pick<ExportTemplateV2, "blockquote" | "profile">): IParagraphStyleOptions {
  const quote = template.blockquote || {};
  return {
    id: FEUILLETS_CITATION_STYLE,
    name: "Citation",
    basedOn: "Normal",
    next: "Normal",
    run: {
      font: firstFontFamily(quote.fontFamily),
      size: quote.fontSizePt != null ? `${quote.fontSizePt}pt` : undefined,
      italics: quote.italic,
      color: quote.colorHex?.replace(/^#/, ""),
    },
    paragraph: {
      alignment: quote.align ? alignmentFor({ align: quote.align }) : undefined,
      indent: {
        left: quote.marginLeftPt != null ? quote.marginLeftPt * 20 : undefined,
        right: quote.marginRightPt != null ? quote.marginRightPt * 20 : undefined,
        firstLine: (quote.firstLineIndentPt ?? (template.profile === "document" ? 18 : undefined)) != null
          ? (quote.firstLineIndentPt ?? 18) * 20
          : undefined,
      },
      spacing: quote.lineHeight != null
        ? { line: Math.round(quote.lineHeight * 240), lineRule: LineRuleType.AUTO }
        : undefined,
    },
  };
}

type ExportInput = {
  markdown: string;
  title: string;
  author: string;
  sourcePath: string;
  segments?: ExportSegment[];
  contentVariant?: ContentVariant | null;
};

type RenderedFootnote = {
  id: string;
  text: string;
};

type RenderedImage = {
  bytes?: Uint8Array;
  ext?: string;
  width?: number;
  height?: number;
  caption?: string;
};

type RenderedManuscript = {
  containerEl: HTMLElement;
  footnotes: RenderedFootnote[];
  images: Map<unknown, RenderedImage>;
};

type FrontOverride = {
  role?: string;
  style?: TitlePageStyle | null;
  isTitleLine?: boolean;
};

type HeadingDefaults = {
  heading1?: NonNullable<IStylesOptions["default"]>["heading1"];
  heading2?: NonNullable<IStylesOptions["default"]>["heading2"];
  heading3?: NonNullable<IStylesOptions["default"]>["heading3"];
  heading4?: NonNullable<IStylesOptions["default"]>["heading4"];
  heading5?: NonNullable<IStylesOptions["default"]>["heading5"];
  heading6?: NonNullable<IStylesOptions["default"]>["heading6"];
};
type HeaderGroup = { default: Header; first?: Header };
type FooterGroup = { default: Footer; first?: Footer };
type ExportDocxSettings = FeuilletsSettings & {
  exportTemplate: string;
  pdfHeaderLeft?: string | null;
  pdfHeaderCenter?: string | null;
  pdfHeaderRight?: string | null;
  pdfFooterLeft?: string | null;
  pdfFooterCenter?: string | null;
  pdfFooterRight?: string | null;
  pdfPageNumberPosition?: string | null;
  pdfHideFirstPageHeader?: boolean | null;
  epubLanguage?: string | null;
};

/* Le format des marqueurs de découpe et leur lecture vivent dans
   utils/docx-bookmarks.js, avec le calcul d'identifiant de signet qu'ils
   transportent — c'est le même contrat d'aller-retour, lu à l'autre bout par
   services/docx-review-import.js. */

/** Génère un fichier Word (.docx) avec gestion des en-têtes/pieds et numérotation des pages */
export async function exportDocx(app: App, settings: FeuilletsSettings, { markdown, title, author, sourcePath, segments, contentVariant }: ExportInput): Promise<Buffer> {
  /* Ces champs sont fournis par DEFAULT_SETTINGS ; FeuilletsSettings les
     garde ouverts pendant la migration progressive pour les autres services. */
  const docxSettings = settings as ExportDocxSettings;
  const template = await resolveExportTemplateV2(app, settings, docxSettings.exportTemplate);
  const resolvedLegacyTemplate = await resolveExportTemplate(app, settings, docxSettings.exportTemplate);
  // L'adaptateur ne sert qu'à blockToParagraphs, dont l'API legacy est
  // conservée pendant la migration. Toutes les valeurs viennent de V2.
  const tpl: ExportTemplate = {
    key: "v2", label: "V2",
    fontFamily: template.body.fontFamily,
    fontSizePt: template.body.fontSizePt,
    lineHeight: template.body.lineHeight,
    align: template.body.align,
    indent: template.body.firstLineIndentPt > 0,
    indentPt: template.body.firstLineIndentPt || undefined,
    paragraphSpacing: template.body.paragraphSpacingAfterPt > 0,
    paragraphSpacingPt: template.body.paragraphSpacingBeforePt || undefined,
    hyphenation: template.body.hyphenation,
    profile: template.profile,
    headings: template.headings,
    blockquote: template.blockquote,
    sceneDivider: template.sceneDivider,
    titlePage: template.titlePage,
  };
  const cm = (value: number): `${number}cm` => `${value}cm`;
  const pageMargin = {
    top: cm(template.page.marginsCm.top), bottom: cm(template.page.marginsCm.bottom),
    left: cm(template.page.marginsCm.left), right: cm(template.page.marginsCm.right),
  };
  // Les choix éditoriaux dédiés suivent le profil V2, y compris pour une
  // copie personnalisée de « Classique ».
  const isManuscriptTemplate = template.profile === "manuscript";
  const allSegments = segments ?? [];
  const renderSegments = allSegments.filter((segment) => segment.generatedType !== "summary" && segment.generatedType !== "toc");
  const renderMarkdown = segments && segments.length ? markedMarkdownFor(renderSegments.map((segment) => ({ ...segment, text: segment.renderText ?? segment.text }))) : markdown;
  const { containerEl, footnotes, images }: RenderedManuscript = await renderManuscriptHtml(app, renderMarkdown, sourcePath, [], contentVariant ?? null);

  const footnoteIdByHref = new Map<string, number>();
  const footnoteMap: Record<string, { children: Paragraph[] }> = {};
  footnotes.forEach((f, i) => {
    const id = i + 1;
    footnoteIdByHref.set(f.id, id);
    const text = (f.text || "").replace(/[\s/\\]+$/, "").trim();
    footnoteMap[id] = { children: [new Paragraph({ children: [new TextRun(` ${text}`)] })] };
  });

  const headings = template.headings;

  /* Pas de page de titre générique (titre + auteur + saut de page) si
     l'autrice a déjà composé sa propre page Front de type "titre", ni pour
     un profil document explicitement projeté — le flux doit alors commencer
     directement par le Markdown. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));
  const generateGenericTitlePage = shouldGenerateGenericTitlePage(resolvedLegacyTemplate.profile, hasAuthoredTitlePage);
  const genericTitleParagraphs: Paragraph[] = [];
  if (generateGenericTitlePage) {
    genericTitleParagraphs.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(title)] }));
  }
  if (generateGenericTitlePage && author) {
    genericTitleParagraphs.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(author)] }));
  }
  if (generateGenericTitlePage) {
    genericTitleParagraphs.push(new Paragraph({ pageBreakBefore: true, children: [] }));
  }
  const bodyParagraphs: Paragraph[] = [];

  /* Chaque page Front (titre/dédicace/épigraphe) devient sa PROPRE section
     Word, centrée verticalement sur la page (voir frontSections plus bas) —
     plutôt que d'empiler ces pages dans le même flux que le manuscrit, ce
     qui empêcherait de leur donner un centrage vertical propre à elles
     (une section Word ne peut avoir qu'un seul réglage de centrage vertical
     pour toutes ses pages). `frontSections` accumule ces sections déjà
     finalisées ; `bodyParagraphs` ne garde que le contenu du manuscrit
     normal (avant ET après les pages Front, le cas échéant). */
  const frontSections: ISectionOptions[] = [];
  let currentFrontBuffer: Paragraph[] | null = null;
  /* Une page de titre à rôles positionne ses éléments par des marges venues du
     modèle (marginTopPt/marginBottomPt), mesurées depuis le HAUT de la page —
     elle est donc ancrée en haut (verticalAlign TOP), comme le modèle Word de
     référence. Une page Front en composition libre (dédicace/épigraphe, ou
     page de titre sans rôles) reste centrée verticalement, Word répartissant
     lui-même le bloc au milieu. */
  let currentFrontIsRoleTitle = false;
  const flushFrontBuffer = (): void => {
    if (!currentFrontBuffer) return;
    frontSections.push({
      properties: {
        page: { margin: pageMargin },
        verticalAlign: currentFrontIsRoleTitle ? VerticalAlignSection.TOP : VerticalAlignSection.CENTER,
        type: SectionType.NEXT_PAGE,
      },
      headers: { default: new Header({ children: [] }) },
      footers: { default: new Footer({ children: [] }) },
      children: currentFrontBuffer,
    });
    currentFrontBuffer = null;
  };

  const nextBookmarkLinkId = bookmarkUniqueNumericIdGen();
  const sourceSegmentByBookmark = new Map(allSegments.filter((segment) => segment.path).map((segment) => [bookmarkIdFor(segment.path), segment]));
  let currentSourceSegment: ExportSegment | null = null;
  let currentStructuralPart = false;
  let markerSegmentIndex = -1;
  let structuralHeadingHandled = false;
  let subtitleHeadingSkipped = false;
  let openBookmarkLinkId: number | null = null;
  let currentFrontType: string | null = null;
  /* Sur une page de titre spécifiquement, l'autrice compose son titre en
     tout premier bloc de contenu (18pt, voir isTitleLine) — le reste (genre,
     nombre de mots, coordonnées…) suit en taille normale.

     On repère ce titre comme la PREMIÈRE ligne non vide de la page, et rien
     de plus : renderManuscriptHtml (utilisé ici pour le .docx) ne conserve
     PAS les lignes vides du markdown sous forme de paragraphes vides — toutes
     les lignes de la page de titre arrivent donc collées, sans blanc entre
     elles. Une détection par « transition ligne-vide → contenu » classait de
     ce fait CHAQUE ligne comme un titre et gonflait toute la page à 18pt. */
  let titleLineEmitted = false;
  /* Page de titre à rôles : chaque contenu est précédé d'un paragraphe-
     marqueur `FEUILLETS-FPROLE:rôle` (voir compile-export.js/export-render.js).
     currentRole retient le rôle en attente jusqu'au paragraphe de contenu qui
     suit, auquel on applique alors le style du modèle. Une page de titre à
     rôles court-circuite la détection titleLineEmitted (repli des pages
     libres). */
  let currentRole: string | null = null;
  for (const child of Array.from(containerEl.children)) {
    const markerInfo = bookmarkMarkerInfoOf(child);
    if (markerInfo != null) {
      if (openBookmarkLinkId != null) {
        (currentFrontBuffer || bodyParagraphs).push(new Paragraph({ children: [new BookmarkEnd(openBookmarkLinkId)] }));
        openBookmarkLinkId = null;
      }
      /* Chaque marqueur correspond à un feuillet distinct : un marqueur
         Front referme systématiquement la section Front précédente (même
         de même type — deux épigraphes restent deux pages séparées) et en
         démarre une nouvelle ; un marqueur normal (scène, ou marqueur de
         réinitialisation — voir RESET_MARKER_ID) referme la section Front
         en cours, s'il y en a une, et on continue d'accumuler dans
         bodyParagraphs. */
      flushFrontBuffer();
      currentFrontIsRoleTitle = false;
      currentFrontType = markerInfo.frontType;
      const markerSegment = renderSegments[++markerSegmentIndex] || null;
      currentStructuralPart = markerSegment?.structuralType === "part";
      currentSourceSegment = markerInfo.id ? sourceSegmentByBookmark.get(markerInfo.id) || null : null;
      structuralHeadingHandled = false;
      subtitleHeadingSkipped = false;
      if (currentFrontType) currentFrontBuffer = [];
      if (markerInfo.id != null) {
        const linkId = nextBookmarkLinkId();
        /* Le paragraphe d'ancrage du signet ne porte pas de texte : sur une
           page Front, on lui met l'interligne simple pour qu'il n'ajoute pas la
           demi-ligne supplémentaire de l'interligne double du corps en tête de
           page. */
        (currentFrontBuffer || bodyParagraphs).push(
          new Paragraph({
            spacing: currentFrontBuffer ? FRONT_PAGE_LINE_SPACING : undefined,
            children: [new BookmarkStart(markerInfo.id, linkId)],
          })
        );
        openBookmarkLinkId = linkId;
      }
      titleLineEmitted = false;
      currentRole = null;
      continue;
    }
    const role = titleRoleOf(child);
    if (role != null) {
      currentRole = role;
      if (currentFrontType === "titre") currentFrontIsRoleTitle = true;
      continue;
    }
    const tag = (child as HTMLElement).tagName;
    if (currentStructuralPart && isManuscriptTemplate && ["H1", "H2", "H3", "H4", "H5", "H6"].includes(tag)) {
      (currentFrontBuffer || bodyParagraphs).push(new Paragraph({
        heading: headingLevelForTag[tag],
        pageBreakBefore: true,
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: (child.textContent || "").toLocaleUpperCase("fr"), bold: true, size: 32, font: template.body.fontFamily.split(",")[0].replace(/['"]/g, "").trim() }),
          new PageBreak(),
        ],
      }));
      currentStructuralPart = false;
      continue;
    }
    if (["H1", "H2", "H3", "H4", "H5", "H6"].includes(tag) && currentSourceSegment && !currentFrontType) {
      const sourceTitle = currentSourceSegment.sourceTitle ? normalized(currentSourceSegment.sourceTitle) : "";
      const sourceSubtitle = currentSourceSegment.sourceSubtitle ? normalized(currentSourceSegment.sourceSubtitle) : "";
      if (!structuralHeadingHandled && (sourceTitle || sourceSubtitle)) {
        structuralHeadingHandled = true;
        const content = sourceTitle || sourceSubtitle;
        const runs = [new TextRun(content)];
        if (sourceTitle && sourceSubtitle) runs.push(new TextRun({ break: 1 }), new TextRun(sourceSubtitle));
        (currentFrontBuffer || bodyParagraphs).push(new Paragraph({ heading: headingLevelForTag[tag], pageBreakBefore: !!currentSourceSegment.startsWithGeneratedTitle, children: runs }));
        continue;
      }
      if (structuralHeadingHandled && sourceSubtitle && !subtitleHeadingSkipped && normalized(child.textContent || "") === sourceSubtitle) {
        subtitleHeadingSkipped = true;
        continue;
      }
    }
    let frontOverride: FrontOverride | null = null;
    if (currentFrontType) {
      if (currentRole != null) {
        frontOverride = { role: currentRole, style: template.titlePage?.styles?.[currentRole] || null };
        currentRole = null;
      } else if (isManuscriptTemplate && (currentFrontType === "dedicace" || currentFrontType === "epigraphe")) {
        // Pages Front éditoriales du seul gabarit Manuscrit : la section
        // existante les centre déjà verticalement ; seul l'alignement du
        // bloc est ici spécialisé, sans créer de paragraphes artificiels.
        frontOverride = { style: { align: "right" } };
      } else {
        let isTitleLine = false;
        if (currentFrontType === "titre" && !titleLineEmitted) {
          const isBlank = (child.textContent || "").trim() === "";
          if (!isBlank) {
            isTitleLine = true;
            titleLineEmitted = true;
          }
        }
        frontOverride = { isTitleLine };
      }
    }
    const blockOverride = child.classList.contains("feuillets-page-break-before") ? { ...(frontOverride || {}), manualPageBreak: true } : frontOverride;
    const paras = blockToParagraphs(child, footnoteIdByHref, tpl, headings, images, blockOverride);
    (currentFrontBuffer || bodyParagraphs).push(...paras);
  }
  if (openBookmarkLinkId != null) {
    (currentFrontBuffer || bodyParagraphs).push(new Paragraph({ children: [new BookmarkEnd(openBookmarkLinkId)] }));
  }
  flushFrontBuffer();

  const fontFamily = template.body.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
  const headingFontFamily = fontFamily;

  const headingStyles: HeadingDefaults = {};
  for (const [level, styleKey] of [["h1", "heading1"], ["h2", "heading2"], ["h3", "heading3"], ["h4", "heading4"], ["h5", "heading5"], ["h6", "heading6"]] as const) {
    const h = headings[level];
    if (!h) continue;
    headingStyles[styleKey] = {
      run: { size: h.fontSizePt ? `${h.fontSizePt}pt` : undefined, bold: h.bold, italics: h.italic, font: headingFontFamily },
      paragraph: {
        alignment: h.align ? alignmentFor({ align: h.align }) : undefined,
        spacing: {
          before: h.marginTopPt != null ? h.marginTopPt * 20 : undefined,
          after: h.marginBottomPt != null ? h.marginBottomPt * 20 : undefined,
        },
      },
    };
  }

  // Construction dynamique des en-têtes et pieds de page pour Word (.docx)
  const parseHeaderFooterText = (str: string): Array<TextRun | SimpleField> => {
    if (!str) return [];
    const parts = str.split(/(\{page\}|\{pages\}|\{part\}|\{chapter\})/gi);
    return parts.map((part) => {
      if (part.toLowerCase() === "{page}") {
        return new TextRun({ children: [PageNumber.CURRENT] });
      }
      if (part.toLowerCase() === "{pages}") {
        return new TextRun({ children: [PageNumber.TOTAL_PAGES] });
      }
      if (part.toLowerCase() === "{part}") return new SimpleField('STYLEREF "Heading 1"');
      if (part.toLowerCase() === "{chapter}") return new SimpleField('STYLEREF "Heading 2"');
      const text = part.replace(/\{title\}/gi, title).replace(/\{author\}/gi, author);
      return new TextRun({ text, color: "888888", size: 18 });
    });
  };

  const headerLeftStr = template.header?.left ?? "{title}";
  const headerCenterStr = template.header?.center ?? "";
  const headerRightStr = template.header?.right ?? "{author}";
  const footerLeftStr = template.footer?.left ?? "";
  const footerCenterStr = template.footer?.center ?? "";
  const footerRightStr = template.footer?.right ?? "Page {page} sur {pages}";
  const headerParagraph = new Paragraph({
    alignment: AlignmentType.LEFT,
    tabStops: [{ type: "center", position: 4500 }, { type: "right", position: 9000 }],
    children: [
      ...parseHeaderFooterText(headerLeftStr),
      new TextRun("\t"),
      ...parseHeaderFooterText(headerCenterStr),
      new TextRun("\t"),
      ...parseHeaderFooterText(headerRightStr),
    ],
  });

  const footerParagraph = new Paragraph({
    alignment: AlignmentType.LEFT,
    tabStops: [{ type: "center", position: 4500 }, { type: "right", position: 9000 }],
    children: [
      ...parseHeaderFooterText(footerLeftStr),
      new TextRun("\t"),
      ...parseHeaderFooterText(footerCenterStr),
      new TextRun("\t"),
      ...parseHeaderFooterText(footerRightStr),
    ],
  });

  const docHeaders: HeaderGroup = { default: new Header({ children: template.header?.enabled === false ? [] : [headerParagraph] }) };
  const docFooters: FooterGroup = { default: new Footer({ children: template.footer?.enabled === false ? [] : [footerParagraph] }) };

  if (template.firstPage?.hideHeader ?? true) {
    docHeaders.first = new Header({ children: [] });
    docFooters.first = new Footer({ children: [] });
  }

  const doc = new Document({
    creator: author || "",
    title,
    footnotes: footnoteMap,
    hyphenation: { autoHyphenation: template.body.hyphenation },
    styles: {
      default: {
        document: {
          run: { font: fontFamily, size: `${template.body.fontSizePt}pt`, language: { value: wordLocale(docxSettings.epubLanguage) } },
          paragraph: { spacing: { line: Math.round(template.body.lineHeight * 240) } },
        },
        ...headingStyles,
      },
      paragraphStyles: [citationParagraphStyle(template)],
    },
    /* Les sections Front (voir frontSections plus haut) précèdent toujours
       la section du manuscrit : c'est l'ordre réel dans le coffre (dossier
       Front, compilé avant le reste — voir compile-export.js), et c'est
       aussi la seule position qui a du sens pour une page de titre/
       dédicace/épigraphe. */
    sections: [
      ...frontSections,
      {
        properties: {
          page: {
            margin: pageMargin,
            size: template.page.orientation === "landscape" ? { orientation: PageOrientation.LANDSCAPE } : undefined,
          },
          column: template.page.columns ? { count: template.page.columns.count, space: `${template.page.columns.gutterPt}pt` } : undefined,
          titlePage: template.firstPage?.hideHeader ?? true,
        },
        headers: docHeaders,
        footers: docFooters,
        children: [
          ...genericTitleParagraphs,
          ...allSegments.filter((segment) => segment.generatedType === "summary").flatMap((segment) => {
            const descriptor = generatedContentsDescriptor(segment.generatedType as GeneratedContentsKind);
            return [
              new Paragraph({
                children: [new TextRun({ text: descriptor.title, bold: true, size: "20pt", font: headingFontFamily })],
              }),
              new TableOfContents("", { hyperlink: true, headingStyleRange: "1-2" }),
            ];
          }),
          ...(allSegments.some((segment) => segment.generatedType === "summary") && bodyParagraphs.length
            ? [new Paragraph({ pageBreakBefore: true, children: [] })]
            : []),
          ...bodyParagraphs,
          ...allSegments.filter((segment) => segment.generatedType === "toc").flatMap((segment) => {
            const descriptor = generatedContentsDescriptor(segment.generatedType as GeneratedContentsKind);
            return [
              new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: descriptor.title, bold: true, size: "20pt", font: headingFontFamily })] }),
              new TableOfContents("", { hyperlink: true, headingStyleRange: "1-6" }),
            ];
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
