import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { TextAnalysisIssue, TextAnalysisProvider } from "../api/text-analysis.js";
import { openIssueContextMenu, type ContextMenuHost, type EditorCorrectionTarget } from "../services/grammar-context-menu.js";
import { analyzeText } from "../services/text-analysis.js";

type DecorationSet = Record<string, unknown> & {
  map?(changes: unknown): DecorationSet;
  update?(spec: { filter(from: number, to: number): boolean }): DecorationSet;
};

interface StateEffectType<T> {
  of(value: T): unknown;
}

interface StateEffectStatic { define<T = unknown>(): StateEffectType<T>; }

interface GrammarTransaction {
  effects: Array<{ is(type: unknown): boolean; value: unknown }>;
  docChanged: boolean;
  state: { doc: { length: number } };
  changes?: { mapPos?(position: number, association?: number): number; touchesRange?(from: number, to: number): boolean };
}

interface StateFieldInstance<T> {
  create(): T;
  update(value: T, tr: GrammarTransaction): T;
}

interface StateFieldStatic {
  define<T>(config: StateFieldInstance<T> & { provide?: (field: unknown) => unknown }): StateFieldInstance<T>;
}

interface DecorationRange { from: number; to: number; attributes?: Record<string, string>; }

interface DecorationStatic {
  none: DecorationSet;
  mark(spec: { class?: string; attributes?: Record<string, string> }): { range(from: number, to: number): DecorationRange };
  set(of: DecorationRange[], sort?: boolean): DecorationSet;
}

interface GrammarEditorView {
  dom?: Node;
  state: {
    doc: { length: number; toString(): string };
    field(field: typeof grammarIssuesField, required?: boolean): GrammarHighlightState | undefined;
  };
  dispatch(spec: { effects?: unknown; changes?: { from: number; to: number; insert: string }; selection?: { anchor: number } }): void;
  focus(): void;
}

interface EditorViewStatic {
  decorations: { from(field: unknown, get?: (value: GrammarHighlightState) => DecorationSet): unknown };
  domEventHandlers(handlers: Record<string, (event: Event, view: GrammarEditorView) => boolean | void>): unknown;
}

interface ViewPluginStatic {
  fromClass<T>(creator: new (view: GrammarEditorView) => T): unknown;
}

const StateEffectTyped = StateEffect as StateEffectStatic;
const StateFieldTyped = StateField as StateFieldStatic;
const DecorationTyped = Decoration as DecorationStatic;
const EditorViewTyped = EditorView as EditorViewStatic;
const ViewPluginTyped = ViewPlugin as ViewPluginStatic;

export type GrammarIssuesPayload = { issues: TextAnalysisIssue[]; filePath?: string; provider?: TextAnalysisProvider };

export type GrammarIssueEntry = {
  key: string;
  issue: TextAnalysisIssue;
  from: number;
  to: number;
  filePath: string;
  provider?: TextAnalysisProvider;
};

export type GrammarHighlightState = {
  decorations: DecorationSet;
  issues: Map<string, GrammarIssueEntry>;
  filePath: string;
  provider?: TextAnalysisProvider;
};

const emptyGrammarState = (): GrammarHighlightState => ({ decorations: DecorationTyped.none, issues: new Map(), filePath: "" });

export const setGrammarIssuesEffect = StateEffectTyped.define<GrammarIssuesPayload>();

function isSpellingIssue(issue: TextAnalysisIssue): boolean {
  return issue.canLearn === true || issue.category === "Orthographe";
}

function stateFromPayload(payload: GrammarIssuesPayload, docLength: number): GrammarHighlightState {
  const issues = new Map<string, GrammarIssueEntry>();
  const filePath = payload.filePath ?? "";

  payload.issues.forEach((issue, index) => {
    if (!Number.isInteger(issue.start) || !Number.isInteger(issue.end)) return;
    if (issue.start < 0 || issue.end > docLength || issue.start >= issue.end) return;
    const key = `grammar-${index}`;
    issues.set(key, { key, issue, from: issue.start, to: issue.end, filePath, provider: payload.provider });
  });
  return {
    decorations: decorationsFor(issues),
    issues,
    filePath,
    provider: payload.provider,
  };
}

