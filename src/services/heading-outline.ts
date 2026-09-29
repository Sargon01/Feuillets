export interface HeadingOutlineInput {
  text: string;
  level: number;
  startOffset: number;
  endOffset: number;
}

export interface HeadingOutlineNode {
  text: string;
  level: number;
  startOffset: number;
  endOffset: number;
  children: HeadingOutlineNode[];
}

function isValidLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= 6;
}

/**
 * Builds a heading tree from an ordered, linear list of Markdown headings.
 * A heading becomes a child of the nearest preceding heading with a strictly
 * lower level; headings with no such predecessor become root nodes.
 */
export function buildHeadingOutline(headings: HeadingOutlineInput[]): HeadingOutlineNode[] {
  const roots: HeadingOutlineNode[] = [];
  const stack: HeadingOutlineNode[] = [];

  for (const heading of headings) {
    if (!isValidLevel(heading.level)) continue;

    const node: HeadingOutlineNode = {
      text: heading.text,
      level: heading.level,
      startOffset: heading.startOffset,
      endOffset: heading.endOffset,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }

    stack.push(node);
  }

  return roots;
}
