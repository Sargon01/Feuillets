import { Notice, Platform } from "obsidian";
import type { App } from "obsidian";
import { renderManuscriptHtmlWithFrontPages, FRONT_PAGE_CSS } from "./export-render.js";
import { templateToCss, titleRoleCss } from "../utils/export-templates.js";
import { resolveExportTemplate } from "./export-templates-custom.js";

type PdfFootnote = {
  id: string;
  html: string;
};

type PdfExportSegment = {
  text: string;
  frontType?: string | null;
};

type PdfExportInput = {
  markdown: string;
  title: string;
  author: string;
  sourcePath: string;
  segments?: PdfExportSegment[];
};

type PaginationResult = {
  pagesHtml: string;
  totalPages: number;
};

type PdfPageSize = string;
type PdfOrientation = string;
type PdfPageNumberPosition = "left" | "center" | "right";

function isPageElement(node: Node): node is Element {
  return "outerHTML" in node && "classList" in node;
}

function measuredHeight(node: Element): number {
  return "offsetHeight" in node && typeof node.offsetHeight === "number" ? node.offsetHeight || 30 : 30;
}

function isPrintableIframe(iframe: HTMLIFrameElement): iframe is HTMLIFrameElement & { contentDocument: Document; contentWindow: Window } {
  return iframe.contentDocument !== null && iframe.contentWindow !== null;
}

/** Pagine le contenu HTML en boîtes de pages réelles (.pdf-page) pour l'impression PDF et l'aperçu WYSIWYG.
 * Gère les en-têtes et pieds de page différenciés (paires/impaires), les sauts de page sur titres (H1/H2),
 * la position des numéros de page (droite, centré, gauche) et la couleur adoucie des en-têtes (#aaaaaa). */
