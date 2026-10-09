/** Search and replace entry points using the shared text matching rules. */
import { ChangeSet, Text } from "@codemirror/state";
import { buildSearchRegExp, findSearchMatches, planTextReplacements, replaceInText, type SearchReplaceOptions } from "./manuscript-search-replace.js";
import type { Editor, TFile } from "obsidian";

export type SearchEditor = Pick<Editor, "getValue" | "listSelections" | "posToOffset" | "offsetToPos" | "transaction">;
export type SearchOptions = {
  scope?: string;
  ignoreCase?: boolean;
  ignoreDiacritics?: boolean;
  matchMode?: string;
  useRegex?: boolean;
  includeYaml?: boolean;
  preserveCase?: boolean;
  protectMarkdown?: boolean;
  replacementQuery?: string;
  activeFile?: TFile | null;
  activeEditor?: SearchEditor | null;
};
type SearchApp = {
  workspace?: { getActiveFile(): TFile | null };
  vault: {
    read(file: TFile): Promise<string>;
    process(file: TFile, callback: (content: string) => string): Promise<unknown>;
  };
};
type SearchPlugin = { getManuscriptFiles?: () => TFile[] };
export type SearchOccurrence = {
  file: TFile;
  index: number;
  length: number;
  line: number;
  ch: number;
  matchText: string;
  contextSnippet: string;
  kind: "body" | "footnote";
};

function textOptions(options: SearchOptions): SearchReplaceOptions {
  return { ...options, caseSensitive: options.ignoreCase === false };
}

export class FeuilletsSearchEngine {
  static buildRegex(query: string, options: SearchOptions = {}): RegExp | null {
    return buildSearchRegExp(query, textOptions(options));
  }

  static getScopedFiles(app: SearchApp, plugin: SearchPlugin, scopeOption = "document", activeFile: TFile | null = null): TFile[] {
    const currentFile = activeFile || (app.workspace ? app.workspace.getActiveFile() : null);

    if (scopeOption === "document") {
      return currentFile ? [currentFile] : [];
    }

    // The manuscript scope searches Markdown siblings of the active file.
    if (currentFile && currentFile.parent && currentFile.parent.children) {
      return currentFile.parent.children.filter((file): file is TFile => file && "extension" in file && file.extension === "md");
    }

    return plugin.getManuscriptFiles ? plugin.getManuscriptFiles() : [];
  }

  static searchInText(content: string, file: TFile, query: string, options: SearchOptions = {}): SearchOccurrence[] {
    const doc = Text.of(content.split("\n"));
    return findSearchMatches(content, query, textOptions(options)).map(({ index, match }) => {
      const line = doc.lineAt(index);
      return {
        file, index, length: match[0].length, line: line.number - 1, ch: index - line.from,
        matchText: match[0],
        contextSnippet: content.slice(Math.max(0, index - 30), index + match[0].length + 30).replace(/\n/g, " "),
        kind: /^[ \t]{0,3}\[\^[^\]]+\]:/.test(line.text) ? "footnote" : "body",
      };
    });
  }

  static async searchInVault(app: SearchApp, plugin: SearchPlugin, query: string, options: SearchOptions = {}) {
    if (!this.buildRegex(query, options)) return { occurrences: [], totalCount: 0, filesCount: 0 };
    const files = this.getScopedFiles(app, plugin, options.scope, options.activeFile);
    const occurrences: SearchOccurrence[] = [];
    let filesCount = 0;
    for (const file of files) {
      if (!file?.path.endsWith(".md")) continue;
      let content: string;
      try {
        content = options.activeEditor && file.path === options.activeFile?.path
          ? options.activeEditor.getValue() : await app.vault.read(file);
      } catch {
        continue;
      }
      if (typeof content !== "string") continue;
      const matches = this.searchInText(content, file, query, options);
      if (matches.length) filesCount++;
      occurrences.push(...matches);
    }
    return { occurrences, totalCount: occurrences.length, filesCount };
  }

  /** Use the current buffer and original coordinates for one undoable editor transaction. */
  static replaceInEditor(editor: SearchEditor, query: string, replacement: string, options: SearchOptions = {}) {
    const content = editor.getValue();
    const changes = planTextReplacements(content, query, replacement ?? "", textOptions(options));
    if (!changes.length) return { totalReplacements: 0, filesCount: 0 };
    const changeSet = ChangeSet.of(changes.map(({ from, to, text }) => ({ from, to, insert: text })), content.length);
    const updated = changeSet.apply(Text.of(content.split("\n")));
    const position = (offset: number) => {
      const line = updated.lineAt(offset);
      return { line: line.number - 1, ch: offset - line.from };
    };
    const selections = editor.listSelections().map(({ anchor, head }) => {
      const from = editor.posToOffset(anchor);
      const to = editor.posToOffset(head);
      // Preserve direction and keep the original text selected when its length changes.
      const anchorAssoc = from === to ? 1 : from < to ? -1 : 1;
      const headAssoc = from === to ? 1 : from < to ? 1 : -1;
      return { from: position(changeSet.mapPos(from, anchorAssoc)), to: position(changeSet.mapPos(to, headAssoc)) };
    });
    editor.transaction({
      changes: changes.map(({ from, to, text }) => ({ from: editor.offsetToPos(from), to: editor.offsetToPos(to), text })),
      selections,
    }, "feuillets-replace-all");
    if (editor.getValue() !== updated.toString()) throw new Error("Editor rejected the replacement transaction");
    return { totalReplacements: changes.length, filesCount: 1 };
  }

  /** Retain the existing explicit vault scope entry point for other callers. */
  static async replaceInVault(app: SearchApp, plugin: SearchPlugin, query: string, replacement: string | null | undefined, options: SearchOptions = {}) {
    if (!this.buildRegex(query, options)) return { totalReplacements: 0, filesCount: 0 };
    const files = this.getScopedFiles(app, plugin, options.scope, options.activeFile);
    let totalReplacements = 0;
    let filesCount = 0;
    for (const file of files) {
      if (!file?.path.endsWith(".md")) continue;
      let count = 0;
      await app.vault.process(file, (content) => {
        const result = replaceInText(content, query, replacement ?? "", textOptions(options));
        count = result.count;
        return result.newContent;
      });
      totalReplacements += count;
      if (count) filesCount++;
    }
    return { totalReplacements, filesCount };
  }
}
