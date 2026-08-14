import { MarkdownView, Modal, Notice, Setting, TFile, TFolder, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { AnnotationPopover } from "../ui/annotation-popover.js";
import { createNativeReviewAuthor, type AuthorReviewScope } from "../services/native-review-author.js";
import { listNativeReviewSessions, receiveNativeReviewExchange, type NativeReviewSessionEntry } from "../services/native-review-exchange.js";
import { createNativeReviewReviewerReturn } from "../services/native-review-reviewer-return.js";
import { addNativeReviewThread, loadNativeReviewThreads, type NativeReviewThread } from "../services/native-review-threads.js";
import { currentReviewRound, type ReviewSession } from "../services/native-review-session.js";
import { loadNativeReviewWork } from "../services/native-review-work.js";
import { loadNativeReviewLocalState, setNativeReviewArchived } from "../services/native-review-local-state.js";
import { authorReviewStorageLocation, removeNativeReviewSession, reviewSessionPaths, reviewerReviewStorageLocation, type NativeReviewStorageLocation } from "../services/native-review-storage.js";
import { ConfirmModal } from "../ui/basic-modals.js";
import { comparisonSummaryLabel, openFeuilletsComparison } from "./comparison-view.js";
import { t } from "../i18n/index.js";
import { resolveNativeReviewThreadAnchor } from "../utils/cm-native-review-highlighter.js";

type NativeReviewPlugin = { app: App; settings: FeuilletsSettings; manifest?: { version?: string }; refreshNativeReviewDecorations?: () => Promise<void>; setNativeReviewEditorContext?: (context: { reviewId: string; location: NativeReviewStorageLocation; documentId?: string } | null) => void; clearNativeReviewEditorContext?: () => void; closeNativeReviewThreadPopover?: () => void; openNativeReviewThread?: (threadId: string, target: HTMLElement) => Promise<void> };
type NativeReviewSelection = { document: ReviewSession["documents"][number]; view: MarkdownView; start: number; end: number };

/**
 * État affiché à l'auteur. Il n'existe que trois moments : la relecture est
 * partie, elle est revenue, elle est finie. Aucun tour, aucune sous-session.
 */
export type NativeReviewStage = "sent" | "toHandle" | "finished";
export function nativeReviewStage(session: ReviewSession): NativeReviewStage {
  if (session.status === "completed") return "finished";
  return currentReviewRound(session).received ? "toHandle" : "sent";
}

/** Actions du relecteur : relire puis retourner, un point c'est tout. */
export type NativeReviewReviewerAction = "return" | "resend" | "archive";
export function nativeReviewReviewerActions(session: ReviewSession, archived = false): NativeReviewReviewerAction[] {
  if (session.localRole !== "reviewer" || session.status !== "active" || archived) return [];
  return currentReviewRound(session).sent ? ["resend", "archive"] : ["return"];
}

export interface NativeReviewImportHandlerBridge {
  receive(bytes: Uint8Array): Promise<ReviewSession>;
  select(session: ReviewSession): void;
  refreshEditor(): Promise<void>;
  render(): Promise<void>;
  openWorking(path: string): Promise<void>;
  notice(message: string): void;
  diagnostic(error: unknown): void;
}

/** Exact import path used by the file-picker handler. Keeping it exported makes
 * the UI boundary (including its ArrayBuffer conversion and refreshes) testable. */
export async function handleNativeReviewImportBuffer(buffer: ArrayBuffer, bridge: NativeReviewImportHandlerBridge): Promise<ReviewSession | null> {
  let session: ReviewSession;
  try {
    const bytes = new Uint8Array(buffer.byteLength); bytes.set(new Uint8Array(buffer));
    session = await bridge.receive(bytes);
  } catch (error) {
    bridge.diagnostic(error);
    bridge.notice(t("nativeReview.notice.importFailed"));
    return null;
  }
  try {
    bridge.select(session);
    await bridge.refreshEditor();
    const working = session.documents.find((document) => Boolean(document.localSourcePath))?.localSourcePath;
    if (working) await bridge.openWorking(working);
    await bridge.render();
    await bridge.refreshEditor();
    bridge.notice(t("nativeReview.notice.imported"));
    return session;
  } catch (error) {
    bridge.diagnostic(error);
    bridge.notice(t("nativeReview.notice.importedRefreshFailed"));
    return session;
  }
}

export function nativeReviewDocumentForPath<T extends { localSourcePath?: string }>(documents: T[], path: string | null | undefined): T | undefined {
  return path ? documents.find((document) => document.localSourcePath === path) : documents[0];
}

export interface NativeReviewThreadFocusBridge {
  openDocument(path: string): Promise<{ editor: Pick<MarkdownView["editor"], "getValue" | "offsetToPos" | "setSelection" | "scrollIntoView">; contentEl: HTMLElement } | null>;
  refresh(): Promise<void>;
  openPopover(threadId: string, target: HTMLElement): Promise<void>;
}
export async function focusNativeReviewThreadCard(thread: NativeReviewThread, localSourcePath: string, bridge: NativeReviewThreadFocusBridge): Promise<boolean> {
  const opened = await bridge.openDocument(localSourcePath); if (!opened) return false;
  const range = resolveNativeReviewThreadAnchor(thread.anchor, opened.editor.getValue()); if (!range) return false;
  const from = opened.editor.offsetToPos(range.start); const to = opened.editor.offsetToPos(range.end); opened.editor.setSelection(from, to); opened.editor.scrollIntoView({ from, to }, true);
  await bridge.refresh();
  const target = opened.contentEl.querySelector<HTMLElement>(`[data-native-review-thread-id="${thread.threadId}"]`) ?? opened.contentEl.querySelector<HTMLElement>(".cm-selectionBackground") ?? opened.contentEl.querySelector<HTMLElement>(".cm-editor");
  if (!target) return false; await bridge.openPopover(thread.threadId, target); return true;
}

/** Finds an open working editor even after the sidebar, rather than the editor, receives focus. */
export function nativeReviewWorkingSelection(app: Pick<App, "workspace">, session: ReviewSession): NativeReviewSelection | null {
  const byPath = new Map(session.documents.filter((document) => Boolean(document.localSourcePath)).map((document) => [document.localSourcePath!, document]));
  const candidates: NativeReviewSelection[] = [];
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || !view.file) continue;
    const document = byPath.get(view.file.path); if (!document) continue;
    const from = view.editor.getCursor("from"); const to = view.editor.getCursor("to");
    candidates.push({ document, view, start: view.editor.posToOffset(from), end: view.editor.posToOffset(to) });
  }
  const activePath = app.workspace.getActiveFile()?.path;
  const active = candidates.find((candidate) => candidate.view.file?.path === activePath);
  if (active) return active;
  const selected = candidates.filter((candidate) => candidate.start !== candidate.end);
  return selected.length === 1 ? selected[0] : null;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function version(plugin: NativeReviewPlugin): string { return plugin.manifest?.version || "Feuillets"; }
