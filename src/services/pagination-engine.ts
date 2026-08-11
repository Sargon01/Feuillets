/**
 * Pagination based on the browser's own layout.  This module deliberately
 * knows nothing about PDF printing or PreviewView: it composes clones in a
 * page-sized DOM box and asks that box whether it overflows.
 */

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
};

export type PaginationPage = Element[];

export const FRAGMENT_START_CLASS = "feuillets-pagination-fragment-start";
export const FRAGMENT_CONTINUATION_CLASS = "feuillets-pagination-fragment-continuation";
export const FRAGMENT_CONTINUES_CLASS = "feuillets-pagination-fragment-continues";
export const CONTINUATION_STYLE = { "text-indent": "0", "margin-top": "0" };
export const CONTINUES_JUSTIFY_STYLE = { "text-align-last": "justify" };

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

function isForcedPage(node: Element): boolean {
  const tag = node.tagName.toLowerCase();
  return tag === "h1" || tag === "h2" || node.classList.contains("feuillets-frontpage");
}

function isFrontPage(node: Element): boolean {
  return node.classList.contains("feuillets-frontpage");
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
 * Paginate top-level manuscript blocks.  Overflow is determined solely by
 * scrollHeight/clientHeight or scrollWidth/clientWidth after each candidate
 * is actually laid out. The horizontal check is essential for page-height
 * multi-column composition, which creates an additional column on overflow.
 */
export function paginateDom(nodes: Element[], geometry: PaginationGeometry): PaginationPage[] {
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
    const fits = !overflows(page.content);
    page.content.removeChild(candidate);
    return fits;
  };
  const place = (candidate: Element) => {
    page.content.appendChild(candidate);
    page.nodes.push(candidate);
  };
  const retain = (candidate: Element) => { page.nodes.push(candidate); };
  const nextPage = (singleColumn = false) => { page = createPage(singleColumn); };

  try {
    for (const original of nodes) {
      const source = original.cloneNode(true) as Element;
      const front = isFrontPage(source);
      if (isForcedPage(source) && page.nodes.length) nextPage(front);
      else if (front) page = createPage(true);

      if (appendIfFits(source)) {
        place(source);
        if (front) nextPage();
        continue;
      }

      if (!canSplit(source)) {
        // First retry an indivisible block on an empty page.  Only a block
        // larger than a complete page is marked oversized.
        if (page.nodes.length) {
          nextPage();
          if (appendIfFits(source)) {
            place(source);
            if (front) nextPage();
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
        if (!overflows(page.content)) {
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
          if (!overflows(page.content)) {
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
  return pages.filter((item) => item.nodes.length > 0).map((item) => item.nodes);
}
