import { TFile, type TFolder, type App } from "obsidian";
import { translate, type Locale } from "../i18n/index.js";
import { compileScopesEqual, type CompileScope } from "./compile-scope.js";
import { crossReferenceBoundaryScope, crossReferenceProjectSettings, loadCrossReferenceContext, type NumberedCrossReferenceTarget } from "./cross-reference-context.js";
import { formatCrossReference } from "./cross-reference-format.js";
import { addCrossReferenceLinkFromContents, type CrossReferenceContentReader } from "./cross-reference-store.js";
import type { CrossReferenceDisplayMode } from "./cross-reference-model.js";
import type { FeuilletsEditorSurface } from "../utils/scrivenings-editor-adapter.js";

export interface CrossReferenceModeOption { mode: CrossReferenceDisplayMode; text: string }
export interface CrossReferenceEditorDependencies {
  app: App;
  getSettings(): FeuilletsSettings;
  getLocale(): Locale;
  getWorkspaceFolder?(): TFolder | null;
  chooseTarget(targets: readonly NumberedCrossReferenceTarget[]): Promise<NumberedCrossReferenceTarget | null>;
  chooseMode(options: readonly CrossReferenceModeOption[]): Promise<CrossReferenceDisplayMode | null>;
  notify(message: string): void;
  changed(): void;
}

export class CrossReferenceEditorController {
  constructor(private readonly deps: CrossReferenceEditorDependencies) {}

  async insert(
    editor: FeuilletsEditorSurface, file: TFile, scope: CompileScope,
    readContent: CrossReferenceContentReader = (target) => this.deps.app.vault.read(target),
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const { app } = this.deps;
    const settings = crossReferenceProjectSettings(app, this.deps.getSettings(), file.path);
    const locale = this.deps.getLocale();
    const before = editor.getValue();
    const start = editor.posToOffset(editor.getCursor("from"));
    const end = editor.posToOffset(editor.getCursor("to"));
    const read: CrossReferenceContentReader = async (target) => target.path === file.path ? editor.getValue() : readContent(target);
    try {
      const rootScope = crossReferenceBoundaryScope(app, settings, file, this.deps.getWorkspaceFolder?.() ?? null);
      if (!rootScope) return;
      const root = await loadCrossReferenceContext(app, settings, rootScope, read);
      const selected = await this.deps.chooseTarget(root.targets);
      if (!selected) return;
      const context = compileScopesEqual(rootScope, scope) ? root : await loadCrossReferenceContext(app, settings, scope, read);
      const inScope = context.targets.find(({ detectedTarget }) => detectedTarget.sourceFile === selected.detectedTarget.sourceFile
        && detectedTarget.type === selected.detectedTarget.type && detectedTarget.anchor.start === selected.detectedTarget.anchor.start);
      const initial = inScope ?? selected;
      const modes: CrossReferenceDisplayMode[] = ["type-number", "number", "title"];
      const mode = await this.deps.chooseMode(modes.map((mode) => ({ mode, text: formatCrossReference(initial, mode, locale) })));
      if (!mode) return;
      const currentBoundary = crossReferenceBoundaryScope(app, this.deps.getSettings(), file, this.deps.getWorkspaceFolder?.() ?? null);
      if (!currentBoundary || !compileScopesEqual(rootScope, currentBoundary)
        || !isCurrent() || editor.getValue() !== before || editor.posToOffset(editor.getCursor("from")) !== start
        || editor.posToOffset(editor.getCursor("to")) !== end) {
        this.deps.notify(translate(locale, "xref.notice.changed")); return;
      }
      const text = formatCrossReference(initial, mode, locale);
      if (start === end) {
        if (!text) throw new Error("Empty cross-reference display text");
        editor.replaceRange(text, editor.offsetToPos(start));
      }
      const content = editor.getValue();
      const occurrenceEnd = start === end ? start + text.length : end;
      if (content.slice(start, occurrenceEnd) !== (start === end ? text : before.slice(start, end))) throw new Error("Cross-reference editor insertion was rejected");
      if (start === end) {
        editor.setCursor(editor.offsetToPos(occurrenceEnd));
        editor.focus();
      }
      const targetFile = app.vault.getAbstractFileByPath(selected.detectedTarget.sourceFile);
      if (!(targetFile instanceof TFile) || targetFile.extension !== "md") throw new Error("Cross-reference target file is unavailable");
      const targetContent = targetFile.path === file.path ? content : await read(targetFile);
      await addCrossReferenceLinkFromContents(app, settings, selected.detectedTarget, targetContent, file, content, start, occurrenceEnd, mode);
      this.deps.changed();
    } catch (error: unknown) {
      console.error("Feuillets cross-reference insertion", error);
      this.deps.notify(translate(locale, "xref.notice.failed"));
    }
  }
}
