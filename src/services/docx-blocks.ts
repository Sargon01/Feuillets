// @ts-check
/** Conversion du DOM rendu (sortie de export-render.js) en paragraphes `docx`.
 * C'est le cœur du moteur .docx : ce qui décide qu'un `<p>` devient un
 * paragraphe justifié avec alinéa, qu'un `<h2>` démarre une page, qu'un
 * `<blockquote>` est indenté et en italique.
 *
 * Séparé de services/export-docx.js, qui charge export-render.js et donc
 * Obsidian : ici rien de tel, les nœuds arrivent en paramètre. Le module est
 * ainsi importable et testable sous Node avec de simples objets littéraux
 * imitant l'interface DOM réellement utilisée — `nodeType`, `tagName`,
 * `nodeValue`, `childNodes`, `children`, `textContent`, `getAttribute`,
 * `classList.contains`, `querySelector`.
 *
 * @typedef {{ bytes?: Uint8Array, ext?: string, width?: number, height?: number,
 *             caption?: string }} ExportImage
 *   Une image déjà extraite du coffre par inlineImages (export-render.js).
 * @typedef {Map<any, ExportImage>} ExportImages
 *   Indexée par le nœud `<img>` lui-même — c'est export-render.js qui la
 *   construit ainsi, en remplaçant au passage le `src` par un data: URI.
 * @typedef {{ bold?: boolean, italics?: boolean, color?: string, size?: number, font?: string }} InlineMarks
 */

import {
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  FootnoteReferenceRun,
  BorderStyle,
} from "docx";
import {
  FRONT_PAGE_LINE_SPACING,
  alignmentFor,
  frontInlineMarks,
  frontSpacing,
  frontAlignment,
} from "./export-docx-style.js";

type ExportImage = {
  bytes?: Uint8Array;
  ext?: string;
  width?: number;
  height?: number;
  caption?: string;
};

type ExportImages = Map<unknown, ExportImage>;

type InlineMarks = {
  bold?: boolean;
  italics?: boolean;
  color?: string;
  size?: number;
  font?: string;
};

type ExportDomNode = {
  nodeType: number;
  nodeValue?: string | null;
};

type ExportDomElement = ExportDomNode & {
  tagName: string;
  childNodes: ArrayLike<ExportDomNode | ExportDomElement>;
  children: ArrayLike<ExportDomElement>;
  textContent?: string | null;
  getAttribute(name: string): string | null;
  classList: { contains(name: string): boolean };
  querySelector(selector: string): ExportDomElement | null;
};

/* Valeurs figées par la spécification DOM. En dur plutôt que via la globale
   `Node`, qui n'existe pas sous Node.js : sans ça, tout ce module reste
   intestable, alors qu'il ne dépend de rien d'autre. */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function isExportDomElement(node: ExportDomNode | ExportDomElement): node is ExportDomElement {
  return node.nodeType === ELEMENT_NODE;
}

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

/* Largeur maximale d'une image dans la page, en points docx. Au-delà, l'image
   est réduite en conservant son rapport hauteur/largeur. */
const MAX_IMAGE_WIDTH = 500;

/* Formats que `docx` sait empaqueter. Le `type` est OBLIGATOIRE : sans lui, la
   bibliothèque écrit la ressource sous `word/media/<hash>.undefined`, que Word
   n'ouvre pas — l'image est alors silencieusement absente du manuscrit livré.
   Un format hors de cette liste (webp, avif…) est ignoré plutôt qu'empaqueté
   sous une extension fausse : mieux vaut une image manquante et un
   avertissement en console qu'un .docx corrompu. `svg` en est exclu aussi,
   `docx` exigeant pour lui une image de repli qu'on n'a pas ici. */
const DOCX_IMAGE_TYPES: Record<string, "jpg" | "png" | "gif" | "bmp"> = { jpg: "jpg", jpeg: "jpg", png: "png", gif: "gif", bmp: "bmp" };

/** @param {string|undefined} ext @returns {"jpg"|"png"|"gif"|"bmp"|null} */
function docxImageType(ext: string | undefined): "jpg" | "png" | "gif" | "bmp" | null {
  return DOCX_IMAGE_TYPES[String(ext || "").toLowerCase()] || null;
}

/**
 * Légende d'une image, si le paragraphe en contient une et qu'un texte de
 * légende est disponible (`caption` de l'image, sinon son attribut `alt`).
 * @param {any} el
 * @param {ExportImages} [images]
 * @returns {any|null} `null` si le paragraphe n'a pas d'image, ou pas de texte.
 */
