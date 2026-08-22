import { Decoration, ViewPlugin } from "@codemirror/view";
import { parseImageDirectiveLine, parseColumnsDirectiveLine } from "./feuillets-directives.js";

type DecorationSet = { map(changes: unknown): DecorationSet };
type DecorationRange = { from: number; to: number };

interface DecorationStatic {
  none: DecorationSet;
  line(spec: { class: string }): { range(from: number): DecorationRange };
  set(ranges: DecorationRange[], sort?: boolean): DecorationSet;
}

interface EditorDocument {
  lineAt(position: number): { from: number; to: number; text: string };
}

interface EditorViewInstance {
  visibleRanges: Array<{ from: number; to: number }>;
  state: { doc: EditorDocument };
}

interface ViewPluginStatic {
  fromClass<T>(
    value: new (view: EditorViewInstance) => T,
    spec: { decorations: (plugin: T) => DecorationSet },
  ): unknown;
}

const DecorationTyped = Decoration as DecorationStatic;
const ViewPluginTyped = ViewPlugin as ViewPluginStatic;

/** Une directive technique Feuillets, et seulement elle, sur une ligne seule. */
export function isFeuilletsDessousDirective(line: string): boolean {
  return /^\s*%%\s*dessous\s*%%\s*$/iu.test(line);
}

/** Une directive `%% image: … %%` VALIDE (grammaire exacte partagée avec le
 * pipeline d'export, voir parseImageDirectiveLine) sur une ligne seule.
 * Une forme invalide (largeur hors liste, unité non supportée…) reste
 * délibérément visible en Live Preview — voir feuillets-directives.ts. */
export function isFeuilletsImageDirective(line: string): boolean {
  return parseImageDirectiveLine(line) !== null;
}

/** Une directive `%% colonnes: … %%` VALIDE (grammaire exacte partagée avec
 * le pipeline d'export, voir parseColumnsDirectiveLine) sur une ligne seule.
 * Une forme invalide (composition/ratio hors liste) reste délibérément
 * visible en Live Preview — voir feuillets-directives.ts. */
export function isFeuilletsColumnsDirective(line: string): boolean {
  return parseColumnsDirectiveLine(line) !== null;
}

function directiveRanges(view: EditorViewInstance): DecorationRange[] {
  const ranges: DecorationRange[] = [];
  const seen = new Set<number>();
  const dessousDecoration = DecorationTyped.line({ class: "feuillets-directive-dessous" });
  const imageDecoration = DecorationTyped.line({ class: "feuillets-directive-image" });
  const columnsDecoration = DecorationTyped.line({ class: "feuillets-directive-columns" });
  for (const visible of view.visibleRanges) {
    let position = visible.from;
    while (position <= visible.to) {
      const line = view.state.doc.lineAt(position);
      if (!seen.has(line.from)) {
        if (isFeuilletsDessousDirective(line.text)) {
          seen.add(line.from);
          ranges.push(dessousDecoration.range(line.from));
        } else if (isFeuilletsImageDirective(line.text)) {
          seen.add(line.from);
          ranges.push(imageDecoration.range(line.from));
        } else if (isFeuilletsColumnsDirective(line.text)) {
          seen.add(line.from);
          ranges.push(columnsDecoration.range(line.from));
        }
      }
      position = line.to + 1;
    }
  }
  return ranges;
}

export const feuilletsDirectivePlugin = ViewPluginTyped.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorViewInstance) {
      this.decorations = DecorationTyped.set(directiveRanges(view), true);
    }

    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorViewInstance }): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = DecorationTyped.set(directiveRanges(update.view), true);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
