import { MarkdownView, Modal, Notice, Setting, TFile, TFolder, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { createNativeReviewAuthor, type AuthorReviewScope } from "../services/native-review-author.js";
import { createNativeReviewAuthorNextRound } from "../services/native-review-author-next-round.js";
import { decideNativeReviewAuthorChange, loadNativeReviewAuthorDecisionState } from "../services/native-review-author-decisions.js";
import { loadNativeReviewAuthorAnalysis } from "../services/native-review-author-return.js";
import { completeNativeReviewSession, listNativeReviewSessions, receiveNativeReviewExchange, type NativeReviewSessionEntry } from "../services/native-review-exchange.js";
import { createNativeReviewReviewerReturn } from "../services/native-review-reviewer-return.js";
import { loadNativeReviewThreads, addNativeReviewThread, replyNativeReviewThread, setNativeReviewThreadResolved, type NativeReviewThread } from "../services/native-review-threads.js";
import { currentReviewRound, reviewRoundsRootPath, type ReviewSession } from "../services/native-review-session.js";
import { t } from "../i18n/index.js";

type NativeReviewPlugin = { app: App; settings: FeuilletsSettings; manifest?: { version?: string } };

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function version(plugin: NativeReviewPlugin): string { return plugin.manifest?.version || "Feuillets"; }
function download(data: ArrayBuffer | Uint8Array, name: string): void {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: "application/octet-stream" }));
  const anchor = document.body.createEl("a"); anchor.href = url; anchor.download = name; anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function packageName(session: ReviewSession): string { const round = currentReviewRound(session); return `review-${session.reviewId}-round-${round.round}-${t(session.localRole === "author" ? "nativeReview.file.author" : "nativeReview.file.reviewer")}.feuillets`; }
function roleLabel(role: ReviewSession["localRole"]): string { return t(role === "author" ? "nativeReview.role.author" : "nativeReview.role.reviewer"); }
function state(session: ReviewSession): string {
  if (session.status === "completed") return t("nativeReview.state.completed");
  const round = currentReviewRound(session);
  if (session.localRole === "author") return round.received ? t("nativeReview.state.toProcess") : t("nativeReview.state.waiting");
  return round.sent ? t("nativeReview.state.waiting") : t("nativeReview.state.toSend");
}

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

