import { Decoration, ViewPlugin, WidgetType, EditorView } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { editorInfoField, editorLivePreviewField, TFile, type App, type TFolder } from "obsidian";
import { getLocale, translate } from "../i18n/index.js";
import { createCrossReferenceDetectionSession, crossReferenceBoundaryScope, crossReferenceProjectSettings, resolveCrossReferencesInContext } from "../services/cross-reference-context.js";
import { loadCrossReferenceStore, type CrossReferenceContentReader } from "../services/cross-reference-store.js";
import { crossReferenceReplacements, compositeCrossReferenceReplacements, type CrossReferenceReplacement } from "../services/cross-reference-render.js";
import type { CompileScope } from "../services/compile-scope.js";
import type { ScriveningsDocument } from "../services/scrivenings-document.js";
import { selectionOverlaps, type CrossEditorSelection } from "./cm-selection-overlap.js";
import { attachCitationTooltipBehavior, createPandocCitationSpan, disposePandocCitationElement, PANDOC_CITATION_TOOLTIP_CLASS } from "../services/pandoc-citation-preview.js";

type CrossReferenceTooltip = readonly [string, string, string];
type EditorReplacement = CrossReferenceReplacement & { tooltip?: CrossReferenceTooltip };
let tooltipId = 0;

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
  mark(spec: { class: string }): { range(from: number, to: number): unknown };
  set(ranges: unknown[], sort: boolean): unknown;
}
interface PluginStatic {
  fromClass<T>(cls: new (view: CrossReferenceEditorView) => T, spec: {
    decorations?(value: T): unknown;
  }): unknown;
}
const decorations = Decoration as DecorationStatic;
const plugins = ViewPlugin as PluginStatic;
const listeners = new WeakMap<App, Set<(delay: number, paths?: readonly string[]) => void>>();
export const CROSS_REFERENCE_DEBOUNCE_MS = 350;

export function notifyCrossReferenceEditors(app: App, delay = 0, paths?: readonly string[]): void {
  for (const listener of listeners.get(app) ?? []) listener(delay, paths);
}

export class CrossReferenceWidget extends WidgetType {
  constructor(readonly text: string, readonly tooltip?: CrossReferenceTooltip) { super(); }
  eq(other: WidgetType): boolean {
    return other instanceof CrossReferenceWidget && other.text === this.text
      && this.tooltip?.every((line, index) => line === other.tooltip?.[index]) !== false
      && !!this.tooltip === !!other.tooltip;
  }
  toDOM(view?: { dom: HTMLElement }): HTMLElement {
    const owner = view?.dom.ownerDocument ?? document;
    const span = createPandocCitationSpan(owner, "feuillets-cross-reference");
    span.textContent = this.text;
    if (this.tooltip) {
      const tooltip = createPandocCitationSpan(owner, `${PANDOC_CITATION_TOOLTIP_CLASS} feuillets-cross-reference-tooltip`);
      tooltip.setAttribute("role", "tooltip");
      tooltip.id = `feuillets-cross-reference-tooltip-${++tooltipId}`;
      this.tooltip.forEach((text, index) => {
        const line = createPandocCitationSpan(owner, `feuillets-pandoc-citation-notice-line${index === 0 ? " is-primary" : ""}`);
        line.textContent = text;
        tooltip.appendChild(line);
      });
      span.appendChild(tooltip);
      span.setAttribute("aria-describedby", tooltip.id);
      attachCitationTooltipBehavior(span, tooltip);
    }
    return span;
  }
  destroy(dom: HTMLElement): void { disposePandocCitationElement(dom); }
  ignoreEvent(): boolean { return false; }
}

export function visibleCrossReferenceReplacements(
  replacements: readonly CrossReferenceReplacement[], selection: CrossEditorSelection, livePreview: boolean,
): CrossReferenceReplacement[] {
  return livePreview ? replacements.filter((range) => !selectionOverlaps(selection, range.from, range.to)) : [];
}

export interface ContinuousCrossReferenceHost { scope: CompileScope; document: ScriveningsDocument; isDirty?(path: string): boolean }

