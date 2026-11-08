import { parser } from "@lezer/markdown";

/** Remove private callout blocks before planning, measurement and rendering.
 * Newlines remain intact so source anchors still address the original file.
 * Parsing protects literal examples in fenced and indented code blocks.
 */
export function withoutSpeakerNotes(markdown: string): string {
  const ranges: Array<{ from: number; to: number }> = [];
  parser.parse(markdown).iterate({
    enter(node) {
      if (node.name !== "Blockquote") return;
      const firstLine = markdown.slice(node.from, node.to).split(/\r?\n/u)[0];
      if (!/^(?:[ \t]*>[ \t]?)+\[!speaker-notes\](?:[+-])?(?:[ \t].*)?$/iu.test(firstLine)) return;
      ranges.push({ from: node.from, to: node.to });
      return false;
    },
  });
  let result = markdown;
  for (const { from, to } of ranges.reverse()) {
    result = result.slice(0, from) + result.slice(from, to).replace(/[^\r\n]/gu, "") + result.slice(to);
  }
  return result;
}
