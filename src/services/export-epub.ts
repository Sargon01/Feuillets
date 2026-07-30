import JSZip from "jszip";
import type { App } from "obsidian";
import { renderManuscriptHtmlWithFrontPages, FRONT_PAGE_CSS } from "./export-render.js";
import { templateToCss } from "../utils/export-templates.js";
import { resolveExportTemplate } from "./export-templates-custom.js";
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

type ExportFootnote = {
  id: string;
  html: string;
};

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // repli si crypto.randomUUID indisponible (anciens moteurs mobiles)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Sérialise un nœud DOM en XML bien formé (balises auto-fermantes pour
 * les éléments vides — <br/>, <img/>… — comme l'exige le XHTML de l'EPUB).
 * Plus sûr qu'une concaténation de innerHTML : XMLSerializer travaille
 * sur l'arbre DOM réel, pas sur du texte. */
function serializeXhtmlBody(containerEl: HTMLElement): string {
  const serializer = new XMLSerializer();
  let out = "";
  for (const child of Array.from(containerEl.childNodes)) {
    out += serializer.serializeToString(child);
  }
  return out;
}

function footnotesXhtml(footnotes: ExportFootnote[]): string {
  if (!footnotes || footnotes.length === 0) return "";
  const items = footnotes
    .map((f) => `<li id="${escapeXml(f.id)}">${f.html}</li>`)
    .join("\n");
  return `<section epub:type="footnotes"><hr/><ol>${items}</ol></section>`;
}

/** Génère un EPUB valide minimal à partir d'un manuscrit déjà compilé
 * (markdown, sortie de compile()) : un seul flux XHTML continu, pas de
 * découpage par chapitre en v1 (portée assumée — voir plan). Utilise
 * jszip (pur JS, aucune dépendance Node) : fonctionne desktop et mobile. */
export async function exportEpub(app: App, settings: FeuilletsSettings, { markdown, title, author, sourcePath, segments }: ExportInput): Promise<Uint8Array> {
  const tpl = await resolveExportTemplate(app, settings, settings.exportTemplate);
  const { containerEl, footnotes } = await renderManuscriptHtmlWithFrontPages(app, markdown, segments, sourcePath);
  const bodyXhtml = serializeXhtmlBody(containerEl);
  const css = templateToCss(tpl) + FRONT_PAGE_CSS;
  const lang = settings.epubLanguage || "fr";
  /* Pas de page de titre générique si l'autrice a déjà composé sa propre
     page Front de type "titre" — voir même choix dans export-docx.js. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));
  const bookId = `urn:uuid:${uuid()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    ${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ""}
    <dc:language>${escapeXml(lang)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapitres" href="chapitres.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapitres"/>
  </spine>
</package>`
  );

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}">
<head><title>Navigation</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>${escapeXml(title)}</h1>
<ol><li><a href="chapitres.xhtml">${escapeXml(title)}</a></li></ol>
</nav>
</body>
</html>`
  );

  zip.file(
    "OEBPS/chapitres.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}">
<head>
  <title>${escapeXml(title)}</title>
  <style type="text/css">${css}</style>
</head>
<body>
${hasAuthoredTitlePage ? "" : `<h1>${escapeXml(title)}</h1>\n${author ? `<p class="author">${escapeXml(author)}</p>` : ""}`}
${bodyXhtml}
${footnotesXhtml(footnotes)}
</body>
</html>`
  );

  return zip.generateAsync({ type: "uint8array" });
}
