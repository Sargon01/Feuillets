import { Decoration, ViewPlugin } from "@codemirror/view";
import { parser } from "@lezer/markdown";

/**
 * Couche Markdown inline de Scrivenings (LOT 1.3 + finition titres ATX) :
 * italique/gras rendus, titres `#`→`######` rendus (mêmes conventions, voir
 * section « Titres ATX » ci-dessous), masquage contextuel des marqueurs
 * (emphase ET `#`), et les raccourcis Cmd/Ctrl+I / Cmd/Ctrl+B. Rien d'autre —
 * voir le README du lot pour le périmètre exact exclu.
 *
 * RÈGLE CENTRALE, jamais dérogée : ce module ne parse JAMAIS le texte
 * composite entier. Il déduit d'abord les segments (bornes = `boundary[i-1]+1
 * → boundary[i]`, dernier segment jusqu'à la fin) à partir de
 * `scriveningsBoundariesField` (cm-scrivenings.ts), puis fait parser CHAQUE
 * segment indépendamment par `@lezer/markdown` (dépendance bundlée, jamais un
 * parseur interne Obsidian, jamais une regex). Aucune emphase ne peut donc
 * jamais traverser une jonction — le texte de chaque segment est une chaîne
 * JS indépendante, sans le caractère de jonction ni le texte du voisin.
 *
 * Découpage volontaire en deux couches :
 * - une couche PURE (parsing par segment, cache, calcul du plan de
 *   décorations, planification des commandes Cmd/Ctrl+I/B) — testable sans
 *   aucun CodeMirror réel, comme le reste du plugin (voir cm-paragraph-
 *   indent.ts, cm-empty-lines.ts) ;
 * - une fine couche de branchement CodeMirror (ViewPlugin + keymap) qui ne
 *   fait qu'appeler la couche pure et convertir son résultat en vraies
 *   décorations / transactions.
 *
 * `@lezer/markdown` est un vrai paquet bundlé (voir package.json et
 * esbuild.config.mjs — volontairement absent de `external`), donc ses types
 * réels sont utilisés tels quels ici, contrairement aux `@codemirror/*`
 * (fournis par Obsidian à l'exécution, typés `unknown` par
 * codemirror-runtime.d.ts) qui restent castés localement comme dans
 * cm-scrivenings.ts.
 *
 * SENS DE DÉPENDANCE, volontaire : ce module n'importe JAMAIS
 * cm-scrivenings.ts (qui, lui, importe d'ici `createScriveningsMarkdownPlugin`
 * et `createScriveningsToggleCommand` pour composer `scriveningsExtensions`)
 * — importer dans l'autre sens créerait un cycle ES modules (TDZ à
 * l'exécution : `scriveningsBoundariesField` n'existerait pas encore au
 * moment où ce fichier l'utiliserait). La donnée dont ce module a besoin —
 * le StateField des frontières — lui est donc toujours PASSÉE EN PARAMÈTRE,
 * jamais importée. Pour la même raison, `crossesScriveningsBoundary`
 * (logique de recouvrement de jonction) est réimplémentée ici en une ligne
 * plutôt qu'importée — voir `scriveningsRangeCrossesBoundary` ci-dessous.
 *
 * MICRO-LOT 1.3.1 : le keymap `Mod-i`/`Mod-b`/`Mod-Shift-z` prioritaire
 * (`Prec.highest`) est désormais assemblé ENTIÈREMENT dans cm-scrivenings.ts
 * (avec le correctif Redo, dans le MÊME `Prec.highest(keymap.of([...]))` —
 * voir sa doc) : ce module expose seulement les commandes PURES
 * (`createScriveningsToggleCommand`) et le ViewPlugin de rendu
 * (`createScriveningsMarkdownPlugin`), jamais de keymap lui-même.
 */

/* --- Typage local CodeMirror (mêmes conventions que cm-scrivenings.ts) --- */

type DecoRange = { from: number; to?: number };
type DecorationSet = unknown;
interface DecorationStatic {
  none: DecorationSet;
  mark(spec: { class: string }): { range(from: number, to: number): DecoRange };
  replace(spec: Record<string, never>): { range(from: number, to: number): DecoRange };
  line(spec: { attributes: Record<string, string> }): { range(from: number): DecoRange };
  set(ranges: DecoRange[], sort?: boolean): DecorationSet;
}
interface SelectionRangeLike {
  from: number;
  to: number;
}
interface DocLike {
  length: number;
  sliceString(from: number, to?: number): string;
}
interface StateLike {
  doc: DocLike;
  selection: { main: SelectionRangeLike; ranges: readonly SelectionRangeLike[] };
  field(field: unknown, required: false): unknown;
}
interface EditorViewInstance {
  state: StateLike;
  visibleRanges?: readonly { from: number; to: number }[];
  dispatch?(spec: { changes?: unknown; selection?: { anchor: number; head: number } }): void;
}
interface ViewUpdateLike {
  docChanged: boolean;
  viewportChanged: boolean;
  selectionSet: boolean;
  view: EditorViewInstance;
}
interface ViewPluginStatic {
  fromClass<T>(cls: new (view: EditorViewInstance) => T, spec?: { decorations?: (value: T) => DecorationSet }): unknown;
}

const DecorationTyped = Decoration as DecorationStatic;
const ViewPluginTyped = ViewPlugin as ViewPluginStatic | undefined;

/* --- Segments Scrivenings (déduits des frontières, jamais du composite entier) --- */

export interface ScriveningsSegmentRange {
  from: number;
  to: number;
}

/** `boundaries` = offsets de jonction (voir `scriveningsBoundariesField`,
 * cm-scrivenings.ts — ce sont les mêmes offsets que `boundaryOffsets()` de
 * services/scrivenings-document.ts). Segment 1 : `0 → boundary[0]` ; segment
 * i : `boundary[i-1]+1 → boundary[i]` ; dernier segment : jusqu'à `docLength`. */
