import { Notice, Platform } from "obsidian";
import type { App } from "obsidian";
import { composeDocumentMedia, renderManuscriptHtmlWithFrontPages, FRONT_PAGE_CSS } from "./export-render.js";
import { DOCUMENT_LAYOUT_EXPORT_CSS } from "./document-layout.js";
import { templateToCss, titleRoleCss } from "../utils/export-templates.js";
import { resolveExportTemplate } from "./export-templates-custom.js";
import { paginateDom, paginateDomCooperatively, type CooperativePaginationOptions, type PaginationGeometry, type PaginationPage, type PaginationReservedBottomAreaProvider } from "./pagination-engine.js";
import { resolvePageGeometry } from "./page-geometry.js";
import { shouldGenerateGenericTitlePage } from "./export-template-v2.js";
import type { ContentVariant } from "./content-variants.js";
import { populatePaginationFootnoteNodes, type PaginationFootnoteDefinition, type PaginationFootnoteCall } from "./pagination-footnotes.js";

type PdfFootnote = PaginationFootnoteDefinition;

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
  contentVariant?: ContentVariant | null;
};

type PaginationResult = {
  pagesHtml: string;
  totalPages: number;
};

type PreparedManuscriptPagination = {
  elements: Element[];
  geometry: PaginationGeometry;
};

export type PdfOutputLayout = "single" | "two-up-successive" | "two-up-duplicate";

export function outputLayoutFor(
  settings: Pick<FeuilletsSettings, "pdfOutputLayout">,
  tpl?: Pick<ResolvedExportTemplate, "pdfOutputLayout">,
): PdfOutputLayout {
  const value = tpl?.pdfOutputLayout ?? settings.pdfOutputLayout;
  return value === "two-up-successive" || value === "two-up-duplicate" ? value : "single";
}

function logicalTemplateFor(tpl: ResolvedExportTemplate, settings: FeuilletsSettings): ResolvedExportTemplate {
  return outputLayoutFor(settings, tpl) === "single"
    ? tpl
    : { ...tpl, pageSize: "A5", pageOrientation: "portrait" };
}

function physicalPageGeometry(tpl: ResolvedExportTemplate, settings: FeuilletsSettings) {
  return outputLayoutFor(settings, tpl) === "single"
    ? resolvePageGeometry(tpl, settings)
    : resolvePageGeometry({ ...tpl, pageSize: "A4", pageOrientation: "landscape" }, settings);
}

export function logicalPageGeometryFor(tpl: ResolvedExportTemplate, settings: FeuilletsSettings) {
  return resolvePageGeometry(logicalTemplateFor(tpl, settings), settings);
}

export function physicalPageGeometryFor(tpl: ResolvedExportTemplate, settings: FeuilletsSettings) {
  return physicalPageGeometry(tpl, settings);
}

export function imposePagesHtml(logicalPages: string[], mode: PdfOutputLayout): string[] {
  if (mode === "single") return logicalPages;
  const sheets: string[] = [];
  const panel = (html: string, side: "left" | "right") => {
    const panelPage = html
      .replace('class="pdf-page ', 'class="pdf-page feuillets-sheet-panel-page ')
      .replace(/page-break-after: always;/gu, "page-break-after: auto;")
      .replace(/break-after: page;/gu, "break-after: auto;");
    return `<div class="feuillets-sheet-panel feuillets-sheet-panel-${side}">${panelPage}</div>`;
  };
  const sheet = (left: string, right: string) => `<div class="feuillets-sheet feuillets-sheet-a4-landscape feuillets-sheet-two-up">${panel(left, "left")}${panel(right, "right")}</div>`;
  if (mode === "two-up-duplicate") {
    logicalPages.forEach((page) => sheets.push(sheet(page, page)));
    return sheets;
  }
  for (let index = 0; index < logicalPages.length; index += 2) sheets.push(sheet(logicalPages[index], logicalPages[index + 1] || ""));
  return sheets;
}

