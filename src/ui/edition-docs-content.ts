import { ConfirmModal, NewFolderModal, RenameFileModal } from "./basic-modals.js";
import { isEditorialMarkdown, isEditorialSourceFolder, isEditorialWorkFolder } from "../services/editorial-document.js";
import { createFileScope } from "../services/compile-scope.js";
import { openScopeWithPreviewBesideLeaf } from "../views/preview-view.js";
import { Menu, Modal, Notice, SuggestModal, TFile, TFolder, normalizePath, setIcon, setTooltip, type App } from "obsidian";
import { t, getLocale } from "../i18n/index.js";
import { getEditionRoot, editionFolderPath } from "../services/folder-structure.js";
import { ensureEditionFolder, EDITION_DOCUMENTS, editionDocumentForName } from "../services/project-files.js";
import { openFileActivating } from "../utils/dom.js";
import { prepareSubmission, openEditorialPacketComposer, getCourrierApi, listCourrierProjectSubmissions, type SubmissionHost, type ProjectSubmissionSummary } from "../services/courrier-integration.js";

type FileExplorerInstance = { revealInFolder?(file: TFile | TFolder): void };
type AppWithInternalPlugins = App & {
  internalPlugins?: { getPluginById?(id: string): { instance?: FileExplorerInstance } | undefined };
};

/** Révèle un fichier dans l'explorateur natif d'Obsidian (pas le Binder de
 * Feuillets) — même geste que le clic droit "Afficher dans l'explorateur"
 * natif. Silencieux si le plugin natif file-explorer est indisponible ou
 * désactivé plutôt que de lever une erreur : ce n'est jamais l'action
 * principale du bouton (ouvrir l'est), juste un raccourci de confort. */
export function revealInFileExplorer(app: App, file: TFile | TFolder): boolean {
  const instance = (app as AppWithInternalPlugins).internalPlugins?.getPluginById?.("file-explorer")?.instance;
  if (!instance?.revealInFolder) return false;
  instance.revealInFolder(file);
  return true;
}

/** Modale minimale à un seul champ — nom du nouveau document à créer
 * directement à la racine du dossier Edition (mêmes conventions que
 * NewFolderModal, basic-modals.ts, mais pour un fichier .md plutôt qu'un
 * dossier). */
class NewEditionDocumentModal extends Modal {
  onSubmit: (name: string) => void;