export function scriveningsSegmentRanges(boundaries: readonly number[], docLength: number): ScriveningsSegmentRange[] {
  const ranges: ScriveningsSegmentRange[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    ranges.push({ from: start, to: boundary });
    start = boundary + 1;
  }
  ranges.push({ from: start, to: docLength });
  return ranges;
}

/** Ne garde que les segments qui recouvrent au moins une plage visible — un
 * segment partiellement visible est gardé ENTIER (voir en-tête de fichier :
 * jamais de scan de tout le manuscrit à chaque frappe/scroll). */
export function scriveningsSegmentsInRanges(
  segments: readonly ScriveningsSegmentRange[],
  visibleRanges: readonly { from: number; to: number }[]
): ScriveningsSegmentRange[] {
  return segments.filter((segment) => visibleRanges.some((range) => segment.from <= range.to && segment.to >= range.from));
}

/* --- Parsing d'UN segment (jamais du composite) --------------------------- */

export type ScriveningsEmphasisType = "emphasis" | "strong";

/** Un nœud Emphasis/StrongEmphasis reconnu par `@lezer/markdown`, offsets
 * LOCAUX au segment parsé. `contentFrom`/`contentTo` excluent les marqueurs
 * PROPRES à ce nœud (pas ceux d'un nœud imbriqué, voir `***texte***` en
 * tête de fichier et les tests). */
export interface ScriveningsEmphasisNode {
  type: ScriveningsEmphasisType;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
}

/** Un « passage formaté » de plus haut niveau (pour `***texte***`, l'unique
 * groupe englobe Emphasis + StrongEmphasis imbriqués) : c'est l'unité de
 * masquage — tous ses marqueurs se montrent ou se cachent ENSEMBLE selon
 * que le curseur/la sélection touche `[from, to]`. */
export interface ScriveningsMarkGroup {
  from: number;
  to: number;
  marks: { from: number; to: number }[];
}

export interface ScriveningsCalloutLine {
  lineStart: number;
  lineEnd: number;
  prefixFrom?: number;
  prefixTo?: number;
  isTitle: boolean;
  isFirst: boolean;
  isLast: boolean;
}

export interface ScriveningsCalloutNode {
  type: string;
  from: number;
  to: number;
  explicitTitle: boolean;
  autoLabel: string;
  headerFrom: number;
  headerTo: number;
  titleFrom?: number;
  titleTo?: number;
  lines: ScriveningsCalloutLine[];
}

/* --- Titres ATX (finition Continu : `#` → `######` rendus) ------------------ */

