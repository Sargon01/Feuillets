import type { TFile } from "obsidian";
import { ViewPlugin } from "@codemirror/view";
import type { TextAnalysisProvider } from "../api/text-analysis.js";
import type { ContextMenuHost } from "../services/grammar-context-menu.js";
import { analyzeText } from "../services/text-analysis.js";
import type { ScriveningsDocument, ScriveningsSegment } from "../services/scrivenings-document.js";
import {
  clearGrammarHighlightsForFile,
  grammarContextMenuExtension,
  grammarIssuesField,
  GRAMMAR_CHECK_DEBOUNCE_MS,
  replaceGrammarWindow,
  setGrammarWindowEffect,
  setGrammarIssuesEffect,
  type GrammarIssuesPayload,
} from "./cm-grammar-highlighter.js";

// Performance reference only: mpeterschmitt/grammalecte-obsidian checks on
// docChanged, debounces, caps text at 60000, replaces one DecorationSet and
// uses a Worker. Continu keeps the existing provider/Worker, but checks a
// segmented working window after scrolling STOPS, never a manuscript scan.
export const SCRIVENINGS_GRAMMAR_VIEWPORT_DEBOUNCE_MS = 1000;
export const SCRIVENINGS_GRAMMAR_MAX_LIVE_SEGMENTS = 3;
export const SCRIVENINGS_GRAMMAR_MAX_BATCH_CHARACTERS = 60000;
export const SCRIVENINGS_GRAMMAR_CACHE_SEGMENTS = 12;
// Live Continu only: a sheet with hundreds of issues becomes unreadable and
// costly to decorate. Keep up to 300 valid issues; above that, suppress the
// entire sheet's live underlines and cache an overloaded sentinel instead.
// No language/category heuristic. Explicit Relecture still gets all issues.
export const SCRIVENINGS_LIVE_MAX_ISSUES_PER_SEGMENT = 300;
export const SCRIVENINGS_LIVE_MAX_ISSUES_TOTAL =
  SCRIVENINGS_LIVE_MAX_ISSUES_PER_SEGMENT * SCRIVENINGS_GRAMMAR_MAX_LIVE_SEGMENTS;
// Oversized sheets are skipped by automatic checking, without truncating
// their contents. Explicit Relecture remains available for those sheets.

type GrammarEditorView = {
  state: { doc: { length: number; toString(): string } };
  visibleRanges?: readonly { from: number; to: number }[];
  // Public geometry: visibleRanges includes CodeMirror's offscreen render
  // margin. Clip it to the actual scroller before applying the sheet bound.
  scrollDOM?: { clientHeight: number; getBoundingClientRect(): { top: number } };
  documentTop?: number;
  elementAtHeight?(height: number): { from: number; to: number };
  dispatch(spec: { effects?: unknown }): void;
  focus(): void;
};

type ScriveningsGrammarHost = ContextMenuHost & {
  getAnalysisProvider?(providerId?: string): TextAnalysisProvider | null;
  titleFor?(file: TFile): string;
};

type ScriveningsGrammarOptions = {
  host: ScriveningsGrammarHost;
  getEditor: () => GrammarEditorView | null;
  getDocument: () => ScriveningsDocument | null;
};

type CachedAnalysis = {
  body: string;
  provider: TextAnalysisProvider;
} & (
  | { status: "checked"; issues: Awaited<ReturnType<typeof analyzeText>>["issues"] }
  | { status: "overloaded"; issues: [] }
);

function liveAnalysis(
  body: string,
  provider: TextAnalysisProvider,
  returnedIssues: Awaited<ReturnType<typeof analyzeText>>["issues"],
): CachedAnalysis {
  const issues: Awaited<ReturnType<typeof analyzeText>>["issues"] = [];
  for (const issue of returnedIssues) {
    if (issue.start < 0 || issue.end <= issue.start || issue.end > body.length) continue;
    if (issues.length === SCRIVENINGS_LIVE_MAX_ISSUES_PER_SEGMENT) {
      // Stop collecting at the first valid issue above the limit. Never retain
      // the large provider result in the LRU, or treat overload as a failure
      // that should be retried on the next stabilized viewport.
      return { body, provider, status: "overloaded", issues: [] };
    }
    issues.push(issue);
  }
  return { body, provider, status: "checked", issues };
}

