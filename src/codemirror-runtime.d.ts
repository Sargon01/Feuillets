declare module "@codemirror/state" {
  export const StateEffect: unknown;
  export const StateField: unknown;
  export const EditorState: unknown;
}

declare module "@codemirror/view" {
  export const Decoration: unknown;
  export const EditorView: unknown;
  export class WidgetType {
    eq(other: WidgetType): boolean;
    toDOM(): HTMLElement;
    destroy(dom: HTMLElement): void;
    compare(other: WidgetType): boolean;
    ignoreEvent(event?: Event): boolean;
  }
}