export function captionParagraphFor(el: ExportDomElement, images: ExportImages = new Map()) {
  if (!el || el.tagName !== "P") return null;
  const imgEl = el.querySelector("img");
  if (!imgEl) return null;

  const match = images.get(imgEl);
  const captionText = (match && match.caption ? match.caption : imgEl.getAttribute("alt")) || "";
  if (!captionText) return null;

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 200 },
    children: [new TextRun({ text: captionText, italics: true, size: 18, color: "666666" })],
  });
}

/**
 * Contenu inline d'un bloc, à plat : les marques (gras, italique, couleur,
 * taille) s'accumulent en descendant l'arbre, les notes de bas de page et les
 * images deviennent leurs runs dédiés.
 * @param {any} el
 * @param {Map<string, number>} footnoteIdByHref
 * @param {ExportImages} [images]
 * @param {InlineMarks} [defaultMarks] marques héritées du contexte (page Front).
 * @param {boolean} [normalizeAfterBreak] nettoie les blancs techniques des vers de citation.
 * @returns {any[]}
 */
export function inlineChildren(el: ExportDomElement, footnoteIdByHref: Map<string, number>, images: ExportImages = new Map(), defaultMarks: InlineMarks = {}, normalizeAfterBreak = false) {
  const runs: Array<TextRun | ImageRun | FootnoteReferenceRun> = [];
  let afterBreak = false;

  /**
   * @param {any} node
   * @param {InlineMarks} marks
   */
  function walk(node: ExportDomNode | ExportDomElement, marks: InlineMarks) {
    if (node.nodeType === TEXT_NODE) {
      const text = node.nodeValue;
      // MarkdownRenderer intercale parfois un nœud "\n" purement décoratif
      // après <br>. Dans Word, ce nœud devient un espace au début du vers.
      // On ne l'ignore qu'à cet endroit précis : les espaces inline restent
      // donc bien du contenu réel.
      if (afterBreak && !text?.trim()) return;
      const visibleText = afterBreak ? text?.replace(/^\s+/, "") : text;
      if (visibleText) {
        runs.push(
          new TextRun({
            text: visibleText,
            bold: marks.bold,
            italics: marks.italics,
            color: marks.color,
            size: marks.size,
            font: marks.font,
          })
        );
        if (afterBreak) afterBreak = false;
      }
      return;
    }
    if (!isExportDomElement(node)) return;

    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      // Saut de ligne DANS le paragraphe (interligne simple), ex. le « / » d'un
      // bloc de page de titre — pas un nouveau paragraphe.
      runs.push(new TextRun({ break: 1 }));
      afterBreak = normalizeAfterBreak;
      return;
    }
    const nextMarks = { ...marks };
    if (tag === "strong" || tag === "b") nextMarks.bold = true;
    if (tag === "em" || tag === "i") nextMarks.italics = true;

    if (tag === "img") {
      /* Recherche par le nœud lui-même : c'est la clé de la Map construite
         par inlineImages (export-render.js). L'ancienne version cherchait
         `images.find(i => src.includes(i.path))` — une API de tableau sur une
         Map, donc un TypeError qui faisait échouer tout export .docx d'un
         manuscrit contenant ne serait-ce qu'une image. */
      const match = images.get(node);
      if (match && match.bytes) {
        const type = docxImageType(match.ext);
        if (!type) {
          console.warn(`Feuillets: format d'image non exportable en .docx (${match.ext}) — image ignorée`);
          return;
        }
        try {
          let w = match.width || 400;
          let h = match.height || 300;
          if (w > MAX_IMAGE_WIDTH) {
            h = Math.round((h * MAX_IMAGE_WIDTH) / w);
            w = MAX_IMAGE_WIDTH;
          }
          runs.push(
            new ImageRun({
              type,
              data: match.bytes,
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

    for (let index = 0; index < node.childNodes.length; index++) {
      walk(node.childNodes[index], nextMarks);
    }
  }

  for (let index = 0; index < el.childNodes.length; index++) {
    walk(el.childNodes[index], defaultMarks);
  }
  return runs;
}

/**
 * Un bloc du DOM rendu → les paragraphes `docx` correspondants. Un élément
 * inconnu n'est pas perdu : ses enfants sont traités récursivement.
 *
 * `frontOverride` marque un bloc appartenant à une page Front spéciale
 * (titre/dédicace/épigraphe) : le texte est centré, l'alinéa de paragraphe
 * retiré et l'interligne ramené à simple — une dédicace n'a pas la mise en
 * page d'une scène de roman. Chaque page Front devient sa propre section Word,
 * centrée verticalement (voir exportDocx), donc rien n'est à compter ni à
 * ancrer à la main ici. `isTitleLine` impose la taille de titre au seul
 * premier bloc d'une page de titre sans style de rôle défini.
 *
 * @param {any} el
 * @param {Map<string, number>} footnoteIdByHref
 * @param {ExportTemplate} tpl
 * @param {{ h1?: HeadingStyle, h2?: HeadingStyle, h3?: HeadingStyle }} [headings]
 * @param {ExportImages} [images]
 * @param {{ style?: TitlePageStyle|null, isTitleLine?: boolean }|null} [frontOverride]
 * @returns {any[]}
 */
export function blockToParagraphs(
  el: ExportDomElement,
  footnoteIdByHref: Map<string, number>,
  tpl: ExportTemplate,
  headings: { h1?: HeadingStyle; h2?: HeadingStyle; h3?: HeadingStyle } = {},
  images: ExportImages = new Map(),
  frontOverride: { style?: TitlePageStyle | null; isTitleLine?: boolean; manualPageBreak?: boolean } | null = null,
): Paragraph[] {
  if (!el || el.nodeType !== ELEMENT_NODE) return [];
  const tag = el.tagName;

  if (["H1", "H2", "H3", "H4", "H5", "H6"].includes(tag)) {
    const levelKey = tag.toLowerCase();
    const h = (headings as Record<string, HeadingStyle | undefined>)[levelKey];
    const hasHeadingsConfig = Object.keys(headings).length > 0;
    /* Repli historique quand le modèle ne configure aucun niveau de titre :
       H1 et H2 démarrent une page, H3/H4 non. Dès qu'un modèle définit
       `headings`, c'est lui qui décide entièrement — un niveau qu'il ne
       mentionne pas ne prend donc PAS le repli, sinon un modèle réglant
       seulement h2 hériterait d'un saut de page surprise sur h1. */
    const pageBreak = h ? !!h.pageBreakBefore : hasHeadingsConfig ? false : (tag === "H1" || tag === "H2");
    return [
      new Paragraph({
        heading: HEADING_MAP[tag],
        pageBreakBefore: !!frontOverride?.manualPageBreak || (frontOverride ? false : pageBreak),
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
        pageBreakBefore: !!frontOverride?.manualPageBreak,
        alignment: frontOverride ? frontAlignment(frontOverride) : alignmentFor(tpl),
        indent: frontOverride
          ? frontOverride.style && (frontOverride.style.marginLeftPt != null || frontOverride.style.marginRightPt != null)
            ? { left: frontOverride.style.marginLeftPt != null ? `${frontOverride.style.marginLeftPt}pt` : undefined, right: frontOverride.style.marginRightPt != null ? `${frontOverride.style.marginRightPt}pt` : undefined }
            : undefined
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
    const quote = tpl.blockquote;
    const children = Array.from(el.children);
    return children.flatMap((child, index) => [
      new Paragraph({
        pageBreakBefore: index === 0 && !!frontOverride?.manualPageBreak,
        style: "FeuilletsCitation",
        alignment: frontOverride ? AlignmentType.CENTER : undefined,
        spacing: frontOverride ? FRONT_PAGE_LINE_SPACING : quote && (quote.marginTopPt != null || quote.marginBottomPt != null)
          ? {
            ...(index === 0 && quote.marginTopPt != null ? { before: quote.marginTopPt * 20 } : {}),
            ...(index === children.length - 1 && quote.marginBottomPt != null ? { after: quote.marginBottomPt * 20 } : {}),
          }
          : undefined,
        border: tpl.profile === "document" ? {
          left: { style: BorderStyle.SINGLE, size: 6, color: "A0A0A0" },
          right: { style: BorderStyle.SINGLE, size: 6, color: "A0A0A0" },
          ...(index === 0 ? { top: { style: BorderStyle.SINGLE, size: 6, color: "A0A0A0" } } : {}),
          ...(index === children.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: "A0A0A0" } } : {}),
        } : undefined,
        children: inlineChildren(child, footnoteIdByHref, images, {}, true),
      }),
    ]);
  }
  if (tag === "UL" || tag === "OL") {
    return Array.from(el.children).map((li, i) => {
      const prefix = tag === "UL" ? "• " : `${i + 1}. `;
      return new Paragraph({
        pageBreakBefore: i === 0 && !!frontOverride?.manualPageBreak,
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
