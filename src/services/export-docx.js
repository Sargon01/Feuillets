import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  FootnoteReferenceRun,
  Footer,
  Header,
  PageNumber,
  PageOrientation,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BookmarkStart,
  BookmarkEnd,
  bookmarkUniqueNumericIdGen,
  SectionType,
  VerticalAlignSection,
} from "docx";
import { renderManuscriptHtml } from "./export-render.js";
import { TITLE_ROLE_MARKER } from "../utils/title-roles.js";
import { marginsFor, normalizeHeadings } from "../utils/export-templates.js";
import { resolveExportTemplate } from "./export-templates-custom.js";
import { bookmarkIdFor } from "../utils/docx-bookmarks.js";

const MARKER_PREFIX = "FEUILLETS-SCENE:";
// Suffixe optionnel ":titre"/"dedicace"/"epigraphe" — voir folder-structure.js
// (FRONT_PAGE_TYPES) ; ajouté au même marqueur plutôt qu'un second, pour ne
// pas avoir à faire correspondre deux marqueurs entre eux.
const MARKER_RE = /^FEUILLETS-SCENE:([a-zA-Z0-9_]+)(?::(titre|dedicace|epigraphe))?$/;

/* Marqueur "réinitialisation" : posé devant un bloc sans feuillet propre
   (titre de partie/chapitre) qui suit une page Front, pour que
   `currentFrontType` retombe bien à null dans la boucle principale — sans
   ça, la mise en forme spéciale (centrage, saut de page) "fuirait" sur ce
   titre de dossier, faute de marqueur pour signaler la fin de la page
   Front. Ne correspond à aucun chemin réel : sans effet sur la lecture
   d'un .docx annoté (l'identifiant ne matche simplement aucun feuillet). */
const RESET_MARKER_ID = "reset";

function markedMarkdownFor(segments) {
  return segments
    .map((seg) => {
      if (!seg.path) return `${MARKER_PREFIX}${RESET_MARKER_ID}\n\n${seg.text}`;
      const suffix = seg.frontType ? `:${seg.frontType}` : "";
      const marker = `${MARKER_PREFIX}${bookmarkIdFor(seg.path)}${suffix}\n\n`;
      return marker + seg.text;
    })
    .join("\n\n");
}

function bookmarkMarkerInfoOf(el) {
  if (!el) return null;
  const raw = (el.textContent || "").trim();
  const m = raw.match(MARKER_RE);
  if (!m) return null;
  return { id: m[1] === RESET_MARKER_ID ? null : m[1], frontType: m[2] || null };
}

/* Marqueur de rôle d'une page de titre (`FEUILLETS-FPROLE:sous-titre`, voir
   export-render.js) : un paragraphe entier posé juste avant le contenu du
   rôle. Retourne le nom du rôle (minuscule) ou null. */
function titleRoleOf(el) {
  if (!el) return null;
  const raw = (el.textContent || "").trim();
  if (!raw.startsWith(TITLE_ROLE_MARKER)) return null;
  return raw.slice(TITLE_ROLE_MARKER.length).trim().toLowerCase();
}

/* Style d'un rôle depuis le modèle (`titlePage.styles.<rôle>`), ou null si le
   modèle ne définit rien pour ce rôle : la page retombe alors sur la mise en
   forme de base de la page Front (centré, interligne simple). */
function frontRoleStyle(tpl, role) {
  const styles = tpl && tpl.titlePage && tpl.titlePage.styles;
  return (role && styles && styles[role]) || null;
}

/* Marques de texte (taille/gras/italique) à appliquer au contenu d'un bloc
   Front : celles du rôle si un style de modèle existe, sinon la taille de
   titre historique sur la première ligne d'une page de titre libre. La taille
   .docx est en demi-points (fontSizePt * 2, comme FRONT_TITLE_FONT_SIZE = 36
   pour 18pt). */
function frontInlineMarks(frontOverride) {
  if (!frontOverride) return {};
  const st = frontOverride.style;
  if (st) {
    return {
      size: st.fontSizePt != null ? st.fontSizePt * 2 : undefined,
      bold: st.bold,
      italics: st.italic,
    };
  }
  return frontOverride.isTitleLine ? { size: FRONT_TITLE_FONT_SIZE } : {};
}

/* Espacement d'un paragraphe Front : interligne simple de base, complété par
   les marges du rôle (marginTopPt → before, marginBottomPt → after ; twips =
   pt * 20). */
