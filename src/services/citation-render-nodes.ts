/**
 * Safe Citation AST to DOM Renderer for Feuillets.
 *
 * Renders structured CitationRenderNode[] into safe DOM nodes.
 *
 * Invariants:
 * - Pure DOM operations: zero innerHTML, zero outerHTML, zero DOMParser, zero HTML parsing.
 * - Always uses caller-supplied ownerDocument; never accesses global document.
 * - Enforces strict URL scheme validation (http, https, mailto only); rejects dangerous schemes.
 * - Unsafe links render children as plain spans without clickable anchor elements.
 * - Typographic and layout styles map cleanly to scoped feuillets-csl-* CSS classes.
 */

import type {
  CitationRenderNode,
  CitationTextStyle,
} from "../api/citation-contract.js";

const ALLOWED_URL_SCHEMES = new Set(["https:", "http:", "mailto:"]);

/**
 * Validates whether an arbitrary href string is safe to assign to an anchor element.
 * Strictly allows only https:, http:, and mailto: protocols.
 * Fails closed on any unknown, executable, or local schemes (javascript:, data:, file:, obsidian:, etc.),
 * mixed-case bypasses, whitespace manipulations, or control characters.
 */
export function isSafeCitationUrl(href: string): boolean {
  if (typeof href !== "string") return false;
  const trimmed = href.trim();
  if (!trimmed) return false;

  // Reject ASCII control characters (0x00 - 0x1f, 0x7f)
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }

  // Pre-check for a standard URI scheme: ^([a-zA-Z][a-zA-Z0-9+.-]*):
  const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!match) return false;
  const scheme = match[1].toLowerCase() + ":";
  if (!ALLOWED_URL_SCHEMES.has(scheme)) return false;

  // Validate with URL constructor
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_URL_SCHEMES.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

interface ScopedDocument {
  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K];
  defaultView?: (Window & {
    createEl?<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K];
  }) | null;
}

/**
 * Creates an element in the ownerDocument without relying on global document.
 * Strictly uses ownerDocument.defaultView?.createEl if present on this document's window,
 * otherwise falls back strictly to ownerDocument.createElement.
 */
function createScopedElement<K extends keyof HTMLElementTagNameMap>(
  ownerDocument: ScopedDocument,
  tagName: K
): HTMLElementTagNameMap[K] {
  const win = ownerDocument.defaultView;
  if (win && typeof win.createEl === "function") {
    return win.createEl(tagName);
  }
  return ownerDocument.createElement(tagName);
}

/**
 * Maps typographic CitationTextStyle properties to scoped feuillets-csl-* CSS classes.
 * Explicitly supports style resets (e.g. fontStyle: "normal", verticalAlign: "baseline").
 */
export function applyCitationTextStyle(
  element: HTMLElement,
  style: CitationTextStyle | undefined
): void {
  if (!style) return;

  if (style.fontStyle) {
    element.classList.add(`feuillets-csl-font-${style.fontStyle}`);
  }
  if (style.fontWeight) {
    element.classList.add(`feuillets-csl-weight-${style.fontWeight}`);
  }
  if (style.fontVariant) {
    element.classList.add(`feuillets-csl-variant-${style.fontVariant}`);
  }
  if (style.textDecoration) {
    element.classList.add(`feuillets-csl-decoration-${style.textDecoration}`);
  }
  if (style.verticalAlign) {
    if (style.verticalAlign === "superscript") {
      element.classList.add("feuillets-csl-valign-sup");
    } else if (style.verticalAlign === "subscript") {
      element.classList.add("feuillets-csl-valign-sub");
    } else {
      element.classList.add("feuillets-csl-valign-baseline");
    }
  }
}

/**
 * Renders a single CitationRenderNode into the provided parent Node.
 */
export function renderCitationNode(
  node: CitationRenderNode,
  parent: Node,
  ownerDocument: Document
): void {
  switch (node.type) {
    case "text": {
      const textNode = ownerDocument.createTextNode(node.text);
      parent.appendChild(textNode);
      break;
    }
    case "span": {
      const span = createScopedElement(ownerDocument, "span");
      applyCitationTextStyle(span, node.style);
      for (const child of node.children) {
        renderCitationNode(child, span, ownerDocument);
      }
      parent.appendChild(span);
      break;
    }
    case "block": {
      const block = createScopedElement(ownerDocument, "div");
      block.classList.add(`feuillets-csl-${node.display}`);
      for (const child of node.children) {
        renderCitationNode(child, block, ownerDocument);
      }
      parent.appendChild(block);
      break;
    }
    case "link": {
      if (isSafeCitationUrl(node.href)) {
        const anchor = createScopedElement(ownerDocument, "a");
        anchor.href = node.href.trim();
        anchor.classList.add("feuillets-csl-link");
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
        for (const child of node.children) {
          renderCitationNode(child, anchor, ownerDocument);
        }
        parent.appendChild(anchor);
      } else {
        // Unsafe href: render children inside a neutral non-clickable span
        const disabledSpan = createScopedElement(ownerDocument, "span");
        disabledSpan.classList.add("feuillets-csl-link-disabled");
        for (const child of node.children) {
          renderCitationNode(child, disabledSpan, ownerDocument);
        }
        parent.appendChild(disabledSpan);
      }
      break;
    }
  }
}

/**
 * Renders an array of CitationRenderNode into a caller-provided container Node.
 */
export function renderCitationNodes(
  nodes: readonly CitationRenderNode[],
  container: Node,
  ownerDocument: Document
): void {
  for (const node of nodes) {
    renderCitationNode(node, container, ownerDocument);
  }
}
