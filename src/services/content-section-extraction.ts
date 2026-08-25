import { parser } from "@lezer/markdown";
import { stripFrontmatter } from "./frontmatter.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";

export type ExtractedSection = {
  markdown: string;
  heading: string | null;
  level: number | null;
};

type Line = { text: string; start: number; end: number };
type Heading = Line & { level: number; title: string };

function linesOf(markdown: string): Line[] {
  const lines: Line[] = [];
  const linePattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(markdown)) !== null) {
    if (match[0] === "") break;
    lines.push({ text: match[0].replace(/\r?\n$|\r$/u, ""), start: match.index, end: match.index + match[0].length });
  }
  return lines;
}

function calloutRoleOf(line: string): string | null {
  const match = line.match(/^(?: {0,3}>[ \t]?)+[ \t]*\[!([^\]\s]+)\](?:[+-])?(?:[ \t].*)?$/u);
  return match ? match[1].toLocaleLowerCase() : null;
}

function validateTriggerRoles(triggerRoles: readonly SemanticRole[]): void {
  for (const role of triggerRoles) {
    if (!SEMANTIC_ROLES.includes(role)) throw new Error(`Invalid semantic role: ${String(role)}`);
  }
}

export function extractSectionsByRoles(
  markdown: string,
  triggerRoles: readonly SemanticRole[],
): ExtractedSection[] {
  validateTriggerRoles(triggerRoles);
  if (triggerRoles.length === 0) return [];

  const body = stripFrontmatter(markdown);
  const lines = linesOf(body);
  const headings: Heading[] = [];
  const roleLines: number[] = [];
  const triggers = new Set(triggerRoles);

  const tree = parser.parse(body);
  const fencedRanges: { from: number; to: number }[] = [];
  const visit = (node: typeof tree.topNode, blockquoteDepth: number): void => {
    if (node.name === "FencedCode") {
      fencedRanges.push({ from: node.from, to: node.to });
      return;
    }
    if (node.name === "Blockquote") {
      let child = node.firstChild;
      while (child) {
        visit(child, blockquoteDepth + 1);
        child = child.nextSibling;
      }
      return;
    }
    const headingMatch = /^ATXHeading([1-6])$/u.exec(node.name);
    if (headingMatch && blockquoteDepth === 0) {
      const headerMarks: { from: number; to: number }[] = [];
      let child = node.firstChild;
      while (child) {
        if (child.name === "HeaderMark") headerMarks.push({ from: child.from, to: child.to });
        child = child.nextSibling;
      }
      if (headerMarks.length > 0) {
        const contentStart = headerMarks[0].to;
        const contentEnd = headerMarks.length > 1 ? headerMarks[headerMarks.length - 1].from : node.to;
        headings.push({
          text: body.slice(node.from, node.to),
          start: node.from,
          end: node.to,
          level: Number(headingMatch[1]),
          title: body.slice(contentStart, contentEnd).trim(),
        });
      }
    }
    let child = node.firstChild;
    while (child) {
      visit(child, blockquoteDepth);
      child = child.nextSibling;
    }
  };
  visit(tree.topNode, 0);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fencedRanges.some((range) => line.start >= range.from && line.start < range.to)) continue;
    const role = calloutRoleOf(line.text);
    if (role && SEMANTIC_ROLES.includes(role as SemanticRole) && triggers.has(role as SemanticRole)) roleLines.push(index);
  }

  if (roleLines.length === 0) return [];
  if (headings.length === 0) return [{ markdown: body, heading: null, level: null }];

  const sections = new Map<number, ExtractedSection>();
  for (const roleLine of roleLines) {
    let previousHeading: Heading | null = null;
    for (const heading of headings) {
      if (heading.start <= lines[roleLine].start) previousHeading = heading;
      else break;
    }

    const start = previousHeading ? previousHeading.start : 0;
    let end = body.length;
    if (previousHeading) {
      const next = headings.find((heading) => heading.start > previousHeading.start && heading.level <= previousHeading.level);
      if (next) end = next.start;
    } else {
      end = headings[0].start;
    }
    if (!sections.has(start)) {
      sections.set(start, {
        markdown: body.slice(start, end),
        heading: previousHeading?.title || null,
        level: previousHeading?.level || null,
      });
    }
  }

  return [...sections.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
}
