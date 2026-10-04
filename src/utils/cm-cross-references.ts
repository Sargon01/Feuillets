import { Decoration, ViewPlugin, WidgetType, EditorView } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { editorInfoField, editorLivePreviewField, type App, type TFile } from "obsidian";
import { getLocale } from "../i18n/index.js";
import { createCrossReferenceDetectionSession, crossReferenceEditorialScope, crossReferenceProjectSettings, resolveCrossReferencesInContext } from "../services/cross-reference-context.js";
import { loadCrossReferenceStore, type CrossReferenceContentReader } from "../services/cross-reference-store.js";
import { crossReferenceReplacements, compositeCrossReferenceReplacements, type CrossReferenceReplacement } from "../services/cross-reference-render.js";
import type { CompileScope } from "../services/compile-scope.js";
import type { ScriveningsDocument } from "../services/scrivenings-document.js";
import { selectionOverlaps, type CrossEditorSelection } from "./cm-selection-overlap.js";

interface CrossReferenceEditorView {
  state: {
    doc: { toString(): string; length: number };
    selection: CrossEditorSelection;
    field<T>(field: unknown, required?: boolean): T | undefined;
  };
  dom: HTMLElement;
  dispatch(spec: Record<string, unknown>): void;
}
interface CrossReferenceUpdate { view: CrossReferenceEditorView; docChanged?: boolean; selectionSet?: boolean }
interface DecorationStatic {
  none: unknown;
  replace(spec: { widget: WidgetType; inclusive: boolean }): { range(from: number, to: number): unknown };
  set(ranges: unknown[], sort: boolean): unknown;
}
interface PluginStatic {
  fromClass<T>(cls: new (view: CrossReferenceEditorView) => T, spec: { decorations?(value: T): unknown }): unknown;
}
const decorations = Decoration as DecorationStatic;
const plugins = ViewPlugin as PluginStatic;
const listeners = new WeakMap<App, Set<(delay: number, paths?: readonly string[]) => void>>();
export const CROSS_REFERENCE_DEBOUNCE_MS = 350;

export function notifyCrossReferenceEditors(app: App, delay = 0, paths?: readonly string[]): void {
  for (const listener of listeners.get(app) ?? []) listener(delay, paths);
}

export class CrossReferenceWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: WidgetType): boolean { return other instanceof CrossReferenceWidget && other.text === this.text; }
  toDOM(view?: { dom: HTMLElement }): HTMLElement {
    const span = (view?.dom.ownerDocument ?? document).createElement("span");
    span.textContent = this.text;
    return span;
  }
  ignoreEvent(): boolean { return false; }
}

export function visibleCrossReferenceReplacements(
  replacements: readonly CrossReferenceReplacement[], selection: CrossEditorSelection, livePreview: boolean,
): CrossReferenceReplacement[] {
  return livePreview ? replacements.filter((range) => !selectionOverlaps(selection, range.from, range.to)) : [];
}

export interface ContinuousCrossReferenceHost { scope: CompileScope; document: ScriveningsDocument }

