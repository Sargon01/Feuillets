import { EditorView } from "@codemirror/view";
import { isValidCitekey } from "../services/bibtex-catalog.js";
import { dispatchCitationPlan, prepareCitationInsertion, type CitationChange } from "../services/citation-insertion.js";

export type CitekeyTriggerType = "open_group" | "continue_group";

export type CitekeyTriggerRange = {
  from: number;
  to: number;
};

export interface CitationReferenceItem {
  key: string;
  pages?: string;
}

export type CitekeyEditorView = {
  state: {
    doc: {
      length: number;
      sliceString(from: number, to: number): string;
    };
    selection?: { main: { head: number; anchor?: number; empty: boolean } };
  };
  dispatch(spec: {
    changes: CitationChange | readonly CitationChange[];
    selection: {
      anchor: number;
    };
    annotations?: unknown;
  }): void;
  focus?(): void;
};

type ChangesLike = {
  iterChanges(
    fn: (
      fromA: number,
      toA: number,
      fromB: number,
      toB: number,
      inserted: { toString(): string },
    ) => void,
  ): void;
};

type TransactionLike = {
  docChanged: boolean;
  isUserEvent?(event: string): boolean;
  startState: {
    selection: {
      main: {
        empty: boolean;
        head: number;
      };
    };
  };
  state: {
    selection: {
      main: {
        empty: boolean;
        head: number;
      };
    };
    doc: {
      length: number;
      sliceString(from: number, to: number): string;
    };
  };
  changes: ChangesLike;
};

type ViewUpdateLike = {
  docChanged: boolean;
  transactions: readonly TransactionLike[];
  view: CitekeyEditorView;
};

type ViewStatic = {
  updateListener: {
    of(fn: (update: ViewUpdateLike) => void): unknown;
  };
};

const EditorViewTyped = EditorView as ViewStatic;

export function cleanCitationPages(rawPages?: string): string {
  if (!rawPages) return "";
  return rawPages.replace(/[\r\n\];]/g, "").trim();
}

export function formatCitationReferenceItem(item: CitationReferenceItem): string {
  const cleaned = cleanCitationPages(item.pages);
  if (!cleaned) {
    return `@${item.key}`;
  }

  const isRange = /[-–]/.test(cleaned);
  const stripped = cleaned.replace(/^pp?\.?\s*/i, "").trim();
  const normalizedRange = stripped.replace(/\s*[-–]\s*/g, "–");

  if (isRange) {
    return `@${item.key}, pp. ${normalizedRange}`;
  }
  return `@${item.key}, p. ${stripped}`;
}

export function isInsideOpenCitationGroup(
  doc: { sliceString(from: number, to: number): string },
  pos: number,
): boolean {
  const searchStart = Math.max(0, pos - 1000);
  const textBefore = doc.sliceString(searchStart, pos);
  const lastNewline = textBefore.lastIndexOf("\n");
  const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
  const lineText = textBefore.slice(lineStart);

  const lastOpen = lineText.lastIndexOf("[@");
  if (lastOpen === -1) return false;
  const lastClose = lineText.lastIndexOf("]");
  if (lastClose > lastOpen) return false;
  return true;
}

