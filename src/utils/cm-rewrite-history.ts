import { editorInfoField, type TFile } from "obsidian";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { RewriteOrigin } from "../services/rewrite-history-store.js";

interface HistoryState { doc: { toString(): string }; field(field: unknown, required: false): unknown }
interface HistoryUpdate { docChanged: boolean; startState: HistoryState; state: HistoryState }
export function createRewriteHistoryExtension(observe: (file: TFile, before: string, after: string, origin: RewriteOrigin) => void, close?: (file: TFile) => void, eligible?: (file: TFile) => boolean): unknown {
  const view = EditorView as { updateListener: { of(listener: (update: HistoryUpdate) => void): unknown } };
  const listener = view.updateListener.of((update) => {
    if (!update.docChanged) return;
    const before = update.startState.field(editorInfoField, false) as { file?: TFile } | undefined;
    const after = update.state.field(editorInfoField, false) as { file?: TFile } | undefined;
    if (!before?.file || before.file !== after?.file || eligible?.(before.file) === false) return;
    observe(before.file, update.startState.doc.toString(), update.state.doc.toString(), "markdown-editor");
  });
  const plugins = ViewPlugin as { fromClass<T>(ctor: new (view: { state: HistoryState }) => T): unknown };
  const lifecycle = plugins.fromClass(class {
    private file?: TFile;
    constructor(view: { state: HistoryState }) { this.file = (view.state.field(editorInfoField, false) as { file?: TFile } | undefined)?.file; }
    update(update: HistoryUpdate): void {
      const file = (update.state.field(editorInfoField, false) as { file?: TFile } | undefined)?.file;
      if (file !== this.file) { if (this.file) close?.(this.file); this.file = file; }
    }
    destroy(): void { if (this.file) close?.(this.file); }
  });
  return [listener, lifecycle];
}
