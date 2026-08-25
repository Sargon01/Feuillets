import { parser } from "@lezer/markdown";
import { splitPresentationMarkdownWithRanges, type PresentationSlideSource } from "./presentation.js";
import { measurePresentationSlideOverflow, type MeasurePresentationSlideOverflowOptions } from "./presentation-slide-renderer.js";
import { SEMANTIC_ROLE_ALIASES, type SemanticRole } from "../utils/semantic-roles.js";
import type { App, Component } from "obsidian";
import type { ResolvedPresentationTheme } from "./presentation-theme.js";

type Probe = (markdown: string, index: number) => Promise<boolean>;

export interface PlanPresentationSlidesOptions {
  app: App;
  component: Component;
  sourcePath: string;
  markdown: string;
  roleEditorDisplay?: "callouts" | "compact";
  theme?: ResolvedPresentationTheme;
  /** Injection étroite réservée aux tests ; la production utilise le renderer réel. */
  measureOverflow?: Probe;
}

type AtomicBlock = {
  markdown: string;
  startLine: number;
  endLine: number;
  heading: number | null;
  role: SemanticRole | null;
  from: number;
  to: number;
};

const STRUCTURING_ROLES: readonly SemanticRole[] = [
  "introduction", "objectifs", "competences", "questions", "synthese", "point-cle", "recommandation",
];

function blockWeight(block: AtomicBlock): number {
  return Math.max(1, block.markdown.replace(/\s+/g, " ").trim().length);
}

function lineAt(markdown: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index++) if (markdown[index] === "\n") line++;
  return line;
}

function lineStartAt(markdown: string, offset: number): number {
  const start = markdown.lastIndexOf("\n", Math.max(0, offset - 1));
  return start < 0 ? 0 : start + 1;
}

function calloutRole(markdown: string): SemanticRole | null {
  const firstLine = markdown.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";
  const match = firstLine.match(/^(?: {0,3}>[ \t]?)+[ \t]*\[!([^\]\s]+)\](?:[+-])?(?:[ \t].*)?$/u);
  return match ? SEMANTIC_ROLE_ALIASES[match[1].toLocaleLowerCase()] ?? null : null;
}

function isSpeakerNotes(markdown: string): boolean {
  const firstLine = markdown.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";
  return /^(?: {0,3}>[ \t]?)+[ \t]*\[!speaker-notes\](?:[+-])?(?:[ \t].*)?$/iu.test(firstLine);
}

function headingLevel(name: string): number | null {
  const match = /^ATXHeading([1-6])$/u.exec(name);
  return match ? Number(match[1]) : null;
}

/** Parse chaque segment explicite une seule fois et conserve ses offsets source. */
function atomicBlocks(segment: PresentationSlideSource): AtomicBlock[] {
  const tree = parser.parse(segment.markdown);
  const blocks: AtomicBlock[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.to <= node.from || segment.markdown.slice(node.from, node.to).trim() === "") continue;
    const from = lineStartAt(segment.markdown, node.from);
    const markdown = segment.markdown.slice(from, node.to);
    const block: AtomicBlock = {
      markdown,
      startLine: segment.startLine + lineAt(segment.markdown, node.from),
      endLine: segment.startLine + lineAt(segment.markdown, Math.max(node.from, node.to - 1)),
      heading: headingLevel(node.name),
      role: node.name === "Blockquote" ? calloutRole(markdown) : null,
      from,
      to: node.to,
    };
    if (isSpeakerNotes(markdown) && blocks.length > 0) {
      const previous = blocks[blocks.length - 1];
      previous.to = node.to;
      previous.markdown = segment.markdown.slice(previous.from, previous.to);
      previous.endLine = block.endLine;
    } else {
      blocks.push(block);
    }
  }
  return blocks;
}

