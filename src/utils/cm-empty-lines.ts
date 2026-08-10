// @ts-ignore -- ViewPlugin est fourni par Obsidian a l'execution
// eslint-disable-next-line import/no-extraneous-dependencies -- @codemirror/* fourni par Obsidian a l'execution
import { ViewPlugin, Decoration } from "@codemirror/view";

type DecorationSet = Record<string, unknown>;

interface DecorationRange {
  from: number;
  to: number;
}

interface DecorationStatic {
  none: DecorationSet;
  line?(spec: { class?: string; attributes?: Record<string, string> }): {
    range(from: number, to?: number): DecorationRange;
  };
  set?(of: DecorationRange[], sort?: boolean): DecorationSet;
}

interface EditorViewInstance {
  visibleRanges?: Array<{ from: number; to: number }>;
  state?: {
    doc?: {
      lineAt(pos: number): { from: number; to: number; length: number };
    };
  };
}

interface ViewPluginStatic {
  fromClass<T>(
    cls: new (view: EditorViewInstance) => T,
    spec?: { decorations?: (value: T) => unknown }
  ): unknown;
}

const DecorationTyped = Decoration as DecorationStatic;
const ViewPluginTyped = ViewPlugin as ViewPluginStatic | undefined;

export const emptyLinesPlugin =
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
            if (!view?.visibleRanges || !view?.state?.doc || typeof DecorationTyped?.line !== "function") {
              return DecorationTyped?.none ?? {};
            }

            const decos: DecorationRange[] = [];
            const emptyLineDeco = DecorationTyped.line({ class: "feuillets-empty-line" });

            for (const { from, to } of view.visibleRanges) {
              let pos = from;
              while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                if (line.length === 0) {
                  decos.push(emptyLineDeco.range(line.from, line.from));
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
