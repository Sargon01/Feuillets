import { MarkdownView, TFile, TFolder, type App, type TAbstractFile } from "obsidian";
import { VIEW_SCRIVENINGS } from "../constants.js";
import { projectCreationNames } from "../i18n/project-creation.js";
import { resolveCompileScopeFiles, type CompileScope } from "./compile-scope.js";
import { resolveOutputBaseName } from "./compile-export.js";
import { feuilletsAuxiliaryPath, getOrderedChildren } from "./folder-structure.js";
import { ensureFolder } from "./project-files.js";
import { getBackupsRoot } from "./project-backup.js";
import { FeuilletsSearchEngine, type SearchEditor, type SearchOccurrence, type SearchOptions } from "./feuillets-search-engine.js";
import { applyTextReplacements, planTextReplacements, type TextReplacement } from "./manuscript-search-replace.js";

export interface GlobalReplaceHost {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  getLinkedResearchFolders?(): { folder: TFolder }[];
}

export class GlobalReplaceError extends Error {
  constructor(public readonly reason: string, public readonly paths: readonly string[] = [], public readonly backupPath = "") {
    super(`Global replacement ${reason}: ${paths.join(", ")}`);
  }
}

export type PlannedReplacement = TextReplacement & { path: string; expected: string };
export interface PlannedDocument {
  file: TFile;
  path: string;
  original: string;
  disk: string;
  editor: SearchEditor | null;
  changes: PlannedReplacement[];
  result: string;
}
export interface GlobalReplacePlan {
  project: TFolder;
  projectPath: string;
  contextVersion: number;
  scope: CompileScope;
  documents: PlannedDocument[];
  occurrences: SearchOccurrence[];
  found: number;
  eligible: number;
  skipped: number;
  protectedCount: number;
  unchangedCount: number;
  filesCount: number;
}

type SavedDocument = Pick<PlannedDocument, "path" | "original" | "disk" | "result" | "changes">;
type RecoveryRecord = {
  version: 1;
  id: string;
  projectPath: string;
  created: number;
  state: "prepared" | "complete" | "restored" | "conflicts";
  documents: SavedDocument[];
};

/** Check vault identity and every parent edge, rather than trusting a path prefix. */
function belongsTo(app: App, node: TAbstractFile, root: TFolder): boolean {
  const visited = new Set<TAbstractFile>();
  let current: TAbstractFile | null = node;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (app.vault.getAbstractFileByPath(current.path) !== current) return false;
    if (current === root) return true;
    const parent: TFolder | null = current.parent;
    if (!parent || !parent.children.includes(current)) return false;
    current = parent;
  }
  return false;
}

/** Harden the existing compile resolver for writing, without changing its read API. */
export function resolveSearchReplaceFiles(app: App, host: GlobalReplaceHost, scope: CompileScope): TFile[] {
  const project = host.getProjectFolder();
  const root = app.vault.getAbstractFileByPath(scope.projectRoot);
  if (!project || !(root instanceof TFolder) || !belongsTo(app, root, project)) throw new GlobalReplaceError("scope");
  const technicalNames = new Set<string>();
  const compiledNames = new Set<string>();
  const excludeOutput = (name: unknown) => {
    if (typeof name === "string" && name.trim()) compiledNames.add(`${resolveOutputBaseName(null, name)}.md`.toLocaleLowerCase());
  };
  for (const locale of ["en", "fr"] as const) {
    for (const name of Object.values(projectCreationNames(locale).auxiliary)) technicalNames.add(name.toLocaleLowerCase());
    const names = projectCreationNames(locale);
    technicalNames.add(names.research.toLocaleLowerCase());
    technicalNames.add(names.resources.toLocaleLowerCase());
    excludeOutput(names.manuscript);
  }
  excludeOutput(host.settings.compileFileName);
  for (const preset of host.settings.compilePresets ?? []) {
    if (preset && typeof preset === "object" && "fileName" in preset) excludeOutput(preset.fileName);
  }
  const meta = host.settings.projectMeta?.[project.path];
  excludeOutput(meta?.projectComposition?.fileName);
  for (const workspace of Object.values(meta?.folderWorkspaces ?? {})) excludeOutput(workspace.ouvrage?.composition?.fileName);
  const linked = new Set(host.getLinkedResearchFolders?.().map(({ folder }) => folder) ?? []);
  const allowedNodes = new Set<TAbstractFile>();
  const visit = (folder: TFolder) => {
    if (allowedNodes.has(folder) || linked.has(folder) || folder.name.startsWith("_") || folder.name.startsWith(".") || technicalNames.has(folder.name.toLocaleLowerCase())) return;
    allowedNodes.add(folder);
    for (const child of getOrderedChildren(app, host.settings, folder)) {
      if (child.parent !== folder || !belongsTo(app, child, project)) continue;
      if (child instanceof TFolder) visit(child);
      else if (!child.name.startsWith(".") && !child.name.startsWith("_") && !compiledNames.has(child.name.toLocaleLowerCase())) allowedNodes.add(child);
    }
  };
  visit(project);
  if (!allowedNodes.has(root)) throw new GlobalReplaceError("scope", [root.path]);
  const paths = scope.type === "selection" ? scope.paths : scope.type === "project" ? [] : [scope.path];
  for (const path of paths) {
    const node = app.vault.getAbstractFileByPath(path);
    if (!node || !allowedNodes.has(node) || !belongsTo(app, node, root)) throw new GlobalReplaceError("scope", [path]);
  }
  return resolveCompileScopeFiles(app, host.settings, scope).filter((file) => allowedNodes.has(file) && belongsTo(app, file, root));
}