function frontSpacing(frontOverride) {
  const st = frontOverride && frontOverride.style;
  if (!st) return FRONT_PAGE_LINE_SPACING;
  return {
    ...FRONT_PAGE_LINE_SPACING,
    ...(st.marginTopPt != null ? { before: st.marginTopPt * 20 } : {}),
    ...(st.marginBottomPt != null ? { after: st.marginBottomPt * 20 } : {}),
  };
}

/* Alignement d'un paragraphe Front : celui du rôle s'il en impose un, sinon
   le centrage par défaut des pages Front. */
function frontAlignment(frontOverride) {
  const st = frontOverride && frontOverride.style;
  if (st && st.align) return alignmentFor({ align: st.align });
  return AlignmentType.CENTER;
}

function captionParagraphFor(el, images = []) {
  if (!el || el.tagName !== "P") return null;
  const imgEl = el.querySelector("img");
  if (!imgEl) return null;

  const src = imgEl.getAttribute("src") || "";
  const match = images.find((i) => src.includes(i.path) || (i.alt && src.includes(i.alt)));

  const captionText = (match && match.caption ? match.caption : imgEl.getAttribute("alt")) || "";
  if (!captionText) return null;

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 200 },
    children: [new TextRun({ text: captionText, italics: true, size: 18, color: "666666" })],
  });
}

function inlineChildren(el, footnoteIdByHref, images = [], defaultMarks = {}) {
  const runs = [];

  function walk(node, marks) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue;
      if (text) {
        runs.push(
          new TextRun({
            text,
            bold: marks.bold,
            italics: marks.italics,
            color: marks.color,
            size: marks.size,
          })
        );
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      // Saut de ligne DANS le paragraphe (interligne simple), ex. le « / » d'un
      // bloc de page de titre — pas un nouveau paragraphe.
      runs.push(new TextRun({ break: 1 }));
      return;
    }
    const nextMarks = { ...marks };
    if (tag === "strong" || tag === "b") nextMarks.bold = true;
    if (tag === "em" || tag === "i") nextMarks.italics = true;

    if (tag === "img") {
      const src = node.getAttribute("src") || "";
      const match = images.find((i) => src.includes(i.path) || (i.alt && src.includes(i.alt)));
      if (match && match.buffer) {
        try {
          let w = match.width || 400;
          let h = match.height || 300;
          if (w > 500) {
            h = Math.round((h * 500) / w);
            w = 500;
          }
          runs.push(
            new ImageRun({
              data: match.buffer,
              transformation: { width: w, height: h },
            })
          );
        } catch (e) {
          console.warn("Feuillets: échec insertion image docx", e);
        }
      }
      return;
    }

    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (href.startsWith("#fn") || node.classList.contains("footnote-ref")) {
        const idStr = href.replace(/^#fn-?/, "").replace(/^#fnref-?/, "");
        const num = footnoteIdByHref.get(idStr) || footnoteIdByHref.get(href.replace(/^#/, ""));
        if (num != null) {
          runs.push(new FootnoteReferenceRun(num));
          return;
        }
      }
    }

    for (const child of Array.from(node.childNodes)) {
      walk(child, nextMarks);
    }
  }

  for (const child of Array.from(el.childNodes)) {
    walk(child, defaultMarks);
  }
  return runs;
}

const HEADING_MAP = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
};