export function paginateManuscript(
  containerEl: HTMLElement,
  footnotes: PdfFootnote[] | null | undefined,
  settings: FeuilletsSettings,
  tpl: ResolvedExportTemplate,
  title = "",
  author = ""
): PaginationResult {
  const pageSize: PdfPageSize = settings.pdfPageSize || "A4";
  const orientation: PdfOrientation = settings.pdfOrientation || tpl.pageOrientation || "portrait";
  const mTop = settings.pdfMarginTop ?? 2.5;
  const mBottom = settings.pdfMarginBottom ?? 2.5;
  const mLeft = settings.pdfMarginLeft ?? 2.5;
  const mRight = settings.pdfMarginRight ?? 2.5;

  const mirror = !!settings.pdfMirrorMargins;
  const diffHeaders = !!settings.pdfDiffHeaders;
  const hideFirst = settings.pdfHideFirstPageHeader ?? true;
  const pageNumPos: PdfPageNumberPosition = settings.pdfPageNumberPosition || "right"; // "right" | "center" | "left"

  // Dimensions de la page (A4 = 210x297mm)
  const isLandscape = orientation === "landscape";
  const pageWmm = pageSize === "A5" ? (isLandscape ? 210 : 148) : pageSize === "letter" ? (isLandscape ? 279 : 216) : (isLandscape ? 297 : 210);
  const pageHmm = pageSize === "A5" ? (isLandscape ? 148 : 210) : pageSize === "letter" ? (isLandscape ? 216 : 279) : (isLandscape ? 210 : 297);

  const mmToPx = 3.7795;
  const pageHpx = Math.round(pageHmm * mmToPx);
  const pageWpx = Math.round(pageWmm * mmToPx);

  const topPx = Math.round(mTop * 10 * mmToPx);
  const bottomPx = Math.round(mBottom * 10 * mmToPx);
  const contentMaxH = pageHpx - topPx - bottomPx;

  // Conteneur de mesure des éléments HTML — élément du document principal
  // Obsidian (ajouté à document.body ci-dessous).
  const measureHost = document.body.createDiv({ cls: "feuillets-pdf-measure-host" });
  measureHost.style.width = `${pageWpx - Math.round((mLeft + mRight) * 10 * mmToPx)}px`;
  measureHost.style.fontFamily = tpl.fontFamily;
  measureHost.style.fontSize = `${tpl.fontSizePt}pt`;
  measureHost.style.lineHeight = String(tpl.lineHeight);

  const elements = Array.from(containerEl.children)
    .map((el) => el.cloneNode(true))
    .filter(isPageElement);
  if (footnotes && footnotes.length > 0) {
    // Détaché tant qu'il n'est pas poussé dans `elements` ci-dessous — élément
    // du document principal Obsidian (ses enfants sont déjà créés via createEl).
    const fnDiv = createDiv({ cls: "pdf-footnotes-section" });
    fnDiv.createEl("hr");
    const ol = fnDiv.createEl("ol");
    /* Le contenu d'une note est du HTML issu du rendu Markdown d'Obsidian
       (voir extractFootnotes dans export-render.js). Il est analysé dans un
       document inerte via DOMParser — qui n'exécute ni script ni gestionnaire
       d'événement, et ne touche pas au document courant — puis ses nœuds sont
       déplacés dans le <li>. Plus sûr, et plus lisible, qu'une affectation à
       innerHTML sur un élément vivant. */
    for (const f of footnotes) {
      const li = ol.createEl("li");
      li.id = f.id;
      const parsed = new DOMParser().parseFromString(f.html, "text/html");
      while (parsed.body.firstChild) li.appendChild(parsed.body.firstChild);
    }
    elements.push(fnDiv);
  }

  const rawPages: Element[][] = [];
  let currentPageNodes: Element[] = [];
  let currentH = 0;

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i];
    const tag = node.tagName ? node.tagName.toLowerCase() : "";

    measureHost.appendChild(node);
    const nodeH = measuredHeight(node);
    measureHost.removeChild(node);

    const isHeading = ["h1", "h2", "h3", "h4"].includes(tag);
    // Saut de page systématique pour H1 (partie) et H2 (chapitre)
    const isTitle = tag === "h1" || tag === "h2";
    // Page Front (titre/dédicace/épigraphe, voir export-render.js) : sur sa
    // propre page, jamais partagée avec ce qui précède OU ce qui suit.
    const isFrontPage = !!(node.classList && node.classList.contains("feuillets-frontpage"));
    const prevWasFrontPage = i > 0 && elements[i - 1].classList && elements[i - 1].classList.contains("feuillets-frontpage");
    const forceNewPage = isTitle || isFrontPage || prevWasFrontPage || (isHeading && currentH + nodeH + 50 > contentMaxH);

    if ((forceNewPage || currentH + nodeH > contentMaxH) && currentPageNodes.length > 0) {
      rawPages.push(currentPageNodes);
      currentPageNodes = [];
      currentH = 0;
    }

    currentPageNodes.push(node);
    currentH += nodeH;
  }

  if (currentPageNodes.length > 0) {
    rawPages.push(currentPageNodes);
  }

  if (document.body.contains(measureHost)) {
    document.body.removeChild(measureHost);
  }

  const totalPages = Math.max(1, rawPages.length);

  // Assemblage final des pages avec en-têtes/pieds et numérotation
  const pagesHtml = rawPages.map((nodes, idx) => {
    const pageNum = idx + 1;
    const isEven = pageNum % 2 === 0;
    const isFirst = pageNum === 1;

    const currentLeftM = mirror ? (isEven ? mRight : mLeft) : mLeft;
    const currentRightM = mirror ? (isEven ? mLeft : mRight) : mRight;

    let hLeftText = (settings.pdfHeaderLeft ?? "{title}").replace(/\{title\}/gi, title).replace(/\{author\}/gi, author);
    let hRightText = (settings.pdfHeaderRight ?? "{author}").replace(/\{title\}/gi, title).replace(/\{author\}/gi, author);

    const numStr = (settings.pdfFooterRight ?? "Page {page} sur {pages}")
      .replace(/\{title\}/gi, title)
      .replace(/\{author\}/gi, author)
      .replace(/\{page\}/gi, String(pageNum))
      .replace(/\{pages\}/gi, String(totalPages));

    let fLeftText = (settings.pdfFooterLeft ?? "").replace(/\{title\}/gi, title).replace(/\{author\}/gi, author);
    let fCenterText = "";
    let fRightText = "";

    if (pageNumPos === "center") {
      fCenterText = numStr;
    } else if (pageNumPos === "left") {
      fLeftText = numStr;
    } else {
      fRightText = numStr;
    }

    if (diffHeaders && isEven) {
      // Inversion pour les pages paires (gauches)
      [hLeftText, hRightText] = [hRightText, hLeftText];
      if (pageNumPos === "right") {
        fLeftText = numStr;
        fRightText = "";
      } else if (pageNumPos === "left") {
        fRightText = numStr;
        fLeftText = "";
      }
    }

    const showHeaderFooter = !(isFirst && hideFirst);
    const nodesHtml = nodes.map((n) => n.outerHTML).join("\n");

    return `
      <div class="pdf-page ${isEven ? "page-even" : "page-odd"}" style="
        width: ${pageWmm}mm;
        height: ${pageHmm}mm;
        padding-top: ${mTop}cm;
        padding-bottom: ${mBottom}cm;
        padding-left: ${currentLeftM}cm;
        padding-right: ${currentRightM}cm;
        box-sizing: border-box;
        page-break-after: always;
        break-after: page;
        position: relative;
        background: #ffffff;
        color: #111111;
      ">
        ${
          showHeaderFooter
            ? `
          <div class="pdf-page-header" style="
            position: absolute;
            top: ${mTop * 0.3}cm;
            left: ${currentLeftM}cm;
            right: ${currentRightM}cm;
            display: flex;
            justify-content: space-between;
            font-size: 8pt;
            color: #aaaaaa;
            border-bottom: 0.5pt solid #f0f0f0;
            padding-bottom: 3px;
            font-family: ${tpl.fontFamily};
          ">
            <span>${hLeftText}</span>
            <span>${hRightText}</span>
          </div>
        `
            : ""
        }
        <div class="pdf-page-content" style="height: 100%; overflow: hidden;">
          ${nodesHtml}
        </div>
        ${
          showHeaderFooter
            ? `
          <div class="pdf-page-footer" style="
            position: absolute;
            bottom: ${mBottom * 0.3}cm;
            left: ${currentLeftM}cm;
            right: ${currentRightM}cm;
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            font-size: 8pt;
            color: #aaaaaa;
            border-top: 0.5pt solid #f0f0f0;
            padding-top: 3px;
            font-family: ${tpl.fontFamily};
          ">
            <div style="text-align: left;">${fLeftText}</div>
            <div style="text-align: center;">${fCenterText}</div>
            <div style="text-align: right;">${fRightText}</div>
          </div>
        `
            : ""
        }
      </div>
    `;
  });

  return { pagesHtml: pagesHtml.join("\n"), totalPages };
}