function decorationsFor(issues: Map<string, GrammarIssueEntry>): DecorationSet {
  const decorations: DecorationRange[] = [];
  for (const entry of issues.values()) {
    const cls = isSpellingIssue(entry.issue)
      ? "feuillets-grammar-underline feuillets-grammar-underline-spelling"
      : "feuillets-grammar-underline feuillets-grammar-underline-grammar";
    decorations.push(DecorationTyped.mark({ class: cls, attributes: { "data-grammar-key": entry.key } }).range(entry.from, entry.to));
  }
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return decorations.length > 0 ? DecorationTyped.set(decorations, true) : DecorationTyped.none;
}

export const grammarIssuesField = StateFieldTyped.define<GrammarHighlightState>({
  create: emptyGrammarState,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGrammarIssuesEffect)) return stateFromPayload(effect.value as GrammarIssuesPayload, tr.state.doc.length);
    }
    if (!tr.docChanged) return value;
    const issues = new Map<string, GrammarIssueEntry>();
    for (const [key, entry] of value.issues) {
      if (tr.changes?.touchesRange?.(entry.from, entry.to)) continue;
      const from = tr.changes?.mapPos?.(entry.from, 1) ?? entry.from;
      const to = tr.changes?.mapPos?.(entry.to, -1) ?? entry.to;
      if (from < to) issues.set(key, { ...entry, from, to });
    }
    const mappedDecorations = value.decorations.update?.({
      filter: (from, to) => !tr.changes?.touchesRange?.(from, to),
    }).map?.(tr.changes) ?? decorationsFor(issues);
    return { ...value, decorations: mappedDecorations, issues };
  },
  provide: (field) => EditorViewTyped.decorations.from(field, (state) => state.decorations),
});

function stateFor(view: GrammarEditorView): GrammarHighlightState | null {
  try {
    return view.state.field(grammarIssuesField, false) ?? null;
  } catch {
    return null;
  }
}

function targetFor(host: ContextMenuHost, view: GrammarEditorView, entry: GrammarIssueEntry): EditorCorrectionTarget | null {
  const provider = entry.provider;
  if (!provider || host.getAnalysisProvider(provider.id) !== provider) return null;
  return {
    provider,
    isCurrent: () => {
      const state = stateFor(view);
      if (state?.issues.get(entry.key) !== entry || host.getAnalysisProvider(provider.id) !== provider) return false;
      return !entry.issue.text || view.state.doc.toString().slice(entry.from, entry.to) === entry.issue.text;
    },
    replace: (suggestion) => {
      const state = stateFor(view);
      if (!state || state.issues.get(entry.key) !== entry) return false;
      if (entry.from < 0 || entry.to > view.state.doc.length || entry.from >= entry.to) return false;
      if (entry.issue.text && view.state.doc.toString().slice(entry.from, entry.to) !== entry.issue.text) return false;
      view.dispatch({
        changes: { from: entry.from, to: entry.to, insert: suggestion },
        selection: { anchor: entry.from + suggestion.length },
      });
      return true;
    },
    focus: () => view.focus(),
    invalidate: () => clearGrammarHighlights(view),
    refresh: () => requestGrammarCheck(view),
  };
}

export const requestGrammarCheckEffect = StateEffectTyped.define<null>();

export function requestGrammarCheck(editorView: { dispatch(spec: { effects?: unknown }): void } | null | undefined): void {
  if (!editorView || typeof editorView.dispatch !== "function") return;
  try { editorView.dispatch({ effects: requestGrammarCheckEffect.of(null) }); } catch { /* vue détruite */ }
}

export type GrammarEditorFile = { path: string; basename: string; stat: { mtime: number } };

type CheckerHost = ContextMenuHost & {
  titleFor?(file: { basename: string }): string;
  grammarEditorFile?(view: GrammarEditorView): GrammarEditorFile | null;
};

function fileForView(host: CheckerHost, view: GrammarEditorView): GrammarEditorFile | null {
  const resolved = host.grammarEditorFile?.(view);
  if (resolved) return resolved;
  for (const leaf of host.app.workspace.getLeavesOfType("markdown")) {
    const candidate = leaf.view as unknown as { file?: GrammarEditorFile; editor?: unknown; contentEl?: HTMLElement };
    const cm = (candidate.editor as Record<string, unknown> | undefined)?.cm;
    if (cm === view || (view.dom instanceof Node && candidate.contentEl?.contains(view.dom))) return candidate.file ?? null;
  }
  return null;
}