class TextReviewModal extends Modal {
  constructor(app: App, private readonly title: string, private readonly onSubmit: (text: string) => Promise<void>) { super(app); }
  onOpen(): void {
    let text = ""; this.contentEl.createEl("h3", { text: this.title });
    new Setting(this.contentEl).setName(this.title).addText((input) => input.onChange((value) => { text = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText(t("nativeReview.action.send")).setCta().onClick(() => { if (text.trim()) void this.onSubmit(text.trim()).then(() => this.close()); }));
  }
}

/** Embedded native-review workspace. It intentionally needs no BaseFeuilletsView/project state. */
export class NativeReviewView {
  targetContainer?: HTMLElement;
  private selectedReviewId: string | null = null;
  constructor(private readonly leaf: WorkspaceLeaf, private readonly plugin: NativeReviewPlugin) {}
  private get app(): App { return this.plugin.app; }

  async render(): Promise<void> {
    const container = this.targetContainer;
    if (!container) return;
    container.empty(); container.addClass("feuillets-native-review-container");
    if (this.selectedReviewId) { await this.renderDetail(container, this.selectedReviewId); return; }
    await this.renderHome(container);
  }

  private button(parent: HTMLElement, label: string, onClick: () => void | Promise<void>, icon?: string): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "clickable-icon", text: label });
    if (icon) { const span = button.createSpan(); setIcon(span, icon); }
    button.addEventListener("click", () => { void onClick(); }); return button;
  }
  private section(parent: HTMLElement, title: string): HTMLElement { const section = parent.createDiv({ cls: "feuillets-project-section" }); section.createEl("h4", { text: title }); return section; }
  private async renderHome(container: HTMLElement): Promise<void> {
    const actions = this.section(container, t("nativeReview.title"));
    this.button(actions, t("nativeReview.action.new"), () => new NewReviewModal(this.app, async (author, reviewer, scope) => this.create(author, reviewer, scope)).open(), "plus");
    this.button(actions, t("nativeReview.action.importPackage"), () => this.pickFile(), "upload");
    const list = this.section(container, t("nativeReview.sessions.title"));
    let sessions: NativeReviewSessionEntry[];
    try { sessions = await listNativeReviewSessions(this.app); } catch (error) { list.createEl("p", { text: errorMessage(error) }); return; }
    if (!sessions.length) list.createEl("p", { text: t("nativeReview.sessions.empty") });
    for (const item of sessions) {
      const row = list.createDiv({ cls: "feuillets-notes-section feuillets-clickable" });
      if (item.error) { row.setText(`${item.reviewId} — ${item.error}`); continue; }
      const session = item.session;
      if (!session) { row.setText(`${item.reviewId} — ${t("nativeReview.sessions.unreadable")}`); continue; }
      const names = session.participants.map((person) => person.name).join(" ↔ ");
      row.createDiv({ text: names }); row.createDiv({ cls: "feuillets-notes-sub", text: `${roleLabel(session.localRole)} · ${t("nativeReview.round", { number: String(currentReviewRound(session).round) })} · ${state(session)} · ${t("nativeReview.documents", { count: String(session.documents.length) })}` });
      row.addEventListener("click", () => { this.selectedReviewId = session.reviewId; void this.render(); });
    }
  }
  private async create(authorName: string, reviewerName: string, choice: "file" | "folder" | "project"): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    let scope: AuthorReviewScope;
    if (choice === "project") scope = { type: "project" };
    else if (!active || active.extension !== "md") { new Notice(t("nativeReview.notice.openSheet")); return; }
    else if (choice === "folder") { const parent = active.parent; if (!(parent instanceof TFolder)) { new Notice(t("nativeReview.notice.invalidFolder")); return; } scope = { type: "folder", path: parent.path }; }
    else scope = { type: "file", path: active.path };
    try { const result = await createNativeReviewAuthor(this.app, this.plugin.settings, { authorName, reviewerName, scope, createdByVersion: version(this.plugin) }); this.selectedReviewId = result.session.reviewId; download(result.packageData, packageName(result.session)); await this.render(); }
    catch (error) { new Notice(errorMessage(error)); }
  }
  private pickFile(): void {
    const input = document.body.createEl("input"); input.type = "file"; input.accept = ".feuillets";
    input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void this.receive(file); }); input.click();
  }
  private async receive(file: File): Promise<void> {
    try { const session = await receiveNativeReviewExchange(this.app, await file.arrayBuffer()); this.selectedReviewId = session.reviewId; new Notice(t("nativeReview.notice.imported")); await this.render(); }
    catch (error) { new Notice(errorMessage(error)); }
  }
  private async resend(session: ReviewSession): Promise<void> {
    const round = currentReviewRound(session); const path = `${reviewRoundsRootPath(session.reviewId)}/round-${round.round}-sent.feuillets`; const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice(t("nativeReview.notice.archiveMissing")); return; }
    download(await this.app.vault.readBinary(file), packageName(session));
  }
  private async renderDetail(container: HTMLElement, reviewId: string): Promise<void> {
    const back = container.createDiv({ cls: "feuillets-notes-back-bar" }); this.button(back, t("nativeReview.back"), () => { this.selectedReviewId = null; return this.render(); }, "arrow-left");
    const loaded = (await listNativeReviewSessions(this.app)).find((item) => item.reviewId === reviewId);
    if (!loaded?.session) { container.createEl("p", { text: loaded?.error || t("nativeReview.notice.sessionMissing") }); return; }
    const session = loaded.session; const head = this.section(container, session.participants.map((p) => p.name).join(" ↔ "));
    head.createEl("p", { text: `${roleLabel(session.localRole)} · ${t("nativeReview.round", { number: String(currentReviewRound(session).round) })} · ${state(session)}` });
    if (session.status === "completed") { await this.renderCompleted(container, session); return; }
    if (session.localRole === "author") await this.renderAuthor(container, session); else await this.renderReviewer(container, session);
  }
  private async renderAuthor(container: HTMLElement, session: ReviewSession): Promise<void> {
    const round = currentReviewRound(session); const section = this.section(container, t("nativeReview.authorExchange"));
    if (!round.received) { section.createEl("p", { text: t("nativeReview.state.waitingReviewer") }); this.button(section, t("nativeReview.action.resendPackage"), () => this.resend(session)); this.button(section, t("nativeReview.action.importReturn"), () => this.pickFile()); return; }
    const [analysis, decisions] = await Promise.all([loadNativeReviewAuthorAnalysis(this.app, session.reviewId), loadNativeReviewAuthorDecisionState(this.app, session.reviewId)]);
    for (const document of analysis.analyses) for (let index = 0; index < document.changes.length; index += 1) {
      const change = document.changes[index]; const item = section.createDiv({ cls: "feuillets-notes-section" }); item.createEl("strong", { text: document.title }); item.createDiv({ text: `${change.oldText} → ${change.newText}` }); item.createDiv({ cls: "feuillets-notes-sub", text: t(change.confidence === "safe" ? "nativeReview.confidence.safe" : change.confidence === "review" ? "nativeReview.confidence.review" : "nativeReview.confidence.ambiguous") });
      const decided = decisions.store.documents.find((d) => d.documentId === document.documentId)?.decisions.some((d) => d.changeIndex === index) || false;
      if (!decided) {
        if (change.confidence === "safe" && change.reason === "non-overlapping") { this.button(item, t("nativeReview.action.accept"), () => this.decide(session.reviewId, document.documentId, index, "accepted")); this.button(item, t("nativeReview.action.reject"), () => this.decide(session.reviewId, document.documentId, index, "rejected")); }
        else if (change.reason === "already-applied") this.button(item, t("nativeReview.action.accept"), () => this.decide(session.reviewId, document.documentId, index, "accepted"));
        else this.button(item, t("nativeReview.action.reject"), () => this.decide(session.reviewId, document.documentId, index, "rejected"));
        const localSourcePath = document.localSourcePath;
        if ((change.confidence === "review" || change.confidence === "ambiguous") && localSourcePath) this.button(item, t("nativeReview.action.openSheet"), () => this.open(localSourcePath));
      } else item.createDiv({ cls: "feuillets-notes-sub", text: t("nativeReview.decisionRecorded") });
    }
    await this.renderThreads(container, session, false);
    if (decisions.complete) { this.button(section, t("nativeReview.action.nextRound"), () => this.nextAuthor(session.reviewId)); this.button(section, t("nativeReview.action.complete"), () => this.complete(session.reviewId)); }
  }
  private async decide(reviewId: string, documentId: string, index: number, decision: "accepted" | "rejected"): Promise<void> { try { await decideNativeReviewAuthorChange(this.app, this.plugin.settings, reviewId, documentId, index, decision); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
  private async nextAuthor(reviewId: string): Promise<void> { try { const result = await createNativeReviewAuthorNextRound(this.app, this.plugin.settings, reviewId, version(this.plugin)); download(result.packageData, packageName(result.session)); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
  private async renderReviewer(container: HTMLElement, session: ReviewSession): Promise<void> {
    const round = currentReviewRound(session); const section = this.section(container, t("nativeReview.reviewerExchange"));
    if (round.sent) { section.createEl("p", { text: t("nativeReview.state.waitingAuthor") }); this.button(section, t("nativeReview.action.resendLastPackage"), () => this.resend(session)); this.button(section, t("nativeReview.action.importNextRound"), () => this.pickFile()); this.button(section, t("nativeReview.action.complete"), () => this.complete(session.reviewId)); return; }
    for (const document of session.documents) { const row = section.createDiv({ cls: "feuillets-notes-section" }); row.setText(document.title); if (document.localSourcePath) this.button(row, t("nativeReview.action.open"), () => this.open(document.localSourcePath!)); }
    this.button(section, t("nativeReview.action.commentSelection"), () => this.commentSelection(session)); await this.renderThreads(container, session, false); this.button(section, t("nativeReview.action.returnAuthor"), () => this.returnReviewer(session.reviewId));
  }
  private async open(path: string): Promise<void> { const file = this.app.vault.getAbstractFileByPath(path); if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file); }
  private async commentSelection(session: ReviewSession): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView); const file = view?.file; const document = session.documents.find((item) => item.localSourcePath === file?.path);
    if (!view || !file || !document) { new Notice(t("nativeReview.notice.openWorkingSelection")); return; }
    const from = view.editor.getCursor("from"); const to = view.editor.getCursor("to"); const start = view.editor.posToOffset(from); const end = view.editor.posToOffset(to); if (start === end) { new Notice(t("nativeReview.notice.selectPassage")); return; }
    new TextReviewModal(this.app, t("nativeReview.comment"), async (text) => {
      try { await addNativeReviewThread(this.app, session.reviewId, document.documentId, start, end, text); await this.render(); } catch (error) { new Notice(errorMessage(error)); }
    }).open();
  }
  private async renderThreads(container: HTMLElement, session: ReviewSession, readOnly: boolean): Promise<void> {
    const section = this.section(container, t("nativeReview.threads.title")); let threads: NativeReviewThread[];
    try { threads = (await loadNativeReviewThreads(this.app, session.reviewId)).threads; } catch { section.createEl("p", { text: t("nativeReview.threads.unreadable") }); return; }
    if (!threads.length) section.createEl("p", { text: t("nativeReview.threads.empty") });
    const names = new Map(session.participants.map((person) => [person.id, person.name]));
    for (const thread of threads) { const item = section.createDiv({ cls: "feuillets-notes-section" }); item.createDiv({ text: `« ${thread.anchor.quote} » · ${t(thread.status === "resolved" ? "nativeReview.thread.resolved" : "nativeReview.thread.open")}` }); for (const message of thread.messages) item.createDiv({ cls: "feuillets-notes-sub", text: `${names.get(message.participantId) || message.participantId} : ${message.text}` }); if (!readOnly) { const input = item.createEl("input", { type: "text", placeholder: t("nativeReview.action.reply") }); this.button(item, t("nativeReview.action.reply"), async () => { if (!input.value.trim()) return; try { await replyNativeReviewThread(this.app, session.reviewId, thread.threadId, input.value.trim()); await this.render(); } catch { new Notice(t("nativeReview.notice.threadActionFailed")); } }); this.button(item, t(thread.status === "resolved" ? "nativeReview.action.reopen" : "nativeReview.action.resolve"), async () => { try { await setNativeReviewThreadResolved(this.app, session.reviewId, thread.threadId, thread.status !== "resolved"); await this.render(); } catch { new Notice(t("nativeReview.notice.threadActionFailed")); } }); } }
  }
  private async renderCompleted(container: HTMLElement, session: ReviewSession): Promise<void> {
    const details = this.section(container, t("nativeReview.completed.details"));
    details.createEl("p", { text: `${roleLabel(session.localRole)} · ${session.participants.map((person) => person.name).join(" ↔ ")}` });
    for (const document of session.documents) details.createDiv({ cls: "feuillets-notes-section", text: document.title });
    const history = this.section(container, t("nativeReview.completed.history"));
    for (const round of session.rounds) history.createDiv({ cls: "feuillets-notes-section", text: `${t("nativeReview.round", { number: String(round.round) })} · ${t("nativeReview.completed.sent", { value: round.sent ? t("nativeReview.yes") : t("nativeReview.no") })} · ${t("nativeReview.completed.received", { value: round.received ? t("nativeReview.yes") : t("nativeReview.no") })}` });
    this.button(details, t("nativeReview.action.resendLastPackage"), () => this.resend(session));
    await this.renderThreads(container, session, true);
  }
  private async returnReviewer(reviewId: string): Promise<void> { try { const result = await createNativeReviewReviewerReturn(this.app, reviewId, version(this.plugin)); download(result.packageData, packageName(result.session)); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
  private async complete(reviewId: string): Promise<void> { try { await completeNativeReviewSession(this.app, reviewId); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
}
