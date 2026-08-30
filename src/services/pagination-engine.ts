/**
 * Pagination based on the browser's own layout.  This module deliberately
 * knows nothing about PDF printing or PreviewView: it composes clones in a
 * page-sized DOM box and asks that box whether it overflows.
 */

export type PaginationReservedBottomAreaProvider =
  (bodyNodes: readonly Element[]) => Element | null;

export type PaginationGeometry = {
  widthPx: number;
  heightPx: number;
  fontFamily: string;
  fontSizePt: number;
  lineHeight: number;
  textAlign?: string;
  hyphens?: boolean;
  css?: string;
  columnCount?: number;
  columnGapPt?: number;
  /** Politique explicite par niveau ; l'absence conserve le comportement legacy. */
  headingPageBreaks?: Partial<Record<"h1" | "h2" | "h3" | "h4" | "h5" | "h6", boolean>>;
  reservedBottomAreaProvider?: PaginationReservedBottomAreaProvider;
};

export type PaginationPage = {
  bodyNodes: Element[];
  footnoteNodes: Element[];
};

export type CooperativePaginationOptions = {
  shouldAbort?: () => boolean;
  /** Injection réservée aux tests : la production rend la main avec timer 0. */
  yieldToBrowser?: () => Promise<void>;
};

const COOPERATIVE_PAGINATION_BUDGET_MS = 8;

export const FRAGMENT_START_CLASS = "feuillets-pagination-fragment-start";
export const FRAGMENT_CONTINUATION_CLASS = "feuillets-pagination-fragment-continuation";
export const FRAGMENT_CONTINUES_CLASS = "feuillets-pagination-fragment-continues";
export const CONTINUATION_STYLE = { "text-indent": "0", "margin-top": "0" };
export const CONTINUES_JUSTIFY_STYLE = { "text-align-last": "justify" };
export const DOCUMENT_MEDIA_MIN_SCALE = 0.8;
const DOCUMENT_MEDIA_SCALE_PROPERTY = "--feuillets-doc-media-scale";

/** Recherche déterministe de la plus grande échelle qui tient, sans jamais
 * descendre sous la borne documentaire de 80 %. */
export function largestFittingDocumentMediaScale(
  fits: (scale: number) => boolean,
  iterations = 6
): number | null {
  if (fits(1)) return 1;
  if (!fits(DOCUMENT_MEDIA_MIN_SCALE)) return null;
  let low = DOCUMENT_MEDIA_MIN_SCALE;
  let high = 1;
  for (let index = 0; index < iterations; index++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

type CompositionPage = {
  content: HTMLElement;
  nodes: Element[];
};

function applyCss(element: HTMLElement, props: Record<string, string>) {
  if (typeof element.setCssProps === "function") {
    element.setCssProps(props);
    return;
  }
  element.setAttribute("style", Object.entries(props).map(([key, value]) => `${key}:${value}`).join(";"));
}

function textNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) nodes.push(child as Text);
      else visit(child);
    }
  };
  visit(root);
  return nodes;
}

function textLength(root: Node): number {
  return textNodes(root).reduce((length, node) => length + (node.nodeValue || "").length, 0);
}

function rangeForTextOffsets(source: Element, start: number, end: number): Range | null {
  const nodes = textNodes(source);
  let cursor = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const node of nodes) {
    const length = (node.nodeValue || "").length;
    if (!startNode && start >= cursor && start <= cursor + length) {
      startNode = node;
      startOffset = start - cursor;
    }
    if (!endNode && end >= cursor && end <= cursor + length) {
      endNode = node;
      endOffset = end - cursor;
      break;
    }
    cursor += length;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

/** Returns a rich clone of a slice of an element's text, retaining inline DOM. */
export function cloneTextFragment(source: Element, start: number, end: number): Element | null {
  if (end <= start) return null;
  const range = rangeForTextOffsets(source, start, end);
  if (!range) return null;
  const fragment = source.cloneNode(false) as Element;
  fragment.appendChild(range.cloneContents());
  return fragment;
}

/** Word ranges are the only legal paragraph break candidates for pagination. */
export function wordBoundaries(text: string): Array<{ start: number; end: number }> {
  const boundaries: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(/\S+/gu)) {
    boundaries.push({ start: match.index, end: match.index + match[0].length });
  }
  return boundaries;
}