/** A single text widget pipeline for native Markdown editors and continuous compositions. */
export function createCrossReferenceExtension(
  app: App, getSettings: () => FeuilletsSettings,
  readContent: CrossReferenceContentReader = (file) => app.vault.read(file),
  getContinuousHost?: () => ContinuousCrossReferenceHost | null,
): unknown {
  if (typeof plugins?.fromClass !== "function") return [];
  const setRows = (StateEffect as { define<T>(): { of(value: T): unknown } }).define<readonly CrossReferenceReplacement[]>();
  const build = (rows: readonly CrossReferenceReplacement[], state: CrossReferenceEditorView["state"]): unknown => decorations.set(
    visibleCrossReferenceReplacements(rows, state.selection, !!getContinuousHost || state.field<boolean>(editorLivePreviewField, false) !== false)
      .filter((range) => range.from >= 0 && range.to <= state.doc.length)
      .map((range) => decorations.replace({ widget: new CrossReferenceWidget(range.text), inclusive: false }).range(range.from, range.to)), true);
  type FieldValue = { rows: readonly CrossReferenceReplacement[]; decorations: unknown };
  const field = (StateField as { define<T>(spec: {
    create(): T;
    update(value: T, transaction: { docChanged: boolean; state: CrossReferenceEditorView["state"]; effects: readonly { is(type: unknown): boolean; value: readonly CrossReferenceReplacement[] }[] }): T;
    provide(field: unknown): unknown;
  }): unknown }).define<FieldValue>({
    create: () => ({ rows: [], decorations: decorations.none }),
    update(value, transaction) {
      let rows = transaction.docChanged ? [] : value.rows;
      for (const effect of transaction.effects) if (effect.is(setRows)) rows = effect.value;
      return { rows, decorations: build(rows, transaction.state) };
    },
    provide: (value) => (EditorView as { decorations: { from(field: unknown, get: (value: FieldValue) => unknown): unknown } }).decorations.from(value, (state) => state.decorations),
  });
  const plugin = plugins.fromClass(class {
    decorations: unknown = decorations.none;
    private replacements: CrossReferenceReplacement[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private generation = 0;
    private readonly contents = new Map<string, Promise<string>>();
    private readonly detect = createCrossReferenceDetectionSession();
    private destroyed = false;
    private filePath: string | null = null;
    private livePreview = true;
    private unsubscribe: () => void;

    constructor(private view: CrossReferenceEditorView) {
      this.filePath = view.state.field<{ file: TFile | null }>(editorInfoField, false)?.file?.path ?? null;
      this.livePreview = !!getContinuousHost || view.state.field<boolean>(editorLivePreviewField, false) !== false;
      let registered = listeners.get(app);
      if (!registered) { registered = new Set(); listeners.set(app, registered); }
      const listener = (delay: number, paths?: readonly string[]): void => {
        if (paths) for (const path of paths) this.contents.delete(path);
        else this.contents.clear();
        this.schedule(delay);
      };
      registered.add(listener);
      this.unsubscribe = () => registered.delete(listener);
      this.schedule(0);
    }

    update(update: CrossReferenceUpdate): void {
      this.view = update.view;
      const info = this.view.state.field<{ file: TFile | null }>(editorInfoField, false);
      const path = info?.file?.path ?? null;
      const live = getContinuousHost ? true : this.view.state.field<boolean>(editorLivePreviewField, false) !== false;
      if (update.docChanged || path !== this.filePath || live !== this.livePreview) {
        this.replacements = [];
        this.filePath = path;
        this.livePreview = live;
        if (update.docChanged && !getContinuousHost) notifyCrossReferenceEditors(app, CROSS_REFERENCE_DEBOUNCE_MS, path ? [path] : undefined);
        else this.schedule(update.docChanged ? CROSS_REFERENCE_DEBOUNCE_MS : 0);
      }
      this.rebuild();
    }

    destroy(): void {
      this.destroyed = true;
      this.generation++;
      if (this.timer !== null) clearTimeout(this.timer);
      this.unsubscribe();
      this.contents.clear();
    }

    private rebuild(): void {
      this.decorations = build(this.replacements, this.view.state);
    }

    private schedule(delay: number): void {
      this.generation++;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; void this.refresh(this.generation); }, delay);
    }

    private async refresh(generation: number): Promise<void> {
      if (this.destroyed) return;
      const source = this.view.state.doc.toString();
      const settings = getSettings();
      const host = getContinuousHost?.();
      const info = this.view.state.field<{ file: TFile | null }>(editorInfoField, false);
      const file = info?.file;
      const scope = getContinuousHost ? host?.scope ?? null : file ? crossReferenceEditorialScope(app, settings, file) : null;
      if (!scope || (!getContinuousHost && this.view.state.field<boolean>(editorLivePreviewField, false) === false)) {
        this.replacements = []; this.rebuild(); this.view.dispatch({ effects: setRows.of([]) }); return;
      }
      const read: CrossReferenceContentReader = async (target) => {
        const segment = host?.document.segments.find((entry) => entry.path === target.path);
        if (segment) return segment.frontmatter + segment.body;
        if (target.path === file?.path && !getContinuousHost) return source;
        let content = this.contents.get(target.path);
        if (!content) { content = readContent(target); this.contents.set(target.path, content); }
        return content;
      };
      try {
        const storeSettings = crossReferenceProjectSettings(app, settings, scope.projectRoot);
        const store = await loadCrossReferenceStore(app, storeSettings);
        const resolution = await resolveCrossReferencesInContext(app, settings, scope, store, read, this.detect);
        if (this.destroyed || generation !== this.generation || source !== this.view.state.doc.toString()) return;
        const local = crossReferenceReplacements(store, resolution, getLocale());
        this.replacements = host ? compositeCrossReferenceReplacements(host.document, local) : local.filter((range) => range.sourceFile === file?.path);
      } catch (error: unknown) {
        if (this.destroyed || generation !== this.generation) return;
        console.error("Feuillets cross-reference rendering", error);
        this.replacements = [];
      }
      this.rebuild();
      this.view.dispatch({ effects: setRows.of(this.replacements) });
    }
  }, {});
  return [field, plugin];
}
