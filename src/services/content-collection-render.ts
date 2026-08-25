import type { ContentCollection } from "./content-collections.js";
import { collectSemanticRoleBlocks } from "./content-section-extraction.js";

type Heading = { level: number; markdown: string };

function lineEndingOf(markdown: string): string {
  return markdown.includes("\r\n") ? "\r\n" : "\n";
}

function commonHeadingCount(previous: Heading[], current: Heading[]): number {
  let count = 0;
  while (
    count < previous.length
    && count < current.length
    && previous[count].level === current[count].level
    && previous[count].markdown === current[count].markdown
  ) {
    count++;
  }
  return count;
}

function headingMarkdownForOutput(markdown: string, lineEnding: string): string {
  return lineEnding === "\r\n" && markdown.endsWith("\r") ? markdown.slice(0, -1) : markdown;
}

function layoutMarkerImmediatelyBefore(markdown: string, start: number, end: number): string[] {
  const lines = markdown.slice(start, end).split(/\r?\n/u);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const lastLine = lines[lines.length - 1];
  return lastLine === "FEUILLETS_LAYOUT_PAGE_BREAK_BEFORE" ? [lastLine] : [];
}

function joinMarkdownParts(parts: string[], lineEnding: string): string {
  return parts.reduce((result, part, index) => {
    if (index === 0) return part;
    const separator = lineEnding === "\r\n" && result.endsWith("\r")
      ? `\n${lineEnding}`
      : `${lineEnding}${lineEnding}`;
    return `${result}${separator}${part}`;
  }, "");
}

export function renderContentCollectionMarkdown(markdown: string, collection: ContentCollection): string | null {
  const items = collectSemanticRoleBlocks(markdown, collection.roles);
  if (items.length === 0) return null;

  const lineEnding = lineEndingOf(markdown);
  const rendered: string[] = [];
  let previousHeadingPath: Heading[] = [];
  let searchStart = 0;

  for (const item of items) {
    const commonCount = commonHeadingCount(previousHeadingPath, item.headingPath);
    const headingStart = item.headingPath.length < previousHeadingPath.length
      && commonCount === item.headingPath.length
      && item.headingPath.length > 0
      ? commonCount - 1
      : commonCount;
    const headings = item.headingPath.slice(headingStart).map((heading) => headingMarkdownForOutput(heading.markdown, lineEnding));
    const itemStart = markdown.indexOf(item.markdown, searchStart);
    const markers = itemStart >= 0 ? layoutMarkerImmediatelyBefore(markdown, searchStart, itemStart) : [];
    const prefix = [...headings, ...markers];
    rendered.push(joinMarkdownParts([...prefix, item.markdown], lineEnding));
    if (itemStart >= 0) searchStart = itemStart + item.markdown.length;
    previousHeadingPath = item.headingPath;
  }

  return joinMarkdownParts(rendered, lineEnding);
}