type InstalledSegment = { path: string; from: number; result: CachedAnalysis };

export class ScriveningsGrammarChecker {
  private timer: number | null = null;
  private running = false;
  private ready = false;
  // null = no job; undefined = final visible window; paths = edited sheets.
  // At most three paths, replaced (not accumulated) by viewport requests.
  private pendingPaths: readonly string[] | undefined | null = null;
  private generation = 0;
  private destroyed = false;
  private readonly cache = new Map<string, CachedAnalysis>();
  private installed: InstalledSegment[] = [];
  private snapshot: ScriveningsDocument | null = null;
  private segmentsByPath = new Map<string, ScriveningsSegment>();
  private provider: TextAnalysisProvider | null = null;

  constructor(private readonly options: ScriveningsGrammarOptions) {}

  extensions(): unknown[] {
    const onViewportChanged = () => this.viewportChanged();
    const onDestroy = () => this.destroy();
    const host: ContextMenuHost = {
      app: this.options.host.app,
      getAnalysisProvider: (providerId) => this.options.host.getAnalysisProvider?.(providerId) ?? null,
      analyzeActiveFile: async () => {},
      activeEditorAnywhere: () => null,
      clearGrammarIssuesForFile: (path) => {
        this.cache.delete(path);
        this.installed = this.installed.filter((entry) => entry.path !== path);
        clearGrammarHighlightsForFile(this.options.getEditor(), path);
      },
      requestGrammarCheckForFile: (path, refreshAll) => {
        if (refreshAll) this.refreshLive();
        else this.requestTouched([path]);
      },
    };
    const plugin = (ViewPlugin as { fromClass(creator: new () => unknown, spec: { eventHandlers: { scroll(): boolean } }): unknown }).fromClass(class {
      update(update: {
        viewportChanged: boolean;
        docChanged: boolean;
        transactions?: Array<{ effects?: Array<{ is(type: unknown): boolean }> }>;
      }): void {
        // Edits are scheduled by requestTouched after the session is updated.
        // Decoration transactions must never schedule checks themselves.
        const grammarUpdate = update.transactions?.some((transaction) => transaction.effects?.some((effect) =>
          effect.is(setGrammarWindowEffect) || effect.is(setGrammarIssuesEffect)
        ));
        if (update.viewportChanged && !update.docChanged && !grammarUpdate) onViewportChanged();
      }
      destroy(): void { onDestroy(); }
    }, { eventHandlers: { scroll: () => {
      // A scroll may stay inside the same rendered margin and produce no
      // viewportChanged update. Only replace the debounce, never analyse here.
      onViewportChanged();
      return false;
    } } });
    return [grammarIssuesField, grammarContextMenuExtension(host), plugin];
  }

  /** Invalidate live state only. Mount explicitly requests its visible area. */
  reset(): void {
    this.generation += 1;
    this.destroyed = false;
    this.cancelTimer();
    this.pendingPaths = null;
    this.ready = false;
    this.cache.clear();
    this.snapshot = null;
    this.segmentsByPath.clear();
    this.provider = this.options.host.getAnalysisProvider?.() ?? null;
    this.install([]);
  }

  /** Provider/dictionary changes invalidate cache, then refresh only live work. */
  refreshLive(): void {
    if (this.destroyed) return;
    this.reset();
    this.request();
  }

  /** Undefined always means the visible working window, never all segments. */
  request(paths?: readonly string[], delay = SCRIVENINGS_GRAMMAR_VIEWPORT_DEBOUNCE_MS): void {
    if (this.destroyed) return;
    if (paths) {
      this.requestTouched(paths);
      return;
    }
    this.generation += 1;
    this.pendingPaths = undefined;
    this.schedule(delay);
  }