function download(data: ArrayBuffer | Uint8Array, name: string): void {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/octet-stream" }));
  const anchor = document.body.createEl("a"); anchor.href = url; anchor.download = name; anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function packageName(session: ReviewSession): string { return `relecture-${session.reviewId}-${t(session.localRole === "author" ? "nativeReview.file.author" : "nativeReview.file.reviewer")}.feuillets`; }
function shortExcerpt(value: string): string { const clean = value.replace(/\s+/g, " ").trim(); return clean.length > 72 ? `${clean.slice(0, 69)}…` : clean; }

class NewReviewModal extends Modal {
  constructor(app: App, private readonly onSubmit: (author: string, reviewer: string, scope: "file" | "folder" | "project") => Promise<void>) { super(app); }
  onOpen(): void {
    let author = ""; let reviewer = ""; let scope: "file" | "folder" | "project" = "file";
    this.contentEl.createEl("h3", { text: t("nativeReview.new.title") });
    new Setting(this.contentEl).setName(t("nativeReview.new.authorName")).addText((input) => input.onChange((value) => { author = value; }));
    new Setting(this.contentEl).setName(t("nativeReview.new.reviewerName")).addText((input) => input.onChange((value) => { reviewer = value; }));
    new Setting(this.contentEl).setName(t("nativeReview.new.scope")).addDropdown((input) => input
      .addOption("file", t("nativeReview.scope.file")).addOption("folder", t("nativeReview.scope.folder")).addOption("project", t("nativeReview.scope.project"))
      .onChange((value) => { scope = value as typeof scope; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText(t("nativeReview.new.createDownload")).setCta().onClick(() => {
      void this.onSubmit(author, reviewer, scope).then(() => this.close());
    }));
  }
}

/**
 * Panneau de relecture. Il ne montre que la relecture utile maintenant :
 * envoyée, à traiter, ou rien. Les relectures terminées vivent derrière un
 * repli discret ; tout le traitement se passe dans la comparaison côte à côte.
 */
export class NativeReviewView {
  targetContainer?: HTMLElement;
  /** Seul le relecteur garde un écran dédié : il doit ouvrir son texte de travail. */
  private openedReviewerId: string | null = null;
  private openedReviewerLocation: NativeReviewStorageLocation | null = null;
  constructor(private readonly leaf: WorkspaceLeaf, private readonly plugin: NativeReviewPlugin) {}
  private get app(): App { return this.plugin.app; }

  async render(): Promise<void> {
    const container = this.targetContainer;
    if (!container) return;
    container.empty(); container.addClass("feuillets-native-review-container");
    if (this.openedReviewerId && this.openedReviewerLocation) { await this.renderReviewerScreen(container, this.openedReviewerId, this.openedReviewerLocation); return; }
    this.plugin.clearNativeReviewEditorContext?.();
    await this.renderHome(container);
  }

  private button(parent: HTMLElement, label: string, onClick: () => void | Promise<void>, icon?: string, cta = false): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `feuillets-native-review-button${cta ? " mod-cta" : ""}`, text: label });
    if (icon) { const span = button.createSpan(); setIcon(span, icon); }
    button.addEventListener("click", (event) => { event.stopPropagation(); void onClick(); }); return button;
  }
  private section(parent: HTMLElement, title: string): HTMLElement { const section = parent.createDiv({ cls: "feuillets-project-section" }); section.createEl("h4", { text: title }); return section; }

  private async renderHome(container: HTMLElement): Promise<void> {
    const actions = this.section(container, t("nativeReview.title"));
    if (authorReviewStorageLocation(this.app, this.plugin.settings)) this.button(actions, t("nativeReview.action.new"), () => new NewReviewModal(this.app, async (author, reviewer, scope) => this.create(author, reviewer, scope)).open(), "plus");
    this.button(actions, t("nativeReview.action.importPackage"), () => this.pickFile(), "upload");

    let sessions: NativeReviewSessionEntry[];
    try { sessions = await listNativeReviewSessions(this.app, this.plugin.settings); }
    catch (error) { actions.createEl("p", { text: errorMessage(error) }); return; }

    const mine = sessions.filter((item) => item.session?.localRole === "author");
    const active = mine.filter((item) => item.session!.status === "active");
    const finished = mine.filter((item) => item.session!.status === "completed");
    for (const item of active) await this.renderAuthorCard(container, item);

    const received: NativeReviewSessionEntry[] = [];
    for (const item of sessions.filter((entry) => entry.session?.localRole === "reviewer")) {
      if (!(await loadNativeReviewLocalState(this.app, item.location, item.reviewId)).archivedAt) received.push(item);
    }
    for (const item of received) this.renderReviewerCard(container, item);

    const broken = sessions.filter((item) => item.error);
    for (const item of broken) container.createDiv({ cls: "feuillets-native-review-neutral", text: `${item.reviewId} — ${item.error}` });

    // Aucune section, aucun état vide : quand il n'y a rien à traiter, seules
    // les deux actions d'entrée restent affichées.
    if (finished.length) this.renderPrevious(container, finished);
  }

  /** Une seule carte : qui, où en est la relecture, et l'action du moment. */
  private async renderAuthorCard(container: HTMLElement, item: NativeReviewSessionEntry): Promise<void> {
    const session = item.session!;
    const reviewer = session.participants.find((person) => person.role === "reviewer")?.name ?? t("nativeReview.role.reviewer");
    const card = container.createDiv({ cls: "feuillets-native-review-card" });
    card.createDiv({ cls: "feuillets-native-review-card-label", text: reviewer });
    const stage = nativeReviewStage(session);
    if (stage === "sent") {
      card.createDiv({ cls: "feuillets-native-review-session-state", text: t("nativeReview.state.waitingReviewer", { name: reviewer }) });
      const actions = card.createDiv({ cls: "feuillets-native-review-actions" });
      this.button(actions, t("nativeReview.action.importReturn"), () => this.pickFile(), undefined, true);
      this.button(actions, t("nativeReview.action.resendPackage"), () => this.resend(session, item.location));
      return;
    }
    card.createDiv({ cls: "feuillets-native-review-session-state", text: t("nativeReview.state.toHandle") });
    const openDocument = (documentId: string, leftPath: string) => async (): Promise<void> => {
      await openFeuilletsComparison(this.app, this.plugin, { kind: "native-review", sourcePath: leftPath, reviewId: session.reviewId, sessionsRootPath: item.location.sessionsRootPath, documentId });
    };
    try {
      const work = await loadNativeReviewWork(this.app, session.reviewId, item.location);
      card.createDiv({ cls: "feuillets-native-review-quote", text: comparisonSummaryLabel(work.pendingChanges, work.pendingNotes) });
      // Une seule relecture peut contenir plusieurs feuillets : chacun garde son
      // propre accès, sinon les documents au-delà du premier restent inatteignables.
      if (work.documents.length > 1) {
        const list = card.createDiv({ cls: "feuillets-native-review-document-list" });
        for (const document of work.documents) {
          if (!document.localSourcePath) continue;
          const row = list.createDiv({ cls: "feuillets-native-review-card feuillets-clickable" });
          row.createDiv({ cls: "feuillets-native-review-card-label", text: document.title });
          const pending = document.changes.filter((change) => !change.handled).length;
          const notes = document.notes.filter((note) => !note.resolved).length;
          row.createDiv({ cls: "feuillets-native-review-quote", text: comparisonSummaryLabel(pending, notes) });
          row.addEventListener("click", () => { void openDocument(document.documentId, document.localSourcePath!)(); });
        }
      } else {
        const only = work.documents[0];
        if (only?.localSourcePath) this.button(card.createDiv({ cls: "feuillets-native-review-actions" }), t("nativeReview.action.handleReview"), openDocument(only.documentId, only.localSourcePath), undefined, true);
      }
    } catch (error) {
      card.createDiv({ cls: "feuillets-native-review-status", text: errorMessage(error) });
      const fallback = session.documents[0];
      if (fallback?.documentId && fallback.localSourcePath) this.button(card.createDiv({ cls: "feuillets-native-review-actions" }), t("nativeReview.action.handleReview"), openDocument(fallback.documentId, fallback.localSourcePath), undefined, true);
    }
  }

  private renderReviewerCard(container: HTMLElement, item: NativeReviewSessionEntry): void {
    const session = item.session!;
    const author = session.participants.find((person) => person.role === "author")?.name ?? t("nativeReview.role.author");
    const card = container.createDiv({ cls: "feuillets-native-review-card feuillets-clickable" });
    card.createDiv({ cls: "feuillets-native-review-card-label", text: author });
    const returned = Boolean(currentReviewRound(session).sent);
    card.createDiv({ cls: "feuillets-native-review-session-state", text: t(returned ? "nativeReview.state.returned" : "nativeReview.state.toRead", { name: author }) });
    card.addEventListener("click", () => { this.openedReviewerId = session.reviewId; this.openedReviewerLocation = item.location; void this.render(); });
  }

  private renderPrevious(container: HTMLElement, finished: NativeReviewSessionEntry[]): void {
    const details = container.createEl("details", { cls: "feuillets-native-review-treated" });
    details.createEl("summary", { text: t("nativeReview.previous", { count: String(finished.length) }) });
    for (const item of finished) {
      const session = item.session!;
      const reviewer = session.participants.find((person) => person.role === "reviewer")?.name ?? t("nativeReview.role.reviewer");
      const row = details.createDiv({ cls: "feuillets-native-review-history-row" });
      row.createSpan({ text: `${reviewer} · ${new Date(session.updatedAt).toLocaleDateString()}` });
      this.button(row, t("nativeReview.action.delete"), () => this.confirmDelete(session, item.location));
    }
  }

  private async create(authorName: string, reviewerName: string, choice: "file" | "folder" | "project"): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    let scope: AuthorReviewScope;
    if (choice === "project") scope = { type: "project" };
    else if (!active || active.extension !== "md") { new Notice(t("nativeReview.notice.openSheet")); return; }
    else if (choice === "folder") { const parent = active.parent; if (!(parent instanceof TFolder)) { new Notice(t("nativeReview.notice.invalidFolder")); return; } scope = { type: "folder", path: parent.path }; }
    else scope = { type: "file", path: active.path };
    try { const result = await createNativeReviewAuthor(this.app, this.plugin.settings, { authorName, reviewerName, scope, createdByVersion: version(this.plugin) }); download(result.packageData, packageName(result.session)); await this.render(); }
    catch (error) { new Notice(errorMessage(error)); }
  }
  private pickFile(): void {
    const input = document.body.createEl("input"); input.type = "file"; input.accept = ".feuillets";
    input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void this.receive(file); }); input.click();
  }
  private async receive(file: File): Promise<void> {
    let buffer: ArrayBuffer;
    try { buffer = await file.arrayBuffer(); }
    catch (error) { console.error("Feuillets: native review file read failed", error); new Notice(t("nativeReview.notice.importFailed")); return; }
    await handleNativeReviewImportBuffer(buffer, {
      receive: (bytes) => receiveNativeReviewExchange(this.app, bytes, this.plugin.settings),
      select: (session) => { if (session.localRole === "reviewer") { this.openedReviewerId = session.reviewId; this.openedReviewerLocation = reviewerReviewStorageLocation(); } },
      refreshEditor: async () => { await this.plugin.refreshNativeReviewDecorations?.(); },
      render: () => this.render(),
      openWorking: (path) => this.openNativeReviewDocument(path),
      notice: (message) => { new Notice(message); },
      diagnostic: (error) => { console.error("Feuillets: native review import failed", error); },
    });
  }
  private async resend(session: ReviewSession, location: NativeReviewStorageLocation | null): Promise<void> {
    if (!location) return; const round = currentReviewRound(session); const path = `${reviewSessionPaths(location, session.reviewId).roundsRoot}/round-${round.round}-sent.feuillets`; const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice(t("nativeReview.notice.archiveMissing")); return; }
    download(await this.app.vault.readBinary(file), packageName(session));
  }
  /** Écran du relecteur : ouvrir le texte, le commenter, le retourner. */
  private async renderReviewerScreen(container: HTMLElement, reviewId: string, location: NativeReviewStorageLocation): Promise<void> {
    const back = container.createDiv({ cls: "feuillets-notes-back-bar" });
    this.button(back, t("nativeReview.back"), () => { this.openedReviewerId = null; this.openedReviewerLocation = null; this.plugin.clearNativeReviewEditorContext?.(); return this.render(); }, "arrow-left");
    const loaded = (await listNativeReviewSessions(this.app, this.plugin.settings)).find((item) => item.reviewId === reviewId && item.location.sessionsRootPath === location.sessionsRootPath);
    const session = loaded?.session;
    if (!session || session.localRole !== "reviewer") { container.createEl("p", { text: loaded?.error || t("nativeReview.notice.sessionMissing") }); return; }
    const activeFile = this.app.workspace.getActiveFile();
    const currentDocument = nativeReviewDocumentForPath(session.documents, activeFile?.path);
    this.plugin.setNativeReviewEditorContext?.({ reviewId, location, documentId: currentDocument?.documentId });
    const author = session.participants.find((person) => person.role === "author")?.name ?? t("nativeReview.role.author");
    const head = this.section(container, author);
    if (currentDocument?.title) head.createEl("p", { cls: "feuillets-native-review-context", text: currentDocument.title });
    // Une seule relecture peut contenir plusieurs feuillets : sans cette liste,
    // rien dans l'écran ne permet d'atteindre les documents au-delà du premier.
    if (session.documents.length > 1) {
      const list = head.createDiv({ cls: "feuillets-native-review-document-list" });
      for (const document of session.documents) {
        if (!document.localSourcePath) continue;
        const row = list.createDiv({ cls: `feuillets-native-review-card feuillets-clickable${document.documentId === currentDocument?.documentId ? " feuillets-mode-active" : ""}` });
        row.createDiv({ cls: "feuillets-native-review-card-label", text: document.title });
        row.addEventListener("click", () => { void this.openNativeReviewDocument(document.localSourcePath!); });
      }
    }

    if ((await loadNativeReviewLocalState(this.app, location, reviewId)).archivedAt) {
      head.createEl("p", { cls: "feuillets-native-review-session-state", text: t("nativeReview.state.archivedLocal") });
      this.button(head, t("nativeReview.action.deleteLocal"), () => this.confirmDelete(session, location));
      return;
    }
    const actions = head.createDiv({ cls: "feuillets-native-review-actions" });
    for (const action of nativeReviewReviewerActions(session)) {
      if (action === "return") this.button(actions, t("nativeReview.action.returnAuthor", { name: author }), () => this.returnReviewer(reviewId), undefined, true);
      if (action === "resend") this.button(actions, t("nativeReview.action.resendShort"), () => this.resend(session, location));
      if (action === "archive") this.button(actions, t("nativeReview.action.archiveLocal"), () => this.archiveReviewer(session, location));
    }
    if (currentReviewRound(session).sent) { head.createEl("p", { cls: "feuillets-native-review-session-state", text: t("nativeReview.state.returned", { name: author }) }); return; }

    const document = currentDocument ?? session.documents[0];
    if (document?.localSourcePath) this.button(actions, t("nativeReview.action.open"), () => this.openNativeReviewDocument(document.localSourcePath!));
    this.button(actions, t("nativeReview.action.commentSelection"), () => this.commentSelection(session, location));
    await this.renderReviewerNotes(container, session, location, document?.documentId);
  }

  /** Native-review navigation never creates a tab when the working is already open. */
  private async openNativeReviewDocument(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) return;
    const opened = this.app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === path);
    if (opened) { void this.app.workspace.revealLeaf(opened); return; }
    const reusable = this.app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view instanceof MarkdownView);
    const leaf = reusable ?? this.app.workspace.getLeaf(false);
    await leaf.openFile(file); void this.app.workspace.revealLeaf(leaf);
  }
  private async focusThread(thread: NativeReviewThread, path: string): Promise<void> {
    const found = await focusNativeReviewThreadCard(thread, path, {
      openDocument: async (targetPath) => { await this.openNativeReviewDocument(targetPath); const leaf = this.app.workspace.getLeavesOfType("markdown").find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === targetPath); return leaf?.view instanceof MarkdownView ? { editor: leaf.view.editor, contentEl: leaf.view.contentEl } : null; },
      refresh: async () => { await this.plugin.refreshNativeReviewDecorations?.(); },
      openPopover: async (threadId, target) => { await this.plugin.openNativeReviewThread?.(threadId, target); },
    });
    if (!found) new Notice(t("nativeReview.notice.passageMissing"));
  }
  private async commentSelection(session: ReviewSession, location: NativeReviewStorageLocation): Promise<void> {
    const selection = nativeReviewWorkingSelection(this.app, session);
    if (!selection) { new Notice(t("nativeReview.notice.openWorkingSelection")); return; }
    const { document: selectedDocument, start, end } = selection; if (start === end) { new Notice(t("nativeReview.notice.selectPassage")); return; }
    const anchor = selection.view.contentEl.querySelector<HTMLElement>(".cm-selectionBackground") ?? selection.view.contentEl.querySelector<HTMLElement>(".cm-editor") ?? window.document.body;
    new AnnotationPopover({
      parentEl: document.body, anchor, text: "", color: "yellow",
      onSave: async (text, color, style) => {
        try { await addNativeReviewThread(this.app, session.reviewId, selectedDocument.documentId, start, end, text, { color, style }, location); await this.plugin.refreshNativeReviewDecorations?.(); await this.render(); }
        catch (error) { new Notice(errorMessage(error)); }
      },
    }).open();
  }
  private async renderReviewerNotes(container: HTMLElement, session: ReviewSession, location: NativeReviewStorageLocation, documentId?: string): Promise<void> {
    let threads: NativeReviewThread[];
    try { threads = (await loadNativeReviewThreads(this.app, session.reviewId, location)).threads; }
    catch { container.createEl("p", { cls: "feuillets-native-review-neutral", text: t("nativeReview.threads.unreadable") }); return; }
    const matching = (documentId ? threads.filter((thread) => thread.documentId === documentId) : threads).sort((left, right) => left.anchor.start - right.anchor.start || left.threadId.localeCompare(right.threadId));
    if (!matching.length) return;
    const section = this.section(container, t("nativeReview.notesCount", { count: String(matching.length) }));
    for (const [index, thread] of matching.entries()) {
      const item = section.createDiv({ cls: "feuillets-native-review-card feuillets-clickable" });
      item.createDiv({ cls: "feuillets-native-review-quote", text: `${index + 1}. « ${shortExcerpt(thread.anchor.quote)} »` });
      const first = thread.messages[0]; if (first) item.createDiv({ cls: "feuillets-native-review-message", text: shortExcerpt(first.text) });
      const document = session.documents.find((candidate) => candidate.documentId === thread.documentId);
      if (document?.localSourcePath) item.addEventListener("click", () => { void this.focusThread(thread, document.localSourcePath!); });
    }
  }
  private async returnReviewer(reviewId: string): Promise<void> { try { const result = await createNativeReviewReviewerReturn(this.app, reviewId, version(this.plugin)); download(result.packageData, packageName(result.session)); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
  private async archiveReviewer(session: ReviewSession, location: NativeReviewStorageLocation): Promise<void> {
    await setNativeReviewArchived(this.app, location, session.reviewId, true);
    this.openedReviewerId = null; this.openedReviewerLocation = null;
    this.plugin.clearNativeReviewEditorContext?.(); this.plugin.closeNativeReviewThreadPopover?.(); await this.render();
  }
  private confirmDelete(session: ReviewSession, location: NativeReviewStorageLocation): void {
    const reviewer = session.localRole === "reviewer";
    new ConfirmModal(this.app, t(reviewer ? "nativeReview.delete.reviewerTitle" : "nativeReview.delete.authorTitle"), t(reviewer ? "nativeReview.delete.reviewerMessage" : "nativeReview.delete.authorMessage"), t("nativeReview.action.delete"), async () => {
      if (reviewer) { const state = await loadNativeReviewLocalState(this.app, location, session.reviewId); if (!state.archivedAt) throw new Error("La copie doit être archivée avant suppression"); }
      else if (session.status !== "completed") throw new Error("Seule une relecture terminée peut être supprimée");
      await removeNativeReviewSession(this.app, location, session.reviewId);
      this.openedReviewerId = null; this.openedReviewerLocation = null;
      this.plugin.clearNativeReviewEditorContext?.(); this.plugin.closeNativeReviewThreadPopover?.(); await this.render();
    }).open();
  }
}
