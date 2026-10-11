import { parser, Table } from "@lezer/markdown";
import { resolveLayoutOverride, type LayoutOverride, type ParagraphLayoutProperties } from "./layout-store.js";
import { SEMANTIC_ROLE_ALIASES, type SemanticRole } from "../utils/semantic-roles.js";

export const DOCUMENT_LAYOUT_EXPORT_CSS = `
.feuillets-page-break-before {
  break-before: page;
  page-break-before: always;
}` + ["left", "center", "right", "justify"].map((alignment) => `
p.feuillets-paragraph-alignment-${alignment} { text-align: ${alignment}; }`).join("")
  + [0, 6, 12, 18].map((amount) => `
p.feuillets-paragraph-indent-${amount} { text-indent: ${amount}pt; }
p.feuillets-paragraph-before-${amount} { margin-top: ${amount}pt; }
p.feuillets-paragraph-after-${amount} { margin-bottom: ${amount}pt; }`).join("");

const PREFIX = "FEUILLETS_LAYOUT_";
const BLOCK_KINDS = new Set(["heading", "hr", "table", "image", "list", "blockquote", "paragraph", "code"]);
const PARAGRAPH_PARSER = parser.configure([Table]);
type BlockKind = "heading" | "hr" | "table" | "image" | "list" | "blockquote" | "paragraph" | "code";
export interface DocumentLayoutBlock { kind: BlockKind; startOffset: number; endOffset: number; startLine: number; endLine: number; role?: SemanticRole | null; questionLineOffset?: number; }

/** Only top-level Markdown paragraphs can receive typography overrides.
 * The parser excludes lazy list continuations, HTML and indented code, which
 * the existing line classifier deliberately does not fully interpret. */
export function isOrdinaryLayoutParagraph(markdown: string, block: Pick<DocumentLayoutBlock, "kind" | "startOffset" | "endOffset">): boolean {
  if (block.kind !== "paragraph" && block.kind !== "table") return false;
  if (/^\s{0,3}(?:\[\^[^\]]+\]:|\$\$|%%)/u.test(markdown.slice(block.startOffset, block.endOffset))) return false;
  return PARAGRAPH_PARSER.parse(markdown).topNode.getChildren("Paragraph").some((node) =>
    node.from >= block.startOffset && /^ {0,3}$/u.test(markdown.slice(block.startOffset, node.from)) && node.to === block.endOffset
  );
}

function lineRanges(markdown: string): Array<{ text: string; start: number; end: number }> {
  const result: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  for (const part of markdown.split("\n")) {
    const end = start + part.length;
    result.push({ text: part, start, end });
    start = end + 1;
  }
  return result;
}

function roleOf(line: string): SemanticRole | null {
  const match = line.match(/^\s*>\s*\[!([A-Za-z0-9_-]+)\]/u);
  return match ? SEMANTIC_ROLE_ALIASES[match[1].toLowerCase()] || null : null;
}

function classify(line: string, inFence: boolean): BlockKind | "blank" | "frontmatter" {
  if (line.trim() === "") return "blank";
  if (inFence) return "code";
  if (/^\s{0,3}#{1,6}(?:\s|$)/u.test(line)) return "heading";
  if (/^\s{0,3}(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/u.test(line)) return "hr";
  if (/^\s*[-+*]\s+|^\s*\d+[.)]\s+/u.test(line)) return "list";
  if (/^\s*>/.test(line)) return "blockquote";
  if (/^\s*!\[\[[^\]]+\]\]\s*$/.test(line) || /^\s*!\[[^\]]*\]\([^)]+\)\s*$/.test(line)) return "image";
  if (line.includes("|")) return "table";
  return "paragraph";
}