  viewportChanged(): void {
    // Cheap bookkeeping only: no path lookup, provider call or dispatch here.
    this.request();
  }

  requestTouched(paths: readonly string[]): void {
    if (this.destroyed || paths.length === 0) return;
    this.generation += 1;
    for (const path of paths) this.cache.delete(path);
    const pending = new Set(this.pendingPaths ?? []);
    for (const path of paths) pending.add(path);
    this.pendingPaths = [...pending].slice(-SCRIVENINGS_GRAMMAR_MAX_LIVE_SEGMENTS);
    this.schedule(GRAMMAR_CHECK_DEBOUNCE_MS);
  }

  destroy(): void {
    this.reset();
    this.destroyed = true;
  }

  private cancelTimer(): void {
    if (this.timer !== null && typeof window !== "undefined") window.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay: number): void {
    this.cancelTimer();
    this.ready = false;
    if (typeof window === "undefined") return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.ready = true;
      void this.run();
    }, delay);
  }

  private segmentMap(): Map<string, ScriveningsSegment> {
    const document = this.options.getDocument();
    if (document !== this.snapshot) {
      this.snapshot = document;
      this.segmentsByPath = new Map(document?.segments.map((segment) => [segment.path, segment]) ?? []);
    }
    return this.segmentsByPath;
  }

  private bounded(segments: Iterable<ScriveningsSegment>): ScriveningsSegment[] {
    const result: ScriveningsSegment[] = [];
    let characters = 0;
    for (const segment of segments) {
      if (result.length === SCRIVENINGS_GRAMMAR_MAX_LIVE_SEGMENTS) break;
      if (segment.body.length > SCRIVENINGS_GRAMMAR_MAX_BATCH_CHARACTERS - characters) continue;
      result.push(segment);
      characters += segment.body.length;
    }
    return result;
  }

  private liveWindow(editor: GrammarEditorView): ScriveningsSegment[] {
    const segments = this.options.getDocument()?.segments ?? [];
    const visible = new Map<string, ScriveningsSegment>();
    let screen: { from: number; to: number } | null = null;
    if (editor.scrollDOM && editor.elementAtHeight && editor.documentTop !== undefined) {
      const { clientHeight } = editor.scrollDOM;
      if (clientHeight <= 0) return [];
      const top = editor.scrollDOM.getBoundingClientRect().top - editor.documentTop;
      screen = {
        from: editor.elementAtHeight(top).from,
        // Sample strictly inside the lower edge, not the following line.
        to: editor.elementAtHeight(top + clientHeight - 0.01).to,
      };
    }
    for (const range of editor.visibleRanges ?? []) {
      const from = Math.max(range.from, screen?.from ?? range.from);
      const to = Math.min(range.to, screen?.to ?? range.to);
      if (from >= to) continue;
      // Segments are ordered and disjoint. Binary lookup avoids scanning the
      // manuscript on each stabilized viewport, even with many tiny sheets.
      let low = 0;
      let high = segments.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        // Body/range intervals are [from, to): the valid caret at segment.to
        // does not make its body visible when only the next line is onscreen.
        if (segments[middle].to <= from) low = middle + 1;
        else high = middle;
      }
      for (let index = low; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment.from >= to) break;
        if (segment.from === segment.to) continue;
        visible.set(segment.path, segment);
        // Deterministic screen order, after clipping away the render margin:
        // the first three genuinely intersecting sheets, no added neighbours.
        if (visible.size === SCRIVENINGS_GRAMMAR_MAX_LIVE_SEGMENTS) return this.bounded(visible.values());
      }
    }
    return this.bounded(visible.values());
  }

  private isCurrent(generation: number, provider: TextAnalysisProvider, editor: GrammarEditorView): boolean {
    return !this.destroyed && generation === this.generation
      && this.options.getEditor() === editor
      && this.options.host.getAnalysisProvider?.() === provider;
  }

  private remember(path: string, result: CachedAnalysis): void {
    this.cache.delete(path);
    this.cache.set(path, result);
    if (this.cache.size > SCRIVENINGS_GRAMMAR_CACHE_SEGMENTS) {
      for (const oldest of this.cache.keys()) {
        this.cache.delete(oldest);
        break;
      }
    }
  }

  private async run(): Promise<void> {
    if (this.running || !this.ready || this.destroyed) return;
    this.ready = false;
    const requested = this.pendingPaths;
    this.pendingPaths = null;
    const editor = this.options.getEditor();
    const provider = this.options.host.getAnalysisProvider?.() ?? null;
    if (!editor || !this.options.getDocument() || requested === null) return;
    if (provider !== this.provider) {
      this.generation += 1;
      this.provider = provider;
      this.cache.clear();
      this.install([]);
    }
    if (!provider) return;
    const generation = this.generation;
    const map = this.segmentMap();
    const live = this.liveWindow(editor);
    const batch = requested === undefined ? live : this.bounded(
      requested.flatMap((path) => { const segment = map.get(path); return segment ? [segment] : []; })
    );
    this.running = true;
    try {
      for (const segment of batch) {
        if (!this.isCurrent(generation, provider, editor)) return;
        const cached = this.cache.get(segment.path);
        if (cached?.body === segment.body && cached.provider === provider) {
          this.remember(segment.path, cached);
          continue;
        }
        const body = segment.body;
        try {
          const run = await analyzeText(provider, body, {
            filePath: segment.file.path,
            fileTitle: this.options.host.titleFor?.(segment.file) ?? segment.file.basename,
            mtime: segment.file.stat.mtime,
            source: "buffer",
          });
          // One in-flight call may finish after invalidation. No subsequent
          // path may start, and neither its cache nor decorations are installed.
          if (!this.isCurrent(generation, provider, editor)) return;
          if (this.segmentMap().get(segment.path)?.body !== body) {
            this.requestTouched([segment.path]);
            return;
          }
          this.remember(segment.path, liveAnalysis(body, provider, run.issues));
        } catch {
          // L'analyse de fond reste silencieuse; a failed check is not cached.
          if (!this.isCurrent(generation, provider, editor)) return;
        }
      }
      if (!this.isCurrent(generation, provider, editor)) return;
      const current = this.segmentMap();
      const installed: InstalledSegment[] = [];
      for (const entry of live) {
        const segment = current.get(entry.path);
        const result = this.cache.get(entry.path);
        if (segment && result?.body === segment.body && result.provider === provider) {
          installed.push({ path: segment.path, from: segment.from, result });
        }
      }
      this.install(installed);
    } finally {
      this.running = false;
      // A newer timer that has not expired stays debounced. If it expired
      // while awaiting the provider, resume once, serialized with this call.
      if (this.ready && !this.destroyed) void this.run();
    }
  }

  private install(segments: InstalledSegment[]): void {
    if (segments.length === this.installed.length && segments.every((entry, index) => {
      const previous = this.installed[index];
      return entry.path === previous.path && entry.from === previous.from && entry.result === previous.result;
    })) return;
    this.installed = segments;
    let remaining = SCRIVENINGS_LIVE_MAX_ISSUES_TOTAL;
    const payloads: GrammarIssuesPayload[] = segments.map((entry) => {
      // A final window guard before the single StateEffect/DecorationSet
      // replacement. With three bounded sheets this normally never slices.
      const issues = entry.result.issues.length <= remaining
        ? entry.result.issues : entry.result.issues.slice(0, remaining);
      remaining -= issues.length;
      return { filePath: entry.path, offset: entry.from, provider: entry.result.provider, issues };
    });
    replaceGrammarWindow(this.options.getEditor(), payloads);
  }
}
