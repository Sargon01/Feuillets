import { MarkdownView, Modal, Notice, Setting, TFile, TFolder, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { createNativeReviewAuthor, type AuthorReviewScope } from "../services/native-review-author.js";
import { createNativeReviewAuthorNextRound } from "../services/native-review-author-next-round.js";
import { decideNativeReviewAuthorChange, loadNativeReviewAuthorDecisionState } from "../services/native-review-author-decisions.js";
import { loadNativeReviewAuthorAnalysis } from "../services/native-review-author-return.js";
import { completeNativeReviewSession, listNativeReviewSessions, receiveNativeReviewExchange, type NativeReviewSessionEntry } from "../services/native-review-exchange.js";
import { createNativeReviewReviewerReturn } from "../services/native-review-reviewer-return.js";
import { loadNativeReviewThreads, addNativeReviewThread, replyNativeReviewThread, setNativeReviewThreadResolved, type NativeReviewThread } from "../services/native-review-threads.js";
import { currentReviewRound, reviewRoundsRootPath, type ReviewSession } from "../services/native-review-session.js";

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
function packageName(session: ReviewSession): string { const round = currentReviewRound(session); return `relecture-${session.reviewId}-tour-${round.round}-${session.localRole === "author" ? "auteur" : "relecteur"}.feuillets`; }
function state(session: ReviewSession): string {
  if (session.status === "completed") return "Terminé";
  const round = currentReviewRound(session);
  if (session.localRole === "author") return round.received ? "À traiter" : "En attente";
  return round.sent ? "En attente" : "À envoyer";
}

class NewReviewModal extends Modal {
  constructor(app: App, private readonly onSubmit: (author: string, reviewer: string, scope: "file" | "folder" | "project") => Promise<void>) { super(app); }
  onOpen(): void {
    let author = ""; let reviewer = ""; let scope: "file" | "folder" | "project" = "file";
    this.contentEl.createEl("h3", { text: "Nouvelle relecture collaborative" });
    new Setting(this.contentEl).setName("Nom auteur").addText((input) => input.onChange((value) => { author = value; }));
    new Setting(this.contentEl).setName("Nom relecteur").addText((input) => input.onChange((value) => { reviewer = value; }));
    new Setting(this.contentEl).setName("Portée").addDropdown((input) => input
      .addOption("file", "Ce feuillet").addOption("folder", "Ce dossier").addOption("project", "Tout le projet")
      .onChange((value) => { scope = value as typeof scope; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Créer et télécharger").setCta().onClick(() => {
      void this.onSubmit(author, reviewer, scope).then(() => this.close());
    }));
  }
}

class TextReviewModal extends Modal {
  constructor(app: App, private readonly title: string, private readonly onSubmit: (text: string) => Promise<void>) { super(app); }
  onOpen(): void {
    let text = ""; this.contentEl.createEl("h3", { text: this.title });
    new Setting(this.contentEl).setName(this.title).addText((input) => input.onChange((value) => { text = value; }));
    new Setting(this.contentEl).addButton((button) => button.setButtonText("Envoyer").setCta().onClick(() => { if (text.trim()) void this.onSubmit(text.trim()).then(() => this.close()); }));
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
    const actions = this.section(container, "Relecture collaborative");
    this.button(actions, "Nouvelle relecture", () => new NewReviewModal(this.app, async (author, reviewer, scope) => this.create(author, reviewer, scope)).open(), "plus");
    this.button(actions, "Importer un paquet .feuillets", () => this.pickFile(), "upload");
    const list = this.section(container, "Sessions existantes");
    let sessions: NativeReviewSessionEntry[];
    try { sessions = await listNativeReviewSessions(this.app); } catch (error) { list.createEl("p", { text: errorMessage(error) }); return; }
    if (!sessions.length) list.createEl("p", { text: "Aucune session de relecture." });
    for (const item of sessions) {
      const row = list.createDiv({ cls: "feuillets-notes-section feuillets-clickable" });
      if (item.error) { row.setText(`${item.reviewId} — ${item.error}`); continue; }
      const session = item.session;
      if (!session) { row.setText(`${item.reviewId} — Session illisible`); continue; }
      const names = session.participants.map((person) => person.name).join(" ↔ ");
      row.createDiv({ text: names }); row.createDiv({ cls: "feuillets-notes-sub", text: `${session.localRole === "author" ? "Auteur" : "Relecteur"} · tour ${currentReviewRound(session).round} · ${state(session)} · ${session.documents.length} documents` });
      row.addEventListener("click", () => { this.selectedReviewId = session.reviewId; void this.render(); });
    }
  }
  private async create(authorName: string, reviewerName: string, choice: "file" | "folder" | "project"): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    let scope: AuthorReviewScope;
    if (choice === "project") scope = { type: "project" };
    else if (!active || active.extension !== "md") { new Notice("Ouvrez un feuillet du manuscrit avant de créer une relecture."); return; }
    else if (choice === "folder") { const parent = active.parent; if (!(parent instanceof TFolder)) { new Notice("Le dossier du feuillet est invalide."); return; } scope = { type: "folder", path: parent.path }; }
    else scope = { type: "file", path: active.path };
    try { const result = await createNativeReviewAuthor(this.app, this.plugin.settings, { authorName, reviewerName, scope, createdByVersion: version(this.plugin) }); this.selectedReviewId = result.session.reviewId; download(result.packageData, packageName(result.session)); await this.render(); }
    catch (error) { new Notice(errorMessage(error)); }
  }
  private pickFile(): void {
    const input = document.body.createEl("input"); input.type = "file"; input.accept = ".feuillets";
    input.addEventListener("change", () => { const file = input.files?.[0]; if (file) void this.receive(file); }); input.click();
  }
  private async receive(file: File): Promise<void> {
    try { const session = await receiveNativeReviewExchange(this.app, await file.arrayBuffer()); this.selectedReviewId = session.reviewId; new Notice("Paquet de relecture importé."); await this.render(); }
    catch (error) { new Notice(errorMessage(error)); }
  }
  private async resend(session: ReviewSession): Promise<void> {
    const round = currentReviewRound(session); const path = `${reviewRoundsRootPath(session.reviewId)}/round-${round.round}-sent.feuillets`; const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice("Archive du dernier paquet introuvable."); return; }
    download(await this.app.vault.readBinary(file), packageName(session));
  }
  private async renderDetail(container: HTMLElement, reviewId: string): Promise<void> {
    const back = container.createDiv({ cls: "feuillets-notes-back-bar" }); this.button(back, "Relecture", () => { this.selectedReviewId = null; return this.render(); }, "arrow-left");
    const loaded = (await listNativeReviewSessions(this.app)).find((item) => item.reviewId === reviewId);
    if (!loaded?.session) { container.createEl("p", { text: loaded?.error || "Session introuvable." }); return; }
    const session = loaded.session; const head = this.section(container, session.participants.map((p) => p.name).join(" ↔ "));
    head.createEl("p", { text: `${session.localRole === "author" ? "Auteur" : "Relecteur"} · tour ${currentReviewRound(session).round} · ${state(session)}` });
    if (session.status === "completed") { this.button(head, "Renvoyer le dernier paquet", () => this.resend(session)); await this.renderThreads(container, session, true); return; }
    if (session.localRole === "author") await this.renderAuthor(container, session); else await this.renderReviewer(container, session);
  }
  private async renderAuthor(container: HTMLElement, session: ReviewSession): Promise<void> {
    const round = currentReviewRound(session); const section = this.section(container, "Échange auteur");
    if (!round.received) { section.createEl("p", { text: "En attente du relecteur" }); this.button(section, "Renvoyer le paquet", () => this.resend(session)); this.button(section, "Importer un retour", () => this.pickFile()); return; }
    const [analysis, decisions] = await Promise.all([loadNativeReviewAuthorAnalysis(this.app, session.reviewId), loadNativeReviewAuthorDecisionState(this.app, session.reviewId)]);
    for (const document of analysis.analyses) for (let index = 0; index < document.changes.length; index += 1) {
      const change = document.changes[index]; const item = section.createDiv({ cls: "feuillets-notes-section" }); item.createEl("strong", { text: document.title }); item.createDiv({ text: `${change.oldText} → ${change.newText}` }); item.createDiv({ cls: "feuillets-notes-sub", text: change.confidence === "safe" ? "Sûr" : change.confidence === "review" ? "À vérifier" : "Ambigu" });
      const decided = decisions.store.documents.find((d) => d.documentId === document.documentId)?.decisions.some((d) => d.changeIndex === index) || false;
      if (!decided) {
        if (change.confidence === "safe" && change.reason === "non-overlapping") this.button(item, "Accepter", () => this.decide(session.reviewId, document.documentId, index, "accepted"));
        if (change.reason === "already-applied") this.button(item, "Accepter", () => this.decide(session.reviewId, document.documentId, index, "accepted"));
        this.button(item, "Refuser", () => this.decide(session.reviewId, document.documentId, index, "rejected"));
        const localSourcePath = document.localSourcePath;
        if (change.confidence !== "safe" && localSourcePath) this.button(item, "Ouvrir le feuillet", () => this.open(localSourcePath));
      } else item.createDiv({ cls: "feuillets-notes-sub", text: "Décision enregistrée" });
    }
    await this.renderThreads(container, session, false);
    if (decisions.complete) { this.button(section, "Nouveau tour", () => this.nextAuthor(session.reviewId)); this.button(section, "Terminer", () => this.complete(session.reviewId)); }
  }
  private async decide(reviewId: string, documentId: string, index: number, decision: "accepted" | "rejected"): Promise<void> { try { await decideNativeReviewAuthorChange(this.app, this.plugin.settings, reviewId, documentId, index, decision); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
  private async nextAuthor(reviewId: string): Promise<void> { try { const result = await createNativeReviewAuthorNextRound(this.app, this.plugin.settings, reviewId, version(this.plugin)); download(result.packageData, packageName(result.session)); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
  private async renderReviewer(container: HTMLElement, session: ReviewSession): Promise<void> {
    const round = currentReviewRound(session); const section = this.section(container, "Échange relecteur");
    if (round.sent) { section.createEl("p", { text: "En attente de l’auteur" }); this.button(section, "Renvoyer le dernier paquet", () => this.resend(session)); this.button(section, "Importer le tour suivant", () => this.pickFile()); this.button(section, "Terminer", () => this.complete(session.reviewId)); return; }
    for (const document of session.documents) { const row = section.createDiv({ cls: "feuillets-notes-section" }); row.setText(document.title); if (document.localSourcePath) this.button(row, "Ouvrir", () => this.open(document.localSourcePath!)); }
    this.button(section, "Commenter la sélection", () => this.commentSelection(session)); await this.renderThreads(container, session, false); this.button(section, "Renvoyer à l’auteur", () => this.returnReviewer(session.reviewId));
  }
  private async open(path: string): Promise<void> { const file = this.app.vault.getAbstractFileByPath(path); if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file); }
  private async commentSelection(session: ReviewSession): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView); const file = view?.file; const document = session.documents.find((item) => item.localSourcePath === file?.path);
    if (!view || !file || !document) { new Notice("Ouvrez un document de travail de cette session et sélectionnez du texte."); return; }
    const from = view.editor.getCursor("from"); const to = view.editor.getCursor("to"); const start = view.editor.posToOffset(from); const end = view.editor.posToOffset(to); if (start === end) { new Notice("Sélectionnez un passage à commenter."); return; }
    new TextReviewModal(this.app, "Commentaire", async (text) => {
      try { await addNativeReviewThread(this.app, session.reviewId, document.documentId, start, end, text); await this.render(); } catch (error) { new Notice(errorMessage(error)); }
    }).open();
  }
  private async renderThreads(container: HTMLElement, session: ReviewSession, readOnly: boolean): Promise<void> {
    const section = this.section(container, "Commentaires"); let threads: NativeReviewThread[]; try { threads = (await loadNativeReviewThreads(this.app, session.reviewId)).threads; } catch { threads = []; }
    if (!threads.length) section.createEl("p", { text: "Aucun commentaire." });
    const names = new Map(session.participants.map((person) => [person.id, person.name]));
    for (const thread of threads) { const item = section.createDiv({ cls: "feuillets-notes-section" }); item.createDiv({ text: `« ${thread.anchor.quote} » · ${thread.status === "resolved" ? "résolu" : "ouvert"}` }); for (const message of thread.messages) item.createDiv({ cls: "feuillets-notes-sub", text: `${names.get(message.participantId) || message.participantId} : ${message.text}` }); if (!readOnly) { const input = item.createEl("input", { type: "text", placeholder: "Répondre" }); this.button(item, "Répondre", async () => { if (!input.value.trim()) return; await replyNativeReviewThread(this.app, session.reviewId, thread.threadId, input.value.trim()); await this.render(); }); this.button(item, thread.status === "resolved" ? "Rouvrir" : "Résoudre", async () => { await setNativeReviewThreadResolved(this.app, session.reviewId, thread.threadId, thread.status !== "resolved"); await this.render(); }); } }
  }
  private async returnReviewer(reviewId: string): Promise<void> { try { const result = await createNativeReviewReviewerReturn(this.app, reviewId, version(this.plugin)); download(result.packageData, packageName(result.session)); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
  private async complete(reviewId: string): Promise<void> { try { await completeNativeReviewSession(this.app, reviewId); await this.render(); } catch (error) { new Notice(errorMessage(error)); } }
}