export type ScriveningsHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Un nœud `ATXHeading1`…`ATXHeading6` reconnu par `@lezer/markdown`, offsets
 * LOCAUX au segment parsé. La grammaire fait foi : `#######` (sept `#`) et
 * `\#` échappé ne sont jamais des titres (elle les met dans un `Paragraph`),
 * `#Titre` sans espace n'est pas un titre, `## foo ##` porte deux `HeaderMark`
 * (ouvrant ET fermant) — c'est la structure réelle du paquet, jamais une
 * regex ni une seconde grammaire. `contentFrom`/`contentTo` bornent le
 * CONTENU affiché (après marqueur ouvrant + espaces syntaxiques, avant
 * d'éventuels `#` fermants) — c'est lui qui reçoit le style `--h1-*`…`--h6-*` ;
 * `marks` sont toutes les plages `HeaderMark` DU NŒUD (jamais celles d'un
 * SetextHeading, collectées à part par la grammaire), masquées
 * contextuellement comme une emphase. */
export interface ScriveningsHeadingNode {
  level: ScriveningsHeadingLevel;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  marks: { from: number; to: number }[];
}

export interface ScriveningsSegmentFormatting {
  nodes: ScriveningsEmphasisNode[];
  groups: ScriveningsMarkGroup[];
  /** Titres ATX `#`→`######` du segment, offsets LOCAUX (voir
   * `ScriveningsHeadingNode`). Jamais un titre ne traverse une frontière :
   * chaque segment étant parsé isolément, `#` en fin de feuillet A et
   * contenu en tête de feuillet B sont deux unités séparées. */
  headings: ScriveningsHeadingNode[];
  /** Plages `HorizontalRule` reconnues par le parseur (typiquement une ligne
   * `***` seule, voir « CORRECTIF `***` » ci-dessous) — jamais une emphase,
   * gardées à part pour que `buildScriveningsMarkdownPlan` puisse garantir
   * qu'AUCUNE décoration ne les recouvre, même indirectement. */
  horizontalRules: { from: number; to: number }[];
  /** Plages des seuls BACKSLASHES d'une ligne source ENTIÈRE `\*\*\*` (voir
   * « CORRECTIF `\*\*\*` échappé » ci-dessous, micro-chantier finition
   * Continu) — jamais les `*` eux-mêmes, jamais un `HorizontalRule` : ce
   * séparateur reste un texte normal, seuls ses trois marqueurs d'échappement
   * sont masqués pour que `***` apparaisse à l'écran, exactement comme dans
   * le rendu Feuillets normal. */
  escapedSeparators: { from: number; to: number }[];
  callouts: ScriveningsCalloutNode[];
}

interface ParseFrame {
  type: ScriveningsEmphasisType;
  from: number;
  to: number;
  directMarks: { from: number; to: number }[];
  group: ScriveningsMarkGroup;
}

function scriveningsEmphasisTypeOf(nodeName: string): ScriveningsEmphasisType | null {
  if (nodeName === "Emphasis") return "emphasis";
  if (nodeName === "StrongEmphasis") return "strong";
  return null;
}

/** Niveau d'un nœud de titre ATX (`ATXHeading1`…`ATXHeading6`) — `null` pour
 * tout autre nœud. Un `SetextHeading1/2` (souligné `===`/`---`) n'en est pas
 * un : seule la syntaxe `#`→`######` est traitée par ce lot. */
function scriveningsHeadingLevelOf(nodeName: string): ScriveningsHeadingLevel | null {
  const match = /^ATXHeading([1-6])$/.exec(nodeName);
  if (!match) return null;
  return Number(match[1]) as ScriveningsHeadingLevel;
}

function calloutAutoLabel(type: string): string {
  const words = type.replace(/[-_]+/g, " ");
  return words.length === 0 ? words : words[0].toUpperCase() + words.slice(1);
}

function parseCalloutHeader(text: string, lineStart: number, lineEnd: number): { type: string; explicitTitle: boolean; headerTo: number; titleFrom?: number; titleTo?: number } | null {
  let cursor = lineStart;
  while (cursor < lineEnd && (text[cursor] === " " || text[cursor] === "\t")) cursor++;
  if (cursor >= lineEnd || text[cursor] !== ">") return null;
  cursor++;
  while (cursor < lineEnd && (text[cursor] === " " || text[cursor] === "\t")) cursor++;
  if (text[cursor] !== "[" || text[cursor + 1] !== "!") return null;
  const typeStart = cursor + 2;
  let typeEnd = typeStart;
  while (typeEnd < lineEnd) {
    const char = text[typeEnd];
    if (!/[A-Za-z0-9_-]/.test(char)) break;
    typeEnd++;
  }
  if (typeEnd === typeStart || text[typeEnd] !== "]") return null;
  const type = text.slice(typeStart, typeEnd).toLowerCase();
  cursor = typeEnd + 1;
  if (text[cursor] === "+" || text[cursor] === "-") cursor++;
  while (cursor < lineEnd && (text[cursor] === " " || text[cursor] === "\t")) cursor++;
  const hasTitle = cursor < lineEnd;
  return {
    type,
    explicitTitle: hasTitle,
    headerTo: hasTitle ? cursor : lineEnd,
    ...(hasTitle ? { titleFrom: cursor, titleTo: lineEnd } : {}),
  };
}

/** Chaîne EXACTE (après `.trim()` de la ligne) d'un séparateur `***`
 * intégralement échappé — trois `\*` consécutifs, rien d'autre. Volontairement
 * une comparaison de chaîne, jamais une regex plus permissive : voir
 * `findEscapedSeparatorHiddenRanges` ci-dessous pour les deux gardes qui en
 * découlent (forme de la ligne ET confirmation par la grammaire réelle). */
const ESCAPED_SEPARATOR_LINE = "\\*\\*\\*";

/**
 * CORRECTIF `\*\*\*` échappé (micro-chantier finition Continu) : une ligne
 * source ENTIÈRE `\*\*\*` doit se PERCEVOIR exactement comme `***` — jamais
 * les trois backslashes visibles, jamais un `<hr>`, jamais une réécriture du
 * document (les backslashes restent réellement dans le texte composite,
 * seulement masqués par décoration — voir `buildScriveningsMarkdownPlan`).
 *
 * Deux gardes CUMULÉES, jamais une seule — pour ne jamais masquer un `\`
 * ordinaire (`\*`, `texte \* texte`…) ni une ligne trop large (`*`, `**`,
 * `***` non échappé, déjà couvert par le correctif `HorizontalRule`) :
 * - la ligne, une fois `.trim()`ée, doit être EXACTEMENT `ESCAPED_SEPARATOR_LINE` ;
 * - les trois positions de backslash candidates (au sein de cette ligne)
 *   doivent CHACUNE correspondre à un vrai nœud `Escape` reconnu par la
 *   grammaire `@lezer/markdown` (`escapeNodes`, collecté par
 *   `parseScriveningsSegmentFormatting` ci-dessous) — jamais une simple
 *   coïncidence de caractères (ex. à l'intérieur d'un bloc de code, où `\*`
 *   n'est jamais interprété comme un échappement par la grammaire).
 *
 * Ne renvoie QUE les trois plages `{from, to}` des backslashes eux-mêmes
 * (largeur 1 chacune) — jamais celles des `*`, qui restent de simples
 * caractères de texte affichés tels quels.
 */
function findEscapedSeparatorHiddenRanges(
  text: string,
  escapeNodes: readonly { from: number; to: number }[]
): { from: number; to: number }[] {
  if (escapeNodes.length === 0) return [];
  const escapeStarts = new Set(escapeNodes.map((node) => node.from));
  const ranges: { from: number; to: number }[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const leading = line.length - line.trimStart().length;
    if (line.trim() === ESCAPED_SEPARATOR_LINE) {
      const patternStart = lineStart + leading;
      const backslashPositions = [patternStart, patternStart + 2, patternStart + 4];
      if (backslashPositions.every((pos) => escapeStarts.has(pos))) {
        for (const pos of backslashPositions) ranges.push({ from: pos, to: pos + 1 });
      }
    }
    lineStart += line.length + 1; // +1 pour le `\n` retiré par split("\n")
  }
  return ranges;
}

/**
 * Parse PUR d'un texte de segment isolé (jamais le composite). Utilise
 * exclusivement le `parser` de `@lezer/markdown` — aucune regex, aucune
 * heuristique : ce que la grammaire reconnaît (ou ne reconnaît pas — code
 * inline, marqueurs échappés, syntaxe incomplète) fait foi.
 *
 * CORRECTIF `***` (micro-correctif Continu) : une ligne `***` seule (ou
 * entre deux paragraphes) est reconnue par la grammaire comme un nœud
 * `HorizontalRule` — JAMAIS comme une emphase (voir les dumps de la
 * grammaire dans test/cm-scrivenings-markdown.test.js). Ce nœud est ignoré
 * ICI, explicitement (jamais descendu, jamais transformé en `Emphasis`/
 * `StrongEmphasis`/`EmphasisMark`), ET sa plage est collectée à part dans
 * `horizontalRules` pour que `buildScriveningsMarkdownPlan` puisse
 * GARANTIR — pas seulement supposer — qu'aucune décoration (ni style ni
 * masquage) ne le recouvre jamais. Les trois caractères `*` restent donc de
 * simples caractères de texte, jamais un widget, jamais un trait, jamais
 * un `Decoration.replace()`.
 */
export function parseScriveningsSegmentFormatting(text: string): ScriveningsSegmentFormatting {
  const tree = parser.parse(text);
  const nodes: ScriveningsEmphasisNode[] = [];
  const groups: ScriveningsMarkGroup[] = [];
  const headings: ScriveningsHeadingNode[] = [];
  const horizontalRules: { from: number; to: number }[] = [];
  const callouts: ScriveningsCalloutNode[] = [];
  const escapeNodes: { from: number; to: number }[] = [];
  const stack: ParseFrame[] = [];
  const headingStack: { level: ScriveningsHeadingLevel; from: number; to: number; marks: { from: number; to: number }[] }[] = [];
  let blockquoteDepth = 0;

  tree.iterate({
    enter(node) {
      if (node.name === "Blockquote") {
        if (blockquoteDepth === 0) {
          const firstLineEnd = text.indexOf("\n", node.from) === -1 ? node.to : text.indexOf("\n", node.from);
          const header = parseCalloutHeader(text, node.from, firstLineEnd);
          if (header) {
            const lines: ScriveningsCalloutLine[] = [];
            let lineStart = node.from;
            while (lineStart < node.to) {
              const newline = text.indexOf("\n", lineStart);
              const lineEnd = newline === -1 || newline > node.to ? node.to : newline;
              let prefixFrom: number | undefined;
              let prefixTo: number | undefined;
              let cursor = lineStart;
              while (cursor < lineEnd && (text[cursor] === " " || text[cursor] === "\t")) cursor++;
              if (cursor < lineEnd && text[cursor] === ">") {
                prefixFrom = cursor;
                prefixTo = cursor + 1;
              }
              lines.push({
                lineStart,
                lineEnd,
                ...(prefixFrom === undefined ? {} : { prefixFrom, prefixTo }),
                isTitle: lines.length === 0,
                isFirst: lines.length === 0,
                isLast: lineEnd === node.to,
              });
              if (newline === -1 || newline >= node.to) break;
              lineStart = newline + 1;
            }
            if (lines.length > 0) lines[lines.length - 1].isLast = true;
            callouts.push({
              type: header.type,
              from: node.from,
              to: node.to,
              explicitTitle: header.explicitTitle,
              autoLabel: calloutAutoLabel(header.type),
              headerFrom: node.from,
              headerTo: header.headerTo,
              ...(header.titleFrom === undefined ? {} : { titleFrom: header.titleFrom, titleTo: header.titleTo }),
              lines,
            });
          }
        }
        blockquoteDepth++;
        return;
      }
      if (node.name === "HorizontalRule") {
        horizontalRules.push({ from: node.from, to: node.to });
        return false; // jamais descendu : un HorizontalRule n'a rien à offrir à l'emphase
      }
      if (node.name === "Escape") {
        // Collecté pour `findEscapedSeparatorHiddenRanges` ci-dessus (CORRECTIF
        // `\*\*\*` échappé) — jamais transformé en emphase, jamais descendu
        // plus loin (un `Escape` n'a rien à offrir à l'emphase non plus).
        escapeNodes.push({ from: node.from, to: node.to });
        return false;
      }
      const level = scriveningsHeadingLevelOf(node.name);
      if (level) {
        headingStack.push({ level, from: node.from, to: node.to, marks: [] });
        return; // on continue à descendre : une emphase peut vivre dans le contenu du titre
      }
      if (node.name === "HeaderMark") {
        // `HeaderMark` est le marqueur `#` d'un titre ATX mais AUSSI la ligne
        // de soulignement `===`/`---` d'un SetextHeading : seuls ceux d'un
        // nœud ATX ouvert (headingStack non vide) sont collectés ici.
        if (headingStack.length > 0) {
          headingStack[headingStack.length - 1].marks.push({ from: node.from, to: node.to });
        }
        return; // un HeaderMark n'a rien à offrir à l'emphase, avec ou sans titre ATX parent
      }
      const type = scriveningsEmphasisTypeOf(node.name);
      if (type) {
        const group: ScriveningsMarkGroup = stack.length === 0 ? { from: node.from, to: node.to, marks: [] } : stack[stack.length - 1].group;
        if (stack.length === 0) groups.push(group);
        stack.push({ type, from: node.from, to: node.to, directMarks: [], group });
        return;
      }
      if (node.name === "EmphasisMark" && stack.length > 0) {
        const frame = stack[stack.length - 1];
        const mark = { from: node.from, to: node.to };
        frame.directMarks.push(mark);
        frame.group.marks.push(mark);
      }
    },
    leave(node) {
      if (node.name === "Blockquote") {
        blockquoteDepth--;
        return;
      }
      const type = scriveningsEmphasisTypeOf(node.name);
      if (type) {
        const frame = stack.pop();
        const open = frame?.directMarks[0];
        const close = frame?.directMarks[1];
        if (!frame || !open || !close) return; // grammaire incomplète pour ce nœud : jamais censé arriver, ignoré par prudence plutôt qu'une supposition
        nodes.push({
          type: frame.type,
          from: frame.from,
          to: frame.to,
          contentFrom: open.to,
          contentTo: close.from,
          openFrom: open.from,
          openTo: open.to,
          closeFrom: close.from,
          closeTo: close.to,
        });
        return;
      }
      if (!scriveningsHeadingLevelOf(node.name)) return;
      const frame = headingStack.pop();
      if (!frame || frame.marks.length === 0) return; // grammaire incomplète : un ATXHeading sans HeaderMark n'existe pas dans la grammaire, garde par prudence
      const markTo = frame.marks[0].to;
      let contentFrom = markTo;
      while (contentFrom < frame.to && text[contentFrom] === " ") contentFrom++;
      const contentTo = frame.marks.length > 1 ? frame.marks[1].from : frame.to;
      headings.push({
        level: frame.level,
        from: frame.from,
        to: frame.to,
        contentFrom,
        contentTo,
        marks: frame.marks,
      });
    },
  });

  return { nodes, groups, headings, horizontalRules, escapedSeparators: findEscapedSeparatorHiddenRanges(text, escapeNodes), callouts };
}

/* --- Cache par segment (LOT 1.3 section 3 — jamais un scan global) -------- */

const SEGMENT_FORMATTING_CACHE_LIMIT = 64;
const segmentFormattingCache = new Map<string, ScriveningsSegmentFormatting>();

/** Résultat mis en cache TANT QUE le texte du segment n'a pas changé — la
 * clé EST le texte lui-même : deux segments au texte identique partagent
 * légitimement le même résultat (offsets locaux, traduits séparément en
 * composite par `compositeScriveningsFormatting`). Éviction FIFO simple audelà
 * de `SEGMENT_FORMATTING_CACHE_LIMIT` : un manuscrit ordinaire tient très
 * large dans cette limite, elle ne fait que borner la mémoire sur une très
 * longue session d'édition. */
export function parseScriveningsSegmentFormattingCached(text: string): ScriveningsSegmentFormatting {
  const cached = segmentFormattingCache.get(text);
  if (cached) return cached;
  const result = parseScriveningsSegmentFormatting(text);
  segmentFormattingCache.set(text, result);
  if (segmentFormattingCache.size > SEGMENT_FORMATTING_CACHE_LIMIT) {
    const [oldest] = segmentFormattingCache.keys();
    if (oldest !== undefined) segmentFormattingCache.delete(oldest);
  }
  return result;
}

/** Réservé aux tests : repart d'un cache vide entre deux scénarios
 * indépendants (le cache module-level survivrait sinon d'un test à l'autre). */
export function clearScriveningsMarkdownCache(): void {
  segmentFormattingCache.clear();
}

function shiftNode(node: ScriveningsEmphasisNode, delta: number): ScriveningsEmphasisNode {
  return {
    type: node.type,
    from: node.from + delta,
    to: node.to + delta,
    contentFrom: node.contentFrom + delta,
    contentTo: node.contentTo + delta,
    openFrom: node.openFrom + delta,
    openTo: node.openTo + delta,
    closeFrom: node.closeFrom + delta,
    closeTo: node.closeTo + delta,
  };
}

function shiftGroup(group: ScriveningsMarkGroup, delta: number): ScriveningsMarkGroup {
  return { from: group.from + delta, to: group.to + delta, marks: group.marks.map((mark) => ({ from: mark.from + delta, to: mark.to + delta })) };
}

function shiftHeading(heading: ScriveningsHeadingNode, delta: number): ScriveningsHeadingNode {
  return {
    level: heading.level,
    from: heading.from + delta,
    to: heading.to + delta,
    contentFrom: heading.contentFrom + delta,
    contentTo: heading.contentTo + delta,
    marks: heading.marks.map((mark) => ({ from: mark.from + delta, to: mark.to + delta })),
  };
}

function shiftCallout(callout: ScriveningsCalloutNode, delta: number): ScriveningsCalloutNode {
  return {
    ...callout,
    from: callout.from + delta,
    to: callout.to + delta,
    headerFrom: callout.headerFrom + delta,
    headerTo: callout.headerTo + delta,
    ...(callout.titleFrom === undefined ? {} : { titleFrom: callout.titleFrom + delta, titleTo: (callout.titleTo ?? callout.titleFrom) + delta }),
    lines: callout.lines.map((line) => ({
      ...line,
      lineStart: line.lineStart + delta,
      lineEnd: line.lineEnd + delta,
      ...(line.prefixFrom === undefined ? {} : { prefixFrom: line.prefixFrom + delta, prefixTo: (line.prefixTo ?? line.prefixFrom) + delta }),
    })),
  };
}

function shiftRange(range: { from: number; to: number }, delta: number): { from: number; to: number } {
  return { from: range.from + delta, to: range.to + delta };
}

/** Parse (via le cache) le texte d'UN segment puis traduit ses offsets
 * locaux en offsets composites (`segment.from` ajouté à chacun) — jamais
 * l'inverse : le parseur ne voit jamais autre chose qu'une chaîne locale. */
export function compositeScriveningsFormatting(segment: ScriveningsSegmentRange, segmentText: string): ScriveningsSegmentFormatting {
  const local = parseScriveningsSegmentFormattingCached(segmentText);
  return {
    nodes: local.nodes.map((node) => shiftNode(node, segment.from)),
    groups: local.groups.map((group) => shiftGroup(group, segment.from)),
    headings: local.headings.map((heading) => shiftHeading(heading, segment.from)),
    horizontalRules: local.horizontalRules.map((range) => shiftRange(range, segment.from)),
    escapedSeparators: local.escapedSeparators.map((range) => shiftRange(range, segment.from)),
    callouts: local.callouts.map((callout) => shiftCallout(callout, segment.from)),
  };
}

/* --- Masquage contextuel des marqueurs ------------------------------------- */

/** Vrai si au moins une sélection (curseur = plage vide) touche `[group.from,
 * group.to]` (bornes incluses : un curseur pile sur un marqueur compte comme
 * touchant le passage). */
export function scriveningsGroupIsActive(group: ScriveningsMarkGroup, selections: readonly SelectionRangeLike[]): boolean {
  return selections.some((selection) => selection.from <= group.to && selection.to >= group.from);
}

/** Même règle que `scriveningsGroupIsActive` pour UN titre : le marqueur `#`
 * (et son espace syntaxique) se réaffiche dès que le curseur/la sélection
 * touche `[heading.from, heading.to]` — exactement comme une emphase. */
export function scriveningsHeadingIsActive(heading: ScriveningsHeadingNode, selections: readonly SelectionRangeLike[]): boolean {
  return selections.some((selection) => selection.from <= heading.to && selection.to >= heading.from);
}

export function scriveningsCalloutIsActive(callout: ScriveningsCalloutNode, selections: readonly SelectionRangeLike[]): boolean {
  return selections.some((selection) => selection.from <= callout.to && selection.to >= callout.from);
}

/* --- Plan de décorations (couche pure, testable sans CodeMirror réel) ----- */

/** Type de style d'une portée : italique/gras, ou le niveau d'un titre ATX
 * (`"heading-1"`…`"heading-6"`) qui reçoit une classe `--h1-*`…`--h6-*`. */
export type ScriveningsMarkdownStyleType = ScriveningsEmphasisType | `heading-${ScriveningsHeadingLevel}`;

export interface ScriveningsMarkdownStyleRange {
  from: number;
  to: number;
  type: ScriveningsMarkdownStyleType;
}

export interface ScriveningsMarkdownDecorationPlan {
  /** Portées de style (italique/gras, titres ATX `--h1-*`…`--h6-*`) —
   * CONTENU seul, jamais les marqueurs propres à CE nœud (un nœud imbriqué
   * peut néanmoins retomber dans la portée de son parent, voir `***texte***`
   * en tête de fichier ; une emphase dans un titre garde SA classe). */
  styleRanges: ScriveningsMarkdownStyleRange[];
  /** Plages à masquer (`Decoration.replace()`) — de trois natures :
   * - marqueurs d'emphase des groupes dont AUCUNE sélection ne touche
   *   `[group.from, group.to]` (contextuel, voir `scriveningsGroupIsActive`) ;
   * - marqueur ouvrant `#…` + espaces syntaxiques (et `#` fermants) des
   *   titres dont AUCUNE sélection ne touche `[heading.from, heading.to]`
   *   (contextuel, même règle — voir `scriveningsHeadingIsActive`) ;
   * - backslashes d'un séparateur `\*\*\*` échappé (voir
   *   `findEscapedSeparatorHiddenRanges`, cm-scrivenings-markdown.ts) —
   *   INCONDITIONNEL, jamais réaffiché par le curseur : ce n'est pas une
   *   emphase, juste le rendu Feuillets normal de ce séparateur.
   */
  hiddenMarkRanges: { from: number; to: number }[];
  calloutLines: { from: number; classes: string; attributes: Record<string, string> }[];
}

/**
 * Construit, PUREMENT à partir de données CodeMirror déjà extraites (jamais
 * l'EditorView lui-même), le plan de décorations Markdown inline de la
 * plage visible : seuls les segments qui recouvrent `visibleRanges` sont
 * parsés (`sliceText` n'est donc jamais appelé sur le composite entier —
 * voir en-tête de fichier, section perf).
 */
export function buildScriveningsMarkdownPlan(params: {
  docLength: number;
  sliceText: (from: number, to: number) => string;
  boundaries: readonly number[];
  visibleRanges: readonly { from: number; to: number }[];
  selections: readonly SelectionRangeLike[];
}): ScriveningsMarkdownDecorationPlan {
  const { docLength, sliceText, boundaries, visibleRanges, selections } = params;
  const segments = scriveningsSegmentsInRanges(scriveningsSegmentRanges(boundaries, docLength), visibleRanges);

  const styleRanges: ScriveningsMarkdownStyleRange[] = [];
  const hiddenMarkRanges: { from: number; to: number }[] = [];
  const calloutLines: { from: number; classes: string; attributes: Record<string, string> }[] = [];

  for (const segment of segments) {
    const segmentText = sliceText(segment.from, segment.to);
    const { nodes, groups, headings, horizontalRules, escapedSeparators, callouts } = compositeScriveningsFormatting(segment, segmentText);
    const overlapsHorizontalRule = (from: number, to: number): boolean =>
      horizontalRules.some((hr) => from < hr.to && to > hr.from);

    // CORRECTIF `\*\*\*` échappé : masquage INCONDITIONNEL, jamais soumis à
    // `scriveningsGroupIsActive` (ce n'est pas une emphase) — voir la doc de
    // `ScriveningsMarkdownDecorationPlan.hiddenMarkRanges` ci-dessus.
    for (const range of escapedSeparators) hiddenMarkRanges.push(range);

    for (const callout of callouts) {
      const active = scriveningsCalloutIsActive(callout, selections);
      for (const line of callout.lines) {
        const classes = [
          "cm-scrivenings-callout-line",
          line.isTitle ? "cm-scrivenings-callout-title" : "cm-scrivenings-callout-body",
          ...(line.isFirst ? ["cm-scrivenings-callout-first"] : []),
          ...(line.isLast ? ["cm-scrivenings-callout-last"] : []),
          ...(active ? ["cm-scrivenings-callout-active"] : []),
          ...(line.isTitle && !callout.explicitTitle ? ["cm-scrivenings-callout-title-auto"] : []),
        ].join(" ");
        const attributes: Record<string, string> = { "data-callout-type": callout.type };
        if (line.isTitle && !callout.explicitTitle) attributes["data-callout-label"] = callout.autoLabel;
        calloutLines.push({ from: line.lineStart, classes, attributes });
        if (!active && !line.isTitle && line.prefixFrom !== undefined && line.prefixTo !== undefined) {
          hiddenMarkRanges.push({ from: line.prefixFrom, to: line.prefixTo });
        }
      }
      if (!active) {
        hiddenMarkRanges.push({ from: callout.headerFrom, to: callout.headerTo });
      }
    }

    for (const node of nodes) {
      // Garde-fou explicite : un `HorizontalRule` (ligne `***` seule) ne
      // partage jamais de position avec une `Emphasis`/`StrongEmphasis` — ce
      // sont deux catégories de nœuds disjointes dans la grammaire — mais on
      // vérifie ici plutôt que de le supposer, pour que le correctif `***`
      // reste vrai même si la grammaire évolue.
      if (node.contentTo > node.contentFrom && !overlapsHorizontalRule(node.contentFrom, node.contentTo)) {
        styleRanges.push({ from: node.contentFrom, to: node.contentTo, type: node.type });
      }
    }
    for (const group of groups) {
      if (scriveningsGroupIsActive(group, selections)) continue;
      for (const mark of group.marks) {
        if (!overlapsHorizontalRule(mark.from, mark.to)) hiddenMarkRanges.push(mark);
      }
    }
    for (const heading of headings) {
      // Style TOUJOURS posé sur le contenu du titre (même quand le curseur
      // réaffiche le `#`, le texte reste un titre — comme en Live Preview
      // Obsidian) ; seul le masquage des marqueurs est contextuel.
      if (heading.contentTo > heading.contentFrom && !overlapsHorizontalRule(heading.contentFrom, heading.contentTo)) {
        styleRanges.push({ from: heading.contentFrom, to: heading.contentTo, type: `heading-${heading.level}` });
      }
      if (scriveningsHeadingIsActive(heading, selections)) continue;
      const opening = heading.marks[0];
      // Marqueur ouvrant `#…` PLUS les espaces syntaxiques qui le séparent du
      // contenu (la plage `[opening.from, contentFrom)` couvre tout : le `#`
      // lui-même et les espaces, un seul ou plusieurs — jamais le contenu).
      if (!overlapsHorizontalRule(opening.from, heading.contentFrom)) {
        hiddenMarkRanges.push({ from: opening.from, to: heading.contentFrom });
      }
      for (const mark of heading.marks.slice(1)) {
        if (!overlapsHorizontalRule(mark.from, mark.to)) hiddenMarkRanges.push(mark);
      }
    }
  }

  styleRanges.sort((a, b) => a.from - b.from);
  hiddenMarkRanges.sort((a, b) => a.from - b.from);
  calloutLines.sort((a, b) => a.from - b.from);
  return { styleRanges, hiddenMarkRanges, calloutLines };
}

/* --- Rendu CodeMirror réel (fine couche de branchement) -------------------- */

export const CM_SCRIVENINGS_EMPHASIS_CLASS = "cm-scrivenings-emphasis";
export const CM_SCRIVENINGS_STRONG_CLASS = "cm-scrivenings-strong";

const CM_SCRIVENINGS_HEADING_CLASSES: Record<ScriveningsHeadingLevel, string> = {
  1: "cm-scrivenings-heading-h1",
  2: "cm-scrivenings-heading-h2",
  3: "cm-scrivenings-heading-h3",
  4: "cm-scrivenings-heading-h4",
  5: "cm-scrivenings-heading-h5",
  6: "cm-scrivenings-heading-h6",
};

export function scriveningsHeadingClass(level: ScriveningsHeadingLevel): string {
  return CM_SCRIVENINGS_HEADING_CLASSES[level];
}

function buildDecorationSet(plan: ScriveningsMarkdownDecorationPlan): DecorationSet {
  if (typeof DecorationTyped?.set !== "function") return DecorationTyped?.none;
  const ranges: DecoRange[] = [];
  for (const span of plan.styleRanges) {
    if (typeof DecorationTyped.mark !== "function") continue;
    let cls: string;
    if (span.type === "strong") {
      cls = CM_SCRIVENINGS_STRONG_CLASS;
    } else if (span.type === "emphasis") {
      cls = CM_SCRIVENINGS_EMPHASIS_CLASS;
    } else {
      cls = CM_SCRIVENINGS_HEADING_CLASSES[Number(span.type.slice("heading-".length)) as ScriveningsHeadingLevel];
    }
    ranges.push(DecorationTyped.mark({ class: cls }).range(span.from, span.to));
  }
  for (const mark of plan.hiddenMarkRanges) {
    if (typeof DecorationTyped.replace !== "function") continue;
    ranges.push(DecorationTyped.replace({}).range(mark.from, mark.to));
  }
  for (const line of plan.calloutLines) {
    if (typeof DecorationTyped.line !== "function") continue;
    ranges.push(DecorationTyped.line({ attributes: { class: line.classes, ...line.attributes } }).range(line.from));
  }
  return DecorationTyped.set(ranges, true);
}

function buildPlanFromView(view: EditorViewInstance, boundariesField: unknown): ScriveningsMarkdownDecorationPlan {
  const boundaries = (view.state.field(boundariesField, false) as number[] | undefined) ?? [];
  const visibleRanges = view.visibleRanges ?? [{ from: 0, to: view.state.doc.length }];
  const selections = view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }));
  return buildScriveningsMarkdownPlan({
    docLength: view.state.doc.length,
    sliceText: (from, to) => view.state.doc.sliceString(from, to),
    boundaries,
    visibleRanges,
    selections,
  });
}

