import { createSourceAnchor, type SourceAnchor } from "../services/source-anchor.js";
import { documentLayoutBlocks, type DocumentLayoutBlock } from "../services/document-layout.js";
import type { SemanticRole } from "./semantic-roles.js";
import type { Editor } from "obsidian";
import { offsetAtCoords, type EditorViewInstance } from "./cm-annotation-highlighter.js";

export interface LayoutLineRange { start: number; end: number; startOffset: number; endOffset: number; }
export interface LayoutBlockInfo extends LayoutLineRange { kind: DocumentLayoutBlock["kind"]; role?: SemanticRole | null; anchor: SourceAnchor; }
export interface LayoutQuestionState { anchor: LayoutLineRange; }
export interface LayoutDirectiveContext { block: LayoutBlockInfo; question: LayoutQuestionState | null; pagination: boolean; }

function info(markdown: string, block: DocumentLayoutBlock): LayoutBlockInfo | null {
  const anchor = createSourceAnchor(markdown, block.startOffset, block.endOffset);
  return anchor ? { kind: block.kind, start: block.startLine, end: block.endLine, startOffset: block.startOffset, endOffset: block.endOffset, role: block.role || null, anchor } : null;
}
function lineAt(markdown: string, offset: number): LayoutLineRange {
  const before = markdown.slice(0, offset);
  const startOffset = before.lastIndexOf("\n") + 1;
  const endOffset = markdown.indexOf("\n", offset) === -1 ? markdown.length : markdown.indexOf("\n", offset);
  return { start: before.split("\n").length - 1, end: before.split("\n").length - 1, startOffset, endOffset };
}

/** The questions callout is one Markdown block, but each top-level numbered
 * item owns a separate persisted response override. */
function questionAtCursor(markdown: string, block: DocumentLayoutBlock, cursorLine: number): LayoutLineRange | null {
  if (block.role !== "questions") return null;
  const lines = markdown.split("\n");
  const mains: number[] = [];
  for (let line = block.startLine; line <= block.endLine; line++) {
    if (/^>\s*\d+[.)]\s+/u.test(lines[line])) mains.push(line);
  }
  const line = mains.find((start, index) => cursorLine >= start && cursorLine < (mains[index + 1] ?? block.endLine + 1));
  if (line === undefined) return null;
  let offset = 0;
  for (let index = 0; index < line; index++) offset += lines[index].length + 1;
  return lineAt(markdown, offset);
}

export function resolveLayoutDirectiveContext(markdown: string, cursorLine: number): LayoutDirectiveContext | null {
  const blocks = documentLayoutBlocks(markdown);
  const index = blocks.findIndex((block) => cursorLine >= block.startLine && cursorLine <= block.endLine);
  if (index < 0) return null;
  const cursorBlock = blocks[index];
  const current = info(markdown, cursorBlock);
  if (!current) return null;
  const questionAnchor = questionAtCursor(markdown, cursorBlock, cursorLine);
  const question = questionAnchor ? { anchor: questionAnchor } : null;
  return { block: current, question, pagination: true };
}

/** A right click need not move the native editor cursor. Reuse the captured
 * pointer position, with the selection start as the keyboard/API fallback. */
export function resolveLayoutDirectiveEditorContext(editor: Pick<Editor, "getValue" | "getCursor">, coords?: { x: number; y: number } | null): LayoutDirectiveContext | null {
  const content = editor.getValue();
  const cm = (editor as typeof editor & { cm?: EditorViewInstance }).cm;
  const offset = offsetAtCoords(cm, coords);
  const line = offset !== null && offset >= 0 && offset <= content.length
    ? content.slice(0, offset).split("\n").length - 1
    : editor.getCursor("from").line;
  return resolveLayoutDirectiveContext(content, line);
}
