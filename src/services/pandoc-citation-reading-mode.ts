import { buildNoteAwarePandocCitationDocument } from "./pandoc-citation-notes.js";
import { footnoteDefinitions, isFootnoteSection } from "./footnote-dom.js";
import type { ParsedPandocCitationOccurrence } from "./pandoc-citation-parser.js";
/**
 * Reading Mode rendering of Pandoc citekeys, via registerMarkdownPostProcessor().
 *
 * Legacy author-date uses the shared catalog and tooltip renderer. Native CSL
 * uses the same complete-document host, parser and safe AST as Live Preview.
 *
 * `ctx.sourcePath` resolves the file THIS post-processor call is rendering —
 * never a globally active file — so two Reading Mode panes open on different
 * files (e.g. one in Work-A, one in Work-A-Extra) resolve their own scope
 * independently.
 */

import { MarkdownRenderChild, MarkdownView, normalizePath, TFile, type App, type MarkdownPostProcessorContext } from "obsidian";
import { CslCitationHost, isUsableCslSnapshot, type CslHostInvalidation, type CslHostReadySnapshot } from "./csl-citation-host.js";
import { renderCitationNodes } from "./citation-render-nodes.js";
import { getProjectFolder } from "./folder-structure.js";
import { resolveWorkspaceCitationResources } from "./workspace-citations.js";
import {
  buildPandocCitationElement,
  createPandocCitationSpan,
  disposePandocCitationElement,
  loadPandocCitationCatalog,
  resolvePandocCitationPreviewForFile,
  splitPandocCitationSegments,
  type PandocCitationCatalog,
} from "./pandoc-citation-preview.js";
import { STATIC_RENDER_ATTR, STATIC_RENDER_ATTR_VALUE } from "./pandoc-citation-static-csl.js";

export type PandocCitationReadingModePlugin = {
  app: App;
  settings: FeuilletsSettings;
  cslCitationHost?: CslCitationHost | null;
  register?(cleanup: () => void): void;
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
  const coordinator = plugin.cslCitationHost ? new ReadingCslCoordinator(plugin, plugin.cslCitationHost) : null;
  if (coordinator) {
    readingCoordinators.set(plugin, coordinator);
    plugin.register?.(() => coordinator.dispose());
  }
  plugin.registerMarkdownPostProcessor(async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (el.getAttribute?.(STATIC_RENDER_ATTR) === STATIC_RENDER_ATTR_VALUE || el.closest?.(`[${STATIC_RENDER_ATTR}='${STATIC_RENDER_ATTR_VALUE}']`)) {
      return;
    }
    if (typeof ctx.sourcePath !== "string" || !ctx.sourcePath.trim()) return;
    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) {
      coordinator?.disposeContext(ctx);
      return;
    }

    const { style, bibliographyPath } = resolvePandocCitationPreviewForFile(plugin.app, plugin.settings, file);
    if (style === "csl") {
      if (coordinator && !coordinator.acceptContext(el, ctx)) return;
      await coordinator?.process(el, ctx, file);
      return;
    }
    coordinator?.disposeContext(ctx);
    if (style !== "author-date") return;
    const catalog = await loadPandocCitationCatalog(plugin.app, style, bibliographyPath);
    if (!catalog) return;

    const citations = wrapPandocCitationsInElement(el, catalog);
    if (citations.length > 0) ctx.addChild(new PandocCitationCleanupChild(el, citations));
  });
}

/**
 * One coalesced refresh path for resource events, host invalidations and
 * settings transitions. A global refresh includes "off" views so transitions
 * out of CSL remove previously rendered markup. Resource refreshes resolve
 * each view's own scope; targeted host refreshes use its logical document ID.
 */
