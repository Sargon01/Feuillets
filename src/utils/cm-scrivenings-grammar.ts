import type { TFile } from "obsidian";
import type { TextAnalysisProvider } from "../api/text-analysis.js";
import type { ContextMenuHost } from "../services/grammar-context-menu.js";
import { analyzeText } from "../services/text-analysis.js";
import type { ScriveningsDocument } from "../services/scrivenings-document.js";
import {
  applyMappedGrammarHighlights,
  clearGrammarHighlightsForFile,
  grammarContextMenuExtension,
  grammarIssuesField,
  GRAMMAR_CHECK_DEBOUNCE_MS,
} from "./cm-grammar-highlighter.js";

type GrammarEditorView = {
  state: { doc: { length: number; toString(): string } };
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

export class ScriveningsGrammarChecker {
  private readonly pendingPaths = new Set<string>();
  private timer: number | null = null;
  private running = false;
  private generation = 0;

  constructor(private readonly options: ScriveningsGrammarOptions) {}

  extensions(): unknown[] {
    const host: ContextMenuHost = {
      app: this.options.host.app,
      getAnalysisProvider: (providerId) => this.options.host.getAnalysisProvider?.(providerId) ?? null,
      analyzeActiveFile: async () => {},
      activeEditorAnywhere: () => null,
      clearGrammarIssuesForFile: (path) => clearGrammarHighlightsForFile(this.options.getEditor(), path),
      requestGrammarCheckForFile: (path, refreshAll) => this.request(refreshAll ? undefined : [path], 0),
    };
    return [grammarIssuesField, grammarContextMenuExtension(host)];
  }

  reset(): void {
    this.generation += 1;
    this.cancelTimer();
    this.pendingPaths.clear();
    const document = this.options.getDocument();
    if (document) this.request(document.segments.map((segment) => segment.path), 50);
  }

  request(paths?: readonly string[], delay = 50): void {
    const document = this.options.getDocument();
    if (!document) return;
    for (const path of paths ?? document.segments.map((segment) => segment.path)) this.pendingPaths.add(path);
    this.schedule(delay);
  }

  requestTouched(paths: readonly string[]): void {
    for (const path of paths) this.pendingPaths.add(path);
    this.schedule(GRAMMAR_CHECK_DEBOUNCE_MS);
  }

  destroy(): void {
    this.generation += 1;
    this.cancelTimer();
    this.pendingPaths.clear();
  }

  private cancelTimer(): void {
    if (this.timer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.timer);
    }
    this.timer = null;
  }

  private schedule(delay: number): void {
    this.cancelTimer();
    if (typeof window === "undefined") return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    const editor = this.options.getEditor();
    const document = this.options.getDocument();
    const provider = this.options.host.getAnalysisProvider?.();
    if (!editor || !document) return;
    if (!provider) {
      for (const segment of document.segments) clearGrammarHighlightsForFile(editor, segment.path);
      return;
    }
    const paths = [...this.pendingPaths];
    this.pendingPaths.clear();
    if (paths.length === 0) return;
    const generation = this.generation;
    this.running = true;
    try {
      for (const path of paths) {
        const segment = this.options.getDocument()?.segments.find((entry) => entry.path === path);
        if (!segment) continue;
        const body = segment.body;
        try {
          const run = await analyzeText(provider, body, {
            filePath: segment.file.path,
            fileTitle: this.options.host.titleFor?.(segment.file) ?? segment.file.basename,
            mtime: segment.file.stat.mtime,
            source: "buffer",
          });
          this.installIfCurrent(generation, provider, path, body, run.issues);
        } catch {
          // L'analyse de fond reste silencieuse.
        }
      }
    } finally {
      this.running = false;
      if (this.pendingPaths.size > 0) this.schedule(0);
    }
  }

  private installIfCurrent(
    generation: number,
    provider: TextAnalysisProvider,
    path: string,
    body: string,
    issues: Awaited<ReturnType<typeof analyzeText>>["issues"],
  ): void {
    if (generation !== this.generation || this.options.host.getAnalysisProvider?.(provider.id) !== provider) return;
    const editor = this.options.getEditor();
    const segment = this.options.getDocument()?.segments.find((entry) => entry.path === path);
    if (!editor || !segment || segment.body !== body) return;
    const valid = issues.filter((issue) =>
      issue.start >= 0 && issue.end > issue.start && issue.end <= segment.body.length
        && segment.from + issue.start >= segment.from && segment.from + issue.end <= segment.to
    );
    applyMappedGrammarHighlights(editor, valid, segment.path, segment.from, provider);
  }
}