export function createCitekeyTriggerExtension(
  onTrigger: (
    view: CitekeyEditorView,
    range: CitekeyTriggerRange,
    triggerType: CitekeyTriggerType,
  ) => void,
): unknown {
  return EditorViewTyped.updateListener.of((update: ViewUpdateLike) => {
    if (!update.docChanged) return;

    for (const tr of update.transactions) {
      if (!tr.docChanged) continue;

      // Only typed user input is allowed
      if (typeof tr.isUserEvent !== "function" || !tr.isUserEvent("input.type")) {
        continue;
      }

      // Selection before typing must be empty (rejects selection replacement)
      if (!tr.startState.selection.main.empty) {
        continue;
      }

      // Selection after typing must be empty
      if (!tr.state.selection.main.empty) {
        continue;
      }

      const cursor = tr.state.selection.main.head;
      if (cursor < 1) {
        continue;
      }

      // Inserted change must end at the cursor
      let changeEndsAtCursor = false;
      tr.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
        if (toB === cursor && inserted.toString().length > 0) {
          changeEndsAtCursor = true;
        }
      });
      if (!changeEndsAtCursor) {
        continue;
      }

      // Initial trigger with [@
      if (cursor >= 2 && tr.state.doc.sliceString(cursor - 2, cursor) === "[@") {
        onTrigger(update.view, { from: cursor - 2, to: cursor }, "open_group");
        break;
      }

      // Continuation trigger with @ following ; inside an open citation cluster
      if (
        cursor >= 3 &&
        tr.state.doc.sliceString(cursor - 3, cursor) === "; @" &&
        isInsideOpenCitationGroup(tr.state.doc, cursor - 1)
      ) {
        onTrigger(update.view, { from: cursor - 1, to: cursor }, "continue_group");
        break;
      }
    }
  });
}

export function insertCitation(
  view: CitekeyEditorView,
  range: CitekeyTriggerRange,
  items: readonly CitationReferenceItem[],
  triggerType: CitekeyTriggerType = "open_group",
  context: { mode: "footnote" | "parenthetical"; from: number; to: number; frontmatter: string } = {
    mode: "parenthetical", from: 0, to: view.state.doc.length, frontmatter: "",
  },
): boolean {
  if (items.length === 0) return false;
  for (const item of items) {
    if (!isValidCitekey(item.key)) return false;
  }

  const doc = view.state.doc;
  if (range.from < 0 || range.to > doc.length || range.from >= range.to) {
    return false;
  }

  if (triggerType === "open_group") {
    if (range.to - range.from !== 2 || doc.sliceString(range.from, range.to) !== "[@") {
      return false;
    }
  } else {
    if (range.to - range.from !== 1 || doc.sliceString(range.from, range.to) !== "@") {
      return false;
    }
  }

  const hasFollowingBracket =
    range.to < doc.length && doc.sliceString(range.to, range.to + 1) === "]";

  const formattedItems = items.map(formatCitationReferenceItem).join("; ");

  let replacement: string;

  if (triggerType === "open_group") {
    if (hasFollowingBracket) {
      replacement = `[${formattedItems}`;
    } else {
      replacement = `[${formattedItems}]`;
    }
  } else {
    if (hasFollowingBracket) {
      replacement = formattedItems;
    } else {
      replacement = `${formattedItems}]`;
    }
  }

  if (range.from < context.from || range.to > context.to) return false;
  if (hasFollowingBracket && range.to + 1 > context.to) return false;
  const shift = context.from - context.frontmatter.length;
  const content = context.frontmatter + doc.sliceString(context.from, context.to);
  // Consume an existing closing bracket together with the trigger.
  if (hasFollowingBracket) replacement += "]";
  const plan = prepareCitationInsertion(content, range.from - shift,
    range.to + (hasFollowingBracket ? 1 : 0) - shift, replacement, context.mode, triggerType === "continue_group");
  if (!plan) return false;
  // Continuations preserve the already-open group; only new groups can create notes.
  if (triggerType === "continue_group" && !isInsideOpenCitationGroup(doc, range.from)) return false;
  return dispatchCitationPlan(view, { ...plan,
    changes: plan.changes.map((change) => ({ ...change, from: change.from + shift, to: change.to + shift })),
    cursor: plan.cursor + shift,
  });
}

export function insertCitekey(
  view: CitekeyEditorView,
  range: CitekeyTriggerRange,
  citekey: string,
  pages?: string,
  triggerType: CitekeyTriggerType = "open_group",
): boolean {
  return insertCitation(view, range, [{ key: citekey, pages }], triggerType);
}