export type PaginationOptions = {
  /** Consumer-level override; Preview can opt out without changing templates. */
  hyphenationOverride?: boolean;
  /** Consumer-level page geometry; Preview uses the active template margins. */
  marginsOverrideCm?: Margins;
};

export function effectiveHyphenation(tpl: ResolvedExportTemplate, options: PaginationOptions = {}): boolean {
  return options.hyphenationOverride ?? !!tpl.hyphenation;
}

/** Politique de pagination : un niveau déclaré par le gabarit prévaut sur
 * les sauts H1/H2 historiques. */
export function headingPageBreakPolicy(tpl: ResolvedExportTemplate): NonNullable<PaginationGeometry["headingPageBreaks"]> {
  const policy: NonNullable<PaginationGeometry["headingPageBreaks"]> = {};
  for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
    const style = tpl.headings?.[level];
    policy[level] = style === undefined ? (level === "h1" || level === "h2") : !!style.pageBreakBefore;
  }
  return policy;
}

type PdfPageNumberPosition = "left" | "center" | "right";

/** Zone de composition exacte de la page finale, sans arrondi intermédiaire. */
export function pageContentGeometry(
  pageWmm: number,
  pageHmm: number,
  mTopCm: number,
  mBottomCm: number,
  mLeftCm: number,
  mRightCm: number
): { widthPx: number; heightPx: number } {
  const mmToPx = 3.7795;
  const contentWidthMm = pageWmm - (mLeftCm + mRightCm) * 10;
  const contentHeightMm = pageHmm - (mTopCm + mBottomCm) * 10;
  return {
    widthPx: contentWidthMm * mmToPx,
    heightPx: contentHeightMm * mmToPx,
  };
}

function isPrintableIframe(iframe: HTMLIFrameElement): iframe is HTMLIFrameElement & { contentDocument: Document; contentWindow: Window } {
  return iframe.contentDocument !== null && iframe.contentWindow !== null;
}

/**
 * Create a footnote area element for measurement or rendering.
 * If positioned=true, adds absolute positioning for final rendering.
 * If positioned=false, creates a measuring version without positioning.
 */
function createPaginationFootnoteArea(
  footnoteNodes: readonly Element[],
  fontFamily: string,
  positioned: boolean
): HTMLElement | null {
  if (footnoteNodes.length === 0) return null;

  const area = document.createElement("div");
  area.className = "pdf-page-footnotes";
  area.style.fontFamily = fontFamily;
  area.style.fontSize = "0.8em";
  area.style.lineHeight = "1.2";
  area.style.columnCount = "1";
  area.style.columnSpan = "all";
  if (positioned) {
    area.style.position = "absolute";
    area.style.left = "0";
    area.style.right = "0";
    area.style.bottom = "0";
  }

  const separator = document.createElement("div");
  separator.className = "pdf-page-footnotes-separator";
  separator.style.width = "25%";
  separator.style.borderTop = "0.5pt solid currentColor";
  separator.style.marginBottom = "4pt";
  area.appendChild(separator);

  const ol = document.createElement("ol");
  ol.style.margin = "0";
  ol.style.padding = "0";
  ol.style.listStyle = "none";
  footnoteNodes.forEach((node) => {
    ol.appendChild(node.cloneNode(true));
  });
  area.appendChild(ol);

  return area;
}

/**
 * Create a footnote list item with marker and content (Lot 3 structure).
 * Used both for measurement and final rendering.
 */