/** Construit le ViewPlugin qui recalcule le plan (donc les décorations) sur
 * édition du document, changement de viewport, ou changement de
 * sélection/curseur — jamais à d'autres occasions. Un simple déplacement du
 * curseur ne produit AUCUNE transaction de document (voir `update()` : seule
 * `this.decorations` change, aucun `dispatch`). `boundariesField` est
 * PASSÉ EN PARAMÈTRE (voir en-tête de fichier — jamais importé de
 * cm-scrivenings.ts) : c'est le `scriveningsBoundariesField` de ce module,
 * fourni par `createScriveningsMarkdownExtensions` ci-dessous. */
export function createScriveningsMarkdownPlugin(boundariesField: unknown): unknown {
  if (typeof ViewPluginTyped?.fromClass !== "function") return [];
  return ViewPluginTyped.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorViewInstance) {
        this.decorations = buildDecorationSet(buildPlanFromView(view, boundariesField));
      }

      update(update: ViewUpdateLike) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorationSet(buildPlanFromView(update.view, boundariesField));
        }
      }
    },
    { decorations: (value: { decorations: DecorationSet }) => value.decorations }
  );
}

/* --- Cmd/Ctrl+I et Cmd/Ctrl+B (LOT 1.3 section 6) -------------------------- */

const SCRIVENINGS_MARKERS: Record<ScriveningsEmphasisType, string> = { emphasis: "*", strong: "**" };

