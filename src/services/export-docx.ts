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
} from "docx";
import type { App } from "obsidian";
import type { ISectionOptions, IStylesOptions } from "docx";
import { renderManuscriptHtml } from "./export-render.js";

import { normalizeHeadings } from "../utils/export-templates.js";
import { resolveExportTemplate } from "./export-templates-custom.js";
import { markedMarkdownFor, bookmarkMarkerInfoOf, bookmarkIdFor } from "../utils/docx-bookmarks.js";
import {
  FRONT_PAGE_LINE_SPACING,
  alignmentFor,
  wordLocale,
  sectionPageMargin,
  titleRoleOf,
  frontRoleStyle,
} from "./export-docx-style.js";
import { blockToParagraphs } from "./docx-blocks.js";
import { generatedContentsDescriptor, type GeneratedContentsKind } from "./generated-contents.js";

type ExportSegment = {
  path?: string | null;
  text: string;
  frontType?: string;
  generatedType?: GeneratedContentsKind;
  sourceTitle?: string | null;
  sourceSubtitle?: string | null;
  startsWithGeneratedTitle?: boolean;
  structuralType?: "part";
};

const headingLevelForTag: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3, H4: HeadingLevel.HEADING_4, H5: HeadingLevel.HEADING_5, H6: HeadingLevel.HEADING_6 };
const normalized = (value: string) => value.trim().replace(/\s+/g, " ");

type ExportInput = {
  markdown: string;
  title: string;
  author: string;
  sourcePath: string;
  segments?: ExportSegment[];
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
export async function exportDocx(app: App, settings: FeuilletsSettings, { markdown, title, author, sourcePath, segments }: ExportInput): Promise<Buffer> {
  /* Ces champs sont fournis par DEFAULT_SETTINGS ; FeuilletsSettings les
     garde ouverts pendant la migration progressive pour les autres services. */
  const docxSettings = settings as ExportDocxSettings;
  const tpl = await resolveExportTemplate(app, settings, docxSettings.exportTemplate);
  // « Classique (manuscrit) » est le gabarit natif Manuscrit ; les choix
  // éditoriaux dédiés ne doivent jamais déborder vers les autres gabarits.
  const isManuscriptTemplate = docxSettings.exportTemplate === "classique";
  const allSegments = segments ?? [];
  const renderSegments = allSegments.filter((segment) => segment.generatedType !== "summary" && segment.generatedType !== "toc");
  const renderMarkdown = segments && segments.length ? markedMarkdownFor(renderSegments) : markdown;
  const { containerEl, footnotes, images }: RenderedManuscript = await renderManuscriptHtml(app, renderMarkdown, sourcePath);

  const footnoteIdByHref = new Map<string, number>();
  const footnoteMap: Record<string, { children: Paragraph[] }> = {};
  footnotes.forEach((f, i) => {
    const id = i + 1;
    footnoteIdByHref.set(f.id, id);
    const text = (f.text || "").replace(/[\s/\\]+$/, "").trim();
    footnoteMap[id] = { children: [new Paragraph({ children: [new TextRun(` ${text}`)] })] };
  });

  const headings = normalizeHeadings(tpl);

  /* Pas de page de titre générique (titre + auteur + saut de page) si
     l'autrice a déjà composé sa propre page Front de type "titre" — sans
     quoi le document ouvrirait sur DEUX pages de titre à la suite. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));
  const genericTitleParagraphs = hasAuthoredTitlePage
    ? []
    : [new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(title)] })];
  if (!hasAuthoredTitlePage && author) {
    genericTitleParagraphs.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(author)] }));
  }
  if (!hasAuthoredTitlePage) {
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
        page: { margin: sectionPageMargin(tpl) },
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
          new TextRun({ text: (child.textContent || "").toLocaleUpperCase("fr"), bold: true, size: 32, font: (tpl.headingFontFamily || tpl.fontFamily).split(",")[0].replace(/['"]/g, "").trim() }),
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
        frontOverride = { role: currentRole, style: frontRoleStyle(tpl, currentRole) };
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
    const paras = blockToParagraphs(child, footnoteIdByHref, tpl, headings, images, frontOverride);
    (currentFrontBuffer || bodyParagraphs).push(...paras);
  }
  if (openBookmarkLinkId != null) {
    (currentFrontBuffer || bodyParagraphs).push(new Paragraph({ children: [new BookmarkEnd(openBookmarkLinkId)] }));
  }
  flushFrontBuffer();

  const fontFamily = tpl.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
  const headingFontFamily = (tpl.headingFontFamily || tpl.fontFamily).split(",")[0].replace(/['"]/g, "").trim();

  const headingStyles: HeadingDefaults = {};
  for (const [level, styleKey] of [["h1", "heading1"], ["h2", "heading2"], ["h3", "heading3"]] as const) {
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

  const headerLeftStr = docxSettings.pdfHeaderLeft ?? "{title}";
  const headerCenterStr = docxSettings.pdfHeaderCenter ?? "";
  const headerRightStr = docxSettings.pdfHeaderRight ?? "{author}";
  const footerLeftStr = docxSettings.pdfFooterLeft ?? "";
  const footerCenterStr = docxSettings.pdfFooterCenter ?? "";
  const footerRightStr = docxSettings.pdfFooterRight ?? "Page {page} sur {pages}";
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

  const docHeaders: HeaderGroup = { default: new Header({ children: docxSettings.pdfEnableHeaders === false ? [] : [headerParagraph] }) };
  const docFooters: FooterGroup = { default: new Footer({ children: docxSettings.pdfEnableFooters === false ? [] : [footerParagraph] }) };

  if (docxSettings.pdfHideFirstPageHeader ?? true) {
    docHeaders.first = new Header({ children: [] });
    docFooters.first = new Footer({ children: [] });
  }

  const doc = new Document({
    creator: author || "",
    title,
    footnotes: footnoteMap,
    hyphenation: { autoHyphenation: !!tpl.hyphenation },
    styles: {
      default: {
        document: {
          run: { font: fontFamily, size: `${tpl.fontSizePt}pt`, language: { value: wordLocale(docxSettings.epubLanguage) } },
          paragraph: { spacing: { line: Math.round(tpl.lineHeight * 240) } },
        },
        ...headingStyles,
      },
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
            margin: sectionPageMargin(tpl),
            size: tpl.pageOrientation === "landscape" ? { orientation: PageOrientation.LANDSCAPE } : undefined,
          },
          column: tpl.columns ? { count: tpl.columns.count, space: `${tpl.columns.gutterPt}pt` } : undefined,
          titlePage: docxSettings.pdfHideFirstPageHeader ?? true,
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