function createPaginationFootnoteNode(
  footnote: PdfFootnote,
  call: PaginationFootnoteCall
): Element {
  const li = document.createElement("li");
  li.id = footnote.id;
  li.style.listStyle = "none";
  li.style.display = "grid";
  li.style.gridTemplateColumns = "auto 1fr";
  li.style.columnGap = "0.35em";
  li.style.alignItems = "start";
  li.style.margin = "0";
  li.style.padding = "0";

  const markerSpan = document.createElement("span");
  markerSpan.className = "pdf-page-footnote-marker";
  markerSpan.style.fontVariantNumeric = "tabular-nums";
  markerSpan.textContent = call.markerText;
  li.appendChild(markerSpan);

  const contentDiv = document.createElement("div");
  contentDiv.className = "pdf-page-footnote-content";
  contentDiv.style.minWidth = "0";
  const parsed = new DOMParser().parseFromString(footnote.html, "text/html");
  parsed.body.querySelectorAll("a.footnote-backref, .footnote-backref").forEach((a) => a.remove());
  while (parsed.body.firstChild) contentDiv.appendChild(parsed.body.firstChild);
  contentDiv.querySelectorAll("p").forEach((p) => {
    p.style.marginTop = "0";
    p.style.marginBottom = "0";
  });
  li.appendChild(contentDiv);
  return li;
}

/**
 * Create a provider for reserved bottom area based on footnotes.
 * Returns a callback that measures footnotes for the current page's body content,
 * or undefined if there are no footnotes.
 */
function createFootnoteReservedBottomAreaProvider(
  footnotes: readonly PdfFootnote[] | null | undefined,
  fontFamily: string
): PaginationReservedBottomAreaProvider | undefined {
  if (!footnotes || footnotes.length === 0) {
    return undefined;
  }

  return (bodyNodes: readonly Element[]): Element | null => {
    // Create temporary page with current body nodes
    const tempPage: PaginationPage = {
      bodyNodes: Array.from(bodyNodes),
      footnoteNodes: [],
    };

    // Populate footnotes for this page using the centralized helper
    populatePaginationFootnoteNodes(
      [tempPage],
      footnotes,
      createPaginationFootnoteNode
    );

    if (tempPage.footnoteNodes.length === 0) {
      return null;
    }

    return createPaginationFootnoteArea(tempPage.footnoteNodes, fontFamily, false);
  };
}