function boundaryPriority(right: AtomicBlock): number {
  if (right.heading === 1) return 0;
  if (right.heading === 2) return 1;
  if (right.role === "question-directrice") return 2;
  if (right.heading === 3) return 3;
  if (right.role && STRUCTURING_ROLES.includes(right.role)) return 4;
  if (right.role) return 5;
  return 6;
}

function affinityPenalty(left: AtomicBlock, right: AtomicBlock): number {
  return (left.role === "argument" && right.role === "preuve")
    || (left.role === "hypothese" && right.role === "preuve")
    || (left.role === "definition" && right.role === "explication")
    || (left.role === "source" && (right.role === "explication" || right.markdown.includes("!")))
    || (left.role === "objectifs" && right.role === "competences") ? 1 : 0;
}

function chooseBoundary(blocks: readonly AtomicBlock[]): number {
  const total = blocks.reduce((sum, block) => sum + blockWeight(block), 0);
  const candidates = Array.from({ length: blocks.length - 1 }, (_, index) => index + 1)
    .filter((boundary) => !(blocks.length > 2 && boundary === 1 && blocks[0].heading !== null));
  const ranked = candidates.map((boundary) => {
    const leftWeight = blocks.slice(0, boundary).reduce((sum, block) => sum + blockWeight(block), 0);
    return { boundary, priority: boundaryPriority(blocks[boundary]), affinity: affinityPenalty(blocks[boundary - 1], blocks[boundary]), distance: Math.abs(total / 2 - leftWeight) };
  });
  ranked.sort((a, b) => a.priority - b.priority || a.affinity - b.affinity || a.distance - b.distance || a.boundary - b.boundary);
  return ranked[0]?.boundary ?? 0;
}

export async function planPresentationSlides(options: PlanPresentationSlidesOptions): Promise<PresentationSlideSource[]> {
  const explicit = splitPresentationMarkdownWithRanges(options.markdown);
  if (!explicit.length) return [];
  const cache = new Map<string, boolean>();
  const measure: Probe = options.measureOverflow ?? (async (markdown, index) => {
    const controller = new AbortController();
    const probeOptions: MeasurePresentationSlideOverflowOptions = {
      app: options.app, component: options.component, sourcePath: options.sourcePath, markdown, index, generation: 0,
      controller, isGenerationStale: () => false, roleEditorDisplay: options.roleEditorDisplay, theme: options.theme,
    };
    return measurePresentationSlideOverflow(probeOptions);
  });
  const output: PresentationSlideSource[] = [];
  let probeIndex = 0;
  const planSegment = async (segment: PresentationSlideSource, segmentIndex: number): Promise<void> => {
    const blocks = atomicBlocks(segment);
    if (blocks.length === 0) { output.push(segment); return; }
    const planRange = async (start: number, end: number): Promise<void> => {
      const first = blocks[start];
      const last = blocks[end - 1];
      const isWholeSegment = start === 0 && end === blocks.length;
      const markdown = isWholeSegment ? segment.markdown : segment.markdown.slice(first.from, last.to);
      const key = `${segmentIndex}:${start}:${end}`;
      let overflow = cache.get(key);
      if (overflow === undefined) { overflow = await measure(markdown, probeIndex++); cache.set(key, overflow); }
      if (!overflow || end - start <= 1) {
        output.push({
          markdown,
          startLine: first.startLine,
          endLine: end === blocks.length ? segment.endLine : blocks[end].startLine - 1,
        });
        return;
      }
      const boundary = chooseBoundary(blocks.slice(start, end));
      const split = start + boundary;
      if (split <= start || split >= end) {
        output.push({
          markdown,
          startLine: first.startLine,
          endLine: end === blocks.length ? segment.endLine : blocks[end].startLine - 1,
        });
        return;
      }
      await planRange(start, split);
      await planRange(split, end);
    };
    await planRange(0, blocks.length);
  };
  for (let index = 0; index < explicit.length; index++) await planSegment(explicit[index], index);
  return output;
}
