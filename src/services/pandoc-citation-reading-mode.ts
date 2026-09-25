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

import { MarkdownRenderChild, MarkdownView, normalizePath, TFile, type App, type MarkdownPostProcessorContext } from "obsidian";
import {
  buildPandocCitationElement,
  disposePandocCitationElement,
  loadPandocCitationCatalog,
  resolvePandocCitationPreviewForFile,
  splitPandocCitationSegments,
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
 * the node alone if it holds no recognized citation. Appends every citation
 * element it builds to `built` — the caller collects these across the whole
 * render pass to register their teardown (see registerPandocCitationReadingMode()).
 *
 * `{ narrative: true }`: bracket-less `@key` citations are recognized here
 * too, same as Live Preview and Continu — see splitPandocCitationSegments()'s
 * own doc comment. `collectEligibleTextNodes()` below already keeps this
 * function from ever seeing text inside CODE/PRE/SCRIPT/STYLE/A, so neither
 * form is ever transformed there.
 *
 * `textNode.ownerDocument` (never the global `document`) is passed to
 * buildPandocCitationElement() so the citation element is built in the SAME
 * document as `textNode` itself — the main window's document for an
 * ordinary pane, but a SEPARATE document for a pane popped out into its own
 * OS window (see that function's doc comment). Never `innerHTML`.
 */
function wrapCitationsInTextNode(textNode: Text, catalog: PandocCitationCatalog, built: HTMLElement[]): void {
  const source = textNode.nodeValue || "";
  const segments = splitPandocCitationSegments(source, catalog.entries, { narrative: true });
  if (!segments.some((segment) => segment.kind === "citation")) return;

  const parent = textNode.parentElement;
  const doc = textNode.ownerDocument;
  if (!parent || !doc) return;

  for (const segment of segments) {
    if (segment.kind === "text") {
      if (segment.text) parent.insertBefore(doc.createTextNode(segment.text), textNode);
      continue;
    }
    const citation = buildPandocCitationElement(segment.text, segment.citekeys, catalog.records, doc);
    built.push(citation);
    parent.insertBefore(citation, textNode);
  }

  parent.removeChild(textNode);
}

/**
 * Wrap every recognized citation found under `root` in a `.feuillets-pandoc-citation`
 * element, and return every citation element built — the caller disposes them
 * on rerender/unload (see registerPandocCitationReadingMode()). Exported for
 * direct unit testing; production use goes through
 * registerPandocCitationReadingMode() below.
 */
export function wrapPandocCitationsInElement(root: HTMLElement, catalog: PandocCitationCatalog): HTMLElement[] {
  const targets: Text[] = [];
  collectEligibleTextNodes(root, targets);
  const built: HTMLElement[] = [];
  for (const textNode of targets) {
    wrapCitationsInTextNode(textNode, catalog, built);
  }
  return built;
}

/**
 * Disposes every citation element built for one post-processor render pass
 * once `containerEl` (the post-processed `el`) is detached — a rerender
 * (leaf.view.previewMode?.rerender(true), below) replaces it wholesale, and
 * closing the pane detaches it too. Without this, a tooltip's temporary
 * window-level scroll/resize listeners (see disposePandocCitationElement(),
 * pandoc-citation-preview.ts) would leak if left open at that exact moment.
 */
class PandocCitationCleanupChild extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly citations: readonly HTMLElement[]
  ) {
    super(containerEl);
  }

  onunload(): void {
    for (const citation of this.citations) disposePandocCitationElement(citation);
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

    const citations = wrapPandocCitationsInElement(el, catalog);
    if (citations.length > 0) ctx.addChild(new PandocCitationCleanupChild(el, citations));
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