/** Préparation commune aux consommateurs synchrone et coopératif. */
function prepareManuscriptPagination(
  containerEl: HTMLElement,
  footnotes: PdfFootnote[] | null | undefined,
  settings: FeuilletsSettings,
  tpl: ResolvedExportTemplate,
  options: PaginationOptions
): PreparedManuscriptPagination {
  const logicalTpl = logicalTemplateFor(tpl, settings);
  const pageGeometry = logicalPageGeometryFor(tpl, settings);
  const templateMargins = tpl.marginsCm;
  const mTop = options.marginsOverrideCm?.top ?? templateMargins?.top ?? settings.pdfMarginTop ?? 2.5;
  const mBottom = options.marginsOverrideCm?.bottom ?? templateMargins?.bottom ?? settings.pdfMarginBottom ?? 2.5;
  const mLeft = options.marginsOverrideCm?.left ?? templateMargins?.left ?? settings.pdfMarginLeft ?? 2.5;
  const mRight = options.marginsOverrideCm?.right ?? templateMargins?.right ?? settings.pdfMarginRight ?? 2.5;
  const contentGeometry = pageContentGeometry(pageGeometry.widthMm, pageGeometry.heightMm, mTop, mBottom, mLeft, mRight);
  const columnCount = Math.max(1, Math.round(tpl.columns?.count ?? 1));
  const columnGapPt = Math.max(0, tpl.columns?.gutterPt ?? 0);
  const elements = Array.from(containerEl.children)
    .map((el) => el.cloneNode(true))
    .filter((node): node is Element => "tagName" in node && "classList" in node);
  return {
    elements,
    geometry: {
      widthPx: contentGeometry.widthPx,
      heightPx: contentGeometry.heightPx,
      fontFamily: logicalTpl.fontFamily,
      fontSizePt: logicalTpl.fontSizePt,
      lineHeight: logicalTpl.lineHeight,
      textAlign: logicalTpl.align,
      hyphens: effectiveHyphenation(logicalTpl, options),
      columnCount,
      columnGapPt,
      headingPageBreaks: headingPageBreakPolicy(logicalTpl),
      css: templateToCss(logicalTpl) + FRONT_PAGE_CSS + DOCUMENT_LAYOUT_EXPORT_CSS + "\n" + titleRoleCss(logicalTpl),
      reservedBottomAreaProvider: createFootnoteReservedBottomAreaProvider(footnotes, logicalTpl.fontFamily),
    },
  };
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
  author = "",
  options: PaginationOptions = {},
  rawPagesOverride?: PaginationPage[]
): PaginationResult {
  /* §24-§26 : la géométrie vient du HELPER UNIQUE (services/page-geometry.ts)
     — gabarit résolu d'abord, anciens réglages PDF en repli. Rien d'autre ne
     change ici : le découpage en pages, les veuves/orphelines, la césure et le
     calcul des blocs (pagination-engine.ts) restent strictement intacts, seule
     l'ENTRÉE géométrique est corrigée. */
  const logicalTpl = logicalTemplateFor(tpl, settings);
  const geometry = logicalPageGeometryFor(tpl, settings);
  const pageWmm = geometry.widthMm;
  const pageHmm = geometry.heightMm;

  /* Marges : l'override explicite de l'appelant d'abord (Preview), puis celles
     du gabarit résolu — un gabarit V2 les exprime toujours —, puis les anciens
     réglages. Preview et export PDF reçoivent ainsi la MÊME géométrie sans que
     l'un des deux ait à la recalculer. */
  const templateMargins = tpl.marginsCm;
  const mTop = options.marginsOverrideCm?.top ?? templateMargins?.top ?? settings.pdfMarginTop ?? 2.5;
  const mBottom = options.marginsOverrideCm?.bottom ?? templateMargins?.bottom ?? settings.pdfMarginBottom ?? 2.5;
  const mLeft = options.marginsOverrideCm?.left ?? templateMargins?.left ?? settings.pdfMarginLeft ?? 2.5;
  const mRight = options.marginsOverrideCm?.right ?? templateMargins?.right ?? settings.pdfMarginRight ?? 2.5;

  const mirror = tpl.mirrorMargins ?? !!settings.pdfMirrorMargins;
  const diffHeaders = tpl.header?.differentOddEven ?? !!settings.pdfDiffHeaders;
  const hideFirst = tpl.firstPage?.hideHeader ?? settings.pdfHideFirstPageHeader ?? true;
  const pageNumPos: PdfPageNumberPosition = tpl.firstPage?.pageNumberPosition ?? settings.pdfPageNumberPosition ?? "right";

  const contentGeometry = pageContentGeometry(pageWmm, pageHmm, mTop, mBottom, mLeft, mRight);
  const columnCount = Math.max(1, Math.round(logicalTpl.columns?.count ?? 1));
  const columnGapPt = Math.max(0, logicalTpl.columns?.gutterPt ?? 0);

  const elements = Array.from(containerEl.children)
    .map((el) => el.cloneNode(true))
    .filter((node): node is Element => "tagName" in node && "classList" in node);

  const rawPages = rawPagesOverride ?? paginateDom(elements, {
    widthPx: contentGeometry.widthPx,
    heightPx: contentGeometry.heightPx,
    fontFamily: tpl.fontFamily,
    fontSizePt: tpl.fontSizePt,
    lineHeight: tpl.lineHeight,
    textAlign: tpl.align,
    hyphens: effectiveHyphenation(logicalTpl, options),
    columnCount,
    columnGapPt,
    headingPageBreaks: headingPageBreakPolicy(logicalTpl),
    // Scoped in a shadow root by the engine, never injected into Obsidian's document.
    css: templateToCss(logicalTpl) + FRONT_PAGE_CSS + DOCUMENT_LAYOUT_EXPORT_CSS + "\n" + titleRoleCss(logicalTpl),
    reservedBottomAreaProvider: createFootnoteReservedBottomAreaProvider(footnotes, logicalTpl.fontFamily),
  });

  // Associate footnotes to pages (Lot 3: populate footnoteNodes with visible rendering)
  // Uses the centralized createPaginationFootnoteNode helper
  populatePaginationFootnoteNodes(rawPages, footnotes ?? [], createPaginationFootnoteNode);

  /* Bandes en-tête/pied : même règle que la géométrie — le gabarit résolu
     prime quand il les exprime (c'est le cas d'un gabarit V2, jamais d'un
     gabarit intégré), sinon les anciens réglages, inchangés. */
  const headerLeft = tpl.header?.left ?? settings.pdfHeaderLeft ?? "{title}";
  const headerCenter = tpl.header?.center ?? settings.pdfHeaderCenter ?? "";
  const headerRight = tpl.header?.right ?? settings.pdfHeaderRight ?? "{author}";
  const footerLeft = tpl.footer?.left ?? settings.pdfFooterLeft ?? "";
  const footerCenter = tpl.footer?.center ?? settings.pdfFooterCenter ?? "";
  const footerRight = tpl.footer?.right ?? settings.pdfFooterRight ?? "Page {page} sur {pages}";
  const headersEnabled = tpl.header?.enabled ?? settings.pdfEnableHeaders !== false;
  const footersEnabled = tpl.footer?.enabled ?? settings.pdfEnableFooters !== false;
  const headerDistanceCm = tpl.header?.distanceCm ?? settings.pdfHeaderDistanceCm ?? 0.75;
  const headerBodyGapPt = tpl.header?.bodyGapPt ?? settings.pdfHeaderBodyGapPt ?? 3;
  const footerDistanceCm = tpl.footer?.distanceCm ?? settings.pdfFooterDistanceCm ?? 0.75;
  const footerBodyGapPt = tpl.footer?.bodyGapPt ?? settings.pdfFooterBodyGapPt ?? 3;

  const totalPages = Math.max(1, rawPages.length);
  const replaceBandVars = (value: string, pageNum: number, part: string, chapter: string): string => value
    .replace(/\{title\}/gi, title)
    .replace(/\{author\}/gi, author)
    .replace(/\{part\}/gi, part)
    .replace(/\{chapter\}/gi, chapter)
    .replace(/\{page\}/gi, String(pageNum))
    .replace(/\{pages\}/gi, String(totalPages));

  // Assemblage final des pages avec en-têtes/pieds et numérotation
  let currentPart = "";
  let currentChapter = "";
  const logicalPagesHtml = rawPages.map((page, idx) => {
    const nodes = page.bodyNodes;
    const pageNum = idx + 1;
    const isEven = pageNum % 2 === 0;
    const isFirst = pageNum === 1;

    const currentLeftM = mirror ? (isEven ? mRight : mLeft) : mLeft;
    const currentRightM = mirror ? (isEven ? mLeft : mRight) : mRight;
    for (const node of nodes) {
      const tag = node.tagName?.toLowerCase();
      if (tag === "h1") currentPart = node.textContent?.trim() || currentPart;
      if (tag === "h2") currentChapter = node.textContent?.trim() || currentChapter;
    }

    let hLeftText = replaceBandVars(headerLeft, pageNum, currentPart, currentChapter);
    const hCenterText = replaceBandVars(headerCenter, pageNum, currentPart, currentChapter);
    let hRightText = replaceBandVars(headerRight, pageNum, currentPart, currentChapter);

    let fLeftText = replaceBandVars(footerLeft, pageNum, currentPart, currentChapter);
    let fCenterText = replaceBandVars(footerCenter, pageNum, currentPart, currentChapter);
    let fRightText = replaceBandVars(footerRight, pageNum, currentPart, currentChapter);

    // Migration transparente : les anciens projets stockaient toujours le
    // modèle de numéro dans `pdfFooterRight` et sa position séparément.
    if (!footerCenter && !footerLeft && pageNumPos !== "right") {
      if (pageNumPos === "center") fCenterText = fRightText;
      else fLeftText = fRightText;
      fRightText = "";
    }

    if (diffHeaders && isEven) {
      // Inversion pour les pages paires (gauches)
      [hLeftText, hRightText] = [hRightText, hLeftText];
      if (pageNumPos === "right") {
        [fLeftText, fRightText] = [fRightText, fLeftText];
      } else if (pageNumPos === "left") {
        [fLeftText, fRightText] = [fRightText, fLeftText];
      }
    }

    const showHeader = headersEnabled && !(isFirst && hideFirst);
    const showFooter = footersEnabled && !(isFirst && hideFirst);
    const nodesHtml = nodes.map((n) => n.outerHTML).join("\n");
    const isFrontPage = nodes.some((node) => node.classList?.contains("feuillets-frontpage"));
    const columnsStyle = !isFrontPage && columnCount > 1
      ? ` column-count: ${columnCount}; column-gap: ${columnGapPt}pt; column-fill: auto;`
      : "";

    // Render footnotes at bottom if page has any (INSIDE pdf-page-content)
    const footnotesArea = createPaginationFootnoteArea(page.footnoteNodes, tpl.fontFamily, true);
    const pageFootnotesHtml = footnotesArea?.outerHTML ?? "";

    // pdf-page-content gets position:relative only if it has footnotes
    const hasPageFootnotes = page.footnoteNodes.length > 0;
    const contentStyle = hasPageFootnotes
      ? `position: relative; height: 100%; overflow: hidden;${columnsStyle}`
      : `height: 100%; overflow: hidden;${columnsStyle}`;

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
          showHeader
            ? `
          <div class="pdf-page-header" style="
            position: absolute;
            top: ${headerDistanceCm}cm;
            left: ${currentLeftM}cm;
            right: ${currentRightM}cm;
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            font-size: 8pt;
            color: #aaaaaa;
            border-bottom: 0.5pt solid #f0f0f0;
            padding-bottom: ${headerBodyGapPt}pt;
            font-family: ${tpl.fontFamily};
          ">
            <span style="text-align: left;">${hLeftText}</span>
            <span style="text-align: center;">${hCenterText}</span>
            <span style="text-align: right;">${hRightText}</span>
          </div>
        `
            : ""
        }
        <div class="pdf-page-content" style="${contentStyle}">
          ${nodesHtml}
          ${pageFootnotesHtml}
        </div>
        ${
          showFooter
            ? `
          <div class="pdf-page-footer" style="
            position: absolute;
            bottom: ${footerDistanceCm}cm;
            left: ${currentLeftM}cm;
            right: ${currentRightM}cm;
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            font-size: 8pt;
            color: #aaaaaa;
            border-top: 0.5pt solid #f0f0f0;
            padding-top: ${footerBodyGapPt}pt;
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

  const pagesHtml = imposePagesHtml(logicalPagesHtml, outputLayoutFor(settings, tpl));
  return { pagesHtml: pagesHtml.join("\n"), totalPages };
}

/** Preview seul : compose avec le même moteur puis réutilise l'assemblage final. */
export async function paginateManuscriptCooperatively(
  containerEl: HTMLElement,
  footnotes: PdfFootnote[] | null | undefined,
  settings: FeuilletsSettings,
  tpl: ResolvedExportTemplate,
  title = "",
  author = "",
  options: PaginationOptions = {},
  cooperativeOptions: CooperativePaginationOptions = {}
): Promise<PaginationResult | null> {
  const prepared = prepareManuscriptPagination(containerEl, footnotes, settings, tpl, options);
  const rawPages = await paginateDomCooperatively(prepared.elements, prepared.geometry, cooperativeOptions);
  if (!rawPages) return null;
  return paginateManuscript(containerEl, footnotes, settings, tpl, title, author, options, rawPages);
}

/** PDF via la boîte de dialogue d'impression du système */
export async function exportPdf(app: App, settings: FeuilletsSettings, { markdown, title, author, sourcePath, segments, contentVariant }: PdfExportInput): Promise<void> {
  if (Platform.isMobile) {
    new Notice(
      "L'export PDF n'est disponible que sur desktop pour l'instant — utilise EPUB ou Word (.docx) sur mobile."
    );
    return;
  }

  const tpl = await resolveExportTemplate(app, settings, settings.exportTemplate);
  const { containerEl, footnotes, images } = await renderManuscriptHtmlWithFrontPages(app, markdown, segments, sourcePath, contentVariant ?? null);
  if (tpl.profile === "document") composeDocumentMedia(containerEl, images);

  /* Pas de page de titre générique si l'autrice a déjà composé sa propre
     page Front de type "titre" — voir même choix dans export-docx.js. */
  const hasAuthoredTitlePage = !!(segments && segments.some((s) => s.frontType === "titre"));
  if (shouldGenerateGenericTitlePage(tpl.profile, hasAuthoredTitlePage)) {
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

  const css = templateToCss(tpl) + FRONT_PAGE_CSS + DOCUMENT_LAYOUT_EXPORT_CSS + "\n" + titleRoleCss(tpl);
  /* MÊME helper que paginateManuscript ci-dessus : la règle @page du document
     d'impression ne peut plus diverger du format réellement paginé (§26). */
  const { size: pageSize, orientation } = physicalPageGeometry(tpl, settings);

  // Iframe hôte de l'impression : élément du document principal Obsidian.
  const iframe = document.body.createEl("iframe", { cls: "feuillets-pdf-print-frame" });

  if (!isPrintableIframe(iframe)) {
    throw new Error("Impossible de préparer la fenêtre d'impression PDF.");
  }

  /* Construction explicite du document d'impression, sans document.write
     (obsolète, ré-analyse tout le document au fil de l'eau). iframe.contentDocument
     est un DOM détaché du document Obsidian — un realm JS séparé sans les
     prototypes patchés par Obsidian (pas de createEl/createDiv ici, ils
     créeraient des éléments du document principal, pas de ce realm). open()/
     close() sont conservés à l'identique de l'ancien code (close() aide à
     déclencher l'évènement "load" de l'iframe, attendu plus bas).

     doc.open() vide le document : il ne recrée PAS de squelette <html>/
     <head>/<body> (c'était le rôle du parseur HTML déclenché par
     document.write, qu'on ne fait plus). doc.documentElement/doc.head/
     doc.body valent donc réellement null juste après — d'où l'ancien crash
     (« Cannot read properties of null (reading 'setAttribute') »). Le
     squelette est donc reconstitué avec DOMParser, à partir d'une chaîne
     HTML statique et constante — jamais d'interpolation de title/css/
     pagesHtml dans cette chaîne — puis importé dans le realm de l'iframe via
     doc.importNode (transfert standard d'un nœud entre documents), avant
     d'être peuplé en travaillant directement sur les éléments importés. */
  const doc = iframe.contentDocument;
  doc.open();

  const skeleton = new DOMParser().parseFromString(
    "<html><head><meta charset=\"utf-8\"><title></title><style></style></head><body></body></html>",
    "text/html"
  );
  const htmlEl = doc.importNode(skeleton.documentElement, true);
  const headEl = htmlEl.querySelector("head");
  const bodyEl = htmlEl.querySelector("body");
  const titleTag = htmlEl.querySelector("title");
  const styleEl = htmlEl.querySelector("style");
  if (!headEl || !bodyEl || !titleTag || !styleEl) {
    throw new Error("Squelette HTML d'impression incomplet.");
  }

  htmlEl.setAttribute("lang", settings.epubLanguage || "fr");
  titleTag.textContent = title;

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
  .pdf-page:not(.feuillets-sheet-panel-page) {
    page-break-after: always !important;
    break-after: page !important;
  }
}
/* Empêche une image trop haute de déborder de sa page imprimée — relatif à
   la hauteur du contenu (.pdf-page-content, déjà limité à 100% de la page
   par paginateManuscript), pas une hauteur fixe : reste correct quel que
   soit le format/l'orientation de page choisi. */
.pdf-page-content figure img, .pdf-page-content img {
  max-height: 100%;
  object-fit: contain;
}`;

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

  doc.replaceChildren(htmlEl);
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