export interface ScriveningsFormattingChange {
  from: number;
  to: number;
  insert: string;
}

export interface ScriveningsFormattingPlan {
  changes: ScriveningsFormattingChange[];
  selection: { anchor: number; head: number };
}

/** Même règle que `crossesScriveningsBoundary` (cm-scrivenings.ts) : vrai si
 * `[from, to)` recouvre au moins une jonction. Réimplémentée ici en une
 * ligne plutôt qu'importée — voir « SENS DE DÉPENDANCE » en tête de fichier
 * (cm-scrivenings.ts importe CE module, jamais l'inverse). */
function scriveningsRangeCrossesBoundary(boundaries: readonly number[], from: number, to: number): boolean {
  return boundaries.some((offset) => from <= offset && offset < to);
}

/** Un caret (from === to) posé EXACTEMENT sur une jonction est traité comme
 * une frontière franchie : cette position n'appartient sans ambiguïté à
 * aucun des deux segments (voir `segmentAt`, services/scrivenings-
 * document.ts — seule une position `> from` et `< to` d'un segment y
 * appartient sans ambiguïté quand elle coïncide avec une jonction). */
function scriveningsCaretOrSelectionCrossesBoundary(boundaries: readonly number[], from: number, to: number): boolean {
  if (from === to) return boundaries.includes(from);
  return scriveningsRangeCrossesBoundary(boundaries, from, to);
}

