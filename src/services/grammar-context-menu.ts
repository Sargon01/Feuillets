import { Menu, TFile, type Editor } from "obsidian";
import type { ResolvedAnalysisIssue, TextAnalysisIssue, TextAnalysisProvider } from "../api/text-analysis.js";
import { t } from "../i18n/index.js";

export interface ContextMenuHost {
  getAnalysisProvider(providerId?: string): TextAnalysisProvider | null;
  analyzeActiveFile(): Promise<void>;
  activeEditorAnywhere(): Editor | null;
  app: import("obsidian").App;
  clearGrammarIssuesForFile?(filePath: string): void;
  requestGrammarCheckForFile?(filePath: string, refreshAll?: boolean): void;
}

export interface EditorCorrectionTarget {
  provider: TextAnalysisProvider;
  isCurrent(): boolean;
  replace(suggestion: string): boolean;
  focus(): void;
  invalidate(): void;
  refresh(): void;
}

export function openIssueContextMenu(
  host: ContextMenuHost,
  issue: TextAnalysisIssue | ResolvedAnalysisIssue,
  evt: MouseEvent,
  filePath?: string,
  correctionTarget?: EditorCorrectionTarget
): void {
  evt.preventDefault();
  evt.stopPropagation();

  const provider = correctionTarget?.provider ?? host.getAnalysisProvider();
  if (!provider) return;

  const canIgnore = typeof provider.ignoreOccurrence === "function";

  const rawText = issue.text || "";
  const wordToLearn = rawText.trim();
  const isSpelling = issue.canLearn === true || issue.category === "Orthographe";
  const isValidWord = wordToLearn.length > 0 && !/\s/.test(wordToLearn);
  const canLearn = typeof provider.learnWord === "function" && isSpelling && isValidWord;

  const menu = new Menu();

  menu.addItem((item) => item.setTitle(issue.message).setDisabled(true));

  // Suggestions (remplacements)
  if (issue.suggestions && issue.suggestions.length > 0) {
    for (const sug of issue.suggestions) {
      menu.addItem((item) => {
        item
          .setTitle(sug)
          .setIcon("check")
          .onClick(() => {
            void (async () => {
              if (correctionTarget) {
                if (!correctionTarget.isCurrent()) return;
                if (correctionTarget.replace(sug)) correctionTarget.focus();
                return;
              }
              const targetPath = filePath || issue.filePath;
              if (targetPath && host.app && host.app.vault) {
                const file = host.app.vault.getAbstractFileByPath(targetPath);
                if (file instanceof TFile) {
                  const leaf = host.app.workspace.getLeaf(false);
                  await leaf.openFile(file, { active: true });
                  host.app.workspace.setActiveLeaf(leaf, { focus: true });
                }
              }
              const editor = host.activeEditorAnywhere();
              if (editor) {
                const from = editor.offsetToPos(issue.start);
                const to = editor.offsetToPos(issue.end);
                editor.replaceRange(sug, from, to);
                if (typeof editor.setCursor === "function") {
                  const nextPos = editor.offsetToPos(issue.start + sug.length);
                  editor.setCursor(nextPos);
                }
                if (typeof editor.focus === "function") {
                  editor.focus();
                }
              }
              await host.analyzeActiveFile();
            })();
          });
      });
    }
  }

  // Ignorer cette occurrence
  if (canIgnore) {
    menu.addItem((item) => {
      item
        .setTitle(t("analysisResults.ignoreOccurrence"))
          .setIcon("eye-off")
          .onClick(() => {
            void (async () => {
              if (correctionTarget && !correctionTarget.isCurrent()) return;
              await provider.ignoreOccurrence!(issue);
              if (correctionTarget) {
                correctionTarget.invalidate();
                correctionTarget.focus();
                correctionTarget.refresh();
                return;
              }
              const editor = host.activeEditorAnywhere();
            if (editor) editor.focus();
            await host.analyzeActiveFile();
          })();
        });
    });
  }

  // Apprendre ce mot (orthographe seulement)
  if (canLearn) {
    menu.addItem((item) => {
      item
        .setTitle(t("analysisResults.learnWord", { word: wordToLearn }))
          .setIcon("book-plus")
          .onClick(() => {
            void (async () => {
              if (correctionTarget && !correctionTarget.isCurrent()) return;
              await provider.learnWord!(wordToLearn, issue);
              if (correctionTarget) {
                correctionTarget.invalidate();
                correctionTarget.focus();
                correctionTarget.refresh();
                return;
              }
              const editor = host.activeEditorAnywhere();
            if (editor) editor.focus();
            await host.analyzeActiveFile();
          })();
        });
    });
  }

  menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
}
