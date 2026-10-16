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
  const tree = markdownParser.parse(body);
  const targets: DetectedCrossReferenceTarget[] = [];
  const excluded: { start: number; end: number }[] = [];
  const headings: HeadingOutlineInput[] = [];
  const add = (type: CrossReferenceTargetType, start: number, end: number, titleOrCaption: string): void => {
    const anchor = createSourceAnchor(content, start, end);
    if (anchor) targets.push({ type, sourceFile, anchor, titleOrCaption, sourceOrder: { fileOrder: context.fileOrder ?? 0, offset: start } });
  };
  tree.iterate({
    enter(node) {
      if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock", "Comment", "CommentBlock"].includes(node.name)) {
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
        headings.push({ text: body.slice(start, end).trim(), level: Number(heading[2]), startOffset: base + node.from, endOffset: base + node.to });
      }
      if (node.name === "Table") {
        const header = node.node.getChild("TableHeader");
        add("table", base + node.from, base + node.to, header ? body.slice(header.from, header.to).trim() : "");
        return false;
      }
    },
  });
  for (const heading of headings) add("section", heading.startOffset, heading.endOffset, heading.text);

  let lineStart = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    const start = lineStart + line.indexOf(trimmed);
    const end = start + trimmed.length;
    if (!excluded.some((range) => start < range.end && end > range.start)) {
      const image = parseImageMarkdown(trimmed);
      if (image?.caption?.trim()) add("figure", base + start, base + end,
        image.caption.replace(/^\[(?:Image|Figure) [0-9]+\]\s*/, ""));
    }
    lineStart += line.length + 1;
  }

  if (context.appendixTitle !== undefined) {
    const firstHeading = headings[0];
    const firstBlock = tree.topNode.firstChild;
    if (firstHeading) add("appendix", firstHeading.startOffset, firstHeading.endOffset, firstHeading.text);
    else if (firstBlock) add("appendix", base + firstBlock.from, base + firstBlock.to, context.appendixTitle);
  }
  return targets.sort((a, b) => a.anchor.start - b.anchor.start || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}
