/**
 * Reading Mode rendering of Pandoc citekeys, via registerMarkdownPostProcessor().
 *
 * Same recognition and formatting as Live Preview and the plain-text rewrite
 * (splitPandocCitationSegments(), pandoc-citation-preview.ts), same notice
 * markup (buildCitationNoticeElement()) — so all three surfaces show exactly
 * the same citation text and the same bibliographic notice, and can never
 * silently disagree with each other.
 *
 * `ctx.sourcePath` resolves the file THIS post-processor call is rendering —
 * never a globally active file — so two Reading Mode panes open on different
 * files (e.g. one in Work-A, one in Work-A-Extra) resolve their own scope
 * independently.
 */

import { MarkdownView, normalizePath, TFile, type App, type MarkdownPostProcessorContext } from "obsidian";
import {
  loadPandocCitationCatalog,
  PANDOC_CITATION_CLASS,
  PANDOC_CITATION_LABEL_CLASS,
  resolvePandocCitationPreviewForFile,
  splitPandocCitationSegments,
  buildCitationNoticeElement,
  type PandocCitationCatalog,
} from "./pandoc-citation-preview.js";

export type PandocCitationReadingModePlugin = {
  app: App;
  settings: FeuilletsSettings;
  registerMarkdownPostProcessor(
    postProcessor: (el: HTMLElement, ctx: MarkdownPostProcessorContext) => Promise<void> | void,
    sortOrder?: number
  ): unknown;
};

/** Minimal surface needed to refresh already-rendered Reading Mode views —
 * registerMarkdownPostProcessor() is not needed here, unlike above. */
export type PandocCitationReadingModeRefreshPlugin = {
  app: App;
  settings: FeuilletsSettings;
};

const PROTECTED_TAGS: ReadonlySet<string> = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "A"]);

function collectEligibleTextNodes(node: Node, out: Text[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = (node as Text).parentElement;
    if (parent && !PROTECTED_TAGS.has(parent.tagName)) out.push(node as Text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  if (PROTECTED_TAGS.has(element.tagName)) return;
  for (let i = 0; i < node.childNodes.length; i++) {
    collectEligibleTextNodes(node.childNodes[i], out);
  }
}

/**
 * Replace one text node's recognized citation groups with real
 * `.feuillets-pandoc-citation` elements, leaving untouched text as-is. Leaves
 * the node alone if it holds no recognized citation.
 *
 * `createEl`/`.createSpan()` (global Obsidian helpers, never innerHTML): this
 * runs in the live Reading Mode DOM, the same realm as the rest of Obsidian, so
 * these helpers are always valid here — unlike PreviewView's iframe.
 */
function wrapCitationsInTextNode(textNode: Text, catalog: PandocCitationCatalog): void {
  const source = textNode.nodeValue || "";
  const segments = splitPandocCitationSegments(source, catalog.entries);
  if (!segments.some((segment) => segment.kind === "citation")) return;

  const parent = textNode.parentElement;
  const doc = textNode.ownerDocument;
  if (!parent || !doc) return;

  for (const segment of segments) {
    if (segment.kind === "text") {
      if (segment.text) parent.insertBefore(doc.createTextNode(segment.text), textNode);
      continue;
    }
    const citation = createSpan({ cls: PANDOC_CITATION_CLASS });
    citation.setAttribute("data-citekeys", segment.citekeys.join(","));
    citation.createSpan({ cls: PANDOC_CITATION_LABEL_CLASS, text: segment.text });
    const tooltip = buildCitationNoticeElement(segment.citekeys, catalog.records);
    if (tooltip) {
      citation.appendChild(tooltip);
      citation.setAttribute("tabindex", "0");
      citation.setAttribute("aria-describedby", tooltip.getAttribute("id") || "");
    }
    parent.insertBefore(citation, textNode);
  }

  parent.removeChild(textNode);
}

/**
 * Wrap every recognized citation found under `root` in a `.feuillets-pandoc-citation`
 * element. Exported for direct unit testing; production use goes through
 * registerPandocCitationReadingMode() below.
 */
export function wrapPandocCitationsInElement(root: HTMLElement, catalog: PandocCitationCatalog): void {
  const targets: Text[] = [];
  collectEligibleTextNodes(root, targets);
  for (const textNode of targets) {
    wrapCitationsInTextNode(textNode, catalog);
  }
}

/**
 * Registers the Reading Mode post-processor. Silently does nothing when the
 * rendered element's file cannot be resolved, or when no bibliography applies
 * to it (style "off", not configured, or unavailable) — Reading Mode then shows
 * the raw Pandoc syntax, exactly like Live Preview's Source mode.
 */
export function registerPandocCitationReadingMode(plugin: PandocCitationReadingModePlugin): void {
  plugin.registerMarkdownPostProcessor(async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const { style, bibliographyPath } = resolvePandocCitationPreviewForFile(plugin.app, plugin.settings, file);
    const catalog = await loadPandocCitationCatalog(plugin.app, style, bibliographyPath);
    if (!catalog) return;

    wrapPandocCitationsInElement(el, catalog);
  });
}

/**
 * Re-renders every currently open Reading Mode view whose resolved bibliography
 * is `bibFile` — never a view using a different one. Reading Mode has no
 * standing per-view subscription to unregister (unlike Live Preview's
 * ViewPlugin): each call freshly re-resolves every open markdown leaf's own
 * scope against `bibFile`'s path, so there is nothing to leak and nothing to
 * clean up on close.
 *
 * Call from a vault "modify" event (see main.ts), registered in the plugin's
 * own lifecycle so it is unregistered automatically on unload.
 */
export function refreshPandocCitationReadingModeViews(
  plugin: PandocCitationReadingModeRefreshPlugin,
  bibFile: TFile
): void {
  const normalizedBibPath = normalizePath(bibFile.path);
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    if (!(leaf.view instanceof MarkdownView)) continue;
    const file = leaf.view.file;
    if (!file) continue;
    // Reading Mode only: an editing pane's (invisible) preview cache is not
    // worth re-rendering, and "rafraîchir uniquement les vues Lecture" is exact.
    if (typeof leaf.view.getMode === "function" && leaf.view.getMode() !== "preview") continue;

    const { style, bibliographyPath } = resolvePandocCitationPreviewForFile(plugin.app, plugin.settings, file);
    if (style === "off" || !bibliographyPath) continue;
    if (normalizePath(bibliographyPath) !== normalizedBibPath) continue;

    leaf.view.previewMode?.rerender(true);
  }
}