/** A single text widget pipeline for native Markdown editors and continuous compositions. */
export function createCrossReferenceExtension(
  app: App, getSettings: () => FeuilletsSettings,
  readContent: CrossReferenceContentReader = (file) => app.vault.read(file),
  getContinuousHost?: () => ContinuousCrossReferenceHost | null,
  getWorkspaceFolder: () => TFolder | null = () => null,
): unknown {
  if (typeof plugins?.fromClass !== "function") return [];
  const setRows = (StateEffect as { define<T>(): { of(value: T): unknown } }).define<readonly EditorReplacement[]>();
  const build = (rows: readonly EditorReplacement[], state: CrossReferenceEditorView["state"]): unknown => {
    if (!getContinuousHost && state.field<boolean>(editorLivePreviewField, false) === false) return decorations.set([], true);
    return decorations.set(rows.filter((range) => range.from >= 0 && range.to <= state.doc.length).map((range) =>
      selectionOverlaps(state.selection, range.from, range.to)
        ? decorations.mark({ class: "feuillets-cross-reference-source" }).range(range.from, range.to)
        : decorations.replace({ widget: new CrossReferenceWidget(range.text, range.tooltip), inclusive: false }).range(range.from, range.to)), true);
  };
  type FieldValue = { rows: readonly EditorReplacement[]; decorations: unknown };
  const field = (StateField as { define<T>(spec: {
    create(): T;
    update(value: T, transaction: { docChanged: boolean; startState?: CrossReferenceEditorView["state"]; state: CrossReferenceEditorView["state"]; effects: readonly { is(type: unknown): boolean; value: readonly EditorReplacement[] }[] }): T;
    provide(field: unknown): unknown;
  }): unknown }).define<FieldValue>({
    create: () => ({ rows: [], decorations: decorations.none }),
    update(value, transaction) {
      const changedFile = transaction.startState && transaction.startState.field<{ file: TFile | null }>(editorInfoField, false)?.file
        !== transaction.state.field<{ file: TFile | null }>(editorInfoField, false)?.file;
      let rows = transaction.docChanged || changedFile ? [] : value.rows;
      for (const effect of transaction.effects) if (effect.is(setRows)) rows = effect.value;
      return { rows, decorations: build(rows, transaction.state) };
    },
    provide: (value) => (EditorView as { decorations: { from(field: unknown, get: (value: FieldValue) => unknown): unknown } }).decorations.from(value, (state) => state.decorations),
  });
  const plugin = plugins.fromClass(class {
    decorations: unknown = decorations.none;
    private replacements: EditorReplacement[] = [];
    private timer: number | null = null;
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
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.unsubscribe();
      this.contents.clear();
    }

    private rebuild(): void {
      this.decorations = build(this.replacements, this.view.state);
    }

    private schedule(delay: number): void {
      this.generation++;
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => { this.timer = null; void this.refresh(this.generation); }, delay);
    }

    private async refresh(generation: number): Promise<void> {
      if (this.destroyed) return;
      const source = this.view.state.doc.toString();
      const settings = getSettings();
      const host = getContinuousHost?.();
      const info = this.view.state.field<{ file: TFile | null }>(editorInfoField, false);
      const file = info?.file;
      const scope = getContinuousHost ? host?.scope ?? null : file ? crossReferenceBoundaryScope(app, settings, file, getWorkspaceFolder()) : null;
      if (!scope || (!getContinuousHost && this.view.state.field<boolean>(editorLivePreviewField, false) === false)) {
        this.replacements = []; this.rebuild(); this.view.dispatch({ effects: setRows.of([]) }); return;
      }
      const staleSources = new Set<string>();
      const read: CrossReferenceContentReader = async (target) => {
        const segment = host?.document.segments.find((entry) => entry.path === target.path);
        if (segment && host?.isDirty?.(target.path) !== false) return segment.frontmatter + segment.body;
        if (target.path === file?.path && !getContinuousHost) return source;
        let content = this.contents.get(target.path);
        if (!content) { content = readContent(target); this.contents.set(target.path, content); }
        const current = await content;
        if (segment && current !== segment.frontmatter + segment.body) staleSources.add(target.path);
        return current;
      };
      try {
        const storeSettings = crossReferenceProjectSettings(app, settings, scope.projectRoot);
        const store = await loadCrossReferenceStore(app, storeSettings);
        const resolution = await resolveCrossReferencesInContext(app, settings, scope, store, read, this.detect);
        if (this.destroyed || generation !== this.generation || source !== this.view.state.doc.toString()) return;
        const locale = getLocale();
        const details = new Map<string, CrossReferenceTooltip>();
        for (const occurrence of store.occurrences) {
          const attached = resolution.occurrences.get(occurrence.id);
          const target = resolution.targets.get(occurrence.targetId);
          if (attached?.status !== "attached" || target?.status !== "resolved") continue;
          const detected = target.detectedTarget;
          details.set(`${occurrence.sourceFile}:${attached.range.start}:${attached.range.end}`, [
            translate(locale, "xref.tooltip", { reference: `${translate(locale, `xref.type.${detected.type}`)} ${target.number}` }),
            detected.titleOrCaption, detected.sourceFile.split("/").pop()?.replace(/\.md$/i, "") ?? detected.sourceFile,
          ]);
        }
        const local = crossReferenceReplacements(store, resolution, locale).filter((range) => !staleSources.has(range.sourceFile))
          .map((range) => ({ ...range, tooltip: details.get(`${range.sourceFile}:${range.from}:${range.to}`) }));
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
