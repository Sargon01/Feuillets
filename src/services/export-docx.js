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
  VerticalAlignSection,
} from "docx";
import { renderManuscriptHtml } from "./export-render.js";
import { TITLE_ROLE_MARKER } from "../utils/title-roles.js";
import { normalizeHeadings } from "../utils/export-templates.js";
import { resolveExportTemplate } from "./export-templates-custom.js";
import { markedMarkdownFor, bookmarkMarkerInfoOf } from "../utils/docx-bookmarks.js";
import {
  FRONT_PAGE_LINE_SPACING,
  alignmentFor,
  wordLocale,
  sectionPageMargin,
  titleRoleOf,
  frontRoleStyle,
} from "./export-docx-style.js";
import { blockToParagraphs } from "./docx-blocks.js";

/* Le format des marqueurs de découpe et leur lecture vivent dans
   utils/docx-bookmarks.js, avec le calcul d'identifiant de signet qu'ils
   transportent — c'est le même contrat d'aller-retour, lu à l'autre bout par
   services/docx-review-import.js. */

/** Génère un fichier Word (.docx) avec gestion des en-têtes/pieds et numérotation des pages */
export async function exportDocx(app, settings, { markdown, title, author, sourcePath, segments }) {
  const tpl = await resolveExportTemplate(app, settings, settings.exportTemplate);
  const renderMarkdown = segments && segments.length ? markedMarkdownFor(segments) : markdown;
  const { containerEl, footnotes, images } = await renderManuscriptHtml(app, renderMarkdown, sourcePath);

  const footnoteIdByHref = new Map();
  const footnoteMap = {};
  footnotes.forEach((f, i) => {
    const id = i + 1;
    footnoteIdByHref.set(f.id, id);
    footnoteMap[id] = { children: [new Paragraph({ children: [new TextRun(` ${f.text}`)] })] };
  });

  const headings = normalizeHeadings(tpl);

  /* Pas de page de titre générique (titre + auteur + saut de page) si
     l'autrice a déjà composé sa propre page Front de type "titre" — sans
     quoi le document ouvrirait sur DEUX pages de titre à la suite. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));
  let bodyParagraphs = hasAuthoredTitlePage
    ? []
    : [new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(title)] })];
  if (!hasAuthoredTitlePage && author) {
    bodyParagraphs.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(author)] }));
  }
  if (!hasAuthoredTitlePage) {
    bodyParagraphs.push(new Paragraph({ pageBreakBefore: true, children: [] }));
  }

  /* Chaque page Front (titre/dédicace/épigraphe) devient sa PROPRE section
     Word, centrée verticalement sur la page (voir frontSections plus bas) —
     plutôt que d'empiler ces pages dans le même flux que le manuscrit, ce
     qui empêcherait de leur donner un centrage vertical propre à elles
     (une section Word ne peut avoir qu'un seul réglage de centrage vertical
     pour toutes ses pages). `frontSections` accumule ces sections déjà
     finalisées ; `bodyParagraphs` ne garde que le contenu du manuscrit
     normal (avant ET après les pages Front, le cas échéant). */
  const frontSections = [];
  let currentFrontBuffer = null;
  /* Une page de titre à rôles positionne ses éléments par des marges venues du
     modèle (marginTopPt/marginBottomPt), mesurées depuis le HAUT de la page —
     elle est donc ancrée en haut (verticalAlign TOP), comme le modèle Word de
     référence. Une page Front en composition libre (dédicace/épigraphe, ou
     page de titre sans rôles) reste centrée verticalement, Word répartissant
     lui-même le bloc au milieu. */
  let currentFrontIsRoleTitle = false;
  const flushFrontBuffer = () => {
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
  let openBookmarkLinkId = null;
  let currentFrontType = null;
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
  let currentRole = null;
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
    let frontOverride = null;
    if (currentFrontType) {
      if (currentRole != null) {
        frontOverride = { role: currentRole, style: frontRoleStyle(tpl, currentRole) };
        currentRole = null;
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

  const headingStyles = {};
  for (const [level, styleKey] of [["h1", "heading1"], ["h2", "heading2"], ["h3", "heading3"]]) {
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
  const parseHeaderFooterText = (str) => {
    if (!str) return [];
    const parts = str.split(/(\{page\}|\{pages\})/gi);
    return parts.map((part) => {
      if (part.toLowerCase() === "{page}") {
        return new TextRun({ children: [PageNumber.CURRENT] });
      }
      if (part.toLowerCase() === "{pages}") {
        return new TextRun({ children: [PageNumber.TOTAL_PAGES] });
      }
      const text = part.replace(/\{title\}/gi, title).replace(/\{author\}/gi, author);
      return new TextRun({ text, color: "888888", size: 18 });
    });
  };

  const headerLeftStr = settings.pdfHeaderLeft ?? "{title}";
  const headerRightStr = settings.pdfHeaderRight ?? "{author}";
  const footerRightStr = settings.pdfFooterRight ?? "Page {page} sur {pages}";
  const pageNumPos = settings.pdfPageNumberPosition || "right"; // "right" | "center" | "left"

  const alignMap = {
    right: AlignmentType.RIGHT,
    center: AlignmentType.CENTER,
    left: AlignmentType.LEFT,
  };

  const headerParagraph = new Paragraph({
    alignment: AlignmentType.LEFT,
    tabStops: [{ type: "right", position: 9000 }],
    children: [
      ...parseHeaderFooterText(headerLeftStr),
      new TextRun("\t"),
      ...parseHeaderFooterText(headerRightStr),
    ],
  });

  const footerParagraph = new Paragraph({
    alignment: alignMap[pageNumPos] || AlignmentType.RIGHT,
    children: parseHeaderFooterText(footerRightStr),
  });

  const docHeaders = { default: new Header({ children: [headerParagraph] }) };
  const docFooters = { default: new Footer({ children: [footerParagraph] }) };

  if (settings.pdfHideFirstPageHeader ?? true) {
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
          run: { font: fontFamily, size: `${tpl.fontSizePt}pt`, language: { value: wordLocale(settings.epubLanguage) } },
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
          titlePage: settings.pdfHideFirstPageHeader ?? true,
        },
        headers: docHeaders,
        footers: docFooters,
        children: bodyParagraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
