import { parser } from "@lezer/markdown";
import { stripFrontmatter } from "./frontmatter.js";
import { SEMANTIC_ROLES, type SemanticRole } from "../utils/semantic-roles.js";

export type ExtractedSection = {
  markdown: string;
  heading: string | null;
  level: number | null;
};

export type SemanticCollectionItem = {
  role: SemanticRole;
  markdown: string;
  headingPath: { level: number; markdown: string }[];
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

function semanticRoleOfLine(line: string): SemanticRole | null {
  const role = calloutRoleOf(line);
  return role && SEMANTIC_ROLES.includes(role as SemanticRole) ? role as SemanticRole : null;
}

function semanticRoleOfBlockquote(markdown: string): SemanticRole | null {
  const lines = linesOf(markdown);
  return lines.length > 0 ? semanticRoleOfLine(lines[0].text) : null;
}

function stripInheritedBlockquoteDepth(markdown: string, inheritedDepth: number): string {
  if (inheritedDepth === 0) return markdown;
  const parts = markdown.split(/(\r\n|\n|\r)/u);
  for (let index = 2; index < parts.length; index += 2) {
    for (let depth = 0; depth < inheritedDepth; depth++) {
      parts[index] = parts[index].replace(/^ {0,3}>[ \t]?/u, "");
    }
  }
  return parts.join("");
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
    const role = semanticRoleOfLine(line.text);
    if (role && triggers.has(role)) roleLines.push(index);
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

export function collectSemanticRoleBlocks(
  markdown: string,
  roles: readonly SemanticRole[],
): SemanticCollectionItem[] {
  validateTriggerRoles(roles);
  if (roles.length === 0) return [];

  const body = stripFrontmatter(markdown);
  const tree = parser.parse(body);
  const requestedRoles = new Set(roles);
  const headings: Heading[] = [];
  const blockquotes: { from: number; to: number; role: SemanticRole; inheritedDepth: number }[] = [];

  const visit = (node: typeof tree.topNode, blockquoteDepth: number): void => {
    if (node.name === "FencedCode") return;
    if (node.name === "Blockquote") {
      const blockquoteMarkdown = body.slice(node.from, node.to);
      const role = semanticRoleOfBlockquote(blockquoteMarkdown);
      if (role && requestedRoles.has(role)) {
        blockquotes.push({ from: node.from, to: node.to, role, inheritedDepth: blockquoteDepth });
      }
      let child = node.firstChild;
      while (child) {
        visit(child, blockquoteDepth + 1);
        child = child.nextSibling;
      }
      return;
    }
    const headingMatch = /^ATXHeading([1-6])$/u.exec(node.name);
    if (headingMatch && blockquoteDepth === 0) {
      headings.push({
        text: body.slice(node.from, node.to),
        start: node.from,
        end: node.to,
        level: Number(headingMatch[1]),
        title: body.slice(node.from, node.to),
      });
    }
    let child = node.firstChild;
    while (child) {
      visit(child, blockquoteDepth);
      child = child.nextSibling;
    }
  };
  visit(tree.topNode, 0);

  const selected = blockquotes
    .filter((blockquote) => !blockquotes.some((ancestor) =>
      ancestor !== blockquote && ancestor.from < blockquote.from && ancestor.to >= blockquote.to))
    .sort((a, b) => a.from - b.from);

  return selected.map((blockquote) => {
    const headingPath: { level: number; markdown: string }[] = [];
    for (const heading of headings) {
      if (heading.start >= blockquote.from) break;
      while (headingPath.length > 0 && headingPath[headingPath.length - 1].level >= heading.level) {
        headingPath.pop();
      }
      headingPath.push({ level: heading.level, markdown: heading.text });
    }
    const collectedMarkdown = stripInheritedBlockquoteDepth(
      body.slice(blockquote.from, blockquote.to),
      blockquote.inheritedDepth,
    );
    return {
      role: blockquote.role,
      markdown: collectedMarkdown,
      headingPath,
    };
  });
}