export function refreshPandocCitationReadingModeViews(
  plugin: PandocCitationReadingModeRefreshPlugin,
  resourceFile?: TFile,
  invalidation?: CslHostInvalidation
): void {
  const coordinator = readingCoordinators.get(plugin);
  const resourcePath = resourceFile ? normalizePath(resourceFile.path) : null;
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    if (!(leaf.view instanceof MarkdownView)) continue;
    const file = leaf.view.file;
    if (!file) continue;
    // Reading Mode only: an editing pane's (invisible) preview cache is not
    // worth re-rendering, and "rafraîchir uniquement les vues Lecture" is exact.
    if (typeof leaf.view.getMode === "function" && leaf.view.getMode() !== "preview") continue;

    const { style, bibliographyPath } = resolvePandocCitationPreviewForFile(plugin.app, plugin.settings, file);
    if (resourcePath) {
      if (style === "off") continue;
      if (style === "author-date" && normalizePath(bibliographyPath) !== resourcePath) continue;
      if (style === "csl") {
        const project = getProjectFolder(plugin.app, plugin.settings);
        if (!project) continue;
        const resources = resolveWorkspaceCitationResources(plugin.app, plugin.settings, project, file);
        const paths = [resources.bibliography, resources.csl].map((resource) =>
          resource.file?.path ?? (resource.researchFolder && resource.relativePath
            ? `${resource.researchFolder.path}/${resource.relativePath}` : "")
        );
        if (!paths.some((path) => normalizePath(path) === resourcePath)) continue;
      }
    }
    if (invalidation?.documentIds && !coordinator?.isAffected(leaf.view, invalidation.documentIds)) continue;
    coordinator?.invalidatePath(file.path);
    queueReadingRerender(plugin, leaf.view);
  }
}

const readingCoordinators = new WeakMap<PandocCitationReadingModeRefreshPlugin, ReadingCslCoordinator>();
const queuedReadingViews = new WeakMap<PandocCitationReadingModeRefreshPlugin, Set<MarkdownView>>();

/** One refresh queue for legacy bibliography events, host events and settings. */
function queueReadingRerender(plugin: PandocCitationReadingModeRefreshPlugin, view: MarkdownView): void {
  let queued = queuedReadingViews.get(plugin);
  if (!queued) {
    queued = new Set();
    queuedReadingViews.set(plugin, queued);
  }
  if (queued.has(view)) return;
  queued.add(view);
  queueMicrotask(() => {
    if (!queued.delete(view)) return;
    if (!plugin.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === view)) return;
    if (view.getMode() === "preview") view.previewMode?.rerender(true);
  });
}

interface ReadingCslRender {
  expectedSource: string;
  promise: Promise<{ source: string; snapshot: CslHostReadySnapshot } | null>;
}

interface ReadingCslSession {
  contextId: string;
  documentId: string;
  path: string;
  ownerDocument: Document;
  sections: Map<HTMLElement, ReadingCslCleanupChild>;
  render: ReadingCslRender | null;
}

class ReadingCslCleanupChild extends MarkdownRenderChild {
  active = true;

  constructor(container: HTMLElement, private readonly release: () => void) {
    super(container);
  }

  onunload(): void {
    if (!this.active) return;
    this.active = false;
    this.release();
  }
}