export function documentLayoutBlocks(markdown: string): DocumentLayoutBlock[] {
  const lines = lineRanges(markdown);
  const blocks: DocumentLayoutBlock[] = [];
  let frontmatter = lines[0]?.text.trim() === "---";
  let fence: "```" | "~~~" | null = null;
  let current: { kind: BlockKind; start: number; end: number; startLine: number; endLine: number } | null = null;
  const flush = () => { if (current) { blocks.push({ kind: current.kind, startOffset: current.start, endOffset: current.end, startLine: current.startLine, endLine: current.endLine }); current = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontmatter) { if (line.text.trim() === "---" && i > 0) frontmatter = false; continue; }
    const fenceMatch = line.text.match(/^\s*(`{3,}|~{3,})/u);
    const insideFence = fence !== null;
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0] === "`" ? "```" : "~~~";
      else if (fence[0] === fenceMatch[1][0] && fenceMatch[1].length >= 3 && new RegExp(`^\\s*${fence[0]}{3,}\\s*$`).test(line.text)) fence = null;
    }
    const kind = classify(line.text, insideFence || fence !== null || !!fenceMatch);
    if (kind === "blank") { flush(); continue; }
    if (!BLOCK_KINDS.has(kind)) { flush(); continue; }
    const structural = kind as BlockKind;
    const canMerge = current && ((structural === current.kind && ["paragraph", "list", "blockquote", "table", "code"].includes(structural)));
    if (!canMerge) { flush(); current = { kind: structural, start: line.start, end: line.end, startLine: i, endLine: i }; }
    else if (current) { current.end = line.end; current.endLine = i; }
  }
  flush();
  for (const block of blocks) {
    if (block.kind === "blockquote") block.role = roleOf(lines[block.startLine].text);
    if (block.role === "questions") {
      for (let i = block.startLine; i <= block.endLine; i++) {
        if (/^\s*>\s*\d+[.)]\s+/u.test(lines[i].text)) { block.questionLineOffset = lines[i].start; break; }
      }
    }
  }
  return blocks;
}

function blockAt(blocks: DocumentLayoutBlock[], start: number, end: number): DocumentLayoutBlock | null {
  return blocks.find((block) => block.startOffset === start && block.endOffset === end) || null;
}

function markerFor(override: LayoutOverride): string | null {
  switch (override.kind) {
    case "answer-lines": return `${PREFIX}ANSWER_LINES_${override.lines}`;
    case "answer-space": return `${PREFIX}ANSWER_SPACE_${override.amount}_${override.unit.toUpperCase()}`;
    case "page-break-before": return `${PREFIX}PAGE_BREAK_BEFORE`;
    case "paragraph-layout": return [
      override.alignment !== undefined ? `${PREFIX}PARAGRAPH_ALIGNMENT_${override.alignment.toUpperCase()}` : "",
      override.firstLineIndentPt !== undefined ? `${PREFIX}PARAGRAPH_INDENT_${override.firstLineIndentPt}` : "",
      override.spacingBeforePt !== undefined ? `${PREFIX}PARAGRAPH_BEFORE_${override.spacingBeforePt}` : "",
      override.spacingAfterPt !== undefined ? `${PREFIX}PARAGRAPH_AFTER_${override.spacingAfterPt}` : "",
    ].filter(Boolean).join("\n\n");
    default: return null;
  }
}

export function injectDocumentLayoutMarkers(markdown: string, overrides: LayoutOverride[]): string {
  const blocks = documentLayoutBlocks(markdown);
  const insertions: Array<{ offset: number; text: string; order: number }> = [];
  for (const override of overrides) {
    const resolved = resolveLayoutOverride(override, markdown);
    if (!resolved) continue;
    const marker = markerFor(override);
    if (!marker) continue;
    if (override.kind === "answer-lines" || override.kind === "answer-space") {
      const start = resolved.start;
      const lineEnd = markdown.indexOf("\n", start) === -1 ? markdown.length : markdown.indexOf("\n", start);
      insertions.push({ offset: lineEnd, text: ` ${marker}`, order: 3 });
    } else {
      const target = blockAt(blocks, resolved.start, resolved.end);
      if (!target || (override.kind === "page-break-before" && target.kind === "code" && target.startOffset < resolved.start)) continue;
      if (override.kind === "paragraph-layout" && !isOrdinaryLayoutParagraph(markdown, target)) continue;
      insertions.push({ offset: target.startOffset, text: `${marker}\n\n`, order: override.kind === "page-break-before" ? 0 : 2 });
    }
  }
  insertions.sort((a, b) => b.offset - a.offset || a.order - b.order);
  let result = markdown;
  for (const insertion of insertions) result = result.slice(0, insertion.offset) + insertion.text + result.slice(insertion.offset);
  return result;
}

/** The complete, deliberately punctuation-free in-memory protocol. */
const DOCUMENT_MARKER = /FEUILLETS_LAYOUT_(?:ANSWER_LINES_\d+|ANSWER_SPACE_\d+_(?:LH|MM)|PAGE_BREAK_BEFORE|PARAGRAPH_ALIGNMENT_(?:LEFT|CENTER|RIGHT|JUSTIFY)|PARAGRAPH_(?:INDENT|BEFORE|AFTER)_\d+)/gu;

const PARAGRAPH_CLASSES = {
  alignment: "feuillets-paragraph-alignment-",
  firstLineIndentPt: "feuillets-paragraph-indent-",
  spacingBeforePt: "feuillets-paragraph-before-",
  spacingAfterPt: "feuillets-paragraph-after-",
} as const;

/** Classes survive the common DOM cleanup and serialization into EPUB.
 * Exporters read only the declared local properties, never computed defaults. */
export function paragraphLayoutPropertiesOf(element: { getAttribute(name: string): string | null }): ParagraphLayoutProperties {
  const result: ParagraphLayoutProperties = {};
  for (const name of (element.getAttribute("class") || "").split(/\s+/u)) {
    if (name.startsWith(PARAGRAPH_CLASSES.alignment)) {
      const value = name.slice(PARAGRAPH_CLASSES.alignment.length);
      if (value === "left" || value === "center" || value === "right" || value === "justify") result.alignment = value;
    }
    for (const key of ["firstLineIndentPt", "spacingBeforePt", "spacingAfterPt"] as const) {
      if (!name.startsWith(PARAGRAPH_CLASSES[key])) continue;
      const value = name.slice(PARAGRAPH_CLASSES[key].length);
      const number = Number(value);
      if (/^\d+$/u.test(value) && Number.isSafeInteger(number)) result[key] = number;
    }
  }
  return result;
}

function markerTextNodes(root: Element): Array<{ node: Text; parent: HTMLElement; block: HTMLElement }> {
  const out: Array<{ node: Text; parent: HTMLElement; block: HTMLElement }> = [];
  const walker = root.ownerDocument?.createTreeWalker(root, 4);
  if (!walker) return out;
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    let block = parent;
    while (block?.parentElement && block.parentElement !== root) block = block.parentElement;
    if (parent && block && node.nodeValue && DOCUMENT_MARKER.test(node.nodeValue)) out.push({ node: node as Text, parent, block });
    DOCUMENT_MARKER.lastIndex = 0;
    node = walker.nextNode();
  }
  return out;
}

export function isLayoutMarkerOnlyBlock(block: Element): boolean {
  if (block.querySelector("img, video, table, ol, ul, blockquote, h1, h2, h3, h4, h5, h6")) return false;
  DOCUMENT_MARKER.lastIndex = 0;
  return (block.textContent || "").replace(DOCUMENT_MARKER, "").trim() === "";
}

function followingRealBlocks(root: Element, block: Element): Element[] {
  const children = Array.from(root.children);
  const index = children.indexOf(block);
  return index < 0 ? [] : children.slice(index + 1).filter((candidate) => !isLayoutMarkerOnlyBlock(candidate) && !!candidate.textContent?.trim());
}

export function nextRealLayoutBlock(root: Element, block: Element): Element | null { return followingRealBlocks(root, block)[0] || null; }

function nextQuestionItem(parent: HTMLElement): HTMLElement | null {
  const li = parent.closest("li");
  if (!li || !li.closest(".feuillets-role-questions, [data-callout='questions']")) return null;
  return li;
}

function applyToken(root: HTMLElement, block: HTMLElement, parent: HTMLElement, marker: string): void {
  const paragraph = marker.match(/^FEUILLETS_LAYOUT_PARAGRAPH_(ALIGNMENT|INDENT|BEFORE|AFTER)_([A-Z]+|\d+)$/u);
  if (paragraph) {
    const target = nextRealLayoutBlock(root, block);
    if (!(target instanceof HTMLElement) || target.tagName !== "P") return;
    const keys = { ALIGNMENT: "alignment", INDENT: "firstLineIndentPt", BEFORE: "spacingBeforePt", AFTER: "spacingAfterPt" } as const;
    const kind = paragraph[1] as keyof typeof keys;
    const value = paragraph[2].toLowerCase();
    target.classList.add(`${PARAGRAPH_CLASSES[keys[kind]]}${value}`);
    const css = { ALIGNMENT: "text-align", INDENT: "text-indent", BEFORE: "margin-top", AFTER: "margin-bottom" } as const;
    target.style.setProperty(css[kind], kind === "ALIGNMENT" ? value : `${value}pt`);
    return;
  }
  if (marker === `${PREFIX}PAGE_BREAK_BEFORE`) {
    nextRealLayoutBlock(root, block)?.classList.add("feuillets-page-break-before");
    return;
  }
  if (marker.startsWith(`${PREFIX}ANSWER_`)) {
    const li = nextQuestionItem(parent);
    if (li) addAnswer(li, marker);
  }
}

function addAnswer(li: HTMLElement, marker: string): void {
  li.querySelectorAll(":scope > .feuillets-answer-line, :scope > .feuillets-answer-space").forEach((el) => el.remove());
  li.classList.add("feuillets-answer-custom");
  const lines = marker.match(/^FEUILLETS_LAYOUT_ANSWER_LINES_(\d+)$/u);
  if (lines) { for (let i = 0; i < Number(lines[1]); i++) li.appendChild(createSpan({ cls: "feuillets-answer-line" })); return; }
  const space = marker.match(/^FEUILLETS_LAYOUT_ANSWER_SPACE_(\d+)_(LH|MM)$/u);
  if (space) { const el = createSpan({ cls: "feuillets-answer-space" }); el.setAttribute("style", `height: ${space[1]}${space[2].toLowerCase()};`); li.appendChild(el); }
}

function applyDefaultAnswers(root: HTMLElement): void {
  root.querySelectorAll(".feuillets-role-questions, [data-callout='questions']").forEach((role) => {
    role.querySelectorAll("li").forEach((li) => {
      if (li.parentElement?.tagName !== "OL" || li.parentElement.parentElement?.closest("li")) return;
      if (li.classList.contains("feuillets-answer-custom")) return;
      li.classList.add("feuillets-answer-custom");
      for (let i = 0; i < 2; i++) li.appendChild(createSpan({ cls: "feuillets-answer-line" }));
    });
  });
}

export function applyDocumentLayoutMarkers(root: HTMLElement): number {
  const collected = markerTextNodes(root);
  let applied = 0;
  for (const entry of collected) {
    DOCUMENT_MARKER.lastIndex = 0;
    for (const marker of entry.node.nodeValue?.match(DOCUMENT_MARKER) || []) {
      applyToken(root, entry.block, entry.parent, marker);
      applied++;
    }
  }
  for (const entry of collected) {
    DOCUMENT_MARKER.lastIndex = 0;
    entry.node.nodeValue = (entry.node.nodeValue || "").replace(DOCUMENT_MARKER, "");
  }
  const markerBlocks = new Set(collected.map((entry) => entry.block));
  for (const child of markerBlocks) if (isLayoutMarkerOnlyBlock(child)) child.remove();
  applyDefaultAnswers(root);
  return applied;
}

export function hasRemainingDocumentLayoutMarker(root: HTMLElement): boolean { return markerTextNodes(root).length > 0 || root.textContent?.includes(PREFIX) === true; }
