import JSZip from "jszip";
import type { App } from "obsidian";
import { renderManuscriptHtmlWithFrontPages } from "./export-render.js";
import { escapeXml } from "../utils/xml.js";

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
      .map((child, i) => domToOdtContent(child, { frontStyle: i === 0 ? "FrontPageFirst" : "FrontPage" }))
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
    return `<text:p text:style-name="Horizontal_20_Line"/>`;
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
  const { containerEl, footnotes } = await renderManuscriptHtmlWithFrontPages(app, markdown, segments, sourcePath);

  const bodyXml =
    Array.from(containerEl.childNodes).map((node) => domToOdtContent(node)).join("\n") +
    footnotesEndSectionXml(footnotes);
  /* Pas de page de titre générique si l'autrice a déjà composé sa propre
     page Front de type "titre" — voir même choix dans export-docx.js. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));

  const headerText = (settings.pdfHeaderLeft || "{title}")
    .replace(/\{title\}/gi, title)
    .replace(/\{author\}/gi, author);
  const footerText = (settings.pdfFooterRight || "Page {page} sur {pages}")
    .replace(/\{title\}/gi, title)
    .replace(/\{author\}/gi, author);

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
      <style:paragraph-properties fo:line-height="150%" fo:margin-top="0cm" fo:margin-bottom="0.2cm"/>
      <style:text-properties fo:font-name="Times New Roman" fo:font-size="12pt" fo:color="#000000"/>
    </style:default-style>
  </office:styles>
  <office:automatic-styles>
    <style:page-layout style:name="pm1">
      <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2.5cm" fo:margin-bottom="2.5cm" fo:margin-left="2.5cm" fo:margin-right="2.5cm"/>
    </style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="pm1">
      <style:header>
        <text:p text:style-name="Header">${escapeXml(headerText)}</text:p>
      </style:header>
      <style:footer>
        <text:p text:style-name="Footer">${escapeXml(footerText)
          .replace(/\{page\}/g, '<text:page-number/>')
          .replace(/\{pages\}/g, '<text:page-count/>')}</text:p>
      </style:footer>
    </style:master-page>
  </office:master-styles>
</office:document-styles>`;

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
  <office:font-face-decls>
    <style:font-face style:name="Times New Roman" svg:font-family="'Times New Roman'"/>
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
      <style:text-properties fo:font-size="24pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Subtitle" style:family="paragraph">
      <style:paragraph-properties fo:text-align="center" fo:margin-bottom="2cm"/>
      <style:text-properties fo:font-size="14pt" fo:font-style="italic"/>
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