/** Public renderer-context coordination; provider sessions remain Host-owned. */
class ReadingCslCoordinator {
  private readonly sessions = new Map<string, ReadingCslSession>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly plugin: PandocCitationReadingModePlugin, private readonly host: CslCitationHost) {
    this.unsubscribe = host.onInvalidation((event) => {
      for (const session of this.sessions.values()) {
        if (event.documentIds === null || event.documentIds.has(session.documentId)) this.invalidateSession(session);
      }
      refreshPandocCitationReadingModeViews(plugin, undefined, event);
    });
  }

  private drop(contextId: string): void {
    const session = this.sessions.get(contextId);
    if (!session) return;
    session.render = null;
    this.sessions.delete(contextId);
    this.host.disposeDocument(session.documentId);
  }

  isAffected(view: MarkdownView, ids: ReadonlySet<string>): boolean {
    const path = normalizePath(view.file?.path ?? "");
    // File paths select views to refresh, never sessions to share. All panes
    // of an affected saved file use the same resolved resources/settings.
    return [...this.sessions.values()].some((session) => session.path === path && ids.has(session.documentId));
  }

  private invalidateSession(session: ReadingCslSession): void {
    session.render = null;
    this.host.disposeDocument(session.documentId);
  }

  invalidatePath(path: string): void {
    const normalized = normalizePath(path);
    for (const session of this.sessions.values()) {
      if (session.path === normalized) this.invalidateSession(session);
    }
  }

  acceptContext(el: HTMLElement, ctx: MarkdownPostProcessorContext): boolean {
    if (this.disposed || typeof ctx.docId !== "string" || !ctx.docId.trim()
      || typeof ctx.sourcePath !== "string" || !ctx.sourcePath.trim()) return false;
    const session = this.sessions.get(ctx.docId);
    if (!session) return true;
    if (session.ownerDocument !== el.ownerDocument) return false;
    if (session.path !== normalizePath(ctx.sourcePath)) this.drop(ctx.docId);
    return true;
  }

  disposeContext(ctx: MarkdownPostProcessorContext): void {
    this.drop(ctx.docId);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    queuedReadingViews.get(this.plugin)?.clear();
    for (const contextId of this.sessions.keys()) this.drop(contextId);
    readingCoordinators.delete(this.plugin);
  }

  async process(el: HTMLElement, ctx: MarkdownPostProcessorContext, file: TFile): Promise<void> {
    if (this.disposed) return;
    let info = ctx.getSectionInfo?.(el);
    if (!info && findFootnoteSection(el)) {
      try {
        const text = await this.plugin.app.vault.read(file);
        info = { text, lineStart: 0, lineEnd: text.split("\n").length - 1 };
      } catch { return; }
    }
    const project = getProjectFolder(this.plugin.app, this.plugin.settings);
    if (!info || !project) return;

    const contextId = ctx.docId;
    const path = normalizePath(ctx.sourcePath);
    let session = this.sessions.get(contextId);
    if (!session) {
      session = { contextId, documentId: `reading-mode:${contextId}:${path}`, path,
        ownerDocument: el.ownerDocument, sections: new Map(), render: null };
      this.sessions.set(contextId, session);
    }
    const currentSession = session;
    let child = session.sections.get(el);
    if (!child) {
      child = new ReadingCslCleanupChild(el, () => {
        currentSession.sections.delete(el);
        if (currentSession.sections.size === 0 && this.sessions.get(contextId) === currentSession) this.drop(contextId);
      });
      session.sections.set(el, child);
      ctx.addChild(child);
    }

    if (!session.render || session.render.expectedSource !== info.text) {
      const render: ReadingCslRender = { expectedSource: info.text, promise: Promise.resolve(null) };
      session.render = render;
      render.promise = (async () => {
        try {
          const source = await this.plugin.app.vault.read(file);
          if (source !== render.expectedSource || session.render !== render || this.disposed) return null;
          const snapshot = await this.host.renderDocument(session.documentId, source, project, file, {
            includeBibliography: false,
          });
          if (snapshot.status !== "ready" || !isUsableCslSnapshot(snapshot)) return null;
          return { source, snapshot };
        } catch {
          return null;
        }
      })();
    }
    const render = session.render;
    const result = await render.promise;
    if (!result || !child.active || this.disposed || session.render !== render || this.sessions.get(contextId) !== session) return;
    if (ctx.docId !== contextId || typeof ctx.sourcePath !== "string"
      || normalizePath(ctx.sourcePath) !== path || file.path !== path) return;
    // Re-read section metadata immediately before mapping; never trust ranges
    // captured before an asynchronous Vault/provider operation.
    const currentInfo = ctx.getSectionInfo(el) ?? (findFootnoteSection(el) ? info : null);
    if (!currentInfo || currentInfo.text !== result.source) return;
    wrapCslReadingSection(el, result.source, currentInfo.lineStart, currentInfo.lineEnd, result.snapshot);
  }
}

/**
 * Match complete raw syntax in a verified source section, including literal
 * copies in protected contexts. Equal counts and source/DOM order are required;
 * missing, split or reordered text fails closed. No local cluster IDs are made.
 */
function wrapCslReadingSection(
  root: HTMLElement, source: string, lineStart: number, lineEnd: number, snapshot: CslHostReadySnapshot
): void {
  const noteAware = buildNoteAwarePandocCitationDocument(source);
  const noteSection = findFootnoteSection(root);
  const definitions = footnoteDefinitions(noteSection ?? root);
  const allOccurrences = snapshot.parsedDocument.occurrences;
  for (const definition of definitions) {
    if (!containsElement(root, definition) && !containsElement(definition, root)) continue;
    const nativeId = definition.getAttribute("data-footnote-id") ?? definition.getAttribute("id") ?? "";
    const nativeNumber = /^fn-(\d+)(?:-|$)/.exec(nativeId);
    const noteIndex = nativeNumber ? Number(nativeNumber[1]) : definitions.indexOf(definition) + 1;
    const context = noteAware.notes.find((note) => note.noteIndex === noteIndex);
    if (!context) continue;
    wrapCslReadingRange(definition as HTMLElement, source, context.bodyFrom, context.bodyTo,
      allOccurrences.filter((occurrence) => occurrence.cluster.noteIndex === noteIndex), snapshot, true);
  }
  if (noteSection) return;
  // Obsidian's synthetic footnotes section can lie beyond the source lines.
  // Only body citations depend on the postprocessor's section coordinates.
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 0 || lineEnd < lineStart) return;
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  if (lineEnd >= starts.length) return;
  const from = starts[lineStart];
  const to = lineEnd + 1 < starts.length ? starts[lineEnd + 1] : source.length;
  const bodySource = noteAware.notes.reduce((text, note) =>
    text.slice(0, note.bodyFrom) + " ".repeat(note.bodyTo - note.bodyFrom) + text.slice(note.bodyTo), source);
  wrapCslReadingRange(root, bodySource, from, to,
    allOccurrences.filter((occurrence) => occurrence.cluster.noteIndex === undefined && occurrence.from >= from && occurrence.to <= to), snapshot, false);
}

