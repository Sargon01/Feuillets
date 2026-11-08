import { parser } from "@lezer/markdown";

/** Restore authored markers which HTML only retains on the first list item.
 * Run before variant filtering, while source and rendered lists still correspond.
 */
export function applyDocxListNumbers(root: HTMLElement, markdown: string): void {
  // Obsidian parses a callout's body independently of its title. Give Lezer
  // the same paragraph boundary, including callouts inside blockquotes.
  const source = markdown.replace(/^(?: {0,3}>[ \t]?)+[ \t]*\[![^\]\n]+\][^\n]*/gmu, "");
  const lists: number[][] = [];
  parser.parse(source).iterate({
    enter(node) {
      if (node.name !== "OrderedList") return;
      const values: number[] = [];
      for (let item = node.node.firstChild; item; item = item.nextSibling) {
        if (item.name !== "ListItem") continue;
        const marker = item.firstChild;
        const match = marker && /^(\d+)[.)]/u.exec(source.slice(marker.from, marker.to));
        if (match) values.push(Number(match[1]));
      }
      lists.push(values);
    },
  });
  if (lists.length === 0) return;
  const elements = Array.from(root.querySelectorAll("ol")).filter((list) => list.tagName === "OL" && !list.closest(".footnotes"));
  // Embedded notes and third-party renderers may add lists. Never apply a
  // source number to an unrelated item when that correspondence is lost.
  if (elements.length !== lists.length) return;
  elements.forEach((list, index) => {
    const items = Array.from(list.children).filter((child) => child.tagName === "LI");
    if (items.length !== lists[index].length) return;
    items.forEach((item, itemIndex) => item.setAttribute("value", String(lists[index][itemIndex])));
  });
}
