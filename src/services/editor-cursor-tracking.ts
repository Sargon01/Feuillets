import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";

export type EditorCursorChange = {
  filePath: string;
  cursorOffset: number;
};

export type EditorCursorListener = (change: EditorCursorChange) => void;

type CursorTrackingUpdate = {
  selectionSet: boolean;
  state: { selection: { main: { head: number } } };
  view: {
    state: {
      field<T>(field: unknown, required?: boolean): T | undefined;
    };
  };
};

type EditorViewStatic = {
  updateListener: {
    of(listener: (update: CursorTrackingUpdate) => void): unknown;
  };
};

const EditorViewTyped = EditorView as EditorViewStatic;

/** Creates the single plugin-lifetime CM6 selection signal. */
export function createEditorCursorTrackingExtension(listener: EditorCursorListener) {
  return EditorViewTyped.updateListener.of((update) => {
    if (!update.selectionSet) return;
    const info = update.view.state.field<{ file: { path: string } | null }>(editorInfoField, false);
    const file = info?.file;
    if (!file) return;
    listener({ filePath: file.path, cursorOffset: update.state.selection.main.head });
  });
}