function containsElement(root: Element, element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) if (current === root) return true;
  return false;
}

function findFootnoteSection(root: Element): Element | null {
  for (let element: Element | null = root; element; element = element.parentElement) if (isFootnoteSection(element)) return element;
  return null;
}

function wrapCslReadingRange(
  root: HTMLElement, source: string, from: number, to: number,
  occurrences: readonly ParsedPandocCitationOccurrence[], snapshot: CslHostReadySnapshot, insideNote: boolean
): void {
  const section = source.slice(from, to);
  const texts: { node: Text; protected: boolean }[] = [];
  const isProtected = (element: Element): boolean => PROTECTED_TAGS.has(element.tagName)
    || ["internal-embed", "feuillets-csl-citation", "callout", ...(insideNote ? [] : ["footnotes"])].some((name) => element.classList.contains(name));
  for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (isProtected(ancestor)) return;
  }
  const collect = (node: Node, protectedContext: boolean): void => {
    if (node.nodeType === 3) {
      texts.push({ node: node as Text, protected: protectedContext });
    } else if (node.nodeType === 1) {
      const element = node as Element;
      const blocked = protectedContext || isProtected(element);
      for (const child of Array.from(node.childNodes)) collect(child, blocked);
    }
  };
  collect(root, false);
  const replacements: { node: Text; index: number; from: number; raw: string; clusterId: string; order: number }[] = [];
  for (const raw of new Set(occurrences.map((occ) => occ.raw))) {
    const sourcePositions: number[] = [];
    for (let index = section.indexOf(raw); index >= 0; index = section.indexOf(raw, index + raw.length)) {
      sourcePositions.push(from + index);
    }
    const matches: { node: Text; index: number; protected: boolean; order: number }[] = [];
    texts.forEach((text, order) => {
      const value = text.node.nodeValue ?? "";
      for (let index = value.indexOf(raw); index >= 0; index = value.indexOf(raw, index + raw.length)) {
        matches.push({ ...text, index, order });
      }
    });
    if (sourcePositions.length !== matches.length) continue;
    for (const occ of occurrences.filter((occ) => occ.raw === raw)) {
      const match = matches[sourcePositions.indexOf(occ.from)];
      if (!match) return;
      if (!match.protected) replacements.push({ ...match, raw, from: occ.from, clusterId: occ.clusterId });
    }
  }
  replacements.sort((a, b) => a.from - b.from);
  for (let i = 1; i < replacements.length; i++) {
    const previous = replacements[i - 1];
    const current = replacements[i];
    if (previous.order > current.order || (previous.order === current.order && previous.index + previous.raw.length > current.index)) return;
  }
  // Build every AST before touching the section so failures cannot partially
  // rewrite the fragment. The host has already validated the document result.
  const built = replacements.map((replacement) => {
    const citation = snapshot.citationByClusterId.get(replacement.clusterId);
    if (!citation) return null;
    const doc = replacement.node.ownerDocument;
    const span = createPandocCitationSpan(doc, "feuillets-csl-citation");
    span.setAttribute("data-cluster-id", replacement.clusterId);
    renderCitationNodes(citation.content, span, doc);
    return { ...replacement, span };
  });
  for (const text of texts) {
    const parts = built.filter((part): part is NonNullable<typeof part> => part !== null && part.node === text.node);
    if (!parts.length) continue;
    const parent = text.node.parentNode;
    if (!parent) continue;
    const doc = text.node.ownerDocument;
    const value = text.node.nodeValue ?? "";
    let offset = 0;
    for (const part of parts) {
      parent.insertBefore(doc.createTextNode(value.slice(offset, part.index)), text.node);
      parent.insertBefore(part.span, text.node);
      offset = part.index + part.raw.length;
    }
    parent.insertBefore(doc.createTextNode(value.slice(offset)), text.node);
    parent.removeChild(text.node);
  }
}
