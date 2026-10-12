import type { Editor } from "obsidian";
import { isolateHistory } from "@codemirror/commands";
import { nextFootnoteNumber, parseFootnotes } from "../utils/footnotes.js";
import { splitFrontmatter } from "./frontmatter.js";
import { offsetToLineCol } from "../utils/scrivenings-editor-adapter.js";

export interface CitationChange { from: number; to: number; insert: string; }
export interface CitationInsertionPlan {
  changes: CitationChange[];
  cursor: number;
  contentStart: number;
  noteNumber?: number;
}
export interface CitationTransactionView {
  readonly state: {
    readonly doc: { readonly length: number; sliceString(from: number, to: number): string };
  };
  dispatch(spec: {
    changes: CitationChange | readonly CitationChange[];
    selection: { anchor: number };
    annotations?: unknown;
  }): void;
  focus?(): void;
}
export type CitationInsertionEditor = Pick<Editor, "getValue" | "getCursor" | "posToOffset" | "focus"> & {
  transaction?: Editor["transaction"];
  applyCitationPlan?(plan: CitationInsertionPlan, expectedContent: string): boolean;
};

/** Prepare all edits in original file coordinates before touching an editor. */
export function prepareCitationInsertion(
  content: string, from: number, to: number, citation: string,
  mode: "footnote" | "parenthetical", continueGroup = false,
): CitationInsertionPlan | null {
  const bodyStart = splitFrontmatter(content).frontmatter.length;
  if (!citation || !Number.isInteger(from) || !Number.isInteger(to)
    || from < bodyStart || from > to || to > content.length) return null;
  const definitions = parseFootnotes(content).definitions;
  const note = definitions.find((definition) => from >= definition.start && from <= definition.end);
  if (note) {
    const bodyFrom = content.indexOf("]:", note.start) + 2;
    if (from < bodyFrom || to > note.end
      || definitions.filter((definition) => definition.id === note.id).length !== 1) return null;
  } else if (definitions.some((definition) => to > definition.start && from < definition.end)) return null;
  // An indented position outside a recognized definition is ambiguous (code or a broken note).
  const lineStart = content.lastIndexOf("\n", from - 1) + 1;
  if (!note && /^(?: {4}|\t)/.test(content.slice(lineStart, from))) return null;
  if (mode === "parenthetical" || note || continueGroup) {
    return { changes: [{ from, to, insert: citation }], cursor: from + citation.length, contentStart: from };
  }
  const noteNumber = nextFootnoteNumber(content);
  const marker = `[^${noteNumber}]`;
  const prefix = `\n\n[^${noteNumber}]: `;
  const delta = marker.length - (to - from);
  // Coalesce an insertion at EOF so change ranges never overlap.
  const changes = to === content.length
    ? [{ from, to, insert: marker + prefix + citation }]
    : [{ from, to, insert: marker }, { from: content.length, to: content.length, insert: prefix + citation }];
  return { changes, cursor: from + marker.length,
    contentStart: content.length + delta + prefix.length, noteNumber };
}

export function citationPlanContent(content: string, plan: CitationInsertionPlan): string {
  for (const change of [...plan.changes].reverse()) {
    content = content.slice(0, change.from) + change.insert + content.slice(change.to);
  }
  return content;
}

/** One native transaction; filters may reject it, but cannot leave a partial note. */
export function dispatchCitationPlan(view: CitationTransactionView, plan: CitationInsertionPlan): boolean {
  const before = view.state.doc.sliceString(0, view.state.doc.length);
  let previousEnd = 0;
  for (const change of plan.changes) {
    if (!Number.isInteger(change.from) || !Number.isInteger(change.to)
      || change.from < previousEnd || change.from > change.to || change.to > before.length) return false;
    previousEnd = change.to;
  }
  const result = citationPlanContent(before, plan);
  if (!Number.isInteger(plan.cursor) || plan.cursor < 0 || plan.cursor > result.length) return false;
  view.dispatch({ changes: plan.changes.length === 1 ? plan.changes[0] : plan.changes,
    selection: { anchor: plan.cursor }, annotations: isolateHistory.of("full") });
  const applied = view.state.doc.sliceString(0, view.state.doc.length) === result;
  if (applied) view.focus?.();
  return applied;
}

export function applyCitationInsertion(
  editor: CitationInsertionEditor, content: string, plan: CitationInsertionPlan,
): boolean {
  if (editor.getValue() !== content) return false;
  if (editor.applyCitationPlan) return editor.applyCitationPlan(plan, content);
  const cm = (editor as CitationInsertionEditor & { cm?: CitationTransactionView }).cm;
  if (cm) return dispatchCitationPlan(cm, plan);
  if (!editor.transaction) return false;
  const result = citationPlanContent(content, plan);
  editor.transaction({ changes: plan.changes.map((change) => ({
    from: offsetToLineCol(content, change.from), to: offsetToLineCol(content, change.to), text: change.insert,
  })), selection: { from: offsetToLineCol(result, plan.cursor) } }, "feuillets-citation");
  const applied = editor.getValue() === result;
  if (applied) editor.focus();
  return applied;
}