function alignmentFor(tpl) {
  if (tpl.align === "justify") return AlignmentType.JUSTIFY;
  if (tpl.align === "center") return AlignmentType.CENTER;
  if (tpl.align === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function wordLocale(lang) {
  const l = (lang || "fr").toLowerCase();
  if (l.startsWith("en")) return "en-US";
  if (l.startsWith("de")) return "de-DE";
  if (l.startsWith("es")) return "es-ES";
  if (l.startsWith("it")) return "it-IT";
  return "fr-FR";
}

/* Interligne simple partout sur une page Front — c'est une page composée
   à la main (voir preserveBlankLinesForFrontPage), pas du texte de roman :
   l'interligne du gabarit du manuscrit (souvent 1,5) fausserait l'espacement
   entre les blocs que l'autrice contrôle elle-même ligne vide par ligne
   vide. */
const FRONT_PAGE_LINE_SPACING = { line: 240, lineRule: "auto" };
// 18pt (en demi-points, unité w:sz) pour le titre du roman sur sa propre
// page de titre — seul le tout premier bloc de cette page-là (voir
// isTitleLine dans exportDocx).
const FRONT_TITLE_FONT_SIZE = 36;

/** Marges de page (en cm) au format attendu par `docx` — factorisé pour être
 * réutilisé à l'identique par la section principale du manuscrit et par
 * chacune des sections Front (voir exportDocx) : mêmes marges partout,
 * seul le centrage vertical change d'une section à l'autre. */
function sectionPageMargin(tpl) {
  const margins = marginsFor(tpl);
  return {
    top: `${margins.top}cm`,
    bottom: `${margins.bottom}cm`,
    left: `${margins.left}cm`,
    right: `${margins.right}cm`,
  };
}

/** frontOverride : { isTitleLine } quand le bloc appartient à une page Front
 * spéciale (titre/dédicace/épigraphe, voir bookmarkMarkerInfoOf et son
 * usage dans exportDocx) — centre le texte, retire l'alinéa de paragraphe
 * habituel et impose un interligne simple (une dédicace/épigraphe/page de
 * titre n'a pas la mise en page d'une scène de roman). Chaque page Front
 * devient sa PROPRE SECTION Word, centrée verticalement sur la page
 * (`verticalAlign: CENTER`, voir exportDocx) — plus besoin de compter des
 * lignes vides ou d'ancrer quoi que ce soit à la main, Word centre lui-même
 * le bloc entier quelle que soit sa hauteur. isTitleLine impose la taille
 * de police du titre (FRONT_TITLE_FONT_SIZE) uniquement sur le tout premier
 * bloc d'une page de titre. */
function blockToParagraphs(el, footnoteIdByHref, tpl, headings = {}, images = [], frontOverride = null) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return [];
  const tag = el.tagName;

  if (["H1", "H2", "H3", "H4"].includes(tag)) {
    const levelKey = tag.toLowerCase();
    const h = headings[levelKey];
    const hasHeadingsConfig = Object.keys(headings).length > 0;
    const pageBreak = h ? !!h.pageBreakBefore : hasHeadingsConfig ? false : (tag === "H1" || tag === "H2");
    return [
      new Paragraph({
        heading: HEADING_MAP[tag],
        pageBreakBefore: frontOverride ? false : pageBreak,
        alignment: frontOverride ? frontAlignment(frontOverride) : undefined,
        spacing: frontOverride ? frontSpacing(frontOverride) : undefined,
        children: inlineChildren(
          el,
          footnoteIdByHref,
          images,
          frontOverride ? frontInlineMarks(frontOverride) : {}
        ),
      }),
    ];
  }
  if (tag === "P") {
    const paragraphs = [
      new Paragraph({
        alignment: frontOverride ? frontAlignment(frontOverride) : alignmentFor(tpl),
        indent: frontOverride
          ? undefined
          : tpl.indent
          ? { firstLine: tpl.indentPt ? `${tpl.indentPt}pt` : "1.25cm" }
          : undefined,
        spacing: frontOverride
          ? frontSpacing(frontOverride)
          : tpl.paragraphSpacing
          ? { after: 200 }
          : tpl.paragraphSpacingPt
          ? { before: tpl.paragraphSpacingPt * 20 }
          : undefined,
        children: inlineChildren(
          el,
          footnoteIdByHref,
          images,
          frontOverride ? frontInlineMarks(frontOverride) : {}
        ),
      }),
    ];
    const captionPara = captionParagraphFor(el, images);
    if (captionPara) paragraphs.push(captionPara);
    return paragraphs;
  }
  if (tag === "BLOCKQUOTE") {
    const marks = tpl.blockquote
      ? { italics: tpl.blockquote.italic, color: tpl.blockquote.colorHex?.replace("#", "") }
      : {};
    return Array.from(el.children).flatMap((child) => [
      new Paragraph({
        indent: frontOverride ? undefined : { left: "1cm" },
        alignment: frontOverride ? AlignmentType.CENTER : undefined,
        spacing: frontOverride ? FRONT_PAGE_LINE_SPACING : undefined,
        children: inlineChildren(child, footnoteIdByHref, images, marks),
      }),
    ]);
  }
  if (tag === "UL" || tag === "OL") {
    return Array.from(el.children).map((li, i) => {
      const prefix = tag === "UL" ? "• " : `${i + 1}. `;
      return new Paragraph({
        spacing: frontOverride ? FRONT_PAGE_LINE_SPACING : undefined,
        alignment: frontOverride ? AlignmentType.CENTER : undefined,
        children: [new TextRun(prefix), ...inlineChildren(li, footnoteIdByHref, images)],
      });
    });
  }
  if (tag === "HR") {
    return [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(tpl.sceneDivider || "* * *")] })];
  }
  if (tag === "PRE" || tag === "CODE") {
    return [new Paragraph({ children: [new TextRun({ text: el.textContent || "", font: "Courier New" })] })];
  }
  return Array.from(el.children).flatMap((child) => blockToParagraphs(child, footnoteIdByHref, tpl, headings, images, frontOverride));
}

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