/**
 * Planifie PUREMENT (aucun accès CodeMirror) l'effet de Cmd/Ctrl+I ou
 * Cmd/Ctrl+B : `null` signifie « ne rien modifier » (sélection hors segment
 * ou franchissant une frontière) — au commande appelante de tout de même
 * consommer le raccourci (voir `scriveningsToggleEmphasis`/`Strong`
 * ci-dessous) pour éviter tout comportement navigateur parasite.
 */
export function planScriveningsToggleFormatting(params: {
  docLength: number;
  sliceText: (from: number, to: number) => string;
  boundaries: readonly number[];
  selectionFrom: number;
  selectionTo: number;
  type: ScriveningsEmphasisType;
}): ScriveningsFormattingPlan | null {
  const { docLength, sliceText, boundaries, type } = params;
  const from = Math.min(params.selectionFrom, params.selectionTo);
  const to = Math.max(params.selectionFrom, params.selectionTo);
  if (scriveningsCaretOrSelectionCrossesBoundary(boundaries, from, to)) return null;

  const marker = SCRIVENINGS_MARKERS[type];

  // Curseur sans sélection : insère une paire de marqueurs et place le
  // curseur entre les deux (largeur d'insertion = 2x la largeur du
  // marqueur — un « `**`  » pour l'italique, un « `****` » pour le gras).
  if (from === to) {
    return {
      changes: [{ from, to, insert: marker + marker }],
      selection: { anchor: from + marker.length, head: from + marker.length },
    };
  }

  const segments = scriveningsSegmentRanges(boundaries, docLength);
  const segment = segments.find((candidate) => from >= candidate.from && to <= candidate.to);
  if (!segment) return null;

  const segmentText = sliceText(segment.from, segment.to);
  const { nodes } = compositeScriveningsFormatting(segment, segmentText);
  const existing = nodes.find((node) => node.type === type && node.contentFrom === from && node.contentTo === to);

  // La sélection correspond exactement au contenu déjà entouré par CE
  // formatage : le raccourci le retire (ses propres marqueurs seulement,
  // jamais ceux d'un nœud imbriqué).
  if (existing) {
    const openWidth = existing.openTo - existing.openFrom;
    return {
      changes: [
        { from: existing.closeFrom, to: existing.closeTo, insert: "" },
        { from: existing.openFrom, to: existing.openTo, insert: "" },
      ],
      selection: { anchor: existing.openFrom, head: to - openWidth },
    };
  }

  return {
    changes: [
      { from, to: from, insert: marker },
      { from: to, to, insert: marker },
    ],
    selection: { anchor: from + marker.length, head: to + marker.length },
  };
}

