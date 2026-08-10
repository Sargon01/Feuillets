// @ts-ignore -- ViewPlugin/WidgetType sont fournis par Obsidian a l'execution
// eslint-disable-next-line import/no-extraneous-dependencies -- @codemirror/* fourni par Obsidian a l'execution
import { ViewPlugin, Decoration, WidgetType } from "@codemirror/view";
// @ts-ignore -- syntaxTree est fourni par Obsidian a l'execution
import { syntaxTree } from "@codemirror/language";

type DecorationSet = Record<string, unknown>;

interface DecorationRange {
  from: number;
  to: number;
}

interface DecorationStatic {
  none: DecorationSet;
  widget(spec: { widget: unknown; side?: number }): {
    range(from: number, to?: number): DecorationRange;
  };
  set(of: DecorationRange[], sort?: boolean): DecorationSet;
}

interface EditorViewInstance {
  visibleRanges?: Array<{ from: number; to: number }>;
  state?: {
    doc?: {
      lineAt(pos: number): { from: number; to: number; length: number; text: string };
    };
  };
}

interface ViewPluginStatic {
  fromClass<T>(
    cls: new (view: EditorViewInstance) => T,
    spec?: { decorations?: (value: T) => unknown }
  ): unknown;
}

interface IteratableNode {
  name: string;
}

interface SyntaxTreeNode {
  name: string;
  parent: SyntaxTreeNode | null;
}

interface IteratableTree {
  iterate(spec: {
    from: number;
    to: number;
    enter(node: IteratableNode): boolean | void;
  }): void;
  resolveInner?(pos: number, side?: number): SyntaxTreeNode | null;
}

const DecorationTyped = Decoration as DecorationStatic;
const ViewPluginTyped = ViewPlugin as ViewPluginStatic | undefined;
const syntaxTreeTyped = syntaxTree as unknown as (state: unknown) => IteratableTree | null;

interface WidgetTypeInstance {
  toDOM(): HTMLElement;
  eq(other: unknown): boolean;
  ignoreEvent(): boolean;
}

interface WidgetTypeStatic {
  new (): WidgetTypeInstance;
}

const WidgetTypeTyped = WidgetType as WidgetTypeStatic | undefined;

const BaseWidgetClass: WidgetTypeStatic =
  typeof WidgetTypeTyped === "function"
    ? WidgetTypeTyped
    : class implements WidgetTypeInstance {
        toDOM(): HTMLElement {
          return createSpan();
        }
        eq(): boolean {
          return true;
        }
        ignoreEvent(): boolean {
          return true;
        }
      };

export class IndentWidget extends BaseWidgetClass {
  toDOM(): HTMLElement {
    return createSpan({ cls: "feuillets-indent-widget", attr: { "aria-hidden": "true" } });
  }

  eq(other: unknown): boolean {
    return other instanceof IndentWidget;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function isExcludedNodeName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("header") ||
    lower.includes("heading") ||
    lower.includes("list") ||
    lower.includes("quote") ||
    lower.includes("code") ||
    lower.includes("frontmatter") ||
    lower.includes("yaml") ||
    lower.includes("table")
  );
}

export function isNonParagraphRegexFallback(lineText: string): boolean {
  const trimmed = lineText.trim();
  if (trimmed.length === 0) return true;
  if (/^#{1,6}(\s|$)/.test(trimmed)) return true;
  if (/^([-*+]|\d+\.)\s/.test(trimmed)) return true;
  if (trimmed.startsWith(">")) return true;
  if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) return true;
  if (trimmed.startsWith("---")) return true;
  if (trimmed.startsWith("|")) return true;
  return false;
}

export function isNonParagraphLine(
  state: unknown,
  lineFrom: number,
  lineTo: number,
  lineText: string
): boolean {
  const trimmed = lineText.trim();
  if (trimmed.length === 0) return true;

  const tree = typeof syntaxTreeTyped === "function" ? syntaxTreeTyped(state) : null;

  if (tree) {
    let isExcluded = false;

    if (typeof tree.iterate === "function") {
      tree.iterate({
        from: lineFrom,
        to: lineTo,
        enter(node) {
          if (isExcludedNodeName(node.name || "")) {
            isExcluded = true;
            return false;
          }
        },
      });
      if (isExcluded) return true;
    }

    if (typeof tree.resolveInner === "function") {
      let curr = tree.resolveInner(lineFrom, 1);
      while (curr) {
        if (isExcludedNodeName(curr.name || "")) {
          return true;
        }
        curr = curr.parent;
      }
    }

    return false;
  }

  return isNonParagraphRegexFallback(lineText);
}

export const paragraphIndentPlugin =
  typeof ViewPluginTyped?.fromClass === "function"
    ? ViewPluginTyped.fromClass(
        class {
          decorations: DecorationSet;

          constructor(view: EditorViewInstance) {
            this.decorations = this.buildDecorations(view);
          }

          update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorViewInstance }) {
            if (update.docChanged || update.viewportChanged) {
              this.decorations = this.buildDecorations(update.view);
            }
          }

          private buildDecorations(view: EditorViewInstance): DecorationSet {
            if (!view?.visibleRanges || !view?.state?.doc || typeof DecorationTyped?.widget !== "function") {
              return DecorationTyped?.none ?? {};
            }

            const decos: DecorationRange[] = [];
            const widgetDeco = DecorationTyped.widget({
              widget: new IndentWidget(),
              side: -1,
            });

            for (const { from, to } of view.visibleRanges) {
              let pos = from;
              while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                if (!isNonParagraphLine(view.state, line.from, line.to, line.text)) {
                  decos.push(widgetDeco.range(line.from, line.from));
                }
                pos = line.to + 1;
              }
            }

            return typeof DecorationTyped?.set === "function"
              ? DecorationTyped.set(decos, true)
              : (DecorationTyped?.none ?? {});
          }
        },
        {
          decorations: (v: { decorations: DecorationSet }) => v.decorations,
        }
      )
    : [];
