import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const realModule = (name) => new URL(`${import.meta.url.includes("/.test-dist/") ? "../../" : "../"}node_modules/@codemirror/${name}/dist/index.js`, import.meta.url).href;
// Resolve the state instance used by commands, including nested installed versions.
const commandsRequire = createRequire(realModule("commands"));
const stateUrl = new URL("./index.js", pathToFileURL(commandsRequire.resolve("@codemirror/state")));
const { EditorSelection, EditorState, Transaction } = await import(stateUrl.href);
const { history, undo, redo } = await import(realModule("commands"));

/** Exercise the public Editor contract against real CodeMirror text and history. */
export function createSearchEditor(content, ranges = [{ anchor: 0, head: 0 }]) {
  const editor = {
    state: EditorState.create({
      doc: content,
      selection: EditorSelection.create(ranges.map(({ anchor, head }) => EditorSelection.range(anchor, head))),
      // The history view plugin handles DOM events; these state tests need only its field and configuration.
      extensions: [history().slice(0, 2), EditorState.allowMultipleSelections.of(true)],
    }),
    transactions: [],
    getValue() { return editor.state.doc.toString(); },
    posToOffset({ line, ch }) { return editor.state.doc.line(line + 1).from + ch; },
    offsetToPos(offset) { const line = editor.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; },
    listSelections() { return editor.state.selection.ranges.map(({ anchor, head }) => ({ anchor: editor.offsetToPos(anchor), head: editor.offsetToPos(head) })); },
    transaction(tx, origin) {
      const changes = tx.changes.map(({ from, to, text }) => ({ from: editor.posToOffset(from), to: editor.posToOffset(to), insert: text }));
      const updated = editor.state.update({ changes }).newDoc;
      const offset = ({ line, ch }) => updated.line(line + 1).from + ch;
      editor.dispatch(editor.state.update({
        changes,
        selection: EditorSelection.create(tx.selections.map(({ from, to }) => EditorSelection.range(offset(from), offset(to)))),
        annotations: Transaction.userEvent.of(origin),
      }));
      editor.transactions.push(tx);
    },
    dispatch(transaction) { editor.state = transaction.state; },
    undo() { return undo(editor); },
    redo() { return redo(editor); },
    setSelection(from, to) { editor.selection = [from, to]; editor.dispatch(editor.state.update({ selection: EditorSelection.range(editor.posToOffset(from), editor.posToOffset(to)) })); },
    scrollIntoView(...args) { editor.scrolled = args; },
    edit(from, to, insert) { editor.dispatch(editor.state.update({ changes: { from, to, insert }, annotations: Transaction.userEvent.of("input.type") })); },
  };
  return editor;
}