/** Cmd/Ctrl+I ou Cmd/Ctrl+B, réservés à Scrivenings (jamais branchés
 * ailleurs). `boundariesField` PASSÉ EN PARAMÈTRE, jamais importé — même
 * raison que `createScriveningsMarkdownPlugin` ci-dessus. */
export function createScriveningsToggleCommand(boundariesField: unknown, type: ScriveningsEmphasisType) {
  return (view: EditorViewInstance): boolean => {
    const boundaries = (view.state.field(boundariesField, false) as number[] | undefined) ?? [];
    const selection = view.state.selection.main;
    const plan = planScriveningsToggleFormatting({
      docLength: view.state.doc.length,
      sliceText: (from, to) => view.state.doc.sliceString(from, to),
      boundaries,
      selectionFrom: selection.from,
      selectionTo: selection.to,
      type,
    });
    // Toujours vrai : le raccourci est consommé même quand il ne modifie
    // rien (sélection multi-feuillets) — jamais de retour au navigateur.
    if (!plan) return true;
    view.dispatch?.({ changes: plan.changes, selection: plan.selection });
    return true;
  };
}

/**
 * Point d'entrée public de ce lot pour le RENDU seul : construit, à partir
 * du `scriveningsBoundariesField` réel de cm-scrivenings.ts (passé en
 * paramètre, jamais importé — voir « SENS DE DÉPENDANCE » en tête de
 * fichier), le ViewPlugin qui affiche italique/gras et masque
 * contextuellement leurs marqueurs. Ne porte AUCUN keymap depuis le
 * micro-lot 1.3.1 — `Mod-i`/`Mod-b` sont assemblés par cm-scrivenings.ts,
 * dans le MÊME `Prec.highest(keymap.of([...]))` que le correctif Redo (voir
 * sa doc : les trois raccourcis doivent être prioritaires ENSEMBLE, dans un
 * seul keymap, pour gagner face aux bindings par défaut de CodeMirror/
 * Obsidian). `createScriveningsToggleCommand` (ci-dessus) reste la manière
 * d'obtenir les commandes elles-mêmes.
 */
export function createScriveningsMarkdownExtensions(boundariesField: unknown): unknown[] {
  return [createScriveningsMarkdownPlugin(boundariesField)];
}
