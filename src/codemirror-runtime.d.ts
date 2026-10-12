declare module "@codemirror/state" {
  export const StateEffect: unknown;
  export const StateField: unknown;
  export const EditorState: unknown;
  export const Prec: unknown;
  export class Text {
    static of(lines: readonly string[]): Text;
    lineAt(offset: number): { from: number; number: number; text: string };
    toString(): string;
  }
  export class ChangeSet {
    static of(changes: readonly { from: number; to: number; insert: string }[], length: number): ChangeSet;
    apply(doc: Text): Text;
    mapPos(position: number, association?: number): number;
  }
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
  export const isolateHistory: { of(value: "full" | "before" | "after"): unknown };
  export function history(): unknown;
  export const historyKeymap: unknown[];
  export function redo(target: unknown): boolean;
  export function undo(target: unknown): boolean;
}
