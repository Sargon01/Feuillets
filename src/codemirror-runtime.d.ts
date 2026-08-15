declare module "@codemirror/state" {
  export const StateEffect: unknown;
  export const StateField: unknown;
  export const EditorState: unknown;
  export const Prec: unknown;
}

declare module "@codemirror/view" {
  export const Decoration: unknown;
  export const EditorView: unknown;
  export const ViewPlugin: unknown;
  export const keymap: unknown;
  export class WidgetType {
    eq(other: WidgetType): boolean;
    toDOM(): HTMLElement;
    destroy(dom: HTMLElement): void;
    compare(other: WidgetType): boolean;
    ignoreEvent(event?: Event): boolean;
  }
}

declare module "@codemirror/commands" {
  export function history(): unknown;
  export const historyKeymap: unknown[];
  export function redo(target: unknown): boolean;
}
