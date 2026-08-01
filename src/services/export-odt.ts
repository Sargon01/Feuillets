import JSZip from "jszip";
import type { App } from "obsidian";
import { renderManuscriptHtmlWithFrontPages } from "./export-render.js";
import { resolveExportTemplate } from "./export-templates-custom.js";
import { marginsFor, normalizeHeadings } from "../utils/export-templates.js";
import { escapeXml } from "../utils/xml.js";

/** Premier nom de la liste `fontFamily` CSS du modèle (ex. "'Times New
 * Roman', Times, serif" -> "Times New Roman") : ODF ne connaît pas les
 * listes de repli, un seul `fo:font-name` par style. */
function primaryFontName(fontFamily: string): string {
  return (fontFamily.split(",")[0] || "").trim().replace(/^['"]|['"]$/g, "") || "Times New Roman";
}

/** Style de titre de niveau h1/h2/h3 dérivé du modèle (voir
 * normalizeHeadings, export-templates.js) — reprend les mêmes valeurs que
 * PDF/EPUB/DOCX (taille, graisse, italique, alignement, marges, saut de
 * page), avec un repli sensé (18/15/13pt, gras) quand le modèle ne définit
 * aucun style de titre pour ce niveau (ex. "Classique (manuscrit)" pour h1). */
function headingStyleXml(name: string, h: HeadingStyle | undefined, fallbackPt: number): string {
  const fontSizePt = h?.fontSizePt ?? fallbackPt;
  const bold = h?.bold !== false;
  const align = h?.align || "left";
  const props = [`fo:text-align="${align}"`];
  if (h?.pageBreakBefore) props.push('fo:break-before="page"');
  if (h?.marginTopPt != null) props.push(`fo:margin-top="${h.marginTopPt}pt"`);
  if (h?.marginBottomPt != null) props.push(`fo:margin-bottom="${h.marginBottomPt}pt"`);
  return `<style:style style:name="${name}" style:family="paragraph">
      <style:paragraph-properties ${props.join(" ")}/>
      <style:text-properties fo:font-size="${fontSizePt}pt" fo:font-weight="${bold ? "bold" : "normal"}" fo:font-style="${h?.italic ? "italic" : "normal"}"/>
    </style:style>`;
}

type ExportSegment = {
  text: string;
  frontType?: string;
};

type ExportInput = {
  markdown: string;
  title: string;
  author: string;
  sourcePath: string;
  segments?: ExportSegment[];
};

type OdtOptions = {
  frontStyle?: string;
  sceneDivider?: string;
};

type RenderedFootnote = {
  id: string;
  html: string;
  text: string;
};

/** opts.frontStyle : nom du style de paragraphe à utiliser pour un <p>/
 * <blockquote> à l'intérieur d'une page Front (titre/dédicace/épigraphe,
 * voir export-render.js) — "FrontPageFirst" pour le tout premier bloc de la
 * page (celui qui porte le saut de page, fo:break-before="page" défini dans
 * les styles automatiques plus bas), "FrontPage" pour les suivants (centrés,
 * mais sans resaut de page). undefined en dehors d'une page Front. */
function domToOdtContent(node: Node, opts: OdtOptions = {}): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeXml(node.textContent);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (tag === "div" && element.classList && element.classList.contains("feuillets-frontpage")) {
    return Array.from(element.children)
      .map((child, i) => domToOdtContent(child, { frontStyle: i === 0 ? "FrontPageFirst" : "FrontPage", sceneDivider: opts.sceneDivider }))
      .join("\n");
  }

  const childrenXml = Array.from(element.childNodes).map((n) => domToOdtContent(n, opts)).join("");

  if (tag === "strong" || tag === "b") {
    return `<text:span text:style-name="Bold">${childrenXml}</text:span>`;
  }
  if (tag === "em" || tag === "i") {
    return `<text:span text:style-name="Italic">${childrenXml}</text:span>`;
  }
  if (tag === "code") {
    return `<text:span text:style-name="Source_20_Text">${childrenXml}</text:span>`;
  }
  if (tag === "a") {
    const href = element.getAttribute("href") || "#";
    return `<text:a xlink:type="simple" xlink:href="${escapeXml(href)}">${childrenXml}</text:a>`;
  }
  if (tag === "h1") {
    return `<text:h text:style-name="Heading_20_1" text:outline-level="1">${childrenXml}</text:h>`;
  }
  if (tag === "h2") {
    return `<text:h text:style-name="Heading_20_2" text:outline-level="2">${childrenXml}</text:h>`;
  }
  if (tag === "h3") {
    return `<text:h text:style-name="Heading_20_3" text:outline-level="3">${childrenXml}</text:h>`;
  }
  if (tag === "p") {
    return `<text:p text:style-name="${opts.frontStyle || "Standard"}">${childrenXml}</text:p>`;
  }
  if (tag === "blockquote") {
    return `<text:p text:style-name="${opts.frontStyle || "Quotations"}">${childrenXml}</text:p>`;
  }
  if (tag === "li") {
    return `<text:list-item><text:p text:style-name="P1">${childrenXml}</text:p></text:list-item>`;
  }
  if (tag === "ul" || tag === "ol") {
    return `<text:list xml:id="list1" text:style-name="L1">${childrenXml}</text:list>`;
  }
  if (tag === "hr") {
    return `<text:p text:style-name="Horizontal_20_Line">${escapeXml(opts.sceneDivider || "* * *")}</text:p>`;
  }

  return childrenXml;
}

/** Notes de bas de page en ODT : ce générateur XML minimal ne construit pas
 * de véritable structure `<text:note>` OpenDocument (contrairement à
 * export-docx.js, qui s'appuie sur la bibliothèque `docx` pour de vraies
 * notes Word) — une note réelle demanderait d'apparier citation et corps de
 * note exactement là où l'appel apparaît dans le flux, ce que ce
 * convertisseur DOM->XML linéaire ne fait pas. Plutôt que de perdre le
 * contenu silencieusement (comportement précédent : `footnotes` n'était
 * jamais lu) ou de le confondre avec le corps du texte, les notes sont
 * ajoutées en NOTES DE FIN clairement identifiées sous un titre "Notes".
 *
 * Texte brut (`fn.text`), pas `fn.html` : réinjecter du HTML dans ce
 * document demanderait de le reconvertir en balisage `text:*` OpenDocument
 * via `domToOdtContent`, donc de le reparser d'abord — une mise en forme
 * (gras, italique, lien) au sein d'une note ne survit donc pas dans cet
 * export ODT, seul le texte. Limite documentée dans FONCTIONNALITES.md. */
function footnotesEndSectionXml(footnotes: RenderedFootnote[]): string {
  if (!footnotes.length) return "";
  const items = footnotes
    .map((fn, i) => `<text:p text:style-name="Standard">${i + 1}. ${escapeXml(fn.text)}</text:p>`)
    .join("\n");
  return `\n<text:h text:style-name="Heading_20_2" text:outline-level="2">Notes</text:h>\n${items}`;
}

/** Export ODT (OpenDocument Text pour LibreOffice / OpenOffice) natif sans conversion intermédiaire. */
export async function exportOdt(app: App, settings: FeuilletsSettings, { markdown, title, author, sourcePath, segments }: ExportInput): Promise<Uint8Array> {
  const tpl = await resolveExportTemplate(app, settings, settings.exportTemplate);
  const { containerEl, footnotes } = await renderManuscriptHtmlWithFrontPages(app, markdown, segments, sourcePath);

  const fontName = primaryFontName(tpl.fontFamily);
  const m = marginsFor(tpl);
  const headings = normalizeHeadings(tpl);
  const bodyAlign = tpl.align || "justify";
  const indentRule = tpl.indent ? `fo:text-indent="${tpl.indentPt ? `${tpl.indentPt}pt` : "1.25cm"}"` : 'fo:text-indent="0cm"';
  const paragraphSpacingRule = tpl.paragraphSpacing
    ? `fo:margin-top="0cm" fo:margin-bottom="0.3cm"`
    : tpl.paragraphSpacingPt
      ? `fo:margin-top="${tpl.paragraphSpacingPt}pt" fo:margin-bottom="0cm"`
      : `fo:margin-top="0cm" fo:margin-bottom="0cm"`;
  const blockquoteItalic = tpl.blockquote?.italic !== false;
  const blockquoteColor = tpl.blockquote?.colorHex || "#000000";

  const sceneDividerOpts: OdtOptions = { sceneDivider: tpl.sceneDivider };
  const bodyXml =
    Array.from(containerEl.childNodes).map((node) => domToOdtContent(node, sceneDividerOpts)).join("\n") +
    footnotesEndSectionXml(footnotes);
  /* Pas de page de titre générique si l'autrice a déjà composé sa propre
     page Front de type "titre" — voir même choix dans export-docx.js. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));

  const bandText = (value: string): string => value
    .replace(/\{title\}/gi, title)
    .replace(/\{author\}/gi, author);
  const headerParts = [settings.pdfHeaderLeft || "{title}", settings.pdfHeaderCenter || "", settings.pdfHeaderRight || "{author}"]
    .map(bandText);
  const footerParts = [settings.pdfFooterLeft || "", settings.pdfFooterCenter || "", settings.pdfFooterRight || "Page {page} sur {pages}"]
    .map(bandText);
  const odtBand = (parts: string[]): string => parts.map((part) => escapeXml(part)).join("<text:tab/>")
    .replace(/\{page\}/gi, '<text:page-number/>')
    .replace(/\{pages\}/gi, '<text:page-count/>')
    .replace(/\{part\}/gi, '<text:chapter text:display="name"/>')
    .replace(/\{chapter\}/gi, '<text:chapter text:display="name"/>');

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">
  <office:meta>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
  </office:meta>
</office:document-meta>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
  <office:styles>
    <style:default-style style:family="paragraph">
      <style:paragraph-properties fo:line-height="${Math.round(tpl.lineHeight * 100)}%" ${indentRule} ${paragraphSpacingRule} fo:text-align="${bodyAlign}"/>
      <style:text-properties fo:font-name="${fontName}" fo:font-size="${tpl.fontSizePt}pt" fo:color="#000000"/>
    </style:default-style>
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="pm1">
      <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="${m.top}cm" fo:margin-bottom="${m.bottom}cm" fo:margin-left="${m.left}cm" fo:margin-right="${m.right}cm"/>
    </style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="pm1">
      ${settings.pdfEnableHeaders === false ? "" : `<style:header>
        <text:p text:style-name="Header">${odtBand(headerParts)}</text:p>
      </style:header>`}
      ${settings.pdfEnableFooters === false ? "" : `<style:footer>
        <text:p text:style-name="Footer">${odtBand(footerParts)}</text:p>
      </style:footer>`}
    </style:master-page>
  </office:master-styles>
</office:document-styles>`;

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
  <office:font-face-decls>
    <style:font-face style:name="${fontName}" svg:font-family="'${fontName}'"/>
  </office:font-face-decls>
  <office:automatic-styles>
    <style:style style:name="Bold" style:family="text">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Italic" style:family="text">
      <style:text-properties fo:font-style="italic"/>
    </style:style>
    <style:style style:name="Title" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" fo:margin-bottom="1cm"/>
      <style:text-properties fo:font-size="${Math.round(tpl.fontSizePt * 2)}pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Subtitle" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" fo:margin-bottom="2cm"/>
      <style:text-properties fo:font-size="${Math.round(tpl.fontSizePt * 1.2)}pt" fo:font-style="italic"/>
    </style:style>
    <!-- Titres (h1/h2/h3) dérivés du même modèle que PDF/EPUB/DOCX (voir
         normalizeHeadings, export-templates.js) — reprennent taille,
         graisse, italique, alignement, marges et saut de page. -->
    ${headingStyleXml("Heading_20_1", headings.h1, 20)}
    ${headingStyleXml("Heading_20_2", headings.h2, 16)}
    ${headingStyleXml("Heading_20_3", headings.h3, 13)}
    <style:style style:name="Quotations" style:family="paragraph">
      <style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm"/>
      <style:text-properties fo:font-style="${blockquoteItalic ? "italic" : "normal"}" fo:color="${blockquoteColor}"/>
    </style:style>
    <style:style style:name="Horizontal_20_Line" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" fo:margin-top="0.5cm" fo:margin-bottom="0.5cm"/>
    </style:style>
    <!-- Pages Front (titre/dédicace/épigraphe, voir export-render.js) :
         FrontPageFirst porte le saut de page (fo:break-before), FrontPage
         (les blocs suivants du même feuillet) reste centré sans resauter
         de page. -->
    <style:style style:name="FrontPageFirst" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" fo:break-before="page" fo:margin-top="4cm"/>
    </style:style>
    <style:style style:name="FrontPage" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      ${hasAuthoredTitlePage ? "" : `<text:p text:style-name="Title">${escapeXml(title)}</text:p>\n${author ? `<text:p text:style-name="Subtitle">${escapeXml(author)}</text:p>` : ""}`}
      ${bodyXml}
    </office:text>
  </office:body>
</office:document-content>`;

  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
  zip.file("META-INF/manifest.xml", manifestXml);
  zip.file("meta.xml", metaXml);
  zip.file("styles.xml", stylesXml);
  zip.file("content.xml", contentXml);

  return await zip.generateAsync({ type: "uint8array" });
}