  constructor(app: App, onSubmit: (name: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: t("editionDocs.newDocumentModalTitle") });
    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: t("editionDocs.newDocumentPlaceholder"),
    });
    input.addClass("feuillets-input-full");
    input.focus();
    const submit = (): void => {
      const name = input.value.trim();
      if (!name) return;
      this.close();
      this.onSubmit(name);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      submit();
    });
    const btn = contentEl.createEl("button", { cls: "mod-cta", text: t("editionDocs.createDocumentSubmit") });
    btn.addEventListener("click", submit);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class SubmissionSentModal extends Modal {
  constructor(
    app: App,
    private onConfirm: (dates: { dateEnvoi: string; dateRelance?: string }) => Promise<void>
  ) { super(app); }

  onOpen(): void {
    this.contentEl.createEl("h3", { text: t("editionDocs.submission.markSent") });
    const today = new Date().toISOString().slice(0, 10);
    const sentLabel = this.contentEl.createEl("label", { cls: "feuillets-submission-date-field", text: t("editionDocs.submission.sentDate") });
    const sentInput = sentLabel.createEl("input", { type: "date" });
    sentInput.value = today;
    const reminderLabel = this.contentEl.createEl("label", { cls: "feuillets-submission-date-field", text: t("editionDocs.submission.followUpDate") });
    const reminderInput = reminderLabel.createEl("input", { type: "date" });
    const actions = this.contentEl.createDiv({ cls: "feuillets-submission-modal-actions" });
    actions.createEl("button", { text: t("editionDocs.submission.cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("editionDocs.submission.confirm") }).addEventListener("click", () => {
      if (!sentInput.value) {
        new Notice(t("editionDocs.submission.sentDateRequired"));
        return;
      }
      void this.onConfirm({
        dateEnvoi: sentInput.value,
        ...(reminderInput.value ? { dateRelance: reminderInput.value } : {}),
      }).then(() => this.close());
    });
  }

  onClose(): void { this.contentEl.empty(); }
}

export type EditionDocsContentPlugin = SubmissionHost & {
  settings: FeuilletsSettings;
  getProjectFolder(): TFolder | null;
  saveSettings(): Promise<void>;
};

class EditorialDestinationModal extends SuggestModal<TFolder> {
  constructor(app: App, private folders: TFolder[], private move: (folder: TFolder) => Promise<void>) {
    super(app);
    this.setPlaceholder(t("export.save.folder"));
  }

  getSuggestions(query: string): TFolder[] {
    return this.folders.filter(folder => folder.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  }

  renderSuggestion(folder: TFolder, element: HTMLElement): void {
    element.setText(folder.path);
  }

  onChooseSuggestion(folder: TFolder): void {
    void this.move(folder);
  }
}

export class EditionDocsContent {
  private renderGeneration = 0;
  private submissionDisclosure = new Map<string, boolean>();
  constructor(
    private app: App,
    private plugin: EditionDocsContentPlugin,
    private container: HTMLElement,
  ) {}

  /** Réattache le composant à un nouveau conteneur — l'hôte reconstruit son
   * DOM à chaque rendu, l'instance et son état (dossiers repliés, via les
   * réglages) survivent. */
  attach(container: HTMLElement): void {
    this.container = container;
  }

  updateActiveFile(): void {
    const path = this.app.workspace.getActiveFile()?.path;
    for (const row of Array.from(this.container.querySelectorAll<HTMLElement>("[data-editorial-path]"))) {
      row.toggleClass("is-active", row.getAttribute("data-editorial-path") === path);
    }
  }

  private isFolderCollapsed(folderPath: string): boolean {
    const S = this.plugin.settings;
    const collapseKey = `editionDocsFolder:${folderPath}`;
    const stored = S.collapsed[collapseKey];
    // Folders start closed (collapsed) by default unless explicitly opened (stored as false)
    return stored !== false;
  }

  private toggleFolderCollapse(folderPath: string): void {
    const S = this.plugin.settings;
    const collapseKey = `editionDocsFolder:${folderPath}`;
    const isCurrentlyCollapsed = this.isFolderCollapsed(folderPath);
    if (isCurrentlyCollapsed) {
      // Open folder: store false to override the default
      S.collapsed[collapseKey] = false;
    } else {
      // Close folder: store true
      S.collapsed[collapseKey] = true;
    }
    void this.plugin.saveSettings();
  }

  private iconBtn(parent: HTMLElement, icon: string, tooltip: string, onClick?: (e: MouseEvent) => void | Promise<void>): HTMLElement {
    const btn = parent.createEl("button", { cls: "clickable-icon" });
    setIcon(btn, icon);
    setTooltip(btn, tooltip);
    btn.setAttr("aria-label", tooltip);
    if (onClick) btn.addEventListener("click", (e) => { void onClick(e); });
    return btn;
  }

  async render(): Promise<void> {
    const generation = ++this.renderGeneration;
    const container = this.container;
    container.empty();
    container.addClass("feuillets-edition-docs-container");

    const section = container.createDiv({ cls: "feuillets-project-section feuillets-editorial-tree" });
    const header = section.createDiv({ cls: "feuillets-section-head" });
    header.createSpan({ cls: "feuillets-section-title-text", text: t("sidebar.edition.editorialFolder") });

    const root = this.plugin.getProjectFolder();
    if (!root) {
      section.createDiv({ cls: "feuillets-empty" }).setText(t("board.noProjectFolder"));
      return;
    }

    const editionRoot = getEditionRoot(this.app, root);
    if (!editionRoot) {
      this.renderCreatePrompt(section, root);
      return;
    }

    this.renderToolbar(header, editionRoot);
    const summaries = await listCourrierProjectSubmissions(this.app, editionRoot.path);
    if (generation !== this.renderGeneration) return;
    this.renderFolderEntries(section, editionRoot, editionRoot, 0, summaries !== null);
    this.updateActiveFile();
    if (summaries?.length) this.renderSubmissionSummaries(section, editionRoot, summaries);
  }

  private renderCreatePrompt(section: HTMLElement, root: TFolder): void {
    const body = section.createDiv({ cls: "feuillets-edition-docs-empty" });
    body.createEl("p", { text: t("editionDocs.notCreatedBody") });
    const btn = body.createEl("button", { cls: "mod-cta", text: t("editionDocs.createFolder") });
    btn.addEventListener("click", () => {
      void (async () => {
        await ensureEditionFolder(this.app, root);
        await this.render();
      })();
    });
  }

  private renderToolbar(section: HTMLElement, editionRoot: TFolder): void {
    const toolbar = section.createDiv({ cls: "feuillets-project-actions" });
    this.iconBtn(toolbar, "file-plus", t("editionDocs.newDocument"), () => {
      new NewEditionDocumentModal(this.app, (name) => {
        void this.createDocument(editionRoot, name);
      }).open();
    });
    this.iconBtn(toolbar, "folder-plus", t("editionDocs.newFolder"), () => this.newFolder(editionRoot));
    this.iconBtn(toolbar, "files", t("packet.compose"), () => openEditorialPacketComposer(this.plugin, path => {
      void this.showSubmission(editionRoot, path);
    }));
    const courrier = getCourrierApi(this.app);
    if (!courrier || courrier.openSubmissionPacket) return;
    // Même parcours que la commande de palette "prepare-submission" (voir
    // main.ts) — un simple raccourci visible ici, pas un second chemin
    // (Lot 14D, demande explicite : bouton visible en plus de la
    // commande, jamais à sa place).
    this.iconBtn(toolbar, "send", t("courrier.attachments.submitButton"), () => {
      void prepareSubmission(this.plugin);
    });
  }

  /** Le suivi Courrier remplace les dossiers techniques dans ce panneau. */
  private renderSubmissionSummaries(section: HTMLElement, editionRoot: TFolder, summaries: ProjectSubmissionSummary[]): void {
    const wrapper = section.createEl("details", { cls: "feuillets-submission-summary" });
    wrapper.open = this.submissionDisclosure.get(editionRoot.path) ?? true;
    wrapper.createEl("summary", { cls: "feuillets-submission-summary-title", text: t("editionDocs.submission.tracking") });
    wrapper.addEventListener("toggle", () => {
      if (wrapper.isConnected) this.submissionDisclosure.set(editionRoot.path, wrapper.open);
    });
    for (const summary of summaries) this.renderSubmissionCard(wrapper, editionRoot.path, summary);
  }

  private renderSubmissionCard(parent: HTMLElement, editionPath: string, summary: ProjectSubmissionSummary): void {
    const recipient = summary.recipient;
    const statusValue = summary.status;
    const status = statusValue === "Envoyé" ? t("editionDocs.submission.sent") : statusValue === "Brouillon" ? t("editionDocs.submission.draft") : statusValue;
    const sentDate = summary.sentDate ?? "";
    const reminderDate = summary.reminderDate ?? "";
    const manuscriptReady = summary.manuscriptDocxReady;
    const letterReady = summary.letterDocxReady;
    const missing = summary.missingFiles ?? [
      !manuscriptReady ? t("editionDocs.submission.missingManuscriptDocx") : "",
      !letterReady ? t("editionDocs.submission.missingLetterDocx") : "",
    ].filter(Boolean);

    const path = summary.recordPath ?? summary.letterPath;
    const row = parent.createDiv({ cls: "feuillets-project-row feuillets-submission-row" });
    if (path) row.setAttr("data-submission-path", path);
    const openNote = () => {
      const letter = this.submissionLetterFile(path);
      if (!letter) return new Notice(t("editionDocs.submission.letterMissing"));
      void openFileActivating(this.app, this.app.workspace.getLeaf(false), letter);
    };
    const openFolder = () => {
      if (summary.folderPath && this.revealSubmissionFolder(summary.folderPath)) return;
      const letter = this.submissionLetterFile(path);
      if (!letter || !revealInFileExplorer(this.app, letter)) new Notice(t("editionDocs.submission.explorerUnavailable"));
    };
    const openPacket = () => {
      void this.runSubmissionApiAction(path, summary.missingFiles ? "openSubmissionPacket" : "exportSubmissionDocx");
    };
    const rowButton = row.createEl("button", { cls: "feuillets-submission-row-main" });
    rowButton.addEventListener("click", openNote);
    const who = rowButton.createSpan({ cls: "feuillets-project-row-label", text: recipient });
    setTooltip(who, recipient);
    const details = rowButton.createSpan({ cls: "feuillets-submission-row-details" });
    const dateLabels = [
      sentDate ? t("editionDocs.submission.sentOn", { date: sentDate }) : "",
      reminderDate ? t("editionDocs.submission.followUpOn", { date: reminderDate }) : "",
    ].filter(Boolean);
    details.createSpan({ text: [status, sentDate || reminderDate].filter(Boolean).join(" · ") });
    if (dateLabels.length) {
      details.setAttr("aria-label", [status, ...dateLabels].join(" · "));
      setTooltip(details, dateLabels.join(" · "));
    }
    const reminder = this.reminderBadge(reminderDate);
    const warning = [
      missing.length ? t("editionDocs.submission.missing", { documents: missing.join(", ") }) : "",
      reminder?.text ?? "",
    ].filter(Boolean).join(" · ");
    if (warning) {
      const icon = details.createSpan({ cls: "feuillets-submission-row-warning", attr: { role: "img", "aria-label": warning } });
      setIcon(icon, "triangle-alert");
      setTooltip(icon, warning);
    }
    const showActions = (event: MouseEvent) => {
      event.preventDefault();
      const menu = new Menu();
      const add = (label: string, icon: string, run: () => void) =>
        menu.addItem(item => item.setTitle(label).setIcon(icon).onClick(run));
      if (path) add(t(summary.recordPath ? "editionDocs.submission.openRecord" : "editionDocs.submission.openLetter"), "file-text", openNote);
      add(t("editionDocs.submission.openFolder"), "folder-open", openFolder);
      add(summary.missingFiles ? t("packet.preview") : t("editionDocs.submission.export"), "file-output", openPacket);
      const archive = summary.archivePath;
      if (archive) add(t("editionDocs.submission.openArchive"), "archive", () => {
        if (!this.revealSubmissionFolder(archive)) new Notice(t("editionDocs.submission.explorerUnavailable"));
      });
      if (summary.missingFiles) add(t("packet.duplicateSubmission"), "copy", () => {
        void this.runSubmissionApiAction(path, "duplicateSubmission");
      });
      if (!sentDate && statusValue !== "Envoyé" && path) add(t("editionDocs.submission.markSent"), "send", () => {
        void this.openSubmissionSentModal(editionPath, path);
      });
      this.showItemMenu(menu, event);
    };
    this.iconBtn(row, "ellipsis", t("editionDocs.submission.actions"), showActions);
    row.addEventListener("contextmenu", showActions);
  }

  private async openSubmissionSentModal(editionPath: string, path: string): Promise<void> {
    const summaries = await listCourrierProjectSubmissions(this.app, editionPath);
    const current = summaries?.find(summary => (summary.recordPath ?? summary.letterPath) === path);
    if (!current) {
      new Notice(t("editionDocs.submission.actionFailed"));
      return;
    }
    if (current.dossierReady === false) {
      new Notice(t("editionDocs.submission.missing", { documents: (current.missingFiles ?? []).join(", ") }));
      return;
    }
    if (current.status === "Envoyé" || current.sentDate) return;
    new SubmissionSentModal(this.app, dates => this.runSubmissionApiAction(path, "markSubmissionAsSent", dates)).open();
  }

  private async showSubmission(edition: TFolder, path: string): Promise<void> {
    this.submissionDisclosure.set(edition.path, true);
    await this.render();
    const card = Array.from(this.container.querySelectorAll<HTMLElement>("[data-submission-path]"))
      .find(node => node.getAttribute("data-submission-path") === path);
    card?.scrollIntoView({ block: "nearest" });
    card?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }

  private revealSubmissionFolder(path: string): boolean {
    const rows = () => Array.from(this.container.querySelectorAll<HTMLElement>("[data-editorial-folder-path]"));
    for (const row of path.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"))) {
      const ancestor = rows().find(node => node.getAttribute("data-editorial-folder-path") === row);
      if (ancestor?.getAttribute("aria-expanded") === "false") ancestor.click();
    }
    const target = rows().find(node => node.getAttribute("data-editorial-folder-path") === path);
    target?.scrollIntoView({ block: "nearest" });
    target?.focus({ preventScroll: true });
    if (target) return true;
    const folder = this.app.vault.getAbstractFileByPath(path);
    return folder instanceof TFolder && revealInFileExplorer(this.app, folder);
  }

  private submissionLetterFile(letterPath: string | undefined): TFile | null {
    if (!letterPath) return null;
    const file = this.app.vault.getAbstractFileByPath(letterPath);
    return file instanceof TFile ? file : null;
  }

  private async runSubmissionApiAction(
    letterPath: string | undefined,
    action: "exportSubmissionDocx" | "markSubmissionAsSent" | "openSubmissionPacket" | "duplicateSubmission",
    dates?: { dateEnvoi?: string; dateRelance?: string }
  ): Promise<void> {
    if (!letterPath) {
      new Notice(t("editionDocs.submission.letterMissing"));
      return;
    }
    const api = getCourrierApi(this.app);
    const available = typeof api?.[action] === "function";
    if (!api || !available) {
      new Notice(t("editionDocs.submission.courrierUnavailable"));
      return;
    }
    try {
      const result = action === "markSubmissionAsSent"
        ? await api.markSubmissionAsSent?.(letterPath, dates)
        : await api[action]?.(letterPath);
      if (!result) return;
      if (!result.success) new Notice(result.message || t("editionDocs.submission.actionFailed"));
      await this.render();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("editionDocs.submission.actionFailed"));
    }
  }

  private reminderBadge(date: string): { text: string; kind: "due" | "late" } | null {
    if (!date) return null;
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (date < todayIso) return { text: t("editionDocs.submission.overdue"), kind: "late" };
    if (date === todayIso) return { text: t("editionDocs.submission.followUpDue"), kind: "due" };
    return null;
  }

  private async withName(folder: TFolder, name: string, write: (path: string) => Promise<void>): Promise<void> {
    if (name === "." || name === ".." || /[\\/:*?"<>|]/u.test(name)) {
      new Notice(t("editionDocs.invalidName"));
      return;
    }
    const path = normalizePath(`${folder.path}/${name}`);
    try {
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(t("editionDocs.alreadyExists"));
        return;
      }
      await write(path);
      await this.render();
    } catch (error) {
      new Notice(t("editionDocs.operationFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  private newFolder(folder: TFolder): void {
    new NewFolderModal(this.app, folder.name, name =>
      this.withName(folder, name, async path => { await this.app.vault.createFolder(path); })
    ).open();
  }

  private async createDocument(folder: TFolder, name: string): Promise<void> {
    const title = name.replace(/\.md$/iu, "").trim();
    if (!title || title === "." || title === "..") { new Notice(t("editionDocs.invalidName")); return; }
    await this.withName(folder, `${title}.md`, async path => {
      const file = await this.app.vault.create(path, `# ${title}\n\n`);
      await this.openFile(file);
    });
  }

  private openFile(file: TFile): Promise<void> {
    return openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
  }

  private async openPreview(file: TFile): Promise<void> {
    const project = this.plugin.getProjectFolder();
    if (!project) return;
    await this.openFile(file);
    const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    if (leaf) await openScopeWithPreviewBesideLeaf(this.app, createFileScope(project.path, file.path), leaf);
  }

  private canManage(node: TFile | TFolder, root: TFolder): boolean {
    if (node instanceof TFolder) return isEditorialWorkFolder(root, node.path)
      && node.children.every(child => !(child instanceof TFolder) || this.canManage(child, root));
    return !!node.parent && isEditorialWorkFolder(root, node.parent.path) && /^(md|pdf|docx)$/iu.test(node.extension);
  }

  private moveEditorialItem(node: TFile | TFolder, root: TFolder): void {
    const folders: TFolder[] = [];
    const collect = (folder: TFolder) => {
      if (folder === node || !isEditorialWorkFolder(root, folder.path)) return;
      if (folder !== node.parent) folders.push(folder);
      for (const child of folder.children) if (child instanceof TFolder) collect(child);
    };
    collect(root);
    if (!folders.length) { new Notice(t("editionDocs.noDestination")); return; }
    new EditorialDestinationModal(this.app, folders, async folder => {
      if (!this.canManage(node, root) || !isEditorialWorkFolder(root, folder.path)
        || folder === node || folder.path.startsWith(node.path + "/")) return;
      await this.withName(folder, node.name, path => this.app.fileManager.renameFile(node, path));
    }).open();
  }

  private addItemManagement(menu: Menu, node: TFile | TFolder, root: TFolder): void {
    if (!this.canManage(node, root)) return;
    menu.addItem(item => item.setTitle(t("shared.contextMenu.rename")).setIcon("pencil").onClick(() => {
      const parent = node.parent;
      if (!parent) return;
      const file = node instanceof TFile ? node : null;
      new RenameFileModal(this.app, file?.basename ?? node.name, name => {
        const extension = file ? "." + file.extension : "";
        const base = (extension && name.toLowerCase().endsWith(extension.toLowerCase()) ? name.slice(0, -extension.length) : name).trim();
        if (!base || base === "." || base === "..") { new Notice(t("editionDocs.invalidName")); return; }
        return this.withName(parent, base + extension, async path => {
          if (!this.canManage(node, root) || !isEditorialWorkFolder(root, path)) throw new Error(t("editionDocs.invalidName"));
          await this.app.fileManager.renameFile(node, path);
        });
      }).open();
    }));
    menu.addItem(item => item.setTitle(t("shared.contextMenu.move")).setIcon("folder-input").onClick(() => this.moveEditorialItem(node, root)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle(t("shared.contextMenu.trashFolder")).setIcon("trash").onClick(() => {
      new ConfirmModal(this.app, t("shared.contextMenu.trashFolder"),
        t("editionDocs.confirmTrash", { file: node.name }), t("shared.contextMenu.trashFolder"), async () => {
          if (!this.canManage(node, root)) return;
          try {
            await this.app.fileManager.trashFile(node);
            await this.render();
          } catch (error) {
            new Notice(t("editionDocs.operationFailed", { message: error instanceof Error ? error.message : String(error) }));
          }
        }
      ).open();
    }));
  }

  private showItemMenu(menu: Menu, event: MouseEvent): void {
    if (event.type === "click" && event.currentTarget instanceof HTMLElement) {
      const bounds = event.currentTarget.getBoundingClientRect();
      menu.setUseNativeMenu(false).showAtPosition({ x: bounds.right, y: bounds.bottom });
    } else {
      menu.showAtMouseEvent(event);
    }
  }

  private fileMenu(event: MouseEvent, file: TFile, root: TFolder): void {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem(item => item.setTitle(t("editionDocs.revealTooltip")).setIcon("folder-open").onClick(() => {
      if (!revealInFileExplorer(this.app, file)) new Notice(t("editionDocs.revealUnavailable"));
    }));
    if (isEditorialMarkdown(file, root)) {
      menu.addItem(item => item.setTitle(t("shared.contextMenu.openWithPreview")).setIcon("eye").onClick(() => this.openPreview(file)));
    }
    this.addItemManagement(menu, file, root);
    this.showItemMenu(menu, event);
  }

  /** Trie enfants avec documents conventionnels en premier (ordre spécifié),
   * puis dossiers alphabétiquement (Soumissions, Versions envoyées...). */
  private sortChildren(children: (TFile | TFolder)[]): (TFile | TFolder)[] {
    const files = children.filter((c) => c instanceof TFile);
    const folders = children.filter((c) => c instanceof TFolder);

    // Trier fichiers selon DOCUMENT_SORT_ORDER, puis alphabétiquement
    files.sort((a, b) => {
      const aIdx = EDITION_DOCUMENTS.findIndex((document) => editionDocumentForName(a.name)?.id === document.id);
      const bIdx = EDITION_DOCUMENTS.findIndex((document) => editionDocumentForName(b.name)?.id === document.id);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.name.localeCompare(b.name, getLocale());
    });

    // Trier dossiers alphabétiquement
    folders.sort((a, b) => a.name.localeCompare(b.name, getLocale()));

    return [...files, ...folders];
  }

  /** Affiche contenu d'un dossier — les dossiers sont repliables. Les
   * fichiers sont cliquables. Le message "vide" n'apparaît que si un
   * dossier est ouvert et vide (pas rendu pour les dossiers fermés). */
  private renderFolderEntries(parent: HTMLElement, folder: TFolder, root: TFolder, depth = 0, tracked = false): void {
    const children = this.sortChildren(folder.children as (TFile | TFolder)[]).filter(child =>
      !tracked || !(child instanceof TFolder) || !["Soumissions", "Versions envoyées"].includes(child.name));
    if (children.length === 0) {
      parent.createDiv({ cls: "feuillets-empty" }).setText(t("editionDocs.emptyFolder"));
      return;
    }
    const list = parent.createDiv({ cls: "feuillets-project-list" });
    for (const child of children) {
      if (child instanceof TFolder) {
        this.renderFolderRow(list, child, root, depth);
      } else if (child instanceof TFile) {
        this.renderFileRow(list, child, root, depth);
      }
    }
  }

  /** Dossier cliquable : clique ouvre/ferme, chevron indique l'état. */
  private renderFolderRow(parent: HTMLElement, folder: TFolder, root: TFolder, depth: number): void {
    const row = parent.createDiv({ cls: "feuillets-project-row feuillets-edition-folder-row" });
    row.style.paddingLeft = `${6 + depth * 16}px`;
    const isCollapsed = this.isFolderCollapsed(folder.path);
    row.setAttr("role", "button");
    row.setAttr("tabindex", "0");
    row.setAttr("aria-expanded", String(!isCollapsed));
    row.setAttr("data-editorial-folder-path", folder.path);

    // Chevron (cliquable sur la rangée entière)
    const chevronIcon = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(chevronIcon, isCollapsed ? "chevron-right" : "chevron-down");

    // Icône dossier
    const folderIcon = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(folderIcon, "folder");

    row.createSpan({ cls: "feuillets-project-row-label" }).setText(folder.name);

    const children = parent.createDiv();
    if (!isCollapsed) this.renderFolderEntries(children, folder, root, depth + 1);
    const toggle = () => {
      this.toggleFolderCollapse(folder.path);
      const collapsed = this.isFolderCollapsed(folder.path);
      row.setAttr("aria-expanded", String(!collapsed));
      setIcon(chevronIcon, collapsed ? "chevron-right" : "chevron-down");
      children.empty();
      if (!collapsed) this.renderFolderEntries(children, folder, root, depth + 1);
      this.updateActiveFile();
    };
    if (isEditorialWorkFolder(root, folder.path)) {
      const showMenu = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const menu = new Menu();
        if (isEditorialSourceFolder(root, folder.path)) {
          menu.addItem(item => item.setTitle(t("editionDocs.newDocument")).setIcon("file-plus").onClick(() => {
            new NewEditionDocumentModal(this.app, name => void this.createDocument(folder, name)).open();
          }));
          menu.addItem(item => item.setTitle(t("editionDocs.newFolder")).setIcon("folder-plus").onClick(() => this.newFolder(folder)));
          menu.addSeparator();
        }
        this.addItemManagement(menu, folder, root);
        this.showItemMenu(menu, event);
      };
      row.addEventListener("contextmenu", showMenu);
      if (!isEditorialSourceFolder(root, folder.path)) {
        const actions = row.createDiv({ cls: "feuillets-project-row-actions" });
        this.iconBtn(actions, "ellipsis", t("packet.exportActions"), showMenu);
      }
    }
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.target === row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        toggle();
      }
    });
  }

  /** Fichier cliquable pour ouvrir, avec action discréte "Révéler". */
  private renderFileRow(parent: HTMLElement, file: TFile, root: TFolder, depth: number): void {
    const row = parent.createDiv({ cls: "feuillets-project-row feuillets-edition-file-row" });
    row.style.paddingLeft = `${6 + depth * 16}px`;
    const icon = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(icon, file.extension === "docx" ? "file-text" : "file");
    row.setAttr("data-editorial-path", file.path);
    row.setAttr("role", "button");
    row.setAttr("tabindex", "0");
    row.createSpan({ cls: "feuillets-project-row-label" }).setText(file.name);
    row.createSpan({ cls: "feuillets-edition-file-kind" }).setText(this.fileKind(file));
    row.addEventListener("click", () => { void this.openFile(file); });
    row.addEventListener("keydown", event => {
      if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      void this.openFile(file);
    });
    row.addEventListener("contextmenu", event => this.fileMenu(event, file, root));
    const actions = row.createDiv({ cls: "feuillets-project-row-actions" });
    if (this.canManage(file, root) && /^(pdf|docx)$/iu.test(file.extension)) {
      this.iconBtn(actions, "ellipsis", t("packet.exportActions"), event => this.fileMenu(event, file, root));
    } else {
      this.iconBtn(actions, "folder-open", t("editionDocs.revealTooltip"), (e) => {
        e.stopPropagation();
        if (!revealInFileExplorer(this.app, file)) new Notice(t("editionDocs.revealUnavailable"));
      });
    }
  }

  /** Rend explicite la nature de fichiers autrement ambigus dans un paquet
   * de soumission ; l'extension reste affichée dans le nom complet. */
  private fileKind(file: TFile): string {
    if (file.extension === "docx") {
      const base = file.basename.toLocaleLowerCase("fr");
      if (base.includes("lettre")) return t("editionDocs.fileKind.letterDocx");
      if (base.includes("manuscrit")) return t("editionDocs.fileKind.manuscriptDocx");
      return "DOCX";
    }
    if (file.basename.toLowerCase().includes("synopsis")) return t("notes.section.synopsis");
    if (file.extension === "md" && (file.name === "Lettre.md" || file.basename.startsWith("Soumission —"))) return t("editionDocs.fileKind.letterMarkdown");
    return file.extension.toUpperCase() || t("editionDocs.fileKind.file");
  }
}

/** Réexporté pour les services/tests qui n'ont besoin que du chemin, sans
 * dépendre de tout le composant. */
export { editionFolderPath };
