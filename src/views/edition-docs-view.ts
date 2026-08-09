import { Modal, Notice, TFile, TFolder, normalizePath, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/index.js";
import { BaseFeuilletsView } from "./base-feuillets-view.js";
import { getEditionRoot, editionFolderPath } from "../services/folder-structure.js";
import { ensureEditionFolder, EDITION_DOCUMENTS, editionDocumentForName } from "../services/project-files.js";
import { openFileActivating } from "../utils/dom.js";
import { prepareSubmission } from "../services/courrier-integration.js";
import { getCourrierApi } from "../services/courrier-integration.js";

type EditionDocsPlugin = ConstructorParameters<typeof BaseFeuilletsView>[1];

type FileExplorerInstance = { revealInFolder?(file: TFile): void };
type AppWithInternalPlugins = App & {
  internalPlugins?: { getPluginById?(id: string): { instance?: FileExplorerInstance } | undefined };
};

/** Ordre d'affichage pour les documents conventionnels. Les dossiers
 * apparaissent après, triés alphabétiquement. */
/** Révèle un fichier dans l'explorateur natif d'Obsidian (pas le Binder de
 * Feuillets) — même geste que le clic droit "Afficher dans l'explorateur"
 * natif. Silencieux si le plugin natif file-explorer est indisponible ou
 * désactivé plutôt que de lever une erreur : ce n'est jamais l'action
 * principale du bouton (ouvrir l'est), juste un raccourci de confort. */
export function revealInFileExplorer(app: App, file: TFile): boolean {
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
      if (e.key === "Enter") submit();
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

/** Onglet "Documents éditoriaux" du nouvel espace Édition (lot 1) : affiche
 * le contenu du dossier Edition/ (facultatif, voisin de Manuscrit — voir
 * folder-structure.js) et permet de le créer, d'y ouvrir/créer des
 * documents et de les révéler dans l'explorateur natif. Volontairement
 * indépendant du panneau Révision DOCX (DocxReviewView) : les deux
 * cohabitent dans le même onglet "Édition" du panneau latéral
 * (sidebar-feuillets-view.js) sans partager d'état. */
export class EditionDocsView extends BaseFeuilletsView {
  declare plugin: EditionDocsPlugin;
  declare targetContainer?: HTMLElement;

  private folderStates = new Map<string, boolean>(); // path -> isCollapsed (persisted in settings.collapsed)

  constructor(leaf: WorkspaceLeaf, plugin: EditionDocsPlugin) {
    super(leaf, plugin);
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
    void this.render();
  }

  getViewType(): string {
    return "feuillets-edition-docs";
  }

  getDisplayText(): string {
    return t("editionDocs.displayText");
  }

  getIcon(): string {
    return "folder-cog";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.targetContainer || this.contentEl;
    container.empty();
    container.addClass("feuillets-edition-docs-container");

    const section = container.createDiv({ cls: "feuillets-project-section" });
    const collapsed = this.renderSectionHead(
      section,
      "folder-cog",
      t("editionDocs.displayText"),
      "editionDocs",
      "documents"
    );
    if (collapsed) return;

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

    this.renderToolbar(section, editionRoot);
    this.renderWorkflow(section);
    this.renderSubmissionSummaries(section, editionRoot);
    this.renderFolderEntries(section, editionRoot);
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
    // Même parcours que la commande de palette "prepare-submission" (voir
    // main.ts) — un simple raccourci visible ici, pas un second chemin
    // (Lot 14D, demande explicite : bouton visible en plus de la
    // commande, jamais à sa place).
    this.iconBtn(toolbar, "send", t("courrier.attachments.submitButton"), () => {
      void prepareSubmission(this.plugin);
    });
  }

  private renderWorkflow(section: HTMLElement): void {
    section.createDiv({
      cls: "feuillets-submission-workflow",
      text: t("editionDocs.submission.workflow"),
    });
  }

  /** Synthèse opérationnelle des soumissions. L'arborescence complète reste
   * affichée dessous, mais ses fichiers ne font pas office de statut : cette
   * carte nomme explicitement le destinataire, les documents et les dates. */
  private renderSubmissionSummaries(section: HTMLElement, editionRoot: TFolder): void {
    const submissions = editionRoot.children.find(
      (child): child is TFolder => child instanceof TFolder && child.name === "Soumissions"
    );
    if (!submissions) return;

    const folders = submissions.children
      .filter((child): child is TFolder => child instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (folders.length === 0) return;

    const wrapper = section.createDiv({ cls: "feuillets-submission-summary" });
    wrapper.createDiv({ cls: "feuillets-submission-summary-title", text: t("editionDocs.submission.tracking") });
    for (const folder of folders) this.renderSubmissionCard(wrapper, folder);
    section.createDiv({ cls: "feuillets-edition-tree-title", text: t("editionDocs.folderFiles") });
  }

  private renderSubmissionCard(parent: HTMLElement, folder: TFolder): void {
    const letter = folder.children.find(
      (child): child is TFile => child instanceof TFile && child.name === "Lettre.md"
    ) ?? folder.children.find((child): child is TFile => child instanceof TFile && child.extension === "md");
    const packageFolder = folder.children.find(
      (child): child is TFolder => child instanceof TFolder && child.name === "Dossier à envoyer"
    );
    const frontmatter = letter
      ? this.app.metadataCache?.getFileCache(letter)?.frontmatter
      : undefined;
    const suivi = frontmatter?.suivi && typeof frontmatter.suivi === "object"
      ? frontmatter.suivi as Record<string, unknown>
      : {};
    const recipient = this.frontmatterText(frontmatter?.destinataire_nom)
      || this.firstDestinationLine(frontmatter?.destinataire)
      || folder.name;
    const statusValue = this.frontmatterText(suivi.statut) || "Brouillon";
    const status = statusValue === "Envoyé" ? t("editionDocs.submission.sent") : statusValue === "Brouillon" ? t("editionDocs.submission.draft") : statusValue;
    const sentDate = this.frontmatterText(suivi.date_envoi);
    const reminderDate = this.frontmatterText(suivi.date_relance);
    const packageFiles = packageFolder?.children.filter((child): child is TFile => child instanceof TFile) ?? [];
    const manuscriptReady = packageFiles.some((file) => file.extension === "docx" && file.basename.toLocaleLowerCase("fr").includes("manuscrit"));
    const letterReady = packageFiles.some((file) => file.extension === "docx" && file.basename.toLocaleLowerCase("fr").includes("lettre"));
    const missing = [!manuscriptReady ? "manuscrit DOCX" : "", !letterReady ? "lettre DOCX" : ""].filter(Boolean);

    const card = parent.createDiv({ cls: "feuillets-submission-card" });
    const head = card.createDiv({ cls: "feuillets-submission-card-head" });
    head.createSpan({ cls: "feuillets-submission-recipient", text: recipient });
    head.createSpan({ cls: "feuillets-submission-status", text: status });
    const reminderBadge = this.reminderBadge(reminderDate);
    if (reminderBadge) head.createSpan({ cls: `feuillets-submission-reminder mod-${reminderBadge.kind}`, text: reminderBadge.text });

    card.createDiv({
      cls: missing.length ? "feuillets-submission-docs mod-missing" : "feuillets-submission-docs mod-ready",
      text: missing.length ? t("editionDocs.submission.missing", { documents: missing.join(", ") }) : t("editionDocs.submission.ready"),
    });
    const dates = card.createDiv({ cls: "feuillets-submission-dates" });
    dates.createSpan({ text: t("editionDocs.submission.sentOn", { date: sentDate || "—" }) });
    dates.createSpan({ text: t("editionDocs.submission.followUpOn", { date: reminderDate || "—" }) });

    const actions = card.createDiv({ cls: "feuillets-submission-actions" });
    this.submissionAction(actions, "file-text", t("editionDocs.submission.openLetter"), () => {
      if (!letter) return new Notice(t("editionDocs.submission.letterMissing"));
      openFileActivating(this.app, this.app.workspace.getLeaf(false), letter);
    });
    this.submissionAction(actions, "folder-open", t("editionDocs.submission.openFolder"), () => {
      if (!letter || !revealInFileExplorer(this.app, letter)) new Notice(t("editionDocs.submission.explorerUnavailable"));
    });
    this.submissionAction(actions, "file-output", t("editionDocs.submission.export"), () => {
      void this.runSubmissionApiAction(letter, "exportSubmissionDocx");
    });
    this.submissionAction(actions, "send", t("editionDocs.submission.markSent"), () => {
      if (!letter) {
        new Notice(t("editionDocs.submission.letterMissing"));
        return;
      }
      new SubmissionSentModal(this.app, (dates) => this.runSubmissionApiAction(letter, "markSubmissionAsSent", dates)).open();
    });
  }

  private submissionAction(parent: HTMLElement, iconName: string, label: string, action: () => void): void {
    const button = parent.createEl("button", { text: label });
    const icon = button.createSpan({ cls: "feuillets-submission-action-icon" });
    setIcon(icon, iconName);
    button.addEventListener("click", action);
  }

  private async runSubmissionApiAction(
    letter: TFile | undefined,
    action: "exportSubmissionDocx" | "markSubmissionAsSent",
    dates?: { dateEnvoi?: string; dateRelance?: string }
  ): Promise<void> {
    if (!letter) {
      new Notice(t("editionDocs.submission.letterMissing"));
      return;
    }
    const api = getCourrierApi(this.app);
    const available = action === "markSubmissionAsSent"
      ? typeof api?.markSubmissionAsSent === "function"
      : typeof api?.exportSubmissionDocx === "function";
    if (!api || !available) {
      new Notice(t("editionDocs.submission.courrierUnavailable"));
      return;
    }
    const result = action === "markSubmissionAsSent"
      ? await api.markSubmissionAsSent?.(letter.path, dates)
      : await api.exportSubmissionDocx?.(letter.path);
    if (!result) return;
    if (!result.success) new Notice(result.message || t("editionDocs.submission.actionFailed"));
    await this.render();
  }

  private frontmatterText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private firstDestinationLine(value: unknown): string {
    return this.frontmatterText(value).split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  }

  private reminderBadge(date: string): { text: string; kind: "due" | "late" } | null {
    if (!date) return null;
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (date < todayIso) return { text: t("editionDocs.submission.overdue"), kind: "late" };
    if (date === todayIso) return { text: t("editionDocs.submission.followUpDue"), kind: "due" };
    return null;
  }

  private async createDocument(editionRoot: TFolder, name: string): Promise<void> {
    const fileName = name.endsWith(".md") ? name : `${name}.md`;
    const path = normalizePath(`${editionRoot.path}/${fileName}`);
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(t("editionDocs.alreadyExists"));
      return;
    }
    const title = fileName.replace(/\.md$/, "");
    const file = await this.app.vault.create(path, `# ${title}\n\n`);
    openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
    await this.render();
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
      return a.name.localeCompare(b.name, "fr");
    });

    // Trier dossiers alphabétiquement
    folders.sort((a, b) => a.name.localeCompare(b.name, "fr"));

    return [...files, ...folders];
  }

  /** Affiche contenu d'un dossier — les dossiers sont repliables. Les
   * fichiers sont cliquables. Le message "vide" n'apparaît que si un
   * dossier est ouvert et vide (pas rendu pour les dossiers fermés). */
  private renderFolderEntries(parent: HTMLElement, folder: TFolder, depth = 0): void {
    const children = this.sortChildren(folder.children as (TFile | TFolder)[]);
    if (children.length === 0) {
      parent.createDiv({ cls: "feuillets-empty" }).setText(t("editionDocs.emptyFolder"));
      return;
    }
    const list = parent.createDiv({ cls: "feuillets-project-list" });
    for (const child of children) {
      if (child instanceof TFolder) {
        this.renderFolderRow(list, child, depth);
        const isCollapsed = this.isFolderCollapsed(child.path);
        if (!isCollapsed) {
          this.renderFolderEntries(list, child, depth + 1);
        }
      } else if (child instanceof TFile) {
        this.renderFileRow(list, child, depth);
      }
    }
  }

  /** Dossier cliquable : clique ouvre/ferme, chevron indique l'état. */
  private renderFolderRow(parent: HTMLElement, folder: TFolder, depth: number): void {
    const row = parent.createDiv({ cls: "feuillets-project-row feuillets-edition-folder-row" });
    row.style.paddingLeft = `${6 + depth * 16}px`;
    const isCollapsed = this.isFolderCollapsed(folder.path);

    // Chevron (cliquable sur la rangée entière)
    const chevronIcon = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(chevronIcon, isCollapsed ? "chevron-right" : "chevron-down");

    // Icône dossier
    const folderIcon = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(folderIcon, "folder");

    row.createSpan({ cls: "feuillets-project-row-label" }).setText(folder.name);

    // Toute la rangée cliquable pour toggle
    row.addEventListener("click", () => {
      this.toggleFolderCollapse(folder.path);
    });
  }

  /** Fichier cliquable pour ouvrir, avec action discréte "Révéler". */
  private renderFileRow(parent: HTMLElement, file: TFile, depth: number): void {
    const row = parent.createDiv({ cls: "feuillets-project-row feuillets-edition-file-row" });
    row.style.paddingLeft = `${6 + depth * 16}px`;
    const icon = row.createSpan({ cls: "feuillets-cell-icon" });
    setIcon(icon, file.extension === "docx" ? "file-text" : "file");
    row.createSpan({ cls: "feuillets-project-row-label" }).setText(file.name);
    row.createSpan({ cls: "feuillets-edition-file-kind" }).setText(this.fileKind(file));
    row.addEventListener("click", () => {
      openFileActivating(this.app, this.app.workspace.getLeaf(false), file);
    });
    const actions = row.createDiv({ cls: "feuillets-project-row-actions" });
    this.iconBtn(actions, "folder-open", t("editionDocs.revealTooltip"), (e) => {
      e.stopPropagation();
      if (!revealInFileExplorer(this.app, file)) {
        new Notice(t("editionDocs.revealUnavailable"));
      }
    });
  }

  /** Rend explicite la nature de fichiers autrement ambigus dans un paquet
   * de soumission ; l'extension reste affichée dans le nom complet. */
  private fileKind(file: TFile): string {
    if (file.extension === "docx") {
      const base = file.basename.toLocaleLowerCase("fr");
      if (base.includes("lettre")) return "Lettre DOCX";
      if (base.includes("manuscrit")) return "Manuscrit DOCX";
      return "DOCX";
    }
    if (file.basename.toLowerCase().includes("synopsis")) return "Synopsis";
    if (file.extension === "md" && (file.name === "Lettre.md" || file.basename.startsWith("Soumission —"))) return "Lettre source Markdown";
    return file.extension.toUpperCase() || "Fichier";
  }
}

/** Réexporté pour les services/tests qui n'ont besoin que du chemin, sans
 * dépendre de toute la vue. */
export { editionFolderPath };