export function wordPrefixEnds(text: string): number[] {
  return wordBoundaries(text).slice(1).map((word) => word.start);
}

function canSplit(node: Element): boolean {
  return node.tagName.toLowerCase() === "p" && textLength(node) > 0;
}

export function applyFragmentPresentation(
  fragment: Element,
  continuation: boolean,
  continues: boolean,
  textAlign?: string
) {
  fragment.classList.add(continuation ? FRAGMENT_CONTINUATION_CLASS : FRAGMENT_START_CLASS);
  if (continuation) applyCss(fragment as HTMLElement, CONTINUATION_STYLE);
  if (continues) {
    fragment.classList.add(FRAGMENT_CONTINUES_CLASS);
    if (textAlign === "justify") applyCss(fragment as HTMLElement, CONTINUES_JUSTIFY_STYLE);
  }
}

function isForcedPage(node: Element, geometry: PaginationGeometry): boolean {
  const tag = node.tagName.toLowerCase();
  if (node.classList.contains("feuillets-frontpage")) return true;
  if (tag < "h1" || tag > "h6") return false;
  const policy = geometry.headingPageBreaks?.[tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"];
  return policy ?? (tag === "h1" || tag === "h2");
}

function isFrontPage(node: Element): boolean {
  return node.classList.contains("feuillets-frontpage");
}

function isManualPageBreak(node: Element): boolean {
  return node.classList.contains("feuillets-page-break-before");
}

function isHeading(node: Element): boolean {
  return /^h[1-6]$/.test(node.tagName.toLowerCase());
}

function isDocumentMediaBlock(node: Element): boolean {
  return node.classList.contains("feuillets-doc-media-block");
}

export function documentMediaGroupAfter(heading: Element, following: Element[]): Element[] | null {
  if (!isHeading(heading)) return null;
  const first = following[0];
  if (first && isDocumentMediaBlock(first)) return [heading, first];
  const second = following[1];
  if (first?.tagName.toLowerCase() === "p" && second && isDocumentMediaBlock(second)) return [heading, first, second];
  return null;
}

function isLandscapeContextDocumentMedia(node: Element): boolean {
  return isDocumentMediaBlock(node) && node.classList.contains("feuillets-doc-media-landscape-context");
}

function setDocumentMediaScale(node: Element, scale: number): void {
  const current = node.getAttribute("style");
  const declaration = `${DOCUMENT_MEDIA_SCALE_PROPERTY}: ${scale}`;
  node.setAttribute("style", current ? `${current}; ${declaration}` : declaration);
}

function needsDocumentMediaFallback(node: Element): boolean {
  return node.classList.contains("feuillets-doc-media-portrait") || node.classList.contains("feuillets-doc-media-landscape-context");
}

function addClass(node: Element, name: string): void {
  node.className = `${node.className} ${name}`.trim();
}

function stackedDocumentMediaChildren(node: Element): Element[] {
  const figure = node.querySelector(".feuillets-doc-media-figure");
  const content = node.querySelector(".feuillets-doc-media-content");
  return [
    ...(figure ? [figure.cloneNode(true) as Element] : []),
    ...(content ? Array.from(content.children).map((child) => child.cloneNode(true) as Element) : []),
  ];
}

function styleComposition(content: HTMLElement, geometry: PaginationGeometry) {
  const columnCount = Math.max(1, Math.round(geometry.columnCount ?? 1));
  const props: Record<string, string> = {
    "box-sizing": "border-box",
    width: `${geometry.widthPx}px`,
    height: `${geometry.heightPx}px`,
    overflow: "hidden",
    "font-family": geometry.fontFamily,
    "font-size": `${geometry.fontSizePt}pt`,
    "line-height": String(geometry.lineHeight),
    "text-align": geometry.textAlign || "initial",
    hyphens: geometry.hyphens ? "auto" : "none",
  };
  if (columnCount > 1) {
    props["column-count"] = String(columnCount);
    props["column-gap"] = `${Math.max(0, geometry.columnGapPt ?? 0)}pt`;
    props["column-fill"] = "auto";
  }
  applyCss(content, props);
}

function overflows(content: HTMLElement): boolean {
  return content.scrollHeight > content.clientHeight || content.scrollWidth > content.clientWidth;
}

/**
 * Wrapper around overflows() that reserves height for a bottom area if a provider exists.
 * The provider returns an Element representing a zone (e.g., footnotes) that should consume
 * space from the content's available height, or null if no area is needed.
 *
 * If the provider exists and returns an Element, we:
 * 1. Measure the Element's actual height in the browser
 * 2. Temporarily reduce content.style.height to account for this reservation
 * 3. Call overflows() with the reduced height
 * 4. Restore content.style.height (in finally)
 *
 * If the provider doesn't exist or returns null, this function behaves identically to overflows().
 */
function overflowsWithReservedBottomArea(
  content: HTMLElement,
  geometry: PaginationGeometry,
  root: HTMLElement | ShadowRoot
): boolean {
  // If no provider, use historical path unchanged
  if (!geometry.reservedBottomAreaProvider) {
    return overflows(content);
  }

  // Get bodyNodes from current content's children
  const bodyNodes = Array.from(content.children);

  // Ask provider for a bottom area
  const bottomArea = geometry.reservedBottomAreaProvider(bodyNodes);

  // If provider returns null, no reservation needed
  if (!bottomArea) {
    return overflows(content);
  }

  // Measure the bottom area in a temporary container
  const tempContainer = document.createElement("div");
  tempContainer.style.width = `${geometry.widthPx}px`;
  tempContainer.style.boxSizing = "border-box";
  tempContainer.style.fontFamily = geometry.fontFamily;
  tempContainer.style.fontSize = `${geometry.fontSizePt}pt`;
  tempContainer.style.lineHeight = String(geometry.lineHeight);
  tempContainer.style.textAlign = geometry.textAlign || "initial";
  tempContainer.style.hyphens = geometry.hyphens ? "auto" : "none";
  tempContainer.style.columnCount = "1";
  tempContainer.style.visibility = "hidden";

  tempContainer.appendChild(bottomArea.cloneNode(true));
  root.appendChild(tempContainer);

  let reservedHeight = 0;
  try {
    reservedHeight = tempContainer.scrollHeight;
  } finally {
    root.removeChild(tempContainer);
  }

  // Calculate available height for body
  const availableBodyHeight = Math.max(0, geometry.heightPx - reservedHeight);

  // Save and temporarily modify content height
  const previousHeight = content.style.height;
  content.style.height = `${availableBodyHeight}px`;

  try {
    return overflows(content);
  } finally {
    content.style.height = previousHeight;
  }
}

/**
 * Paginate top-level manuscript blocks.  Overflow is determined solely by
 * scrollHeight/clientHeight or scrollWidth/clientWidth after each candidate
 * is actually laid out. The horizontal check is essential for page-height
 * multi-column composition, which creates an additional column on overflow.
 */
/** Moteur unique. Chaque `yield` suit une mesure de composition DOM. */
function* paginateDomSteps(nodes: Element[], geometry: PaginationGeometry): Generator<void, PaginationPage[], void> {
  const host = createDiv();
  host.setAttribute("aria-hidden", "true");
  applyCss(host, { position: "fixed", left: "-100000px", top: "0", visibility: "hidden", "pointer-events": "none" });
  document.body.appendChild(host);

  const root: HTMLElement | ShadowRoot = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;
  if (geometry.css && typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot && "adoptedStyleSheets" in root) {
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(geometry.css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, stylesheet];
  }

  const pages: CompositionPage[] = [];
  const createPage = (singleColumn = false): CompositionPage => {
    const content = createDiv();
    content.className = "pagination-engine-page-content";
    styleComposition(content, singleColumn ? { ...geometry, columnCount: 1 } : geometry);
    root.appendChild(content);
    const page = { content, nodes: [] };
    pages.push(page);
    return page;
  };
  let page = createPage();

  const appendIfFits = (candidate: Element): boolean => {
    page.content.appendChild(candidate);
    const fits = !overflowsWithReservedBottomArea(page.content, geometry, root);
    page.content.removeChild(candidate);
    return fits;
  };
  const place = (candidate: Element) => {
    page.content.appendChild(candidate);
    page.nodes.push(candidate);
  };
  const retain = (candidate: Element) => { page.nodes.push(candidate); };
  const nextPage = (singleColumn = false) => { page = createPage(singleColumn); };
  const groupFits = (content: HTMLElement, group: Element[], scale = 1): boolean => {
    const copies = group.map((block) => block.cloneNode(true) as Element);
    const media = copies.find(isLandscapeContextDocumentMedia);
    if (media && scale < 1) setDocumentMediaScale(media, scale);
    copies.forEach((copy) => content.appendChild(copy));
    const fits = !overflowsWithReservedBottomArea(content, geometry, root);
    copies.forEach((copy) => copy.remove());
    return fits;
  };
  const groupFitsOnEmptyPage = (group: Element[], scale = 1): boolean => {
    const content = createDiv();
    styleComposition(content, geometry);
    root.appendChild(content);
    const fits = groupFits(content, group, scale);
    content.remove();
    return fits;
  };

  try {
    const pending = [...nodes];
    while (pending.length) {
      const original = pending.shift();
      if (!original) break;
      const source = original.cloneNode(true) as Element;
      if (isManualPageBreak(source) && page.nodes.length) nextPage();
      const front = isFrontPage(source);
      if (isForcedPage(source, geometry) && page.nodes.length) nextPage(front);
      else if (front) page = createPage(true);

      /* Garde le titre avec son premier média documentaire, avec au plus un
         paragraphe introductif. Si le groupe dépasse une page entière, il
         revient au flux normal plutôt que de créer une page vide. */
      const mediaGroup = documentMediaGroupAfter(source, pending);
      if (mediaGroup && page.nodes.length && !groupFits(page.content, mediaGroup)) {
        const media = mediaGroup.find(isLandscapeContextDocumentMedia);
        const scale = media ? largestFittingDocumentMediaScale((value) => groupFits(page.content, mediaGroup, value)) : null;
        if (media && scale !== null && scale < 1) setDocumentMediaScale(media, scale);
        else if (groupFitsOnEmptyPage(mediaGroup)) nextPage();
      }

      let sourceFits = appendIfFits(source);
      yield;
      if (!sourceFits && isLandscapeContextDocumentMedia(source)) {
        const scale = largestFittingDocumentMediaScale((value) => {
          const candidate = source.cloneNode(true) as Element;
          if (value < 1) setDocumentMediaScale(candidate, value);
          return appendIfFits(candidate);
        });
        if (scale !== null && scale < 1) {
          setDocumentMediaScale(source, scale);
          sourceFits = appendIfFits(source);
          yield;
        }
      }
      if (sourceFits) {
        place(source);
        if (front) nextPage();
        continue;
      }

      if (!canSplit(source)) {
        // First retry an indivisible block on an empty page.  Only a block
        // larger than a complete page is marked oversized.
        if (page.nodes.length) {
          nextPage();
          const retryFits = appendIfFits(source);
          yield;
          if (retryFits) {
            place(source);
            if (front) nextPage();
            continue;
          }
          if (needsDocumentMediaFallback(source)) {
            addClass(source, "feuillets-doc-media-stacked");
            const stackedFits = appendIfFits(source);
            yield;
            if (stackedFits) {
              place(source);
              continue;
            }
            const stackedChildren = stackedDocumentMediaChildren(source);
            if (stackedChildren.length) {
              pending.unshift(...stackedChildren);
              continue;
            }
          }
        } else if (needsDocumentMediaFallback(source)) {
          addClass(source, "feuillets-doc-media-stacked");
          const stackedFits = appendIfFits(source);
          yield;
          if (stackedFits) {
            place(source);
            continue;
          }
          const stackedChildren = stackedDocumentMediaChildren(source);
          if (stackedChildren.length) {
            pending.unshift(...stackedChildren);
            continue;
          }
        }
        source.setAttribute("data-pagination-oversized", "true");
        place(source);
        nextPage();
        continue;
      }

      const total = textLength(source);
      let start = 0;
      while (start < total) {
        // The complete remaining paragraph is the first and authoritative
        // candidate. Its real composition box alone decides whether it fits.
        const candidate = cloneTextFragment(source, start, total);
        if (!candidate) break;
        applyFragmentPresentation(candidate, start > 0, false, geometry.textAlign);
        page.content.appendChild(candidate);
        const candidateOverflows = overflowsWithReservedBottomArea(page.content, geometry, root);
        yield;
        if (!candidateOverflows) {
          // Keep the exact DOM element which was measured.
          retain(candidate);
          break;
        }
        page.content.removeChild(candidate);

        let fitting: Element | null = null;
        let fittingEnd = start;
        // A prefix ends at the start of the following word: every word stays
        // intact, including an unbreakable word at the page boundary.
        const prefixEnds = wordPrefixEnds(source.textContent?.slice(start) || "");
        for (let index = prefixEnds.length - 1; index >= 0; index--) {
          const end = start + prefixEnds[index];
          const prefix = cloneTextFragment(source, start, end);
          if (!prefix) continue;
          applyFragmentPresentation(prefix, start > 0, true, geometry.textAlign);
          page.content.appendChild(prefix);
          const prefixOverflows = overflowsWithReservedBottomArea(page.content, geometry, root);
          yield;
          if (!prefixOverflows) {
            fitting = prefix;
            fittingEnd = end;
            break;
          }
          page.content.removeChild(prefix);
        }

        if (!fitting) {
          if (page.nodes.length) {
            // No complete word fits in the remaining space: retry unchanged.
            nextPage();
            continue;
          }
          // Even the first word exceeds an empty page. Keep the remaining
          // paragraph once, rather than splitting a word or looping forever.
          const oversized = cloneTextFragment(source, start, total);
          if (!oversized) break;
          applyFragmentPresentation(oversized, start > 0, false, geometry.textAlign);
          oversized.setAttribute("data-pagination-oversized", "true");
          place(oversized);
          break;
        }

        // `fitting` is still in the composition box and already carries the
        // exact continuation/continues presentation used for its measurement.
        retain(fitting);
        start = fittingEnd;
        nextPage();
      }
    }
  } finally {
    host.remove();
  }

  // Empty composition boxes are an implementation detail, never output pages.
  return pages.filter((item) => item.nodes.length > 0).map((item) => ({
    bodyNodes: item.nodes,
    footnoteNodes: []
  }));
}

/** Consommateur historique : le moteur unique est drainé immédiatement. */
export function paginateDom(nodes: Element[], geometry: PaginationGeometry): PaginationPage[] {
  // `paginateDomSteps` effectue chaque mesure `overflows` avant ce drainage.
  const steps = paginateDomSteps(nodes, geometry);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

/** Consommateur Preview : même moteur, avec une restitution régulière du thread. */
export async function paginateDomCooperatively(
  nodes: Element[],
  geometry: PaginationGeometry,
  options: CooperativePaginationOptions = {}
): Promise<PaginationPage[] | null> {
  const steps = paginateDomSteps(nodes, geometry);
  const release = options.yieldToBrowser ?? yieldToBrowser;
  let completed = false;
  let sliceStartedAt = performance.now();
  try {
    for (;;) {
      if (options.shouldAbort?.()) return null;
      const next = steps.next();
      if (next.done) {
        completed = true;
        return next.value;
      }
      if (options.shouldAbort?.()) return null;
      if (performance.now() - sliceStartedAt >= COOPERATIVE_PAGINATION_BUDGET_MS) {
        await release();
        if (options.shouldAbort?.()) return null;
        sliceStartedAt = performance.now();
      }
    }
  } finally {
    if (!completed) steps.return([]);
  }
}
