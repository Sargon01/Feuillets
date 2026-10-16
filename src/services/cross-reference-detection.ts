import { parser, Table } from "@lezer/markdown";
import { parseImageMarkdown } from "./image-markdown.js";
import { splitFrontmatter } from "./frontmatter.js";
import type { HeadingOutlineInput } from "./heading-outline.js";
import { createSourceAnchor } from "./source-anchor.js";
import { isCrossReferenceSourceFile, type DetectedCrossReferenceTarget, type CrossReferenceTargetType } from "./cross-reference-model.js";

const markdownParser = parser.configure([Table]);

export interface CrossReferenceDetectionContext {
  fileOrder?: number;
  /** Supplied by the existing editorial appendix-file resolver. */
  appendixTitle?: string;
}

/** Reads real-file Markdown using the same Lezer grammar as the existing editor. */
export function detectCrossReferenceTargets(
  sourceFile: string,
  content: string,
  context: CrossReferenceDetectionContext = {},
): DetectedCrossReferenceTarget[] {
  if (!isCrossReferenceSourceFile(sourceFile)) throw new Error("Cross-reference source must be a vault Markdown file path");
  const { frontmatter, body } = splitFrontmatter(content);
  const base = frontmatter.length;
  let parsedBody = body;
  let tree = markdownParser.parse(body);
  const excludedNames = new Set(["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "Comment", "CommentBlock"]);
  if (body.includes("%%")) {
    const protectedRanges: { start: number; end: number }[] = [];
    tree.iterate({ enter(node) {
      if (!excludedNames.has(node.name)) return;
      protectedRanges.push({ start: node.from, end: node.to });
      return false;
    } });
    let commentStart: number | null = null;
    const comments: { start: number; end: number }[] = [];
    for (const match of body.matchAll(/%%/g)) {
      const offset = match.index;
      if (commentStart === null && protectedRanges.some((range) => offset >= range.start && offset < range.end)) continue;
      if (commentStart === null) commentStart = offset;
      else { comments.push({ start: commentStart, end: offset + 2 }); commentStart = null; }
    }
    if (commentStart !== null) comments.push({ start: commentStart, end: body.length });
    for (const range of comments.reverse()) {
      parsedBody = parsedBody.slice(0, range.start) + parsedBody.slice(range.start, range.end).replace(/[^\r\n]/g, " ") + parsedBody.slice(range.end);
    }
    if (comments.length) tree = markdownParser.parse(parsedBody);
  }
  const targets: DetectedCrossReferenceTarget[] = [];
  const excluded: { start: number; end: number }[] = [];
  const images: { start: number; end: number }[] = [];
  const headings: HeadingOutlineInput[] = [];
  const add = (type: CrossReferenceTargetType, start: number, end: number, titleOrCaption: string): void => {
    const anchor = createSourceAnchor(content, start, end);
    if (anchor) targets.push({ type, sourceFile, anchor, titleOrCaption, sourceOrder: { fileOrder: context.fileOrder ?? 0, offset: start } });
  };
  tree.iterate({
    enter(node) {
      if (excludedNames.has(node.name)) {
        excluded.push({ start: node.from, end: node.to });
        return false;
      }
      const heading = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (heading) {
        const marks: { from: number; to: number }[] = [];
        let child = node.node.firstChild;
        while (child) {
          if (child.name === "HeaderMark") marks.push({ from: child.from, to: child.to });
          child = child.nextSibling;
        }
        const start = heading[1] === "ATX" ? marks[0]?.to ?? node.from : node.from;
        const end = heading[1] === "ATX" ? marks[1]?.from ?? node.to : marks[0]?.from ?? node.to;
        headings.push({ text: parsedBody.slice(start, end).trim(), level: Number(heading[2]), startOffset: base + node.from, endOffset: base + node.to });
      }
      if (node.name === "Image") images.push({ start: node.from, end: node.to });
      if (node.name === "Table") {
        const header = node.node.getChild("TableHeader");
        add("table", base + node.from, base + node.to, header ? body.slice(header.from, header.to).trim() : "");
        return false;
      }
    },
  });
  for (const heading of headings) add("section", heading.startOffset, heading.endOffset, heading.text);

  let lineStart = 0;
  for (const line of parsedBody.split("\n")) {
    const trimmed = line.trim();
    const start = lineStart + line.indexOf(trimmed);
    const end = start + trimmed.length;
    if (!excluded.some((range) => start < range.end && end > range.start)) {
      const image = parseImageMarkdown(trimmed);
      if (image?.caption?.trim() && images.some((range) => range.start === start && range.end === end)) add("figure", base + start, base + end,
        image.caption.replace(/^\[(?:Image|Figure) [0-9]+\]\s*/, ""));
    }
    lineStart += line.length + 1;
  }

  if (context.appendixTitle !== undefined) {
    const firstHeading = headings[0];
    let firstBlock = tree.topNode.firstChild;
    while (firstBlock && excludedNames.has(firstBlock.name)) firstBlock = firstBlock.nextSibling;
    if (firstHeading) add("appendix", firstHeading.startOffset, firstHeading.endOffset, firstHeading.text);
    else if (firstBlock) add("appendix", base + firstBlock.from, base + firstBlock.to, context.appendixTitle);
  }
  return targets.sort((a, b) => a.anchor.start - b.anchor.start || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}