function hasMembers(view: object): view is { getMemberPaths(): readonly string[] } {
  return "getMemberPaths" in view && typeof view.getMemberPaths === "function";
}

/** One small durable operation record; this is not a second version catalogue. */
export class GlobalSearchReplace {
  busy = false;
  private contextVersion = 0;
  constructor(private readonly app: App, private readonly host: GlobalReplaceHost) {}

  invalidateContext(): void { this.contextVersion++; }

  private editorFor(file: TFile): SearchEditor | null {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_SCRIVENINGS)) {
      if (!hasMembers(leaf.view) || "editorView" in leaf.view && leaf.view.editorView === null) throw new GlobalReplaceError("continuLoading", [file.path]);
      if (leaf.view.getMemberPaths().includes(file.path)) throw new GlobalReplaceError("continu", [file.path]);
    }
    const editors = new Set<SearchEditor>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file === file && view.getMode() === "source") editors.add(view.editor);
    }
    if (editors.size > 1) throw new GlobalReplaceError("views", [file.path]);
    for (const editor of editors) return editor;
    return null;
  }

  private async read(file: TFile): Promise<string> {
    try { return await this.app.vault.read(file); }
    catch { throw new GlobalReplaceError("read", [file.path]); }
  }

  private async saveEditor(file: TFile, editor: SearchEditor, expected: string, checkContext?: () => void): Promise<void> {
    const views = this.app.workspace.getLeavesOfType("markdown").map(({ view }) => view).filter((view): view is MarkdownView => view instanceof MarkdownView && view.file === file && view.getMode() === "source" && view.editor === editor);
    if (!views.length) throw new GlobalReplaceError("changed", [file.path]);
    for (const view of views) {
      checkContext?.();
      if (this.app.vault.getAbstractFileByPath(file.path) !== file || this.editorFor(file) !== editor || view.file !== file || view.editor !== editor || editor.getValue() !== expected) throw new GlobalReplaceError("changed", [file.path]);
      // Use the public TextFileView save path so native autosave owns the buffer.
      await view.save();
      if (view.file !== file || this.editorFor(file) !== editor || editor.getValue() !== expected) throw new GlobalReplaceError("changed", [file.path]);
    }
  }

  async preview(scope: CompileScope, query: string, replacement: string, options: SearchOptions): Promise<GlobalReplacePlan> {
    const project = this.host.getProjectFolder();
    const contextVersion = this.contextVersion;
    const searchOptions = { ...options };
    if (!project) throw new GlobalReplaceError("scope");
    const scopeCopy: CompileScope = scope.type === "selection" ? { ...scope, paths: [...scope.paths] } : { ...scope };
    const files = resolveSearchReplaceFiles(this.app, this.host, scopeCopy);
    const documents: PlannedDocument[] = [];
    const occurrences: SearchOccurrence[] = [];
    let found = 0;
    let eligible = 0;
    let matched = 0;
    for (const file of files) {
      const path = file.path;
      const editor = this.editorFor(file);
      const originalBuffer = editor?.getValue();
      const disk = await this.read(file);
      if (this.contextVersion !== contextVersion || this.host.getProjectFolder() !== project || file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file || this.editorFor(file) !== editor || editor && editor.getValue() !== originalBuffer) throw new GlobalReplaceError("changed", [path]);
      const original = originalBuffer ?? disk;
      const textOptions = { ...searchOptions, caseSensitive: searchOptions.ignoreCase === false };
      const changes = planTextReplacements(original, query, replacement, textOptions).map((change) => ({ ...change, path, expected: original.slice(change.from, change.to) }));
      const matches = FeuilletsSearchEngine.searchInText(original, file, query, { ...searchOptions, replacementQuery: replacement });
      found += FeuilletsSearchEngine.searchInText(original, file, query, { ...searchOptions, protectMarkdown: false }).length;
      eligible += changes.length;
      matched += matches.length;
      occurrences.push(...matches);
      documents.push({ file, path, original, disk, editor, changes, result: applyTextReplacements(original, changes) });
    }
    return { project, projectPath: project.path, contextVersion, scope: scopeCopy, documents, occurrences, found, eligible, skipped: found - eligible, protectedCount: found - matched, unchangedCount: matched - eligible, filesCount: documents.filter((document) => document.changes.length).length };
  }

  private checkContext(plan: GlobalReplacePlan): void {
    if (this.contextVersion !== plan.contextVersion || this.host.getProjectFolder() !== plan.project || plan.project.path !== plan.projectPath) throw new GlobalReplaceError("project");
    const files = resolveSearchReplaceFiles(this.app, this.host, plan.scope);
    if (files.length !== plan.documents.length || files.some((file, index) => file !== plan.documents[index].file || file.path !== plan.documents[index].path)) throw new GlobalReplaceError("changed");
  }

  private async validate(document: PlannedDocument): Promise<void> {
    if (document.file.path !== document.path || this.app.vault.getAbstractFileByPath(document.path) !== document.file || this.editorFor(document.file) !== document.editor) throw new GlobalReplaceError("changed", [document.path]);
    const disk = await this.read(document.file);
    if (document.file.path !== document.path || this.app.vault.getAbstractFileByPath(document.path) !== document.file || this.editorFor(document.file) !== document.editor || document.editor && document.editor.getValue() !== document.original || (!document.editor && disk !== document.original) || document.editor && disk !== document.disk && disk !== document.original) throw new GlobalReplaceError("changed", [document.path]);
  }

  private async ensureBackupFolder(project: TFolder): Promise<string> {
    const path = `${getBackupsRoot(this.app, project)?.path ?? feuilletsAuxiliaryPath(project, "backups")}/SearchReplace`;
    let current = "";
    for (const part of path.split("/")) {
      current = current ? `${current}/${part}` : part;
      const folder = await ensureFolder(this.app, current);
      if (!(folder instanceof TFolder)) throw new GlobalReplaceError("backup", [current]);
    }
    return path;
  }

  private async saveRecord(file: TFile, record: RecoveryRecord): Promise<void> {
    // Originals are immutable. A failed status update must never damage them.
    const path = `${file.path}.state`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    let status: TFile;
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, record.state);
      status = existing;
    } else if (!existing) status = await this.app.vault.create(path, record.state);
    else throw new GlobalReplaceError("backup", [path]);
    if (await this.read(status) !== record.state) throw new GlobalReplaceError("backup", [path]);
  }

  private async backup(plan: GlobalReplacePlan): Promise<{ file: TFile; record: RecoveryRecord }> {
    try {
      const folder = await this.ensureBackupFolder(plan.project);
      const root = this.app.vault.getAbstractFileByPath(folder);
      let created = Date.now();
      if (root instanceof TFolder) for (const child of root.children) {
        const previous = Number(child.name.split("-")[0]);
        if (Number.isSafeInteger(previous)) created = Math.max(created, previous + 1);
      }
      const id = `${created}-${crypto.randomUUID()}`;
      const record: RecoveryRecord = {
        version: 1, id, projectPath: plan.projectPath, created, state: "prepared",
        documents: plan.documents.filter((document) => document.changes.length).map(({ path, original, disk, result, changes }) => ({ path, original, disk, result, changes })),
      };
      const content = JSON.stringify(record);
      const file = await this.app.vault.create(`${folder}/${id}.json`, content);
      if (await this.read(file) !== content) throw new Error("Backup verification failed");
      return { file, record };
    } catch { throw new GlobalReplaceError("backup"); }
  }

  private async write(document: PlannedDocument, plan: GlobalReplacePlan): Promise<void> {
    await this.validate(document);
    this.checkContext(plan);
    if (document.editor) {
      FeuilletsSearchEngine.applyEditorChanges(document.editor, document.original, document.changes);
      await this.saveEditor(document.file, document.editor, document.result, () => this.checkContext(plan));
    } else {
      await this.app.vault.process(document.file, (disk) => {
        this.checkContext(plan);
        if (this.app.vault.getAbstractFileByPath(document.path) !== document.file || this.editorFor(document.file) || disk !== document.original) throw new GlobalReplaceError("changed", [document.path]);
        return document.result;
      });
    }
    if (this.editorFor(document.file) !== document.editor || document.editor && document.editor.getValue() !== document.result || await this.read(document.file) !== document.result) throw new GlobalReplaceError("changed", [document.path]);
  }

  /** Restore only states owned by this operation. Later edits always win. */
  private async restore(document: SavedDocument, project: TFolder, identity?: TFile, checkContext?: () => void): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(document.path);
    if (!(file instanceof TFile) || identity && file !== identity || !belongsTo(this.app, file, project)) throw new GlobalReplaceError("conflict", [document.path]);
    const editor = this.editorFor(file);
    const current = editor?.getValue();
    const disk = await this.read(file);
    checkContext?.();
    if (file.path !== document.path || this.app.vault.getAbstractFileByPath(document.path) !== file || this.editorFor(file) !== editor) throw new GlobalReplaceError("conflict", [document.path]);
    if (editor && current !== document.result && current !== document.original || disk !== document.result && disk !== document.original && disk !== document.disk) throw new GlobalReplaceError("conflict", [document.path]);
    if (editor && current === document.result) {
      let delta = 0;
      const reverse = document.changes.map((change) => {
        const from = change.from + delta;
        delta += change.text.length - (change.to - change.from);
        return { from, to: from + change.text.length, text: change.expected };
      });
      FeuilletsSearchEngine.applyEditorChanges(editor, document.result, reverse);
    }
    if (editor) await this.saveEditor(file, editor, document.original, checkContext);
    else {
      await this.app.vault.process(file, (value) => {
        checkContext?.();
        if (this.app.vault.getAbstractFileByPath(document.path) !== file || this.editorFor(file) || value !== document.result && value !== document.original && value !== document.disk) throw new GlobalReplaceError("conflict", [document.path]);
        return document.original;
      });
    }
    if (this.editorFor(file) !== editor || editor && editor.getValue() !== document.original || await this.read(file) !== document.original) throw new GlobalReplaceError("conflict", [document.path]);
  }

  async apply(plan: GlobalReplacePlan): Promise<{ totalReplacements: number; filesCount: number }> {
    if (this.busy) throw new GlobalReplaceError("busy");
    this.busy = true;
    let backup: { file: TFile; record: RecoveryRecord } | undefined;
    const attempted: PlannedDocument[] = [];
    try {
      this.checkContext(plan);
      for (const document of plan.documents) await this.validate(document);
      if (!plan.eligible) return { totalReplacements: 0, filesCount: 0 };
      backup = await this.backup(plan);
      this.checkContext(plan);
      for (const document of plan.documents) await this.validate(document);
      for (const document of plan.documents) {
        if (!document.changes.length) continue;
        this.checkContext(plan);
        attempted.push(document);
        await this.write(document, plan);
      }
      this.checkContext(plan);
      for (const document of attempted) {
        if (this.editorFor(document.file) !== document.editor || document.editor && document.editor.getValue() !== document.result || await this.read(document.file) !== document.result) throw new GlobalReplaceError("changed", [document.path]);
      }
      backup.record.state = "complete";
      await this.saveRecord(backup.file, backup.record);
      this.checkContext(plan);
      return { totalReplacements: plan.eligible, filesCount: plan.filesCount };
    } catch (error) {
      const conflicts: string[] = [];
      for (const document of attempted.reverse()) {
        try { await this.restore(document, plan.project, document.file); }
        catch { conflicts.push(document.path); }
      }
      if (backup) {
        backup.record.state = conflicts.length ? "conflicts" : "restored";
        try { await this.saveRecord(backup.file, backup.record); }
        catch { conflicts.push(backup.file.path); }
      }
      if (conflicts.length) throw new GlobalReplaceError("recovery", conflicts, backup?.file.path);
      throw error instanceof GlobalReplaceError ? error : new GlobalReplaceError("write", attempted.map(({ path }) => path), backup?.file.path);
    } finally { this.busy = false; }
  }

  private parseRecord(content: string): RecoveryRecord {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("projectPath" in value) || typeof value.projectPath !== "string" || !("id" in value) || typeof value.id !== "string" || !("created" in value) || typeof value.created !== "number" || !("state" in value) || !["prepared", "complete", "restored", "conflicts"].includes(String(value.state)) || !("documents" in value) || !Array.isArray(value.documents)) throw new GlobalReplaceError("backup");
    const paths = new Set<string>();
    for (const document of value.documents as unknown[]) {
      if (!document || typeof document !== "object" || !("path" in document) || typeof document.path !== "string" || !("original" in document) || typeof document.original !== "string" || !("disk" in document) || typeof document.disk !== "string" || !("result" in document) || typeof document.result !== "string" || !("changes" in document) || !Array.isArray(document.changes)) throw new GlobalReplaceError("backup");
      if (paths.has(document.path)) throw new GlobalReplaceError("backup");
      paths.add(document.path);
      let end = 0;
      const changes: TextReplacement[] = [];
      for (const change of document.changes as unknown[]) {
        if (!change || typeof change !== "object" || !("from" in change) || typeof change.from !== "number" || !Number.isSafeInteger(change.from) || change.from < end || !("to" in change) || typeof change.to !== "number" || !Number.isSafeInteger(change.to) || change.to < change.from || change.to > document.original.length || !("text" in change) || typeof change.text !== "string" || !("expected" in change) || change.expected !== document.original.slice(change.from, change.to) || !("path" in change) || change.path !== document.path) throw new GlobalReplaceError("backup");
        changes.push({ from: change.from, to: change.to, text: change.text });
        end = change.to;
      }
      if (applyTextReplacements(document.original, changes) !== document.result) throw new GlobalReplaceError("backup");
    }
    return value as RecoveryRecord;
  }

  async undoLast(): Promise<number> {
    if (this.busy) throw new GlobalReplaceError("busy");
    this.busy = true;
    try {
      const project = this.host.getProjectFolder();
      const contextVersion = this.contextVersion;
      if (!project) throw new GlobalReplaceError("scope");
      const folder = this.app.vault.getAbstractFileByPath(`${getBackupsRoot(this.app, project)?.path ?? feuilletsAuxiliaryPath(project, "backups")}/SearchReplace`);
      if (!(folder instanceof TFolder)) throw new GlobalReplaceError("noUndo");
      const candidates = folder.children.filter((file): file is TFile => file instanceof TFile && file.extension === "json").sort((a, b) => b.name.localeCompare(a.name));
      let latest: { file: TFile; record: RecoveryRecord } | undefined;
      for (const file of candidates) {
        const record = this.parseRecord(await this.read(file));
        if (record.projectPath !== project.path) continue;
        const status = this.app.vault.getAbstractFileByPath(`${file.path}.state`);
        if (status instanceof TFile) {
          const state = await this.read(status);
          if (state === "complete" || state === "restored" || state === "conflicts") record.state = state;
        }
        if (record.state !== "restored") { latest = { file, record }; break; }
      }
      if (!latest) throw new GlobalReplaceError("noUndo");
      const { file, record } = latest;
      // Resolve and validate all saved paths before restoring even the first one.
      let allowed: Set<TFile>;
      try { allowed = new Set(resolveSearchReplaceFiles(this.app, this.host, { type: "selection", projectRoot: project.path, paths: record.documents.map(({ path }) => path) })); }
      catch { throw new GlobalReplaceError("conflict", record.documents.map(({ path }) => path), file.path); }
      const conflicts: string[] = [];
      const identities = new Map<string, TFile>();
      for (const document of record.documents) {
        const target = this.app.vault.getAbstractFileByPath(document.path);
        if (!(target instanceof TFile) || !allowed.has(target)) { conflicts.push(document.path); continue; }
        identities.set(document.path, target);
        const editor = this.editorFor(target);
        const disk = await this.read(target);
        const content = editor?.getValue() ?? disk;
        const recovering = record.state !== "complete";
        if (content !== document.result && !(recovering && (content === document.original || !editor && content === document.disk)) || disk !== document.result && !(editor && (disk === document.disk || disk === document.original)) && !(recovering && (disk === document.disk || disk === document.original))) conflicts.push(document.path);
      }
      if (conflicts.length) throw new GlobalReplaceError("conflict", conflicts, file.path);
      for (const document of record.documents) {
        try {
          if (this.contextVersion !== contextVersion || this.host.getProjectFolder() !== project) throw new GlobalReplaceError("project");
          await this.restore(document, project, identities.get(document.path), () => {
            if (this.contextVersion !== contextVersion || this.host.getProjectFolder() !== project) throw new GlobalReplaceError("project");
          });
        } catch { conflicts.push(document.path); break; }
      }
      record.state = conflicts.length ? "conflicts" : "restored";
      try { await this.saveRecord(file, record); }
      catch { throw new GlobalReplaceError("recovery", [...conflicts, file.path], file.path); }
      if (conflicts.length) throw new GlobalReplaceError("recovery", conflicts, file.path);
      return record.documents.length;
    } finally { this.busy = false; }
  }
}