/** PDF via la boîte de dialogue d'impression du système */
export async function exportPdf(app: App, settings: FeuilletsSettings, { markdown, title, author, sourcePath, segments }: PdfExportInput): Promise<void> {
  if (Platform.isMobile) {
    new Notice(
      "L'export PDF n'est disponible que sur desktop pour l'instant — utilise EPUB ou Word (.docx) sur mobile."
    );
    return;
  }

  const tpl = await resolveExportTemplate(app, settings, settings.exportTemplate);
  const { containerEl, footnotes } = await renderManuscriptHtmlWithFrontPages(app, markdown, segments, sourcePath);

  /* Pas de page de titre générique si l'autrice a déjà composé sa propre
     page Front de type "titre" — voir même choix dans export-docx.js. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));
  if (!hasAuthoredTitlePage) {
    // Titre et auteur au sommet du document — éléments du document principal
    // Obsidian, créés détachés puis repositionnés (prepend/after) dans
    // containerEl plutôt qu'ajoutés en fin d'arbre par createEl.
    const titleEl = createEl("h1", { text: title });
    containerEl.prepend(titleEl);
    if (author) {
      const authorEl = createEl("p", { cls: "pdf-author-title", text: author });
      titleEl.after(authorEl);
    }
  }

  const { pagesHtml } = paginateManuscript(containerEl, footnotes, settings, tpl, title, author);

  const css = templateToCss(tpl) + FRONT_PAGE_CSS + "\n" + titleRoleCss(tpl);
  const pageSize: PdfPageSize = settings.pdfPageSize || "A4";
  const orientation: PdfOrientation = settings.pdfOrientation || tpl.pageOrientation || "portrait";

  // Iframe hôte de l'impression : élément du document principal Obsidian.
  const iframe = document.body.createEl("iframe", { cls: "feuillets-pdf-print-frame" });

  if (!isPrintableIframe(iframe)) {
    throw new Error("Impossible de préparer la fenêtre d'impression PDF.");
  }

  /* Construction explicite du document d'impression, sans document.write
     (obsolète, ré-analyse tout le document au fil de l'eau). iframe.contentDocument
     est un DOM détaché du document Obsidian — un realm JS séparé sans les
     prototypes patchés par Obsidian (pas de createEl/createDiv ici), d'où
     l'API DOM native. open()/close() sont conservés à l'identique de l'ancien
     code (close() aide à déclencher l'évènement "load" de l'iframe, attendu
     plus bas). */
  const doc = iframe.contentDocument;
  doc.open();

  const htmlEl = doc.documentElement;
  htmlEl.setAttribute("lang", settings.epubLanguage || "fr");
  const headEl = doc.head ?? htmlEl.appendChild(doc.createElement("head"));
  const bodyEl = doc.body ?? htmlEl.appendChild(doc.createElement("body"));

  const metaEl = doc.createElement("meta");
  metaEl.setAttribute("charset", "utf-8");
  headEl.appendChild(metaEl);

  const titleTag = doc.createElement("title");
  titleTag.textContent = title;
  headEl.appendChild(titleTag);

  const styleEl = doc.createElement("style");
  styleEl.textContent = `${css}
@page {
  size: ${pageSize}${orientation === "landscape" ? " landscape" : ""};
  margin: 0 !important;
}
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  .pdf-page {
    page-break-after: always !important;
    break-after: page !important;
  }
}`;
  headEl.appendChild(styleEl);

  /* pagesHtml est du HTML déjà produit par paginateManuscript à partir du
     rendu Markdown natif d'Obsidian (MarkdownRenderer) — jamais de saisie
     brute non passée par ce pipeline. Même méthode que pour les notes de
     bas de page plus haut (voir DOMParser dans paginateManuscript) : analysé
     dans un document inerte (n'exécute ni script ni gestionnaire
     d'événement), puis ses nœuds sont déplacés dans le corps de la page
     d'impression — pas d'affectation à innerHTML sur un document vivant. */
  const parsedPages = new DOMParser().parseFromString(pagesHtml, "text/html");
  while (parsedPages.body.firstChild) {
    bodyEl.appendChild(parsedPages.body.firstChild);
  }

  doc.close();

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    window.setTimeout(resolve, 300);
  });

  new Notice("Choisis « Enregistrer au format PDF » dans la boîte d'impression.", 6000);
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  window.setTimeout(cleanup, 10000);
}