export function grammarCheckerExtension(host: CheckerHost): unknown {
  return ViewPluginTyped.fromClass(class {
    private timer: number | null = null;
    private running = false;
    private pending = false;
    constructor(private readonly view: GrammarEditorView) { this.schedule(50); }
    update(update: { docChanged: boolean; transactions?: Array<{ effects?: Array<{ is(type: unknown): boolean }> }> }): void {
      const requested = update.transactions?.some((transaction) => transaction.effects?.some((effect) => effect.is(requestGrammarCheckEffect))) ?? false;
      if (update.docChanged) this.schedule(1000);
      else if (requested) this.schedule(50);
    }
    destroy(): void { if (this.timer) window.clearTimeout(this.timer); }
    private schedule(delay: number): void {
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => { this.timer = null; void this.check(); }, delay);
    }
    private async check(): Promise<void> {
      if (this.running) { this.pending = true; return; }
      const provider = host.getAnalysisProvider();
      const file = fileForView(host, this.view);
      if (!provider || !file) return;
      this.running = true;
      const text = this.view.state.doc.toString();
      try {
        const run = await analyzeText(provider, text, { filePath: file.path, fileTitle: host.titleFor?.(file) ?? file.basename, mtime: file.stat.mtime, source: "buffer" });
        if (this.view.state.doc.toString() === text && host.getAnalysisProvider(provider.id) === provider) {
          applyGrammarHighlights(this.view, run.issues, host, file.path, provider);
        }
      } catch {
        // L'analyse de fond reste silencieuse.
      } finally {
        this.running = false;
        if (this.pending) { this.pending = false; this.schedule(0); }
      }
    }
  });
}

export function grammarContextMenuExtension(host: ContextMenuHost) {
  const openMenu = (event: Event, view: GrammarEditorView): boolean => {
    const mouseEvent = event as MouseEvent;
    const element = mouseEvent.target instanceof HTMLElement ? mouseEvent.target : null;
    const target = element?.closest("[data-grammar-key]");
    const key = target?.getAttribute("data-grammar-key");
    if (!key) return false;
    const entry = stateFor(view)?.issues.get(key);
    if (!entry || !entry.filePath) return false;
    const correctionTarget = targetFor(host, view, entry);
    if (!correctionTarget || !correctionTarget.isCurrent()) return false;
    if (isSpellingIssue(entry.issue) && entry.issue.text && typeof entry.provider?.suggest === "function") {
      void Promise.resolve(entry.provider.suggest(entry.issue.text, entry.issue))
        .then((suggestions) => openIssueContextMenu(
          host,
          { ...entry.issue, suggestions: suggestions.filter((suggestion) => typeof suggestion === "string").slice(0, 10) },
          mouseEvent,
          entry.filePath,
          correctionTarget
        ))
        .catch(() => openIssueContextMenu(host, entry.issue, mouseEvent, entry.filePath, correctionTarget));
      return true;
    }
    openIssueContextMenu(host, entry.issue, mouseEvent, entry.filePath, correctionTarget);
    return true;
  };
  return EditorViewTyped.domEventHandlers({
    click: (event, view) => {
      const mouseEvent = event as MouseEvent;
      if (mouseEvent.button !== 0) return false;
      return openMenu(mouseEvent, view);
    },
  });
}

export function createGrammarCheckerExtension(host: CheckerHost): unknown[] {
  return [grammarIssuesField, grammarContextMenuExtension(host), grammarCheckerExtension(host)];
}

export function applyGrammarHighlights(
  editorView: { dispatch(spec: { effects?: unknown }): void } | null | undefined,
  issues: TextAnalysisIssue[] | null | undefined,
  host?: ContextMenuHost,
  filePath?: string,
  provider?: TextAnalysisProvider
): void {
  void host;
  if (!editorView || typeof editorView.dispatch !== "function") return;
  try {
    editorView.dispatch({ effects: setGrammarIssuesEffect.of({ issues: issues ?? [], filePath, provider }) });
  } catch {
    // Une vue détruite ne doit pas interrompre l'édition.
  }
}

export function clearGrammarHighlights(editorView: { dispatch(spec: { effects?: unknown }): void } | null | undefined): void {
  applyGrammarHighlights(editorView, []);
}
